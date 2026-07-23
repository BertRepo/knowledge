"""LLM 提供方抽象：统一 complete / complete_stream / chat_stream，屏蔽后端差异。

三种后端：
  - anthropic：/v1/messages，请求/响应是 Anthropic 格式（content blocks）
  - openai：/v1/chat/completions，请求/响应是 OpenAI 格式（choices[].message）
  - local：llama-server 子进程，走 OpenAI 兼容接口

上层（ai.py）只调 providers 的三个函数，不关心当前用的是哪个后端。
"""
from __future__ import annotations

import json
import subprocess
import time
from typing import Iterator

import httpx

from .config import get_settings


class ProviderError(RuntimeError):
    """LLM 调用异常。"""
    pass


_llama_proc = None  # subprocess.Popen | None


def _ensure_llama_server() -> str:
    """启动 llama-server 子进程（如未启动），返回其 OpenAI 端点。"""
    global _llama_proc
    s = get_settings()
    if _llama_proc is not None and _llama_proc.poll() is None:
        return s.local_llm_endpoint

    if not s.local_llm_server_path or not s.local_llm_model_path:
        raise ProviderError("本地 LLM 未配置：请在配置页填 llama-server 路径和 GGUF 模型路径")

    cmd = [
        s.local_llm_server_path,
        "-m", s.local_llm_model_path,
        "--host", "127.0.0.1",
        "--port", str(s.local_llm_port),
        "--n-gpu-layers", str(s.local_llm_gpu_layers),
        "--ctx-size", str(s.local_llm_ctx_size),
    ]
    try:
        _llama_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        raise ProviderError(f"启动 llama-server 失败：{e}") from e

    # 等待就绪：轮询 /health，最多 60s（加载模型要几秒）
    health = f"http://127.0.0.1:{s.local_llm_port}/health"
    for _ in range(120):
        try:
            r = httpx.get(health, timeout=2)
            if r.status_code == 200:
                return s.local_llm_endpoint
        except httpx.RequestError:
            pass
        time.sleep(0.5)
    raise ProviderError("llama-server 启动超时（60s 内未就绪），请检查模型路径或减小 ctx-size")


def is_local_ready() -> bool:
    """本地 llama-server 是否已就绪（健康检查用，不启动）。"""
    s = get_settings()
    if s.llm_provider != "local":
        return False
    try:
        r = httpx.get(f"http://127.0.0.1:{s.local_llm_port}/health", timeout=2)
        return r.status_code == 200
    except httpx.RequestError:
        return False


# ---------------------------------------------------------------------------
# 统一接口：根据 llm_provider 分发
# ---------------------------------------------------------------------------

def _resolve_endpoint_and_format():
    """根据配置决定端点 URL 和格式（anthropic/openai）。

    local 走 llama-server（OpenAI 兼容），online 按 llm_api_format。
    返回 (endpoint, format, model, api_key, headers, timeout)。
    """
    s = get_settings()
    if s.llm_provider == "local":
        endpoint = _ensure_llama_server()
        return endpoint, "openai", "local-model", "", {}, s.llm_timeout * 2

    # online
    if not s.llm_api_key:
        raise ProviderError("在线 LLM 未配置：请在配置页填 API Key")
    fmt = s.llm_api_format
    headers = {"content-type": "application/json"}
    if fmt == "anthropic":
        # Anthropic 双鉴权头，最大化兼容内部网关
        headers["x-api-key"] = s.llm_api_key
        headers["Authorization"] = f"Bearer {s.llm_api_key}"
        headers["anthropic-version"] = s.llm_anthropic_version
    else:  # openai
        headers["Authorization"] = f"Bearer {s.llm_api_key}"
    return s.llm_endpoint, fmt, s.llm_model, s.llm_api_key, headers, s.llm_timeout


def complete(system: str, user: str, *, max_tokens: int | None = None) -> str:
    """单轮：system + user -> 纯文本回答。"""
    s = get_settings()
    endpoint, fmt, model, _key, headers, timeout = _resolve_endpoint_and_format()
    mt = max_tokens or s.llm_max_tokens

    if fmt == "anthropic":
        payload = {"model": model, "max_tokens": mt, "system": system,
                   "messages": [{"role": "user", "content": user}]}
        data = _post_json(endpoint, payload, headers, timeout)
        # Anthropic：content 数组里取 text 块，跳过 thinking 块
        blocks = data.get("content", [])
        texts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
        out = "\n".join(t for t in texts if t)
        if not out:
            raise ProviderError(f"AI 返回内容为空: {json.dumps(data, ensure_ascii=False)[:300]}")
        return out
    else:  # openai（含 local llama-server）
        payload = {"model": model, "max_tokens": mt, "stream": False,
                   "messages": [{"role": "system", "content": system},
                                {"role": "user", "content": user}]}
        data = _post_json(endpoint, payload, headers, timeout)
        return _openai_extract_text(data)


def complete_stream(system: str, user: str, *, max_tokens: int | None = None) -> Iterator[str]:
    """单轮流式：yield 文本增量。"""
    s = get_settings()
    endpoint, fmt, model, _key, headers, timeout = _resolve_endpoint_and_format()
    mt = max_tokens or s.llm_max_tokens

    if fmt == "anthropic":
        payload = {"model": model, "max_tokens": mt, "system": system, "stream": True,
                   "messages": [{"role": "user", "content": user}]}
        yield from _stream_anthropic(endpoint, payload, headers, timeout)
    else:  # openai / local
        payload = {"model": model, "max_tokens": mt, "stream": True,
                   "messages": [{"role": "system", "content": system},
                                {"role": "user", "content": user}]}
        yield from _stream_openai(endpoint, payload, headers, timeout)


def chat_stream(system: str, messages: list[dict], *, max_tokens: int | None = None) -> Iterator[str]:
    """多轮流式：接受完整对话历史，yield 文本增量。"""
    s = get_settings()
    endpoint, fmt, model, _key, headers, timeout = _resolve_endpoint_and_format()
    mt = max_tokens or s.llm_max_tokens

    if fmt == "anthropic":
        payload = {"model": model, "max_tokens": mt, "system": system, "stream": True,
                   "messages": messages}
        yield from _stream_anthropic(endpoint, payload, headers, timeout)
    else:  # openai / local
        full = [{"role": "system", "content": system}] + messages
        payload = {"model": model, "max_tokens": mt, "stream": True, "messages": full}
        yield from _stream_openai(endpoint, payload, headers, timeout)


# ---------------------------------------------------------------------------
# 内部：HTTP 请求与流式解析
# ---------------------------------------------------------------------------

def _post_json(url, payload, headers, timeout):
    """发 JSON POST，返回解析后的响应 JSON。失败转 ProviderError。"""
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=timeout)
    except httpx.RequestError as e:
        raise ProviderError(f"请求 LLM 失败（网络/地址）：{e}") from e
    if resp.status_code >= 400:
        raise ProviderError(f"LLM 接口返回 {resp.status_code}: {resp.text[:500]}")
    try:
        return resp.json()
    except ValueError as e:
        raise ProviderError(f"解析 LLM 响应失败: {e}; 原文: {resp.text[:300]}") from e


def _openai_extract_text(data):
    """从 OpenAI 格式响应取文本（choices[0].message.content）。"""
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise ProviderError(f"解析 OpenAI 响应失败: {e}; 原文: {json.dumps(data, ensure_ascii=False)[:300]}") from e


def _stream_anthropic(url, payload, headers, timeout):
    """解析 Anthropic 流式 SSE：content_block_delta 事件的 text_delta。"""
    try:
        with httpx.Client(timeout=timeout) as client:
            with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = resp.read().decode("utf-8", errors="replace")
                    raise ProviderError(f"LLM 接口返回 {resp.status_code}: {body[:500]}")
                for line in resp.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        evt = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    # 只取文本增量，跳过 thinking 块
                    if evt.get("type") == "content_block_delta":
                        delta = evt.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                yield text
    except httpx.RequestError as e:
        raise ProviderError(f"请求 LLM 流式失败：{e}") from e


def _stream_openai(url, payload, headers, timeout):
    """解析 OpenAI 流式 SSE：choices[0].delta.content。"""
    try:
        with httpx.Client(timeout=timeout) as client:
            with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = resp.read().decode("utf-8", errors="replace")
                    raise ProviderError(f"LLM 接口返回 {resp.status_code}: {body[:500]}")
                for line in resp.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        evt = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    choices = evt.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        text = delta.get("content", "")
                        if text:
                            yield text
    except httpx.RequestError as e:
        raise ProviderError(f"请求 LLM 流式失败：{e}") from e
