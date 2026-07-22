"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, clearSessions, listSessions } from "@/lib/api";
import type { SessionSummary } from "@/lib/types";

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载会话失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await clearSessions();
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "清空失败");
    }
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return { sessions, error, loading, refresh, clear };
}
