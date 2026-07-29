# 知识助手

粘贴网页链接 -> AI 自动生成结构化笔记 -> 智能关联已有笔记 -> 用双向链接逐步搭起知识网络。

- **领域感知**：自动识别内容领域（技术/产品/金融/学术/教程/资讯…），按领域套用不同摘要结构与 Mermaid 图解
- **后端**：Python 3.11 + FastAPI（爬取 / AI 分析 / 读写笔记 / 向量检索 / 会话快照）
- **前端**：Next.js 16 + React 19 + Tailwind v4（工作台 + 笔记库两页式）
- **存储**：纯 Markdown 文件（兼容 Obsidian / Logseq / VSCode，可走 iCloud 同步）
- **AI**：支持在线 API（Anthropic/OpenAI 兼容）与本地离线模型（llama.cpp）切换

---

## 快速开始

```bash
# 1. 填 AI 凭证（必须）
cp backend/.env.example backend/.env
#   编辑 backend/.env，填 AI_BASE_URL / AI_API_KEY / AI_MODEL

# 2. 一键启动（后端 :8000 + 前端 :3000）
bash start.sh            # Git Bash；或双击 start.bat

# 3. 打开页面
#    http://localhost:3000  ->  粘贴链接 -> 分析并保存
```

> Docker 方式见 [Docker 部署](#docker-部署持久后台运行)；手动分终端见 [手动启动](#手动启动后端)。

---

## 工作流程

```
浏览器 (localhost:3000)
   │  1. 粘贴 URL
   ▼
FastAPI 后端 (localhost:8000)
   │  2. scraper.py   抓取并提取正文（trafilatura / bs4）
   │  3. ai.py        调内部 AI（Anthropic 兼容 /v1/messages）-> 标题/摘要/标签/文件名
   │  4. vault.py     写 vault/<标题>.md（YAML frontmatter + 正文）
   │  5. linker.py    拿已有笔记做候选 -> ai.py 让 AI 排序给关联建议
   │  6. session.py   把本次结果快照存系统临时目录（可删）
   ▼
前端展示：分析卡片 + 关联建议勾选
   │  7. 用户勾选 -> POST /api/link -> vault.py 在笔记里追加 [[wikilink]]
   ▼
Obsidian 打开 vault/ 即可看到笔记与双向链接的知识图谱
```

---

## 目录结构

```
knowledge/
├── README.md                    # 本文档
├── start.sh / start.bat         # 一键启动脚本（本地开发）
├── docker-compose.yml           # Docker 编排
├── folder-alias.json            # 文件/目录说明索引
├── vault/                       # 默认 Obsidian 笔记库（可改指向 iCloud）
│
├── backend/                     # Python FastAPI 后端
│   ├── app/
│   │   ├── main.py              #   应用工厂：CORS + 挂载 routers（很薄）
│   │   ├── config.py            #   读 .env 配置
│   │   ├── models.py            #   Pydantic schema（↔ 前端 lib/types.ts）
│   │   ├── scraper.py           #   网页抓取
│   │   ├── ai.py                #   内部 AI 调用（摘要 / 标签 / 关联建议）
│   │   ├── vault.py             #   Obsidian md 读写 / frontmatter / wikilink
│   │   ├── linker.py            #   关联建议编排
│   │   ├── session.py           #   会话快照（临时目录）
│   │   └── routers/             #   路由按资源拆分：system/process/notes/sessions
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env / .env.example
│   └── .venv/                   #   本地虚拟环境
│
└── frontend/                    # Next.js 前端
    ├── app/                     #   layout / page / globals.css
    ├── components/              #   功能组件
    │   └── ui/                  #   可复用 UI 原语（Button/Card/Tag/...）
    ├── hooks/                   #   useHealth / useNotes / useSessions
    ├── lib/                     #   api.ts（类型化客户端）+ types.ts
    ├── Dockerfile
    ├── next.config.ts           #   output: standalone（供 Docker）
    └── .env.local               #   NEXT_PUBLIC_API_BASE
```

> 每个文件/目录的说明都登记在 [folder-alias.json](folder-alias.json) 里，IDE 里悬停或工具可读取。

---

## 启动

### 配置后端 `.env`

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，**至少填这三项**（否则分析步骤会失败）：

```ini
AI_BASE_URL=http://你的内部AI地址       # 不带尾斜杠
AI_API_KEY=ck_xxxxxxxxxx                # 你的 token；Ccswitch 的 ANTHROPIC_AUTH_TOKEN 直接用
AI_MODEL=doubao-seed-2.0-pro            # 你的端点支持的模型名
AI_MAX_TOKENS=8192                      # reasoning 模型建议 ≥8192
```

认证说明：
- 代码**同时发送** `x-api-key` 和 `Authorization: Bearer` 两个头，所以 Anthropic 标准 key 和 Ccswitch 的 `ANTHROPIC_AUTH_TOKEN`（`ck_` 开头）都能直接用，无需额外配置。
- 默认请求路径为 `{AI_BASE_URL}/v1/messages`（Anthropic 标准）。若你的代理路径不同，改 `AI_API_PATH`。
- reasoning 模型（如 doubao）会先输出 `thinking` 块再输出正文，`AI_MAX_TOKENS` 太小会导致只思考不产出正文，建议 8192+。

### 一键脚本（本地开发，推荐）

```bash
bash start.sh          # Git Bash；或双击 start.bat
```

脚本自动：创建/复用 venv、补装缺失依赖、启动后端 :8000 + 前端 :3000，日志写 `.logs/`，`Ctrl+C` 一键停全部。首次会自动从 `.env.example` 复制 `.env`（需补 AI 凭证）。

### 手动启动：后端

```bash
cd backend
python -m venv .venv                   # 仅首次
source .venv/Scripts/activate          # Git Bash on Windows
pip install -r requirements.txt        # 仅首次
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

验证：打开 http://127.0.0.1:8000/api/health ，应返回 `{"status":"ok", "ai_configured":true, ...}`。

### 手动启动：前端

```bash
cd frontend
npm install          # 仅首次
npm run dev
```

打开 http://localhost:3000 。前端通过 `.env.local` 的 `NEXT_PUBLIC_API_BASE` 指向后端（默认 `http://127.0.0.1:8000`）。

> 本地 dev 和 Docker 都用 3000/8000 端口，**二选一**，同时跑会端口冲突。

---

## API 接口

后端基础地址 `http://127.0.0.1:8000`，所有接口前缀 `/api`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查：vault 路径、AI 是否配置、模型名、笔记数 |
| POST | `/api/scrape` | `{url}` -> `{title, text, text_len}` 抓取预览（不调 AI） |
| POST | `/api/process` | `{url, custom_title?, max_suggestions?}` -> 核心流水线，返回分析结果 + 关联建议 |
| GET | `/api/notes` | 列出所有笔记 `{filename, title, tags, source, created, mtime}` |
| GET | `/api/notes/{filename}` | 取单篇笔记正文 |
| POST | `/api/link` | `{filename, targets:[]}` -> 在笔记里追加 `[[wikilink]]`，返回新增项 |
| POST | `/api/relate` | `{filename, max_suggestions?}` -> 对已有笔记重跑关联建议 |
| GET | `/api/settings` | 查看当前配置（密钥掩码） |
| PUT | `/api/settings` | 热更新配置（写回 .env，留空 key 不改） |
| GET | `/api/sessions` | 列出临时会话快照 |
| GET | `/api/sessions/{file}` | 取某个会话快照详情 |
| DELETE | `/api/sessions` | 清空所有会话快照（不影响 vault） |

交互文档：http://127.0.0.1:8000/docs （FastAPI 自带 Swagger UI）。

---

## 使用流程

1. 页面顶部粘贴网页链接 -> 点 **分析并保存**（可填自定义标题）
2. 后端跑完五步流水线（抓取 / 分析 / 写笔记 / 关联建议 / 会话快照）
3. **AI 建议关联** 卡片勾选相关笔记 -> **确认关联** -> 笔记里追加 `[[wikilink]]`
4. 也可在 **手动添加关联** 里输入笔记名建立链接（带联想）
5. 右侧 **笔记库** 查看/选中笔记，**会话历史** 是每次分析的临时快照（可清空）
6. 顶部 **API 配置** 链接进入 `/settings`，可在网页内改 AI 凭证/模型/vault 路径，保存即热生效

笔记自动按领域（技术/产品/学术…）套用不同结构，并生成 Mermaid 图解（流程图/脑图），Obsidian 与前端都会渲染。

笔记格式（Obsidian 兼容）：

```markdown
---
title: 标题
source: https://...
created: 2026-07-20
tags: [tag1, tag2]
---

# 标题
> **TL;DR**: 一句话总结

## 摘要
...
## 关键点
- ...
## 关联笔记
- [[other-note]]
```

---

## Docker 部署（持久后台运行）

前后端容器化，`docker compose up -d` 一键起，`restart: unless-stopped` 开机自启。

**前提**：先填好 `backend/.env`，且 Docker Desktop 已运行。

```bash
docker compose up -d --build      # 构建并后台启动（镜像已构建过则直接 up -d）
docker compose logs -f            # 查看日志
docker compose ps                 # 查看状态
docker compose down               # 停止并移除容器
```

启动后：前端 http://localhost:3000 ，后端 http://localhost:8000/api/health 。

说明：
- 笔记写到宿主机 `./vault`（bind mount 到容器 `/data/vault`），与本地 dev 共用同一目录。
- `AI_*` 凭证从 `backend/.env` 注入；vault 路径 / CORS 由 compose 的 `environment` 覆盖适配容器。
- 前端 `NEXT_PUBLIC_API_BASE` 是**构建时**注入的（浏览器直连宿主机 8000）；改后端地址需带 build arg 重建。
- **镜像拉取慢**：本环境对 Docker Hub 访问较差，可在 Docker Desktop -> Settings -> Docker Engine 加 registry mirror：
  ```json
  { "registry-mirrors": ["https://docker.m.daocloud.io"] }
  ```
  改完重启 Docker Desktop 再 build。

---

## 用 iCloud 同步到 Mac 端 Obsidian

1. 在 Windows 装 **iCloud for Windows**，登录后出现 `C:\Users\<你>\iCloudDrive\`
2. 改 `backend/.env`：
   ```ini
   OBSIDIAN_VAULT_DIR=C:/Users/Administrator/iCloudDrive/Obsidian/Knowledge
   ```
3. 重启后端，新笔记即写入 iCloud 目录，自动同步到 Mac
4. Mac 端 Obsidian -> 打开文件夹作为 vault -> 选 iCloud Drive 里的那个目录

> 也可继续用默认本地 `vault/`，需要时再迁移。Docker 方式同理：把 `./vault` 换成 iCloud 路径，或改 `.env` 后重建。

---

## 会话临时目录

每次 `/api/process` 会把完整结果（URL、摘要、建议）以 JSON 存到系统临时目录
（`%TEMP%\knowledge-sessions\`）。前端「会话历史」可查看/清空。**删除它不影响 vault 笔记。**

---

## 常见问题

- **分析报 401 "Invalid or missing virtual key"**：`AI_API_KEY` 填错或不完整（比如只填了一截）。用 Ccswitch 里的完整 `ANTHROPIC_AUTH_TOKEN`（`ck_` 开头）。
- **分析报 502 / "请求内部 AI 失败"**：`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 没填或不对。
- **分析报 "AI 返回内容为空（模型只返回了思考内容…）"**：reasoning 模型思考用完了 `max_tokens`，调大 `AI_MAX_TOKENS`（如 8192/16384）。
- **抓取报连接超时**：目标站点不可达或被拦；换链接或检查网络。本环境对外网受限，部分站点可能超时。
- **前端显示「后端未连接」**：后端没启动，或 3000/8000 端口被占（本地 dev 和 Docker 不能同时跑）。
- **改了 `.env` 不生效**：uvicorn `--reload` 不一定会重读 `.env`（`get_settings` 有缓存）；`Ctrl+C` 重启后端。
- **改了后端代码不生效**：`--reload` 会自动重载；若没重载，重启 uvicorn（reload 模式有父子进程，需都结束）。
- **Python 3.8 安装报错**：已用 `eval_type_backport` 解决 pydantic `list[str]` 注解问题；升级到 3.9+ 后可移除该依赖。
- **Git Bash 里 `docker run` 路径变怪**（如 `/data/vault` 变成 `D:/software/Git/data/vault`）：MSYS 路径自动转换所致，命令前加 `MSYS_NO_PATHCONV=1`；`docker compose` 不受影响。

---

## 开发备注

- **后端分层**：服务模块（scraper/ai/vault/linker/session）各司其职，`main.py` 只做组装，路由按资源拆到 `routers/`。AI 调用用 `httpx` 直连（不依赖 `anthropic` SDK），规避 Python 3.8 版本约束、对内部代理路径可控。
- **前端分层**：`lib/api.ts`（唯一 fetch 入口）+ `lib/types.ts`（类型）+ `hooks/`（状态逻辑）+ `components/ui`（原语）+ 功能组件。`app/page.tsx` 是状态编排中枢。
- **类型对齐**：后端 `app/models.py` ↔ 前端 `lib/types.ts`，改 schema 时两边同步。
- **文件说明**：`folder-alias.json` 登记了所有文件/目录的中文说明；`private-folder-alias.json` 留给不便公开的备注（当前为空）。
