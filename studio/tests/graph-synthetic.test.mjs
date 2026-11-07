import assert from "node:assert/strict";
import { test } from "node:test";

import { syntheticGraph } from "../src/graph/synthetic.ts";

for (const shape of ["random", "scale-free", "grid"]) {
  test(`${shape} graphs have the requested size and valid endpoints`, () => {
    const graph = syntheticGraph(100, 300, shape, 42);
    assert.equal(graph.nodes.length, 100);
    assert.equal(graph.edges.length, 300);
    const ids = new Set(graph.nodes.map((node) => node.id));
    assert(graph.edges.every((item) => ids.has(item.from) && ids.has(item.to)));
  });

  test(`${shape} graphs are deterministic`, () => {
    assert.deepEqual(syntheticGraph(30, 70, shape, 7), syntheticGraph(30, 70, shape, 7));
    assert.notDeepEqual(syntheticGraph(30, 70, shape, 7), syntheticGraph(30, 70, shape, 8));
  });
}

test("empty graphs never create dangling edges", () => {
  assert.deepEqual(syntheticGraph(0, 20), { nodes: [], edges: [] });
});
