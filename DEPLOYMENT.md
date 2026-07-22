# 部署与公开策略

> 回答「想公开获取关注，用 Web 还是客户端/APP？如何免费部署？」

## 0. 结论先行

**推荐路线：Web 先行（拉关注）→ 桌面端跟进（做留存）。**

| 阶段 | 形态 | 目的 | 成本 |
|------|------|------|------|
| 第一阶段 | **Web 在线 Demo** | 零安装、易分享，快速验证需求、收集反馈 | 免费 |
| 第二阶段 | **Tauri 桌面端** | 交付完整体验（写本地 vault、密钥不出本机） | 打包免费 |

理由：本产品的核心价值是「写入本地 Obsidian vault + 用本地 AI 密钥」，这两点 Web 版做不到完整。但 Web 版胜在**零安装、一条链接即可传播**，是「获取关注」的最短路径。先用 Web 验证有人愿意用，再投入桌面端打包。

---

## 1. 为什么不是移动 APP

- 知识整理是「坐下来花几分钟读+整理」的场景，手机不是主力设备
- Obsidian vault 在手机上同步链路复杂，写入体验差
- APP 开发/审核成本高（双端 + 商店审核），不利于快速迭代
- **结论**：移动端只做 PWA 适配（P3），不单独做原生 APP

## 2. 为什么桌面端选 Tauri 而非 Electron

| | Tauri | Electron |
|---|---|---|
| 体积 | ~3-10MB | ~80-150MB |
| 内存 | 用系统 webview | 自带 Chromium |
| 后端 | Rust（也可 sidecar 挂 Python）| Node.js |
| 安全 | 默认更严 | 需自行加固 |

本项目后端是 Python FastAPI，Tauri 的 **sidecar** 机制能把 PyInstaller 打包的 Python 可执行文件作为子进程随应用启动，前端继续用 Next.js。这样无需重写后端。

---

## 3. 第一阶段：Web Demo 免费部署

### 3.1 需要改造的点（Web 版与本地版的差异）

| 能力 | 本地版 | Web Demo 版 |
|------|--------|------------|
| AI 密钥 | .env 里写死内部 token | **BYO key**：用户自己填，存浏览器 localStorage，请求时带上 |
| 笔记落盘 | 写本地 vault 目录 | **下载 .md 文件**（浏览器无法写任意本地路径）|
| 会话快照 | 系统临时目录 | 改用浏览器 IndexedDB（或直接不存）|
| CORS | localhost:3000 | 部署后的域名 |
| 限流 | 不需要 | **必须**，防止有人拿你的接口刷 AI |

### 3.2 架构

```
Vercel (Next.js 前端 + API Routes)          Render (Python FastAPI)
  ├── 页面渲染                               ├── /api/process（含流式）
  ├── 静态资源                               ├── /api/notes（改为内存/无状态）
  └── 可选：把后端逻辑搬进 API Routes         └── /api/sessions（改为无状态）
        （长期方案，省一个后端）              
```

> **长期最优**：把 Python 后端用 TypeScript 重写成 Next.js API Routes / Server Actions，
> 这样前后端都在 Vercel 一个项目里，省掉 Render 的冷启动问题。短期可先双部署。

### 3.3 免费部署步骤（短期：前后端分离）

#### A. 后端部署到 Render（免费 Web Service）

1. Render 新建 Web Service，连接仓库，选 `backend/` 为根目录
2. 构建命令：`pip install -r requirements.txt`
3. 启动命令：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. 环境变量（在 Render 后台设）：
   - `AI_BASE_URL` / `AI_API_PATH` / `AI_MODEL` 等保持默认
   - `AI_API_KEY` **留空**（Web 版走 BYO key，密钥从请求头取）
   - `CORS_ORIGINS` = 你的 Vercel 域名
   - `OBSIDIAN_VAULT_DIR` = `/tmp/vault`（Render 容器临时目录，重启即失）
5. 免费档：512MB 内存，15 分钟无请求会休眠（首次唤醒约 30s）

> **注意**：Render 免费档的临时文件系统重启即失，vault 写入无意义。Web Demo 版应
> 改为「返回 markdown 内容让用户下载」，不写文件。需在后端加一个 `download` 模式开关。

#### B. 前端部署到 Vercel

1. Vercel 新建项目，导入仓库，Root Directory 设为 `frontend/`
2. 环境变量：`NEXT_PUBLIC_API_BASE` = Render 后端地址（如 `https://xxx.onrender.com`）
3. Framework Preset 会自动识别 Next.js，直接 Deploy
4. 免费档：足够个人 Demo 流量

#### C. BYO key 改造（前端）

新增一个「输入你的 AI 密钥」入口（可复用现有 Settings 页），密钥存 localStorage，
每次请求放在自定义头 `X-AI-Key` 里发给后端。后端 `ai.py` 的 `complete()` 优先读请求头
的 key，没有才回退 .env。这样：
- 你不用为陌生用户承担 AI 费用
- 用户密钥只过你的服务端转发（不暴露在前端网络请求的 URL 里）

#### D. 限流（防滥用）

在后端加一个简单的 IP 限流中间件（slowapi 或手写），例如每 IP 每小时 10 次分析。
否则有人拿你的 Demo 当免费 AI 中转站。

### 3.4 安全审计清单（部署前必做）

- [ ] **确认 `backend/.env` 不会被提交**（已在 .gitignore，二次确认）
- [ ] **当前 .env 里的真实 token（`ck_...`）要轮换**——它已经在本机磁盘上，如果曾经误推过仓库必须作废重发
- [ ] Web 版后端不内置任何密钥，全部走用户自带
- [ ] CORS 白名单只放你的 Vercel 域名，不要 `*`
- [ ] 移除 `/api/settings` 热更新接口（Web 版不该让人改服务端 .env）

---

## 4. 第二阶段：Tauri 桌面端

### 4.1 大致结构

```
desktop/                 # 新增 Tauri 项目
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/main.rs      # 启动 sidecar(python) + 加载前端
├── frontend/            # 复用现有 Next.js（导出为静态或 dev server）
└── backend/             # PyInstaller 打包成单可执行文件
```

### 4.2 关键步骤
1. `pyinstaller --onefile app/main.py` 把后端打成单文件
2. Tauri 配置 sidecar，应用启动时拉起 Python 进程，退出时关掉
3. 前端打包：`next build && next export` 或用 `next dev` 本地端口
4. Tauri webview 指向 `http://localhost:8000`（后端）或直接加载前端静态文件
5. 用 Tauri 的文件系统 API 让用户选择 vault 目录（替代 .env 写死路径）
6. 打包发布：`tauri build` 产出 .msi / .dmg / .AppImage

### 4.3 桌面端独有优势
- 直接写本地 Obsidian vault（含 iCloud 路径），无需下载手动放
- AI 密钥存在本机，不经任何第三方
- 可以监听 vault 变化做实时关联建议
- 离线可用（AI 部分除外）

如果走这条路，我可以继续完成 sidecar 集成、vault 目录选择、打包脚本等开发。

---

## 5. 推广建议（获取关注）

1. **Demo 站点**：Vercel 部署后，准备 2-3 个示例 URL（技术/产品/教程各一），让人一键体验
2. **录屏 GIF**：30 秒展示「粘贴链接 → 流式生成 → 一键关联」的全流程，比文字有效
3. **发布渠道**：V2EX、即刻、少数派、Reddit r/Obsidian / r/knowledgeManagement
4. **开源**：GitHub 开源 + README 放 Demo 链接，吸引开发者 star 和贡献
5. **差异化卖点**：强调「领域感知摘要 + 自动 wikilink 关联」区别于普通 AI 摘要工具
