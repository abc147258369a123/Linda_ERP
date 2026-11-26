"""物料档案接口。"""
from __future__ import annotations

import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin, require_super
from ..models import Category, Material, MaterialLog, StockInItem, StockInOrder, User
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


# ---------------------------------------------------------------------------
# v1.5.0 搜索：精确匹配（默认）/ 模糊包含
# ---------------------------------------------------------------------------
# 精确模式把字段文本拆成"整词"再与关键词做全等比较：
#   1K  → 名称「1K电阻」去掉常见物料后缀后 = 「1K」→ 命中；
#   1K  → 「91K电阻」「51K电阻」的整词是「91K」「51K」→ 不命中；
#   0603 → 封装「贴片0603」去掉「贴片」前缀 = 「0603」→ 命中；
#   电阻 → 分类名「电阻」整词 → 命中该分类下全部物料。
EXACT_SUFFIXES = (
    "电阻", "电容", "电感", "二极管", "三极管", "场效应管", "稳压器", "芯片", "模块",
    "传感器", "连接器", "插座", "插头", "开关", "按键", "晶振", "排针", "排母",
    "保险丝", "电位器", "光耦", "继电器", "变压器", "蜂鸣器", "电池", "风扇", "电机",
)
EXACT_PREFIXES = ("贴片", "直插", "贴片式", "插件")
_SPLIT_RE = re.compile(r"[\s·/,+\-_|（）()\[\]【】]+")


def _exact_tokens(value: str) -> set[str]:
    text = (value or "").strip().lower()
    if not text:
        return set()
    tokens = {text}
    for suffix in EXACT_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            tokens.add(text[: -len(suffix)])
    for prefix in EXACT_PREFIXES:
        if text.startswith(prefix) and len(text) > len(prefix):
            tokens.add(text[len(prefix):])
    for part in _SPLIT_RE.split(text):
        if part:
            tokens.add(part)
    return tokens


def _category_paths(db: Session) -> dict[int, str]:
    """分类 id → 完整路径（如 电阻 / 贴片电阻 / 0603），用于精确搜索按分类路径命中。"""
    rows = db.query(Category.id, Category.name, Category.parent_id).all()
    name_map = {int(cid): (name, parent_id) for cid, name, parent_id in rows}
    cache: dict[int, str] = {}

    def path_of(category_id, depth=0) -> str:
        if category_id is None or depth > 16:
            return ""
        key = int(category_id)
        if key in cache:
            return cache[key]
        name, parent_id = name_map.get(key, ("", None))
        parent_path = path_of(parent_id, depth + 1) if parent_id is not None else ""
        cache[key] = (parent_path + " / " + name).strip(" /") if parent_path else name
        return cache[key]

    for cid in name_map:
        path_of(cid)
    return cache


def _material_exact_match(keyword: str, material: Material, category_path: str) -> bool:
    kw = keyword.strip().lower()
    if not kw:
        return True
    fields = (
        material.code,
        material.name,
        material.model,
        material.jlc_no,
        material.package,
        material.spec,
        material.brand,
        material.cabinet,
        material.slot,
        material.source,
        material.note,
        category_path,
    )
    for field in fields:
        if kw in _exact_tokens(field):
            return True
    return False


def _apply_scope_filters(query, mode: str, status_value: str, category_id: int | None):
    if mode in ("simple", "precise"):
        query = query.filter(Material.mode == mode)
    if status_value in ("available", "empty"):
        query = query.filter(Material.status == status_value)
    if category_id:
        query = query.filter(Material.category_id == category_id)
    return query


def _apply_contains_keyword(query, keyword: str):
    like = f"%{keyword}%"
    return query.filter(
        or_(
            Material.name.like(like),
            Material.model.like(like),
            Material.jlc_no.like(like),
            Material.package.like(like),
            Material.brand.like(like),
            Material.source.like(like),
            Material.cabinet.like(like),
            Material.slot.like(like),
            Material.code.like(like),
        )
    )


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
    q: str = Query(default="", max_length=80),
    match: str = Query(default="contains", pattern="^(exact|contains)$", description="搜索模式：exact 精确匹配 / contains 模糊包含"),
    mode: str = Query(default=""),
    status_value: str = Query(default="", alias="status"),
    category_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(Material, Category.name).join(Category, Material.category_id == Category.id)
    query = _apply_scope_filters(query, mode, status_value, category_id)
    keyword = (q or "").strip()

    if keyword and match == "exact":
        # 精确匹配：物料总量级很小（数百条），先按筛选条件取全量再逐条做整词比对后分页
        ordered = query.order_by(Material.updated_at.desc(), Material.id.desc()).all()
        paths = _category_paths(db)
        matched = [
            row for row in ordered
            if _material_exact_match(keyword, row[0], paths.get(int(row[0].category_id), row[1]))
        ]
        total = len(matched)
        start = (page - 1) * page_size
        rows = matched[start:start + page_size]
    else:
        if keyword:
            query = _apply_contains_keyword(query, keyword)
        total = query.count()
        rows = (
            query.order_by(Material.updated_at.desc(), Material.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    # 领用次数（v1.4.0：列表排序 / 展示用，实时聚合 material_logs）
    material_ids = [material.id for material, _ in rows]
    borrow_counts: dict[int, int] = {}
    if material_ids:
        borrow_counts = {
            int(mid): int(count)
            for mid, count in db.query(MaterialLog.material_id, func.count(MaterialLog.id))
            .filter(MaterialLog.material_id.in_(material_ids), MaterialLog.action == "borrow")
            .group_by(MaterialLog.material_id)
            .all()
        }
    items = [
        material_dict(material, category_name, borrow_counts.get(int(material.id), 0))
        for material, category_name in rows
    ]
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
    borrow_count = (
        db.query(func.count(MaterialLog.id))
        .filter(MaterialLog.material_id == material_id, MaterialLog.action == "borrow")
        .scalar()
        or 0
    )
    return material_dict(material, _category_name(db, material.category_id), int(borrow_count))


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
        jlc_no=payload.jlc_no.strip(),
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

    # 新增物料时填写的初始库存，同时生成一张入库单与补货流水，
    # 保证「物料总览」「出入库单」「领用日志」三处数据一致。
    if precise and qty and qty > 0:
        order = StockInOrder(
            order_no=f"IN-{now_local():%Y%m%d}-{uuid4().hex[:8].upper()}",
            operator_id=actor.id,
            note="新增物料初始库存",
        )
        db.add(order)
        db.flush()
        db.add(StockInItem(order_id=order.id, material_id=material.id, qty=qty))
        db.add(MaterialLog(
            material_id=material.id,
            action="restock",
            qty=qty,
            order_no=order.order_no,
            note="新增物料初始库存",
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

    for field in ("name", "model", "jlc_no", "package", "spec", "brand", "cabinet", "slot", "source", "image", "note"):
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


@router.delete("/{material_id}", summary="删除物料档案（仅超级管理员）")
def delete_material(
    material_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_super),
):
    """删除物料档案及其关联流水 / 出入库明细。

    表结构里 material_logs、stock_in_items、stock_out_items 对 materials 都是
    ON DELETE RESTRICT，因此必须在同一事务内先清理关联记录，再删除物料本身，
    并顺手清掉删除明细后变成空单的出入库单，避免出现「空单据」。
    """
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="物料不存在")

    code = material.code
    name = material.name

    log_count = db.query(MaterialLog).filter(MaterialLog.material_id == material_id).delete(
        synchronize_session=False
    )
    in_order_ids = [
        row[0]
        for row in db.query(StockInItem.order_id).filter(StockInItem.material_id == material_id).all()
    ]
    in_item_count = db.query(StockInItem).filter(StockInItem.material_id == material_id).delete(
        synchronize_session=False
    )
    out_order_ids = [
        row[0]
        for row in db.query(StockOutItem.order_id).filter(StockOutItem.material_id == material_id).all()
    ]
    out_item_count = db.query(StockOutItem).filter(StockOutItem.material_id == material_id).delete(
        synchronize_session=False
    )

    in_orders_deleted = 0
    for order_id in set(in_order_ids):
        remaining = db.query(func.count(StockInItem.id)).filter(StockInItem.order_id == order_id).scalar() or 0
        if remaining == 0:
            in_orders_deleted += db.query(StockInOrder).filter(StockInOrder.id == order_id).delete(
                synchronize_session=False
            )

    out_orders_deleted = 0
    for order_id in set(out_order_ids):
        remaining = db.query(func.count(StockOutItem.id)).filter(StockOutItem.order_id == order_id).scalar() or 0
        if remaining == 0:
            out_orders_deleted += db.query(StockOutOrder).filter(StockOutOrder.id == order_id).delete(
                synchronize_session=False
            )

    db.delete(material)
    db.commit()

    return {
        "ok": True,
        "message": f"物料 {code} 已删除",
        "material": {"id": material_id, "code": code, "name": name},
        "deleted": {
            "logs": int(log_count),
            "stock_in_items": int(in_item_count),
            "stock_out_items": int(out_item_count),
            "stock_in_orders": int(in_orders_deleted),
            "stock_out_orders": int(out_orders_deleted),
        },
    }


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
