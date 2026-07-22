"use client";
// Button 组件：演示 React 的 forwardRef + 变体映射模式。
//
// forwardRef：让父组件能拿到底层 <button> 的 DOM 引用（用于聚焦、动画等）。
// 函数组件默认拿不到 ref，必须用 forwardRef 包一层。
// VARIANTS / SIZES 用 Record 映射，把样式按维度拆开，避免 className 拼接地狱。
import { ButtonHTMLAttributes, forwardRef } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "ghost" | "danger";
type Size = "sm" | "md";

// 变体 -> className 映射：新增一个风格只需加一行，不用改组件逻辑
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-zinc-900 text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
  ghost:
    "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

// 第二个参数 ref 就是 forwardRef 注入的 ref 引用
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", loading, disabled, className = "", children, ...rest },
  ref,
) {
  // loading 时禁用并显示转圈；disabled 与 loading 任一为真都不可点
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});
