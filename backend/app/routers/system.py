"""系统接口：健康检查。

健康检查返回后端状态、vault 路径、AI 是否配置、笔记数量等信息，
前端 StatusBar 据此展示连接状态，并每 15 秒轮询一次。
"""
from __future__ import annotations

from fastapi import APIRouter

from .. import vault
from ..config import get_settings

router = APIRouter()


@router.get("/api/health")
def health():
    s = get_settings()
    return {
        "status": "ok",
        "vault": str(s.notes_path),
        "ai_configured": bool(s.ai_api_key),
        "ai_endpoint": s.ai_endpoint,
        "ai_model": s.ai_model,
        "notes_count": len(vault.list_notes()),
    }
