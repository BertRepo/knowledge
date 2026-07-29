"use client";
import { FormEvent, useState } from "react";
import { Button } from "./ui/Button";
import { ErrorBanner } from "./ui/ErrorBanner";

interface UrlFormProps {
  onProcess: (url: string, customTitle?: string) => Promise<void>;
  loading: boolean;
}

/** 链接输入框：C 端主入口，粘贴链接即可生成笔记。 */
export function UrlForm({ onProcess, loading }: UrlFormProps) {
  const [url, setUrl] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setLocalError("请输入网页链接");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setLocalError("链接格式不正确，请输入完整网址（含 https://）");
      return;
    }
    setLocalError(null);
    await onProcess(trimmed, customTitle.trim() || undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴链接，生成笔记…"
          className="apple-input h-11 flex-1 px-4 text-sm outline-none"
        />
        <Button type="submit" loading={loading} className="h-11 px-6">
          {loading ? "生成中" : "生成笔记"}
        </Button>
      </div>
      <input
        type="text"
        value={customTitle}
        onChange={(e) => setCustomTitle(e.target.value)}
        placeholder="标题（可选，留空 AI 自动生成）"
        className="apple-input h-9 w-full px-3.5 text-sm outline-none"
      />
      {localError && <ErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
    </form>
  );
}
