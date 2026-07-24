"""Sidecar 入口：被 PyInstaller 打包的单文件后端启动点。

Tauri 拉起这个可执行文件时，它用 uvicorn 启动 FastAPI app。

打包后的路径处理：
- Tauri 把 local-model/ 作为 resources 放到 resource_dir()，与 sidecar exe 同目录
  （NSIS 装到 ~/AppData/Local/知识聚合器/）。
- sidecar 从 exe 同级目录的 local-model/ 找 llama-server 与 GGUF 模型，
  写入 LOCAL_LLM_* 环境变量，让 providers.py 用绝对路径启动。
- .env 不随包分发（含密钥），默认值在这里给；用户在配置页改后存 app data 目录。

无控制台模式（--noconsole）注意事项：
- 此时 sys.stdout/sys.stderr 是 None，uvicorn 的日志 formatter 调 isatty() 会崩。
- 必须把 stdout/stderr 重定向到文件（非 None），顺便留日志方便排查。
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


def _redirect_stdio():
    """无控制台模式下把 stdout/stderr 重定向到日志文件。

    PyInstaller --noconsole 打包后 sys.stdout/sys.stderr 是 None，
    uvicorn 日志 formatter 调 isatty() 会抛 AttributeError。重定向到文件
    既解决崩溃，又留日志（装在 ~/AppData/Local/知识聚合器/sidecar.log）。
    """
    if not getattr(sys, "frozen", False):
        return  # 开发模式有控制台，不用重定向
    if sys.stdout is not None and sys.stderr is not None:
        return  # 有控制台（如从命令行启动 exe），不用重定向

    # 日志放 exe 同目录（安装目录），方便用户提交排查
    base = Path(sys.executable).resolve().parent
    log_path = base / "sidecar.log"
    try:
        f = open(log_path, "a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = f
        if sys.stderr is None:
            sys.stderr = f
    except Exception:
        # 万一开文件失败，兜底用 devnull，至少不是 None
        import atexit
        devnull = open(os.devnull, "w")
        if sys.stdout is None:
            sys.stdout = devnull
        if sys.stderr is None:
            sys.stderr = devnull
        atexit.register(devnull.close)


_setup_portable_paths()
_redirect_stdio()

import threading  # noqa: E402
import uvicorn  # noqa: E402

from app.main import app  # noqa: E402


def _watch_parent():
    """后台线程：父进程（Tauri 主程序）退出则自杀，防孤儿进程。

    场景：用户用任务管理器杀主程序、或主程序崩溃，on_window_event 不触发，
    sidecar 会成孤儿锁住 knowledge-backend.exe，导致下次安装 "can't write"。
    定期检查父进程 PID 是否还存活，没了就 os._exit 直接退出。
    """
    if not getattr(sys, "frozen", False):
        return  # 开发模式不监控
    import os
    parent_pid = os.getppid()
    while True:
        import time
        time.sleep(5)
        if not _pid_exists(parent_pid):
            break
    # 父进程没了，强制退出（不走 atexit，快速终止，避免锁文件）
    os._exit(0)


def _pid_exists(pid: int) -> bool:
    """检查指定 PID 的进程是否还存活。跨平台。

    Windows 上 os.kill(pid, 0) 对非自身进程会抛 PermissionError（不代表不存在），
    所以用 ctypes.OpenProcess 判断。
    """
    import os
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        # PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        SYNCHRONIZE = 0x00100000
        h = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not h:
            return False  # 打不开=进程不存在或无权限（孤儿场景即不存在）
        kernel32.CloseHandle(h)
        return True
    else:
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False


def main():
    # 启动父进程监控线程（防孤儿）
    t = threading.Thread(target=_watch_parent, daemon=True)
    t.start()
    # 用显式 log_config 而非默认：禁用 access log 的 isatty 判断，
    # 输出全走 stdout（已重定向到文件），避免无控制台模式再次踩坑。
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        access_log=False,  # 无控制台模式不开 access log，减少日志量
    )


if __name__ == "__main__":
    main()
