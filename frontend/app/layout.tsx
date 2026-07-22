import type { Metadata } from "next";
import "./globals.css";

const title = "知识聚合器 · 网页 -> AI 摘要 -> Markdown 笔记";
const description =
  "粘贴网页链接，AI 自动摘要并抽取标签，写入 Markdown 笔记，智能建议关联已有笔记，用 [[wikilink]] 逐步构建你的知识网络。支持领域 Skills、Mermaid 图解、Docker 部署。";

export const metadata: Metadata = {
  title: { default: title, template: "%s · 知识聚合器" },
  description,
  keywords: [
    "知识管理", "Obsidian", "AI 摘要", "网页收藏", "知识图谱",
    "wikilink", "Mermaid", "FastAPI", "Next.js", "个人知识库",
  ],
  authors: [{ name: "Knowledge Aggregator" }],
  applicationName: "知识聚合器",
  // 本地工具，搜索引擎索引意义有限；默认 noindex，部署为公开站点时改掉
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    title,
    description,
    siteName: "知识聚合器",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
