// Types mirroring the backend Pydantic models (backend/app/models.py).
// Keep these in sync when the backend schema changes.

export interface HealthStatus {
  status: string;
  notes_dir: string;
  llm_provider: string; // online | local | none
  llm_configured: boolean;
  llm_model: string;
  local_ready: boolean;
  notes_count: number;
}

export interface ScrapedPage {
  url: string;
  title: string;
  text: string;
  text_len: number;
}

export interface AnalysisResult {
  title: string;
  tldr: string;
  summary: string;
  key_points: string[];
  tags: string[];
  filename: string;
  domain: string;   // 内容领域（见后端 skills.py）
  diagram: string;  // mermaid 代码，空则无图
}

export interface RelatedSuggestion {
  filename: string;
  title: string;
  reason: string;
  score: number;
}

export interface ProcessResponse {
  note_filename: string;
  analysis: AnalysisResult;
  suggestions: RelatedSuggestion[];
}

export interface NoteMeta {
  filename: string;
  title: string;
  tags: string[];
  source?: string | null;
  created?: string | null;
  domain: string;
  mtime: string;
}

export interface NoteFull {
  filename: string;
  title: string;
  tags: string[];
  source?: string | null;
  created?: string | null;
  domain: string;
  body: string;
}

export interface LinkResponse {
  filename: string;
  added: string[];
  body: string;
}

export interface SessionSummary {
  file: string;
  saved_at?: string | null;
  url?: string | null;
  note_filename?: string | null;
  title?: string | null;
  tldr?: string | null;
  tags: string[];
}

export interface SessionDetail extends SessionSummary {
  domain?: string;
  key_points?: string[];
  summary?: string;
  diagram?: string;
  suggestions?: RelatedSuggestion[];
}

export interface ClearResponse {
  cleared: number;
}

// ---------- Settings（配置页：LLM 选择 / 在线 API / 本地模型 / 应用配置） ----------
export interface SettingsView {
  // LLM 选择
  llm_provider: string; // online | local | none
  llm_configured: boolean;
  // 在线 API
  llm_api_format: string; // anthropic | openai
  llm_base_url: string;
  llm_api_path: string;
  llm_api_key: string; // 掩码
  llm_api_key_configured: boolean;
  llm_model: string;
  llm_anthropic_version: string;
  llm_max_tokens: number;
  llm_timeout: number;
  // 本地模型
  local_llm_server_path: string;
  local_llm_model_path: string;
  local_llm_port: number;
  local_llm_gpu_layers: number;
  local_llm_ctx_size: number;
  local_ready: boolean;
  // 应用配置
  notes_dir: string;
  cors_origins: string;
  embedding_model: string;
}

export interface SettingsUpdate {
  llm_provider?: string;
  llm_api_format?: string;
  llm_base_url?: string;
  llm_api_path?: string;
  llm_api_key?: string; // 留空 = 不改
  llm_model?: string;
  llm_anthropic_version?: string;
  llm_max_tokens?: number;
  llm_timeout?: number;
  local_llm_server_path?: string;
  local_llm_model_path?: string;
  local_llm_port?: number;
  local_llm_gpu_layers?: number;
  local_llm_ctx_size?: number;
  notes_dir?: string;
  cors_origins?: string;
  embedding_model?: string;
}

// 拉取可用模型列表：用配置页表单当前值（可能尚未保存）去探测，留空回退已保存配置
export interface FetchModelsRequest {
  base_url?: string;
  api_key?: string;
  api_format?: string;
  anthropic_version?: string;
}

export interface ModelsResponse {
  models: string[];
}

// 领域 -> 中文标签（与后端 skills.py 对齐）
export const DOMAIN_LABELS: Record<string, string> = {
  tech: "技术/工程",
  tutorial: "教程/指南",
  product: "产品/商业",
  finance: "金融/数据",
  academic: "学术/研究",
  news: "资讯/动态",
  opinion: "观点/评论",
  general: "通用",
};

// ---------- 知识图谱 ----------
export interface GraphNode {
  id: string;
  title: string;
  domain: string;
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------- 对话区 ----------
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------- 语义检索 ----------
export interface EmbeddingsStatus {
  available: boolean;
  model: string;
  indexed_notes: number;
}
