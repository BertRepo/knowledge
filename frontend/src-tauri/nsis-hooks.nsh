; NSIS 安装/卸载钩子：卸载时清理 app data 目录的残留文件。
; Tauri 默认只删安装目录，但运行时生成的配置、日志、WebView 缓存在 app data，
; 不清理会遗留。这里在卸载时强制删除。

Section "un.CleanAppData"
  ; 配置文件、加密密钥、日志
  RMDir /r "$APPDATA\knowledge-assistant"
  ; WebView2 缓存（Tauri 用 identifier 命名）
  RMDir /r "$LOCALAPPDATA\com.knowledge-aggregator.desktop"
  ; 兜底：安装目录下 sidecar 运行时日志（可能因锁没被删）
  Delete "$INSTDIR\sidecar.log"
SectionEnd
