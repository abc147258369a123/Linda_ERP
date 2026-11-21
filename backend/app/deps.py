"""认证依赖与角色层级校验。"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)

ROLE_RANK = {"member": 1, "admin": 2, "super": 3}


def role_rank(role: str) -> int:
    return ROLE_RANK.get(role, 0)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未登录或登录已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or not credentials.credentials:
        raise unauthorized
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload.get("sub", "0"))
    except Exception:  # noqa: BLE001
        raise unauthorized from None

    user = db.get(User, user_id)
    if user is None or not user.active:
        raise unauthorized
    return user


def require_role(min_role: str):
    """层级校验：super 可满足 admin 要求。"""

    def dependency(user: User = Depends(get_current_user)) -> User:
        if role_rank(user.role) < role_rank(min_role):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return user

    return dependency


require_login = get_current_user
require_admin = require_role("admin")
require_super = require_role("super")
