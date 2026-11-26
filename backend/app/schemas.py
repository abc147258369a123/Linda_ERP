"""Pydantic 请求/响应模型（输入校验）。"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

RoleName = Literal["super", "admin", "member"]
ModeName = Literal["simple", "precise"]
StatusName = Literal["available", "empty"]


def _check_bcrypt_bytes(value: str) -> str:
    if len(value.encode("utf-8")) > 72:
        raise ValueError("密码不能超过 72 字节")
    return value


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_bytes(cls, value: str) -> str:
        return _check_bcrypt_bytes(value)


class BackupConfigUpdate(BaseModel):
    """数据库备份仓库配置：只保存独立备份仓库 URL，不保存任何凭据。"""

    repo_url: str = Field(default="", max_length=500)


class BackupPushRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=120)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=72)
    name: str = Field(min_length=1, max_length=50)
    role: RoleName = "member"
    note: str = Field(default="", max_length=100)

    @field_validator("password")
    @classmethod
    def validate_password_bytes(cls, value: str) -> str:
        return _check_bcrypt_bytes(value)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=20, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: Optional[str] = Field(default=None, min_length=8, max_length=72)
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    role: Optional[RoleName] = None
    note: Optional[str] = Field(default=None, max_length=100)
    active: Optional[bool] = None

    @field_validator("password")
    @classmethod
    def validate_password_bytes(cls, value: Optional[str]) -> Optional[str]:
        return _check_bcrypt_bytes(value) if value is not None else value


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    parent_id: Optional[int] = Field(default=None, gt=0)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=30)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class SiteSettingsUpdate(BaseModel):
    app_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    club_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    logo_image: Optional[str] = Field(default=None, max_length=255)
    cover_title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    cover_slogan: Optional[str] = Field(default=None, max_length=120)
    cover_footer: Optional[str] = Field(default=None, max_length=255)

    @field_validator("app_name", "club_name", "cover_title", "cover_slogan", "cover_footer")
    @classmethod
    def strip_text(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if isinstance(value, str) else value


class UiSettingsUpdate(BaseModel):
    """页面文案批量修改：values 为 {field_key: value}。"""

    values: dict[str, str] = Field(default_factory=dict)


class MaterialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    model: str = Field(min_length=1, max_length=80)
    jlc_no: str = Field(default="", max_length=64)
    package: str = Field(default="", max_length=40)
    spec: str = Field(default="", max_length=200)
    brand: str = Field(default="", max_length=40)
    mode: ModeName = "precise"
    qty: Optional[int] = Field(default=0, ge=0)
    min_qty: Optional[int] = Field(default=0, ge=0)
    cabinet: str = Field(default="", max_length=20)
    slot: str = Field(default="", max_length=20)
    category_id: int = Field(gt=0)
    source: str = Field(default="", max_length=60)
    inbound_at: Optional[datetime] = None
    image: str = Field(default="", max_length=255)
    note: str = Field(default="", max_length=255)


class MaterialUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    model: Optional[str] = Field(default=None, min_length=1, max_length=80)
    jlc_no: Optional[str] = Field(default=None, max_length=64)
    package: Optional[str] = Field(default=None, max_length=40)
    spec: Optional[str] = Field(default=None, max_length=200)
    brand: Optional[str] = Field(default=None, max_length=40)
    mode: Optional[ModeName] = None
    qty: Optional[int] = Field(default=None, ge=0)
    min_qty: Optional[int] = Field(default=None, ge=0)
    cabinet: Optional[str] = Field(default=None, max_length=20)
    slot: Optional[str] = Field(default=None, max_length=20)
    category_id: Optional[int] = Field(default=None, gt=0)
    source: Optional[str] = Field(default=None, max_length=60)
    inbound_at: Optional[datetime] = None
    image: Optional[str] = Field(default=None, max_length=255)
    note: Optional[str] = Field(default=None, max_length=255)


class MaterialStatusUpdate(BaseModel):
    status: StatusName


class StockItem(BaseModel):
    material_id: int = Field(gt=0)
    qty: Optional[int] = Field(default=None, ge=0)


class StockInCreate(BaseModel):
    note: str = Field(default="", max_length=255)
    items: list[StockItem] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def validate_items(cls, items: list[StockItem]) -> list[StockItem]:
        for item in items:
            if not item.qty or item.qty <= 0:
                raise ValueError("入库数量必须为正整数")
        return items


class StockOutCreate(BaseModel):
    type: Literal["borrow", "empty", "adjust"] = "borrow"
    borrower: str = Field(default="", max_length=50)
    project: str = Field(default="", max_length=60)
    note: str = Field(default="", max_length=255)
    items: list[StockItem] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def validate_items(cls, items: list[StockItem]) -> list[StockItem]:
        if not items:
            raise ValueError("出库明细不能为空")
        return items
