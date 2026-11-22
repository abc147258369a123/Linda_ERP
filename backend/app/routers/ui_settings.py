"""页面可编辑文案接口（v1.4.0：登录封面页文案）。

- GET   /api/ui-settings/{page}   **无需登录**（登录页在未登录状态也要读取文案）
- PATCH /api/ui-settings/{page}   仅超级管理员，批量修改 {values: {field_key: value}}
- 首次读取时自动写入该页面的默认文案（幂等，只补缺失字段）
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_super
from ..models import UiSetting, User
from ..schemas import UiSettingsUpdate

router = APIRouter(prefix="/api/ui-settings", tags=["页面文案配置"])

# 登录页可编辑文案：field_key -> (label, 默认值)
LOGIN_TEXTS: list[tuple[str, str, str]] = [
    ("login_title", "主标题", "硬件物料台账"),
    ("login_subtitle", "副标题", "校内硬件社团 · 轻量化 ERP"),
    ("login_point1_title", "介绍 1 · 标题", "双模式库存"),
    ("login_point1_desc", "介绍 1 · 描述", "海量小件记状态，稀缺器件记数量"),
    ("login_point2_title", "介绍 2 · 标题", "领用全留痕"),
    ("login_point2_desc", "介绍 2 · 描述", "每次领用自动生成日志，永久可查"),
    ("login_point3_title", "介绍 3 · 标题", "轻量可离线"),
    ("login_point3_desc", "介绍 3 · 描述", "纯静态页面，树莓派本地部署"),
    ("login_card_title", "登录卡片标题", "账号登录"),
    ("login_card_desc", "登录卡片说明", "使用社团账号登录，角色与权限由后端统一校验"),
    ("login_label_account", "账号标签", "账号"),
    ("login_placeholder_account", "账号输入提示", "请输入社团账号"),
    ("login_label_password", "密码标签", "密码"),
    ("login_placeholder_password", "密码输入提示", "请输入密码"),
    ("login_btn_text", "登录按钮文字", "登 录"),
    ("login_note", "卡片底部说明", "账号由超级管理员在「用户管理」中创建；登录成功后使用 JWT 令牌访问后端接口，页面数据全部来自 MariaDB，不再使用浏览器模拟数据。"),
    ("login_footer", "页脚文字", "HARDWARE INVENTORY"),
    ("login_session_text", "已登录提示", "当前已登录，可直接进入系统"),
]

PAGES = {"login": LOGIN_TEXTS}


def _definitions(page: str) -> list[tuple[str, str, str]]:
    definitions = PAGES.get(page)
    if definitions is None:
        raise HTTPException(status_code=404, detail="页面文案配置不存在")
    return definitions


def _ensure_defaults(db: Session, page: str) -> None:
    """补齐缺失字段（只在缺失时写入，绝不覆盖已有值）。"""
    existing = {
        row.field_key
        for row in db.query(UiSetting).filter(UiSetting.page == page).all()
    }
    changed = False
    for key, label, default in _definitions(page):
        if key in existing:
            continue
        db.add(UiSetting(page=page, field_key=key, label=label, value=default))
        changed = True
    if changed:
        db.commit()


def _values(db: Session, page: str) -> dict:
    order = {key: index for index, (key, _, _) in enumerate(_definitions(page))}
    rows = db.query(UiSetting).filter(UiSetting.page == page).all()
    rows.sort(key=lambda row: order.get(row.field_key, 999))
    return {row.field_key: row.value for row in rows}


@router.get("/{page}", summary="读取页面文案（公开，供登录页使用）")
def read_page_texts(page: str, db: Session = Depends(get_db)):
    _definitions(page)
    _ensure_defaults(db, page)
    values = _values(db, page)
    items = [
        {"key": key, "label": label, "value": values.get(key, default)}
        for key, label, default in _definitions(page)
    ]
    return {"page": page, "items": items, "values": values, "updated_at": None}


@router.patch("/{page}", summary="修改页面文案（仅超级管理员）")
def update_page_texts(
    page: str,
    payload: UiSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_super),
):
    definitions = _definitions(page)
    allowed = {key for key, _, _ in definitions}
    incoming = {
        str(key): str(value)[:500]
        for key, value in (payload.values or {}).items()
        if str(key) in allowed
    }
    if not incoming:
        raise HTTPException(status_code=400, detail="没有可更新的文案字段")

    _ensure_defaults(db, page)
    rows = db.query(UiSetting).filter(UiSetting.page == page).all()
    index = {row.field_key: row for row in rows}
    for key, value in incoming.items():
        row = index.get(key)
        if row is not None and row.value != value:
            row.value = value
    db.commit()
    values = _values(db, page)
    items = [
        {"key": key, "label": label, "value": values.get(key, default)}
        for key, label, default in definitions
    ]
    return {"page": page, "items": items, "values": values}
