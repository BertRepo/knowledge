"use client";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, getSettings, updateSettings } from "@/lib/api";
import type { SettingsView, SettingsUpdate } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ErrorBanner } from "./ui/ErrorBanner";

const FIELDS: { key: keyof SettingsUpdate; label: string; placeholder: string; help?: string }[] = [
  { key: "ai_base_url", label: "AI 接口地址", placeholder: "http://10.10.169.34:18080", help: "不带尾斜杠" },
  { key: "ai_api_path", label: "AI 路径", placeholder: "/v1/messages" },
  { key: "ai_api_key", label: "AI 密钥", placeholder: "留空 = 不修改；填新值则覆盖", help: "ck_ 开头的 token" },
  { key: "ai_model", label: "模型名", placeholder: "doubao-seed-2.0-pro" },
  { key: "ai_max_tokens", label: "max_tokens", placeholder: "8192", help: "reasoning 模型建议 ≥8192" },
  { key: "ai_timeout", label: "超时(秒)", placeholder: "120" },
  { key: "notes_dir", label: "笔记目录", placeholder: "f:/myWorkspacePrivate/knowledge/vault", help: "可填 iCloud / Git 同步路径" },
  { key: "cors_origins", label: "CORS 允许来源", placeholder: "http://localhost:3000" },
];

export function SettingsForm() {
  const [view, setView] = useState<SettingsView | null>(null);
  // 表单值（只放用户可编辑的字段；string 形式便于 input）
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setView(s);
        // api_key 不回填真实值，留空表示不改
        setForm({
          ai_base_url: s.ai_base_url,
          ai_api_path: s.ai_api_path,
          ai_model: s.ai_model,
          ai_max_tokens: String(s.ai_max_tokens),
          ai_timeout: String(s.ai_timeout),
          notes_dir: s.notes_dir,
          cors_origins: s.cors_origins,
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
    // 只提交有值且发生变化的字段；api_key 仅当用户填了才提交
    const payload: SettingsUpdate = {};
    for (const f of FIELDS) {
      const val = (form[f.key] ?? "").trim();
      if (val === "") continue;
      if (f.key === "ai_api_key") {
        payload.ai_api_key = val;
        continue;
      }
      if (f.key === "ai_max_tokens" || f.key === "ai_timeout") {
        (payload as Record<string, unknown>)[f.key] = Number(val);
      } else {
        (payload as Record<string, unknown>)[f.key] = val;
      }
    }
    try {
      const updated = await updateSettings(payload);
      setView(updated);
      // 清空 key 输入框（已保存）
      setForm((f) => ({ ...f, ai_api_key: "" }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-500">加载配置中…</p>;

  return (
    <Card title="API 配置" actions={view && <span className="text-xs text-zinc-400">密钥：{view.ai_api_key}</span>}>
      {error && <div className="mb-3"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}
      <form onSubmit={submit} className="space-y-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">{f.label}</span>
            <input
              type={f.key === "ai_api_key" ? "password" : "text"}
              value={form[f.key] ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {f.help && <span className="mt-0.5 block text-xs text-zinc-400">{f.help}</span>}
          </label>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>保存</Button>
          {saved && <span className="text-xs text-emerald-600">已保存，后端已热加载</span>}
        </div>
      </form>
    </Card>
  );
}
