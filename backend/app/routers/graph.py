"""知识图谱接口：返回笔记库的节点 + 边数据。"""
from __future__ import annotations

from fastapi import APIRouter

from .. import graph
from ..models import GraphData

router = APIRouter()


@router.get("/api/graph", response_model=GraphData)
def get_graph():
    """返回完整知识图谱：每个笔记是一个节点，wikilink 引用是边。

    前端用力导向图布局渲染。笔记量大时这里是 O(n) 全量扫描，
    后续可加缓存（见 PRD 待迭代：note_candidates 缓存）。
    """
    return graph.build_graph()
