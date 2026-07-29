"""抓取网页并提取正文文本。

提取策略：优先用 trafilatura（高质量正文抽取库）；如果未安装或抽取结果不可用，
回退到基于 BeautifulSoup 的启发式抽取。双策略保证「没装可选依赖也能跑」，
也保证遇到 trafilatura 不擅长的页面结构时仍有兜底。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup


# trafilatura 是可选依赖：装了就用它的高质量抽取，没装就走 bs4 兜底。
try:  # 可选依赖，装了效果更好
    import trafilatura  # type: ignore
    _HAS_TRAFILATURA = True
except Exception:  # pragma: no cover
    _HAS_TRAFILATURA = False


# 伪装成正常浏览器，避免被一些网站的简单 UA 检测挡掉
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 这些标签的内容几乎不可能是正文，抽取前直接移除
_DROP_TAGS = (
    "script", "style", "noscript", "template", "iframe", "svg",
    "nav", "footer", "header", "aside", "form", "button",
)


@dataclass
class Scraped:
    """抓取结果：最终 URL（可能因重定向变化）、页面标题、正文文本。"""
    url: str
    title: str
    text: str


def fetch_html(url: str) -> tuple[str, str]:
    """发起 HTTP 请求并返回 (html文本, 最终URL)。

    follow_redirects=True 让 httpx 自动跟随重定向，最终 URL 可能与入参不同。
    编码探测优先用响应头里的声明，查不到再回退 utf-8。
    """
    with httpx.Client(
        headers=HEADERS,
        timeout=30.0,  # 抓取网页超时独立于 LLM 超时，30s 足够
        follow_redirects=True,
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        final_url = str(resp.url)
    # 从响应头/内容探测编码，探测不到就用 utf-8 兜底
    enc = resp.encoding or "utf-8"
    try:
        html = resp.content.decode(enc, errors="replace")
    except (LookupError, TypeError):
        html = resp.content.decode("utf-8", errors="replace")
    return html, final_url


def _extract_title(soup: BeautifulSoup, fallback: str) -> str:
    """提取页面标题：<title> -> <h1> -> 入参兜底。"""
    if soup.title and soup.title.string:
        return re.sub(r"\s+", " ", soup.title.string.strip())
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    return fallback


def _bs4_extract(html: str, url: str) -> Scraped:
    """BeautifulSoup 启发式抽取：找正文容器、移除噪声标签、取文本。"""
    soup = BeautifulSoup(html, "html.parser")

    # 优先从 <article> / <main> 里取，没有就用整个文档
    container = soup.find("article") or soup.find("main") or soup
    for tag in container(list(_DROP_TAGS)):
        tag.decompose()

    # 先试常见的正文 CSS 选择器，命中且内容足够长就用它
    text = ""
    for sel in ("[role=main]", "#content", ".content", "#article", ".article-body", ".post-content"):
        node = soup.select_one(sel)
        if node:
            text = node.get_text("\n", strip=True)
            if len(text) > 200:
                break

    # 选择器没命中或内容太短，回退到容器全文
    if not text or len(text) < 200:
        text = container.get_text("\n", strip=True)

    # 合并过多的连续空行，避免喂给 AI 大量无意义空白
    text = re.sub(r"\n{3,}", "\n\n", text)
    title = _extract_title(soup, url)
    return Scraped(url=url, title=title, text=text)


def _trafilatura_extract(html: str, url: str) -> Scraped | None:
    """trafilatura 抽取：质量高但依赖可选，失败返回 None 让上层走 bs4。"""
    if not _HAS_TRAFILATURA:
        return None
    try:
        text = trafilatura.extract(
            html,
            include_comments=False,  # 不要评论
            include_tables=False,    # 不要表格（表格喂给 AI 噪声大）
            favor_recall=True,       # 宁可多取也不要漏正文
            url=url,
        )
        if not text or len(text) < 120:
            return None
        # 标题仍用 bs4 取（trafilatura 的元数据提取更重，不值得为标题引入）
        soup = BeautifulSoup(html, "html.parser")
        title = _extract_title(soup, url)
        return Scraped(url=url, title=title, text=text.strip())
    except Exception:
        return None


def scrape(url: str, max_chars: int = 20000) -> Scraped:
    """抓取 + 抽取的入口函数。超长正文会被截断，避免撑爆 AI 上下文。

    网络错误会抛出 httpx.HTTPError，由调用方（routers/process.py）转成 HTTP 400。
    """
    html, final_url = fetch_html(url)  # type: ignore[misc]
    page = _trafilatura_extract(html, final_url) or _bs4_extract(html, final_url)
    # 防止把超大页面整篇喂给 AI，截断到 max_chars
    if len(page.text) > max_chars:
        page.text = page.text[:max_chars] + "\n\n…[内容已截断]"
    return page
