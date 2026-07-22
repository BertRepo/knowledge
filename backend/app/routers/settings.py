"""API 配置页后端：查看/热更新 AI 与 vault 设置（写回 .env）。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import ENV_KEY_MAP, get_settings, mask_key, update_env_file
from ..models import SettingsUpdate, SettingsView

router = APIRouter()


@router.get("/api/settings", response_model=SettingsView)
def get_config():
    s = get_settings()
    return SettingsView(
        ai_base_url=s.ai_base_url,
        ai_api_path=s.ai_api_path,
        ai_api_key=mask_key(s.ai_api_key),
        ai_api_key_configured=bool(s.ai_api_key),
        ai_model=s.ai_model,
        ai_anthropic_version=s.ai_anthropic_version,
        ai_max_tokens=s.ai_max_tokens,
        ai_timeout=s.ai_timeout,
        notes_dir=s.notes_dir,
        cors_origins=s.cors_origins,
    )


@router.put("/api/settings", response_model=SettingsView)
def update_config(body: SettingsUpdate):
    # 只更新用户实际提交了（非 None）的字段；ai_api_key 额外要求非空才改
    updates: dict[str, str] = {}
    for field, env_key in ENV_KEY_MAP.items():
        val = getattr(body, field, None)
        if val is None:
            continue
        if field == "ai_api_key" and not str(val).strip():
            continue  # 留空 = 保留原 key
        updates[env_key] = str(val)

    if not updates:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    try:
        update_env_file(updates)
    except Exception as e:  # 写文件失败要明确报错
        raise HTTPException(status_code=500, detail=f"写入 .env 失败: {e}")

    return get_config()  # update_env_file 已清缓存，这里拿到的是新值
