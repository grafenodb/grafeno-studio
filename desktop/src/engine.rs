//! Local databases without an engine inside the app (engine phase 15.4).
//!
//! The app links no engine code. To open a database file it starts the
//! Grafeno engine installed on the machine as a child process:
//! `grafeno serve --db FILE --addr 127.0.0.1:0 --token <one for this
//! session> --stop-with-stdin`, on a loopback port only, and talks to it
//! over HTTP like any server. Closing the file, opening another, closing
//! the window or the app ending (even by a crash) closes the engine's
//! standard input, and the engine stops cleanly as on Ctrl+C.
//!
//! The Studio never sees the port or the token: it calls the session's
//! internal address (`http://grafeno.local/session/<id>/…`), which the
//! bridge sends to the engine with the token.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;

/// The internal origin of local sessions, as the Studio sees them.
pub const LOCAL_URL: &str = "http://grafeno.local";

/// Where the engine's installers are explained.
pub const INSTALL_URL: &str = "https://github.com/grafenodb/grafeno/blob/main/docs/install.md";

/// How long an engine may take to start serving a file (a large file may
/// be checked, or its layout upgraded, first).
const START_TIMEOUT: Duration = Duration::from_secs(120);

/// How long a closing engine may take to stop before it is killed.
const STOP_TIMEOUT: Duration = Duration::from_secs(15);

/// The engine found on this machine.
#[derive(Clone, Debug, Serialize)]
pub struct EngineInfo {
    pub path: String,
    /// `grafeno --version`'s answer, such as `grafeno 0.1.0`.
    pub version: String,
}

fn program() -> &'static str {
    if cfg!(windows) {
        "grafeno.exe"
    } else {
        "grafeno"
    }
}

/// Where an installed engine may be, in order: `GRAFENO_BIN`, the `PATH`,
/// then where the installers put it.
pub fn candidates() -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(bin) = std::env::var_os("GRAFENO_BIN") {
        found.push(PathBuf::from(bin));
    }
    if let Some(path) = std::env::var_os("PATH") {
        found.extend(std::env::split_paths(&path).map(|dir| dir.join(program())));
    }
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432"] {
            if let Some(dir) = std::env::var_os(var) {
                found.push(PathBuf::from(dir).join("Grafeno").join("grafeno.exe"));
            }
        }
        if let Some(dir) = std::env::var_os("LOCALAPPDATA") {
            found.push(
                PathBuf::from(dir)
                    .join("Programs")
                    .join("Grafeno")
                    .join("grafeno.exe"),
            );
        }
    } else {
        found.push(PathBuf::from("/usr/bin/grafeno"));
        found.push(PathBuf::from("/usr/local/bin/grafeno"));
        if let Some(home) = std::env::var_os("HOME") {
            found.push(PathBuf::from(home).join(".local/bin/grafeno"));
        }
    }
    found
}

/// The first candidate that runs and says it is Grafeno.
pub fn find_engine() -> Option<EngineInfo> {
    candidates().into_iter().find_map(|path| {
        if !path.is_file() {
            return None;
        }
        let mut command = Command::new(&path);
        command
            .arg("--version")
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        hide_window(&mut command);
        let output = command.output().ok()?;
        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (output.status.success() && version.starts_with("grafeno")).then(|| EngineInfo {
            path: path.display().to_string(),
            version,
        })
    })
}

/// What the app says when no engine is installed.
pub fn no_engine() -> String {
    format!(
        "No Grafeno engine is installed on this computer. Grafeno Desktop opens database \
         files with the installed engine (as pgAdmin uses PostgreSQL): install it from \
         {INSTALL_URL}, or set GRAFENO_BIN to its program."
    )
}

/// On Windows, a console program started from a window app would flash a
/// console window.
fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// A random token of 43 URL-safe characters (256 bits).
fn new_token() -> Result<String, String> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut bytes = [0u8; 43];
    getrandom::fill(&mut bytes).map_err(|error| format!("no random source: {error}"))?;
    Ok(bytes
        .iter()
        .map(|b| ALPHABET[(*b & 63) as usize] as char)
        .collect())
}

/// One database file served by an engine started for it.
pub struct LocalEngine {
    pub id: String,
    pub path: PathBuf,
    /// Where the engine listens: `http://127.0.0.1:<port>`.
    pub url: String,
    pub token: String,
    pub engine: EngineInfo,
    child: Child,
    /// Held open while the session lasts; dropping it stops the engine.
    stdin: Option<ChildStdin>,
}

impl LocalEngine {
    /// Starts `engine` for the file at `path` (created if missing) and
    /// waits until it serves. A file another program holds (the Grafeno
    /// service, another window) is refused with a clear message.
    pub fn start(engine: &EngineInfo, path: &Path) -> Result<Self, String> {
        Self::start_with(engine, path, new_token()?)
    }

    /// [`LocalEngine::start`] with a given token.
    fn start_with(engine: &EngineInfo, path: &Path, token: String) -> Result<Self, String> {
        let mut command = Command::new(&engine.path);
        command
            .args(["serve", "--stop-with-stdin", "--addr", "127.0.0.1:0"])
            // One argument: a token may start with `-`, which on its own
            // would be read as an option (one start in 64 failed so).
            .arg(format!("--token={token}"))
            .arg("--db")
            .arg(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            // The engine's own settings file must not apply.
            .env_remove("GRAFENO_CONFIG")
            .env_remove("GRAFENO_DB")
            .env_remove("GRAFENO_ADDR")
            .env_remove("GRAFENO_TOKEN");
        hide_window(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("cannot start {}: {error}", engine.path))?;
        let stdin = child.stdin.take();
        let stderr = child.stderr.take().expect("piped stderr");

        // The engine's output is read on a thread for the whole session (a
        // full pipe would block it); the first lines tell where it listens.
        let (lines, received) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if lines.send(line).is_err() {
                    // Nobody waits any more: keep draining.
                }
            }
        });
        let started = Instant::now();
        let mut output = Vec::new();
        let url = loop {
            match received.recv_timeout(Duration::from_millis(200)) {
                Ok(line) => {
                    if let Some(url) = line.trim().strip_prefix("grafeno listening on ") {
                        break url.to_owned();
                    }
                    output.push(line);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = child.wait();
                    return Err(refusal(path, &output));
                }
            }
            if let Ok(Some(_)) = child.try_wait() {
                // Let the reader hand over the last lines.
                while let Ok(line) = received.recv_timeout(Duration::from_millis(100)) {
                    output.push(line);
                }
                return Err(refusal(path, &output));
            }
            if started.elapsed() > START_TIMEOUT {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "the engine did not start serving {} in {} s",
                    path.display(),
                    START_TIMEOUT.as_secs()
                ));
            }
        };
        Ok(Self {
            // Its own random id: the Studio sees it, never the token.
            id: new_token()?[..16].to_owned(),
            path: path.to_path_buf(),
            url,
            token,
            engine: engine.clone(),
            child,
            stdin,
        })
    }

    /// Stops the engine: its stdin closes and it stops as on Ctrl+C; one
    /// that does not within [`STOP_TIMEOUT`] is killed.
    pub fn stop(mut self) {
        self.shut_down();
    }

    fn shut_down(&mut self) {
        drop(self.stdin.take());
        let started = Instant::now();
        while started.elapsed() < STOP_TIMEOUT {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    /// Whether the engine still runs.
    pub fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

impl Drop for LocalEngine {
    fn drop(&mut self) {
        if self.stdin.is_some() {
            self.shut_down();
        }
    }
}

/// Why an engine would not serve a file, from what it printed.
fn refusal(path: &Path, output: &[String]) -> String {
    let text = output.join("\n");
    let lower = text.to_ascii_lowercase();
    if lower.contains("lock") || lower.contains("already open") || lower.contains("being used") {
        format!(
            "{} is open in another program (the Grafeno service, or another window)",
            path.display()
        )
    } else if text.trim().is_empty() {
        format!("the engine stopped before serving {}", path.display())
    } else {
        format!(
            "the engine cannot open {}: {}",
            path.display(),
            text.lines()
                .last()
                .unwrap_or("")
                .trim_start_matches("grafeno: ")
        )
    }
}

/// Recovers a backup into a new file with the installed engine
/// (`grafeno restore`); returns the new file's size.
pub fn restore(engine: &EngineInfo, source: &Path, path: &Path) -> Result<u64, String> {
    let mut command = Command::new(&engine.path);
    command
        .arg("restore")
        .arg(source)
        .arg(path)
        .stdin(Stdio::null());
    hide_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("cannot start {}: {error}", engine.path))?;
    if !output.status.success() {
        let text = String::from_utf8_lossy(&output.stderr);
        return Err(text.trim().trim_start_matches("grafeno: ").to_owned());
    }
    std::fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|error| error.to_string())
}

/// The session a Studio address names: `None` unless it is the internal
/// origin.
pub fn local_path(url: &str) -> Option<&str> {
    url.strip_prefix(LOCAL_URL)
        .filter(|path| path.is_empty() || path.starts_with('/'))
}

/// Splits `/session/<id>/<rest>` into the id and `/<rest>`.
pub fn session_path(path: &str) -> Result<(&str, String), String> {
    let scoped = path
        .strip_prefix("/session/")
        .ok_or("missing database session; reopen the database")?;
    let (id, rest) = scoped.split_once('/').unwrap_or((scoped, ""));
    Ok((id, format!("/{rest}")))
}

pub fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// End to end against the real engine binary (`GRAFENO_BIN`, or one
/// installed): what the app does with a local file.
#[cfg(test)]
mod with_the_engine {
    use super::*;
    use crate::bridge::{agent, send};
    use std::collections::BTreeMap;

    fn engine() -> EngineInfo {
        find_engine().expect("these tests need the engine: set GRAFENO_BIN to grafeno's binary")
    }

    fn call(
        session: &LocalEngine,
        method: &str,
        path: &str,
        body: &str,
        auth: bool,
    ) -> (u16, serde_json::Value) {
        let mut headers =
            BTreeMap::from([("content-type".to_owned(), "application/json".to_owned())]);
        if auth {
            headers.insert("authorization".into(), format!("Bearer {}", session.token));
        }
        let reply = send(
            &agent(),
            method,
            &format!("{}{path}", session.url),
            &headers,
            body.as_bytes().to_vec(),
        )
        .unwrap();
        (
            reply.status,
            serde_json::from_str(&reply.body).unwrap_or(serde_json::Value::Null),
        )
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("grafeno-desktop-{name}-{}", new_token().unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_token_that_starts_with_a_dash_is_not_taken_for_an_option() {
        let engine = engine();
        let dir = temp_dir("dash");
        let session =
            LocalEngine::start_with(&engine, &dir.join("memory.redb"), "-dash_token".into())
                .unwrap();
        assert_eq!(session.token, "-dash_token");
        assert_eq!(call(&session, "GET", "/v1/namespaces", "", true).0, 200);
    }

    #[test]
    fn a_local_file_is_served_by_the_installed_engine() {
        let engine = engine();
        let dir = temp_dir("open");
        let path = dir.join("memory.redb");
        let session = LocalEngine::start(&engine, &path).unwrap();
        assert!(
            session.url.starts_with("http://127.0.0.1:"),
            "loopback only: {}",
            session.url
        );
        assert!(path.exists(), "a new file was created");

        // The engine answers only with this session's token.
        assert_eq!(call(&session, "GET", "/v1/namespaces", "", false).0, 401);
        let (status, about) = call(&session, "GET", "/v1/about", "", false);
        assert_eq!(status, 200);
        assert_eq!(about["product"], "grafeno");
        let (status, _) = call(
            &session,
            "POST",
            "/v1/namespaces",
            r#"{"name":"lab"}"#,
            true,
        );
        assert_eq!(status, 201);
        let (status, _) = call(
            &session,
            "POST",
            "/v1/lab/query",
            r#"{"query":"CREATE (:Person {name: 'Ana'})"}"#,
            true,
        );
        assert_eq!(status, 200);

        // A backup through the API, recovered into a new file by `grafeno restore`.
        let mut headers = BTreeMap::new();
        headers.insert(
            "authorization".to_owned(),
            format!("Bearer {}", session.token),
        );
        let backup = send(
            &agent(),
            "GET",
            &format!("{}/v1/backup", session.url),
            &headers,
            Vec::new(),
        )
        .unwrap();
        assert_eq!(backup.status, 200);
        let bytes = match backup.body_base64 {
            Some(encoded) => {
                use base64::Engine as _;
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .unwrap()
            }
            None => backup.body.into_bytes(),
        };
        let backup_file = dir.join("backup.redb");
        std::fs::write(&backup_file, &bytes).unwrap();
        let restored = dir.join("restored.redb");
        assert!(restore(&engine, &backup_file, &restored).unwrap() > 0);
        assert!(
            restore(&engine, &backup_file, &restored)
                .unwrap_err()
                .contains("exists")
        );

        // The file is held: a second engine (another window) is refused.
        let refused = LocalEngine::start(&engine, &path)
            .err()
            .expect("the file is in use");
        assert!(refused.contains("open in another program"), "{refused}");

        // Closing stops the engine cleanly: the file opens again at once,
        // with what was written.
        session.stop();
        let again = LocalEngine::start(&engine, &path).unwrap();
        let (_, rows) = call(
            &again,
            "POST",
            "/v1/lab/query",
            r#"{"query":"MATCH (p:Person) RETURN p.name"}"#,
            true,
        );
        assert_eq!(rows["rows"], serde_json::json!([["Ana"]]));
        let restored_session = LocalEngine::start(&engine, &restored).unwrap();
        let (_, rows) = call(
            &restored_session,
            "POST",
            "/v1/lab/query",
            r#"{"query":"MATCH (p:Person) RETURN count(p)"}"#,
            true,
        );
        assert_eq!(rows["rows"], serde_json::json!([[1]]));
        drop(again);
        drop(restored_session);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_dropped_session_leaves_no_engine_running() {
        let engine = engine();
        let dir = temp_dir("drop");
        let session = LocalEngine::start(&engine, &dir.join("a.redb")).unwrap();
        let url = session.url.clone();
        // As when the window closes, or the app ends.
        drop(session);
        let reached = send(
            &agent(),
            "GET",
            &format!("{url}/health"),
            &BTreeMap::new(),
            Vec::new(),
        );
        assert!(
            reached.is_err(),
            "the engine still answers after its session ended"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_the_engine_cannot_open_is_refused_with_its_reason() {
        let engine = engine();
        let dir = temp_dir("bad");
        let path = dir.join("not-a-database.redb");
        std::fs::write(&path, b"this is not a redb file at all, not even close").unwrap();
        let error = LocalEngine::start(&engine, &path).err().expect("refused");
        assert!(
            error.contains("cannot open") || error.contains("stopped before"),
            "{error}"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_addresses() {
        assert_eq!(
            local_path("http://grafeno.local/session/a/v1/x"),
            Some("/session/a/v1/x")
        );
        assert_eq!(local_path("http://grafeno.local"), Some(""));
        assert_eq!(local_path("http://grafeno.localhost/x"), None);
        assert_eq!(local_path("http://127.0.0.1:7810/v1"), None);
        assert_eq!(
            session_path("/session/ab/v1/about").unwrap(),
            ("ab", "/v1/about".to_owned())
        );
        assert_eq!(session_path("/session/ab").unwrap(), ("ab", "/".to_owned()));
        assert!(session_path("/v1/about").is_err());
    }

    #[test]
    fn tokens_are_long_and_fresh() {
        let a = new_token().unwrap();
        assert_eq!(a.len(), 43);
        assert_ne!(a, new_token().unwrap());
    }

    #[test]
    fn grafeno_bin_comes_first_then_the_path_then_the_installers() {
        // (No env var is changed here: other tests run the engine meanwhile.)
        let list = candidates();
        if let Some(bin) = std::env::var_os("GRAFENO_BIN") {
            assert_eq!(list[0], PathBuf::from(bin));
        }
        let installed = if cfg!(windows) {
            "Grafeno"
        } else {
            "/usr/bin/grafeno"
        };
        assert!(
            list.iter()
                .any(|path| path.to_string_lossy().contains(installed))
        );
    }

    #[test]
    fn refusals_say_why() {
        let path = Path::new("/data/memory.redb");
        assert!(
            refusal(
                path,
                &["grafeno: Database already open. Cannot acquire lock.".into()]
            )
            .contains("open in another program")
        );
        assert!(refusal(path, &[]).contains("stopped before serving"));
        assert!(
            refusal(path, &["grafeno: invalid input: newer layout".into()])
                .ends_with("invalid input: newer layout")
        );
    }
}
