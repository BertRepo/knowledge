"use client";
import { FormEvent, useState } from "react";
import { Button } from "./ui/Button";
import { ErrorBanner } from "./ui/ErrorBanner";

interface UrlFormProps {
  onProcess: (url: string, customTitle?: string) => Promise<void>;
  loading: boolean;
}

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
      setLocalError("链接格式不正确");
      return;
    }
    setLocalError(null);
    await onProcess(trimmed, customTitle.trim() || undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴网页链接 https://…"
          className="h-10 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <Button type="submit" loading={loading}>
          分析并保存
        </Button>
      </div>
      <input
        type="text"
        value={customTitle}
        onChange={(e) => setCustomTitle(e.target.value)}
        placeholder="可选：自定义笔记标题（留空由 AI 生成）"
        className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      {localError && <ErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
    </form>
  );
}
