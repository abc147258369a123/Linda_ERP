"""物料分类接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin, require_super
from ..models import Category, Material
from ..schemas import CategoryCreate, CategoryUpdate
from ..serializers import category_dict

router = APIRouter(prefix="/api/categories", tags=["物料分类"])


def _with_counts(db: Session, category: Category) -> dict:
    count = db.query(func.count(Material.id)).filter(Material.category_id == category.id).scalar() or 0
    data = category_dict(category)
    data["material_count"] = int(count)
    return data


@router.get("", summary="分类列表")
def list_categories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    categories = db.query(Category).order_by(Category.id.asc()).all()
    return {"items": [_with_counts(db, category) for category in categories]}


@router.post("", status_code=status.HTTP_201_CREATED, summary="新增分类（仅超级管理员）")
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    _=Depends(require_super),
):
    exists = db.query(Category).filter(func.lower(Category.name) == payload.name.lower()).first()
    if exists:
        raise HTTPException(status_code=409, detail="分类已存在")
    category = Category(name=payload.name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category_dict(category)


@router.patch("/{category_id}", summary="重命名分类")
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    exists = (
        db.query(Category)
        .filter(func.lower(Category.name) == payload.name.lower(), Category.id != category_id)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="分类名称已存在")
    category.name = payload.name
    db.commit()
    return category_dict(category)


@router.delete("/{category_id}", summary="删除空分类（仅超级管理员）")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_super),
):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    used = db.query(func.count(Material.id)).filter(Material.category_id == category_id).scalar() or 0
    if used > 0:
        raise HTTPException(status_code=409, detail=f"该分类下仍有 {used} 个物料，不能删除")
    db.delete(category)
    db.commit()
    return {"ok": True, "message": "分类已删除"}
