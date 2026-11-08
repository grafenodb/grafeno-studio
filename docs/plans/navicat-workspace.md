# Grafeno Studio — Graph Database Workspace

## Audit

### Architecture

- `studio/` is a React 19 and TypeScript application built with Vite. It is
  the only renderer used by the hosted web application and Tauri Desktop.
- `desktop/` is a Tauri 2 host. It opens local database files through an
  installed Grafeno engine and stores local scripts in bundled SQLite.
- `client/` is the typed HTTP client. Studio talks to Grafeno only through
  this client and its `/v1` contracts.
- Application state is local React state and URL hash routing. There is no
  external state management dependency.
- Styling is a token-based global stylesheet with light, dark and system
  themes. Space Grotesk and JetBrains Mono are bundled for offline use.

### Existing product capabilities

- Connections support tokens, accounts, remembered servers, local database
  files and clusters. Capabilities from `GET /v1/about` gate unavailable
  views.
- GQ scripts use CodeMirror 6 with syntax highlighting, completion, keyboard
  execution and a local script library. The engine executes real GQ through
  `POST /v1/{namespace}/query`.
- Script results already provide messages, virtualized tables, JSON, graph,
  chart and profile views without rerunning a query when switching modes.
- Explorer lists and filters nodes, performs bulk archive/delete, and edits
  node properties, text, labels, importance and facts through the existing
  API.
- Graph Explorer supports zoom, pan, selection, expansion, communities,
  hiding, pinning, search, keyboard navigation and an actual node inspector.
  Layout runs in a worker, WebGL2 takes over for large graphs, and WebGPU is
  an optional layout path for very large graphs.
- Administration, memory, cluster and access views are capability-gated and
  operate on real endpoints.

### Reusable components

- `CodeEditor`, `ResultTable`, `MiniGraph`, `NodeDetail`, forms, modal,
  command palette, task state and empty states already cover most base UI.
- The graph engine and its renderers are shared by Graph Explorer, script
  results and the benchmark.
- Script panes already include working horizontal resizing, persistent local
  scripts and closable document tabs.

### Problems found

- The global shell exposes modules, but its namespace explorer is flat and
  does not reveal real node, fact and query entry points.
- The explorer width is fixed and the application has no global status bar.
- Overview still carries remnants of dashboard composition instead of a
  database object list with a compact inspector.
- Workspace tabs exist only inside Scripts. A global document model would
  require preserving mounted view state and request lifecycles.
- Several views own their own split layout, so a single generic inspector or
  splitter cannot replace them safely without view-by-view migration.

### Regression risks

- Mounting several workspace views simultaneously would trigger duplicate
  requests and retain graph workers and WebGL contexts.
- Replacing the existing editor or graph engine would lose tested behavior
  and create a performance regression.
- Tree categories must map to real views and endpoints. Indexes, constraints
  and properties cannot be shown globally until the engine exposes them.
- Desktop and web must keep using the same Studio build and capability gates.

## Implementation plan

### Phase 1 — Workspace foundation

- Keep the existing routes and real actions.
- Turn the sidebar into a hierarchical namespace explorer.
- Add a keyboard-accessible, persisted sidebar splitter.
- Add a global connection and namespace status bar.
- Finish the compact light-first visual system and retain the dark theme.

### Phase 2 — Workspace documents

- **Implemented:** define a document model for every routed workspace tool,
  scoped by namespace; route selections update their tool document instead
  of creating an unbounded tab for every node.
- **Implemented:** keep only the active routed view mounted, so inactive graph
  documents do not retain workers, WebGL contexts or pending requests.
- **Implemented:** close, cycle and restore documents from connection-scoped
  local client storage. Scripts continue to auto-save through their existing
  library, so they do not expose a misleading dirty marker.

### Phase 3 — Data tools

- **Implemented:** retain the existing CodeMirror editor, local script tabs,
  result splitter and Table/Graph/Chart/Profile modes without changing query
  execution.
- **Implemented:** replace flat JSON text with a collapsible structured tree,
  full JSON copy and per-cell value copy in result tables.
- **Implemented:** expose the shared saved-server list in the web connection
  screen, with select and forget actions matching Desktop's existing flow.
- **Fixed:** reuse tool tabs as selections change and constrain Graph Explorer
  to the content grid so it cannot cover the document strip.

### Phase 4 — Graph workspace

- **Implemented:** reorganize Graph Explorer into grouped discovery, creation,
  analysis and filter controls around the existing renderer.
- **Implemented:** add loaded-graph filters for node labels and fact types,
  retain the existing temporal reload filter, and provide a single reset.
- **Implemented:** give node, fact and multi-selection inspectors a persistent
  contextual heading without covering the canvas controls.
- **Preserved:** Show all remains capped at 60 roots, expansion stays batched,
  and inactive graph documents still destroy their worker and GPU resources.
- **Fixed:** Overview is one global document that follows the selected
  namespace instead of opening one tab per namespace.

### Phase 5 — Validation

- **Validated:** the Studio production build and all 58 Studio tests pass;
  Rust formatting and all 12 Desktop tests pass as well.
- **Exercised:** the real shell, themes, namespace tree, splitters, scripts,
  Explorer and Graph at 1920×1080, 1440×900, 1366×768 and 1024×768.
- **Confirmed:** Web and Tauri consume the same production Studio bundle;
  native installer creation remains the following release step.
- See [`../qa/workspace-validation.md`](../qa/workspace-validation.md) for the
  validation matrix, environment boundary and packaging handoff.

