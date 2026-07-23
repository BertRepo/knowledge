"""配置页后端：查看/热更新 LLM 与应用设置（写回 .env）。

配置分三组，对应前端配置页的分区：
  - LLM 选择（provider）
  - 在线 API（anthropic/openai 格式）
  - 本地模型（llama-server 路径、GGUF 路径）
  - 应用配置（笔记目录、CORS）
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import providers
from ..config import ENV_KEY_MAP, get_settings, mask_key, update_env_file
from ..models import SettingsUpdate, SettingsView

router = APIRouter()


@router.get("/api/settings", response_model=SettingsView)
def get_config():
    """读取当前配置，密钥掩码返回。含本地 llama-server 是否就绪。"""
    s = get_settings()
    return SettingsView(
        llm_provider=s.llm_provider,
        llm_configured=s.llm_configured,
        llm_api_format=s.llm_api_format,
        llm_base_url=s.llm_base_url,
        llm_api_path=s.llm_api_path,
        llm_api_key=mask_key(s.llm_api_key),
        llm_api_key_configured=bool(s.llm_api_key),
        llm_model=s.llm_model,
        llm_anthropic_version=s.llm_anthropic_version,
        llm_max_tokens=s.llm_max_tokens,
        llm_timeout=s.llm_timeout,
        local_llm_server_path=s.local_llm_server_path,
        local_llm_model_path=s.local_llm_model_path,
        local_llm_port=s.local_llm_port,
        local_llm_gpu_layers=s.local_llm_gpu_layers,
        local_llm_ctx_size=s.local_llm_ctx_size,
        local_ready=providers.is_local_ready(),
        notes_dir=s.notes_dir,
        cors_origins=s.cors_origins,
        embedding_model=s.embedding_model,
    )


@router.put("/api/settings", response_model=SettingsView)
def update_config(body: SettingsUpdate):
    """热更新配置：只写非 None 字段，密钥留空=不改。写回 .env 后清缓存生效。"""
    updates: dict[str, str] = {}
    for field, env_key in ENV_KEY_MAP.items():
        val = getattr(body, field, None)
        if val is None:
            continue
        if field == "llm_api_key" and not str(val).strip():
            continue  # 留空 = 保留原 key
        updates[env_key] = str(val)

    if not updates:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    try:
        update_env_file(updates)
    except Exception as e:  # 写文件失败要明确报错
        raise HTTPException(status_code=500, detail=f"写入 .env 失败: {e}")

    return get_config()  # update_env_file 已清缓存，这里拿到的是新值
