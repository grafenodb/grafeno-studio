# Changes to Grafeno Studio and Grafeno Desktop

Grafeno Studio (the interface) and Grafeno Desktop (the Studio in native
windows) are one product with one version, released apart from the
Grafeno engine and tagged `desktop-v<version>`. A version's section here
is its release's notes; the release workflow refuses a tag whose version
has no section, or whose version differs from `desktop/Cargo.toml`,
`desktop/tauri.conf.json` and `studio/package.json`.

Each version says which engines it works with. It speaks to engines only
through their HTTP API, checks each one on connecting (`GET /v1/about`),
and hides what an engine lacks.

## 0.2.0 (not released yet)

The first release on its own: the interface and the desktop app left the
engine's repository (engine phase 15).

- **Works with**: Grafeno engines of HTTP API version 1, from engine 0.1.0
  (older development builds without `GET /v1/about` are recognized from
  `/health`). Opening database files needs an installed engine with
  `grafeno serve --stop-with-stdin` and `grafeno restore` (engine 0.1.0).
- **Grafeno Desktop has no engine inside**: a database file opens with the
  engine installed on the computer, started for that window on a loopback
  port with a token of its own, and stopped cleanly with the file, the
  window or the app; without an engine, the start screen links to its
  installers.
- **Connections**: several windows, each with its own connection; saved
  servers; the local service found on its default address; clusters by
  their members.
- **The Studio**: checks each engine (`connect()`), refuses one with no API
  version in common, hides the views an engine lacks, and backs up through
  `GET /v1/backup`.
- **Installers**: Windows (`.exe`, `.msi`, for the current user), Linux
  (`.deb`, `.rpm`, `.AppImage`); none carries an engine or installs a
  service. The Studio's web build as a `.zip`, for a web server.
