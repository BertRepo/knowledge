# Changelog

本项目变更记录遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-07-21

首个正式版本：网页 -> 内部 AI 摘要 -> Obsidian 笔记 -> 关联建议 -> `[[wikilink]]` 知识网络。

### Added

- **核心流水线**：粘贴网页链接，后端五步处理（抓取正文 → AI 分析 → 写 Obsidian Markdown → AI 关联建议 → 会话快照）。
- **网页抓取**（`scraper.py`）：trafilatura 优先、BeautifulSoup 兜底，自动处理编码与超长内容截断。
- **AI 分析**（`ai.py`）：直连 Anthropic 兼容 `/v1/messages`，同时发送 `x-api-key` 与 `Authorization: Bearer` 双认证头；支持 reasoning 模型（自动跳过 `thinking` 块，正文为空时提示增大 `max_tokens`）。
- **领域 Skills**：自动识别内容领域（技术/产品/金融/学术/教程/资讯/通用），按领域套用不同摘要结构与图解策略。
- **图解生成**：摘要自动产出 Mermaid 流程图/脑图，Obsidian 原生渲染，前端亦渲染。
- **Obsidian Vault 读写**（`vault.py`）：YAML frontmatter、唯一文件名、`[[wikilink]]` 追加与去重。
- **会话快照**（`session.py`）：每次分析结果写入系统临时目录，可一键清空，不影响 vault。
- **前端交互页面**（Next.js 16 + React 19 + Tailwind v4）：URL 输入、分析卡片、关联建议勾选、手动添加链接、笔记库列表、笔记预览、会话历史、状态条。
- **API 配置页**（`/settings`）：网页内查看/修改 AI 凭证、模型、vault 路径，无需手动编辑 `.env`。
- **一键启动**：`start.sh`（Git Bash）/ `start.bat`（双击），自动建 venv、补依赖、起前后端。
- **Docker 部署**（`docker-compose.yml` + 双 Dockerfile）：前后端容器化，`output: standalone` 前端镜像，vault bind mount 持久化。
- **工程化**：`.gitignore`（密钥/依赖/用户数据全排除）、`folder-alias.json` 文件说明索引、CHANGELOG。
- **SEO 基线**：Next.js metadata、OpenGraph、`robots.ts`、`sitemap.ts`。

### Architecture

- **后端分层**：服务模块（`scraper`/`ai`/`vault`/`linker`/`session`/`skills`）单一职责 + `routers/` 按资源拆分 + `main.py` 薄应用工厂。AI 用 `httpx` 直连，不依赖 `anthropic` SDK。
- **前端分层**：`lib/api.ts`（唯一 fetch 入口）+ `lib/types.ts` + `hooks/`（状态）+ `components/ui`（原语）+ 功能组件。`app/page.tsx` 为状态编排中枢。
- **类型对齐**：后端 `models.py` ↔ 前端 `lib/types.ts`。

### Security

- AI 凭证仅存于 `backend/.env`（已 `.gitignore`），代码与文档无硬编码密钥。
- 关联建议结果做 filename 白名单校验，防 AI 幻觉出不存在的笔记。
- API 配置页仅返回密钥掩码（末 4 位），更新时留空则保留原值。

### Known Limitations

- 本环境对 Docker Hub / 部分外网访问受限，Docker 镜像拉取建议配置 registry mirror。
- iCloud 同步需先在 Windows 安装 iCloud for Windows，再改 `OBSIDIAN_VAULT_DIR`。
- Python 3.8 需 `eval_type_backport`；升级到 3.9+ 后可移除。

[1.0.0]: https://github.com/example/knowledge/releases/tag/v1.0.0
