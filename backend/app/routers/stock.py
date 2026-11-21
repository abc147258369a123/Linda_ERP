"""入库单 / 出库单接口（事务内更新库存并写流水）。"""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin, role_rank
from ..models import Material, MaterialLog, StockInItem, StockInOrder, StockOutItem, StockOutOrder, User
from ..schemas import StockInCreate, StockOutCreate

router = APIRouter(tags=["出入库"])


def _new_order_no(prefix: str) -> str:
    return f"{prefix}-{datetime.now():%Y%m%d}-{uuid4().hex[:8].upper()}"


def _material_or_400(db: Session, material_id: int) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=400, detail=f"物料 #{material_id} 不存在")
    return material


def _load_materials_for_update(db: Session, material_ids: list[int]) -> dict[int, Material]:
    rows = (
        db.query(Material)
        .filter(Material.id.in_(material_ids))
        .with_for_update()
        .all()
    )
    mapping = {material.id: material for material in rows}
    for material_id in material_ids:
        if material_id not in mapping:
            raise HTTPException(status_code=400, detail=f"物料 #{material_id} 不存在")
    return mapping


@router.post("/api/stock-in", status_code=status.HTTP_201_CREATED, summary="创建入库单（补货）")
def create_stock_in(
    payload: StockInCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    material_ids = [item.material_id for item in payload.items]
    materials = _load_materials_for_update(db, material_ids)

    order = StockInOrder(order_no=_new_order_no("IN"), operator_id=actor.id, note=payload.note.strip())
    db.add(order)
    db.flush()

    result_items = []
    for item in payload.items:
        material = materials[item.material_id]
        qty = int(item.qty or 0)
        if material.mode == "precise":
            material.qty = int(material.qty or 0) + qty
        material.status = "available"
        db.add(StockInItem(order_id=order.id, material_id=material.id, qty=qty))
        db.add(MaterialLog(
            material_id=material.id,
            action="restock",
            qty=qty,
            order_no=order.order_no,
            operator_id=actor.id,
            note=payload.note.strip() or "补货入库",
        ))
        result_items.append({
            "material_id": material.id,
            "material_code": material.code,
            "material_name": material.name,
            "qty": qty,
            "qty_after": material.qty,
        })

    db.commit()
    return {
        "id": order.id,
        "order_no": order.order_no,
        "operator_id": actor.id,
        "operator_name": actor.name,
        "note": order.note,
        "created_at": order.created_at.isoformat(sep=" ", timespec="minutes"),
        "items": result_items,
    }


@router.get("/api/stock-in", summary="入库单列表")
def list_stock_in(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(StockInOrder, User.name).join(User, StockInOrder.operator_id == User.id)
    total = query.count()
    rows = query.order_by(StockInOrder.created_at.desc(), StockInOrder.id.desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    items = [
        {
            "id": order.id,
            "order_no": order.order_no,
            "operator_name": operator_name,
            "note": order.note,
            "created_at": order.created_at.isoformat(sep=" ", timespec="minutes"),
        }
        for order, operator_name in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/api/stock-in/{order_id}", summary="入库单详情")
def get_stock_in(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    order = db.get(StockInOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="入库单不存在")
    items = (
        db.query(StockInItem, Material)
        .join(Material, StockInItem.material_id == Material.id)
        .filter(StockInItem.order_id == order.id)
        .all()
    )
    return {
        "id": order.id,
        "order_no": order.order_no,
        "note": order.note,
        "created_at": order.created_at.isoformat(sep=" ", timespec="minutes"),
        "items": [
            {
                "material_id": material.id,
                "material_code": material.code,
                "material_name": material.name,
                "qty": item.qty,
            }
            for item, material in items
        ],
    }


@router.post("/api/stock-out", status_code=status.HTTP_201_CREATED, summary="创建出库单（领用 / 标记为空）")
def create_stock_out(
    payload: StockOutCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if payload.type in ("empty", "adjust") and role_rank(actor.role) < 2:
        raise HTTPException(status_code=403, detail="仅管理员可执行该出库类型")
    if payload.type == "adjust":
        raise HTTPException(status_code=400, detail="暂不支持调整出库，请使用入库单 / 编辑物料")
    if payload.type == "borrow":
        if not payload.borrower.strip():
            raise HTTPException(status_code=400, detail="请填写领用人")
        if not payload.project.strip():
            raise HTTPException(status_code=400, detail="请填写所属项目")

    material_ids = [item.material_id for item in payload.items]
    materials = _load_materials_for_update(db, material_ids)

    order = StockOutOrder(
        order_no=_new_order_no("OUT"),
        type=payload.type,
        borrower=payload.borrower.strip(),
        project=payload.project.strip(),
        operator_id=actor.id,
        note=payload.note.strip(),
    )
    db.add(order)
    db.flush()

    result_items = []
    for item in payload.items:
        material = materials[item.material_id]

        if payload.type == "empty":
            material.status = "empty"
            if material.mode == "precise":
                material.qty = 0
            qty = None
            db.add(StockOutItem(order_id=order.id, material_id=material.id, qty=None))
            db.add(MaterialLog(
                material_id=material.id,
                action="empty",
                qty=None,
                order_no=order.order_no,
                operator_id=actor.id,
                note=payload.note.strip() or "库存清零，手动标记为空",
            ))
        else:
            if material.status == "empty":
                raise HTTPException(status_code=400, detail=f"「{material.name}」当前为空，补货后才能领用")
            qty = item.qty
            if material.mode == "precise":
                if not qty or qty <= 0:
                    raise HTTPException(status_code=400, detail=f"「{material.name}」领用数量必须为正整数")
                if qty > int(material.qty or 0):
                    raise HTTPException(status_code=400, detail=f"「{material.name}」库存不足（当前 {material.qty or 0} 件）")
                material.qty = int(material.qty or 0) - qty
                if material.qty <= 0:
                    material.qty = 0
                    material.status = "empty"
            else:
                qty = None
            db.add(StockOutItem(order_id=order.id, material_id=material.id, qty=qty))
            db.add(MaterialLog(
                material_id=material.id,
                action="borrow",
                qty=qty,
                order_no=order.order_no,
                borrower=payload.borrower.strip(),
                project=payload.project.strip(),
                operator_id=actor.id,
                note=payload.note.strip(),
            ))

        result_items.append({
            "material_id": material.id,
            "material_code": material.code,
            "material_name": material.name,
            "qty": qty,
            "qty_after": material.qty,
            "status": material.status,
        })

    db.commit()
    return {
        "id": order.id,
        "order_no": order.order_no,
        "type": order.type,
        "borrower": order.borrower,
        "project": order.project,
        "operator_id": actor.id,
        "operator_name": actor.name,
        "note": order.note,
        "created_at": order.created_at.isoformat(sep=" ", timespec="minutes"),
        "items": result_items,
    }


@router.get("/api/stock-out", summary="出库单列表")
def list_stock_out(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(StockOutOrder, User.name).join(User, StockOutOrder.operator_id == User.id)
    total = query.count()
    rows = query.order_by(StockOutOrder.created_at.desc(), StockOutOrder.id.desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    items = [
        {
            "id": order.id,
            "order_no": order.order_no,
            "type": order.type,
            "borrower": order.borrower,
            "project": order.project,
            "operator_name": operator_name,
            "note": order.note,
            "created_at": order.created_at.isoformat(sep=" ", timespec="minutes"),
        }
        for order, operator_name in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/api/stock-out/{order_id}", summary="出库单详情")
def get_stock_out(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    order = db.get(StockOutOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="出库单不存在")
    items = (
        db.query(StockOutItem, Material)
        .join(Material, StockOutItem.material_id == Material.id)
        .filter(StockOutItem.order_id == order.id)
        .all()
    )
    return {
        "id": order.id,
        "order_no": order.order_no,
        "type": order.type,
        "borrower": order.borrower,
        "project": order.project,
        "note": order.note,
        "created_at": order.created_at.isoformat(sep=" ", timespec="minutes"),
        "items": [
            {
                "material_id": material.id,
                "material_code": material.code,
                "material_name": material.name,
                "qty": item.qty,
            }
            for item, material in items
        ],
    }
