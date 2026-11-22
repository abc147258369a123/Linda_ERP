"""工作台统计：直接从 MariaDB 聚合 KPI 与趋势数据（v1.3.0 修正统计口径）。

统计口径：
- 入库（inbound）：物料建档入库（materials.inbound_at）+ 真实补货流水（material_logs.action='restock'，
  排除新增物料时自动生成的「初始库存」流水，避免重复计数）；
- 领用（outbound）：material_logs.action='borrow'；
- 因此在后台直接批量录入的物料，也能实时反映到趋势图上。
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Material, MaterialLog, User
from ..timeutil import now_local

router = APIRouter(prefix="/api/dashboard", tags=["工作台"])

PERIODS = ("all", "week", "month", "quarter", "half", "year")
PERIOD_LABELS = {
    "all": "近12个月",
    "week": "本周",
    "month": "本月",
    "quarter": "本季度",
    "half": "半年",
    "year": "本年",
}

# 新增物料时后端自动写入的初始库存流水，不应在趋势图里再算一次入库
INITIAL_STOCK_NOTES = ("新增物料初始库存", "历史数据补录：新增物料初始库存")


def _month_start(year: int, month: int) -> datetime:
    while month < 1:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return datetime(year, month, 1)


def _buckets(period: str):
    now = now_local()
    if period in ("week", "month"):
        days = 7 if period == "week" else 30
        today = datetime(now.year, now.month, now.day)
        buckets = []
        labels = []
        for offset in range(days - 1, -1, -1):
            day = today - timedelta(days=offset)
            buckets.append(day.strftime("%Y-%m-%d"))
            labels.append(day.strftime("%m/%d") if period == "week" else f"{day.day}日")
        return buckets, labels, today - timedelta(days=days - 1)

    months = {"quarter": 3, "half": 6, "year": 12, "all": 12}[period]
    buckets = []
    labels = []
    first_month_start = None
    for offset in range(months - 1, -1, -1):
        month_start = _month_start(now.year, now.month - offset)
        if first_month_start is None:
            first_month_start = month_start
        buckets.append(month_start.strftime("%Y-%m"))
        labels.append(f"{month_start.month}月")
    return buckets, labels, first_month_start


@router.get("/summary", summary="工作台 KPI 与出入库趋势（MariaDB 实时聚合）")
def summary(
    period: str = Query(default="month"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    period = period if period in PERIODS else "month"
    buckets, labels, start = _buckets(period)
    by_day = period in ("week", "month")

    inbound = [0 for _ in buckets]
    outbound = [0 for _ in buckets]
    inbound_count = 0
    borrow_count = 0
    new_material_count = 0
    restock_count = 0
    material_ids: set[int] = set()
    bucket_index = {key: index for index, key in enumerate(buckets)}

    def bucket_of(value: datetime):
        key = value.strftime("%Y-%m-%d") if by_day else value.strftime("%Y-%m")
        return bucket_index.get(key)

    # 1) 物料建档入库（直接数据库录入的物料也能统计到）
    created_rows = (
        db.query(Material.id, Material.inbound_at)
        .filter(Material.inbound_at >= start)
        .all()
    )
    for material_id, inbound_at in created_rows:
        index = bucket_of(inbound_at) if inbound_at else None
        if index is None:
            continue
        inbound[index] += 1
        inbound_count += 1
        new_material_count += 1
        material_ids.add(int(material_id))

    # 2) 真实补货 / 领用流水
    logs = (
        db.query(MaterialLog)
        .filter(
            MaterialLog.created_at >= start,
            MaterialLog.action.in_(["restock", "borrow"]),
        )
        .all()
    )
    for log in logs:
        index = bucket_of(log.created_at)
        if log.action == "restock":
            if (log.note or "") in INITIAL_STOCK_NOTES:
                continue  # 建档初始库存已按 materials.inbound_at 统计
            if index is None:
                continue
            inbound[index] += 1
            inbound_count += 1
            restock_count += 1
        else:
            if index is None:
                continue
            outbound[index] += 1
            borrow_count += 1
        material_ids.add(int(log.material_id))

    total_materials = db.query(func.count(Material.id)).scalar() or 0
    return {
        "period": period,
        "period_label": PERIOD_LABELS[period],
        "total_materials": int(total_materials),
        "inbound_count": inbound_count,
        "borrow_count": borrow_count,
        "new_material_count": new_material_count,
        "restock_count": restock_count,
        "material_entries": len(material_ids),
        "labels": labels,
        "inbound": inbound,
        "outbound": outbound,
        "updated_at": now_local().isoformat(sep=" ", timespec="seconds"),
    }
