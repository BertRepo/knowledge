"use client";
/**
 * 主页面：整个前端的中枢，负责状态编排，把职责下放给各组件。
 *
 * 两页式布局（v1.2 重构）：
 *  - 工作台模式（默认）：中间是分析/阅读视图，右侧是对话区 + 会话历史
 *  - 笔记库模式：中间是知识图谱，右侧是笔记列表（可点开阅读）
 *  两种模式共用顶栏的 UrlForm，共用一份笔记数据（useNotes）。
 *
 * 主区域三态互斥（工作台模式下）：
 *  - 流式生成：StreamingCard
 *  - 阅读视图：NoteViewer（点笔记库某篇时）
 *  - 分析视图：AnalysisCard + SuggestionList + ManualLinkInput
 *
 * 关键状态：
 *  - mode：workbench | vault（当前页面）
 *  - result：当前分析结果，驱动分析视图，也作为对话区的关联笔记
 *  - viewingNote：主区域正在阅读的笔记，非空时切到阅读视图
 *  - selectedNote / selectedSession：仅控制列表高亮
 *
 * 数据流（分析）：UrlForm -> handleProcess -> /api/process/stream(流式) ->
 *   StreamingCard 实时渲染 -> onDone 设 result -> AnalysisCard + 建议。
 * 数据流（对话）：ChatPanel -> /api/chat/stream -> 后端按 result 笔记 + 关联笔记构建上下文。
 * 数据流（图谱）：切到 vault 模式 -> useGraph -> GraphView 力导向渲染 -> 点节点切到阅读视图。
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { ApiError, getSession, linkNotes, processUrlStream, relateNote, relateSemantic } from "@/lib/api";
import type { ProcessResponse } from "@/lib/types";
import { useGraph } from "@/hooks/useGraph";
import { useHealth } from "@/hooks/useHealth";
import { useNotes } from "@/hooks/useNotes";
import { useSessions } from "@/hooks/useSessions";
import { AnalysisCard } from "@/components/AnalysisCard";
import { ChatPanel } from "@/components/ChatPanel";
import { GraphView } from "@/components/GraphView";
import { ManualLinkInput } from "@/components/ManualLinkInput";
import { NoteList } from "@/components/NoteList";
import { NoteViewer } from "@/components/NoteViewer";
import { SearchBox } from "@/components/SearchBox";
import { SessionHistory } from "@/components/SessionHistory";
import { StatusBar } from "@/components/StatusBar";
import { StreamingCard } from "@/components/StreamingCard";
import { SuggestionList } from "@/components/SuggestionList";
import { UrlForm } from "@/components/UrlForm";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

type PageMode = "workbench" | "vault";

export default function Page() {
  const health = useHealth();
  const notes = useNotes();
  const sessions = useSessions();
  const graph = useGraph();

  const [mode, setMode] = useState<PageMode>("workbench");
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
      setMode("workbench"); // 分析时回到工作台
      setProcessing(true);
      setError(null);
      setStreamingSummary(""); // 进入流式状态，StreamingCard 显示
      setResult(null);
      setViewingNote(null);
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
            Promise.all([notes.refresh(), sessions.refresh(), graph.refresh()]);
          },
          onError: (msg) => {
            setError(msg);
            setStreamingSummary(null);
          },
        },
      );
      setProcessing(false);
    },
    [notes, sessions, graph],
  );

  const handleLink = useCallback(
    async (targets: string[]) => {
      if (!result) return [] as string[];
      const added = (await linkNotes(result.note_filename, targets)).added;
      // 关联关系变了，图谱也要刷新
      await Promise.all([notes.refresh(), graph.refresh()]);
      return added;
    },
    [result, notes, graph],
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

  // 语义召回：用本地 embedding 向量检索补充关联建议（与 LLM 建议互补）
  const handleSemanticRelink = useCallback(async () => {
    if (!result) return;
    setRelinkLoading(true);
    try {
      const sugg = await relateSemantic(result.note_filename);
      setResult({ ...result, suggestions: sugg });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "向量检索不可用，请确认已安装 embedding 模型");
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
  const handleSelectNote = useCallback(
    (filename: string) => {
      setSelectedNote(filename);
      setViewingNote(filename);
      setSelectedSession(null);
    },
    [],
  );

  // 从阅读视图返回分析视图（仅当有分析结果时才有意义）
  const handleBackToAnalysis = useCallback(() => {
    setViewingNote(null);
  }, []);

  const handleClearSessions = useCallback(async () => {
    await sessions.clear();
    setSelectedSession(null);
  }, [sessions]);

  // 笔记被编辑后：刷新笔记列表、图谱、向量索引（正文变了语义可能变）
  const handleNoteEdited = useCallback(() => {
    notes.refresh();
    graph.refresh();
  }, [notes, graph]);

  // 主区域内容（工作台模式）：流式生成 > 阅读视图 > 分析视图
  const showStreaming = streamingSummary !== null;
  const showNoteView = !showStreaming && viewingNote !== null;
  const showAnalysis = !showStreaming && !showNoteView && result !== null;

  // 对话区关联的笔记：优先当前分析结果，其次正在阅读的笔记
  const chatNote = result?.note_filename ?? viewingNote ?? null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {"知识聚合器 · 做你的在线笔记助手"}
          </h1>
          <div className="flex items-center gap-4">
            {/* 页面切换：工作台 / 笔记库 */}
            <nav className="flex gap-1 text-sm">
              <button
                type="button"
                onClick={() => setMode("workbench")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  mode === "workbench"
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                工作台
              </button>
              <button
                type="button"
                onClick={() => setMode("vault")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  mode === "vault"
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                笔记库
              </button>
            </nav>
            <Link href="/settings" className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300">
              API 配置
            </Link>
          </div>
        </div>
        <StatusBar health={health.health} loading={health.loading} error={health.error} />
      </header>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {mode === "workbench" ? (
        /* ===== 工作台模式：左主区(分析/阅读) + 右侧(对话+会话) ===== */
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-4">
            {/* 语义搜索：输入问题/关键词，向量召回相关笔记 */}
            <SearchBox onSelect={handleSelectNote} />
            <UrlForm onProcess={handleProcess} loading={processing} />
            {showStreaming ? (
              <StreamingCard summary={streamingSummary ?? ""} />
            ) : showNoteView ? (
              <NoteViewer
                filename={viewingNote}
                onBack={result ? handleBackToAnalysis : undefined}
                onEdited={handleNoteEdited}
              />
            ) : showAnalysis ? (
              <>
                <AnalysisCard analysis={result.analysis} source={lastUrl} />
                <SuggestionList
                  suggestions={result.suggestions}
                  noteFilename={result.note_filename}
                  onLink={handleLink}
                  onRelink={handleRelink}
                  onSemanticRelink={handleSemanticRelink}
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
                粘贴一个网页链接开始分析，或切到「笔记库」查看知识图谱。
              </div>
            )}
          </div>

          {/* 右侧：对话区 + 会话历史（垂直分割，对话占大部分高度） */}
          <aside className="flex min-h-[24rem] flex-col gap-4 lg:max-h-[calc(100vh-8rem)]">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <ChatPanel noteFilename={chatNote} />
            </div>
            <SessionHistory
              sessions={sessions.sessions}
              selectedFile={selectedSession}
              onSelect={handleSelectSession}
              onClear={handleClearSessions}
              loading={sessions.loading}
            />
          </aside>
        </div>
      ) : (
        /* ===== 笔记库模式：图谱(主) + 笔记列表(侧) ===== */
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-4">
            <UrlForm onProcess={handleProcess} loading={processing} />
            {viewingNote ? (
              <NoteViewer
                filename={viewingNote}
                onBack={() => setViewingNote(null)}
                onEdited={handleNoteEdited}
              />
            ) : (
              <GraphView
                data={graph.graph ?? { nodes: [], edges: [] }}
                loading={graph.loading}
                onSelectNode={handleSelectNote}
              />
            )}
          </div>
          <aside className="flex flex-col gap-4">
            <NoteList
              notes={notes.notes}
              selected={selectedNote}
              onSelect={handleSelectNote}
              loading={notes.loading}
              onRefresh={notes.refresh}
            />
          </aside>
        </div>
      )}

      <footer className="text-center text-xs text-zinc-400">
        分析结果写入笔记目录（可在 .env 配置为 iCloud/Git 同步路径）· 会话快照存于系统临时目录，可删除
      </footer>
    </div>
  );
}
