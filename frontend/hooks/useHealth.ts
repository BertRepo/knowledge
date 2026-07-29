"use client";
// 健康检查 hook：封装「数据 + loading + error + 定时刷新」的标准数据获取模式。
//
// 为什么用自定义 hook 而不是直接在组件里 useEffect：
// - 把数据获取逻辑从组件抽离，组件只关心展示
// - 多个组件可以共享同一份数据（虽然这里没复用，但模式统一）
// - autoMs 参数让调用方控制轮询频率（StatusBar 每 15s 轮询一次后端状态）
import { useCallback, useEffect, useState } from "react";
import { ApiError, getHealth } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";

export function useHealth(autoMs = 15000) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // refresh 用 useCallback 包裹，保证引用稳定：
  // 下面的 useEffect 依赖 [refresh, autoMs]，如果 refresh 每次渲染都变，
  // useEffect 就会反复重新订阅，导致死循环。useCallback 让它只在依赖变化时变。
  const refresh = useCallback(async () => {
    try {
      const h = await getHealth();
      setHealth(h);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "健康检查失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 数据获取 hook 的标准模式：effect 里触发异步刷新，setState 在 await 之后的回调里执行。
    // 首次启动时后端 sidecar 可能还在启动（PyInstaller 解压要几秒），
    // 失败就快速重试几次，而不是让用户干等 15s 看到「后端未连接」。
    let cancelled = false;
    let retries = 0;
    const firstCheck = async () => {
      while (retries < 10 && !cancelled) {
        try {
          const h = await getHealth();
          if (!cancelled) {
            setHealth(h);
            setError(null);
            setLoading(false);
          }
          return; // 成功，退出重试
        } catch {
          retries++;
          if (cancelled) return;
          if (retries >= 10) {
            setError("后端启动超时，请稍候或检查安装");
            setLoading(false);
            return;
          }
          // 2s 后重试（sidecar 启动中）
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    firstCheck();
    if (autoMs > 0) {
      const id = setInterval(refresh, autoMs); // 定时轮询
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [refresh, autoMs]);

  return { health, error, loading, refresh };
}
