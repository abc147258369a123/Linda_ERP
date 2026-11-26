"""库存查询 / 低库存预警 / 流水日志。"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin
from ..models import Category, Material, MaterialLog, User
from ..serializers import log_dict, material_dict

router = APIRouter(prefix="/api/inventory", tags=["库存"])


def _parse_date(value: str, field_name: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_name}格式应为 YYYY-MM-DD") from None


@router.get("", summary="库存查询（物料 + 库存 + 分类）")
def inventory(
    q: str = Query(default="", max_length=60),
    mode: str = Query(default=""),
    status_value: str = Query(default="", alias="status"),
    category_id: int | None = Query(default=None),
    warn_only: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=300, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(Material, Category.name).join(Category, Material.category_id == Category.id)
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            Material.name.like(like), Material.model.like(like), Material.jlc_no.like(like), Material.code.like(like),
            Material.source.like(like), Material.cabinet.like(like), Material.slot.like(like),
        ))
    if mode in ("simple", "precise"):
        query = query.filter(Material.mode == mode)
    if status_value in ("available", "empty"):
        query = query.filter(Material.status == status_value)
    if category_id:
        query = query.filter(Material.category_id == category_id)
    if warn_only:
        query = query.filter(
            Material.mode == "precise",
            Material.min_qty.isnot(None),
            Material.min_qty > 0,
            Material.qty.isnot(None),
            Material.qty <= Material.min_qty,
        )
    total = query.count()
    rows = query.order_by(Material.updated_at.desc(), Material.id.desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    items = [material_dict(material, category_name) for material, category_name in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/warnings", summary="低库存预警（精确计数模式）")
def warnings(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = (
        db.query(Material, Category.name)
        .join(Category, Material.category_id == Category.id)
        .filter(
            Material.mode == "precise",
            Material.min_qty.isnot(None),
            Material.min_qty > 0,
            Material.qty.isnot(None),
            Material.qty <= Material.min_qty,
        )
        .order_by((Material.qty - Material.min_qty).asc(), Material.name.asc())
        .all()
    )
    items = []
    for material, category_name in rows:
        data = material_dict(material, category_name)
        data["gap"] = max(0, int(material.min_qty or 0) - int(material.qty or 0))
        items.append(data)
    return {"items": items, "total": len(items)}


@router.get("/logs", summary="物料流水日志（领用 / 入库 / 标记为空）")
def logs(
    q: str = Query(default="", max_length=60),
    action: str = Query(default=""),
    category_id: int | None = Query(default=None),
    from_date: str = Query(default="", alias="from"),
    to_date: str = Query(default="", alias="to"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = (
        db.query(MaterialLog, Material, Category.name, User.name)
        .join(Material, MaterialLog.material_id == Material.id)
        .join(Category, Material.category_id == Category.id)
        .outerjoin(User, MaterialLog.operator_id == User.id)
    )
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            Material.name.like(like), Material.model.like(like), Material.jlc_no.like(like), Material.code.like(like),
            MaterialLog.borrower.like(like), MaterialLog.project.like(like),
            MaterialLog.note.like(like), MaterialLog.order_no.like(like),
        ))
    if action in ("borrow", "restock", "empty", "adjust"):
        query = query.filter(MaterialLog.action == action)
    if category_id:
        query = query.filter(Material.category_id == category_id)
    start = _parse_date(from_date, "开始日期")
    end = _parse_date(to_date, "结束日期")
    if start:
        query = query.filter(MaterialLog.created_at >= start)
    if end:
        query = query.filter(MaterialLog.created_at <= end)
    total = query.count()
    rows = query.order_by(MaterialLog.created_at.desc(), MaterialLog.id.desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    items = []
    for log, material, category_name, operator_name in rows:
        data = log_dict(log, material, category_name)
        data["operator_name"] = operator_name or ""
        items.append(data)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/stats", summary="库存统计（工作台）")
def stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    total = db.query(func.count(Material.id)).scalar() or 0
    simple = db.query(func.count(Material.id)).filter(Material.mode == "simple").scalar() or 0
    precise = db.query(func.count(Material.id)).filter(Material.mode == "precise").scalar() or 0
    available = db.query(func.count(Material.id)).filter(Material.status == "available").scalar() or 0
    empty = db.query(func.count(Material.id)).filter(Material.status == "empty").scalar() or 0
    warn = (
        db.query(func.count(Material.id))
        .filter(
            Material.mode == "precise",
            Material.min_qty.isnot(None),
            Material.min_qty > 0,
            Material.qty.isnot(None),
            Material.qty <= Material.min_qty,
        )
        .scalar() or 0
    )
    categories = db.query(func.count(Category.id)).scalar() or 0
    logs_total = db.query(func.count(MaterialLog.id)).scalar() or 0
    return {
        "materials": int(total),
        "simple": int(simple),
        "precise": int(precise),
        "available": int(available),
        "empty": int(empty),
        "warnings": int(warn),
        "categories": int(categories),
        "logs": int(logs_total),
    }
