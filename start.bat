@echo off
chcp 65001 >nul
cd /d "%~dp0"

where bash >nul 2>&1 && (
  bash "%~dp0start.sh"
  goto :end
)
if exist "C:\Program Files\Git\bin\bash.exe" (
  "C:\Program Files\Git\bin\bash.exe" "%~dp0start.sh"
  goto :end
)
if exist "C:\Program Files\Git\git-bash.exe" (
  "C:\Program Files\Git\git-bash.exe" -c "cd '%~dp0' && bash start.sh"
  goto :end
)
echo 未找到 bash（Git Bash）。请安装 Git for Windows，或在 Git Bash 里运行 start.sh

:end
pause
