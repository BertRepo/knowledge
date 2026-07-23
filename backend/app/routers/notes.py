"""Markdown 笔记的读取 / 列表 / 关联链接接口。"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException

from .. import vault
from ..models import LinkRequest, LinkResponse, NoteFull, NoteMeta, NoteUpdateRequest

router = APIRouter()


@router.get("/api/notes", response_model=List[NoteMeta])
def list_notes():
    """列出 vault 全部笔记（按修改时间倒序）。"""
    return vault.list_notes()


@router.get("/api/notes/{filename}", response_model=NoteFull)
def get_note(filename: str):
    """读取单篇笔记完整内容。"""
    note = vault.read_note(filename)
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return note


@router.put("/api/notes/{filename}", response_model=NoteFull)
def update_note(filename: str, req: NoteUpdateRequest):
    """在线编辑笔记：替换正文，保留 frontmatter。

    前端「编辑」按钮调用，编辑后返回更新后的完整笔记，
    无需重新请求即可刷新阅读视图。
    """
    try:
        vault.update_note_body(filename, req.body)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    note = vault.read_note(filename)
    if not note:  # 理论不会到这，刚写完
        raise HTTPException(status_code=500, detail="写入后读取失败")
    return note


@router.post("/api/link", response_model=LinkResponse)
def link(req: LinkRequest):
    """给指定笔记追加 [[wikilink]] 关联，自动去重。"""
    try:
        added, body = vault.append_links(req.filename, req.targets)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return LinkResponse(filename=req.filename, added=added, body=body)
