import assert from "node:assert/strict";
import { test } from "node:test";

import { GraphLayout } from "../src/graph/layout.ts";
import { LayoutSimulation } from "../src/graph/layout-simulation.ts";

const nodes = [
  { id: "a", size: 10, x: 10, y: 20, pinned: false },
  { id: "b", size: 12, x: 30, y: 40, pinned: false },
];
const edges = [{ from: "a", to: "b" }];

test("layout positions use a compact x/y Float32Array in node order", () => {
  const simulation = new LayoutSimulation(() => undefined);
  simulation.setData(nodes, edges, 0);
  assert.deepEqual([...simulation.positions()], [10, 20, 30, 40]);
  simulation.stop();
});

test("drag and pin messages update layout state", () => {
  const simulation = new LayoutSimulation(() => undefined);
  simulation.setData(nodes, edges, 0);
  simulation.drag([{ id: "a", x: 90, y: 80 }], false);
  simulation.pin([{ id: "b", x: 70, y: 60, pinned: true }]);
  assert.deepEqual([...simulation.positions()], [90, 80, 70, 60]);
  simulation.stop();
});

test("GraphLayout falls back without a browser Worker", async () => {
  assert.equal(typeof Worker, "undefined");
  const positions = await new Promise((resolve, reject) => {
    let layout;
    const timeout = setTimeout(() => reject(new Error("fallback did not publish positions")), 250);
    layout = new GraphLayout((value) => {
      clearTimeout(timeout);
      layout.stop();
      resolve([...value]);
    });
    layout.setData(nodes, edges, 0);
  });
  assert.deepEqual(positions, [10, 20, 30, 40]);
});

test("worker messages use generations to discard stale position buffers", () => {
  const original = globalThis.Worker;
  class FakeWorker {
    static current;
    messages = [];
    terminated = false;
    onmessage = null;
    onerror = null;
    onmessageerror = null;

    constructor(url, options) {
      this.url = url;
      this.options = options;
      FakeWorker.current = this;
    }

    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const moved = [];
    const modes = [];
    const layout = new GraphLayout((positions) => moved.push([...positions]), (mode) => modes.push(mode));
    layout.setData(nodes, edges, 1);
    layout.setData(nodes, edges, 0.6);
    const worker = FakeWorker.current;
    assert.equal(worker.options.type, "module");
    assert.deepEqual(modes, ["worker"]);
    assert.deepEqual(worker.messages.slice(0, 2).map((message) => [message.type, message.generation]), [["setData", 1], ["setData", 2]]);
    worker.onmessage({ data: { type: "positions", generation: 1, positions: new Float32Array([1, 2, 3, 4]) } });
    assert.deepEqual(moved, []);
    worker.onmessage({ data: { type: "backend", generation: 1, backend: "webgpu" } });
    assert.deepEqual(modes, ["worker"]);
    worker.onmessage({ data: { type: "positions", generation: 2, positions: new Float32Array([5, 6, 7, 8]) } });
    assert.deepEqual(moved, [[5, 6, 7, 8]]);
    worker.onmessage({ data: { type: "backend", generation: 2, backend: "webgpu" } });
    assert.deepEqual(modes, ["worker", "webgpu"]);
    layout.stop();
    assert.equal(worker.messages.at(-1).type, "stop");
    assert.equal(worker.terminated, true);
  } finally {
    if (original === undefined) delete globalThis.Worker;
    else globalThis.Worker = original;
  }
});
