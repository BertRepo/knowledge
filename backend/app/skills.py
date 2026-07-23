"""领域专属摘要 Skills。

每个 skill 定义：某类内容领域应如何组织摘要结构、配什么类型的图解。
analyze 时让 AI 先判领域，再套用对应 skill。这样技术文章突出架构与数据流，
产品文章突出问题/方案/指标，教程突出步骤与坑点--而不是千篇一律的摘要。

两种 skill 来源：
  1. 内置 SKILLS（下面硬编码的 8 个，稳定可用）
  2. 外部自定义 skill：backend/skills/*.md 文件，用户可从 skillsmp.com 下载或自己写。
     文件格式见 _load_custom_skills 的注释。

用户自定义 skill 会与内置合并（同名时自定义覆盖内置），让用户能扩展领域。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Skill:
    domain: str        # 领域标识
    label: str         # 中文标签
    emphasis: str      # 摘要应强调什么
    diagram: str       # 推荐的 mermaid 图类型
    diagram_hint: str  # 图解应表达什么


# 内置 8 个领域 skill：覆盖常见内容类型，每个定义摘要强调点 + 推荐图解类型。
# 这些是经过验证的稳定 skill，用户可用自定义 skill 覆盖或补充。
SKILLS: list[Skill] = [
    Skill("tech", "技术/工程", "架构、组件、数据流、依赖、权衡、踩坑点", "flowchart", "系统架构 / 调用关系 / 数据流"),
    Skill("tutorial", "教程/操作指南", "前置条件、步骤、每步要点、常见报错、验证方法", "flowchart", "操作步骤流程"),
    Skill("product", "产品/商业", "问题与受众、解决方案、价值主张、商业模式、关键指标", "mindmap", "产品要素脑图"),
    Skill("finance", "金融/数据", "核心数据、趋势、风险、结论与假设", "mindmap", "关键要素脑图"),
    Skill("academic", "学术/研究", "研究问题、方法、发现、局限、可复现要点", "flowchart", "研究方法 / 论证流程"),
    Skill("news", "资讯/动态", "5W1H、时间线、影响、背景", "flowchart", "事件时间线 / 流程"),
    Skill("opinion", "观点/评论", "核心论点、论据、反驳、结论", "mindmap", "论点结构脑图"),
    Skill("general", "通用", "主题、要点、结论", "mindmap", "主题脑图"),
]


def _load_custom_skills() -> list[Skill]:
    """从 backend/skills/*.md 加载用户自定义 skill。

    文件格式（Markdown，frontmatter 含结构化字段）：
        ---
        domain: my-skill        # 领域标识（英文小写连字符）
        label: 我的技能          # 中文标签
        diagram: mindmap        # flowchart 或 mindmap
        diagram_hint: 脑图内容   # 图解应表达什么
        ---
        摘要应强调的内容描述（正文部分，可多行）

    用户可从 skillsmp.com 下载 Agent Skill 改成本格式，或自己写。
    解析失败的单个文件会被跳过（不影响其他 skill）。
    """
    skills_dir = Path(__file__).resolve().parent.parent / "skills"
    if not skills_dir.is_dir():
        return []
    out: list[Skill] = []
    for p in sorted(skills_dir.glob("*.md")):
        try:
            text = p.read_text(encoding="utf-8")
            meta, _, body = _parse_frontmatter(text)
            domain = meta.get("domain", "").strip()
            label = meta.get("label", domain).strip()
            diagram = meta.get("diagram", "mindmap").strip()
            diagram_hint = meta.get("diagram_hint", "").strip()
            emphasis = body.strip() or "主题、要点、结论"
            if not domain:
                continue
            # diagram 只接受 flowchart/mindmap，防 AI 出错
            if diagram not in ("flowchart", "mindmap"):
                diagram = "mindmap"
            out.append(Skill(domain, label, emphasis, diagram, diagram_hint))
        except Exception:  # noqa: BLE001
            # 单个文件解析失败不影响整体，跳过即可
            continue
    return out


def _parse_frontmatter(text: str) -> tuple[dict, str, str]:
    """解析极简 frontmatter（--- 分隔），返回 (meta, 分隔符位置后, 正文)。"""
    meta: dict[str, str] = {}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return meta, "", text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            body = "\n".join(lines[i + 1:]).strip()
            break
        if ":" in lines[i]:
            k, _, v = lines[i].partition(":")
            meta[k.strip()] = v.strip()
    else:
        return meta, "", text
    return meta, "", body


def all_skills() -> list[Skill]:
    """内置 skill + 自定义 skill（同名时自定义覆盖内置）。"""
    custom = _load_custom_skills()
    by_domain = {s.domain: s for s in SKILLS}  # 内置打底
    for s in custom:  # 自定义覆盖
        by_domain[s.domain] = s
    return list(by_domain.values())


def valid_domains() -> set[str]:
    """所有合法的 domain 标识（内置 + 自定义）。"""
    return {s.domain for s in all_skills()}


def skills_prompt() -> str:
    """拼成给 AI 看的 skill 清单。"""
    lines = ["先判断内容领域，再套用对应 skill 的结构："]
    for s in all_skills():
        lines.append(
            f"- {s.domain}（{s.label}）：强调【{s.emphasis}】；图解用 {s.diagram}（{s.diagram_hint}）"
        )
    return "\n".join(lines)


# 兼容旧代码：VALID_DOMAINS 现在动态计算
# 注意：analyze 里校验 domain 应调 valid_domains()，不要用这个静态值
VALID_DOMAINS = {s.domain for s in SKILLS}
