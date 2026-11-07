import assert from "node:assert/strict";
import { test } from "node:test";

import { decodePickId, graphLevelOfDetail, rankEdgeImportance, usesWebGL, WEBGL_THRESHOLD } from "../src/graph/webgl-renderer.ts";

test("WebGL starts only above the 3,000-node Canvas range", () => {
  assert.equal(WEBGL_THRESHOLD, 3_000);
  assert.equal(usesWebGL(3_000), false);
  assert.equal(usesWebGL(3_001), true);
  assert.equal(usesWebGL(50_000, false), false);
});

test("picking ids resolve edges before nodes", () => {
  assert.equal(decodePickId(0, 3, 2), null);
  assert.deepEqual(decodePickId(1, 3, 2), { kind: "edge", index: 0 });
  assert.deepEqual(decodePickId(3, 3, 2), { kind: "edge", index: 2 });
  assert.deepEqual(decodePickId(4, 3, 2), { kind: "node", index: 0 });
  assert.deepEqual(decodePickId(5, 3, 2), { kind: "node", index: 1 });
  assert.equal(decodePickId(6, 3, 2), null);
});

test("zoom progressively restores edges, labels and arrows", () => {
  assert.equal(graphLevelOfDetail(0.1).edgeMinimum, 0.9);
  assert.equal(graphLevelOfDetail(0.25).edgeMinimum, 0.75);
  assert.equal(graphLevelOfDetail(0.4).edgeMinimum, 0.45);
  assert.equal(graphLevelOfDetail(0.7).edgeMinimum, 0);
  assert.equal(graphLevelOfDetail(0.84).arrows, false);
  assert.equal(graphLevelOfDetail(0.85).arrows, true);
  assert.equal(graphLevelOfDetail(0.85).edgeLabels, true);
});

test("edge importance favors high-degree scores and samples ties", () => {
  const ranked = rankEdgeImportance([2, 10, 4, 4]);
  assert(ranked[1] > ranked[0] && ranked[1] > ranked[2] && ranked[1] > ranked[3]);
  assert(ranked[2] !== ranked[3]);
  assert(Math.min(...ranked) >= 0 && Math.max(...ranked) <= 1);
});
