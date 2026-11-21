"""工作台统计：直接从 MariaDB 聚合 KPI 与趋势数据。"""
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

    inbound = [0 for _ in buckets]
    outbound = [0 for _ in buckets]
    inbound_count = 0
    borrow_count = 0

    logs = (
        db.query(MaterialLog)
        .filter(
            MaterialLog.created_at >= start,
            MaterialLog.action.in_(["restock", "borrow"]),
        )
        .all()
    )
    material_ids = set()
    bucket_index = {key: index for index, key in enumerate(buckets)}
    for log in logs:
        material_ids.add(log.material_id)
        key = log.created_at.strftime("%Y-%m-%d") if period in ("week", "month") else log.created_at.strftime("%Y-%m")
        index = bucket_index.get(key)
        if index is None:
            continue
        if log.action == "restock":
            inbound[index] += 1
            inbound_count += 1
        elif log.action == "borrow":
            outbound[index] += 1
            borrow_count += 1

    total_materials = db.query(func.count(Material.id)).scalar() or 0
    return {
        "period": period,
        "period_label": PERIOD_LABELS[period],
        "total_materials": int(total_materials),
        "inbound_count": inbound_count,
        "borrow_count": borrow_count,
        "material_entries": len(material_ids),
        "labels": labels,
        "inbound": inbound,
        "outbound": outbound,
        "updated_at": now_local().isoformat(sep=" ", timespec="seconds"),
    }
