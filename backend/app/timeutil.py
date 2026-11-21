"""时间工具：统一使用东八区（UTC+8）本地时间写入 DATETIME。

不依赖系统 tzdata（python:slim 镜像可能没有时区库），保证树莓派与前端显示一致。
"""
from __future__ import annotations

from datetime import datetime, timedelta

LOCAL_OFFSET = timedelta(hours=8)


def now_local() -> datetime:
    return datetime.utcnow() + LOCAL_OFFSET
