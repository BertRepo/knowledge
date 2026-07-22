"use client";
import type { AnalysisResult } from "@/lib/types";
import { DOMAIN_LABELS } from "@/lib/types";
import { Card } from "./ui/Card";
import { Markdown } from "./ui/Markdown";
import { Tag } from "./ui/Tag";

interface AnalysisCardProps {
  analysis: AnalysisResult;
  source?: string;
}

export function AnalysisCard({ analysis, source }: AnalysisCardProps) {
  return (
    <Card
      title={
        <span>
          笔记：<span className="text-zinc-900 dark:text-zinc-50">{analysis.title}</span>
        </span>
      }
      actions={
        <div className="flex items-center gap-1.5">
          {analysis.domain && (
            <Tag className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {DOMAIN_LABELS[analysis.domain] || analysis.domain}
            </Tag>
          )}
          <Tag className="font-mono">{analysis.filename}.md</Tag>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <span className="font-semibold">TL;DR：</span>
          {analysis.tldr}
        </p>

        {analysis.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {analysis.tags.map((t) => (
              <Tag key={t}>#{t}</Tag>
            ))}
          </div>
        )}

        {analysis.summary && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">摘要</h3>
            <Markdown>{analysis.summary}</Markdown>
          </div>
        )}

        {analysis.key_points.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">关键点</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
              {analysis.key_points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {source && (
          <p className="text-xs text-zinc-400">
            来源：<a href={source} target="_blank" rel="noreferrer" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">{source}</a>
          </p>
        )}
      </div>
    </Card>
  );
}
