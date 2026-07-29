"use client";
import Link from "next/link";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
        <Link href="/" className="apple-btn apple-btn-ghost px-3 py-1.5 text-sm">
          ← 返回
        </Link>
      </header>
      <SettingsForm />
      <p className="text-xs text-zinc-400">
        修改后自动生效，无需重启。密钥仅保存在本地，不上传任何服务器。
      </p>
    </div>
  );
}
