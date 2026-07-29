"use client";
import type { NoteMeta } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Tag } from "./ui/Tag";

interface NoteListProps {
  notes: NoteMeta[];
  selected: string | null;
  onSelect: (filename: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function NoteList({ notes, selected, onSelect, loading, onRefresh }: NoteListProps) {
  return (
    <Card
      title={`全部笔记 (${notes.length})`}
      actions={
        <Button variant="ghost" size="sm" onClick={onRefresh} loading={loading}>
          刷新
        </Button>
      }
    >
      {notes.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有笔记。分析一个网页链接后会自动保存到这里。</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {notes.map((n) => (
            <li key={n.filename}>
              <button
                type="button"
                onClick={() => onSelect(n.filename)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  selected === n.filename
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="block truncate font-medium">{n.title || n.filename}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs opacity-70">
                  <span>{n.mtime}</span>
                  {n.tags.slice(0, 2).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
