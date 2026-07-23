"""语义检索接口：向量召回关联笔记 + 全文语义搜索。

区别于 /api/relate（LLM 逐条判断）：
- /api/relate-semantic 用本地 embedding 召回，毫秒级、零 token 成本。
- /api/search 用一段查询文本语义搜索整个笔记库。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import ai, embeddings
from ..models import RelatedSuggestion, SearchRequest

router = APIRouter()


@router.post("/api/relate-semantic", response_model=list[RelatedSuggestion])
def relate_semantic(req: SearchRequest):
    """为指定笔记用向量召回语义最相关的其他笔记。

    前端「重新建议」旁可加「语义召回」入口，与 LLM 建议互补：
    LLM 给理由，向量召回给覆盖面（哪怕语义相关但用词不同也能找到）。
    """
    try:
        return embeddings.semantic_relate(req.filename, req.top_k)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        # embedding 模型没装好/加载失败，返回明确错误而非 500
        raise HTTPException(status_code=503, detail=f"向量检索不可用：{e}")


@router.post("/api/search", response_model=list[RelatedSuggestion])
def search(req: SearchRequest):
    """用一段文本语义搜索整个笔记库，返回最相关的笔记。

    用于工作台的「搜索框」：输入关键词或问题，向量召回最相关的笔记，
    比纯关键词匹配更能理解「讲了什么」（同义词也能命中）。
    """
    if not req.query or not req.query.strip():
        return []
    try:
        return embeddings.semantic_search(req.query.strip(), exclude="", top_k=req.top_k)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"向量检索不可用：{e}")


@router.get("/api/embeddings/status")
def embeddings_status():
    """向量检索是否可用 + 模型是否已加载。健康检查用。"""
    return {
        "available": embeddings.is_available(),
        "model": embeddings._MODEL_NAME,
        "indexed_notes": len(embeddings._index._filenames),  # noqa: SLF001
    }
