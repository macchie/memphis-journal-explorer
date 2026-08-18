use std::fs;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the compiled Bun API server child so it can be terminated on exit.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Terminate the bundled API server if it is still running. Safe to call more than
/// once — the child handle is taken out of the shared state, so later calls are no-ops.
fn kill_sidecar(app: &tauri::AppHandle) {
    if let Some(sidecar) = app.try_state::<Sidecar>() {
        if let Ok(mut guard) = sidecar.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

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

            // Ctrl-C (dev) / SIGTERM don't emit `RunEvent::Exit`, so without this the
            // sidecar would be orphaned on `:3000` and `tauri dev` would hang waiting to
            // reap the app. Catch the signal, kill the sidecar, and exit cleanly.
            let handle = app.handle().clone();
            if let Err(err) = ctrlc::set_handler(move || {
                kill_sidecar(&handle);
                handle.exit(0);
            }) {
                log::warn!("failed to install termination handler: {err}");
            }
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
            // Make sure the API server is stopped when the app closes (normal quit path).
            if let tauri::RunEvent::Exit = event {
                kill_sidecar(app);
            }
        });
}
