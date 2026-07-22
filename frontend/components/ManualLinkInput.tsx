"use client";
// 手动添加关联：输入笔记名搜索，用 <datalist> 提供候选补全。
//
// datalist 的好处：原生补全体验，无需自己写下拉框。配合实时过滤，
// 只在用户有输入时才给候选（query 为空时 filtered 为空，不干扰）。
import { FormEvent, useState } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface ManualLinkInputProps {
  noteFilename: string;
  candidates: { filename: string; title: string }[];
  onLink: (target: string) => Promise<string[]>;
}

export function ManualLinkInput({ noteFilename, candidates, onLink }: ManualLinkInputProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const query = value.trim().toLowerCase();
  const filtered = query
    ? candidates.filter((c) => c.filename.toLowerCase().includes(query) || c.title.toLowerCase().includes(query)).slice(0, 6)
    : [];

  async function add(target: string) {
    if (!target) return;
    setBusy(true);
    try {
      const added = await onLink(target);
      setMsg(added.length ? `已添加 [[${added[0]}]]` : "[[链接]]已存在");
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    add(value.trim());
  }

  return (
    <Card title="手动添加关联">
      <form onSubmit={submit} className="flex gap-2">
        <input
          list="note-candidates"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`输入要关联的笔记名（如 ${noteFilename || "…"}）`}
          className="h-9 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <Button size="sm" type="submit" loading={busy} disabled={!value.trim()}>
          添加链接
        </Button>
        <datalist id="note-candidates">
          {filtered.map((c) => (
            <option key={c.filename} value={c.filename}>
              {c.title}
            </option>
          ))}
        </datalist>
      </form>
      {msg && <p className="mt-2 text-xs text-zinc-500">{msg}</p>}
    </Card>
  );
}
