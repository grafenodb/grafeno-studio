import assert from "node:assert/strict";
import { test } from "node:test";

import { RESULT_ROW_HEIGHT, VIRTUALIZE_AFTER, virtualWindow } from "../src/graph/virtual-table.ts";

test("renders a small overscanned window at the top", () => {
  assert.deepEqual(virtualWindow(0, 380, 10_000), {
    start: 0,
    end: 26,
    before: 0,
    after: (10_000 - 26) * RESULT_ROW_HEIGHT,
  });
});

test("moves the window and preserves the full virtual height", () => {
  const result = virtualWindow(3_800, 380, 10_000);
  assert.equal(result.start, 92);
  assert.equal(result.end, 118);
  assert.equal(result.before + (result.end - result.start) * RESULT_ROW_HEIGHT + result.after, 10_000 * RESULT_ROW_HEIGHT);
});

test("clamps a stale scroll position after results become shorter", () => {
  const result = virtualWindow(380_000, 380, 50);
  assert.equal(result.start, 40);
  assert.equal(result.end, 50);
});

test("virtualization starts after a few hundred rows", () => {
  assert.equal(VIRTUALIZE_AFTER, 300);
});
