/// <reference lib="webworker" />
/**
 * Mermaid 渲染 Web Worker。
 *
 * 把 mermaid.render() 从主线程搬到 worker 线程，这样复杂图的解析+布局+SVG 生成
 * 不会阻塞 UI（滚动、动画、输入框打字都能保持流畅）。
 *
 * 通信协议（主线程 <-> worker）：
 *   入： { id, chart }            -- 要渲染的 mermaid 代码
 *   出： { id, svg }              -- 渲染成功
 *   出： { id, error }            -- 渲染失败（主线程据此回退）
 *
 * id 用于匹配请求与响应：同一 worker 实例并发处理多个图表时，
 * 靠 id 区分哪条结果属于哪个请求。
 */
import mermaid from "mermaid";

// worker 启动时初始化一次 mermaid（与主线程的配置保持一致）
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose", // 允许节点里的中文/特殊字符
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
});

// 自增序号，保证每次渲染的 mermaid id 唯一，避免内部缓存串台
let seq = 0;

self.addEventListener("message", async (e: MessageEvent) => {
  const { id, chart } = e.data as { id: number; chart: string };
  try {
    const { svg } = await mermaid.render(`m-worker-${seq++}`, chart);
    (self as unknown as Worker).postMessage({ id, svg });
  } catch (err: unknown) {
    // 渲染失败也回传，让主线程决定是回退还是显示错误
    (self as unknown as Worker).postMessage({
      id,
      error: String(err instanceof Error ? err.message : err),
    });
  }
});
