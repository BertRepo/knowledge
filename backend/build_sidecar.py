"""PyInstaller 打包脚本：把 Python 后端打包成 onedir 目录（含向量检索依赖）。

用 onedir 而非 onefile：
- onefile 模式下 torch 的 DLL 加载有问题（c10.dll 初始化失败）
- onedir 把依赖展平成目录，DLL 路径好控制，向量检索（torch/sklearn/scipy）能正常跑

产出 dist/knowledge-backend/ 目录（含 knowledge-backend.exe + _internal/），
整个目录作为 Tauri resources 打进安装包。

用法：cd backend && python build_sidecar.py
"""
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    is_win = platform.system() == "Windows"
    spec = ROOT / "build" / "knowledge-backend.spec"

    # 用 spec 文件打包（spec 里用 collect_data_files 避免 collect_submodules 段错误）
    cmd = [
        sys.executable, "-m", "PyInstaller",
        str(spec),
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build"),
        "-y",
    ]

    print("打包 sidecar（onedir）：", " ".join(cmd))
    subprocess.check_call(cmd)

    out_dir = ROOT / "dist" / "knowledge-backend"
    print("\n=== 打包完成：dist/knowledge-backend/ ===")

    # Windows：删 onedir 自带的 vcruntime，强制用系统版本。
    # 原因：PyInstaller 自带的 vcruntime140_1.dll 与 torch 的 c10.dll 不兼容，
    # 导致 c10.dll 初始化失败（WinError 1114）。删掉后用系统的 vcruntime 正常。
    if is_win:
        internal = out_dir / "_internal"
        for dll in ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]:
            p = internal / dll
            if p.exists():
                p.unlink()
                print(f"删除 {dll}（用系统版本，解决 torch c10.dll 加载）")

    # 打包到 Tauri resources 的目标位置
    tauri_res = ROOT.parent / "frontend" / "src-tauri" / "knowledge-backend"
    if tauri_res.exists():
        shutil.rmtree(tauri_res)
    shutil.copytree(out_dir, tauri_res)
    print(f"\n已复制到 {tauri_res}（Tauri resources 源）")


if __name__ == "__main__":
    main()
