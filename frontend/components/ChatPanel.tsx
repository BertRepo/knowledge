"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { chatStream } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";
import { Markdown } from "./ui/Markdown";
import { Spinner } from "./ui/Spinner";

interface ChatPanelProps {
  /** 当前关联的笔记文件名；为 null 时禁用对话（无笔记可问）。 */
  noteFilename: string | null;
}

/**
 * 对话区：基于当前笔记做多轮追问，回答流式渲染。
 *
 * 设计要点：
 * - 对话历史 messages 是核心状态，每轮 user/assistant 交替。
 * - 流式生成期间用一个独立的 streamingText 累积增量，生成完并入 messages。
 * - 切换笔记时清空历史（对话上下文是针对某篇笔记的）。
 * - 自动滚动到底部：用 ref + effect，新消息到达时滚到底。
 */
export function ChatPanel({ noteFilename }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 切换笔记：对话上下文变了，清空历史
  const [lastNote, setLastNote] = useState(noteFilename);
  if (lastNote !== noteFilename) {
    setLastNote(noteFilename);
    setMessages([]);
    setStreamingText("");
    setError(null);
  }

  // 新消息或流式增量到达时滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText]);

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const q = input.trim();
      if (!q || !noteFilename || streaming) return;

      const userMsg: ChatMessage = { role: "user", content: q };
      // 把新 user 消息加进历史，用这组历史请求
      const history = [...messages, userMsg];
      setMessages(history);
      setInput("");
      setStreaming(true);
      setStreamingText("");
      setError(null);

      let acc = "";
      await chatStream(noteFilename, history, {
        onToken: (delta) => {
          acc += delta;
          setStreamingText(acc);
        },
        onDone: () => {
          setMessages((prev) => [...prev, { role: "assistant", content: acc }]);
          setStreamingText("");
          setStreaming(false);
        },
        onError: (msg) => {
          setError(msg);
          // 已生成的部分也保留下来，方便用户参考
          if (acc) {
            setMessages((prev) => [...prev, { role: "assistant", content: acc }]);
          }
          setStreamingText("");
          setStreaming(false);
        },
      });
    },
    [input, noteFilename, streaming, messages],
  );

  const disabled = !noteFilename;

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">AI 追问</h2>
        <span className="text-xs text-zinc-400">
          {noteFilename ? `基于《${noteFilename}》` : "打开笔记后可追问"}
        </span>
      </div>

      {/* 消息流 */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !streamingText ? (
          <p className="py-8 text-center text-sm text-zinc-400">
            {noteFilename
              ? "问点什么吧，AI 会结合这篇笔记回答你。"
              : "先打开一篇笔记，再来这里追问。"}
          </p>
        ) : null}

        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}

        {/* 流式生成中的临时气泡 */}
        {streaming && (
          <MessageBubble role="assistant" content={streamingText} streaming />
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <form onSubmit={send} className="flex gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? "请先打开一篇笔记" : "输入问题…"}
          disabled={disabled || streaming}
          className="apple-input h-9 flex-1 px-3 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={disabled || streaming || !input.trim()}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {streaming ? <Spinner className="h-4 w-4" /> : "发送"}
        </button>
      </form>
    </div>
  );
}

/** 单条消息气泡：user 右对齐深色，assistant 左对齐浅色 + Markdown 渲染。 */
function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {isUser ? (
          content
        ) : content ? (
          <Markdown>{content}</Markdown>
        ) : (
          <span className="text-zinc-400">{streaming ? "正在思考…" : ""}</span>
        )}
        {streaming && content && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
      </div>
    </div>
  );
}
