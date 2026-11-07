# Grafeno Desktop

[Español](README.es.md) | **English**

Grafeno Studio in native windows, built with [Tauri](https://tauri.app).
It has **no engine inside**: it speaks to Grafeno engines only through
their HTTP API, as any client does, and is installed apart from the engine
(as pgAdmin is from PostgreSQL). Each window has its own connection:

- **A database file on this computer** (`.redb`): the app starts the
  Grafeno engine installed on the machine for that window, as
  `grafeno serve --db FILE --addr 127.0.0.1:0 --token <one for the session>
  --stop-with-stdin`, on a loopback port, and talks to it over HTTP. The
  Studio never sees the port or the token. Closing the file, opening
  another, closing the window, or the app ending (even by a crash) closes
  the engine's standard input, and the engine stops cleanly. With no
  engine installed, the start screen says so and links to its installers.
- **A Grafeno server**: the service installed on this computer (found on
  its default address, `127.0.0.1:7810`), one on another machine, or a
  cluster given by its members (`http://a:7810, http://b:7810`). Servers
  are kept in a list on the start screen, with a token or key, or signed
  into after connecting.

Several windows can be open at once (File → New window, Ctrl+Shift+N),
each with its own file or server. On connecting, the Studio checks the
engine (`GET /v1/about`): an engine with no API version in common is
refused, and the views an engine lacks are hidden.

The start screen lists recent databases and saved servers. The File menu
creates, opens and closes databases, connects to a server, and imports and
exports; the View menu switches views (Ctrl+1 to Ctrl+7) and themes; menus
act on the focused window. Launching the app with a database path
(`grafeno-desktop notes.redb`) opens it; launching it again while it runs
opens the new path in the focused window.

## Engines it works with

Grafeno Desktop 0.2.0 works with Grafeno engines of HTTP API version 1,
from engine 0.1.0; it checks each engine on connecting (`GET /v1/about`)
and hides what an engine lacks. Opening database files needs an installed
engine 0.1.0 or later (`grafeno serve --stop-with-stdin`, `grafeno
restore`). Each version's engines are listed in [CHANGELOG.md](../CHANGELOG.md).

## Finding the engine

In order: `GRAFENO_BIN`; `grafeno` on the `PATH`; where the engine's
installers put it (`C:\Program Files\Grafeno\grafeno.exe` on Windows;
`/usr/bin/grafeno`, `/usr/local/bin/grafeno`, `~/.local/bin/grafeno` on
Linux). The first that answers `grafeno --version` is used; the start
screen shows which. Any engine from 0.1.0 with `--stop-with-stdin` and
`grafeno restore` (engine phase 15.4) works.

## Building

The window shows the Studio's build, so build it first:

```bash
cd studio && npm ci && npm run build
```

```bash
cd desktop && cargo run
```

```bash
cd desktop && npx tauri build
```

The last one builds the installers (`.exe` and `.msi` on Windows; `.deb`,
`.rpm`, `.AppImage` on Linux); none carries an engine. On Windows the
window uses WebView2, part of Windows 10 and 11. On Linux, Tauri needs
WebKitGTK and its development files, for example on Debian or Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
```

## How it works

- `src/engine.rs`: finding the installed engine, starting it for a file
  (waiting for its `listening on` line, refusing a file another program
  holds with a clear message), stopping it, and `grafeno restore` for
  recovering backups.
- `src/bridge.rs`: the HTTP transport. Every request of the Studio goes
  through the `request` command: `http://grafeno.local/session/<id>/…` to
  the engine serving that window's file (with the session's token), any
  other address to that server; so no server needs to allow the app as a
  browser origin. UTF-8 text travels in `body`; other bytes (a backup) in
  `bodyBase64`, never both.
- `src/main.rs`: the windows, the menu and the commands the Studio calls
  (`session`, `engine_info`, `open_database`, `close_database`,
  `open_window`, `recent`, `forget_recent`, `pick_database`, `pick_save`,
  `pick_open`, `read_text`, `write_text`, `write_bytes`, `open_external`,
  `restore_database`, `request`).
- Backups go through the API (`GET /v1/backup`), for a file and a server
  alike; the app only writes the file the user picked, never over an
  existing one. Recovering a backup runs `grafeno restore` into a new
  file, then opens it.
- Recent databases are kept in `recent.json` in the app's configuration
  folder (`%APPDATA%\dev.grafeno.desktop` on Windows,
  `~/.config/dev.grafeno.desktop` on Linux); saved servers in the window's
  local storage.

## Tests

```bash
GRAFENO_BIN=/path/to/grafeno cargo test
```

They run against the real engine binary: a file served by the engine on a
loopback port, the token required, a backup through the API recovered by
`grafeno restore`, a file held by another engine refused, closing stopping
the engine cleanly (the file reopens with its data), no engine left
running after a session ends, and a file the engine cannot open refused
with its reason; plus the transport (binary bodies, error statuses, an
unreachable engine). The Studio's own tests: `npm test --prefix studio`.

`tests/ui_smoke.py` drives the real window with WebKitWebDriver on a
virtual display (Linux), following the
[Tauri guide](https://v2.tauri.app/develop/tests/webdriver/ci/); it needs
the engine too (`GRAFENO_BIN`):

```bash
sudo apt-get install -y webkit2gtk-driver xvfb xauth dbus-x11
cargo install tauri-driver --locked
cargo build --locked
GRAFENO_BIN=/usr/bin/grafeno dbus-run-session -- xvfb-run -a -s "-screen 0 1600x1000x24" python3 tests/ui_smoke.py
```

## Tauri or Electron

Measured on one laptop (Windows 11, WebView2), with the same Studio build
(0.9 MB), recorded in the engine's `DESIGN.md` (phase 15.4): the Tauri
installer is 3.1 MB (NSIS) or 4.4 MB (MSI), where Electron's runtime alone
is 110 MB compressed; memory is about the same (WebView2 is Chromium too:
about 375 MB of working set for Tauri's window and its WebView2 processes,
330 MB for Electron's). Tauri is kept.
