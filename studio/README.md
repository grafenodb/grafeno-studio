# Grafeno Studio

The graphical interface of Grafeno. It connects to a Grafeno engine
through its HTTP API (the engine itself has no interface). Everything can be
done from it, without a terminal:

- **Overview**: namespaces (empty ones too, with their creation date),
  counts per label, quick actions. The namespace menu at the top switches
  between namespaces or creates a new one, and says which it did; creating
  a name that exists offers to switch to it instead.
- **Explorer**: filter by label, name or text; create nodes; edit names,
  labels, properties (typed: text, number, yes/no, JSON), text and
  importance in place; add, end, retract or delete facts; select several
  nodes to archive or delete them.
- **Graph**: a live, physics-driven graph you handle directly. Drag nodes
  and the rest reacts (dragged nodes stay pinned); hover or select one to
  light its neighborhood; shift-click or shift-drag a lasso to select
  several and move, pin, hide or delete them together; drag the `+` of a
  selected node onto another to connect them; double-click to expand
  neighbors; right-click for every action on nodes, facts or the canvas.
  Zoom at the cursor, pan with momentum, a minimap, find a node to fly to
  it, travel in time with “valid at”. Color by community (Louvain, label
  propagation, connected components), collapse a community into one node,
  and size nodes by centrality (PageRank, degree, betweenness), computed
  over the whole namespace. Keys: Delete, Esc, F, H, P, + and -.
- **Scripts**: a GQ workspace like a SQL editor. Several scripts in tabs
  (kept in the browser, opened from and saved to `.gq` files), highlighting
  and completion (keywords, functions, the namespace's labels,
  pseudo-properties), a schema panel with snippets, Ctrl+Enter to run the
  statement under the cursor or the selection, F5 to run the whole script
  (ordinary statements run independently; `BEGIN`/`COMMIT` blocks share an
  explicit transaction, stopping at the first error, whose
  line is marked). Results per statement as a table, JSON, graph, bar or
  line chart, the `PROFILE` steps, or a recorded `TRACE` walk with playback,
  with CSV and JSON export and a messages log with times and changes.
  Tables with more than 300 rows render only their visible rows. A script
  graph draws at most 2,000 result nodes, chosen by degree, and reports the
  full count; larger graphs can be explored incrementally in Graph.
- **Search**: node text and named full-text indexes with matching fragments,
  vector and hybrid search through named indexes, recall with its signals,
  context within a token
  budget.
- **Memory**: duplicates to merge, weak memories to archive, groups to
  consolidate.
- **Palaces** (engines with the `tools` capability): an agent's palaces,
  read through the memory tools and writing nothing: rooms and doors, a room
  entered with its checkpoint, its loci, a reflection, walks, routes along
  relations, and review proposals.
- **Administration**: who the Studio is connected as and, for owners, the
  access keys (create with grants per namespace, own-records-only and
  owner options; the secret is shown once; revoke); indexes, check,
  rebuild, export and import (JSON Lines, and GraphML or CSV for other
  graph tools), a backup of the whole database file (owners),
  and deleting the namespace with everything in it (after a
  confirmation).

Ctrl+K opens a command palette (views, actions, namespaces and nodes).

The look is "graph lab": dark first (light, or the system's choice, from
the switch at the bottom of the rail), a floating rail and command bar in
glass over the canvas, Space Grotesk for the interface and JetBrains Mono
for data and code. Both typefaces are bundled (SIL Open Font License), so
the Studio needs no network beyond its server.

## Development

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev` serves it with live reload and forwards `/v1` and `/health`
to a `grafeno serve` on `127.0.0.1:7810` (start one first, for example
`grafeno serve --memory`), or to the server in `GRAFENO_URL`.

The graph benchmark needs no engine and is available in development, hosted
web and Desktop builds. Open
`/#/bench?nodes=10000` and optionally set `edges`, `shape` (`random`,
`scale-free` or `grid`), `seed`, and `auto=1` to run the pan sample. It
reports time to first frame, pan
frame rate, main-thread long tasks and the active layout mode on screen and
in `console.table`.

Graph layout runs d3-force in a module Web Worker, while the main thread
draws and handles input. Positions arrive at most once per frame in a
transferable `Float32Array`. Hosts without module workers automatically use
the same simulation on the main thread.

Graphs through 3,000 nodes keep the original Canvas 2D renderer. Larger
graphs use the bundled WebGL2 renderer: instanced node and edge quads read a
shared position texture, while labels, selection detail and drag overlays
remain on the 2D canvas above it. A GPU color-picking pass preserves node and
edge interaction. If WebGL2 is unavailable or its context is lost, the graph
falls back to Canvas automatically. The same hidden `#/bench` diagnostic is
available in hosted Studio and Desktop builds.

The WebGL view changes detail with zoom. Far out, it keeps a deterministic
sample of the edges with the best-connected endpoints; approaching restores
the rest, and arrows and edge labels appear from 0.85×. Node labels are
ranked by degree, restricted to visible nodes large enough on screen, and
capped between 120 and 250. Focused, selected and collapsed nodes are placed
ahead of general candidates.

At 100,000 nodes and above, the layout worker opportunistically uses WebGPU
compute. It evaluates adjacency springs plus a deterministic sample of
repulsive pairs in linear work per iteration, using ping-pong position and
velocity buffers. Positions still return through the renderer's existing
interface. If WebGPU, an adapter, shader creation or the device is unavailable
or lost, the worker automatically starts the d3-force fallback from the latest
positions. This keeps WebKitGTK and older or virtualized GPUs supported.

```bash
npm run build
```

`npm run build` writes `dist/`. The build uses relative paths and hash
routing, so `dist/` can be hosted on any static server, including below a
path prefix. Serve the generated assets with their normal JavaScript MIME
types so the bundled module layout worker can load. Point the Studio at a
Grafeno engine started with `--cors-origin <that origin>`.

WebGPU is available to the hosted Studio only in a secure context (normally
HTTPS or localhost) and on a compatible browser and GPU. The worker falls
back to d3-force automatically when any of those requirements is missing;
WebGL2 and Canvas have the same fallback behavior described above.

It calls the API through the TypeScript client in `../client`.

This exact `dist/` is also the desktop app's window (`../desktop`). There,
`src/desktop.ts` sends requests through the app, the start screen opens
database files or connects to a server, files are saved with dialogs and
the native menu drives the views.

## Local script library

Scripts belong to the current server account and stay on the computer; they
are never written to the Grafeno engine. Hosted Studio stores them in
IndexedDB and requests persistent browser storage when available. Grafeno
Desktop stores them in an embedded SQLite database under the app's private
configuration directory. Neither deployment needs a separate database
installation.

Existing scripts from the former `localStorage` library migrate on first
use. **Import library** merges a portable Grafeno script-library JSON file,
while **Export library** downloads every local script without credentials or
the local owner key. Individual `.gq` files can still be opened and saved.

The responsive shell supports wide desktop windows, compact windows and
narrow browser screens. On narrow screens, navigation and toolbars scroll
horizontally, the script schema opens as a drawer, and graph inspection moves
to a bottom sheet.
