"""连接 AI 关联建议与 vault 的胶水层。

这一层把「读候选笔记」「调用 AI」「过滤自身」几步串起来，
让 routers/process.py 不用关心关联建议的细节，只需调一个函数。
"""
from __future__ import annotations

import re

from . import ai, vault
from .models import AnalysisResult, RelatedSuggestion


def suggest_for_analysis(
    analysis: AnalysisResult, max_suggestions: int = 6
) -> list[RelatedSuggestion]:
    """为新分析的笔记生成关联建议。

    从 vault 取全部笔记作为候选，排除与自身同名的笔记（避免自己关联自己），
    再交给 AI 判断相关性。
    """
    candidates = vault.note_candidates()
    # 排除与自身同名的候选，避免建议把笔记关联到自己
    candidates = [c for c in candidates if c["filename"] != analysis.filename]
    return ai.suggest_related(analysis, candidates, max_suggestions)


def suggest_for_existing(
    filename: str, max_suggestions: int = 6
) -> list[RelatedSuggestion]:
    """为已存在的笔记重新生成关联建议（对应前端的「重新建议」按钮）。

    因为笔记已落盘，需要从 markdown 正文里反解出 tldr 等字段，
    拼成 AnalysisResult 再走同样的 AI 关联流程。
    """
    full = vault.read_note(filename)
    if not full:
        raise FileNotFoundError(f"笔记不存在: {filename}")

    # 从正文里提取 TL;DR 作为摘要线索：优先匹配 **TL;DR**: 格式，
    # 匹配不到就取正文第一行的前 120 字兜底
    tldr = ""
    m = re.search(r"\*\*TL;DR\*\*:\s*(.+)", full.body)
    if m:
        tldr = m.group(1).strip()
    elif full.body:
        tldr = full.body.split("\n", 1)[0][:120]

    # 用已有笔记的信息构造一个精简的 AnalysisResult 复用关联逻辑
    analysis = AnalysisResult(
        title=full.title,
        tldr=tldr,
        summary="",
        key_points=[],
        tags=full.tags,
        filename=full.filename,
    )
    candidates = vault.note_candidates()
    candidates = [c for c in candidates if c["filename"] != filename]
    return ai.suggest_related(analysis, candidates, max_suggestions)
