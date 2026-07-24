// Tauri 应用入口：启动时拉起 Python 后端（sidecar），退出时清理。
//
// 开发模式：直接调 uvicorn（用 .venv311 的 python）
// 打包模式：调 PyInstaller 打包的单文件后端（随 Tauri bundle 分发）
//
// 后端监听 127.0.0.1:8000，前端 WebView 调它的 API。
// llama-server + GGUF 模型作为 Tauri resources 打包，sidecar_main.py
// 在打包模式下从 exe 同级目录的 local-model/ 解析路径。

use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(BackendProcess(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let child = start_backend(app.handle());
      let state: tauri::State<BackendProcess> = app.state();
      *state.0.lock().unwrap() = child;

      Ok(())
    })
    .on_window_event(|window, event| {
      // 窗口关闭时杀掉后端子进程，避免残留
      if let tauri::WindowEvent::Destroyed = event {
        let app = window.app_handle();
        let state: tauri::State<BackendProcess> = app.state();
        let child = { state.0.lock().unwrap().take() };
        if let Some(mut c) = child {
          let _ = c.kill();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// 启动 Python 后端。
///
/// 打包后：sidecar `knowledge-backend.exe` 被 externalBin 打进包，与主 exe 同目录。
///   用 current_exe() 定位同目录的 sidecar。
/// 开发时：调 backend/.venv311 的 uvicorn。
fn start_backend(_app: &tauri::AppHandle) -> Option<Child> {
  // 打包模式：sidecar 与主 exe 同目录（externalBin 打包后放这里）
  if let Ok(exe) = std::env::current_exe() {
    let sidecar = exe.with_file_name(if cfg!(target_os = "windows") {
      "knowledge-backend.exe"
    } else {
      "knowledge-backend"
    });
    if sidecar.exists() {
      if let Ok(child) = Command::new(&sidecar).spawn() {
        return Some(child);
      }
    }
  }

  // 开发模式：调 venv311 的 uvicorn
  let python = if cfg!(target_os = "windows") {
    "../backend/.venv311/Scripts/python.exe"
  } else {
    "../backend/.venv311/bin/python"
  };

  Command::new(python)
    .arg("-m")
    .arg("uvicorn")
    .arg("app.main:app")
    .arg("--host")
    .arg("127.0.0.1")
    .arg("--port")
    .arg("8000")
    .current_dir("../backend")
    .spawn()
    .ok()
}
