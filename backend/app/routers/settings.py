"""站点自定义配置接口（v1.3.0）。

- GET  /api/settings  登录用户可读（用于侧边栏标题 / Logo / 封面文案）
- PATCH /api/settings 仅超级管理员可改（双击编辑、Logo 上传、封面编辑页共用）
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_super
from ..models import SiteSetting, User
from ..schemas import SiteSettingsUpdate
from ..serializers import site_settings_dict

router = APIRouter(prefix="/api/settings", tags=["站点配置"])

DEFAULTS = {
    "app_name": "硬件物料台账",
    "club_name": "校内硬件社团",
    "logo_image": "",
    "cover_title": "硬件物料台账",
    "cover_slogan": "轻量化 ERP · 回收元器件统一台账",
    "cover_footer": "Linda_ERP · 校内硬件社团",
}


def _get_or_create(db: Session) -> SiteSetting:
    row = db.query(SiteSetting).order_by(SiteSetting.id.asc()).first()
    if row is None:
        row = SiteSetting(**DEFAULTS)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("", summary="读取站点配置（公开：登录页需要读取标题 / 社团名 / Logo）")
def read_settings(db: Session = Depends(get_db)):
    return site_settings_dict(_get_or_create(db))


@router.patch("", summary="修改站点配置（仅超级管理员）")
def update_settings(
    payload: SiteSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_super),
):
    row = _get_or_create(db)
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field in ("app_name", "club_name", "logo_image", "cover_title", "cover_slogan", "cover_footer"):
        if field in data:
            setattr(row, field, str(data[field]))
    db.commit()
    db.refresh(row)
    return site_settings_dict(row)
