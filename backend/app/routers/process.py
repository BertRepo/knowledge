"""核心流水线：抓取 -> AI 分析 -> 保存笔记 -> 建议关联。

这个路由是整个产品的主链路，把 scraper / ai / vault / linker / session
五个模块串成一条完整的处理流程。每一步都有独立的错误处理，保证：
- 抓取失败 → 400（用户给的 URL 有问题）
- AI 失败 → 502（上游 AI 服务问题）
- 关联建议失败 → 不影响笔记已保存（best-effort 降级）
"""
from __future__ import annotations

from typing import List

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import ai, linker, scraper, session, vault
from ..models import (
    ProcessRequest,
    ProcessResponse,
    RelatedSuggestion,
    RelateRequest,
    ScrapeRequest,
    ScrapedPage,
)
from ..sse import sse as _sse

router = APIRouter()


@router.post("/api/scrape", response_model=ScrapedPage)
def scrape_url(req: ScrapeRequest):
    """只抓取不分析，用于调试抽取效果。"""
    try:
        scraped = scraper.scrape(req.url)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"抓取失败: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"抓取出错: {e}")
    return ScrapedPage(
        url=scraped.url, title=scraped.title, text=scraped.text, text_len=len(scraped.text)
    )


@router.post("/api/process", response_model=ProcessResponse)
def process(req: ProcessRequest):
    """完整分析流程：抓取 → AI 分析 → 落盘 → 关联建议 → 存会话快照。"""

    # 步骤 1：抓取网页正文
    try:
        scraped = scraper.scrape(req.url)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"抓取失败: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"抓取出错: {e}")

    # 步骤 2：AI 分析，产出结构化笔记字段
    try:
        analysis = ai.analyze(scraped.text, req.url, scraped.title)
    except ai.AIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # 用户填了自定义标题就覆盖 AI 生成的，文件名也跟着重算
    if req.custom_title:
        analysis.title = req.custom_title
        analysis.filename = ai._sanitize_filename(req.custom_title)  # noqa: SLF001

    # 步骤 3：写入笔记库
    stem, _path = vault.save_note(analysis, req.url)
    analysis.filename = stem  # 同步成落盘后的真实文件名（可能带 -N 后缀）

    # 步骤 4：建议关联（best-effort：失败也不能让已保存的笔记白费）
    suggestions: List[RelatedSuggestion] = []
    try:
        suggestions = linker.suggest_for_analysis(analysis, req.max_suggestions)
    except ai.AIError:
        suggestions = []

    # 步骤 5：在系统临时目录存一份会话快照，供历史恢复
    session.save_session(
        {
            "url": req.url,
            "note_filename": stem,
            "title": analysis.title,
            "tldr": analysis.tldr,
            "tags": analysis.tags,
            "domain": analysis.domain,
            "key_points": analysis.key_points,
            "summary": analysis.summary,
            "diagram": analysis.diagram,
            "suggestions": [s.model_dump() for s in suggestions],
        }
    )

    return ProcessResponse(
        note_filename=stem,
        analysis=analysis,
        suggestions=suggestions,
    )


@router.post("/api/relate", response_model=List[RelatedSuggestion])
def relate(req: RelateRequest):
    """为已有笔记重新生成关联建议（前端「重新建议」按钮调用）。"""
    try:
        return linker.suggest_for_existing(req.filename, req.max_suggestions)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ai.AIError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/api/process/stream")
def process_stream(req: ProcessRequest):
    """流式分析接口：SSE 推送摘要增量 + 最终完整结果。

    事件类型：
        summary -- {chunk: "增量文本"}  摘要正文逐段到达，前端实时渲染
        done    -- {完整 ProcessResponse}  分析完成，含关联建议
        error   -- {detail: "错误信息"}  任一步骤失败

    用 StreamingResponse 把生成器输出的 SSE 文本逐块推给浏览器，
    用户不用等 AI 整段返回就能看到摘要在页面上「打字」出来。
    """
    def event_stream():
        try:
            # 步骤 1：抓取
            try:
                scraped = scraper.scrape(req.url)
            except httpx.HTTPError as e:
                yield _sse("error", {"detail": f"抓取失败: {e}"})
                return
            except Exception as e:
                yield _sse("error", {"detail": f"抓取出错: {e}"})
                return

            # 步骤 2：流式分析，摘要增量实时推给前端
            analysis = None
            try:
                for kind, payload in ai.analyze_stream(scraped.text, req.url, scraped.title):
                    if kind == "summary":
                        yield _sse("summary", {"chunk": payload})
                    elif kind == "result":
                        analysis = payload
            except ai.AIError as e:
                yield _sse("error", {"detail": str(e)})
                return

            if not analysis:
                yield _sse("error", {"detail": "分析结果为空"})
                return

            # 用户自定义标题覆盖
            if req.custom_title:
                analysis.title = req.custom_title
                analysis.filename = ai._sanitize_filename(req.custom_title)  # noqa: SLF001

            # 步骤 3：落盘
            stem, _path = vault.save_note(analysis, req.url)
            analysis.filename = stem

            # 步骤 4：关联建议（best-effort）
            suggestions: List[RelatedSuggestion] = []
            try:
                suggestions = linker.suggest_for_analysis(analysis, req.max_suggestions)
            except ai.AIError:
                suggestions = []

            # 步骤 5：会话快照
            session.save_session(
                {
                    "url": req.url,
                    "note_filename": stem,
                    "title": analysis.title,
                    "tldr": analysis.tldr,
                    "tags": analysis.tags,
                    "domain": analysis.domain,
                    "key_points": analysis.key_points,
                    "summary": analysis.summary,
                    "diagram": analysis.diagram,
                    "suggestions": [s.model_dump() for s in suggestions],
                }
            )

            # 步骤 6：推送完整结果
            resp = ProcessResponse(
                note_filename=stem, analysis=analysis, suggestions=suggestions
            )
            yield _sse("done", resp.model_dump())
        except Exception as e:
            # 兜底：任何未预期的异常都转成 error 事件，不让连接挂死
            yield _sse("error", {"detail": f"内部错误: {e}"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
