"""数据库备份与独立 Git 推送（仅超级管理员）。

设计约束：
- 备份只保存 MariaDB 的全量 .sql 文本快照，绝不复制数据库原始文件；
- 本地备份目录、Git 仓库、SSH key 都与 ERP 源码仓库完全隔离；
- 配置和操作日志保存在备份目录内的隐藏文件，不进入业务数据库、不进入 Git；
- 所有接口只允许 super 角色访问，导出 / 推送 / 配置变更都会记录操作人、时间与结果。
"""
from __future__ import annotations

import json
import logging
import os
import re
import shlex
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import settings
from ..deps import require_super
from ..models import User
from ..schemas import BackupConfigUpdate, BackupPushRequest

router = APIRouter(prefix="/api/admin/backup", tags=["数据库备份"])
logger = logging.getLogger("linda_erp.backup")

CONFIG_NAME = ".backup-config.json"
LOG_NAME = "backup-ops.log"
GITIGNORE_NAME = ".gitignore"
REMOTE_BRANCH = "main"
BACKUP_RE = re.compile(r"^linda_erp_\d{8}_\d{6}(?:_\d+)?\.sql$")
REMOTE_RE = re.compile(
    r"^(?:"
    r"git@[A-Za-z0-9.-]+:[A-Za-z0-9_./~-]+"
    r"|ssh://[A-Za-z0-9_.@:/-]+"
    r"|https://[A-Za-z0-9_.:/@~-]+"
    r"|file:///[^\s]+"
    r")$"
)


# ---------------------------------------------------------------- 基础工具
def _backup_dir() -> Path:
    path = Path(settings.backup_dir)
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"备份目录不可用：{exc}") from None
    return path


def _config_path() -> Path:
    return _backup_dir() / CONFIG_NAME


def _log_path() -> Path:
    return _backup_dir() / LOG_NAME


def _read_config() -> dict:
    path = _config_path()
    if not path.is_file():
        return {"repo_url": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("not an object")
        return {"repo_url": str(data.get("repo_url") or "")}
    except (OSError, ValueError):
        return {"repo_url": ""}


def _write_config(data: dict) -> None:
    path = _config_path()
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def _now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")


def _append_log(actor: User, action: str, target: str, status: str, detail: str = "") -> None:
    record = {
        "time": _now_text(),
        "account": actor.username,
        "name": actor.name,
        "action": action,
        "target": target,
        "status": status,
        "detail": detail[:1000],
    }
    try:
        with _log_path().open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        logger.exception("写入备份操作日志失败")


def _read_logs(limit: int = 80) -> list[dict]:
    path = _log_path()
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    result: list[dict] = []
    for line in lines[-limit * 2:]:
        try:
            item = json.loads(line)
            if isinstance(item, dict):
                result.append(item)
        except ValueError:
            continue
    return list(reversed(result[-limit:]))


def _git_env() -> dict:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = "true"
    key = Path(settings.backup_ssh_key)
    if key.is_file():
        known_hosts = key.parent / "known_hosts"
        ssh_command = [
            "ssh",
            "-i", str(key),
            "-o", "IdentitiesOnly=yes",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={known_hosts}",
            "-o", "ConnectTimeout=12",
        ]
        env["GIT_SSH_COMMAND"] = " ".join(shlex.quote(part) for part in ssh_command)
    return env


def _git(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess:
    repo = _backup_dir()
    return subprocess.run(
        ["git", *args],
        cwd=str(repo),
        capture_output=True,
        text=True,
        timeout=timeout,
        env=_git_env(),
    )


def _tail(text: str, limit: int = 400) -> str:
    value = (text or "").strip()
    return value[-limit:] if len(value) > limit else value


def _ensure_repo() -> Path:
    repo = _backup_dir()
    if not (repo / ".git").is_dir():
        result = _git(["init", "-b", REMOTE_BRANCH], timeout=20)
        if result.returncode != 0:
            # 老版本 git 不支持 -b，退化处理
            result = _git(["init"], timeout=20)
            if result.returncode != 0:
                raise HTTPException(status_code=500, detail=f"初始化备份 Git 仓库失败：{_tail(result.stderr)}")
            _git(["symbolic-ref", "HEAD", f"refs/heads/{REMOTE_BRANCH}"])
    name = _git(["config", "--local", "--get", "user.name"])
    if name.returncode != 0:
        _git(["config", "--local", "user.name", "Linda ERP Backup"])
    email = _git(["config", "--local", "--get", "user.email"])
    if email.returncode != 0:
        _git(["config", "--local", "user.email", "backup@linda.local"])

    ignore = repo / GITIGNORE_NAME
    ignore_lines = [
        "# 本地配置、操作日志和草稿不进入备份仓库",
        CONFIG_NAME,
        LOG_NAME,
        "*.tmp",
        "*.part",
        "",
    ]
    try:
        existing = ignore.read_text(encoding="utf-8") if ignore.is_file() else ""
        missing = [line for line in ignore_lines if line and line not in existing.splitlines()]
        if missing:
            with ignore.open("a", encoding="utf-8") as handle:
                if existing and not existing.endswith("\n"):
                    handle.write("\n")
                handle.write("\n".join(missing) + "\n")
    except OSError:
        pass
    return repo


def _set_remote(repo_url: str) -> None:
    repo = _ensure_repo()
    current = _git(["remote", "get-url", "origin"])
    if not repo_url:
        if current.returncode == 0:
            _git(["remote", "remove", "origin"])
        return
    if current.returncode == 0:
        if current.stdout.strip() != repo_url:
            _git(["remote", "set-url", "origin", repo_url])
    else:
        result = _git(["remote", "add", "origin", repo_url])
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"配置 Git 仓库失败：{_tail(result.stderr)}")


def _validate_remote(url: str) -> str:
    value = (url or "").strip()
    if value and (not REMOTE_RE.match(value) or value.startswith("-")):
        raise HTTPException(
            status_code=400,
            detail="Git 仓库地址格式不支持，请填写 SSH 地址（git@github.com:用户名/仓库.git）或 HTTPS 地址",
        )
    return value


def _public_key() -> str:
    path = Path(settings.backup_ssh_key + ".pub")
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _check_remote(repo_url: str) -> tuple[bool, str]:
    """用 git ls-remote 做只读预检，无提交、无推送。"""
    try:
        result = _git(["ls-remote", "--heads", "origin"], timeout=20)
    except subprocess.TimeoutExpired:
        return False, "连接备份仓库超时（20 秒）"
    if result.returncode != 0:
        return False, f"无法连接备份仓库：{_tail(result.stderr, 500)}"
    return True, "备份仓库连接正常"


# ---------------------------------------------------------------- 备份文件
def _size_text(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def _commit_for(repo: Path, filename: str) -> str:
    result = _git(["log", "-1", "--format=%H", "--", filename])
    return result.stdout.strip() if result.returncode == 0 else ""


def _is_pushed(repo: Path, commit: str) -> bool:
    if not commit:
        return False
    remote_ref = _git(["rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{REMOTE_BRANCH}"])
    if remote_ref.returncode != 0:
        return False
    ancestor = _git(["merge-base", "--is-ancestor", commit, remote_ref.stdout.strip()])
    return ancestor.returncode == 0


def _backup_item(path: Path) -> dict | None:
    if not path.is_file() or not BACKUP_RE.match(path.name):
        return None
    stat = path.stat()
    repo = _backup_dir()
    commit = _commit_for(repo, path.name)
    tracked = _git(["ls-files", "--error-unmatch", "--", path.name]).returncode == 0
    pushed = _is_pushed(repo, commit)
    created = datetime.fromtimestamp(stat.st_mtime).astimezone().strftime("%Y-%m-%d %H:%M:%S")
    return {
        "filename": path.name,
        "created_at": created,
        "size": stat.st_size,
        "size_text": _size_text(stat.st_size),
        "tracked": tracked,
        "commit": commit[:10],
        "pushed": pushed,
        "state": "pushed" if pushed else ("committed" if tracked else "untracked"),
    }


def _list_backups() -> list[dict]:
    repo = _ensure_repo()
    items: list[dict] = []
    for path in repo.glob("linda_erp_*.sql"):
        item = _backup_item(path)
        if item:
            items.append(item)
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items


# ---------------------------------------------------------------- 检查
def _checks() -> tuple[list[dict], str]:
    checks: list[dict] = []
    repo_url = _read_config().get("repo_url", "")

    git_path = shutil.which("git")
    git_version = ""
    if git_path:
        try:
            version = subprocess.run(["git", "--version"], capture_output=True, text=True, timeout=10)
            git_version = version.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    checks.append({
        "key": "git",
        "label": "Git 环境",
        "ok": bool(git_path),
        "level": "ok" if git_path else "error",
        "message": git_version or "未安装 git",
    })

    dump_cmd = shutil.which("mariadb-dump") or shutil.which("mysqldump")
    checks.append({
        "key": "dump",
        "label": "数据库导出工具",
        "ok": bool(dump_cmd),
        "level": "ok" if dump_cmd else "error",
        "message": dump_cmd or "未安装 mariadb-dump / mysqldump",
    })

    try:
        repo = _ensure_repo()
        dir_ok = os.access(repo, os.W_OK)
        dir_message = str(repo) if dir_ok else f"{repo}（不可写）"
    except HTTPException as exc:
        repo = None
        dir_ok = False
        dir_message = str(exc.detail)
    checks.append({
        "key": "dir",
        "label": "独立备份目录",
        "ok": dir_ok,
        "level": "ok" if dir_ok else "error",
        "message": dir_message,
    })

    checks.append({
        "key": "repo",
        "label": "独立 Git 仓库",
        "ok": bool(repo and (repo / ".git").is_dir()),
        "level": "ok" if repo and (repo / ".git").is_dir() else "error",
        "message": "备份目录内的独立 Git 仓库" if repo else "备份目录不可用",
    })

    key_path = Path(settings.backup_ssh_key)
    key_ok = key_path.is_file()
    checks.append({
        "key": "key",
        "label": "独立 SSH 密钥",
        "ok": key_ok,
        "level": "ok" if key_ok else "error",
        "message": str(key_path) if key_ok else f"缺少 SSH 私钥：{key_path}",
    })

    if not repo_url:
        checks.append({
            "key": "remote",
            "label": "备份仓库地址",
            "ok": False,
            "level": "warn",
            "message": "尚未配置独立备份仓库 URL",
        })
        checks.append({
            "key": "connect",
            "label": "Git / SSH 连通性",
            "ok": False,
            "level": "warn",
            "message": "配置仓库地址后自动检查",
        })
    else:
        try:
            _set_remote(repo_url)
            checks.append({
                "key": "remote",
                "label": "备份仓库地址",
                "ok": True,
                "level": "ok",
                "message": repo_url,
            })
            connected, detail = _check_remote(repo_url)
            is_ssh = repo_url.startswith(("git@", "ssh://"))
            checks.append({
                "key": "connect",
                "label": "SSH 免密连通性" if is_ssh else "Git 远端连通性",
                "ok": connected,
                "level": "ok" if connected else "error",
                "message": detail if connected else f"{detail}。SSH 地址请确认已将下方公钥添加为仓库 Deploy Key 并勾选写权限。",
            })
        except HTTPException as exc:
            checks.append({
                "key": "remote",
                "label": "备份仓库地址",
                "ok": False,
                "level": "error",
                "message": str(exc.detail),
            })
            checks.append({
                "key": "connect",
                "label": "SSH 免密连通性",
                "ok": False,
                "level": "error",
                "message": "仓库地址不可用，无法检查连通性",
            })

    ready = all(item["ok"] for item in checks if item["level"] != "warn") and bool(repo_url)
    return checks, repo_url


# ---------------------------------------------------------------- API
@router.get("/status", summary="备份页状态与预检")
def backup_status(actor: User = Depends(require_super)):
    checks, repo_url = _checks()
    try:
        backups = _list_backups()
    except HTTPException:
        backups = []
    return {
        "ready": all(item["ok"] for item in checks if item["level"] != "warn") and bool(repo_url),
        "repo_url": repo_url,
        "backup_dir": str(Path(settings.backup_dir)),
        "remote_branch": REMOTE_BRANCH,
        "ssh_public_key": _public_key(),
        "ssh_key_path": settings.backup_ssh_key,
        "git_version": next((item["message"] for item in checks if item["key"] == "git"), ""),
        "checks": checks,
        "backup_count": len(backups),
        "last_backup": backups[0] if backups else None,
        "accounts": {
            "account": actor.username,
            "name": actor.name,
        },
    }


@router.put("/config", summary="保存独立备份仓库地址")
def save_config(payload: BackupConfigUpdate, actor: User = Depends(require_super)):
    repo_url = _validate_remote(payload.repo_url)
    try:
        _ensure_repo()
        _set_remote(repo_url)
        _write_config({
            "repo_url": repo_url,
            "updated_at": _now_text(),
            "updated_by": actor.username,
        })
    except HTTPException as exc:
        _append_log(actor, "config", repo_url, "failed", str(exc.detail))
        raise
    _append_log(actor, "config", repo_url or "（清空）", "success", "已保存独立备份仓库地址")
    return {"ok": True, "repo_url": repo_url, "message": "备份仓库配置已保存"}


@router.get("/list", summary="本地备份文件列表")
def list_backups(actor: User = Depends(require_super)):
    items = _list_backups()
    return {
        "items": items,
        "total": len(items),
        "total_size": sum(item["size"] for item in items),
    }


@router.post("/export", summary="导出数据库 .sql 备份")
def export_backup(actor: User = Depends(require_super)):
    _ensure_repo()
    dump_cmd = shutil.which("mariadb-dump") or shutil.which("mysqldump")
    if not dump_cmd:
        _append_log(actor, "export", "-", "failed", "服务器缺少 mariadb-dump / mysqldump")
        raise HTTPException(status_code=500, detail="服务器缺少数据库导出工具（mariadb-dump / mysqldump）")

    repo = _backup_dir()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"linda_erp_{stamp}.sql"
    counter = 1
    while (repo / filename).exists():
        filename = f"linda_erp_{stamp}_{counter}.sql"
        counter += 1
    target = repo / filename
    part = repo / f".{filename}.part"

    env = os.environ.copy()
    env["MYSQL_PWD"] = settings.db_password
    cmd = [
        dump_cmd,
        f"--host={settings.db_host}",
        f"--port={settings.db_port}",
        f"--user={settings.db_user}",
        "--single-transaction",
        "--quick",
        "--routines",
        "--triggers",
        "--default-character-set=utf8mb4",
        settings.db_name,
    ]
    try:
        with part.open("wb") as handle:
            result = subprocess.run(
                cmd,
                stdout=handle,
                stderr=subprocess.PIPE,
                text=True,
                timeout=180,
                env=env,
            )
        if result.returncode != 0:
            raise RuntimeError(_tail(result.stderr) or f"mariadb-dump 退出码 {result.returncode}")
        if part.stat().st_size < 100:
            raise RuntimeError("导出的 SQL 文件为空或过小")
        with part.open("rb") as handle:
            header = handle.read(256)
        if b"MariaDB dump" not in header and b"MySQL dump" not in header:
            raise RuntimeError("导出文件不是有效的 MariaDB/MySQL SQL 备份")
        part.replace(target)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        try:
            part.unlink(missing_ok=True)
        except OSError:
            pass
        message = "数据库导出超时（180 秒）" if isinstance(exc, subprocess.TimeoutExpired) else str(exc)
        _append_log(actor, "export", filename, "failed", message)
        raise HTTPException(status_code=500, detail=f"数据库导出失败：{message}") from None

    item = _backup_item(target)
    _append_log(actor, "export", filename, "success", f"size={target.stat().st_size}")
    return {"ok": True, "message": "数据库已导出为 .sql 备份", "backup": item}


@router.post("/push", summary="推送选中的备份到独立 Git 仓库")
def push_backup(payload: BackupPushRequest, actor: User = Depends(require_super)):
    filename = payload.filename.strip()
    if not BACKUP_RE.match(filename):
        raise HTTPException(status_code=400, detail="备份文件名不合法")
    repo = _ensure_repo()
    target = repo / filename
    if target.parent.resolve() != repo.resolve() or not target.is_file():
        raise HTTPException(status_code=404, detail="本地备份文件不存在")

    repo_url = _read_config().get("repo_url", "")
    if not repo_url:
        _append_log(actor, "push", filename, "failed", "尚未配置备份仓库")
        raise HTTPException(status_code=400, detail="请先保存独立备份 Git 仓库地址")

    try:
        _set_remote(repo_url)
        connected, detail = _check_remote(repo_url)
        if not connected:
            _append_log(actor, "push", filename, "failed", detail)
            raise HTTPException(status_code=400, detail=f"推送前检查失败：{detail}")
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        _append_log(actor, "push", filename, "failed", "连接远端超时")
        raise HTTPException(status_code=400, detail="推送前连接远端超时") from None

    add_result = _git(["add", "--", filename])
    if add_result.returncode != 0:
        _append_log(actor, "push", filename, "failed", _tail(add_result.stderr))
        raise HTTPException(status_code=500, detail=f"加入 Git 暂存区失败：{_tail(add_result.stderr)}")

    diff = _git(["diff", "--cached", "--quiet", "--", filename])
    commit = _commit_for(repo, filename)
    if diff.returncode != 0:
        stamp = datetime.fromtimestamp(target.stat().st_mtime).astimezone().strftime("%Y-%m-%d %H:%M:%S")
        message = f"backup: {stamp} | {filename}"
        commit_result = subprocess.run(
            ["git", "-c", "commit.gpgsign=false", "commit", "-m", message, "--", filename],
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=30,
            env=_git_env(),
        )
        if commit_result.returncode != 0:
            _append_log(actor, "push", filename, "failed", _tail(commit_result.stderr))
            raise HTTPException(status_code=500, detail=f"创建 Git 提交失败：{_tail(commit_result.stderr)}")
        commit = _commit_for(repo, filename)
    elif not commit:
        _append_log(actor, "push", filename, "failed", "没有可提交的内容")
        raise HTTPException(status_code=400, detail="没有可提交的备份内容")

    push_result = _git(["push", "-u", "origin", f"HEAD:{REMOTE_BRANCH}"], timeout=120)
    if push_result.returncode != 0:
        message = _tail(push_result.stderr)
        _append_log(actor, "push", filename, "failed", message)
        raise HTTPException(
            status_code=400,
            detail=f"Push 失败（本地提交已保留，可修复后重试）：{message}",
        )

    _append_log(actor, "push", filename, "success", f"commit={commit[:10]} branch={REMOTE_BRANCH}")
    return {
        "ok": True,
        "message": "备份已推送到独立 Git 仓库",
        "filename": filename,
        "commit": commit[:10],
        "branch": REMOTE_BRANCH,
        "pushed": True,
    }


@router.get("/logs", summary="备份操作日志")
def backup_logs(limit: int = Query(default=50, ge=1, le=200), actor: User = Depends(require_super)):
    return {"items": _read_logs(limit), "operator": actor.username}
