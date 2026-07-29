"use client";
import { FormEvent, useState } from "react";
import { ApiError, semanticSearch } from "@/lib/api";
import type { RelatedSuggestion } from "@/lib/types";
import { Spinner } from "./ui/Spinner";

interface SearchBoxProps {
  /** 选中某条结果：在工作台切到该笔记的阅读视图。 */
  onSelect: (filename: string) => void;
}

/**
 * 语义搜索框：输入关键词或问题，向量召回最相关的笔记。
 *
 * 区别于关键词匹配：embedding 能理解「讲了什么」，
 * 同义词、不同表述也能命中（比如搜「防火墙」能找到讲「GFW」的笔记）。
 * 后端不可用时（模型没加载）回退到提示，不让页面崩。
 */
export function SearchBox({ onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RelatedSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setShowResults(true);
    try {
      const res = await semanticSearch(q);
      setResults(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "搜索失败");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function pick(filename: string) {
    onSelect(filename);
    setShowResults(false);
    setQuery("");
    setResults([]);
  }

  return (
    <div className="relative">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder="搜索笔记…"
          className="apple-input h-10 flex-1 px-4 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex h-10 w-10 items-center justify-center apple-input text-zinc-500 disabled:opacity-40"
          aria-label="搜索"
        >
          {loading ? <Spinner className="h-4 w-4" /> : "🔍"}
        </button>
      </form>

      {/* 结果下拉 */}
      {showResults && (loading || error || results.length > 0) && (
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {error ? (
            <p className="px-3 py-2 text-xs text-red-600">{error}</p>
          ) : loading ? (
            <p className="px-3 py-2 text-xs text-zinc-400">检索中…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-400">没有找到相关笔记</p>
          ) : (
            <ul className="py-1">
              {results.map((r) => (
                <li key={r.filename}>
                  <button
                    type="button"
                    onClick={() => pick(r.filename)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="flex-1 truncate">
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">{r.title || r.filename}</span>
                      <span className="ml-2 font-mono text-xs text-zinc-400">{r.filename}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
