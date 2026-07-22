"""领域专属摘要 Skills。

每个 skill 定义：某类内容领域应如何组织摘要结构、配什么类型的图解。
analyze 时让 AI 先判领域，再套用对应 skill。这样技术文章突出架构与数据流，
产品文章突出问题/方案/指标，教程突出步骤与坑点——而不是千篇一律的摘要。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Skill:
    domain: str        # 领域标识
    label: str         # 中文标签
    emphasis: str      # 摘要应强调什么
    diagram: str       # 推荐的 mermaid 图类型
    diagram_hint: str  # 图解应表达什么


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

# 便于 O(1) 校验 AI 返回的 domain 是否合法
VALID_DOMAINS = {s.domain for s in SKILLS}


def skills_prompt() -> str:
    """拼成给 AI 看的 skill 清单。"""
    lines = ["先判断内容领域，再套用对应 skill 的结构："]
    for s in SKILLS:
        lines.append(
            f"- {s.domain}（{s.label}）：强调【{s.emphasis}】；图解用 {s.diagram}（{s.diagram_hint}）"
        )
    return "\n".join(lines)
