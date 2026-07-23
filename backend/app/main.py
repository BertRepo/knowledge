"""FastAPI 应用工厂。

本模块刻意保持精简：只负责创建应用实例、配置 CORS、注册路由。
所有业务逻辑分散在专门的服务模块里（scraper / ai / vault / linker / session），
路由定义统一放在 `routers` 包下。这样做的目的是让 main.py 不承载任何
业务知识，新人只需看这一个文件就能掌握「应用由哪些部分组成」。
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import chat, graph, notes, process, search, sessions, settings, system


def create_app() -> FastAPI:
    """构造 FastAPI 实例。

    用工厂函数而不是模块级直接 `app = FastAPI()` 的好处：
    测试时可以传入不同配置重新创建实例，且能在创建过程中按条件装配中间件/路由。
    """
    app = FastAPI(title="Knowledge Aggregator", version="0.1.0")
    s = get_settings()

    # CORS：前端（默认 localhost:3000）与后端（默认 localhost:8000）不同源，
    # 浏览器会拦截跨域请求，这里按 .env 里 CORS_ORIGINS 白名单放行。
    # allow_credentials=True 配合具体来源（不能用 *）才能携带 Cookie 等凭证。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 路由按职责拆分到独立模块，include_router 只是把它们挂到 app 上。
    # 顺序不影响功能，按「系统 → 核心 → 资源」的逻辑顺序排列便于阅读。
    app.include_router(system.router)
    app.include_router(process.router)
    app.include_router(notes.router)
    app.include_router(sessions.router)
    app.include_router(settings.router)
    app.include_router(chat.router)
    app.include_router(graph.router)
    app.include_router(search.router)
    return app


# 模块级实例：uvicorn 通过 "app.main:app" 字符串导入它来启动服务。
app = create_app()


if __name__ == "__main__":
    # 直接 `python -m app.main` 时用 uvicorn 启动开发服务器（带热重载）。
    # 生产环境应直接用 `uvicorn app.main:app --host 0.0.0.0 --port 8000`。
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "app.main:app",
        host=s.backend_host,
        port=s.backend_port,
        reload=True,
    )
