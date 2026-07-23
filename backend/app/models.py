"""Pydantic 数据模型，在 API 层与内部模块间共享。

这里定义的模型同时承担两个职责：
1. 作为 FastAPI 请求体/响应体的 schema（自动校验 + 生成 OpenAPI 文档）；
2. 作为内部模块间传递的数据结构（带类型提示，比裸 dict 安全）。

所以修改字段时要前后端同步：后端改这里，前端改 lib/types.ts。
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ---------- 请求模型 ----------
class ProcessRequest(BaseModel):
    url: str
    # 可选：覆盖 AI 生成的笔记标题
    custom_title: Optional[str] = None
    # 让 AI 返回多少条关联建议
    max_suggestions: int = 6


class ScrapeRequest(BaseModel):
    url: str


class LinkRequest(BaseModel):
    filename: str
    # 要通过 [[wikilink]] 关联的目标笔记名列表（不含 .md 后缀）
    targets: list[str] = Field(
        default_factory=list,
        description="Filenames (without .md) to link from this note via [[wikilink]].",
    )


class RelateRequest(BaseModel):
    """重新计算某篇已有笔记的关联建议。"""
    filename: str
    max_suggestions: int = 6


class NoteUpdateRequest(BaseModel):
    """在线编辑笔记正文的请求体：只替换正文，frontmatter 由后端保留。"""
    body: str


# ---------- 抓取结果 ----------
class ScrapedPage(BaseModel):
    url: str
    title: str
    text: str
    text_len: int


# ---------- AI 分析结果 ----------
class AnalysisResult(BaseModel):
    title: str
    tldr: str
    summary: str
    key_points: list[str]
    tags: list[str]
    filename: str  # 只有文件名主干，不含 .md
    domain: str = "general"   # 内容领域（见 skills.py）
    diagram: str = ""         # mermaid 代码（不含 ``` 围栏），空则无图


# ---------- 关联建议 ----------
class RelatedSuggestion(BaseModel):
    filename: str  # 已有笔记的文件名主干
    title: str
    reason: str
    score: float = 0.0  # 0~1，越高越相关


# ---------- Vault 笔记 ----------
class NoteMeta(BaseModel):
    """笔记列表项（轻量，不含正文）。"""
    filename: str  # 文件名主干
    title: str
    tags: list[str]
    source: Optional[str] = None
    created: Optional[str] = None
    domain: str = "general"
    mtime: str


class NoteFull(BaseModel):
    """笔记完整内容（含正文），用于详情查看。"""
    filename: str
    title: str
    tags: list[str]
    source: Optional[str] = None
    created: Optional[str] = None
    domain: str = "general"
    body: str


class ProcessResponse(BaseModel):
    """分析接口的完整响应：保存后的笔记名 + 分析结果 + 关联建议。"""
    note_filename: str
    analysis: AnalysisResult
    suggestions: list[RelatedSuggestion]


class LinkResponse(BaseModel):
    filename: str
    added: list[str]  # 实际新增的关联名（已去重）
    body: str         # 更新后的笔记正文


# ---------- 会话（一次性临时历史） ----------
class SessionSummary(BaseModel):
    """会话列表项，只含摘要信息。"""
    file: str
    saved_at: Optional[str] = None
    url: Optional[str] = None
    note_filename: Optional[str] = None
    title: Optional[str] = None
    tldr: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class ClearResponse(BaseModel):
    cleared: int  # 实际删除的会话数


# ---------- 设置（配置页：分 LLM 选择 / 在线 API / 本地模型 / 应用配置） ----------
class SettingsView(BaseModel):
    """GET /api/settings 的响应，密钥已掩码不会泄露。"""
    # LLM 选择
    llm_provider: str  # online | local | none
    llm_configured: bool
    # 在线 API
    llm_api_format: str  # anthropic | openai
    llm_base_url: str
    llm_api_path: str
    llm_api_key: str  # 掩码后的 key
    llm_api_key_configured: bool
    llm_model: str
    llm_anthropic_version: str
    llm_max_tokens: int
    llm_timeout: float
    # 本地模型
    local_llm_server_path: str
    local_llm_model_path: str
    local_llm_port: int
    local_llm_gpu_layers: int
    local_llm_ctx_size: int
    local_ready: bool  # llama-server 是否已在跑
    # 应用配置
    notes_dir: str
    cors_origins: str
    # 向量检索
    embedding_model: str


class SettingsUpdate(BaseModel):
    """PUT /api/settings 请求体，所有字段可选；密钥留空表示不修改。"""
    # LLM 选择
    llm_provider: Optional[str] = None
    # 在线 API
    llm_api_format: Optional[str] = None
    llm_base_url: Optional[str] = None
    llm_api_path: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_model: Optional[str] = None
    llm_anthropic_version: Optional[str] = None
    llm_max_tokens: Optional[int] = None
    llm_timeout: Optional[float] = None
    # 本地模型
    local_llm_server_path: Optional[str] = None
    local_llm_model_path: Optional[str] = None
    local_llm_port: Optional[int] = None
    local_llm_gpu_layers: Optional[int] = None
    local_llm_ctx_size: Optional[int] = None
    # 应用配置
    notes_dir: Optional[str] = None
    cors_origins: Optional[str] = None
    embedding_model: Optional[str] = None


# ---------- 知识图谱 ----------
class GraphNode(BaseModel):
    id: str  # 笔记文件名主干，作为图节点 id
    title: str
    domain: str = "general"
    tags: List[str] = Field(default_factory=list)


class GraphEdge(BaseModel):
    source: str  # 笔记文件名主干
    target: str  # 被 [[wikilink]] 引用的笔记主干


class GraphData(BaseModel):
    """图谱视图数据：节点 = 笔记，边 = wikilink 引用（仅连真实存在的笔记）。"""
    nodes: List[GraphNode]
    edges: List[GraphEdge]


# ---------- 对话区 ----------
class ChatMessage(BaseModel):
    role: str  # user / assistant
    content: str


class ChatRequest(BaseModel):
    """对话区追问请求：指定当前笔记 + 对话历史。"""
    note_filename: str
    messages: List[ChatMessage] = Field(
        default_factory=list,
        description="对话历史，最后一轮通常是 user 的追问。",
    )


# ---------- 语义检索 ----------
class SearchRequest(BaseModel):
    """向量检索请求。两种用法共用：
    - relate-semantic：传 filename，用该笔记自身做查询
    - search：传 query，用任意文本做查询
    """
    filename: Optional[str] = None
    query: Optional[str] = None
    top_k: int = 6
