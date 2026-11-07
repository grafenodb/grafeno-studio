import assert from "node:assert/strict";
import { test } from "node:test";

import { decodePickId, usesWebGL, WEBGL_THRESHOLD } from "../src/graph/webgl-renderer.ts";

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
