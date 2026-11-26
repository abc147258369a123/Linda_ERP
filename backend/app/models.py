"""SQLAlchemy 模型，与 db/init/01_schema.sql 保持一致。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)

from .db import Base
from .timeutil import now_local


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(100), nullable=False)
    name = Column(String(50), nullable=False)
    role = Column(String(10), nullable=False, default="member", index=True)
    active = Column(Boolean, nullable=False, default=True)
    note = Column(String(100), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now_local)
    updated_at = Column(DateTime, nullable=False, default=now_local, onupdate=now_local)


class Category(Base):
    """物料分类（v1.3.0 起支持树形多级：parent_id 为空表示一级分类）。"""

    __tablename__ = "categories"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(30), nullable=False, index=True)
    parent_id = Column(BigInteger, ForeignKey("categories.id"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=now_local)


class SiteSetting(Base):
    """站点自定义配置（标题 / 社团名 / Logo / 封面文案），仅超级管理员可修改。"""

    __tablename__ = "site_settings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    app_name = Column(String(60), nullable=False, default="硬件物料台账")
    club_name = Column(String(60), nullable=False, default="校内硬件社团")
    logo_image = Column(String(255), nullable=False, default="")
    cover_title = Column(String(80), nullable=False, default="硬件物料台账")
    cover_slogan = Column(String(120), nullable=False, default="轻量化 ERP · 回收元器件统一台账")
    cover_footer = Column(String(255), nullable=False, default="Linda_ERP · 校内硬件社团")
    updated_at = Column(DateTime, nullable=False, default=now_local, onupdate=now_local)


class UiSetting(Base):
    """页面可编辑文案（v1.4.0）：按 (page, field_key) 存储，登录封面等页面文案持久化。"""

    __tablename__ = "ui_settings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    page = Column(String(30), nullable=False, index=True)
    field_key = Column(String(60), nullable=False)
    label = Column(String(60), nullable=False, default="")
    value = Column(String(500), nullable=False, default="")
    updated_at = Column(DateTime, nullable=False, default=now_local, onupdate=now_local)


class Material(Base):
    __tablename__ = "materials"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(60), nullable=False, index=True)
    model = Column(String(80), nullable=False, index=True)
    jlc_no = Column(String(64), nullable=False, default="", comment="嘉立创编号")
    package = Column(String(40), nullable=False, default="")
    spec = Column(String(200), nullable=False, default="")
    brand = Column(String(40), nullable=False, default="")
    mode = Column(String(10), nullable=False, default="precise")
    qty = Column(Integer, nullable=True)
    min_qty = Column(Integer, nullable=True, default=0)
    status = Column(String(10), nullable=False, default="available", index=True)
    cabinet = Column(String(20), nullable=False, default="")
    slot = Column(String(20), nullable=False, default="")
    category_id = Column(BigInteger, ForeignKey("categories.id"), nullable=False, index=True)
    source = Column(String(60), nullable=False, default="")
    inbound_at = Column(DateTime, nullable=False, default=now_local)
    image = Column(String(255), nullable=False, default="")
    note = Column(String(255), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now_local)
    updated_at = Column(DateTime, nullable=False, default=now_local, onupdate=now_local)


class StockInOrder(Base):
    __tablename__ = "stock_in_orders"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_no = Column(String(40), unique=True, nullable=False)
    operator_id = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    note = Column(String(255), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now_local)


class StockInItem(Base):
    __tablename__ = "stock_in_items"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_id = Column(BigInteger, ForeignKey("stock_in_orders.id", ondelete="CASCADE"), nullable=False)
    material_id = Column(BigInteger, ForeignKey("materials.id"), nullable=False)
    qty = Column(Integer, nullable=False)


class StockOutOrder(Base):
    __tablename__ = "stock_out_orders"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_no = Column(String(40), unique=True, nullable=False)
    type = Column(String(10), nullable=False, default="borrow")
    borrower = Column(String(50), nullable=False, default="")
    project = Column(String(60), nullable=False, default="")
    operator_id = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    note = Column(String(255), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now_local)


class StockOutItem(Base):
    __tablename__ = "stock_out_items"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_id = Column(BigInteger, ForeignKey("stock_out_orders.id", ondelete="CASCADE"), nullable=False)
    material_id = Column(BigInteger, ForeignKey("materials.id"), nullable=False)
    qty = Column(Integer, nullable=True)


class MaterialLog(Base):
    __tablename__ = "material_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    material_id = Column(BigInteger, ForeignKey("materials.id"), nullable=False, index=True)
    action = Column(String(10), nullable=False, index=True)
    qty = Column(Integer, nullable=True)
    order_no = Column(String(40), nullable=False, default="")
    borrower = Column(String(50), nullable=False, default="")
    project = Column(String(60), nullable=False, default="")
    operator_id = Column(BigInteger, ForeignKey("users.id"), nullable=True)
    note = Column(String(255), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now_local)


class UserVisit(Base):
    __tablename__ = "user_visits"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=True)
    username = Column(String(50), nullable=False)
    name = Column(String(50), nullable=False)
    role = Column(String(10), nullable=False)
    ip = Column(String(64), nullable=False, default="")
    visited_at = Column(DateTime, nullable=False, default=now_local)
