"use client";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, fetchModels, getSettings, updateSettings } from "@/lib/api";
import type { SettingsView, SettingsUpdate } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ErrorBanner } from "./ui/ErrorBanner";

// API 格式下拉选项
const API_FORMATS = [
  { value: "anthropic", label: "anthropic（/v1/messages）" },
  { value: "openai", label: "openai（/v1/chat/completions）" },
];

// 字段定义：分组展示。group 决定渲染在哪个分区。
type FieldDef = {
  key: keyof SettingsUpdate;
  label: string;
  placeholder: string;
  help?: string;
  type?: "text" | "password" | "number" | "select" | "combobox";
  // select：固定选项；combobox：可手动输入，也可从 options 里选
  options?: { value: string; label: string }[];
  group: "provider" | "online" | "local" | "app";
};

const FIELDS: FieldDef[] = [
  // 在线 API
  { key: "llm_api_format", label: "API 格式", placeholder: "anthropic 或 openai", help: "anthropic=/v1/messages，openai=/v1/chat/completions", type: "select", options: API_FORMATS, group: "online" },
  { key: "llm_base_url", label: "API 地址", placeholder: "https://api.anthropic.com", help: "不带尾斜杠", group: "online" },
  { key: "llm_api_path", label: "API 路径", placeholder: "/v1/messages", group: "online" },
  { key: "llm_api_key", label: "API 密钥", placeholder: "留空=不修改；填新值则覆盖", type: "password", group: "online" },
  { key: "llm_model", label: "模型名", placeholder: "claude-sonnet-5", help: "可点「拉取模型」从 API 获取下拉列表，或直接手输", type: "combobox", group: "online" },
  { key: "llm_anthropic_version", label: "Anthropic 版本", placeholder: "2023-06-01", help: "仅 anthropic 格式用", group: "online" },
  { key: "llm_max_tokens", label: "max_tokens", placeholder: "2048", type: "number", group: "online" },
  { key: "llm_timeout", label: "超时(秒)", placeholder: "120", type: "number", group: "online" },
  // 本地模型
  { key: "local_llm_server_path", label: "本地 AI 程序路径", placeholder: "C:/.../llama-server.exe", help: "llama.cpp 推理程序", group: "local" },
  { key: "local_llm_model_path", label: "模型文件路径", placeholder: "C:/.../qwen2.5-1.5b.gguf", help: "推荐 qwen2.5-1.5b（中文好、约 1GB）", group: "local" },
  { key: "local_llm_port", label: "端口", placeholder: "8080", type: "number", group: "local" },
  { key: "local_llm_gpu_layers", label: "GPU 加速层数", placeholder: "0", type: "number", help: "0 = 纯 CPU；Mac 可调大启用加速", group: "local" },
  { key: "local_llm_ctx_size", label: "上下文长度", placeholder: "4096", type: "number", group: "local" },
  // 应用配置
  { key: "notes_dir", label: "笔记保存位置", placeholder: "选择笔记保存的文件夹", help: "可设为 iCloud 同步文件夹，跨设备同步", group: "app" },
  { key: "cors_origins", label: "允许访问的来源", placeholder: "http://localhost:3000", group: "app" },
];

const GROUP_TITLES: Record<string, string> = {
  provider: "AI 来源",
  online: "在线 AI（云端大模型）",
  local: "本地 AI（离线运行）",
  app: "笔记与存储",
};

export function SettingsForm() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 拉取到的可用模型列表（llm_model combobox 的下拉项）
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelMsg, setModelMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setView(s);
        // 密钥不回填真实值（留空=不改）；其余字段回填当前值
        setForm({
          llm_provider: s.llm_provider,
          llm_api_format: s.llm_api_format,
          llm_base_url: s.llm_base_url,
          llm_api_path: s.llm_api_path,
          llm_model: s.llm_model,
          llm_anthropic_version: s.llm_anthropic_version,
          llm_max_tokens: String(s.llm_max_tokens),
          llm_timeout: String(s.llm_timeout),
          local_llm_server_path: s.local_llm_server_path,
          local_llm_model_path: s.local_llm_model_path,
          local_llm_port: String(s.local_llm_port),
          local_llm_gpu_layers: String(s.local_llm_gpu_layers),
          local_llm_ctx_size: String(s.local_llm_ctx_size),
          notes_dir: s.notes_dir,
          cors_origins: s.cors_origins,
          embedding_model: s.embedding_model,
        });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  // 拉取模型：用表单当前值（地址/密钥/格式），留空则后端回退已保存配置
  async function handleFetchModels() {
    setFetchingModels(true);
    setModelMsg(null);
    setError(null);
    try {
      const res = await fetchModels({
        base_url: form.llm_base_url,
        api_key: form.llm_api_key, // 留空时后端用已保存 key
        api_format: form.llm_api_format,
        anthropic_version: form.llm_anthropic_version,
      });
      setFetchedModels(res.models);
      if (res.models.length === 0) {
        setModelMsg({ ok: false, text: "接口返回空列表" });
      } else {
        setModelMsg({ ok: true, text: `拉取到 ${res.models.length} 个模型` });
      }
    } catch (e) {
      setModelMsg({ ok: false, text: e instanceof ApiError ? e.message : "拉取失败" });
    } finally {
      setFetchingModels(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    // 只提交有值且发生变化的字段；密钥仅当填了才提交
    const payload: SettingsUpdate = {};
    for (const f of FIELDS) {
      const val = (form[f.key] ?? "").trim();
      if (val === "") continue;
      if (f.key === "llm_api_key") {
        payload.llm_api_key = val;
        continue;
      }
      if (f.type === "number") {
        (payload as Record<string, unknown>)[f.key] = Number(val);
      } else {
        (payload as Record<string, unknown>)[f.key] = val;
      }
    }
    // provider 单独提交（它是选择框，可能未改）
    if (form.llm_provider) {
      payload.llm_provider = form.llm_provider;
    }
    try {
      const updated = await updateSettings(payload);
      setView(updated);
      setForm((f) => ({ ...f, llm_api_key: "" }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-500">加载配置中…</p>;

  // 按 provider 决定显示哪些分区：online 只显示在线 API，local 只显示本地模型，
  // none 两者都不显示；应用配置始终显示。
  const provider = form.llm_provider ?? "none";
  const showOnline = provider === "online";
  const showLocal = provider === "local";
  const groups: FieldDef["group"][] = [];
  if (showOnline) groups.push("online");
  if (showLocal) groups.push("local");
  groups.push("app");

  // 下拉/输入框统一样式
  const fieldClass =
    "h-10 w-full apple-input px-3.5 text-sm outline-none";

  return (
    <Card
      title="设置"
      actions={view && <span className="text-xs text-zinc-400">密钥：{view.llm_api_key}</span>}
    >
      {error && <div className="mb-3"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}

      {/* LLM 选择：online / local / none，单选切换 */}
      <div className="mb-4">
        <span className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
          选择 AI 来源
        </span>
        <div className="flex gap-2">
          {[
            { v: "online", label: "在线 AI", hint: "云端模型，效果更好" },
            { v: "local", label: "本地 AI", hint: "离线运行，完全免费" },
            { v: "none", label: "暂不使用", hint: "不启用 AI" },
          ].map((opt) => (
            <label
              key={opt.v}
              className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
                form.llm_provider === opt.v
                  ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
              }`}
            >
              <input
                type="radio"
                name="llm_provider"
                value={opt.v}
                checked={form.llm_provider === opt.v}
                onChange={(e) => setForm((prev) => ({ ...prev, llm_provider: e.target.value }))}
                className="hidden"
              />
              <span className="font-medium">{opt.label}</span>
              <span className="block text-xs text-zinc-400">{opt.hint}</span>
            </label>
          ))}
        </div>
        {view && !view.llm_configured && (
          <p className="mt-1.5 text-xs text-amber-600">
            当前来源未配置完整：{provider === "online" ? "请填写 API 密钥与地址" : provider === "local" ? "请设置本地 AI 程序与模型路径" : "请选择在线或本地"}
          </p>
        )}
        {view && provider === "local" && (
          <p className="mt-1.5 text-xs text-zinc-400">
            本地 AI 状态：{view.local_ready ? "✅ 运行中" : "⚪ 未启动（首次使用时自动启动）"}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {groups.map((g) => (
          <div key={g} className="space-y-3">
            <h3 className="border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              {GROUP_TITLES[g]}
            </h3>
            {FIELDS.filter((f) => f.group === g).map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">{f.label}</span>

                {f.type === "select" && (
                  <select
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className={fieldClass}
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}

                {f.type === "combobox" && (
                  <div className="space-y-1.5">
                    {/* 拉取到模型列表时显示下拉；否则纯文本输入 */}
                    {fetchedModels.length > 0 ? (
                      <select
                        value={fetchedModels.includes(form[f.key] ?? "") ? form[f.key] : ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        className={fieldClass}
                      >
                        <option value="">{form[f.key] ? `${form[f.key]}（不在列表）` : "选择模型…"}</option>
                        {fetchedModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className={fieldClass}
                      />
                    )}
                    {/* combobox 专属：拉取模型按钮（仅 llm_model 用） */}
                    {f.key === "llm_model" && (
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="ghost" size="sm" loading={fetchingModels} onClick={handleFetchModels}>
                          拉取可用模型
                        </Button>
                        {fetchedModels.length > 0 && (
                          <button
                            type="button"
                            onClick={() => { setFetchedModels([]); setModelMsg(null); }}
                            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          >
                            切回手输
                          </button>
                        )}
                        {modelMsg && (
                          <span className={`text-xs ${modelMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                            {modelMsg.text}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {(!f.type || f.type === "text" || f.type === "password" || f.type === "number") && (
                  <input
                    type={f.type === "password" ? "password" : f.type === "number" ? "text" : "text"}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className={fieldClass}
                  />
                )}
                {f.help && <span className="mt-0.5 block text-xs text-zinc-400">{f.help}</span>}
              </label>
            ))}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>保存</Button>
          {saved && <span className="text-xs text-emerald-600">已保存</span>}
        </div>
      </form>
    </Card>
  );
}
