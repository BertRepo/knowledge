"""对话区后端：以「当前笔记 + 它的关联笔记」为上下文，做多轮追问。

设计思路：
- 对话不是无根的闲聊，而是「针对当前正在看/刚分析的笔记」的追问。
  比如分析完一篇技术文章后问「这和我之前存的 X 有什么关系」。
- 上下文 = 当前笔记全文 + 它通过 [[wikilink]] 关联到的笔记的摘要/TL;DR。
  这样 AI 回答时能引用已有知识网络，而不是只盯着当前这一篇。
- 流式返回，与 analyze_stream 一致：逐字吐出回答，前端实时渲染。
"""
from __future__ import annotations

import re
from typing import Iterator

from . import ai, vault

# 匹配 [[wikilink]]，支持 [[目标|别名]] 和 [[目标#小标题]] 两种写法
_LINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

# 单篇关联笔记作为上下文时，正文最多截取这么长，避免上下文爆炸
_NOTE_CTX_LIMIT = 800


def _linked_stems(body: str, known: set[str], self_stem: str) -> list[str]:
    """从笔记正文里提取 [[wikilink]] 指向的目标，只保留确实存在的笔记。

    处理三种写法：[[x]]、[[x|别名]]、[[x#锚点]]，取竖线/井号前的主干。
    去重、去自身、去不存在的目标（防断链污染上下文）。
    """
    out: list[str] = []
    seen: set[str] = set()
    for m in _LINK_RE.findall(body):
        stem = re.split(r"[|#]", m, 1)[0].strip()
        if stem and stem != self_stem and stem in known and stem not in seen:
            seen.add(stem)
            out.append(stem)
    return out


def _build_context(note_filename: str) -> tuple[str, list[str]]:
    """构建对话上下文文本，返回 (上下文 markdown, 关联笔记 stem 列表)。

    上下文含当前笔记全文 + 各关联笔记的标题/TL;DR/摘要片段。
    """
    full = vault.read_note(note_filename)
    if not full:
        raise FileNotFoundError(f"笔记不存在: {note_filename}")

    known = {n.filename for n in vault.list_notes()}
    linked = _linked_stems(full.body, known, note_filename)

    parts: list[str] = [
        f"## 当前笔记：{full.title}（{note_filename}.md）",
        f"来源：{full.source or '无'}",
        f"标签：{', '.join(full.tags) if full.tags else '无'}",
        "正文：",
        full.body,
    ]

    if linked:
        parts.append("\n## 已关联笔记（供参考，回答可引用）")
        for stem in linked:
            ref = vault.read_note(stem)
            if not ref:
                continue
            # 关联笔记只取摘要片段，控制上下文体积
            snippet = ref.body[:_NOTE_CTX_LIMIT]
            if len(ref.body) > _NOTE_CTX_LIMIT:
                snippet += "…[截断]"
            parts.append(f"\n### {ref.title}（{stem}.md）\n{snippet}")

    return "\n".join(parts), linked


_CHAT_SYSTEM = (
    "你是知识库助手。用户正在阅读一篇笔记，并基于它做追问。"
    "我会给你当前笔记的正文以及它关联到的其他笔记内容作为上下文。\n"
    "回答要求：\n"
    "1. 用中文，简洁、直接，必要时用 Markdown 结构化。\n"
    "2. 回答尽量结合上下文里的笔记（可引用笔记标题），帮用户建立知识联系。\n"
    "3. 如果关联笔记里有相关内容，主动指出「这与你存的《某笔记》相关」。\n"
    "4. 上下文不足以下结论时，明确说明缺什么信息，不要编造。"
)


def chat_stream(note_filename: str, messages: list[dict]) -> Iterator[str]:
    """多轮流式对话。messages 是 [{role, content}, ...] 的对话历史。

    流程：构建上下文 -> 拼成 system + messages -> 调 ai.chat_stream 逐字 yield。
    """
    context, _linked = _build_context(note_filename)
    system = f"{_CHAT_SYSTEM}\n\n=== 上下文 ===\n{context}"
    # 规整消息：只接受 user/assistant，且第一轮必须是 user
    msgs = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant") and str(m.get("content", "")).strip()
    ]
    if not msgs:
        return
    if msgs[0]["role"] != "user":
        msgs.insert(0, {"role": "user", "content": "你好"})

    yield from ai.chat_stream(system, msgs)
