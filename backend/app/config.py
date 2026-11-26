"""应用配置：全部从环境变量读取（Docker env_file / docker-compose）。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    return value if value is not None else default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_list(name: str, default: str = "") -> List[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Linda_ERP"
    app_version: str = _env("APP_VERSION", "1.7.0")
    app_env: str = _env("APP_ENV", "production")
    app_host: str = _env("APP_HOST", "127.0.0.1")
    app_port: int = _env_int("APP_PORT", 8000)

    db_host: str = _env("DB_HOST", "127.0.0.1")
    db_port: int = _env_int("DB_PORT", 3306)
    db_name: str = _env("DB_NAME", "linda_erp")
    db_user: str = _env("DB_USER", "linda_erp")
    db_password: str = _env("DB_PASSWORD", "")
    db_pool_size: int = _env_int("DB_POOL_SIZE", 10)
    db_max_overflow: int = _env_int("DB_MAX_OVERFLOW", 20)

    jwt_secret: str = _env("JWT_SECRET", "")
    jwt_algorithm: str = _env("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = _env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 720)

    cors_origins: List[str] = field(default_factory=lambda: _env_list("CORS_ORIGINS", ""))
    log_level: str = _env("LOG_LEVEL", "INFO")
    log_dir: str = _env("LOG_DIR", "/app/logs")
    upload_dir: str = _env("UPLOAD_DIR", "/app/uploads")
    max_upload_mb: int = _env_int("MAX_UPLOAD_MB", 10)
    tz: str = _env("TZ", "Asia/Shanghai")


settings = Settings()

if settings.app_env == "production":
    # 生产模式必须显式配置密钥，避免默认弱口令
    if not settings.jwt_secret or settings.jwt_secret.startswith("change_me"):
        raise RuntimeError("生产模式必须设置安全的 JWT_SECRET（请参考 .env.example）")
    if not settings.db_password or settings.db_password.startswith("change_me"):
        raise RuntimeError("生产模式必须设置安全的 DB_PASSWORD（请参考 .env.example）")


