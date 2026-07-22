"use client";
import { Card } from "./ui/Card";
import { Markdown } from "./ui/Markdown";
import { Spinner } from "./ui/Spinner";

interface StreamingCardProps {
  /** 已到达的摘要文本（持续增长），实时渲染为 Markdown。 */
  summary: string;
}

/**
 * 流式生成中的摘要卡片。
 *
 * AI 逐段吐出摘要正文时，这个卡片把已到达的文本实时渲染成 Markdown，
 * 让用户看到内容「打字」出来，而不是盯着 loading 转圈干等。
 * 顶部带一个转圈 + 「生成中」提示，流结束后由父组件切换到 AnalysisCard。
 */
export function StreamingCard({ summary }: StreamingCardProps) {
  return (
    <Card
      title="AI 生成中"
      actions={
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Spinner className="h-3.5 w-3.5" /> 生成中
        </span>
      }
    >
      {summary ? (
        <Markdown>{summary}</Markdown>
      ) : (
        <p className="text-sm text-zinc-400">正在抓取网页并调用 AI…</p>
      )}
    </Card>
  );
}
