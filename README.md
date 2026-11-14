# Grafeno Studio

The graphical interface for [Grafeno](https://github.com/grafenodb/grafeno),
the graph database engine. It is installed on its own, as pgAdmin is next to
PostgreSQL: the engine (`grafeno`) runs as a server without any interface,
and Grafeno Studio connects to it, on the same machine or another, through
the engine's public HTTP API, like any other client.

It browses, edits and draws the graph, runs GQ scripts, searches and builds
context, maintains memory, manages users, roles and privileges, and shows a
cluster's members and Raft groups. See [`studio/README.md`](studio/README.md).

## What is here

| Folder | What it is |
| --- | --- |
| `studio` | The interface: React and Vite. Its build (`studio/dist`) runs in a browser or inside the desktop app. |
| `desktop` | Grafeno Desktop, the Tauri application around the Studio. It has no engine inside: it opens database files by starting the engine installed on the machine, and talks to every engine over HTTP. See [`desktop/README.md`](desktop/README.md). |

## Running it against an engine

Install and start the engine (see the engine's installation guide), then:

```bash
npm ci --prefix studio
```

```bash
npm run dev --prefix studio
```

`npm run dev` serves the Studio with live reload and forwards `/v1` and
`/health` to the engine at `127.0.0.1:7810`, or at `GRAFENO_URL`.

```bash
npm run build --prefix studio
```

`studio/dist` can be hosted on any static web server; start the engine with
`--cors-origin <that origin>` so the browser may call it.

## Tests

```bash
npm test --prefix studio
```

```bash
cd desktop && GRAFENO_BIN=/path/to/grafeno cargo test
```

The desktop app's tests run against a real engine binary.

## Releases

Grafeno Studio and Grafeno Desktop are released together, apart from the
engine, by tags `v<version>` (`.github/workflows/release.yml`):
the desktop installers for Windows and Linux and the Studio's web build.
What each version changes, and which engines it works with, is in
[CHANGELOG.md](CHANGELOG.md). `.github/workflows/installers.yml` installs
the desktop app on clean machines, alone and beside the engine:
`desktop/packaging/test-install.sh` does it in Debian and Fedora
containers.

## History

The Studio and the desktop app were part of the engine's repository up to
its phase 14 (Grafeno 14.5, commit `87dc149`); their history is there. They
moved here when the engine and the interface became separate products.
