"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, listNotes } from "@/lib/api";
import type { NoteMeta } from "@/lib/types";

export function useNotes() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listNotes();
      setNotes(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载笔记失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return { notes, error, loading, refresh };
}
