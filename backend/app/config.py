"""集中式配置：从环境变量 / .env 文件加载。

用 pydantic-settings 而不是手写 os.getenv，好处是类型校验 + 默认值 + .env
读取一步到位。get_settings 用 lru_cache 缓存单例，避免每次调用都重读 .env。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # AI
    ai_base_url: str = "https://api.anthropic.com"
    ai_api_path: str = "/v1/messages"
    ai_api_key: str = ""
    ai_model: str = "claude-sonnet-5"
    ai_anthropic_version: str = "2023-06-01"
    ai_max_tokens: int = 2048
    ai_timeout: float = 120.0

    # 笔记目录（纯 Markdown 文件，不绑定特定编辑器）
    notes_dir: str = "f:/myWorkspacePrivate/knowledge/vault"

    # Server
    cors_origins: str = "http://localhost:3000"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000

    @property
    def notes_path(self) -> Path:
        """笔记目录的 Path（不存在则创建）。"""
        p = Path(self.notes_dir).expanduser()
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ai_endpoint(self) -> str:
        base = self.ai_base_url.rstrip("/")
        path = self.ai_api_path if self.ai_api_path.startswith("/") else f"/{self.ai_api_path}"
        return f"{base}{path}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


# ---------- API 配置页：热更新 .env ----------

# SettingsUpdate 字段名 -> .env 里的环境变量名
ENV_KEY_MAP = {
    "ai_base_url": "AI_BASE_URL",
    "ai_api_path": "AI_API_PATH",
    "ai_api_key": "AI_API_KEY",
    "ai_model": "AI_MODEL",
    "ai_anthropic_version": "AI_ANTHROPIC_VERSION",
    "ai_max_tokens": "AI_MAX_TOKENS",
    "ai_timeout": "AI_TIMEOUT",
    "notes_dir": "NOTES_DIR",
    "cors_origins": "CORS_ORIGINS",
}

# backend/.env 的绝对路径（config.py 在 app/ 下，上一级就是 backend/）
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def mask_key(key: str) -> str:
    """密钥掩码：保留首 3 + 末 4，中间打星号；过短则全打星号。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:3] + "*" * (len(key) - 7) + key[-4:]


def update_env_file(updates: dict) -> None:
    """把 {ENV_VAR: value} 写回 backend/.env（保留注释/空行/顺序），
    然后清掉 get_settings 的 lru_cache，下次调用会读到新值。"""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    key_index: dict[str, int] = {}
    out_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k = stripped.split("=", 1)[0].strip()
            key_index[k] = len(out_lines)  # 该 key 所在行将落在 out_lines 的这个下标
        out_lines.append(line)
    for k, v in updates.items():
        if k in key_index:
            out_lines[key_index[k]] = f"{k}={v}"
        else:
            out_lines.append(f"{k}={v}")
    ENV_FILE.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    get_settings.cache_clear()
