"""物料档案接口。"""
from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin
from ..models import Category, Material, MaterialLog, User
from ..schemas import MaterialCreate, MaterialStatusUpdate, MaterialUpdate
from ..serializers import log_dict, material_dict
from ..timeutil import now_local

router = APIRouter(prefix="/api/materials", tags=["物料档案"])


def _get_category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=400, detail="物料分类不存在")
    return category


def _category_name(db: Session, category_id: int) -> str:
    category = db.get(Category, category_id)
    return category.name if category else ""


def _apply_filters(query, q: str, mode: str, status_value: str, category_id: int | None):
    keyword = (q or "").strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                Material.name.like(like),
                Material.model.like(like),
                Material.package.like(like),
                Material.brand.like(like),
                Material.source.like(like),
                Material.cabinet.like(like),
                Material.slot.like(like),
                Material.code.like(like),
            )
        )
    if mode in ("simple", "precise"):
        query = query.filter(Material.mode == mode)
    if status_value in ("available", "empty"):
        query = query.filter(Material.status == status_value)
    if category_id:
        query = query.filter(Material.category_id == category_id)
    return query


def _duplicated(db: Session, name: str, model: str, exclude_id: int | None = None) -> bool:
    query = db.query(Material).filter(
        func.lower(Material.name) == name.lower(),
        func.lower(Material.model) == model.lower(),
    )
    if exclude_id:
        query = query.filter(Material.id != exclude_id)
    return query.first() is not None


@router.get("", summary="物料列表（搜索 / 筛选 / 分页）")
def list_materials(
    q: str = Query(default="", max_length=60),
    mode: str = Query(default=""),
    status_value: str = Query(default="", alias="status"),
    category_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(Material, Category.name).join(Category, Material.category_id == Category.id)
    query = _apply_filters(query, q, mode, status_value, category_id)
    total = query.count()
    rows = (
        query.order_by(Material.updated_at.desc(), Material.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [material_dict(material, category_name) for material, category_name in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{material_id}", summary="物料详情")
def get_material(
    material_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="物料不存在")
    return material_dict(material, _category_name(db, material.category_id))


@router.post("", status_code=status.HTTP_201_CREATED, summary="新增物料档案")
def create_material(
    payload: MaterialCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    _get_category(db, payload.category_id)
    if _duplicated(db, payload.name.strip(), payload.model.strip()):
        raise HTTPException(status_code=409, detail="已存在同名同型号的物料档案")

    precise = payload.mode == "precise"
    qty = int(payload.qty or 0) if precise else None
    min_qty = int(payload.min_qty or 0) if precise else None
    material = Material(
        code=f"TMP-{uuid4().hex[:12].upper()}",
        name=payload.name.strip(),
        model=payload.model.strip(),
        package=payload.package.strip(),
        spec=payload.spec.strip(),
        brand=payload.brand.strip(),
        mode=payload.mode,
        qty=qty,
        min_qty=min_qty,
        status="empty" if (precise and qty == 0) else "available",
        cabinet=payload.cabinet.strip(),
        slot=payload.slot.strip(),
        category_id=payload.category_id,
        source=payload.source.strip(),
        inbound_at=payload.inbound_at or now_local(),
        image=payload.image.strip(),
        note=payload.note.strip(),
    )
    db.add(material)
    db.flush()
    material.code = f"M-{material.id:04d}"
    if precise and qty and qty > 0:
        db.add(MaterialLog(
            material_id=material.id,
            action="adjust",
            qty=qty,
            note="建档初始库存",
            operator_id=actor.id,
        ))
    db.commit()
    db.refresh(material)
    return material_dict(material, _category_name(db, material.category_id))


@router.patch("/{material_id}", summary="编辑物料档案")
def update_material(
    material_id: int,
    payload: MaterialUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="物料不存在")

    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data:
        _get_category(db, int(data["category_id"]))
    next_name = data.get("name") or material.name
    next_model = data.get("model") or material.model
    if _duplicated(db, str(next_name).strip(), str(next_model).strip(), exclude_id=material.id):
        raise HTTPException(status_code=409, detail="已存在同名同型号的物料档案")

    for field in ("name", "model", "package", "spec", "brand", "cabinet", "slot", "source", "image", "note"):
        if field in data and data[field] is not None:
            setattr(material, field, str(data[field]).strip())
    if "category_id" in data and data["category_id"] is not None:
        material.category_id = int(data["category_id"])
    if "mode" in data and data["mode"]:
        material.mode = data["mode"]
    if "inbound_at" in data and data["inbound_at"] is not None:
        material.inbound_at = data["inbound_at"]

    if material.mode == "simple":
        material.qty = None
        material.min_qty = None
        material.status = "available"
    else:
        qty = data.get("qty", material.qty)
        min_qty = data.get("min_qty", material.min_qty)
        material.qty = max(0, int(qty or 0))
        material.min_qty = max(0, int(min_qty or 0))
        material.status = "empty" if material.qty <= 0 else "available"

    db.commit()
    db.refresh(material)
    return material_dict(material, _category_name(db, material.category_id))


@router.patch("/{material_id}/status", summary="修改物料状态（有货 / 空）")
def update_material_status(
    material_id: int,
    payload: MaterialStatusUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="物料不存在")

    if payload.status == "available" and material.mode == "precise" and (material.qty or 0) <= 0:
        raise HTTPException(status_code=400, detail="精确计数物料库存为 0，请先通过入库单补货")

    if payload.status == material.status:
        return {"ok": True, "message": "状态未变化", "material": material_dict(material, _category_name(db, material.category_id))}

    material.status = payload.status
    if payload.status == "empty":
        if material.mode == "precise":
            material.qty = 0
        db.add(MaterialLog(
            material_id=material.id,
            action="empty",
            qty=None,
            note="库存清零，手动标记为空",
            operator_id=actor.id,
        ))
    db.commit()
    db.refresh(material)
    return {"ok": True, "material": material_dict(material, _category_name(db, material.category_id))}


@router.get("/{material_id}/logs", summary="物料历史流水")
def material_logs(
    material_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="物料不存在")
    query = db.query(MaterialLog).filter(MaterialLog.material_id == material_id)
    total = query.count()
    logs = query.order_by(MaterialLog.created_at.desc(), MaterialLog.id.desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    category_name = _category_name(db, material.category_id)
    return {
        "items": [log_dict(log, material, category_name) for log in logs],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
