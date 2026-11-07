import type { Edge, Node } from "../api.ts";

export const MAX_DRAWN = 2_000;

export interface CollectedGraph {
  /** The selected node objects, ordered by descending result degree. */
  nodes: Map<string, Node>;
  /** Result edges whose two endpoints are selected. */
  edges: Map<string, Edge>;
  /** Unique nodes found anywhere in the nested result. */
  totalNodes: number;
}

function isNode(value: object): value is Node {
  return "id" in value && typeof value.id === "string" && "labels" in value && Array.isArray(value.labels) && "created_at" in value;
}

function isEdge(value: object): value is Edge {
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "from" in value &&
    typeof value.from === "string" &&
    "to" in value &&
    typeof value.to === "string" &&
    "recorded_at" in value
  );
}

function walk(value: unknown, visit: (item: object) => void): void {
  const stack = [value];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (isNode(item) || isEdge(item)) {
      visit(item);
      continue;
    }
    const nested = Array.isArray(item) ? item : Object.values(item);
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]);
  }
}

/** Finds a node without walking the remainder of a large result. */
export function hasGraphValue(value: unknown): boolean {
  let found = false;
  walk(value, (item) => {
    if (isNode(item)) found = true;
  });
  return found;
}

/**
 * Collects a nested result iteratively and retains only the most connected
 * nodes. The first pass counts every unique node and edge without retaining
 * every node object; the second retains only the selected objects.
 */
export function collectGraph(value: unknown, maximum = MAX_DRAWN): CollectedGraph {
  const ids = new Map<string, number>();
  const allEdges = new Map<string, Edge>();
  walk(value, (item) => {
    if (isNode(item)) {
      if (!ids.has(item.id)) ids.set(item.id, ids.size);
    } else if (isEdge(item)) {
      allEdges.set(item.id, item);
    }
  });

  const degree = new Map<string, number>();
  for (const item of allEdges.values()) {
    degree.set(item.from, (degree.get(item.from) ?? 0) + 1);
    degree.set(item.to, (degree.get(item.to) ?? 0) + 1);
  }
  const selected = new Set(
    [...ids]
      .sort(([a, orderA], [b, orderB]) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || orderA - orderB)
      .slice(0, Math.max(0, maximum))
      .map(([id]) => id),
  );
  const nodes = new Map<string, Node>();
  walk(value, (item) => {
    if (isNode(item) && selected.has(item.id)) nodes.set(item.id, item);
  });
  // Restore the importance order even if duplicate values appeared later.
  const ordered = new Map([...selected].map((id) => [id, nodes.get(id)]).filter((entry): entry is [string, Node] => entry[1] !== undefined));
  const edges = new Map([...allEdges].filter(([, item]) => selected.has(item.from) && selected.has(item.to)));
  return { nodes: ordered, edges, totalNodes: ids.size };
}
