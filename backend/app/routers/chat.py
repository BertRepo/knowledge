"""对话区接口：基于当前笔记做多轮追问，流式返回。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import ai, chat
from ..models import ChatRequest
from ..sse import sse

router = APIRouter()


@router.post("/api/chat/stream")
def chat_stream(req: ChatRequest):
    """流式对话接口：SSE 推送回答增量。

    事件类型：
        token -- {delta: "增量文本"}  AI 逐字吐出的回答
        done  -- {}                   回答结束
        error -- {detail: "错误信息"}  失败

    上下文由后端构建：当前笔记全文 + 它关联到的笔记。
    前端只传 note_filename 和对话历史，不用管上下文拼装。
    """
    def event_stream():
        try:
            messages = [m.model_dump() for m in req.messages]
            for delta in chat.chat_stream(req.note_filename, messages):
                yield sse("token", {"delta": delta})
            yield sse("done", {})
        except FileNotFoundError as e:
            yield sse("error", {"detail": str(e)})
        except ai.AIError as e:
            yield sse("error", {"detail": str(e)})
        except Exception as e:  # noqa: BLE001
            yield sse("error", {"detail": f"内部错误: {e}"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
