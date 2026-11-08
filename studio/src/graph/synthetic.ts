import type { EdgeInput, NodeInput } from "./engine.ts";

export type SyntheticShape = "random" | "scale-free" | "grid";

export interface SyntheticGraph {
  nodes: NodeInput[];
  edges: EdgeInput[];
}

/** Mulberry32: a small deterministic generator suitable for benchmark data. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

const COLORS = ["#3fd0a8", "#6fd6b5", "#22a888", "#8fe3c5", "#4fbf9f"];

function makeNodes(count: number): NodeInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    name: `Node ${index}`,
    color: COLORS[index % COLORS.length],
    size: 7 + (index % 4),
  }));
}

function edge(index: number, from: number, to: number): EdgeInput {
  return { id: `e${index}`, from: `n${from}`, to: `n${to}`, label: index % 7 === 0 ? "related" : "link" };
}

function randomEdges(nodeCount: number, edgeCount: number, random: () => number): EdgeInput[] {
  if (nodeCount === 0) return [];
  return Array.from({ length: edgeCount }, (_, index) => {
    const from = Math.floor(random() * nodeCount);
    let to = Math.floor(random() * nodeCount);
    if (nodeCount > 1 && to === from) to = (to + 1) % nodeCount;
    return edge(index, from, to);
  });
}

function scaleFreeEdges(nodeCount: number, edgeCount: number, random: () => number): EdgeInput[] {
  if (nodeCount === 0) return [];
  const edges: EdgeInput[] = [];
  // Repeating an endpoint in this pool makes sampling proportional to degree.
  const endpoints: number[] = [0];
  for (let node = 1; node < nodeCount && edges.length < edgeCount; node++) {
    const wanted = Math.min(3, node, edgeCount - edges.length);
    const targets = new Set<number>();
    while (targets.size < wanted) targets.add(endpoints[Math.floor(random() * endpoints.length)] ?? 0);
    for (const target of targets) {
      edges.push(edge(edges.length, node, target));
      endpoints.push(node, target);
    }
  }
  while (edges.length < edgeCount) {
    const from = endpoints[Math.floor(random() * endpoints.length)] ?? 0;
    let to = endpoints[Math.floor(random() * endpoints.length)] ?? 0;
    if (nodeCount > 1 && from === to) to = (to + 1) % nodeCount;
    edges.push(edge(edges.length, from, to));
    endpoints.push(from, to);
  }
  return edges;
}

function gridEdges(nodeCount: number, edgeCount: number, random: () => number): EdgeInput[] {
  if (nodeCount === 0) return [];
  const width = Math.ceil(Math.sqrt(nodeCount));
  const edges: EdgeInput[] = [];
  for (let node = 0; node < nodeCount && edges.length < edgeCount; node++) {
    const column = node % width;
    if (column + 1 < width && node + 1 < nodeCount) edges.push(edge(edges.length, node, node + 1));
    if (edges.length < edgeCount && node + width < nodeCount) edges.push(edge(edges.length, node, node + width));
  }
  if (edges.length < edgeCount) {
    const remaining = randomEdges(nodeCount, edgeCount - edges.length, random);
    edges.push(...remaining.map((item, index) => ({ ...item, id: `e${edges.length + index}` })));
  }
  return edges;
}

/** Builds repeatable graph data without involving an engine or network. */
export function syntheticGraph(nodeCount: number, edgeCount: number, shape: SyntheticShape = "scale-free", seed = 1): SyntheticGraph {
  const nodes = Math.max(0, Math.floor(nodeCount));
  const edges = Math.max(0, Math.floor(edgeCount));
  const random = randomFrom(seed);
  return {
    nodes: makeNodes(nodes),
    edges:
      shape === "random"
        ? randomEdges(nodes, edges, random)
        : shape === "grid"
          ? gridEdges(nodes, edges, random)
          : scaleFreeEdges(nodes, edges, random),
  };
}
