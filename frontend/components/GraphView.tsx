"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/types";
import { DOMAIN_LABELS } from "@/lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Spinner } from "./ui/Spinner";

interface GraphViewProps {
  data: GraphData;
  loading: boolean;
  /** 点击节点：在阅读视图打开该笔记。 */
  onSelectNode?: (filename: string) => void;
  /** 从 source 笔记向 target 笔记加 [[wikilink]] 连边。 */
  onLink?: (source: string, target: string) => Promise<void>;
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
  tags: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 知识图谱视图：手写力导向布局，零第三方依赖。
 *
 * 不引入 d3/cytoscape 的原因：个人笔记库规模小，原生 SVG + rAF 足够。
 *
 * 三股力：斥力（两两排斥）、引力（有边相连的互相吸引）、中心力（防飞散）。
 * 迭代 220 帧后停。
 *
 * 交互（P3 增强）：
 *  - 领域筛选：点击图例芯片只看某领域的子图
 *  - 节点拖拽：按住拖动节点，松手后仿真继续（被拖节点固定到松手位置）
 *  - 加连边：hover 节点显示「+ 连到…」按钮，点它进入连线模式，再点目标节点即加 wikilink
 */
export function GraphView({ data, loading, onSelectNode, onLink }: GraphViewProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  // 连线模式：选了 source 后点 target 触发 onLink
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const rafRef = useRef<number | null>(null);
  // 被拖拽中的节点 id；拖拽期间该节点位置随鼠标，不受物理力影响
  const dragId = useRef<string | null>(null);

  const nodesRef = useRef<SimNode[]>([]);
  const edges = data.edges;

  const simNodes = useMemo<SimNode[]>(() => {
    const cx = 200, cy = 200;
    return data.nodes.map((n: GraphNode) => ({
      id: n.id,
      title: n.title,
      domain: n.domain,
      tags: n.tags,
      x: cx + (Math.cos(n.id.length * 1.7) * 120),
      y: cy + (Math.sin(n.id.length * 2.3) * 120),
      vx: 0,
      vy: 0,
    }));
  }, [data]);

  useEffect(() => {
    nodesRef.current = simNodes;
  }, [simNodes]);

  // 力导向仿真：跑固定帧数后停止
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
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            dist2 = 0.25;
          }
          const dist = Math.sqrt(dist2);
          const force = 1400 / dist2;
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
        const force = (dist - 120) * 0.02;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      }

      // 中心力 + 阻尼 + 位置更新（拖拽中的节点跳过物理更新）
      for (const n of nodes) {
        if (n.id === dragId.current) continue;
        n.vx += (cx - n.x) * 0.005;
        n.vy += (cy - n.y) * 0.005;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }

      frame++;
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

  // 节点拖拽：SVG 坐标换算 + 更新被拖节点位置
  function onNodeMouseDown(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    dragId.current = id;
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) {
      node.vx = 0;
      node.vy = 0;
    }
  }

  function onSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragId.current) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    // 屏幕坐标 -> SVG viewBox 坐标
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    const node = nodesRef.current.find((n) => n.id === dragId.current);
    if (node) {
      node.x = loc.x;
      node.y = loc.y;
      const el = document.getElementById(`gnode-${dragId.current}`);
      if (el) el.setAttribute("transform", `translate(${loc.x}, ${loc.y})`);
    }
  }

  function onSvgMouseUp() {
    dragId.current = null;
  }

  // 点击节点：连线模式下当 target，否则打开阅读
  function onNodeClick(id: string) {
    if (linkSource) {
      if (id !== linkSource && onLink) {
        setLinking(true);
        onLink(linkSource, id).finally(() => {
          setLinking(false);
          setLinkSource(null);
        });
      } else {
        setLinkSource(null);
      }
      return;
    }
    onSelectNode?.(id);
  }

  // 筛选：选中领域时只显示该领域的节点
  const visibleIds = useMemo(() => {
    if (!activeDomain) return null;
    return new Set(data.nodes.filter((n) => n.domain === activeDomain).map((n) => n.id));
  }, [activeDomain, data.nodes]);

  const isHidden = (id: string) => visibleIds !== null && !visibleIds.has(id);

  // 空状态
  if (!loading && data.nodes.length === 0) {
    return (
      <Card title="知识图谱">
        <p className="text-sm text-zinc-500">
          还没有笔记，或笔记之间还没有关联。生成更多笔记并关联它们后，这里会出现知识图谱。
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="知识图谱"
      actions={
        <div className="flex items-center gap-2">
          {linkSource && (
            <span className="text-xs text-amber-600">
              连线模式：点目标节点（选「{simNodes.find((n) => n.id === linkSource)?.title.slice(0, 8)}…」为源）
            </span>
          )}
          {linkSource && (
            <Button variant="ghost" size="sm" onClick={() => setLinkSource(null)} disabled={linking}>
              取消连线
            </Button>
          )}
          {loading && <span className="flex items-center gap-1.5 text-xs text-zinc-500"><Spinner className="h-3.5 w-3.5" />加载中</span>}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 400 400"
          className="h-[28rem] w-full"
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
        >
          {/* 边 */}
          {edges.map((e, i) => {
            const s = simNodes.find((n) => n.id === e.source);
            const t = simNodes.find((n) => n.id === e.target);
            if (!s || !t) return null;
            // 筛选时：两端都在可见集才显示边
            if (isHidden(e.source) || isHidden(e.target)) return null;
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
            if (isHidden(n.id)) return null;
            const color = DOMAIN_COLORS[n.domain] || DOMAIN_COLORS.general;
            const isHover = hoverId === n.id;
            const isLinkSource = linkSource === n.id;
            return (
              <g
                key={n.id}
                id={`gnode-${n.id}`}
                transform={`translate(${n.x}, ${n.y})`}
                className={linkSource ? "cursor-crosshair" : "cursor-pointer"}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onMouseDown={(e) => onNodeMouseDown(e, n.id)}
                onClick={() => onNodeClick(n.id)}
              >
                <circle
                  r={isHover ? 9 : 7}
                  fill={color}
                  stroke={isLinkSource ? "#f59e0b" : "white"}
                  strokeWidth={isLinkSource ? 3 : 1.5}
                  className="transition-all"
                />
                {isHover && (
                  <text
                    y={-14}
                    textAnchor="middle"
                    className="fill-zinc-700 text-[10px] dark:fill-zinc-200"
                  >
                    {n.title.length > 14 ? n.title.slice(0, 14) + "…" : n.title}
                  </text>
                )}
                {/* hover 时显示「加连边」小按钮（需要 onLink 回调） */}
                {isHover && onLink && !linkSource && (
                  <g
                    transform="translate(12, -12)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLinkSource(n.id);
                    }}
                  >
                    <circle r={7} fill="#f59e0b" />
                    <text
                      y={3}
                      textAnchor="middle"
                      className="cursor-pointer fill-white text-[10px] font-bold"
                    >
                      +
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {/* 领域图例 + 筛选：点击切换该领域的子图 */}
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-zinc-500">
        {activeDomain && (
          <button
            type="button"
            onClick={() => setActiveDomain(null)}
            className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
          >
            全部 ✕
          </button>
        )}
        {Object.entries(DOMAIN_LABELS).map(([key, label]) => {
          const count = data.nodes.filter((n) => n.domain === key).length;
          if (count === 0) return null; // 没有该领域的笔记就不显示，减少干扰
          const isActive = activeDomain === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveDomain(isActive ? null : key)}
              className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors ${
                isActive ? "bg-zinc-200 dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: DOMAIN_COLORS[key] || DOMAIN_COLORS.general }} />
              {label}
              <span className="opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
