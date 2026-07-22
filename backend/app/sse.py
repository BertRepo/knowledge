"""SSE（Server-Sent Events）消息格式化工具。

把事件名 + 数据对象格式化成 SSE 文本帧。多个路由都要用，
统一放这里，避免到处重复同一段 f-string（也便于以后统一加心跳/重连等逻辑）。
"""
from __future__ import annotations

import json
from typing import Any


def sse(event: str, data: Any) -> str:
    """格式化一条 SSE 事件帧。

    SSE 约定：事件由若干行组成，空行（两个换行）结尾表示一帧结束。
    浏览器的 EventSource 与手写的 fetch + ReadableStream 都能解析这个格式。
    data 字段序列化成 JSON（中文不转义，保证可读）。
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
