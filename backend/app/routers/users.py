"""用户管理接口（管理员及以上；管理员仅可维护普通成员）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin, require_super, role_rank
from ..models import StockInOrder, StockOutOrder, User, UserVisit
from ..schemas import UserCreate, UserUpdate
from ..security import hash_password
from ..serializers import user_dict, visit_dict

router = APIRouter(prefix="/api", tags=["用户"])


def _privileged_count(db: Session) -> int:
    return db.query(func.count(User.id)).filter(User.role.in_(["admin", "super"])).scalar() or 0


def _super_count(db: Session) -> int:
    return db.query(func.count(User.id)).filter(User.role == "super").scalar() or 0


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return user


def _assert_can_manage(actor: User, target: User) -> None:
    if actor.role == "super":
        return
    if target.role != "member":
        raise HTTPException(status_code=403, detail="仅超级管理员可管理管理员及以上账号")


@router.get("/users", summary="用户列表")
def list_users(
    q: str = Query(default="", max_length=50),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(User)
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(User.username.like(like), User.name.like(like)))
    total = query.count()
    users = (
        query.order_by(User.role.desc(), User.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": [user_dict(user) for user in users], "total": total, "page": page, "page_size": page_size}


@router.post("/users", status_code=status.HTTP_201_CREATED, summary="新增用户")
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    if actor.role != "super" and payload.role != "member":
        raise HTTPException(status_code=403, detail="管理员仅可创建普通成员账号")
    exists = db.query(User).filter(func.lower(User.username) == payload.username.lower()).first()
    if exists:
        raise HTTPException(status_code=409, detail="账号已存在")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        name=payload.name.strip(),
        role=payload.role,
        note=payload.note.strip(),
        active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_dict(user)


@router.patch("/users/{user_id}", summary="编辑用户 / 重置密码")
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    target = _get_user(db, user_id)
    _assert_can_manage(actor, target)

    data = payload.model_dump(exclude_unset=True)
    if data.get("username") is not None:
        exists = (
            db.query(User)
            .filter(func.lower(User.username) == str(data["username"]).lower(), User.id != target.id)
            .first()
        )
        if exists:
            raise HTTPException(status_code=409, detail="账号已存在")
        target.username = data["username"]
    if data.get("name") is not None:
        target.name = str(data["name"]).strip()
    if data.get("note") is not None:
        target.note = str(data["note"]).strip()
    if data.get("active") is not None:
        if target.id == actor.id and data["active"] is False:
            raise HTTPException(status_code=400, detail="不能停用当前登录账号")
        target.active = bool(data["active"])
    if data.get("password"):
        target.password_hash = hash_password(str(data["password"]))
    if data.get("role") is not None and data["role"] != target.role:
        new_role = data["role"]
        if actor.role != "super":
            raise HTTPException(status_code=403, detail="仅超级管理员可分配管理员及以上角色")
        if target.id == actor.id and role_rank(new_role) < role_rank(target.role):
            raise HTTPException(status_code=400, detail="不能降低当前登录账号自身的角色")
        if target.role == "super" and new_role != "super" and _super_count(db) <= 1:
            raise HTTPException(status_code=400, detail="至少需要保留一名超级管理员")
        if role_rank(target.role) >= 2 and role_rank(new_role) < 2 and _privileged_count(db) <= 1:
            raise HTTPException(status_code=400, detail="至少需要保留一名管理员")
        target.role = new_role

    db.commit()
    db.refresh(target)
    return user_dict(target)


@router.delete("/users/{user_id}", summary="删除用户")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    target = _get_user(db, user_id)
    _assert_can_manage(actor, target)
    if target.id == actor.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    if target.role == "super" and _super_count(db) <= 1:
        raise HTTPException(status_code=400, detail="至少需要保留一名超级管理员")
    if role_rank(target.role) >= 2 and _privileged_count(db) <= 1:
        raise HTTPException(status_code=400, detail="至少需要保留一名管理员")

    # 经办过出入库的账号保留历史单据，不做物理删除
    has_orders = (
        db.query(StockInOrder.id).filter(StockInOrder.operator_id == target.id).first()
        or db.query(StockOutOrder.id).filter(StockOutOrder.operator_id == target.id).first()
    )
    if has_orders:
        raise HTTPException(status_code=409, detail="该账号存在出入库经办记录，不能删除，可改为停用账号")
    db.delete(target)
    db.commit()
    return {"ok": True, "message": "用户已删除"}


@router.get("/visits", summary="成员访问记录（超级管理员）")
def list_visits(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_super),
):
    query = db.query(UserVisit)
    total = query.count()
    visits = query.order_by(UserVisit.visited_at.desc(), UserVisit.id.desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [visit_dict(visit) for visit in visits], "total": total, "page": page, "page_size": page_size}
