"""Sidecar 入口：被 PyInstaller 打包的单文件后端启动点。

Tauri 拉起这个可执行文件时，它用 uvicorn 启动 FastAPI app。

打包后的路径处理：
- Tauri 把 local-model/ 作为 resources 放到 resource_dir()，与 sidecar exe 同目录
  （NSIS 装到 ~/AppData/Local/知识聚合器/）。
- sidecar 从 exe 同级目录的 local-model/ 找 llama-server 与 GGUF 模型，
  写入 LOCAL_LLM_* 环境变量，让 providers.py 用绝对路径启动。
- .env 不随包分发（含密钥），默认值在这里给；用户在配置页改后存 app data 目录。

llama-server + GGUF 模型不打进 PyInstaller exe（太大），作为 Tauri resources 随包。
"""
import os
import sys
from pathlib import Path


def _setup_portable_paths():
    """打包模式下设置默认路径：笔记目录 + 本地模型路径。

    只在环境变量未设时给默认值（用户在配置页改的优先）。
    """
    if not getattr(sys, "frozen", False):
        return  # 开发模式，用 .env

    # PyInstaller 打包：exe 所在目录
    base = Path(sys.executable).resolve().parent

    # 默认笔记目录：用户 home 下（用户可在配置页改）
    os.environ.setdefault("NOTES_DIR", str(Path.home() / "knowledge-notes"))

    # 本地模型：从 exe 同级目录的 local-model/ 找（Tauri resources 放这里）
    local_model = base / "local-model"
    server = local_model / "llama-server" / "llama-server.exe"
    if server.exists():
        os.environ.setdefault("LOCAL_LLM_SERVER_PATH", str(server))
    # 找任意 gguf
    gguf = next(local_model.glob("*.gguf"), None)
    if gguf:
        os.environ.setdefault("LOCAL_LLM_MODEL_PATH", str(gguf))

    # 打包后默认用本地模型（离线优先），用户可切 online
    os.environ.setdefault("LLM_PROVIDER", "local")


_setup_portable_paths()

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402


def main():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


if __name__ == "__main__":
    main()
