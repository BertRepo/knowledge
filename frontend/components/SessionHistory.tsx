"use client";
import type { SessionSummary } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface SessionHistoryProps {
  sessions: SessionSummary[];
  selectedFile: string | null;
  onSelect: (file: string) => void;
  onClear: () => Promise<void>;
  loading: boolean;
}

export function SessionHistory({
  sessions,
  selectedFile,
  onSelect,
  onClear,
  loading,
}: SessionHistoryProps) {
  return (
    <Card
      title={`会话历史 (${sessions.length})`}
      actions={
        <Button variant="danger" size="sm" onClick={onClear} disabled={sessions.length === 0}>
          清空
        </Button>
      }
    >
      <p className="mb-2 text-xs text-zinc-400">
        每次分析的快照，存在系统临时目录，可随时删除，不影响笔记库。
      </p>
      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-500">{loading ? "加载中…" : "暂无会话。"}</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <li key={s.file}>
              <button
                type="button"
                onClick={() => onSelect(s.file)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  selectedFile === s.file
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="block truncate">{s.title || s.note_filename || "(无标题)"}</span>
                <span className="block truncate text-xs opacity-60">
                  {s.saved_at} · {s.url}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
