"""Sidecar 入口：被 PyInstaller 打包的单文件后端启动点。

Tauri 拉起这个可执行文件时，它用 uvicorn 启动 FastAPI app。
与 main.py 的 __main__ 块等价，但单独成文件便于 PyInstaller 打包。

打包后的运行时注意事项：
- .env 不随包分发（含密钥），首次启动用默认值或从 app data 目录读。
- 笔记目录默认用用户 home 下的 knowledge-notes，用户可在配置页改。
- llama-server + GGUF 模型不打进包（太大），作为外部资源或用户指定路径。
"""
import os
import sys
from pathlib import Path


def _setup_portable_paths():
    """打包模式下的路径处理：让笔记目录等默认到用户可写位置。

    打包后没有固定的 backend/ 目录，配置文件与默认笔记目录放用户 home。
    """
    if getattr(sys, "frozen", False):
        # PyInstaller 打包模式：exe 所在目录
        base = Path(sys.executable).resolve().parent
        os.environ.setdefault("NOTES_DIR", str(Path.home() / "knowledge-notes"))


_setup_portable_paths()

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402
from app.config import get_settings  # noqa: E402


def main():
    s = get_settings()
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
