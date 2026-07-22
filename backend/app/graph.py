"""知识图谱数据：从所有笔记的 [[wikilink]] 关系提取节点与边。

给前端的图谱视图用。节点 = 每篇笔记，边 = 一篇笔记正文里
引用了另一篇已存在笔记的 [[wikilink]]。只连真实存在的笔记，
断链不画边，保证图谱干净。
"""
from __future__ import annotations

import re

from . import vault
from .models import GraphData, GraphEdge, GraphNode

_LINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def build_graph() -> GraphData:
    """扫描整个笔记库，产出图谱数据（节点 + 边）。

    遍历每篇笔记的正文提取 wikilink，目标主干在已知笔记集合里才连边。
    边用集合去重（A->B 与 B->A 是两条独立的有向边，反映笔记各自的引用）。
    """
    metas = vault.list_notes()
    known = {m.filename for m in metas}
    nodes = [
        GraphNode(
            id=m.filename,
            title=m.title or m.filename,
            domain=m.domain,
            tags=m.tags,
        )
        for m in metas
    ]

    edges: list[GraphEdge] = []
    seen: set[tuple[str, str]] = set()
    for m in metas:
        full = vault.read_note(m.filename)
        if not full:
            continue
        for raw in _LINK_RE.findall(full.body):
            # 支持 [[x]] / [[x|别名]] / [[x#锚点]]，取主干
            target = re.split(r"[|#]", raw, 1)[0].strip()
            if not target or target == m.filename or target not in known:
                continue
            key = (m.filename, target)
            if key in seen:
                continue
            seen.add(key)
            edges.append(GraphEdge(source=m.filename, target=target))

    return GraphData(nodes=nodes, edges=edges)
