"""一次性会话历史，存放在操作系统临时目录。

每次 /api/process 调用都会在这里落一个 JSON 快照，让结果可恢复：
浏览器标签关掉、后端重启后，用户仍能从会话历史里找回之前的分析。
整个目录都是一次性的：删除它不会影响真正的笔记库。
这实现了「每次将会话保存在本地临时目录，可以删除」的需求。
"""
from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# 临时目录名，固定放在系统 temp 下，方便用户找到并手动清理
_SESSION_DIR_NAME = "knowledge-sessions"


def session_dir() -> Path:
    """获取（必要时创建）会话目录。"""
    d = Path(tempfile.gettempdir()) / _SESSION_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_session(payload: Dict[str, Any]) -> Path:
    """持久化一次分析的快照。payload 应已是 JSON 安全的数据。"""
    ts = int(time.time())
    payload = {**payload, "saved_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))}
    stem = str(payload.get("note_filename") or payload.get("title") or "note")
    fname = f"{ts}_{_safe(stem)}.json"
    path = session_dir() / fname
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _summarize(data: Dict[str, Any], file: str) -> Dict[str, Any]:
    """从完整快照里抽取列表展示需要的摘要字段。"""
    return {
        "file": file,
        "saved_at": data.get("saved_at"),
        "url": data.get("url"),
        "note_filename": data.get("note_filename"),
        "title": data.get("title"),
        "tldr": data.get("tldr"),
        "tags": data.get("tags", []),
    }


def list_sessions() -> List[Dict[str, Any]]:
    """列出全部会话，按文件名（时间戳前缀）倒序，最新在前。"""
    out: List[Dict[str, Any]] = []
    for p in sorted(session_dir().glob("*.json"), reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        out.append(_summarize(data, p.name))
    return out


def get_session(file: str) -> Optional[Dict[str, Any]]:
    """按文件名读取单个会话快照，不存在或解析失败返回 None。"""
    path = session_dir() / file
    if not path.exists() or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def clear_sessions() -> int:
    """清空全部会话，返回实际删除的文件数。"""
    count = 0
    for p in session_dir().glob("*.json"):
        try:
            p.unlink()
            count += 1
        except Exception:
            continue
    return count


def _safe(name: str) -> str:
    """把任意字符串转成安全的文件名片段：只保留字母数字和 -_，其余替换为 _。"""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:60] or "note"
