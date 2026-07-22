"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/types";
import { DOMAIN_LABELS } from "@/lib/types";
import { Card } from "./ui/Card";
import { Spinner } from "./ui/Spinner";

interface GraphViewProps {
  data: GraphData;
  loading: boolean;
  /** 点击节点：在阅读视图打开该笔记。 */
  onSelectNode?: (filename: string) => void;
}

// 领域 -> 节点配色，让同领域的笔记聚成一组颜色
const DOMAIN_COLORS: Record<string, string> = {
  tech: "#6366f1",
  tutorial: "#10b981",
  product: "#f59e0b",
  finance: "#ef4444",
  academic: "#8b5cf6",
  news: "#06b6d4",
  opinion: "#ec4899",
  general: "#71717a",
};

interface SimNode {
  id: string;
  title: string;
  domain: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 知识图谱视图：手写一个极简力导向布局，零第三方依赖。
 *
 * 不引入 d3/cytoscape 等库的原因：当前图谱规模小（个人笔记库），
 * 原生 SVG + requestAnimationFrame 足够，避免引入几百 KB 的依赖。
 *
 * 力导向三股力：
 *  - 斥力：任意两节点互相排斥（按距离平方衰减）
 *  - 引力：有边相连的节点互相吸引
 *  - 中心力：所有节点被拉向画布中心，防止飞散
 * 迭代若干帧后趋于稳定，停帧。
 */
export function GraphView({ data, loading, onSelectNode }: GraphViewProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // 把数据转成带物理属性的仿真节点，只在 data 变化时重建
  const nodesRef = useRef<SimNode[]>([]);
  const edges = data.edges;

  const simNodes = useMemo<SimNode[]>(() => {
    // 随机初始化位置在中心附近，避免起始全部重叠在一点
    const cx = 200, cy = 200;
    return data.nodes.map((n: GraphNode) => ({
      id: n.id,
      title: n.title,
      domain: n.domain,
      x: cx + (Math.cos(n.id.length * 1.7) * 120),
      y: cy + (Math.sin(n.id.length * 2.3) * 120),
      vx: 0,
      vy: 0,
    }));
  }, [data]);

  useEffect(() => {
    nodesRef.current = simNodes;
  }, [simNodes]);

  // 力导向仿真：跑固定帧数后停止，足够收敛又不会无限占用 CPU
  useEffect(() => {
    let frame = 0;
    const maxFrames = 220;
    const cx = 200, cy = 200;

    const tick = () => {
      const nodes = nodesRef.current;
      const reps: Record<string, SimNode> = {};
      for (const n of nodes) reps[n.id] = n;

      // 斥力：两两排斥
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 0.01) {
            // 重合：给个随机扰动避免除零
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            dist2 = 0.25;
          }
          const dist = Math.sqrt(dist2);
          const force = 1400 / dist2; // 斥力大小
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }

      // 引力：有边相连的节点互相吸引
      for (const e of edges) {
        const s = reps[e.source], t = reps[e.target];
        if (!s || !t) continue;
        const dx = t.x - s.x, dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.02; // 目标距离 120
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      }

      // 中心力 + 阻尼 + 位置更新
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.005;
        n.vy += (cy - n.y) * 0.005;
        n.vx *= 0.85; // 阻尼，否则会震荡
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }

      frame++;
      // 用 DOM 直接更新 transform 比 setState 每帧重渲染便宜得多
      for (const n of nodes) {
        const el = document.getElementById(`gnode-${n.id}`);
        if (el) el.setAttribute("transform", `translate(${n.x}, ${n.y})`);
      }
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const s = reps[e.source], t = reps[e.target];
        if (!s || !t) continue;
        const el = document.getElementById(`gedge-${i}`);
        if (el) el.setAttribute("d", `M${s.x},${s.y} L${t.x},${t.y}`);
      }

      if (frame < maxFrames) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [edges]);

  // 空状态
  if (!loading && data.nodes.length === 0) {
    return (
      <Card title="知识图谱">
        <p className="text-sm text-zinc-500">
          还没有笔记，或笔记之间还没有 [[wikilink]] 关联。分析网页并关联已有笔记后，这里会出现图谱。
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="知识图谱"
      actions={
        loading && <span className="flex items-center gap-1.5 text-xs text-zinc-500"><Spinner className="h-3.5 w-3.5" />加载中</span>
      }
    >
      <div className="overflow-x-auto">
        <svg viewBox="0 0 400 400" className="h-[28rem] w-full">
          {/* 先画边（在下层），再画节点 */}
          {edges.map((e, i) => {
            const s = simNodes.find((n) => n.id === e.source);
            const t = simNodes.find((n) => n.id === e.target);
            if (!s || !t) return null;
            return (
              <path
                key={i}
                id={`gedge-${i}`}
                d={`M${s.x},${s.y} L${t.x},${t.y}`}
                stroke="currentColor"
                className="text-zinc-300 dark:text-zinc-700"
                strokeWidth={1}
                fill="none"
              />
            );
          })}
          {simNodes.map((n) => {
            const color = DOMAIN_COLORS[n.domain] || DOMAIN_COLORS.general;
            const isHover = hoverId === n.id;
            return (
              <g
                key={n.id}
                id={`gnode-${n.id}`}
                transform={`translate(${n.x}, ${n.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => onSelectNode?.(n.id)}
              >
                <circle
                  r={isHover ? 9 : 7}
                  fill={color}
                  stroke="white"
                  strokeWidth={1.5}
                  className="transition-all"
                />
                {/* 标题只在 hover 时显示，避免常态文字重叠成一团 */}
                {isHover && (
                  <text
                    y={-14}
                    textAnchor="middle"
                    className="fill-zinc-700 text-[10px] dark:fill-zinc-200"
                  >
                    {n.title.length > 14 ? n.title.slice(0, 14) + "…" : n.title}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {/* 领域图例 */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {Object.entries(DOMAIN_LABELS).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: DOMAIN_COLORS[key] || DOMAIN_COLORS.general }} />
            {label}
          </span>
        ))}
      </div>
    </Card>
  );
}
