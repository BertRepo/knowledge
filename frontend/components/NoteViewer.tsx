"use client";
import { useEffect, useState } from "react";
import { ApiError, getNote } from "@/lib/api";
import type { NoteFull } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Markdown } from "./ui/Markdown";
import { Spinner } from "./ui/Spinner";
import { Tag } from "./ui/Tag";

interface NoteViewerProps {
  /** 要读取的笔记文件名主干；为 null 时不渲染内容区。 */
  filename: string | null;
  /** 可选：返回分析视图的回调。传入时显示「返回分析」按钮。 */
  onBack?: () => void;
}

/**
 * 笔记阅读器：按文件名加载笔记并在主区域全幅展示。
 *
 * 设计要点：
 * - 用 useEffect + cancelled 标志处理异步竞态：filename 快速切换时，
 *   旧请求的回调不会覆盖新状态（避免闪烁错乱）。
 * - onBack 让用户从「读笔记」回到「看分析结果」，两者共用主区域。
 */
export function NoteViewer({ filename, onBack }: NoteViewerProps) {
  const [note, setNote] = useState<NoteFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filename 变化时在渲染期间重置状态（React 推荐的「prop 变化时调整 state」模式，
  // 用 useState 存上一次值，条件判断保证只在真正变化时执行，避免死循环）。
  const [lastFile, setLastFile] = useState(filename);
  if (lastFile !== filename) {
    setLastFile(filename);
    setNote(null);
    setError(null);
    setLoading(!!filename);
  }

  useEffect(() => {
    if (!filename) return;
    // cancelled 标志防止竞态：如果 filename 在请求完成前又变了，
    // 旧请求回来时不应该覆盖新状态。
    let cancelled = false;
    getNote(filename)
      .then((n) => !cancelled && setNote(n))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filename]);

  return (
    <Card
      title={note ? note.title : "笔记"}
      actions={
        onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← 返回分析
          </Button>
        )
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner className="h-4 w-4" /> 加载中…
        </div>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : !filename ? (
        <p className="text-sm text-zinc-500">从右侧选择一篇笔记查看内容。</p>
      ) : note ? (
        <div className="space-y-3">
          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {note.tags.map((t) => (
                <Tag key={t}>#{t}</Tag>
              ))}
            </div>
          )}
          <Markdown>{note.body}</Markdown>
          {note.source && (
            <p className="text-xs text-zinc-400">
              来源：<a href={note.source} target="_blank" rel="noreferrer" className="underline">{note.source}</a>
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
