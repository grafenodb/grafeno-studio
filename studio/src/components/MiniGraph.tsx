import { useEffect, useMemo, useRef } from "react";

import { type Edge, displayName, go, labelColor } from "../api.ts";
import { useStudio } from "../context.ts";
import { type EdgeInput, GraphEngine, type NodeInput } from "../graph/engine.ts";
import { collectGraph, hasGraphValue, MAX_DRAWN } from "../graph/result-graph.ts";
import { enginePalette, useThemeVersion } from "../graph/theme.ts";

/** Whether the rows hold nodes, so they can be drawn. */
export function hasGraph(rows: unknown[][]): boolean {
  return hasGraphValue(rows);
}

const toEdge = (edge: Edge): EdgeInput => ({
  id: edge.id,
  from: edge.from,
  to: edge.to,
  label: edge.label,
  ended: edge.valid_to !== null && edge.valid_to <= Date.now() * 1000,
});

/** Draws the nodes found in query rows, with the facts between them, live. */
export function MiniGraph({ rows, onOpen }: { rows: unknown[][]; onOpen: (id: string) => void }) {
  const { client, namespace } = useStudio();
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GraphEngine | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  const theme = useThemeVersion();
  const collected = useMemo(() => collectGraph(rows), [rows]);

  useEffect(() => {
    if (!canvas.current) return;
    const created = new GraphEngine(
      canvas.current,
      { select: () => undefined, open: (id) => open.current(id), menu: () => undefined, connect: () => undefined },
      enginePalette(),
    );
    engine.current = created;
    return () => {
      created.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setPalette(enginePalette());
  }, [theme]);

  useEffect(() => {
    const nodes = collected.nodes;
    const edges = new Map(collected.edges);
    const drawn: NodeInput[] = [...nodes.values()].map((node) => ({
      id: node.id,
      name: displayName(node),
      color: labelColor(node.labels[0] ?? ""),
      size: 10,
    }));
    engine.current?.setData(drawn, [...edges.values()].map(toEdge));
    let alive = true;
    // The rows may hold nodes without the edges that join them: fetch those.
    if (nodes.size > 1) {
      client
        .namespace(namespace)
        .subgraph([...nodes.keys()], { depth: 0 })
        .then((sub) => {
          if (!alive) return;
          for (const edge of sub.edges) edges.set(edge.id, edge);
          engine.current?.setData(drawn, [...edges.values()].map(toEdge));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [collected, client, namespace]);

  const first = collected.nodes.keys().next().value as string | undefined;
  return (
    <div className="mini-graph-wrap">
      {collected.totalNodes > MAX_DRAWN && (
        <div className="mini-graph-limit">
          {MAX_DRAWN.toLocaleString()} of {collected.totalNodes.toLocaleString()} nodes drawn ·{" "}
          <button className="link-button" onClick={() => go("graph", first)}>Open them in the Graph view</button>
        </div>
      )}
      <canvas className="mini-graph" ref={canvas} title="Drag nodes to move them · double-click to open one" />
    </div>
  );
}
