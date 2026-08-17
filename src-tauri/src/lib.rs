use std::fs;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the compiled Bun API server child so it can be terminated on exit.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Path to the per-user server list, stored in the OS-standard app config directory
/// (e.g. ~/.config/<id>/ on Linux, ~/Library/Application Support/<id>/ on macOS, %APPDATA%\<id>\ on Windows).
fn servers_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("servers.json"))
}

/// Returns the stored server list JSON, or an empty string when nothing has been saved yet.
#[tauri::command]
fn load_servers(app: tauri::AppHandle) -> Result<String, String> {
    let path = servers_file(&app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(_) => Ok(String::new()),
    }
}

/// Persists the server list JSON, creating the config directory if needed.
#[tauri::command]
fn save_servers(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = servers_file(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![load_servers, save_servers])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Launch the bundled Bun API server (compiled sidecar) on http://localhost:3000.
            let (mut rx, child) = app.shell().sidecar("rdblog-server")?.spawn()?;
            app.manage(Sidecar(Mutex::new(Some(child))));
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[api] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[api] {}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Make sure the API server is stopped when the app closes.
            if let tauri::RunEvent::Exit = event {
                if let Some(sidecar) = app.try_state::<Sidecar>() {
                    if let Some(child) = sidecar.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
