"""一次性会话历史接口（数据存在系统临时目录）。"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException

from .. import session
from ..models import ClearResponse, SessionSummary

router = APIRouter()


@router.get("/api/sessions", response_model=List[SessionSummary])
def list_sessions():
    """列出全部会话快照（最新在前）。"""
    return session.list_sessions()


@router.get("/api/sessions/{file}")
def get_session(file: str):
    """读取单个会话的完整快照。"""
    data = session.get_session(file)
    if data is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return data


@router.delete("/api/sessions", response_model=ClearResponse)
def clear_sessions():
    """清空全部会话快照，返回删除数量。"""
    return ClearResponse(cleared=session.clear_sessions())
