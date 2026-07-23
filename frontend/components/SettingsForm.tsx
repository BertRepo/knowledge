"use client";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, getSettings, updateSettings } from "@/lib/api";
import type { SettingsView, SettingsUpdate } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ErrorBanner } from "./ui/ErrorBanner";

// 字段定义：分组展示。group 决定渲染在哪个分区。
type FieldDef = {
  key: keyof SettingsUpdate;
  label: string;
  placeholder: string;
  help?: string;
  type?: "text" | "password" | "number";
  group: "provider" | "online" | "local" | "app";
};

const FIELDS: FieldDef[] = [
  // 在线 API
  { key: "llm_api_format", label: "API 格式", placeholder: "anthropic 或 openai", help: "anthropic=/v1/messages，openai=/v1/chat/completions", group: "online" },
  { key: "llm_base_url", label: "API 地址", placeholder: "https://api.anthropic.com", help: "不带尾斜杠", group: "online" },
  { key: "llm_api_path", label: "API 路径", placeholder: "/v1/messages", group: "online" },
  { key: "llm_api_key", label: "API 密钥", placeholder: "留空=不修改；填新值则覆盖", type: "password", group: "online" },
  { key: "llm_model", label: "模型名", placeholder: "claude-sonnet-5", group: "online" },
  { key: "llm_anthropic_version", label: "Anthropic 版本", placeholder: "2023-06-01", help: "仅 anthropic 格式用", group: "online" },
  { key: "llm_max_tokens", label: "max_tokens", placeholder: "2048", type: "number", group: "online" },
  { key: "llm_timeout", label: "超时(秒)", placeholder: "120", type: "number", group: "online" },
  // 本地模型
  { key: "local_llm_server_path", label: "llama-server 路径", placeholder: "C:/.../llama-server.exe", help: "编译好的 llama.cpp 可执行文件", group: "local" },
  { key: "local_llm_model_path", label: "GGUF 模型路径", placeholder: "C:/.../qwen2.5-1.5b-instruct-q4_k_m.gguf", help: "推荐 qwen2.5-1.5b（中文好、1.1GB）", group: "local" },
  { key: "local_llm_port", label: "端口", placeholder: "8080", type: "number", group: "local" },
  { key: "local_llm_gpu_layers", label: "GPU 层数", placeholder: "0", type: "number", help: "0=纯 CPU；Mac Metal 可调大", group: "local" },
  { key: "local_llm_ctx_size", label: "上下文长度", placeholder: "4096", type: "number", group: "local" },
  // 应用配置
  { key: "notes_dir", label: "笔记目录", placeholder: "f:/myWorkspacePrivate/knowledge/vault", help: "可填 iCloud/Git 同步路径", group: "app" },
  { key: "cors_origins", label: "CORS 允许来源", placeholder: "http://localhost:3000", group: "app" },
];

const GROUP_TITLES: Record<string, string> = {
  provider: "LLM 选择",
  online: "在线 LLM API（云端大模型）",
  local: "本地 LLM（llama.cpp，离线）",
  app: "应用配置",
};

export function SettingsForm() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  // 按 group 分组字段
  const groups: FieldDef["group"][] = ["online", "local", "app"];

  return (
    <Card
      title="配置"
      actions={view && <span className="text-xs text-zinc-400">密钥：{view.llm_api_key}</span>}
    >
      {error && <div className="mb-3"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}

      {/* LLM 选择：online / local / none，单选切换 */}
      <div className="mb-4">
        <span className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
          LLM 来源（用哪个模型生成摘要）
        </span>
        <div className="flex gap-2">
          {[
            { v: "online", label: "在线 API", hint: "云端大模型，能力强" },
            { v: "local", label: "本地模型", hint: "llama.cpp，离线免费" },
            { v: "none", label: "未配置", hint: "暂不使用 AI" },
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
            当前来源未配置完整：{form.llm_provider === "online" ? "请填 API 密钥与地址" : form.llm_provider === "local" ? "请填 llama-server 与模型路径" : "请选择在线或本地"}
          </p>
        )}
        {view && form.llm_provider === "local" && (
          <p className="mt-1.5 text-xs text-zinc-400">
            本地模型状态：{view.local_ready ? "✅ llama-server 运行中" : "⚪ 未启动（首次调用 AI 时自动启动）"}
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
                <input
                  type={f.type === "password" ? "password" : "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                {f.help && <span className="mt-0.5 block text-xs text-zinc-400">{f.help}</span>}
              </label>
            ))}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>保存</Button>
          {saved && <span className="text-xs text-emerald-600">已保存，后端已热加载</span>}
        </div>
      </form>
    </Card>
  );
}
