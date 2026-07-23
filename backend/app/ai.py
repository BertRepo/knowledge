"""调用 Anthropic 兼容的 /v1/messages 接口。

刻意不使用官方 `anthropic` SDK，而是用 httpx 直接发请求，原因有二：
1. 摆脱 SDK 对 Python 版本的约束（SDK 新版要求 3.8+，部分老环境受限）；
2. 内部 AI 网关有时使用非标准路径，直接控制请求地址更灵活。
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx

from .config import get_settings
from .models import AnalysisResult, RelatedSuggestion
from . import providers
from .skills import VALID_DOMAINS, skills_prompt

# ---------------------------------------------------------------------------
# 底层补全：只管「发请求、取文本」，不关心业务语义
# ---------------------------------------------------------------------------


class AIError(RuntimeError):
    """AI 调用相关的业务异常，上层捕获后转成 HTTP 错误返回给前端。"""
    pass


def complete(system: str, user: str, *, max_tokens: int | None = None) -> str:
    """调用 LLM 返回纯文本回答（委托 providers，自动选 anthropic/openai/local）。

    上层只管「给 system+user，拿文本」，具体走哪个后端由 config.llm_provider 决定，
    在 providers 层消化格式差异（Anthropic content blocks / OpenAI choices）。
    """
    try:
        return providers.complete(system, user, max_tokens=max_tokens)
    except providers.ProviderError as e:
        raise AIError(str(e)) from e


def complete_stream(system: str, user: str, *, max_tokens: int | None = None):
    """流式调用 LLM，yield 文本增量（委托 providers）。

    具体解析（Anthropic content_block_delta / OpenAI delta.content）在 providers 层。
    """
    try:
        yield from providers.complete_stream(system, user, max_tokens=max_tokens)
    except providers.ProviderError as e:
        raise AIError(str(e)) from e


# ---------------------------------------------------------------------------
# 多轮对话流式：区别于 complete_stream（单轮），这里接受完整对话历史
# ---------------------------------------------------------------------------


def chat_stream(system: str, messages: list[dict], *, max_tokens: int | None = None):
    """多轮流式对话，yield 文本增量（委托 providers）。

    与 complete_stream 区别：messages 是多轮历史，而非单个 user 文本。
    """
    try:
        yield from providers.chat_stream(system, messages, max_tokens=max_tokens)
    except providers.ProviderError as e:
        raise AIError(str(e)) from e

# ---------------------------------------------------------------------------
# JSON 提取：模型不一定老老实实只输出 JSON，需要兜底解析
# ---------------------------------------------------------------------------


def _extract_json(text: str) -> Any:
    """从模型输出里提取 JSON 对象或数组。

    模型经常在 JSON 前后夹杂解释性文字或 ```json 围栏，这里依次尝试：
    1. 先剥掉 ```json ... ``` 或 ``` ... ``` 围栏；
    2. 直接 json.loads；
    3. 兜底取最外层 { ... } 或 [ ... ] 片段再解析。
    都失败则抛 AIError。
    """
    s = text.strip()
    # 去掉 markdown 代码围栏
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL)
    if fence:
        s = fence.group(1).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # 兜底：定位最外层配对的花括号或方括号
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = s.find(open_c)
        end = s.rfind(close_c)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(s[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise AIError(f"无法从模型输出解析 JSON: {text[:300]}")


# ---------------------------------------------------------------------------
# 高层业务：分析网页 + 建议关联
# ---------------------------------------------------------------------------

# 分析环节的系统提示词：定义角色、领域 Skills、输出 JSON 字段规范。
# 放在模块级而非函数内，是因为它内容固定、无需每次调用重新拼接。
_ANALYZE_SYSTEM = (
    "你是一个知识整理助手。阅读网页正文，先判断内容领域，再按对应 skill 的结构整理，输出严格的 JSON。\n"
    + skills_prompt()
    + "\n字段：domain(从上述 skill 选一个 domain 标识)、title（简明中文标题，<=40字）、"
    "tldr（一句话总结，<=60字）、summary（按所选 skill 的强调点结构化的 Markdown，可含小节标题）、"
    "key_points（3-8 条关键点字符串数组）、tags（3-8 个小写下划线标签，无#）、"
    "diagram（用该领域推荐的 mermaid 图类型表达核心结构，**只输出纯 mermaid 代码，不要```围栏**，"
    "若内容确实不适合画图则返回空字符串）、filename（用于保存的文件名，可含中文，<=40字，不含扩展名与路径分隔符）。"
    "只返回 JSON，不要解释。"
)


def analyze(text: str, url: str, title_hint: str) -> AnalysisResult:
    """让 AI 把一篇网页正文整理成结构化笔记字段。

    流程：拼提示词 → complete() 拿到模型输出 → _extract_json() 兜底解析
    → 逐字段取值并做类型清洗 → filename 做安全化处理（去掉路径分隔符等）。

    模型的输出不可信（可能漏字段、类型错乱、夹带围栏），所以每个字段都要兜底。
    """
    user = (
        f"网页URL: {url}\n页面标题: {title_hint}\n\n正文内容:\n{text}\n\n"
        "请按系统要求输出 JSON。"
    )
    raw = complete(_ANALYZE_SYSTEM, user)
    data = _extract_json(raw)
    if not isinstance(data, dict):
        raise AIError("分析结果不是 JSON 对象")

    # 模型偶尔把本应是字符串/列表的字段写成标量，这里统一兜底成正确类型
    def _str(k: str, default: str = "") -> str:
        v = data.get(k, default)
        return str(v).strip() if v is not None else default

    def _list(k: str) -> list[str]:
        v = data.get(k, [])
        if isinstance(v, str):  # 标量也兼容成单元素列表
            v = [v]
        return [str(x).strip() for x in v if str(x).strip()]

    title = _str("title") or title_hint
    filename = _sanitize_filename(_str("filename") or title)
    if not filename:
        filename = "note"

    # 领域白名单校验：只接受 skills.py 里预定义的 domain，非法值兜底成 general
    domain = _str("domain", "general") or "general"
    if domain not in VALID_DOMAINS:
        domain = "general"

    # 图解：模型可能不听话带了 ``` 围栏，剥掉；前后空白也清掉
    diagram = _str("diagram")
    diagram = _strip_mermaid_fence(diagram)

    return AnalysisResult(
        title=title,
        tldr=_str("tldr", title),
        summary=_str("summary").strip(),
        key_points=_list("key_points"),
        tags=_list("tags"),
        filename=filename,
        domain=domain,
        diagram=diagram,
    )


# ---------------------------------------------------------------------------
# 流式分析：摘要正文先流式输出给前端看，元数据 JSON 紧随其后
# ---------------------------------------------------------------------------

# 摘要正文与元数据 JSON 之间的分隔符。选这么长的串是为了避免与正文内容冲突。
_META_DELIMITER = "\n<<<META>>>\n"

# 流式分析的系统提示词：与 _ANALYZE_SYSTEM 字段一致，但输出格式不同——
# 先输出摘要 markdown（可流式渲染），再输出分隔符，最后输出元数据 JSON。
# 这样前端能在摘要生成时就看到内容，而不是等整个 JSON 返回。
_ANALYZE_SYSTEM_STREAM = (
    "你是一个知识整理助手。阅读网页正文，先判断内容领域，再按对应 skill 的结构整理。\n"
    + skills_prompt()
    + "\n输出格式（严格遵守，不要有任何额外解释）：\n"
    "1. 先直接输出摘要正文——按所选 skill 的强调点结构化的 Markdown，可含小节标题。"
    "这部分是用户会实时看到的内容，应当完整自洽。\n"
    "2. 然后输出一行分隔符（独占一行）：" + _META_DELIMITER.strip() + "\n"
    "3. 最后输出一个 JSON 对象（不要 ```围栏），含字段："
    "domain(从上述 skill 选一个 domain 标识)、title（简明中文标题，<=40字）、"
    "tldr（一句话总结，<=60字）、key_points（3-8 条关键点字符串数组）、"
    "tags（3-8 个小写下划线标签，无#）、"
    "diagram（用该领域推荐的 mermaid 图类型表达核心结构，只输出纯 mermaid 代码，不要围栏，"
    "不适合画图则返回空字符串）、filename（用于保存的文件名，可含中文，<=40字，不含扩展名与路径分隔符）。"
)


def analyze_stream(text: str, url: str, title_hint: str):
    """流式分析生成器。

    产出两类事件（元组）：
        ("summary", chunk)  —— 摘要正文的增量文本，前端可实时渲染
        ("result", AnalysisResult)  —— 最终解析出的完整结构化结果（最后产出一次）

    解析逻辑：用 buffer 累积文本，在 buffer 里找分隔符。分隔符之前是摘要（流式 yield），
    之后是元数据 JSON（累积后一次性解析）。为防止分隔符被切断在两个 chunk 之间，
    每次只输出 buffer 里「安全部分」（保留末尾与分隔符等长的字符不输出）。
    """
    user = (
        f"网页URL: {url}\n页面标题: {title_hint}\n\n正文内容:\n{text}\n\n"
        "请按系统要求输出。"
    )

    buffer = ""
    delimiter_seen = False
    summary_full = ""
    meta_full = ""

    for chunk in complete_stream(_ANALYZE_SYSTEM_STREAM, user):
        if delimiter_seen:
            # 分隔符已出现，后续全是元数据 JSON，累积起来最后解析
            meta_full += chunk
            continue

        buffer += chunk
        pos = buffer.find(_META_DELIMITER)
        if pos != -1:
            # 找到分隔符：pos 之前是摘要正文（输出），之后是元数据开头
            summary_part = buffer[:pos]
            if summary_part:
                summary_full += summary_part
                yield ("summary", summary_part)
            meta_full = buffer[pos + len(_META_DELIMITER):]
            buffer = ""
            delimiter_seen = True
        else:
            # 没找到分隔符：输出 buffer 中安全的部分，保留末尾若干字符
            # 防止分隔符正好被切断在两次 yield 之间
            keep = len(_META_DELIMITER) - 1
            if len(buffer) > keep:
                safe = buffer[:-keep]
                summary_full += safe
                yield ("summary", safe)
                buffer = buffer[-keep:]

    # 流结束后还有残余 buffer 且没遇到分隔符：全部当摘要输出
    if not delimiter_seen and buffer:
        summary_full += buffer
        yield ("summary", buffer)

    # 解析元数据 JSON
    meta_text = meta_full.strip()
    if not meta_text:
        # 模型可能完全没遵守格式（没输出分隔符），把全文当 JSON 兜底解析
        meta_text = summary_full

    data = _extract_json(meta_text)
    if not isinstance(data, dict):
        raise AIError("分析结果元数据不是 JSON 对象")

    # 复用 analyze() 里的字段清洗逻辑
    def _str(k: str, default: str = "") -> str:
        v = data.get(k, default)
        return str(v).strip() if v is not None else default

    def _list(k: str) -> list[str]:
        v = data.get(k, [])
        if isinstance(v, str):
            v = [v]
        return [str(x).strip() for x in v if str(x).strip()]

    title = _str("title") or title_hint
    filename = _sanitize_filename(_str("filename") or title)
    if not filename:
        filename = "note"

    domain = _str("domain", "general") or "general"
    if domain not in VALID_DOMAINS:
        domain = "general"

    diagram = _strip_mermaid_fence(_str("diagram"))

    yield ("result", AnalysisResult(
        title=title,
        tldr=_str("tldr", title),
        summary=summary_full.strip(),
        key_points=_list("key_points"),
        tags=_list("tags"),
        filename=filename,
        domain=domain,
        diagram=diagram,
    ))


# 关联建议的系统提示词：给定新笔记 + 候选列表，让模型判断哪些已有笔记相关。
_RELATE_SYSTEM = (
    "你是知识关联助手。给定一篇新笔记和若干已有笔记候选，判断哪些已有笔记与新笔记相关。"
    "只返回 JSON 数组，每项含 filename(原样填回)、title、reason(一句话中文理由)、"
    "score(0~1 相关度，越高越相关)。不要包含候选列表之外的笔记，"
    "按相关度降序，最多返回指定数量。无相关项时返回空数组 []。只返回 JSON。"
)


def suggest_related(
    analysis: AnalysisResult,
    candidates: list[dict],
    max_suggestions: int = 6,
) -> list[RelatedSuggestion]:
    """让 AI 从候选笔记里挑出与新笔记相关的若干篇。

    参数 candidates 是 list[{filename, title, tags, tldr}]，来自 vault.note_candidates()。
    返回按 score 降序排列的建议列表，最多 max_suggestions 条。
    """
    if not candidates:
        return []

    # 把候选清单拼成文本喂给模型，让它知道有哪些笔记可选
    cand_block = "\n".join(
        f"- filename: {c['filename']} | domain: {c.get('domain','general')} | "
        f"title: {c.get('title','')} | tags: {','.join(c.get('tags', []))} | tldr: {c.get('tldr','')}"
        for c in candidates
    )
    user = (
        f"新笔记:\ndomain: {analysis.domain}\ntitle: {analysis.title}\ntldr: {analysis.tldr}\n"
        f"tags: {','.join(analysis.tags)}\nkey_points: "
        f"{json.dumps(analysis.key_points, ensure_ascii=False)}\n\n"
        f"已有笔记候选:\n{cand_block}\n\n"
        f"最多返回 {max_suggestions} 条相关建议。"
    )
    raw = complete(_RELATE_SYSTEM, user)
    data = _extract_json(raw)
    if not isinstance(data, list):
        return []

    out: list[RelatedSuggestion] = []
    # 安全闸：只接受候选集合里真实存在的 filename，防止模型幻觉出不存在的笔记
    valid_names = {c["filename"] for c in candidates}
    for item in data:
        if not isinstance(item, dict):
            continue
        fname = str(item.get("filename", "")).strip()
        if not fname or fname not in valid_names:
            continue  # 永远不信任模型凭空捏造的 filename
        out.append(
            RelatedSuggestion(
                filename=fname,
                title=str(item.get("title", "")).strip(),
                reason=str(item.get("reason", "")).strip(),
                score=float(item.get("score", 0.0) or 0.0),
            )
        )
    out.sort(key=lambda x: x.score, reverse=True)
    return out[:max_suggestions]


# ---------------------------------------------------------------------------
# 文本清洗辅助函数
# ---------------------------------------------------------------------------

# 文件名里不允许出现的字符：路径分隔符、通配符、控制字符等
_BAD = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def _sanitize_filename(name: str) -> str:
    """把模型给的文件名清洗成操作系统安全的字符串。

    去掉非法字符、合并连续空白、截断到 80 字符以内。
    这一步既是安全措施（防止路径穿越），也保证文件名在 Markdown 编辑器里正常显示。
    """
    name = _BAD.sub(" ", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name[:80].strip()


def _strip_mermaid_fence(text: str) -> str:
    """去掉模型可能误加的 ```mermaid ... ``` 围栏，返回纯 mermaid 代码。

    另外还原字面的 \\n \\t（模型有时会把换行转义成双反斜杠形式，
    mermaid 解析器不认这种转义，会导致图渲染失败）。
    """
    t = text.strip()
    fence = re.search(r"```(?:mermaid)?\s*(.*?)```", t, re.DOTALL)
    if fence:
        t = fence.group(1).strip()
    t = t.replace("\\n", "\n").replace("\\t", "\t")
    return t.strip()
