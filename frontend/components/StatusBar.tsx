"use client";
import type { HealthStatus } from "@/lib/types";
import { Tag } from "./ui/Tag";

interface StatusBarProps {
  health: HealthStatus | null;
  loading: boolean;
  error: string | null;
}

export function StatusBar({ health, loading, error }: StatusBarProps) {
  const ok = health?.status === "ok";
  const dot = loading
    ? "bg-zinc-400"
    : ok
      ? "bg-emerald-500"
      : "bg-red-500";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span>{loading ? "检查后端…" : ok ? "后端在线" : error || "后端未连接"}</span>
      {health && (
        <>
          <Tag className={health.llm_configured ? "" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}>
            {health.llm_configured
              ? (health.llm_provider === "local" ? "本地 AI" : "在线 AI")
              : "AI 未配置"}
          </Tag>
          {health.llm_provider === "local" && (
            <Tag className={health.local_ready ? "" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}>
              {health.local_ready ? "本地 AI 运行中" : "本地 AI 未启动"}
            </Tag>
          )}
          <Tag>{health.llm_model}</Tag>
          <Tag>笔记 {health.notes_count}</Tag>
        </>
      )}
    </div>
  );
}
