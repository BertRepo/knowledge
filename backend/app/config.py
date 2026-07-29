"""集中式配置：从环境变量 / .env 文件加载。

配置分三组（对应前端配置页的三个分区）：
  1. 在线 LLM API：调云端大模型（Anthropic/OpenAI 兼容格式），能力强但需联网+密钥
  2. 本地 LLM：llama.cpp（llama-server）跑本地 GGUF 模型，离线免费但能力弱
  3. 应用配置：笔记目录、CORS 等，与 AI 无关

LLM_PROVIDER 决定实际用哪个：
  - "online"  -> 走在线 API（按 LLM_API_FORMAT 选 anthropic/openai 请求格式）
  - "local"   -> 启动 llama-server 子进程，走 OpenAI 兼容接口
  - "none"    -> 未配置，AI 相关接口报错
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ===== LLM 选择 =====
    # online=云端 API，local=本地 llama.cpp，none=未配置
    llm_provider: str = "online"

    # ===== 在线 LLM API（云端大模型）=====
    llm_api_format: str = "anthropic"  # anthropic | openai（请求/响应格式）
    llm_base_url: str = "https://api.anthropic.com"
    llm_api_path: str = "/v1/messages"  # anthropic 默认；openai 一般 /v1/chat/completions
    llm_api_key: str = ""
    llm_model: str = "claude-sonnet-5"
    llm_anthropic_version: str = "2023-06-01"  # 仅 anthropic 格式用
    llm_max_tokens: int = 2048
    llm_timeout: float = 120.0

    # ===== 本地 LLM（llama.cpp / llama-server）=====
    # llama-server 可执行文件路径（编译好的 llama.cpp，提供 OpenAI 兼容 API）
    local_llm_server_path: str = ""
    # GGUF 模型文件路径
    local_llm_model_path: str = ""
    local_llm_port: int = 8080
    # GPU 层数（0=纯 CPU；Mac 用 Metal 时可调大）
    local_llm_gpu_layers: int = 0
    # 本地模型上下文长度（小模型建议 4096）
    local_llm_ctx_size: int = 4096

    # ===== 应用配置（与 AI 无关）=====
    notes_dir: str = "f:/myWorkspacePrivate/knowledge/vault"
    cors_origins: str = "http://localhost:3000"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000

    # ===== 向量检索（embedding，独立于 LLM）=====
    # 模型名（sentence-transformers），空则禁用语义检索
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

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
    def llm_endpoint(self) -> str:
        """在线 API 的完整端点 URL。"""
        base = self.llm_base_url.rstrip("/")
        path = self.llm_api_path if self.llm_api_path.startswith("/") else f"/{self.llm_api_path}"
        return f"{base}{path}"

    @property
    def local_llm_endpoint(self) -> str:
        """本地 llama-server 的 OpenAI 兼容端点。"""
        return f"http://127.0.0.1:{self.local_llm_port}/v1/chat/completions"

    @property
    def local_llm_server_abs(self) -> str:
        """llama-server 可执行文件的绝对路径（支持相对路径，相对 backend/）。"""
        return str(self._resolve_local(self.local_llm_server_path))

    @property
    def local_llm_model_abs(self) -> str:
        """GGUF 模型文件的绝对路径（支持相对路径，相对 backend/）。"""
        return str(self._resolve_local(self.local_llm_model_path))

    def _resolve_local(self, path: str) -> Path:
        """把本地模型相关路径解析成绝对路径。

        相对路径以 backend/ 目录为基准（方便打包时随项目走）。
        """
        if not path:
            return Path()
        p = Path(path).expanduser()
        if not p.is_absolute():
            # config.py 在 app/ 下，上一级是 backend/
            p = Path(__file__).resolve().parent.parent / p
        return p

    @property
    def llm_configured(self) -> bool:
        """当前 provider 是否已配好可用。"""
        if self.llm_provider == "online":
            return bool(self.llm_api_key and self.llm_base_url)
        if self.llm_provider == "local":
            return bool(self.local_llm_server_path and self.local_llm_model_path)
        return False


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # 解密敏感字段（.env 里可能存成 enc:xxx）
    if s.llm_api_key:
        s.llm_api_key = decrypt_value(s.llm_api_key)
    return s


# ---------- API 配置页：热更新 .env ----------

# SettingsUpdate 字段名 -> .env 里的环境变量名
ENV_KEY_MAP = {
    "llm_provider": "LLM_PROVIDER",
    "llm_api_format": "LLM_API_FORMAT",
    "llm_base_url": "LLM_BASE_URL",
    "llm_api_path": "LLM_API_PATH",
    "llm_api_key": "LLM_API_KEY",
    "llm_model": "LLM_MODEL",
    "llm_anthropic_version": "LLM_ANTHROPIC_VERSION",
    "llm_max_tokens": "LLM_MAX_TOKENS",
    "llm_timeout": "LLM_TIMEOUT",
    "local_llm_server_path": "LOCAL_LLM_SERVER_PATH",
    "local_llm_model_path": "LOCAL_LLM_MODEL_PATH",
    "local_llm_port": "LOCAL_LLM_PORT",
    "local_llm_gpu_layers": "LOCAL_LLM_GPU_LAYERS",
    "local_llm_ctx_size": "LOCAL_LLM_CTX_SIZE",
    "notes_dir": "NOTES_DIR",
    "cors_origins": "CORS_ORIGINS",
}

# backend/.env 的绝对路径（config.py 在 app/ 下，上一级就是 backend/）
# 打包模式（sys.frozen）下用 app data 目录的 config.env，让配置能持久化
import sys as _sys
import base64 as _b64
import hashlib as _hl
import os as _os


def _config_file() -> Path:
    """配置文件路径：开发模式用 backend/.env，打包模式用 app data 目录。"""
    if getattr(_sys, "frozen", False):
        # 打包后存用户目录，与主程序同根
        base = Path(_os.environ.get("APPDATA", Path.home())) / "knowledge-assistant"
        base.mkdir(parents=True, exist_ok=True)
        return base / "config.env"
    return Path(__file__).resolve().parent.parent / ".env"


ENV_FILE = _config_file()


def _derive_key() -> bytes:
    """从机器特征派生密钥（用于密钥字段的简单加密）。

    用机器名 + 固定盐派生 32 字节密钥，做 XOR 加密。
    不是军事级加密，但防止密钥明文存盘，本地工具够用。
    密钥绑机器：换电脑无法解密（符合本地安全预期）。
    """
    machine = _os.environ.get("COMPUTERNAME", _os.environ.get("HOSTNAME", "default"))
    username = _os.environ.get("USERNAME", "user")
    raw = f"knowledge-assistant:{machine}:{username}".encode("utf-8")
    return _hl.sha256(raw).digest()  # 32 字节


def _xor(data: bytes, key: bytes) -> bytes:
    """XOR 加密/解密（对称，同一函数）。"""
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def encrypt_value(plain: str) -> str:
    """加密敏感值（如 API 密钥），返回 base64 字符串，加 enc: 前缀标识。"""
    if not plain:
        return ""
    enc = _xor(plain.encode("utf-8"), _derive_key())
    return "enc:" + _b64.b64encode(enc).decode("ascii")


def decrypt_value(stored: str) -> str:
    """解密敏感值。非 enc: 前缀的视为明文（兼容旧配置）。"""
    if not stored or not stored.startswith("enc:"):
        return stored
    try:
        enc = _b64.b64decode(stored[4:])
        return _xor(enc, _derive_key()).decode("utf-8")
    except Exception:
        return ""


def mask_key(key: str) -> str:
    """密钥掩码：保留首 3 + 末 4，中间打星号；过短则全打星号。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:3] + "*" * (len(key) - 7) + key[-4:]


def update_env_file(updates: dict) -> None:
    """把 {ENV_VAR: value} 写回配置文件（保留注释/空行/顺序），
    密钥字段加密存储，然后清掉 get_settings 的 lru_cache。"""
    # 密钥字段加密
    secure_updates = {}
    for k, v in updates.items():
        if k == "LLM_API_KEY" and v:
            secure_updates[k] = encrypt_value(v)
        else:
            secure_updates[k] = v
    updates = secure_updates

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
