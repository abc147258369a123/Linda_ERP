"""认证接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import User, UserVisit
from ..schemas import ChangePasswordRequest, LoginRequest
from ..security import create_access_token, hash_password, verify_password
from ..serializers import user_dict

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", summary="登录获取 JWT")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username.strip()).first()
    if user is None or not user.active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")

    ip = request.client.host if request.client else ""
    db.add(UserVisit(user_id=user.id, username=user.username, name=user.name, role=user.role, ip=ip))
    db.commit()

    token = create_access_token(user.id, user.role, user.name)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": user_dict(user),
    }


@router.get("/me", summary="当前登录用户")
def me(current: User = Depends(get_current_user)):
    return user_dict(current)


@router.post("/change-password", summary="修改自己的密码")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    user = db.get(User, current.id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与原密码相同")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True, "message": "密码已修改"}
