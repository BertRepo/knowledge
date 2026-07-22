#!/usr/bin/env bash
# 一键启动：后端 (uvicorn :8000) + 前端 (next dev :3000)
# 用法：在 Git Bash 中  bash start.sh   或双击 start.bat
# Ctrl+C 停止全部。日志在 .logs/。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

PYTHON="$ROOT/backend/.venv/Scripts/python.exe"

say() { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }

# ---------- 后端准备 ----------
say "后端：检查虚拟环境..."
if [ ! -f "$PYTHON" ]; then
  ( cd "$ROOT/backend" && python -m venv .venv )
fi
if ! "$PYTHON" -c "import fastapi, uvicorn, httpx, bs4" >/dev/null 2>&1; then
  say "后端：安装依赖（首次较慢）..."
  "$PYTHON" -m pip install -r "$ROOT/backend/requirements.txt" -q
fi
if [ ! -f "$ROOT/backend/.env" ]; then
  say "⚠️ backend/.env 不存在，已从 .env.example 复制（请填入 AI 凭证后重启）"
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
fi

# ---------- 前端准备 ----------
say "前端：检查依赖..."
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  ( cd "$ROOT/frontend" && npm install )
fi

# ---------- 启动 ----------
say "启动后端 :8000..."
( cd "$ROOT/backend" && exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload ) \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

say "启动前端 :3000..."
( cd "$ROOT/frontend" && exec npm run dev ) \
  > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

kill_tree() {
  local pid=$1
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  else
    kill -- "$pid" 2>/dev/null || true
  fi
}
cleanup() {
  echo
  say "停止服务..."
  kill_tree "$BACKEND_PID"
  kill_tree "$FRONTEND_PID"
  kill "$TAIL_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo
say "✅ 已启动"
echo "   前端:  http://localhost:3000"
echo "   后端:  http://127.0.0.1:8000/api/health"
echo "   日志:  $LOG_DIR/backend.log  |  $LOG_DIR/frontend.log"
echo "   Ctrl+C 停止全部"
echo

tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" &
TAIL_PID=$!
wait "$BACKEND_PID" "$FRONTEND_PID" || true
