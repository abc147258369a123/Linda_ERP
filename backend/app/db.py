"""数据库引擎与会话（PyMySQL 同步驱动 + SQLAlchemy 2.0，FastAPI 同步端点在线程池执行）。"""
from __future__ import annotations

import logging
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)

DATABASE_URL = (
    "mysql+pymysql://{user}:{password}@{host}:{port}/{name}?charset=utf8mb4"
).format(
    user=quote_plus(settings.db_user),
    password=quote_plus(settings.db_password),
    host=settings.db_host,
    port=settings.db_port,
    name=settings.db_name,
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_recycle=1800,
    echo=False,
    future=True,
    connect_args={"init_command": "SET time_zone = '+08:00'"},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def wait_for_db(max_attempts: int = 30, interval_seconds: float = 2.0) -> None:
    """容器启动时等待 MariaDB 可用（compose 已配置 healthcheck，双保险）。"""
    import time

    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("数据库连接成功（第 %s 次尝试）", attempt)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning("数据库未就绪（第 %s/%s 次）：%s", attempt, max_attempts, exc)
            time.sleep(interval_seconds)
    raise RuntimeError(f"数据库连接失败：{last_error}")
