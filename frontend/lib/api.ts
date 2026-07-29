// 后端 API 的类型化客户端。所有网络请求的唯一入口：
// 组件和 hooks 只调用这里导出的函数，绝不直接 fetch()。
// 这样后端地址/错误处理/请求格式只在这一个文件里维护。
import type {
  ChatMessage,
  ClearResponse,
  EmbeddingsStatus,
  FetchModelsRequest,
  GraphData,
  HealthStatus,
  LinkResponse,
  ModelsResponse,
  NoteFull,
  NoteMeta,
  ProcessResponse,
  RelatedSuggestion,
  ScrapedPage,
  SessionDetail,
  SessionSummary,
  SettingsUpdate,
  SettingsView,
} from "./types";

// 后端地址：优先用环境变量 NEXT_PUBLIC_API_BASE（构建时注入），
// 没配就回退本地开发地址。NEXT_PUBLIC_ 前缀让 Next.js 把它暴露给浏览器。
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

// 自定义错误类：比原生 Error 多带一个 HTTP 状态码，
// 调用方可以据此区分「网络不通(0)」「404」「502」等情况。
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // 统一的 fetch 封装：处理网络错误、HTTP 错误、空响应体。
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    // fetch 抛异常通常是网络层问题（后端没启动 / 跨域被拦 / DNS 失败）
    throw new ApiError(
      "无法连接后端，请确认 Python 服务已启动",
      0,
    );
  }
  if (!res.ok) {
    // HTTP 4xx/5xx：尝试从响应体取 detail 字段（FastAPI 的错误格式）
    let detail = `${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {
      /* 响应体不是 JSON，保留状态码作为错误信息 */
    }
    throw new ApiError(detail, res.status);
  }
  // 204 No Content 或空 body 时 text() 返回空串，需要返回 null 而不是解析空 JSON
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// POST + JSON body 的快捷封装
function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

// ---- 系统 ----
export const getHealth = () => apiFetch<HealthStatus>("/api/health");

// ---- 抓取 / 分析 / 关联 ----
export const scrapeUrl = (url: string) =>
  postJson<ScrapedPage>("/api/scrape", { url });

export const processUrl = (url: string, opts?: { custom_title?: string; max_suggestions?: number }) =>
  postJson<ProcessResponse>("/api/process", { url, ...opts });

// 流式分析回调：摘要增量、完成、出错分别回调
export interface StreamCallbacks {
  onSummary: (chunk: string) => void;
  onDone: (result: ProcessResponse) => void;
  onError: (message: string) => void;
}

/**
 * 流式分析：POST /api/process/stream，用 fetch + ReadableStream 消费 SSE。
 *
 * 不用 EventSource 的原因：EventSource 只支持 GET，这里要 POST 请求体。
 * 手动解析 SSE：按 "\n\n" 切分事件，每事件按行取 event: 和 data:。
 */
export async function processUrlStream(
  url: string,
  opts: { custom_title?: string; max_suggestions?: number } | undefined,
  callbacks: StreamCallbacks,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/process/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...opts }),
    });
  } catch {
    callbacks.onError("无法连接后端，请确认 Python 服务已启动");
    return;
  }

  if (!res.ok || !res.body) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* 响应体非 JSON，用状态码兜底 */
    }
    callbacks.onError(detail);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以空行分隔；最后一段可能不完整，留在 buffer 等下次拼接
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      let event = "message";
      let data = "";
      for (const line of evt.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        if (event === "summary") callbacks.onSummary(parsed.chunk);
        else if (event === "done") callbacks.onDone(parsed as ProcessResponse);
        else if (event === "error") callbacks.onError(parsed.detail);
      } catch {
        /* 单条事件 JSON 解析失败不影响后续 */
      }
    }
  }
}

export const relateNote = (filename: string, max_suggestions = 6) =>
  postJson<RelatedSuggestion[]>("/api/relate", { filename, max_suggestions });

// ---- 笔记 ----
export const listNotes = () => apiFetch<NoteMeta[]>("/api/notes");

export const getNote = (filename: string) =>
  apiFetch<NoteFull>(`/api/notes/${encodeURIComponent(filename)}`);

// 在线编辑笔记正文（保留 frontmatter）
export const updateNote = (filename: string, body: string) =>
  apiFetch<NoteFull>(`/api/notes/${encodeURIComponent(filename)}`, {
    method: "PUT",
    body: JSON.stringify({ body }),
  });

export const linkNotes = (filename: string, targets: string[]) =>
  postJson<LinkResponse>("/api/link", { filename, targets });

// ---- 知识图谱 ----
export const getGraph = () => apiFetch<GraphData>("/api/graph");

// ---- 会话（一次性临时历史） ----
export const listSessions = () => apiFetch<SessionSummary[]>("/api/sessions");

export const getSession = (file: string) =>
  apiFetch<SessionDetail>(`/api/sessions/${encodeURIComponent(file)}`);

export const clearSessions = () =>
  apiFetch<ClearResponse>("/api/sessions", { method: "DELETE" });

// ---- 对话区（流式追问，基于当前笔记） ----
// 回调：token 增量、回答结束、出错分别回调。复用与 processUrlStream 一致的手写 SSE 解析。
export interface ChatStreamCallbacks {
  onToken: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * 流式对话：POST /api/chat/stream，消费 SSE。
 * 后端按当前笔记 + 关联笔记构建上下文，前端只传对话历史。
 */
export async function chatStream(
  noteFilename: string,
  messages: ChatMessage[],
  callbacks: ChatStreamCallbacks,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_filename: noteFilename, messages }),
    });
  } catch {
    callbacks.onError("无法连接后端，请确认 Python 服务已启动");
    return;
  }

  if (!res.ok || !res.body) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* 响应体非 JSON，用状态码兜底 */
    }
    callbacks.onError(detail);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      let event = "message";
      let data = "";
      for (const line of evt.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        if (event === "token") callbacks.onToken(parsed.delta);
        else if (event === "done") callbacks.onDone();
        else if (event === "error") callbacks.onError(parsed.detail);
      } catch {
        /* 单条事件 JSON 解析失败不影响后续 */
      }
    }
  }
}

// ---- 设置（API 配置页） ----
export const getSettings = () => apiFetch<SettingsView>("/api/settings");

export const updateSettings = (body: SettingsUpdate) =>
  apiFetch<SettingsView>("/api/settings", { method: "PUT", body: JSON.stringify(body) });

// 拉取在线 API 的可用模型列表（配置页「拉取模型」按钮用）
export const fetchModels = (body: FetchModelsRequest) =>
  postJson<ModelsResponse>("/api/settings/models", body);

// ---- 语义检索（本地 embedding） ----
// 向量召回关联笔记，与 LLM 关联建议互补：快、免费、覆盖面广。
export const relateSemantic = (filename: string, top_k = 6) =>
  postJson<RelatedSuggestion[]>("/api/relate-semantic", { filename, top_k });

// 用一段文本语义搜索整个笔记库（工作台搜索框用）
export const semanticSearch = (query: string, top_k = 6) =>
  postJson<RelatedSuggestion[]>("/api/search", { query, top_k });

// 向量检索是否可用（模型是否加载）
export const getEmbeddingsStatus = () =>
  apiFetch<EmbeddingsStatus>("/api/embeddings/status");
