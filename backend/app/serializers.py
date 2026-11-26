"""响应序列化辅助函数。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from .models import Category, Material, MaterialLog, User, UserVisit


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat(sep=" ", timespec="minutes") if value else None


def user_dict(user: User) -> Dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "active": bool(user.active),
        "note": user.note or "",
        "created_at": _dt(user.created_at),
        "updated_at": _dt(user.updated_at),
    }


def category_dict(category: Category) -> Dict[str, Any]:
    return {
        "id": category.id,
        "name": category.name,
        "parent_id": category.parent_id,
        "created_at": _dt(category.created_at),
    }


def site_settings_dict(row: Any) -> Dict[str, Any]:
    return {
        "app_name": row.app_name,
        "club_name": row.club_name,
        "logo_image": row.logo_image or "",
        "cover_title": row.cover_title,
        "cover_slogan": row.cover_slogan,
        "cover_footer": row.cover_footer,
        "updated_at": _dt(row.updated_at),
    }


def material_dict(material: Material, category_name: str = "", borrow_count: int | None = None) -> Dict[str, Any]:
    qty = material.qty
    min_qty = material.min_qty
    is_warn = bool(
        material.mode == "precise"
        and min_qty is not None
        and min_qty > 0
        and qty is not None
        and qty <= min_qty
    )
    return {
        "id": material.id,
        "code": material.code,
        "name": material.name,
        "model": material.model,
        "jlc_no": material.jlc_no or "",
        "package": material.package,
        "spec": material.spec,
        "brand": material.brand,
        "mode": material.mode,
        "qty": qty,
        "min_qty": min_qty,
        "status": material.status,
        "cabinet": material.cabinet,
        "slot": material.slot,
        "category_id": material.category_id,
        "category_name": category_name,
        "source": material.source,
        "inbound_at": _dt(material.inbound_at),
        "image": material.image,
        "note": material.note,
        "is_warn": is_warn,
        "borrow_count": int(borrow_count or 0),
        "created_at": _dt(material.created_at),
        "updated_at": _dt(material.updated_at),
    }


def log_dict(log: MaterialLog, material: Material | None = None, category_name: str = "") -> Dict[str, Any]:
    return {
        "id": log.id,
        "material_id": log.material_id,
        "material_name": material.name if material else "",
        "material_model": material.model if material else "",
        "material_code": material.code if material else "",
        "category_name": category_name,
        "action": log.action,
        "qty": log.qty,
        "order_no": log.order_no,
        "borrower": log.borrower,
        "project": log.project,
        "operator_id": log.operator_id,
        "note": log.note,
        "created_at": _dt(log.created_at),
    }


def visit_dict(visit: UserVisit) -> Dict[str, Any]:
    return {
        "id": visit.id,
        "user_id": visit.user_id,
        "username": visit.username,
        "name": visit.name,
        "role": visit.role,
        "ip": visit.ip,
        "visited_at": _dt(visit.visited_at),
    }
