"use client";
import { HTMLAttributes, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
}

/** 卡片：苹果风格容器，大圆角 + 细阴影 + 淡边框。 */
export function Card({ title, actions, className = "", children, ...rest }: CardProps) {
  return (
    <section
      className={`apple-card overflow-hidden ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
