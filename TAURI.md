# Tauri 打包指南

把知识聚合器打包成跨平台桌面客户端（Mac .dmg / Windows .exe），自带 Python 后端 sidecar。

## 前置要求

- Rust 工具链（`rustup`，stable）
- Node.js 18+
- Python 3.11（后端 venv）
- Windows：MSVC Build Tools（Visual Studio Installer 里勾选「C++ 桌面开发」）
- Mac：Xcode Command Line Tools（`xcode-select --install`）

## 架构

```
Tauri 壳（Rust，src-tauri/）
  ├── 前端（Next.js 静态导出到 out/，WebView 渲染）
  └── Python 后端 sidecar（dist/knowledge-backend.exe）
       └─ 启动时由 lib.rs::start_backend() 拉起，监听 127.0.0.1:8000
```

前端调 `http://127.0.0.1:8000` 的 API，Tauri WebView 与后端 sidecar 同进程组。
窗口关闭时（WindowEvent::Destroyed）自动杀后端子进程。

## 打包步骤

### 1. 打包 Python 后端 sidecar

```bash
cd backend
# 确保 .venv311 已装依赖（含 pyinstaller）
./.venv311/Scripts/python.exe -m pip install pyinstaller
./.venv311/Scripts/python.exe build_sidecar.py
# 产出 dist/knowledge-backend.exe
```

把 `backend/dist/knowledge-backend.exe` 复制到 `frontend/src-tauri/`（lib.rs 会从这里找）。

### 2. 自定义商标图标（可选，替换默认 Tauri 图标）

准备一张 1024x1024 PNG 商标图，执行：

```bash
cd frontend
npx tauri icon path/to/your-logo.png
# 自动生成各平台所需图标到 src-tauri/icons/
```

### 3. 打包客户端

```bash
cd frontend
npx tauri build
# Windows: 产出 src-tauri/target/release/bundle/{nsis,msi}/ 的 .exe/.msi
# Mac:     产出 src-tauri/target/release/bundle/{dmg,app}/ 的 .dmg/.app
```

## 自定义安装位置与笔记目录

- **安装位置**：Tauri 的 NSIS（Windows）/ DMG（Mac）安装器默认让用户选安装路径。
- **笔记目录**：打包后默认 `~/knowledge-notes`（见 `sidecar_main.py:_setup_portable_paths`）。
  用户在应用内「配置」页可改为任意路径（写回 .env，热生效）。
- **配置文件**：打包后 .env 不随包分发（含密钥），配置存用户 app data 目录。

## 本地模型（随包分发，已配）

llama-server（30MB，已删无关 exe）+ qwen2.5-1.5b GGUF（1.1GB）= 约 1.2GB，**已打进安装包**：

- `tauri.conf.json` 的 `bundle.resources` 声明了 `backend/local-model/` -> 安装包内 `local-model/`
- `sidecar_main.py` 打包模式下从 exe 同级 `local-model/` 找模型，设 `LOCAL_LLM_*` 环境变量
- NSIS 压缩用 `lzma`（最高压缩率），安装包装到 `~/AppData/Local/知识聚合器/`
- 打包后默认 `LLM_PROVIDER=local`（离线可用），用户可在配置页切 online

体积优化（已做）：
- llama-server 目录删了 18 个无关 exe（64MB -> 30MB）
- GGUF 已是 q4_k_m 量化（1.1GB），再小会明显掉中文质量
- 安装包用 LZMA 压缩，DLL/exe 部分能压到 ~40%

如需更小的包：换 llama-3.2-1b（771MB）替代 qwen2.5-1.5b，但中文摘要质量下降。

## 跨平台注意

- **Mac Air 8+8G**：qwen2.5-1.5b（1.1GB）+ llama-server Metal 加速（`LOCAL_LLM_GPU_LAYERS` 调大）
- **Windows**：同模型，CPU 或 CUDA
- 前端 + Python 后端两端共享，Tauri 处理平台差异

## 开发调试

```bash
cd frontend
npx tauri dev
# 会自动起 Next.js dev server + Rust 壳，后端用 ../backend/.venv311 的 uvicorn
```

## 常见问题

- **`can't find crate for core`**：Rust toolchain 损坏，`rustup toolchain uninstall stable-x86_64-pc-windows-msvc && rustup toolchain install stable-x86_64-pc-windows-msvc`
- **sidecar 找不到**：确认 `knowledge-backend.exe` 在 `src-tauri/` 目录
- **Windows 杀后端口残留**：start.sh 已加启动前清理；打包版 lib.rs 窗口关闭时杀子进程
