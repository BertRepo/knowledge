"use client";
// 建议关联列表：用户勾选 AI 建议的笔记，确认后批量写入 [[wikilink]]。
//
// 选中态用 Set<string> 而不是数组：toggle 时 O(1) 增删，且天然去重。
// 切换时复制一个新 Set 再改（不可变更新），React 才能感知变化重渲染。
import { useState } from "react";
import type { RelatedSuggestion } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface SuggestionListProps {
  suggestions: RelatedSuggestion[];
  noteFilename: string;
  /** 确认关联选中的目标；返回实际新增的列表（已去重）。 */
  onLink: (targets: string[]) => Promise<string[]>;
  onRelink?: () => Promise<void>;
  /** 语义召回：用本地 embedding 向量检索补充建议（与 LLM 建议互补）。 */
  onSemanticRelink?: () => Promise<void>;
  relinkLoading?: boolean;
}

export function SuggestionList({
  suggestions,
  noteFilename,
  onLink,
  onRelink,
  onSemanticRelink,
  relinkLoading,
}: SuggestionListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 切换某条建议的选中态：复制 Set -> 增/删 -> 返回新 Set
  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
    setMsg(null);
  }

  async function confirm() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const added = await onLink([...selected]); // Set -> 数组传给后端
      setMsg(added.length ? `已关联 ${added.length} 篇：${added.join(", ")}` : "没有新增关联（可能已存在）");
      setSelected(new Set()); // 清空选中
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="AI 建议关联"
      actions={
        <div className="flex items-center gap-1.5">
          {onSemanticRelink && (
            <Button variant="ghost" size="sm" onClick={onSemanticRelink} loading={relinkLoading}>
              语义召回
            </Button>
          )}
          {onRelink && (
            <Button variant="ghost" size="sm" onClick={onRelink} loading={relinkLoading}>
              重新建议
            </Button>
          )}
        </div>
      }
    >
      {suggestions.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {noteFilename ? "暂无关联建议，可稍后点“重新建议”，或手动添加链接。" : "分析后这里会显示与已有笔记的关联建议。"}
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s) => {
            const checked = selected.has(s.filename);
            return (
              <li key={s.filename}>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors ${
                    checked
                      ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.filename)}
                    className="mt-0.5"
                  />
                  <span className="flex-1 text-sm">
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">{s.title || s.filename}</span>
                    <span className="ml-2 font-mono text-xs text-zinc-400">{s.filename}</span>
                    {s.reason && <span className="block text-xs text-zinc-500">{s.reason}</span>}
                  </span>
                  <span className="text-xs tabular-nums text-zinc-400">{(s.score * 100).toFixed(0)}%</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" onClick={confirm} loading={busy} disabled={selected.size === 0}>
            确认关联{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
          {msg && <span className="text-xs text-zinc-500">{msg}</span>}
        </div>
      )}
    </Card>
  );
}
