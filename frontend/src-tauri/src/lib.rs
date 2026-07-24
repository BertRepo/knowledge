// Tauri 应用入口：启动时拉起 Python 后端（sidecar），退出时彻底清理。
//
// 关键：必须杀整个进程树，否则 sidecar 或 llama-server 成孤儿进程，
// 锁住 knowledge-backend.exe 导致下次安装报 "can't write"。
//
// 清理策略（三重保险，任一触发都杀）：
// 1. 窗口 Destroyed 事件
// 2. RunEvent::ExitRequested（应用退出请求）
// 3. RunEvent::Exit（应用真正退出，最后兜底）
//
// Windows 上用 taskkill /T /F 或 CreateToolhelp32Snapshot 杀进程树，
// 单纯 Child::kill 只杀主进程不杀子进程（llama-server 会残留）。

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
      // 窗口关闭：触发清理（多窗口时只在主窗口关时杀）
      if let tauri::WindowEvent::Destroyed = event {
        kill_backend(window.app_handle());
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // 应用退出：最后兜底，确保 sidecar 进程树被杀干净
      match event {
        tauri::RunEvent::ExitRequested { .. } => {
          kill_backend(app);
        }
        tauri::RunEvent::Exit => {
          kill_backend(app);
        }
        _ => {}
      }
    });
}

/// 杀掉后端 sidecar 及其所有子进程（llama-server 等）。
///
/// 先记下 sidecar 的 PID，用 Windows taskkill /T 杀整个进程树，
/// 再 Child::kill 兜底。这样即使 sidecar 启动了 llama-server 子进程
/// 也会被一起杀掉，不会残留锁文件。
fn kill_backend(app: &tauri::AppHandle) {
  let state: tauri::State<BackendProcess> = app.state();
  let child = { state.0.lock().unwrap().take() };
  if let Some(mut c) = child {
    let pid = c.id();
    // Windows：taskkill /T /F 杀进程树（含所有子进程如 llama-server）
    #[cfg(target_os = "windows")]
    {
      let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    }
    // Mac/Linux：kill 整个进程组
    #[cfg(not(target_os = "windows"))]
    {
      let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
    }
    // 兜底：Rust 的 kill（可能已无效，忽略错误）
    let _ = c.kill();
  }
}

/// 启动 Python 后端。
///
/// 打包后：sidecar `knowledge-backend.exe` 作为 resource 打进包，与主 exe 同目录。
///   用 current_exe() 定位同目录的 sidecar。
/// 开发时：调 backend/.venv311 的 uvicorn。
fn start_backend(_app: &tauri::AppHandle) -> Option<Child> {
  // 打包模式：sidecar 是 onedir 目录（knowledge-backend/knowledge-backend.exe），
  // 作为 resource 与主 exe 同目录
  if let Ok(exe) = std::env::current_exe() {
    let sidecar = exe.with_file_name("knowledge-backend").join(if cfg!(target_os = "windows") {
      "knowledge-backend.exe"
    } else {
      "knowledge-backend"
    });
    if sidecar.exists() {
      // Windows：用 CREATE_NEW_PROCESS_GROUP 让 sidecar 及其子进程成独立进程组，
      // 便于 taskkill /T 杀整树。工作目录设为 sidecar 所在目录，便于它找 local-model。
      #[cfg(target_os = "windows")]
      {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP = 0x00000200
        if let Ok(child) = Command::new(&sidecar)
          .current_dir(sidecar.parent().unwrap())
          .creation_flags(0x00000200)
          .spawn()
        {
          return Some(child);
        }
      }
      #[cfg(not(target_os = "windows"))]
      {
        if let Ok(child) = Command::new(&sidecar)
          .current_dir(sidecar.parent().unwrap())
          .spawn()
        {
          return Some(child);
        }
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
