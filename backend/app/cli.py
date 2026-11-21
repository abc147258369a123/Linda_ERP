"""命令行工具：创建 / 重置管理员账号（密码使用 bcrypt 哈希，禁止明文入库）。

用法（在容器内）：
  python -m app.cli create-admin --username superadmin --name 周明 --role super --password-stdin
"""
from __future__ import annotations

import argparse
import getpass
import sys

from .db import SessionLocal, wait_for_db
from .models import User
from .security import hash_password


def _read_password(args: argparse.Namespace) -> str:
    if args.password:
        return args.password
    if args.password_stdin:
        return sys.stdin.read().strip()
    first = getpass.getpass("请输入密码（至少 8 位）：")
    second = getpass.getpass("请再次输入密码：")
    if first != second:
        raise SystemExit("两次输入的密码不一致")
    return first


def create_admin(args: argparse.Namespace) -> int:
    if args.role not in ("super", "admin"):
        raise SystemExit("角色只能是 super 或 admin")
    username = args.username.strip()
    if not username:
        raise SystemExit("用户名不能为空")
    password = _read_password(args)
    if len(password) < 8:
        raise SystemExit("密码长度至少 8 位")

    wait_for_db(max_attempts=15, interval_seconds=2.0)
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == username).first()
        if existing is not None:
            if not args.reset_password:
                print(f"账号 {username} 已存在；如需重置密码请追加 --reset-password", file=sys.stderr)
                return 1
            existing.password_hash = hash_password(password)
            existing.name = args.name.strip() or existing.name
            existing.role = args.role
            existing.active = True
            if args.note:
                existing.note = args.note.strip()
            db.commit()
            print(f"已重置管理员密码：{username}（角色 {existing.role}）")
            return 0

        user = User(
            username=username,
            password_hash=hash_password(password),
            name=args.name.strip() or username,
            role=args.role,
            active=True,
            note=(args.note or "").strip(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"已创建管理员：{user.username}（{user.name}，角色 {user.role}）")
        return 0
    finally:
        db.close()


def list_users(_args: argparse.Namespace) -> int:
    wait_for_db(max_attempts=15, interval_seconds=2.0)
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.id.asc()).all()
        if not users:
            print("暂无用户")
            return 0
        for user in users:
            print(f"{user.id}\t{user.username}\t{user.name}\t{user.role}\tactive={bool(user.active)}")
        return 0
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Linda_ERP 管理命令")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create-admin", help="创建管理员账号（密码 bcrypt 哈希）")
    create.add_argument("--username", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--role", default="super", choices=["super", "admin"])
    create.add_argument("--password", default="")
    create.add_argument("--password-stdin", action="store_true")
    create.add_argument("--reset-password", action="store_true")
    create.add_argument("--note", default="")
    create.set_defaults(func=create_admin)

    listing = sub.add_parser("list-users", help="列出账号")
    listing.set_defaults(func=list_users)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
