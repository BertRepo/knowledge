"""系统接口：健康检查。

健康检查返回后端状态、笔记目录、LLM 配置情况、笔记数量等信息，
前端 StatusBar 据此展示连接状态，并每 15 秒轮询一次。
"""
from __future__ import annotations

from fastapi import APIRouter

from .. import providers, vault
from ..config import get_settings

router = APIRouter()


@router.get("/api/health")
def health():
    s = get_settings()
    return {
        "status": "ok",
        "notes_dir": str(s.notes_path),
        "llm_provider": s.llm_provider,
        "llm_configured": s.llm_configured,
        "llm_model": s.llm_model if s.llm_provider == "online" else "local",
        "local_ready": providers.is_local_ready(),
        "notes_count": len(vault.list_notes()),
    }
