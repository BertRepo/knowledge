"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getGraph } from "@/lib/api";
import type { GraphData } from "@/lib/types";

/**
 * 知识图谱数据 hook：加载笔记库的节点 + 边。
 *
 * 笔记增删或关联变化后需要手动 refresh，避免每次切到图谱页都全量重拉。
 * （后端 build_graph 是 O(n) 全量扫描，将来可加缓存。）
 */
export function useGraph() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setGraph(await getGraph());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载图谱失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return { graph, error, loading, refresh };
}
