# 技术方案文档

> 知识聚合器：网页 → AI 摘要 → Markdown 笔记 → `[[wikilink]]` 知识网络
> 最后更新：2026-07-22

本文档面向开发者与面试场景，覆盖：架构设计、技术难点、代码导读、简历写法、Tauri 打包方案。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  前端（Next.js 16 / React 19 / Tailwind 4）              │
│  工作台模式（分析/阅读 + 对话区 + 会话）                  │
│  笔记库模式（知识图谱 + 笔记列表）                        │
└───────────────┬─────────────────────────────────────────┘
                │ fetch / SSE（流式）
┌───────────────▼─────────────────────────────────────────┐
│  后端（FastAPI / Python 3.11）                           │
│                                                          │
│  routers/   路由层（按资源拆分，薄）                      │
│    process  流式分析流水线（SSE）                         │
│    notes    笔记 CRUD + 编辑                             │
│    chat     对话追问（SSE）                               │
│    graph    知识图谱数据                                  │
│    search   向量语义检索                                  │
│    settings 配置热更新                                    │
│                                                          │
│  服务层（单一职责模块）                                   │
│    scraper   抓取 + 正文抽取（trafilatura/bs4 双策略）    │
│    providers LLM 提供方抽象（anthropic/openai/local）     │
│    ai        业务编排（分析/关联，调 providers）          │
│    skills    领域 Skill（内置 + 外部自定义）              │
│    vault     Markdown 笔记读写（frontmatter/wikilink）    │
│    linker    关联建议胶水层                               │
│    chat      对话上下文构建                               │
│    graph     图谱节点边提取                               │
│    embeddings 向量索引（sentence-transformers，增量缓存）│
│    session   临时会话快照                                 │
│    config    .env 配置 + 热更新                           │
│    sse       SSE 帧格式化（共用）                         │
└───────────────┬──────────────┬──────────────────────────┘
                │              │
        ┌───────▼───────┐  ┌──▼──────────────────────┐
        │ 文件系统        │  │ LLM 后端（可切换）       │
        │ notes/*.md     │  │  online: Anthropic/OpenAI│
        │ (笔记，可同步)  │  │  local: llama-server     │
        └────────────────┘  └──────────────────────────┘
```

**分层原则**：routers 只做 HTTP 适配，业务逻辑全在服务层模块；服务层不 import FastAPI，可独立测试；providers 层屏蔽 LLM 后端差异，ai.py 只调 providers 不关心格式。

---

## 2. 核心数据流

### 2.1 分析流水线（流式）
```
UrlForm → /api/process/stream(SSE) →
  scraper.scrape()                    抓取正文
  ai.analyze_stream()                 流式分析（摘要增量 + 元数据）
    └─ providers.complete_stream()    按 provider 调 LLM
  vault.save_note()                   写 .md（frontmatter + 正文 + mermaid）
  linker.suggest_for_analysis()       AI 关联建议（best-effort）
  session.save_session()              临时快照
  → SSE done 事件（完整结果）
前端 StreamingCard 实时渲染摘要 → onDone 切 AnalysisCard
```

### 2.2 对话追问（流式）
```
ChatPanel → /api/chat/stream(SSE) →
  chat._build_context()              当前笔记全文 + [[wikilink]] 关联笔记摘要
  providers.chat_stream()            多轮流式（带历史）
  → SSE token 事件（增量）
```

### 2.3 向量检索关联
```
/api/relate-semantic →
  embeddings.semantic_relate()
    _index.ensure()                  mtime 增量检查，变了才重建向量
    embed_query()                    sentence-transformers 编码
    matrix @ query                   余弦相似度（归一化向量点积）
    top-k                            排序返回
```

---

## 3. 技术难点与解决方案

### 难点 1：流式分析的「摘要 + 元数据」分离
**问题**：AI 分析既要流式输出摘要（用户实时看），又要返回结构化元数据（标题/标签/文件名）。普通做法只能等整个 JSON 返回。

**解决**（`ai.py:analyze_stream`）：设计特殊 prompt 让 AI 先输出摘要 Markdown，再输出分隔符 `<<<META>>>`，最后输出 JSON。流式解析时用 buffer 累积，在 buffer 里找分隔符——分隔符前是摘要（流式 yield），后是 JSON（累积后一次解析）。为防分隔符被切断在两个 chunk 之间，每次只输出 buffer 的「安全部分」（保留末尾与分隔符等长的字符不输出）。

**价值**：用户看到摘要「打字」出来，体验从「等 10 秒」变成「即时反馈」。

### 难点 2：多 LLM 后端统一（anthropic/openai/local）
**问题**：Anthropic 用 `/v1/messages`（content blocks），OpenAI 用 `/v1/chat/completions`（choices），本地 llama-server 虽是 OpenAI 兼容但要管理子进程生命周期。

**解决**（`providers.py`）：抽象 `complete/complete_stream/chat_stream` 三接口，内部按 `llm_provider` + `llm_api_format` 分发。local 后端懒启动 llama-server 子进程，轮询 `/health` 等就绪。上层 `ai.py` 完全不感知后端差异。

**价值**：用户在配置页切换 online/local，代码零改动；未来加新 provider 只改 providers.py。

### 难点 3：向量检索的增量缓存
**问题**：每次关联建议都重新编码所有笔记太慢（笔记多时秒级延迟）。

**解决**（`embeddings.py`）：按笔记文件 mtime 做缓存失效——只有笔记内容变了才重算它的向量，其余复用缓存矩阵。矩阵存内存，进程内有效。归一化向量后用矩阵点积算余弦相似度，O(n) 毫秒级。

### 难点 4：零依赖力导向图谱
**问题**：知识图谱用力导向图，但 d3/cytoscape 几百 KB，个人笔记库规模小不值得。

**解决**（`GraphView.tsx`）：手写力导向仿真——斥力（两两排斥）+ 弹簧引力（有边相连）+ 中心力 + 阻尼，requestAnimationFrame 驱动 220 帧收敛。用 DOM 直接更新 transform（比 setState 每帧重渲染便宜）。支持节点拖拽（拖拽期间跳过物理更新）、领域筛选、图谱上加连边。

### 难点 5：SSE 流式在 fetch（非 EventSource）下的解析
**问题**：EventSource 只支持 GET，分析接口要 POST 请求体。

**解决**（`api.ts:processUrlStream`）：手写 fetch + ReadableStream，按 `\n\n` 切分 SSE 事件，每事件按行取 `event:` 和 `data:`，JSON 解析后按事件类型回调。buffer 保留最后一段不完整事件等下次拼接。这套解析逻辑在 process/chat 两个流式接口复用。

### 难点 6：配置热更新不重启
**问题**：改配置要重启后端体验差。

**解决**（`config.py:update_env_file`）：写回 `.env`（保留注释/顺序），清 `get_settings` 的 `lru_cache`，下次调用读到新值。前端配置页 PUT 后即时生效。

### 难点 7：frontmatter 保留式编辑
**问题**：在线编辑笔记正文时，不能覆盖 frontmatter（title/source/tags 是结构化元数据）。

**解决**（`vault.py:update_note_body`）：解析出 frontmatter，只替换 body，重新拼装。用极简自写 frontmatter 解析器（写端是自己，只需扁平 key:value），不引 pyyaml。

---

## 4. 代码导读（面试必读）

按「读代码顺序」组织，从入口到细节：

### 4.1 后端入口
1. `backend/app/main.py` — 应用工厂：注册 7 个路由，CORS。读这个了解全局有哪些 API。
2. `backend/app/routers/process.py` — 核心流水线：`/api/process/stream` 是主链路，5 步串起 scraper→ai→vault→linker→session。**最先读这个**。

### 4.2 LLM 调用链（面试高频）
3. `backend/app/providers.py` — **多后端抽象的核心**。看 `_resolve_endpoint_and_format`（选后端）、`complete`/`complete_stream`/`chat_stream`（三接口）、`_ensure_llama_server`（local 子进程管理）。
4. `backend/app/ai.py` — 业务编排。`analyze_stream`（流式分析+分隔符解析）、`suggest_related`（关联建议+filename 白名单防幻觉）、`_extract_json`（JSON 兜底解析）。

### 4.3 笔记与图谱
5. `backend/app/vault.py` — Markdown 读写。`_parse_frontmatter`（极简解析）、`build_note_md`（笔记拼装）、`append_links`（wikilink 去重插入）、`update_note_body`（保留 frontmatter 编辑）。
6. `backend/app/graph.py` — 从所有笔记提取 `[[wikilink]]` 节点边，只连真实存在的笔记。
7. `backend/app/embeddings.py` — 向量索引。`_Index.ensure`（mtime 增量）、`search`（点积余弦）。

### 4.4 前端入口
8. `frontend/app/page.tsx` — 状态编排中枢。看 `handleProcess`（流式分析）、三态互斥（流式/阅读/分析）、两页切换。
9. `frontend/lib/api.ts` — 唯一 fetch 入口。`processUrlStream`/`chatStream`（SSE 手写解析）。
10. `frontend/components/GraphView.tsx` — 零依赖力导向图（物理仿真 + 拖拽 + 筛选）。
11. `frontend/components/ChatPanel.tsx` — 对话区（流式渲染 + 多轮历史）。

### 面试常问点
- **「流式怎么做的？」** → SSE，fetch+ReadableStream 手写解析，后端 StreamingResponse。摘要/元数据用分隔符分离。
- **「多模型怎么切换的？」** → providers 层抽象，config.llm_provider 路由，三接口屏蔽格式差异。
- **「向量检索怎么不慢？」** → mtime 增量缓存，归一化点积，毫秒级。
- **「图谱为什么不用 d3？」** → 个人笔记库规模小，手写力导向零依赖，省体积。
- **「防 AI 幻觉怎么做？」** → 关联建议 filename 白名单校验，模型编的笔记名直接丢弃。

---

## 5. 简历写法

### 项目标题
**知识聚合器 — AI 驱动的个人知识网络工具**（个人项目 / 开源）

### 一句话描述
粘贴网页链接，AI 自动结构化摘要并写入 Markdown 笔记，通过向量语义检索与 `[[wikilink]]` 逐步构建个人知识图谱；支持在线大模型 API 与本地离线模型（llama.cpp）切换，可打包为桌面客户端。

### 技术栈
Python 3.11 / FastAPI / sentence-transformers / llama.cpp · Next.js 16 / React 19 / Tailwind 4 · Tauri · SSE 流式 · Docker

### 核心亮点（挑 4-5 条，按你实际做的选）
- **多 LLM 后端统一抽象**：设计 providers 层屏蔽 Anthropic/OpenAI/本地 llama.cpp 三种后端的请求响应差异，配置页一键切换 online/local，上层业务代码零改动。
- **流式分析流水线**：用 SSE 实现摘要逐字渲染，设计「摘要 + 分隔符 + 元数据 JSON」prompt 格式，解决「既要流式输出又要结构化结果」的矛盾，首字延迟从 10s 降至 <1s。
- **本地向量检索**：sentence-transformers 编码笔记，按文件 mtime 增量缓存向量矩阵，归一化点积算余弦相似度，毫秒级语义召回关联笔记，替代昂贵的 LLM 逐条判断。
- **零依赖知识图谱**：手写力导向布局（斥力+弹簧+中心力+阻尼），原生 SVG + requestAnimationFrame，支持节点拖拽、领域筛选、图谱上加连边，不引入 d3/cytoscape。
- **配置热更新**：写回 .env + 清 lru_cache 实现配置即时生效，无需重启；frontmatter 保留式笔记编辑。
- **Tauri 桌面打包**：前端 + Python 后端 sidecar 打包为跨平台客户端（Mac/Win），自定义安装与笔记目录。

### 量化指标（有就写，没有就删）
- 分析成功率 XX%，流式首字 <1s
- 向量检索 XX 篇笔记 <XXms
- 本地 qwen2.5-1.5b 在 8G Mac Air 上 XX tokens/s

### 面试讲法（30 秒电梯陈述）
> 「我做了一个把网页变成知识图谱的工具。粘贴链接，AI 按领域 skill 结构化摘要，写 Markdown 笔记，再用向量检索找相关旧笔记建议 wikilink 关联。难点是流式分析既要实时输出又要结构化结果，我用分隔符分离解决了；多模型切换用 providers 抽象层；图谱手写力导向避免重依赖。支持在线 API 和本地 llama.cpp 切换，可打包桌面端。」

---

## 6. Tauri 打包方案

### 架构
```
Tauri 壳（Rust）
  ├── 前端（Next.js 静态导出，WebView 渲染）
  └── Python 后端（sidecar：打包为 .exe，启动时随主进程拉起）
       └── llama-server.exe + GGUF 模型（本地模型随包分发）
```

### 关键配置（src-tauri/tauri.conf.json）
- `bundle.identifier`：`com.yourbrand.knowledge`（商标）
- `bundle.icon`：自定义商标图标（.ico for Win, .icns for Mac）
- `sidecar`：`python-backend`（PyInstaller 打包的后端单文件）
- `app.security.csp`：允许连接本地 8000 端口

### 自定义安装/笔记目录
- 安装目录：Tauri 默认支持用户选安装路径（Win .exe installer / Mac .dmg）
- 笔记目录：首次启动检测，让用户选目录，写入 app data 目录的 config.json
- 模型目录：本地模型随包分发到 `resources/`，或让用户指定外部路径

### 跨平台
- **Mac Air 8+8G**：qwen2.5-1.5b（1.1GB）+ llama-server（Metal 加速，gpu_layers 调大）
- **Win**：同模型 + llama-server（CPU 或 CUDA）
- 两端共享同一份前端 + Python 后端，Tauri 处理平台差异

### 商标图标
准备 1024x1024 PNG 商标，用 `tauri icon` 生成各平台所需尺寸（.ico/.icns）。

### 打包步骤（简述）
1. `npm i -D @tauri-apps/cli && npx tauri init`
2. PyInstaller 打包后端：`pyinstaller --onefile app/main.py`
3. 配 sidecar + 图标 + bundle
4. `npx tauri build` → 产出 .exe（Win）/ .dmg（Mac）
