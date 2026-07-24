# -*- mode: python ; coding: utf-8 -*-
# 用 collect_data_files 收 .py/.dll/.data，避免 collect_submodules 触发
# PyInstaller 6.21 在 Python 3.11 下的 AST TypeError / 段错误。
# 模块的 import 关系由运行时 Python 自己解析（embeddings.py 用 importlib 懒加载）。
from PyInstaller.utils.hooks import collect_submodules, collect_dynamic_libs, collect_data_files

hiddenimports = []
hiddenimports += collect_submodules('app')

# 所有重依赖：只收文件不分析依赖图
torch_binaries = collect_dynamic_libs('torch')
torch_datas = collect_data_files('torch', include_py_files=True)
st_datas = collect_data_files('sentence_transformers', include_py_files=True)
numpy_binaries = collect_dynamic_libs('numpy')
numpy_datas = collect_data_files('numpy', include_py_files=True)
sklearn_binaries = collect_dynamic_libs('sklearn')
sklearn_datas = collect_data_files('sklearn', include_py_files=True)
scipy_binaries = collect_dynamic_libs('scipy')
scipy_datas = collect_data_files('scipy', include_py_files=True)

# 关键运行时模块（collect_data_files 收了 .py 但 PyInstaller 的 hiddenimports 仍需声明入口）
hiddenimports += ['numpy', 'torch', 'sentence_transformers', 'sklearn', 'scipy']

a = Analysis(
    ['..\\sidecar_main.py'],
    pathex=[],
    binaries=torch_binaries + numpy_binaries + sklearn_binaries + scipy_binaries,
    datas=torch_datas + st_datas + numpy_datas + sklearn_datas + scipy_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tensorflow', 'keras', 'torch.testing'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='knowledge-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='knowledge-backend',
)
