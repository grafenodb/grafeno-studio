import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAdjacency, usesWebGPU, WEBGPU_THRESHOLD } from "../src/graph/webgpu-layout.ts";

test("WebGPU is optional and reserved for 100,000-node layouts", () => {
  assert.equal(WEBGPU_THRESHOLD, 100_000);
  assert.equal(usesWebGPU(99_999, true), false);
  assert.equal(usesWebGPU(100_000, true), true);
  assert.equal(usesWebGPU(200_000, false), false);
});

test("GPU adjacency accepts arbitrary ids and ignores missing endpoints", () => {
  const graph = buildAdjacency(
    [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }],
    [{ from: "alpha", to: "beta" }, { from: "beta", to: "gamma" }, { from: "missing", to: "alpha" }],
  );
  assert.deepEqual([...graph.offsets], [0, 1, 3, 4]);
  assert.deepEqual([...graph.neighbors], [1, 0, 2, 1]);
});
