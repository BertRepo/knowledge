"use client";
import { useEffect, useState } from "react";
import mermaid from "mermaid";

/**
 * Mermaid 渲染组件：把 mermaid 代码渲染成 SVG。
 *
 * 性能策略（三级降级）：
 *  1. 优先用 Web Worker 渲染（mermaid-worker.ts）-- 不阻塞主线程
 *  2. Worker 不可用或渲染失败 -> 主线程 + requestIdleCallback 空闲时渲染
 *  3. 都失败 -> 显示原始代码 + 错误信息，方便排查
 *
 * Worker 单例在模块级创建，所有 Mermaid 实例共用一个 worker（避免每张图开一个线程）。
 */

// ---- Worker 单例管理 ----
let workerInstance: Worker | null = null;
let workerFailed = false; // worker 创建/初始化失败后置 true，后续直接走主线程

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (workerInstance) return workerInstance;
  try {
    // new URL(..., import.meta.url) 是 webpack/turbopack 识别 worker 的标准写法，
    // 构建时会单独打包成一个 chunk。
    workerInstance = new Worker(new URL("./mermaid-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    // 浏览器不支持 module worker 或构建问题：标记失败，永久走主线程
    workerFailed = true;
    return null;
  }
  return workerInstance;
}

// ---- 主线程渲染兜底 ----
let mainInited = false;
function initMain() {
  if (mainInited) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  });
  mainInited = true;
}

let renderSeq = 0;

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  // chart 变化时在渲染期间重置状态--React 官方推荐的「prop 变化时调整 state」模式：
  // 用 useState 存上一次的 chart，渲染期间检测到变化就同步重置（条件判断防死循环）。
  const [lastChart, setLastChart] = useState(chart);
  if (lastChart !== chart) {
    setLastChart(chart);
    setSvg("");
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    // 唯一 id：匹配本次请求与 worker 响应，防止快速切换 chart 时结果串台
    const id = ++renderSeq;
    const w = getWorker();

    // 主线程兜底渲染（worker 不可用或失败时调用）
    const renderOnMain = () => {
      initMain();
      // requestIdleCallback：推迟到浏览器空闲时再渲染，避免阻塞首屏/交互
      const doRender = () => {
        if (cancelled) return;
        const domId = `m-main-${renderSeq++}`;
        mermaid
          .render(domId, chart)
          .then(({ svg }) => !cancelled && setSvg(svg))
          .catch((e: unknown) => !cancelled && setError(String(e instanceof Error ? e.message : e)));
      };
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        const handle = window.requestIdleCallback(doRender, { timeout: 300 });
        return () => window.cancelIdleCallback(handle);
      }
      const handle = setTimeout(doRender, 0);
      return () => clearTimeout(handle);
    };

    if (w) {
      // 路径 1：发给 worker 渲染
      const handler = (e: MessageEvent) => {
        const data = e.data as { id: number; svg?: string; error?: string };
        if (data.id !== id || cancelled) return;
        w.removeEventListener("message", handler);
        if (data.error) {
          // worker 渲染失败 -> 回退主线程
          renderOnMain();
        } else {
          setSvg(data.svg ?? "");
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({ id, chart });
      return () => {
        cancelled = true;
        w.removeEventListener("message", handler);
      };
    }

    // 路径 2：没有 worker，直接主线程空闲时渲染
    const cleanup = renderOnMain();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [chart]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-md bg-zinc-100 p-2 text-xs text-red-600 dark:bg-zinc-800">
        {chart}
        {"\n\n// 渲染失败: "}
        {error}
      </pre>
    );
  }
  if (!svg) {
    return <div className="text-xs text-zinc-400">图解渲染中…</div>;
  }
  // mermaid 输出的 SVG，直接注入 DOM
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
