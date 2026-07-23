"use client";
import { useEffect, useState } from "react";
import { ApiError, getNote, updateNote } from "@/lib/api";
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
  /** 笔记被编辑后通知父组件（刷新笔记列表/图谱等）。 */
  onEdited?: () => void;
}

/**
 * 笔记阅读器：按文件名加载笔记并在主区域全幅展示，支持在线编辑正文。
 *
 * 两种模式：
 *  - view（默认）：Markdown 渲染阅读
 *  - edit：textarea 编辑正文，保存走 PUT /api/notes/{filename}，
 *          后端保留 frontmatter 只替换正文。
 *
 * 设计要点：
 * - filename 变化时重置状态（React 推荐的「prop 变化时调整 state」）。
 * - cancelled 标志防异步竞态：filename 快速切换时旧请求不覆盖新状态。
 * - 编辑态用独立 draft 文本，保存成功后才并回 note。
 */
export function NoteViewer({ filename, onBack, onEdited }: NoteViewerProps) {
  const [note, setNote] = useState<NoteFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // filename 变化时重置状态（避免切笔记时残留旧内容）
  const [lastFile, setLastFile] = useState(filename);
  if (lastFile !== filename) {
    setLastFile(filename);
    setNote(null);
    setError(null);
    setEditing(false);
    setLoading(!!filename);
  }

  useEffect(() => {
    if (!filename) return;
    let cancelled = false;
    getNote(filename)
      .then((n) => !cancelled && setNote(n))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filename]);

  // 进入编辑：把当前正文拷进 draft 作为初值
  function startEdit() {
    if (!note) return;
    setDraft(note.body);
    setEditing(true);
  }

  // 保存：PUT 正文，成功后并回 note 并退出编辑
  async function save() {
    if (!filename) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateNote(filename, draft);
      setNote(updated);
      setEditing(false);
      onEdited?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={note ? note.title : "笔记"}
      actions={
        <div className="flex items-center gap-1.5">
          {note && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit}>
              编辑
            </Button>
          )}
          {editing && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </Button>
              <Button size="sm" onClick={save} loading={saving}>
                保存
              </Button>
            </>
          )}
          {onBack && !editing && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              ← 返回分析
            </Button>
          )}
        </div>
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
        editing ? (
          /* 编辑态：textarea 直接改 Markdown 正文，保存后由后端保留 frontmatter */
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[24rem] w-full resize-y rounded-md border border-zinc-300 bg-white p-3 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="编辑笔记正文（Markdown）…"
          />
        ) : (
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
        )
      ) : null}
    </Card>
  );
}
