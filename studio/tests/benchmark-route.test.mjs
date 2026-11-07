import assert from "node:assert/strict";
import { test } from "node:test";

import { isBenchmarkRoute } from "../src/benchmark-route.ts";

test("the benchmark is available from the same hash route in web and Desktop builds", () => {
  assert.equal(isBenchmarkRoute("#/bench"), true);
  assert.equal(isBenchmarkRoute("#bench?nodes=100000&auto=1"), true);
  assert.equal(isBenchmarkRoute("#/bench?shape=scale-free"), true);
});

test("ordinary application routes do not open the benchmark", () => {
  assert.equal(isBenchmarkRoute(""), false);
  assert.equal(isBenchmarkRoute("#/overview"), false);
  assert.equal(isBenchmarkRoute("#/benchmark"), false);
});
