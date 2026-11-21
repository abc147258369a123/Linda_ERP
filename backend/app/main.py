"""Linda_ERP 后端入口（FastAPI + Uvicorn，ASGI）。"""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db, wait_for_db
from .routers import auth, categories, inventory, materials, stock, uploads, users

LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def setup_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    try:
        log_dir = Path(settings.log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        handlers.append(RotatingFileHandler(
            log_dir / "backend.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
        ))
    except OSError:
        pass
    logging.basicConfig(level=level, format=LOG_FORMAT, handlers=handlers, force=True)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


setup_logging()
logger = logging.getLogger("linda_erp")

# 静态附件目录（Nginx 生产环境会直接代理 /uploads；容器内直连时也提供）
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("启动 Linda_ERP 后端 v%s（环境=%s）", settings.app_version, settings.app_env)
    wait_for_db()
    logger.info("服务就绪：http://%s:%s", settings.app_host, settings.app_port)
    yield
    logger.info("Linda_ERP 后端停止")


app = FastAPI(
    title="Linda_ERP API",
    description="硬件社团物料台账系统后端：登录鉴权、物料档案、入库单、出库单、库存查询。",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    debug=False,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(categories.router)
app.include_router(materials.router)
app.include_router(stock.router)
app.include_router(inventory.router)
app.include_router(uploads.router)

app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/api/health", tags=["健康检查"], summary="健康检查（含数据库）")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "service": "linda-erp-backend",
        "version": settings.app_version,
        "environment": settings.app_env,
        "database": "ok",
    }


@app.get("/health", include_in_schema=False)
def health_compat(db: Session = Depends(get_db)):
    return health(db)


@app.get("/api", tags=["健康检查"], summary="服务信息")
def api_root():
    return {
        "name": "Linda_ERP API",
        "version": settings.app_version,
        "docs": "/api/docs",
        "openapi": "/api/openapi.json",
    }
