import assert from "node:assert/strict";
import { test } from "node:test";

import { collectGraph, hasGraphValue, MAX_DRAWN } from "../src/graph/result-graph.ts";

const node = (id) => ({ id, labels: ["Note"], props: {}, created_at: 0 });
const edge = (id, from, to) => ({ id, from, to, label: "link", recorded_at: 0, valid_to: null });

test("collects nodes and edges from nested arrays and object values", () => {
  const result = collectGraph([{ value: [[node("a")], { nested: node("b") }] }, [edge("ab", "a", "b")]]);
  assert.deepEqual([...result.nodes.keys()], ["a", "b"]);
  assert.deepEqual([...result.edges.keys()], ["ab"]);
  assert.equal(result.totalNodes, 2);
});

test("caps nodes by result degree and keeps only edges between them", () => {
  const values = [node("a"), node("b"), node("c"), node("d"), edge("ab", "a", "b"), edge("ac", "a", "c"), edge("ad", "a", "d"), edge("bc", "b", "c")];
  const result = collectGraph(values, 2);
  assert.equal(result.totalNodes, 4);
  assert.deepEqual([...result.nodes.keys()], ["a", "b"]);
  assert.deepEqual([...result.edges.keys()], ["ab"]);
});

test("deduplicates repeated values when counting and ranking", () => {
  const repeated = node("a");
  const result = collectGraph([repeated, repeated, node("b"), edge("ab", "a", "b"), edge("ab", "a", "b")]);
  assert.equal(result.totalNodes, 2);
  assert.equal(result.edges.size, 1);
});

test("detects graph values and the production cap is 2,000", () => {
  assert.equal(hasGraphValue({ deeply: [[node("a")]] }), true);
  assert.equal(hasGraphValue({ deeply: [[edge("ab", "a", "b")]] }), false);
  assert.equal(MAX_DRAWN, 2_000);
});
