"""Pydantic 数据模型，在 API 层与内部模块间共享。

这里定义的模型同时承担两个职责：
1. 作为 FastAPI 请求体/响应体的 schema（自动校验 + 生成 OpenAPI 文档）；
2. 作为内部模块间传递的数据结构（带类型提示，比裸 dict 安全）。

所以修改字段时要前后端同步：后端改这里，前端改 lib/types.ts。
"""
from __future__ import annotations

from typing import Optional

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


# ---------- 设置（API 配置页） ----------
class SettingsView(BaseModel):
    """GET /api/settings 的响应，密钥已掩码不会泄露。"""
    ai_base_url: str
    ai_api_path: str
    ai_api_key: str  # 掩码后的 key
    ai_api_key_configured: bool
    ai_model: str
    ai_anthropic_version: str
    ai_max_tokens: int
    ai_timeout: float
    notes_dir: str
    cors_origins: str


class SettingsUpdate(BaseModel):
    """PUT /api/settings 请求体，所有字段可选；ai_api_key 留空表示不修改。"""
    ai_base_url: Optional[str] = None
    ai_api_path: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_model: Optional[str] = None
    ai_anthropic_version: Optional[str] = None
    ai_max_tokens: Optional[int] = None
    ai_timeout: Optional[float] = None
    notes_dir: Optional[str] = None
    cors_origins: Optional[str] = None
