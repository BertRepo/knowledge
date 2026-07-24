"""PyInstaller 打包脚本：把 Python 后端打包成单文件可执行程序。

打包后产出 dist/knowledge-backend.exe（Windows）/ dist/knowledge-backend（Mac），
作为 Tauri 的 sidecar 随客户端分发。

用法：cd backend && python build_sidecar.py
"""
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    exe_name = "knowledge-backend.exe" if platform.system() == "Windows" else "knowledge-backend"

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",  # 单文件，便于 sidecar 分发
        "--name", "knowledge-backend",
        # 隐藏控制台窗口（Windows）；服务类程序不需要 GUI。
        # 无控制台下 sys.stdout/stderr 为 None，sidecar_main._redirect_stdio 会重定向到文件。
        "--noconsole" if platform.system() == "Windows" else "--console",
        "--clean",
        # 把 app 包打进去（PyInstaller 有时漏掉）
        "--collect-all", "app",
        # 排除没直接用到的重依赖（来自 sentence_transformers 的可选依赖），
        # 减小体积 + 避免 PyInstaller 分析 sklearn/tensorflow hook 时崩溃
        "--exclude-module", "tensorflow",
        "--exclude-module", "keras",
        "--exclude-module", "sklearn",
        "--exclude-module", "scipy",
        # 入口
        str(ROOT / "sidecar_main.py"),
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build"),
        "--specpath", str(ROOT / "build"),
        "-y",  # 覆盖
    ]

    print("打包 sidecar：", " ".join(cmd))
    subprocess.check_call(cmd)
    print("\n=== 打包完成：dist/" + exe_name + " ===")
    print("把该文件复制到 frontend/src-tauri/ 作为 sidecar")


if __name__ == "__main__":
    main()
