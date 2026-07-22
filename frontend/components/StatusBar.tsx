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
          <Tag className={health.ai_configured ? "" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}>
            {health.ai_configured ? "AI 已配置" : "AI 未配置"}
          </Tag>
          <Tag>{health.ai_model}</Tag>
          <Tag>笔记 {health.notes_count}</Tag>
        </>
      )}
    </div>
  );
}
