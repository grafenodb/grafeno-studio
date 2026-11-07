# Plan: drawing large graphs without freezing the Studio

Status: proposed (2026-11-07). Repository: Grafeno Studio
(`grafenodb/grafeno-studio`, local folder `D:\Codes\Personal\gfStudio`).
Meant for a session working on the Studio while another works on the
engine (`grafenodb/grafeno`): **this work touches no engine code**; where
the engine could help, it is listed at the end, to agree on separately.

## The problem

A GQ script whose result holds about 10,000 nodes and many edges freezes
the page when its result is shown as a graph, in the browser and in
Grafeno Desktop alike (Tauri shows the Studio in WebView2, which is
Chromium, on Windows, and in WebKitGTK on Linux: same JavaScript, same
single main thread). The shell does not change it; in the desktop app a
large result is even copied once more, through the native bridge.

Where the time goes, from the code:

- `studio/src/components/MiniGraph.tsx` draws the graph of a script's
  result. It has **no limit**: every node and edge found in the rows goes to
  the graph engine. (`collect()` walks every row recursively first.)
- `studio/src/graph/engine.ts` (`GraphEngine`, about 1,070 lines) lays the
  graph out with a d3-force simulation (many-body repulsion with
  `distanceMax(700)`, collision with 2 iterations, `alphaDecay(0.028)`) and
  draws it with **Canvas 2D**, both **on the main thread**, every
  animation frame (`requestAnimationFrame`). At 10k nodes a tick and a
  repaint of every edge, label and node take tens of milliseconds or more:
  the page stops answering.
- The Graph view (`studio/src/views/GraphView.tsx`) caps an expansion at 150
  new nodes (`studio/src/graph/expansion.ts`, `MAX_NEW`); the script graph
  does not.
- Parsing a huge JSON result and rendering a large table also cost, before
  any drawing.

## Goals and how to measure them

| Graph (nodes / edges) | Now | Goal |
| --- | --- | --- |
| 1,000 / 3,000 | fluid | fluid, unchanged look |
| 10,000 / 30,000 | the page freezes | no task over 50 ms on the main thread; interactive (pan, zoom, select) while the layout settles |
| 50,000 / 150,000 | freezes | interactive with the WebGL renderer |
| 100,000+ | freezes | optional: GPU layout (WebGPU where present) |

"Interactive": panning and zooming at 30 frames a second or more on the
E1 laptop (Ryzen 7 7435HS, Windows 11, WebView2), and no long task over
50 ms (`PerformanceObserver` with `longtask`) after the first frame.

## Phases

Each phase ships on its own (commit, push, CHANGELOG line), in this order.
The first two remove the freeze everywhere; the third raises the ceiling.

### Phase 0: a benchmark to measure against

- A synthetic graph generator (`studio/src/graph/synthetic.ts`): N nodes,
  M edges, a few labels, deterministic from a seed; shapes: random, a
  scale-free graph (preferential attachment), a grid.
- A benchmark page reachable in the dev server (`/#/bench?nodes=10000`)
  that feeds the generator to `GraphEngine` and reports time to first
  frame, frames per second while panning, and long tasks
  (`PerformanceObserver`), on screen and in `console.table`.
- Record the baseline (now) for 1k, 10k and 50k nodes in this file's
  "Measurements" section, on the browser and in the desktop app (debug
  build is fine for relative numbers; say which).

Done when: the numbers of the table above can be measured repeatably.

### Phase 1: limits where results become graphs

- `MiniGraph`: draw at most `MAX_DRAWN = 2,000` nodes (a constant, tested),
  the edges among the drawn ones, and say so above the canvas: "2,000 of
  10,412 nodes drawn · Open them in the Graph view" (which expands step by
  step). Pick the drawn nodes by importance: the ones most connected in the
  result first.
- `collect()`: iterative, with an early stop once it has enough nodes to
  know the result is larger than `MAX_DRAWN` (it still counts them).
- The result table: virtualized (only visible rows in the DOM) when a
  result has more than a few hundred rows, if it is not already.
- Tests (`studio/tests/*.test.mjs`): the cap, the choice by degree, the
  count shown, and `collect()` on nested values.

Done when: the 10k script result shows at once, the page never freezes,
and the same script in the desktop app does the same.

### Phase 2: the layout in a Web Worker

- Move the d3-force simulation into a worker (`studio/src/graph/layout.worker.ts`;
  Vite bundles workers with `new Worker(new URL(...), { type: "module" })`).
  The main thread keeps only drawing and input.
- Messages: `setData` (nodes, edges, pinned), `drag` (id, x, y), `pin`,
  `reheat`, `stop`; the worker answers with positions in a transferable
  `Float32Array` (x, y per node, by index), at most once per frame.
- `GraphEngine` keeps its public methods (`setData`, `select`, `pin`,
  `fit`, `focus`, …) so `GraphView` and `MiniGraph` do not change.
- Fallback: without workers (tests, odd hosts), run the simulation on the
  main thread as now.
- Check it works in the desktop app: Tauri serves the Studio from its own
  origin; module workers must load from it (test in WebView2).

Done when: with 10k nodes the page answers during the whole layout (no long
task over 50 ms), in the browser and the desktop app.

### Phase 3: a WebGL2 renderer for large graphs

- Draw nodes and edges with WebGL2 (instanced quads for nodes, lines for
  edges) when a graph has more than about 3,000 nodes; keep Canvas 2D below
  that (it looks the same as today and stays simple).
- Choose between writing a small renderer (no dependency, full control of
  the look) and a library: sigma.js 3 (WebGL, labels, events), or
  cosmos.gl (also lays out on the GPU, through WebGL). Decide with the
  phase 0 benchmark and the bundle size; record the choice and the numbers
  here.
- Labels and the hover card stay in a Canvas 2D (or DOM) layer above the
  WebGL one, drawn only for the nodes that matter (phase 4).
- Picking (which node is under the pointer): a spatial index (quadtree)
  over the positions, built in the worker, or GPU picking; selection,
  dragging, the context menu and double-click to open must work as now.
- Theme: the palette from `studio/src/graph/theme.ts`, light and dark.
- WebGL2 is present in WebView2 and in WebKitGTK; check both.

Done when: 50k nodes / 150k edges pan and zoom at 30 frames a second or
more on the E1 laptop, with selection and opening working.

### Phase 4: level of detail

- Labels: only for the nodes on screen that are large enough at the
  current zoom, the most connected first, at most a few hundred at once.
- Edges: hide the thinnest when zoomed far out; draw arrows and edge
  labels only when zoomed in.
- Optional: draw communities (if the result carries them) as one node
  each when zoomed out.

Done when: zooming out on 50k nodes keeps the frame rate of phase 3 and the
picture readable.

### Phase 5 (optional): WebGPU for the layout

- Where `navigator.gpu` exists (WebView2 on Windows; Chrome and Edge),
  run the force layout as compute shaders, for 100k+ nodes; elsewhere
  (WebKitGTK on Linux today, older GPUs, virtual machines) fall back to
  phase 2's worker. Never require it.
- Draw from the same GPU buffers when the renderer allows it.

Done when: 100k nodes lay out interactively where WebGPU exists, and the
fallback is used, with no error, where it does not.

## What not to change

- No engine code (`grafenodb/grafeno`): the HTTP API is the contract. If a
  phase seems to need the engine, write it under "Ideas for the engine"
  and stop there.
- The client copy in `client/` follows the engine's `clients/typescript`;
  do not edit it here.
- The look of small graphs (under 3,000 nodes) stays as it is.

## Ideas for the engine (to agree on, not to build here)

- A way to ask for a sample or a summary of a large result (the top nodes
  by degree, or one node per community with counts), so the Studio
  receives hundreds of nodes instead of tens of thousands.
- Server-side layout for very large graphs is not proposed: the engine
  stays without a graphical side.

## Working rules

- Code, comments, docs and commits in English; commits end with the
  project's `Co-Authored-By` line; push to `main` of
  `grafenodb/grafeno-studio`.
- Tests: `npm test --prefix studio`; types and build: `npm run build
  --prefix studio`; the desktop app's tests: `cd desktop && GRAFENO_BIN=...
  cargo test` (they do not cover the graph).
- Update `studio/README.md` (how large graphs are drawn and their limits)
  and `CHANGELOG.md` (the next version's section) with each phase, and
  this file's "Measurements".
- Smart App Control on the E1 laptop may refuse release builds of the
  desktop app (os error 4551): use the debug build for checks there.

## Measurements

(Filled by phase 0 and each later phase: graph size, environment, time to
first frame, frames per second while panning, longest main-thread task.)
