"""图片上传（仅管理员）：保存到 UPLOAD_DIR，由 Nginx /uploads/ 或后端静态目录访问。"""
from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..config import settings
from ..deps import require_admin
from ..models import User

router = APIRouter(prefix="/api/uploads", tags=["附件"])

ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


@router.post("", summary="上传物料图片")
async def upload_image(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 png / jpg / webp / gif / svg 图片")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"图片不能超过 {settings.max_upload_mb}MB")

    original = Path(file.filename or "").name
    original = re.sub(r"[^A-Za-z0-9_.-]", "_", original)
    ext = ALLOWED_TYPES[content_type]
    filename = f"{uuid4().hex}{ext}"

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    (upload_dir / filename).write_bytes(content)

    return {
        "url": f"/uploads/{filename}",
        "filename": filename,
        "original_name": original,
        "size": len(content),
        "content_type": content_type,
    }
