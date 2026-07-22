"use client";
/**
 * 主页面：整个前端的中枢，负责状态编排，把职责下放给各组件。
 *
 * 两类视图共用主区域（互斥）：
 *  - 分析视图：处理 URL 或恢复会话时展示，含 AnalysisCard + 关联建议 + 手动关联
 *  - 阅读视图：点击笔记列表某篇时展示，用 NoteViewer 全幅渲染笔记正文
 *
 * 关键状态：
 *  - result：当前分析结果（来自 /api/process 或从会话恢复），驱动分析视图
 *  - viewingNote：正在阅读的笔记文件名，非空时主区域切换到阅读视图
 *  - selectedNote / selectedSession：仅控制侧栏列表的高亮，不决定主区域内容
 *
 * 数据流（分析）：UrlForm -> handleProcess -> /api/process -> setResult ->
 *   AnalysisCard 展示 + SuggestionList 给建议 -> 用户勾选 -> handleLink ->
 *   /api/link 写 [[wikilink]] -> notes.refresh() 刷新侧栏。
 *
 * 数据流（阅读）：NoteList -> handleSelectNote -> setViewingNote ->
 *   NoteViewer 自己按 filename 调 /api/notes/{filename} 加载正文。
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { ApiError, getSession, linkNotes, processUrlStream, relateNote } from "@/lib/api";
import type { ProcessResponse } from "@/lib/types";
import { useHealth } from "@/hooks/useHealth";
import { useNotes } from "@/hooks/useNotes";
import { useSessions } from "@/hooks/useSessions";
import { AnalysisCard } from "@/components/AnalysisCard";
import { ManualLinkInput } from "@/components/ManualLinkInput";
import { NoteList } from "@/components/NoteList";
import { NoteViewer } from "@/components/NoteViewer";
import { SessionHistory } from "@/components/SessionHistory";
import { StatusBar } from "@/components/StatusBar";
import { StreamingCard } from "@/components/StreamingCard";
import { SuggestionList } from "@/components/SuggestionList";
import { UrlForm } from "@/components/UrlForm";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function Page() {
  const health = useHealth();
  const notes = useNotes();
  const sessions = useSessions();

  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [lastUrl, setLastUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // 流式生成中已到达的摘要文本；非空时显示 StreamingCard，生成结束清空
  const [streamingSummary, setStreamingSummary] = useState<string | null>(null);
  // selectedNote：列表高亮（处理/恢复会话/点击笔记都会设）
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  // viewingNote：主区域正在阅读的笔记；非空时切到阅读视图，覆盖分析视图
  const [viewingNote, setViewingNote] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [relinkLoading, setRelinkLoading] = useState(false);

  const handleProcess = useCallback(
    async (url: string, customTitle?: string) => {
      setProcessing(true);
      setError(null);
      setStreamingSummary(""); // 进入流式状态，StreamingCard 显示
      setResult(null);
      // 用累积变量收集摘要，避免 setState 异步导致丢字符
      let acc = "";
      await processUrlStream(
        url,
        customTitle ? { custom_title: customTitle } : undefined,
        {
          onSummary: (chunk) => {
            acc += chunk;
            setStreamingSummary(acc);
          },
          onDone: (res) => {
            setResult(res);
            setLastUrl(url);
            setSelectedNote(res.note_filename);
            setViewingNote(null);
            setSelectedSession(null);
            setStreamingSummary(null); // 流结束，切到 AnalysisCard
            Promise.all([notes.refresh(), sessions.refresh()]);
          },
          onError: (msg) => {
            setError(msg);
            setStreamingSummary(null);
          },
        },
      );
      setProcessing(false);
    },
    [notes, sessions],
  );

  const handleLink = useCallback(
    async (targets: string[]) => {
      if (!result) return [] as string[];
      const added = (await linkNotes(result.note_filename, targets)).added;
      await notes.refresh();
      return added;
    },
    [result, notes],
  );

  const handleRelink = useCallback(async () => {
    if (!result) return;
    setRelinkLoading(true);
    try {
      const sugg = await relateNote(result.note_filename);
      setResult({ ...result, suggestions: sugg });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "重新建议失败");
    } finally {
      setRelinkLoading(false);
    }
  }, [result]);

  const handleSelectSession = useCallback(async (file: string) => {
    setSelectedSession(file);
    setError(null);
    try {
      const d = await getSession(file);
      setResult({
        note_filename: d.note_filename || "",
        analysis: {
          title: d.title || "",
          tldr: d.tldr || "",
          summary: d.summary || "",
          key_points: d.key_points || [],
          tags: d.tags || [],
          filename: d.note_filename || "",
          domain: d.domain || "general",
          diagram: d.diagram || "",
        },
        suggestions: d.suggestions || [],
      });
      setLastUrl(d.url || undefined);
      setViewingNote(null); // 恢复会话 -> 回到分析视图
      if (d.note_filename) setSelectedNote(d.note_filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载会话失败");
    }
  }, []);

  // 点击笔记列表：切到阅读视图，在主区域全幅展示该笔记
  const handleSelectNote = useCallback((filename: string) => {
    setSelectedNote(filename);
    setViewingNote(filename);
    setSelectedSession(null);
  }, []);

  // 从阅读视图返回分析视图（仅当有分析结果时才有意义）
  const handleBackToAnalysis = useCallback(() => {
    setViewingNote(null);
  }, []);

  const handleClearSessions = useCallback(async () => {
    await sessions.clear();
    setSelectedSession(null);
  }, [sessions]);

  // 主区域内容：流式生成 > 阅读视图 > 分析视图
  const showStreaming = streamingSummary !== null;
  const showNoteView = !showStreaming && viewingNote !== null;
  const showAnalysis = !showStreaming && !showNoteView && result !== null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          知识聚合器 · 网页 → AI 摘要 → Markdown 笔记
        </h1>
          <Link href="/settings" className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300">
            API 配置
          </Link>
        </div>
        <StatusBar health={health.health} loading={health.loading} error={health.error} />
      </header>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        {/* 主区域：流式 / 阅读视图 / 分析视图 三者互斥 */}
        <div className="flex flex-col gap-4">
          <UrlForm onProcess={handleProcess} loading={processing} />
          {showStreaming ? (
            <StreamingCard summary={streamingSummary ?? ""} />
          ) : showNoteView ? (
            <NoteViewer
              filename={viewingNote}
              onBack={result ? handleBackToAnalysis : undefined}
            />
          ) : showAnalysis ? (
            <>
              <AnalysisCard analysis={result.analysis} source={lastUrl} />
              <SuggestionList
                suggestions={result.suggestions}
                noteFilename={result.note_filename}
                onLink={handleLink}
                onRelink={handleRelink}
                relinkLoading={relinkLoading}
              />
              <ManualLinkInput
                noteFilename={result.note_filename}
                candidates={notes.notes.map((n) => ({ filename: n.filename, title: n.title }))}
                onLink={(t) => handleLink([t])}
              />
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-400 dark:border-zinc-700">
              粘贴一个网页链接开始分析，或从右侧笔记库选一篇阅读。
            </div>
          )}
        </div>

        {/* 侧栏：纯导航（笔记列表 + 会话历史），不再放预览 */}
        <aside className="flex flex-col gap-4">
          <NoteList
            notes={notes.notes}
            selected={selectedNote}
            onSelect={handleSelectNote}
            loading={notes.loading}
            onRefresh={notes.refresh}
          />
          <SessionHistory
            sessions={sessions.sessions}
            selectedFile={selectedSession}
            onSelect={handleSelectSession}
            onClear={handleClearSessions}
            loading={sessions.loading}
          />
        </aside>
      </div>

      <footer className="text-center text-xs text-zinc-400">
        分析结果写入笔记目录（可在 .env 配置为 iCloud/Git 同步路径）· 会话快照存于系统临时目录，可删除
      </footer>
    </div>
  );
}
