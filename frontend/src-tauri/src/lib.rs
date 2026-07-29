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
// Windows 上用 taskkill /T /F 杀进程树，确保子进程也退出。

use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};

struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // 应用菜单：编辑菜单 + 帮助菜单
      // 用 app.handle() 创建（Tauri 2 菜单需要 AppHandle，不是 Context）
      let handle = app.handle();
      let edit_menu = Submenu::with_items(
        handle,
        "编辑",
        true,
        &[
          &PredefinedMenuItem::undo(handle, None)?,
          &PredefinedMenuItem::redo(handle, None)?,
          &PredefinedMenuItem::separator(handle)?,
          &PredefinedMenuItem::cut(handle, None)?,
          &PredefinedMenuItem::copy(handle, None)?,
          &PredefinedMenuItem::paste(handle, None)?,
          &PredefinedMenuItem::select_all(handle, None)?,
        ],
      )?;

      let help_menu = Submenu::with_items(
        handle,
        "帮助",
        true,
        &[
          &MenuItem::with_id(handle, "about", "关于知识助手", true, None::<&str>)?,
          &MenuItem::with_id(handle, "guide", "使用说明", true, None::<&str>)?,
          &PredefinedMenuItem::separator(handle)?,
          &MenuItem::with_id(handle, "open_notes", "打开笔记文件夹", true, None::<&str>)?,
          &MenuItem::with_id(handle, "open_settings", "打开设置", true, None::<&str>)?,
        ],
      )?;

      let menu = Menu::with_items(handle, &[&edit_menu, &help_menu])?;
      app.set_menu(menu)?;

      let child = start_backend(app.handle());
      let state: tauri::State<BackendProcess> = app.state();
      *state.0.lock().unwrap() = child;

      Ok(())
    })
    .on_menu_event(|app, event| {
      match event.id().as_ref() {
        "about" => {
          // 弹出关于对话框（用 webview alert，避免依赖 dialog 插件）
          app.emit("menu-about", ()).ok();
        }
        "guide" => {
          app.emit("menu-guide", ()).ok();
        }
        "open_notes" => {
          // 打开笔记目录（默认 ~/knowledge-notes）
          let notes = std::env::var("NOTES_DIR").unwrap_or_else(|_| {
            dirs::home_dir()
              .map(|h| h.join("knowledge-notes").to_string_lossy().to_string())
              .unwrap_or_default()
          });
          if !notes.is_empty() {
            #[cfg(target_os = "windows")]
            { Command::new("explorer").arg(&notes).spawn().ok(); }
            #[cfg(target_os = "macos")]
            { Command::new("open").arg(&notes).spawn().ok(); }
          }
        }
        "open_settings" => {
          app.emit("menu-open-settings", ()).ok();
        }
        _ => {}
      }
    })
    .on_window_event(|window, event| {
      // 窗口关闭：触发清理
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
fn kill_backend(app: &tauri::AppHandle) {
  let state: tauri::State<BackendProcess> = app.state();
  let child = { state.0.lock().unwrap().take() };
  if let Some(mut c) = child {
    let pid = c.id();
    #[cfg(target_os = "windows")]
    {
      let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
      let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    let _ = c.kill();
  }
}

/// 启动 Python 后端。
fn start_backend(_app: &tauri::AppHandle) -> Option<Child> {
  if let Ok(exe) = std::env::current_exe() {
    let sidecar = exe.with_file_name("knowledge-backend").join(if cfg!(target_os = "windows") {
      "knowledge-backend.exe"
    } else {
      "knowledge-backend"
    });
    if sidecar.exists() {
      #[cfg(target_os = "windows")]
      {
        use std::os::windows::process::CommandExt;
        if let Ok(child) = Command::new(&sidecar)
          .current_dir(sidecar.parent().unwrap())
          .env("CORS_ORIGINS", "*")
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
          .env("CORS_ORIGINS", "*")
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
