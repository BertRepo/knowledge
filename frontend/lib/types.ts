// Types mirroring the backend Pydantic models (backend/app/models.py).
// Keep these in sync when the backend schema changes.

export interface HealthStatus {
  status: string;
  vault: string;
  ai_configured: boolean;
  ai_endpoint: string;
  ai_model: string;
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

// ---------- Settings (API 配置页) ----------
export interface SettingsView {
  ai_base_url: string;
  ai_api_path: string;
  ai_api_key: string; // 掩码
  ai_api_key_configured: boolean;
  ai_model: string;
  ai_anthropic_version: string;
  ai_max_tokens: number;
  ai_timeout: number;
  notes_dir: string;
  cors_origins: string;
}

export interface SettingsUpdate {
  ai_base_url?: string;
  ai_api_path?: string;
  ai_api_key?: string; // 留空 = 不改
  ai_model?: string;
  ai_anthropic_version?: string;
  ai_max_tokens?: number;
  ai_timeout?: number;
  notes_dir?: string;
  cors_origins?: string;
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
