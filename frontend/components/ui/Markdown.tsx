"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mermaid } from "../Mermaid";

interface MarkdownProps {
  children: string;
  className?: string;
}

/** 渲染 AI 产出的 Markdown（摘要 / 笔记正文）。
 *  特殊处理：```mermaid 代码块交给 Mermaid 组件渲染成图，其余走 react-markdown。
 *  样式在 globals.css 的 .markdown 选择器下。 */
export function Markdown({ children, className = "" }: MarkdownProps) {
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown v9：inline 与 block code 都走 code({node, inline, className, children})
          code(props) {
            const { className: cls, children } = props as {
              className?: string;
              children?: React.ReactNode;
            };
            const text = String(children ?? "");
            const lang = /language-(\w+)/.exec(cls || "")?.[1];
            if (lang === "mermaid") {
              return <Mermaid chart={text} />;
            }
            // 普通代码块：保留原生 <code>
            return <code className={cls}>{children}</code>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
