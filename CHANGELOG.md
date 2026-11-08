# Changes to Grafeno Studio and Grafeno Desktop

Grafeno Studio (the interface) and Grafeno Desktop (the Studio in native
windows) are one product with one version, released apart from the
Grafeno engine and tagged `v<version>`. A version's section here
is its release's notes; the release workflow refuses a tag whose version
has no section, or whose version differs from `desktop/Cargo.toml`,
`desktop/tauri.conf.json` and `studio/package.json`.

Each version says which engines it works with. It speaks to engines only
through their HTTP API, checks each one on connecting (`GET /v1/about`),
and hides what an engine lacks.

## 0.2.0 (2026-11-07)

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
  their members. Connecting checks the server's token first, then an
  administrator signs in (or the first one is made, on a server with no
  accounts).
- **Grafeno's mark**, as the Grafeno site has it, in the Studio and the
  desktop app's icons.
- **The Studio**: checks each engine (`connect()`), refuses one with no API
  version in common, hides the views an engine lacks, and backs up through
  `GET /v1/backup`.
- **Graph benchmark**: a deterministic 1k–100k+-node benchmark is available
  in hosted Studio and Desktop builds and records time to first frame, pan
  frame rate, main-thread long tasks and the active layout mode.
- **Large script results stay responsive**: result graphs draw at most the
  2,000 most connected nodes and say how many were omitted; tables over 300
  rows keep only their visible window in the DOM.
- **Layout off the main thread**: graph physics runs in a module Web Worker
  and streams transferable position buffers while drawing and input remain
  responsive; unsupported hosts retain an automatic main-thread fallback.
- **Large graphs use WebGL2**: above 3,000 nodes, instanced nodes and edges
  render on the GPU with color picking for interaction; small graphs retain
  their existing Canvas look, and Canvas remains the automatic fallback.
- **Readable detail at every zoom**: large graphs prioritize visible labels
  by degree, progressively reveal lower-priority edges, and reserve arrows
  and edge labels for close views while keeping focused items visible.
- **Optional WebGPU layout for 100k+ nodes**: capable browsers and Desktop
  hosts run an approximate linear-cost compute layout; missing secure-context
  support, adapters, shader failures and device loss fall back automatically
  to the worker's d3-force layout.
- **Web and Desktop graph parity**: both releases use the same worker,
  WebGL2 renderer, zoom-aware detail, GPU picking and optional WebGPU paths
  from the shared Studio build.
- **Local script library**: scripts are isolated by server account and kept
  only on the user's computer, in IndexedDB on the web and bundled SQLite on
  Desktop. Existing `localStorage` scripts migrate automatically.
- **Portable scripts**: complete local libraries can be imported and
  exported as versioned JSON without credentials; individual `.gq` files
  remain supported and the toolbar reports local save state.
- **Responsive workspace**: compact and narrow layouts center page content,
  scroll dense toolbars safely, expose the script schema as a drawer, adapt
  forms and dialogs, and move graph inspection into a bottom sheet.
- **Graphene data workspace**: an icon-led toolbar exposes every Studio
  module across the top while a contextual namespace tree anchors the side,
  giving dense graph data the structure of a desktop administration client;
  Canvas and WebGL nodes retain the mark's green palette and geometry.
- **Restorable workspace documents**: tools open as closable namespace-aware
  tabs while node selections update the existing Explorer document; tabs
  restore locally per connection and keep inactive graph renderers unmounted.
  Ctrl+PageUp/PageDown cycles tabs and Ctrl+W closes the active one.
- **Data tools**: query results add a collapsible JSON tree, complete JSON
  copy and per-cell copy actions; the web connection screen now shares the
  saved-server list used by Desktop, including select and forget actions.
- **Graph workspace**: grouped discovery and analysis controls, loaded-graph
  label and fact filters, temporal filtering, and clearer contextual
  inspectors refine Graph Explorer without increasing its bounded loading.
- **One Overview document**: switching namespaces updates the global Overview
  tab instead of accumulating one Overview tab for every namespace.
- **Workspace validation**: the shared production bundle passes the complete
  Studio and Desktop test suites and the responsive shell matrix from
  1920×1080 through 1024×768 before native installer packaging.
- **Packaging validation**: Windows NSIS/MSI and Linux DEB/RPM packages build
  from the shared Studio bundle; package inspection confirms Desktop does not
  carry the Grafeno engine. AppImage and signing remain release-CI outputs.
- **Installers**: Windows (`.exe`, `.msi`, for the current user), Linux
  (`.deb`, `.rpm`, `.AppImage`); none carries an engine or installs a
  service. The Studio's web build as a `.zip`, for a web server.
