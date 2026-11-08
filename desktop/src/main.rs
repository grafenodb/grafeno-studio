//! Grafeno Desktop: Grafeno Studio in native windows (Tauri), with no
//! engine inside (engine phase 15.4).
//!
//! Each window has its own connection: a Grafeno server (the local service,
//! one on another machine, or a cluster by its members), or a database
//! file, which the app opens by starting the Grafeno engine installed on
//! the machine for that window ([`engine`]). Every request of the Studio
//! goes through [`request`] to an engine's HTTP API, so the app speaks to
//! engines only as any client does, and no server needs to allow the app as
//! a browser origin.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod bridge;
mod engine;
mod local_store;
use bridge::Reply;
use engine::{EngineInfo, LOCAL_URL, LocalEngine, file_name};
use local_store::LocalStore;

/// Recent databases kept in the menu and on the start screen.
const RECENT: usize = 10;

struct Desktop {
    /// The database file each window has open, by window label.
    sessions: Mutex<HashMap<String, LocalEngine>>,
    recent: Mutex<Vec<PathBuf>>,
    agent: ureq::Agent,
    windows: AtomicU32,
}

impl Default for Desktop {
    fn default() -> Self {
        Self {
            sessions: Mutex::default(),
            recent: Mutex::default(),
            agent: bridge::agent(),
            windows: AtomicU32::new(1),
        }
    }
}

/// A window's open database, as the Studio sees it.
#[derive(Serialize)]
struct SessionInfo {
    /// The internal address the Studio calls (never the engine's port).
    url: String,
    path: String,
    name: String,
    /// The installed engine serving it.
    engine: EngineInfo,
}

fn info(session: &LocalEngine) -> SessionInfo {
    SessionInfo {
        url: format!("{LOCAL_URL}/session/{}", session.id),
        path: session.path.display().to_string(),
        name: file_name(&session.path),
        engine: session.engine.clone(),
    }
}

#[derive(Serialize)]
struct RecentItem {
    path: String,
    name: String,
    exists: bool,
}

fn recent_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("recent.json"))
}

fn load_recent(app: &AppHandle) -> Vec<PathBuf> {
    recent_file(app)
        .and_then(|file| std::fs::read(file).ok())
        .and_then(|bytes| serde_json::from_slice::<Vec<PathBuf>>(&bytes).ok())
        .unwrap_or_default()
}

fn save_recent(app: &AppHandle, recent: &[PathBuf]) {
    if let Some(file) = recent_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(recent) {
            let _ = std::fs::write(file, bytes);
        }
    }
}

fn set_title(app: &AppHandle, label: &str, title: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_title(title);
    }
}

/// Stops engines away from the caller: an engine may take a moment to stop.
fn stop_later(sessions: Vec<LocalEngine>) {
    if !sessions.is_empty() {
        std::thread::spawn(move || sessions.into_iter().for_each(LocalEngine::stop));
    }
}

/// Opens `path` in the window `label` with the installed engine. The
/// window's previous database stays open if the new one fails.
fn open_path(app: &AppHandle, label: &str, path: PathBuf) -> Result<SessionInfo, String> {
    let desktop = app.state::<Desktop>();
    let path = std::path::absolute(&path)
        .map_err(|error| format!("cannot resolve {}: {error}", path.display()))?;
    let path = path.canonicalize().unwrap_or(path);
    {
        let sessions = desktop.sessions.lock().expect("not poisoned");
        for (window, session) in sessions.iter() {
            if session.path == path {
                if window == label {
                    return Ok(info(session));
                }
                return Err(format!("{} is open in another window", path.display()));
            }
        }
    }
    let engine = engine::find_engine().ok_or_else(engine::no_engine)?;
    let started = LocalEngine::start(&engine, &path)?;
    let path = started.path.clone();
    let path = path.canonicalize().unwrap_or(path);
    let reply = info(&started);
    let previous = desktop
        .sessions
        .lock()
        .expect("not poisoned")
        .insert(label.to_owned(), started);
    stop_later(previous.into_iter().collect());

    let mut recent = desktop.recent.lock().expect("not poisoned");
    recent.retain(|other| other != &path);
    recent.insert(0, path.clone());
    recent.truncate(RECENT);
    save_recent(app, &recent);
    drop(recent);
    set_title(app, label, &format!("{} — Grafeno", file_name(&path)));
    let _ = rebuild_menu(app);
    Ok(reply)
}

fn new_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let desktop = app.state::<Desktop>();
    let n = desktop.windows.fetch_add(1, Ordering::Relaxed);
    tauri::WebviewWindowBuilder::new(
        app,
        format!("main-{n}"),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Grafeno")
    .inner_size(1280.0, 840.0)
    .min_inner_size(900.0, 600.0)
    .background_color(tauri::window::Color(5, 7, 10, 255))
    .disable_drag_drop_handler()
    .build()
}

/// The window menus and second launches act on: the focused one.
fn focused(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| windows.get("main").cloned())
        .or_else(|| windows.values().next().cloned())
}

// ------------------------------------------------------------ commands

/// The database open in this window, if any.
#[tauri::command]
fn session(window: WebviewWindow, desktop: State<'_, Desktop>) -> Option<SessionInfo> {
    desktop
        .sessions
        .lock()
        .expect("not poisoned")
        .get(window.label())
        .map(info)
}

/// The engine installed on this computer, if any (looked for again each
/// time: it may have been installed since).
#[tauri::command]
async fn engine_info() -> Option<EngineInfo> {
    tokio::task::spawn_blocking(engine::find_engine)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn open_database(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<SessionInfo, String> {
    let label = window.label().to_owned();
    tokio::task::spawn_blocking(move || open_path(&app, &label, PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn close_database(app: AppHandle, window: WebviewWindow, desktop: State<'_, Desktop>) {
    let closed = desktop
        .sessions
        .lock()
        .expect("not poisoned")
        .remove(window.label());
    stop_later(closed.into_iter().collect());
    set_title(&app, window.label(), "Grafeno");
}

#[tauri::command]
fn open_window(app: AppHandle) -> Result<(), String> {
    new_window(&app)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recent(desktop: State<'_, Desktop>) -> Vec<RecentItem> {
    desktop
        .recent
        .lock()
        .expect("not poisoned")
        .iter()
        .map(|path| RecentItem {
            path: path.display().to_string(),
            name: file_name(path),
            exists: path.exists(),
        })
        .collect()
}

#[tauri::command]
fn forget_recent(app: AppHandle, desktop: State<'_, Desktop>, path: String) {
    let mut recent = desktop.recent.lock().expect("not poisoned");
    recent.retain(|other| other != Path::new(&path));
    save_recent(&app, &recent);
    drop(recent);
    let _ = rebuild_menu(&app);
}

/// Asks for a database file: an existing one, or where to create a new one.
#[tauri::command]
async fn pick_database(app: AppHandle, create: bool) -> Option<String> {
    let dialog = app
        .dialog()
        .file()
        .set_title(if create {
            "New Grafeno database"
        } else {
            "Open a Grafeno database"
        })
        .add_filter("Grafeno database", &["redb", "grafeno"]);
    let picked = if create {
        dialog.set_file_name("memory.redb").blocking_save_file()
    } else {
        dialog.blocking_pick_file()
    };
    picked
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string())
}

/// Asks where to save a file (exports, backups).
#[tauri::command]
async fn pick_save(app: AppHandle, name: String, extension: String) -> Option<String> {
    app.dialog()
        .file()
        .set_file_name(&name)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string())
}

/// Asks for a file to read (imports, scripts, backups to recover).
#[tauri::command]
async fn pick_open(app: AppHandle, extensions: Vec<String>) -> Option<String> {
    let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
    app.dialog()
        .file()
        .add_filter("Files", &extensions)
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string())
}

/// Writes bytes the Studio got through the API (a backup from
/// `GET /v1/backup`) to a file the user picked; it never overwrites.
#[tauri::command]
async fn write_bytes(path: String, bytes_base64: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64)
        .map_err(|error| error.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("cannot create {path}: {error}"))?;
    std::io::Write::write_all(&mut file, &bytes)
        .map_err(|error| format!("cannot write {path}: {error}"))
}

/// Recovers a backup into a new file with the installed engine (`grafeno
/// restore`), without changing any session or the backup.
#[tauri::command]
async fn restore_database(source: String, path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || {
        let engine = engine::find_engine().ok_or_else(engine::no_engine)?;
        engine::restore(&engine, Path::new(&source), Path::new(&path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn write_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|error| format!("cannot write {path}: {error}"))
}

#[tauri::command]
async fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|error| format!("cannot read {path}: {error}"))
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web links open outside the app".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

/// One HTTP request from the Studio: to the engine serving this window's
/// database (with that session's token), or to a Grafeno server.
#[tauri::command]
async fn request(
    window: WebviewWindow,
    desktop: State<'_, Desktop>,
    method: String,
    url: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    body_base64: Option<String>,
) -> Result<Reply, String> {
    let body = bridge::request_body(body, body_base64)?;
    let mut headers = headers;
    let target = match engine::local_path(&url) {
        Some(path) => {
            let (id, rest) = engine::session_path(path)?;
            let mut sessions = desktop.sessions.lock().expect("not poisoned");
            let session = sessions
                .get_mut(window.label())
                .filter(|session| session.id == id)
                .ok_or("the database of this request was closed; reopen it")?;
            if !session.running() {
                return Err(format!(
                    "the engine serving {} stopped; reopen the database",
                    session.path.display()
                ));
            }
            headers.insert("authorization".into(), format!("Bearer {}", session.token));
            format!("{}{rest}", session.url)
        }
        None if url.starts_with("http://") || url.starts_with("https://") => url,
        None => return Err(format!("not a web address: {url}")),
    };
    let agent = desktop.agent.clone();
    tokio::task::spawn_blocking(move || bridge::send(&agent, &method, &target, &headers, body))
        .await
        .map_err(|error| error.to_string())?
}

// ------------------------------------------------------------ menu

/// Menu items whose action happens in the Studio: the focused window gets
/// their id as a `menu` event.
const VIEWS: [(&str, &str, &str); 7] = [
    ("view:overview", "Overview", "CmdOrCtrl+1"),
    ("view:explorer", "Explorer", "CmdOrCtrl+2"),
    ("view:graph", "Graph", "CmdOrCtrl+3"),
    ("view:scripts", "Scripts", "CmdOrCtrl+4"),
    ("view:search", "Search", "CmdOrCtrl+5"),
    ("view:memory", "Memory", "CmdOrCtrl+6"),
    ("view:admin", "Administration", "CmdOrCtrl+7"),
];

fn rebuild_menu(app: &AppHandle) -> tauri::Result<()> {
    let desktop = app.state::<Desktop>();
    let recent = desktop.recent.lock().expect("not poisoned").clone();
    let mut open_recent = SubmenuBuilder::new(app, "Open recent");
    if recent.is_empty() {
        open_recent = open_recent.item(
            &MenuItemBuilder::with_id("none", "No recent databases")
                .enabled(false)
                .build(app)?,
        );
    }
    for (index, path) in recent.iter().enumerate() {
        open_recent = open_recent.item(
            &MenuItemBuilder::with_id(format!("recent:{index}"), path.display().to_string())
                .build(app)?,
        );
    }
    let file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("window", "New window")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("new", "New database…")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open", "Open database…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&open_recent.build()?)
        .item(&MenuItemBuilder::with_id("connect", "Connect to a server…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("import", "Import…").build(app)?)
        .item(
            &MenuItemBuilder::with_id("export", "Export everything…")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("close", "Close database")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .item(&PredefinedMenuItem::quit(app, Some("Quit"))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let mut view = SubmenuBuilder::new(app, "View");
    for (id, label, accelerator) in VIEWS {
        view = view.item(
            &MenuItemBuilder::with_id(id, label)
                .accelerator(accelerator)
                .build(app)?,
        );
    }
    let view = view
        .separator()
        // Ctrl+K is the Studio's own shortcut: no accelerator, or it fires twice.
        .item(&MenuItemBuilder::with_id("palette", "Command palette (Ctrl+K)").build(app)?)
        .item(&MenuItemBuilder::with_id("theme:dark", "Dark theme").build(app)?)
        .item(&MenuItemBuilder::with_id("theme:light", "Light theme").build(app)?)
        .item(&MenuItemBuilder::with_id("theme:system", "System theme").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("reload", "Reload")
                .accelerator("CmdOrCtrl+R")
                .build(app)?,
        )
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help:install", "Install the Grafeno engine").build(app)?)
        .item(&MenuItemBuilder::with_id("help:docs", "Query language (GQ)").build(app)?)
        .item(&MenuItemBuilder::with_id("help:repo", "Grafeno on GitHub").build(app)?)
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &help])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    let desktop = app.state::<Desktop>();
    let window = focused(app);
    match id {
        "window" => {
            let _ = new_window(app);
        }
        "reload" => {
            if let Some(window) = window {
                let _ = window.eval("location.reload()");
            }
        }
        "help:install" => {
            let _ = app.opener().open_url(engine::INSTALL_URL, None::<&str>);
        }
        "help:docs" => {
            let _ = app.opener().open_url(
                "https://github.com/grafenodb/grafeno/blob/main/docs/query-language.md",
                None::<&str>,
            );
        }
        "help:repo" => {
            let _ = app
                .opener()
                .open_url("https://github.com/grafenodb/grafeno", None::<&str>);
        }
        recent if recent.starts_with("recent:") => {
            let index: usize = recent["recent:".len()..].parse().unwrap_or(usize::MAX);
            let path = desktop
                .recent
                .lock()
                .expect("not poisoned")
                .get(index)
                .cloned();
            if let (Some(path), Some(window)) = (path, window) {
                let _ = window.emit_to(window.label(), "open-path", path.display().to_string());
            }
        }
        other => {
            if let Some(window) = window {
                let _ = window.emit_to(window.label(), "menu", other.to_owned());
            }
        }
    }
}

/// A database file given on the command line (or by a second launch).
fn path_argument(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && (arg.ends_with(".redb") || arg.ends_with(".grafeno")))
        .cloned()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // One app: a second launch shows its focused window, and opens
            // its file there.
            if let Some(window) = focused(app) {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = path_argument(&args) {
                    let _ = window.emit_to(window.label(), "open-path", path);
                }
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Desktop::default())
        .manage(LocalStore::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let desktop = handle.state::<Desktop>();
            *desktop.recent.lock().expect("not poisoned") = load_recent(&handle);
            let client_database = handle
                .path()
                .app_config_dir()
                .map_err(|error| format!("cannot locate the client data directory: {error}"))?
                .join("client.sqlite3");
            handle.state::<LocalStore>().initialize(&client_database)?;
            rebuild_menu(&handle)?;
            handle.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = path_argument(&args) {
                // The Studio asks for its window's session when it starts.
                if let Err(error) = open_path(&handle, "main", PathBuf::from(path)) {
                    eprintln!("{error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // A closed window's engine stops.
            if let WindowEvent::Destroyed = event {
                let desktop = window.state::<Desktop>();
                let closed = desktop
                    .sessions
                    .lock()
                    .expect("not poisoned")
                    .remove(window.label());
                stop_later(closed.into_iter().collect());
            }
        })
        .invoke_handler(tauri::generate_handler![
            session,
            engine_info,
            open_database,
            close_database,
            open_window,
            recent,
            forget_recent,
            pick_database,
            pick_save,
            pick_open,
            write_text,
            read_text,
            open_external,
            write_bytes,
            restore_database,
            request,
            local_store::local_scripts,
            local_store::local_put_script,
            local_store::local_delete_script,
            local_store::local_setting,
            local_store::local_put_setting,
        ])
        .build(tauri::generate_context!())
        .expect("the Grafeno window could not start");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // Every engine the app started stops with it, cleanly.
            let desktop = app.state::<Desktop>();
            let all: Vec<LocalEngine> = desktop
                .sessions
                .lock()
                .expect("not poisoned")
                .drain()
                .map(|(_, session)| session)
                .collect();
            all.into_iter().for_each(LocalEngine::stop);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_database_path_on_the_command_line() {
        let args = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            path_argument(&args(&["app", "--flag", "C:/a/b.redb"])).as_deref(),
            Some("C:/a/b.redb")
        );
        assert_eq!(
            path_argument(&args(&["app", "notes.grafeno"])).as_deref(),
            Some("notes.grafeno")
        );
        assert_eq!(path_argument(&args(&["app", "readme.txt"])), None);
    }
}
