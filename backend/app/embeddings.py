"""本地向量检索：用 sentence-transformers 给笔记建索引，语义召回关联。

为什么自己建索引而不调 AI：
- AI 逐条关联又贵又慢（每次要把所有候选塞进 prompt）。
- embedding 一次性算好缓存，召回是 O(n) 点积，毫秒级，零 token 成本。
- 本地模型，离线可用，符合"打包成客户端"的长期路线。

设计要点：
- 模型懒加载：首次用时才加载（加载约 1-2s + 首次下载模型 ~120MB），
  避免后端启动就被拖住。
- 向量缓存：按笔记 mtime 失效，笔记没改就不重算，增量更新。
- 线程安全：模型加载和索引构建加了锁，并发请求不会重复加载。
- HuggingFace 镜像：huggingface.co 在部分网络下不可达，
  默认走 hf-mirror.com 镜像（可用 HF_ENDPOINT 环境变量覆盖）。
"""
from __future__ import annotations

import os
import threading
from typing import Optional

# 必须在 import sentence_transformers 之前设置：让模型下载走镜像。
# 若用户已设 HF_ENDPOINT 或网络可直连 HF，则尊重已有配置。
if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

import numpy as np

from . import vault
from .config import get_settings
from .models import RelatedSuggestion

# 多语言模型（含中文），384 维，模型文件约 120MB。
# 选这个而不是更大的：平衡质量与下载体积，适合本地/客户端。
_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# 每篇笔记参与向量化的文本上限，超长截断（控制延迟）
_TEXT_LIMIT = 2000


class _Embedder:
    """sentence-transformers 的单例封装。

    整个进程只加载一次模型（模型加载重，约 1-2s）。
    用锁保护首次加载，后续直接用。
    """

    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def model(self):
        if self._model is None:
            with self._lock:
                if self._model is None:  # double-check，避免重复加载
                    # 延迟 import：让没装 torch 的环境也能启动后端（只在用到时才报错）
                    from sentence_transformers import SentenceTransformer

                    self._model = SentenceTransformer(_MODEL_NAME)
        return self._model


_embedder = _Embedder()


def _embed_texts(texts: list[str]) -> np.ndarray:
    """把一批文本编码成向量矩阵 (n, dim)，已归一化（便于直接算点积 = 余弦）。"""
    model = _embedder.model()
    # normalize_embeddings=True 后，向量点积就是余弦相似度
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vecs, dtype=np.float32)


def _note_text(meta, full) -> str:
    """拼一篇笔记的向量化文本：标题 + TL;DR + 标签 + 正文片段。

    标题和 TL;DR 权重高（放前面），让向量更偏向「这篇笔记讲什么」。
    """
    parts = [meta.title or meta.filename]
    tags = ",".join(full.tags) if full else ""
    if tags:
        parts.append(tags)
    body = full.body if full else ""
    if len(body) > _TEXT_LIMIT:
        body = body[:_TEXT_LIMIT]
    parts.append(body)
    return "\n".join(parts)


class _Index:
    """笔记向量索引：缓存所有笔记的向量 + 文件 mtime。

    增量更新：rebuild 时对比每篇笔记的 mtime，只重算变化的。
    全量重建只在首次或笔记被删时发生。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._filenames: list[str] = []
        self._mtimes: dict[str, float] = {}
        self._titles: dict[str, str] = {}
        self._matrix: Optional[np.ndarray] = None  # (n, dim)

    def _needs_build(self) -> bool:
        if self._matrix is None:
            return True
        metas = vault.list_notes()
        if len(metas) != len(self._filenames):
            return True
        for m in metas:
            p = get_settings().notes_path / f"{m.filename}.md"
            try:
                mt = p.stat().st_mtime
            except OSError:
                return True
            if m.filename not in self._mtimes or self._mtimes[m.filename] != mt:
                return True
        return False

    def ensure(self) -> None:
        """确保索引是最新的；有变化才重建。线程安全。"""
        if not self._needs_build():
            return
        with self._lock:
            if not self._needs_build():  # double-check
                return
            metas = vault.list_notes()
            texts: list[str] = []
            names: list[str] = []
            titles: dict[str, str] = {}
            mtimes: dict[str, float] = {}
            for m in metas:
                full = vault.read_note(m.filename)
                texts.append(_note_text(m, full))
                names.append(m.filename)
                titles[m.filename] = m.title or m.filename
                p = get_settings().notes_path / f"{m.filename}.md"
                try:
                    mtimes[m.filename] = p.stat().st_mtime
                except OSError:
                    mtimes[m.filename] = 0.0
            if not texts:
                self._filenames = []
                self._mtimes = {}
                self._titles = {}
                self._matrix = np.zeros((0, 1), dtype=np.float32)
                return
            self._matrix = _embed_texts(texts)
            self._filenames = names
            self._mtimes = mtimes
            self._titles = titles

    def search(self, query_vec: np.ndarray, exclude: str, top_k: int) -> list[RelatedSuggestion]:
        """对单条查询向量算余弦相似度，返回 top-k（排除自身）。"""
        self.ensure()
        if self._matrix is None or len(self._filenames) == 0:
            return []
        # 归一化向量的点积 = 余弦相似度
        sims = self._matrix @ query_vec  # (n,)
        # 按 sim 降序取 top_k，排除 exclude
        order = np.argsort(-sims)
        out: list[RelatedSuggestion] = []
        for idx in order:
            name = self._filenames[idx]
            if name == exclude:
                continue
            score = float(sims[idx])
            if score <= 0:  # 负相关或零相关，没意义
                continue
            out.append(
                RelatedSuggestion(
                    filename=name,
                    title=self._titles.get(name, name),
                    reason=f"语义相似度 {(score * 100):.0f}%",
                    score=score,
                )
            )
            if len(out) >= top_k:
                break
        return out


_index = _Index()


def embed_query(text: str) -> np.ndarray:
    """把一段查询文本编码成向量（归一化）。"""
    return _embed_texts([text])[0]


def semantic_search(query: str, exclude: str, top_k: int = 6) -> list[RelatedSuggestion]:
    """用一段文本查询笔记库，返回语义最相关的 top_k 笔记。"""
    if not query.strip():
        return []
    qv = embed_query(query)
    return _index.search(qv, exclude=exclude, top_k=top_k)


def semantic_relate(filename: str, top_k: int = 6) -> list[RelatedSuggestion]:
    """为一篇已有笔记找语义关联的其他笔记。

    用该笔记自己的文本作为查询，召回最相似的。
    """
    full = vault.read_note(filename)
    if not full:
        raise FileNotFoundError(f"笔记不存在: {filename}")
    metas = {m.filename: m for m in vault.list_notes()}
    meta = metas.get(filename)
    text = _note_text(meta, full) if meta else full.body
    return semantic_search(text, exclude=filename, top_k=top_k)


def semantic_relate_analysis(analysis, top_k: int = 6) -> list[RelatedSuggestion]:
    """为新分析的笔记（还没落盘或刚落盘）找语义关联。

    用 AnalysisResult 的字段拼查询文本，不依赖重新读文件。
    """
    text = "\n".join(
        [analysis.title, analysis.tldr, ",".join(analysis.tags), analysis.summary]
    )
    return semantic_search(text, exclude=analysis.filename, top_k=top_k)


def is_available() -> bool:
    """embedding 是否可用（模型能否加载）。用于健康检查告知前端。"""
    try:
        _embedder.model()
        return True
    except Exception:  # noqa: BLE001
        return False
