"""物料分类接口（v1.3.0：树形多级分类）。

- GET    /api/categories        分类列表（扁平 items + 嵌套 tree，含每级物料数 / 子树合计）
- POST   /api/categories        新增分类（仅超级管理员，可指定 parent_id 建子分类）
- PATCH  /api/categories/{id}   重命名（管理员及以上）
- DELETE /api/categories/{id}   删除（仅超级管理员；有子分类或子树内仍有物料时禁止删除）
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin, require_super
from ..models import Category, Material, User
from ..schemas import CategoryCreate, CategoryUpdate
from ..serializers import category_dict

router = APIRouter(prefix="/api/categories", tags=["物料分类"])


def _direct_counts(db: Session) -> dict:
    rows = db.query(Material.category_id, func.count(Material.id)).group_by(Material.category_id).all()
    return {int(category_id): int(count) for category_id, count in rows}


def _build(categories: list[Category], counts: dict):
    """返回 (扁平列表, 根节点列表)；total_count = 自身 + 所有后代分类的物料数。"""
    children_map: dict = {}
    for category in categories:
        children_map.setdefault(category.parent_id, []).append(category)

    flat: list = []

    def walk(category: Category, level: int, path: list) -> dict:
        node = {
            "id": int(category.id),
            "name": category.name,
            "parent_id": category.parent_id,
            "level": level,
            "count": counts.get(int(category.id), 0),
            "children": [],
        }
        for child in children_map.get(category.id, []):
            node["children"].append(walk(child, level + 1, path + [int(category.id)]))
        node["total_count"] = node["count"] + sum(child["total_count"] for child in node["children"])
        node["has_children"] = bool(node["children"])
        flat.append(node)
        return node

    roots = [walk(category, 1, []) for category in children_map.get(None, [])]

    # 防御：父分类已被删除的孤儿节点，提升为一级分类，避免数据“消失”
    known = {item["id"] for item in flat}
    for category in categories:
        if int(category.id) not in known:
            roots.append(walk(category, 1, []))

    flat.sort(key=lambda item: item["id"])
    return flat, roots


def _sibling_duplicated(db: Session, name: str, parent_id, exclude_id=None) -> bool:
    query = db.query(Category).filter(func.lower(Category.name) == name.lower())
    if parent_id is None:
        query = query.filter(Category.parent_id.is_(None))
    else:
        query = query.filter(Category.parent_id == parent_id)
    if exclude_id is not None:
        query = query.filter(Category.id != exclude_id)
    return query.first() is not None


@router.get("", summary="分类列表（树形多级）")
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    categories = db.query(Category).order_by(Category.id.asc()).all()
    flat, roots = _build(categories, _direct_counts(db))
    # 扁平列表用于下拉/筛选（不含 children），树形列表用于分类管理页
    flat_items = [
        {key: value for key, value in item.items() if key != "children"}
        for item in flat
    ]
    return {"items": flat_items, "tree": roots}


@router.post("", status_code=status.HTTP_201_CREATED, summary="新增分类（仅超级管理员）")
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_super),
):
    parent_id = payload.parent_id
    if parent_id is not None and db.get(Category, parent_id) is None:
        raise HTTPException(status_code=400, detail="父分类不存在")
    if _sibling_duplicated(db, payload.name, parent_id):
        raise HTTPException(status_code=409, detail="同级下已存在同名分类")
    category = Category(name=payload.name, parent_id=parent_id)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category_dict(category)


@router.patch("/{category_id}", summary="重命名分类（仅超级管理员）")
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_super),
):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    if _sibling_duplicated(db, payload.name, category.parent_id, exclude_id=category.id):
        raise HTTPException(status_code=409, detail="同级下已存在同名分类")
    category.name = payload.name
    db.commit()
    db.refresh(category)
    return category_dict(category)


@router.delete("/{category_id}", summary="删除分类（仅超级管理员）")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_super),
):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="分类不存在")

    child_count = db.query(func.count(Category.id)).filter(Category.parent_id == category_id).scalar() or 0
    if child_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"该分类下还有 {int(child_count)} 个子分类，请先删除子分类",
        )

    used = db.query(func.count(Material.id)).filter(Material.category_id == category_id).scalar() or 0
    if used > 0:
        raise HTTPException(status_code=409, detail=f"该分类下仍有 {int(used)} 个物料，不能删除")

    db.delete(category)
    db.commit()
    return {"ok": True, "message": "分类已删除"}
