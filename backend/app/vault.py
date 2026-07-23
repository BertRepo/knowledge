"""读写 Markdown 笔记文件。

笔记格式说明：
- frontmatter 用类 YAML 格式（--- 分隔），因为写端是我们自己，只需支持扁平的
  key: value，所以手写一个极简解析器即可，不必引入 pyyaml 依赖。
- wikilink 用文件名主干，例如 [[某笔记]]，这是 Markdown 通用约定，
  Obsidian / Logseq / Foam 等工具均支持，并非绑定某一编辑器。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .config import get_settings
from .models import AnalysisResult, NoteFull, NoteMeta

FM_DELIM = "---"
LINKS_HEADER = "## 关联笔记"


# ---------- frontmatter 解析 ----------


@dataclass
class ParsedNote:
    """解析结果：frontmatter 元数据 + 正文。"""
    meta: dict
    body: str


def _parse_frontmatter(text: str) -> ParsedNote:
    """解析笔记的 frontmatter 与正文。

    期望格式：
        ---
        title: ...
        tags: [a, b]
        ---
        <正文>

    因为写端是我们自己，只需支持扁平的 key: value，不引入 pyyaml。
    """
    lines = text.splitlines()
    meta: dict[str, str] = {}
    body_start = 0
    if lines and lines[0].strip() == FM_DELIM:
        # 首行是 ---，往下找配对的结束 ---；中间每行按 key: value 收集
        for i in range(1, len(lines)):
            if lines[i].strip() == FM_DELIM:
                body_start = i + 1  # 结束分隔符的下一行就是正文起点
                break
            line = lines[i]
            if ":" in line:
                k, _, v = line.partition(":")
                meta[k.strip()] = v.strip()
        else:
            # for-else：没遇到结束 ---，frontmatter 不完整，整篇当正文
            body_start = 0
    body = "\n".join(lines[body_start:]).strip()
    return ParsedNote(meta=meta, body=body)


def _parse_list(value: str) -> list[str]:
    """解析 frontmatter 里的 [a, b] 列表字符串为 Python list。"""
    v = value.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    if not v:
        return []
    return [x.strip().strip("'\"") for x in v.split(",") if x.strip()]


def _stem(path: Path) -> str:
    """取文件名主干（去掉 .md 后缀）。"""
    return path.stem


# ---------- 文件名去重 ----------


def unique_path(stem: str, directory: Path) -> Path:
    """生成不冲突的文件路径：同名时追加 -2、-3 后缀。

    保证连续分析同一 URL 不会覆盖之前的笔记。
    """
    candidate = directory / f"{stem}.md"
    n = 2
    while candidate.exists():
        candidate = directory / f"{stem}-{n}.md"
        n += 1
    return candidate


# ---------- 写入笔记 ----------


def build_note_md(a: AnalysisResult, source: str) -> str:
    """把分析结果拼成结构化 Markdown 文本。

    结构：frontmatter（title/source/created/domain/tags）+ 标题 + TL;DR +
    摘要 + 关键点 + 图解 + 标签 + 来源。各小节按需出现（空字段不生成）。
    """
    tags = " ".join(f"#{t}" for t in a.tags) if a.tags else ""
    created = datetime.now().strftime("%Y-%m-%d")
    lines = [
        FM_DELIM,
        f"title: {a.title}",
        f"source: {source}",
        f"created: {created}",
        f"domain: {a.domain}",
        f"tags: [{', '.join(a.tags)}]",
        FM_DELIM,
        "",
        f"# {a.title}",
        "",
        f"> **TL;DR**: {a.tldr}",
        "",
        "## 摘要",
        a.summary.strip() or "_(无摘要)_",
        "",
    ]
    if a.key_points:
        lines += ["## 关键点", *[f"- {p}" for p in a.key_points], ""]
    if a.diagram:
        # 多数 Markdown 编辑器（Obsidian/VSCode 等）原生渲染 mermaid 代码块；前端也会渲染
        lines += ["## 图解", "```mermaid", a.diagram.strip(), "```", ""]
    if tags:
        lines += [f"**标签**: {tags}", ""]
    lines += ["**来源**: " + source, ""]
    return "\n".join(lines)


def save_note(a: AnalysisResult, source: str) -> tuple[str, Path]:
    """把笔记写入 vault，返回 (实际文件名主干, 路径)。

    返回的 stem 可能带 -N 后缀（与 unique_path 的去重逻辑一致），
    调用方应拿这个 stem 而不是 a.filename 去做后续操作。
    """
    vault = get_settings().notes_path
    path = unique_path(a.filename, vault)
    path.write_text(build_note_md(a, source), encoding="utf-8")
    return path.stem, path


# ---------- 读取 / 列表 ----------


def read_note(stem: str) -> NoteFull | None:
    """按文件名主干读取单篇笔记，不存在返回 None。"""
    vault = get_settings().notes_path
    path = vault / f"{stem}.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    parsed = _parse_frontmatter(text)
    m = parsed.meta
    return NoteFull(
        filename=stem,
        title=m.get("title", stem),
        tags=_parse_list(m.get("tags", "")),
        source=m.get("source"),
        created=m.get("created"),
        domain=m.get("domain", "general"),
        body=parsed.body,
    )


def list_notes() -> list[NoteMeta]:
    """列出 vault 里全部笔记，按修改时间倒序排列。"""
    vault = get_settings().notes_path
    out: list[NoteMeta] = []
    for path in sorted(vault.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
        text = path.read_text(encoding="utf-8")
        parsed = _parse_frontmatter(text)
        m = parsed.meta
        out.append(
            NoteMeta(
                filename=path.stem,
                title=m.get("title", path.stem),
                tags=_parse_list(m.get("tags", "")),
                source=m.get("source"),
                created=m.get("created"),
                domain=m.get("domain", "general"),
                mtime=datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            )
        )
    return out


# ---------- 给 AI 关联用的候选视图 ----------


def note_candidates() -> list[dict]:
    """生成全部笔记的轻量视图，供 AI 关联建议使用。

    每条含 filename/title/tags/tldr/domain，其中 tldr 从正文提取。
    注意这里对每篇笔记都读了一次全文（为了取 tldr），笔记量大时可考虑缓存。
    """
    out: list[dict] = []
    for meta in list_notes():
        full = read_note(meta.filename)
        tldr = ""
        if full:
            m = re.search(r"\*\*TL;DR\*\*:\s*(.+)", full.body)
            if m:
                tldr = m.group(1).strip()
            elif full.body:
                tldr = full.body.split("\n", 1)[0][:120]
        out.append(
            {
                "filename": meta.filename,
                "title": meta.title,
                "tags": meta.tags,
                "tldr": tldr,
                "domain": meta.domain,
            }
        )
    return out


# ---------- 添加 wikilink 关联 ----------


def update_note_body(stem: str, new_body: str) -> str:
    """替换笔记正文，保留原 frontmatter，返回新正文。

    用于「在线编辑」：用户改的是正文，frontmatter（title/source/tags 等）
    是结构化元数据，不应被随手覆盖。保留原 frontmatter + 写入新正文。
    """
    vault = get_settings().notes_path
    path = vault / f"{stem}.md"
    if not path.exists():
        raise FileNotFoundError(f"笔记不存在: {stem}")

    text = path.read_text(encoding="utf-8")
    parsed = _parse_frontmatter(text)
    # 规整正文：去首尾空白，保证末尾一个换行（文件卫生）
    body = new_body.strip()

    # 重新拼装：frontmatter（原样保留）+ 新正文
    meta = parsed.meta
    fm_lines = [FM_DELIM]
    for k, v in meta.items():
        fm_lines.append(f"{k}: {v}")
    fm_lines.append(FM_DELIM)
    new_text = "\n".join(fm_lines) + "\n\n" + body + "\n"

    path.write_text(new_text, encoding="utf-8")
    return body


def append_links(stem: str, targets: list[str]) -> tuple[list[str], str]:
    """在笔记的「关联笔记」小节追加 [[target]] 链接，自动去重。

    返回 (实际新增的文件名列表, 更新后的完整正文)。
    如果所有目标都已存在则不写入文件，added 为空。
    """
    vault = get_settings().notes_path
    path = vault / f"{stem}.md"
    if not path.exists():
        raise FileNotFoundError(f"笔记不存在: {stem}")

    text = path.read_text(encoding="utf-8")
    parsed = _parse_frontmatter(text)

    # 去重：用正则收集正文里已有的 [[xxx]]，避免重复添加同一链接
    existing_links = {m.group(1) for m in re.finditer(r"\[\[([^\]]+)\]\]", parsed.body)}
    to_add = [t for t in targets if t and t not in existing_links]

    if not to_add:
        return [], parsed.body

    link_lines = [f"- [[{t}]]" for t in to_add]
    body = parsed.body

    if LINKS_HEADER in body:
        # 已有「## 关联笔记」小节：把新链接插到该标题行后面（小节顶部）
        idx = body.index(LINKS_HEADER) + len(LINKS_HEADER)
        nl = body.find("\n", idx)  # 标题行的换行位置
        insert_at = nl + 1 if nl != -1 else len(body)
        body = body[:insert_at] + "\n".join(link_lines) + "\n" + body[insert_at:]
    else:
        # 没有小节：在文末新建一个
        body = body.rstrip() + "\n\n" + LINKS_HEADER + "\n" + "\n".join(link_lines) + "\n"

    # 重新拼装：frontmatter（原样保留）+ 修改后的正文
    meta = parsed.meta
    fm_lines = [FM_DELIM]
    for k, v in meta.items():
        fm_lines.append(f"{k}: {v}")
    fm_lines.append(FM_DELIM)
    new_text = "\n".join(fm_lines) + "\n\n" + body.rstrip() + "\n"

    path.write_text(new_text, encoding="utf-8")
    return to_add, new_text
