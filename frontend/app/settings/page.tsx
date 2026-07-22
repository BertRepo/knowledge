"use client";
import Link from "next/link";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API 配置</h1>
        <Link href="/" className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300">
          ← 返回主页
        </Link>
      </header>
      <SettingsForm />
      <p className="text-xs text-zinc-400">
        修改后写入 <code>backend/.env</code> 并热加载，无需重启后端。密钥仅存本地，不上传。
      </p>
    </div>
  );
}
