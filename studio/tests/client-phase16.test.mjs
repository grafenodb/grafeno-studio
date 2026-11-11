import assert from "node:assert/strict";
import { test } from "node:test";

import { Grafeno } from "../../client/src/index.ts";

const json = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), {
  status,
  headers: status === 204 ? {} : { "content-type": "application/json" },
});

test("phase 16 search options and trace use the documented HTTP body", async () => {
  const calls = [];
  const client = new Grafeno({
    url: "http://grafeno.test",
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json(url.endsWith("/query") ? { columns: [], rows: [], stats: {}, trace: { format: 1, steps: [], events: [], cut: false } } : []);
    },
  });
  const graph = client.namespace("notes");
  await graph.searchText("graph*", { index: "docs", fragments: true, limit: 7 });
  await graph.search({ mode: "hybrid", text: "graph", embedding: [0.1, 0.2], vector_index: "vectors", fusion: "weighted" });
  await graph.query("MATCH (n) RETURN n", {}, { trace: true });

  assert.deepEqual(calls.map((call) => call.url), [
    "http://grafeno.test/v1/notes/search/text",
    "http://grafeno.test/v1/notes/search",
    "http://grafeno.test/v1/notes/query",
  ]);
  assert.deepEqual(calls[0].body, { query: "graph*", limit: 7, index: "docs", fragments: true });
  assert.equal(calls[1].body.vector_index, "vectors");
  assert.equal(calls[2].body.trace, true);
});

test("phase 16 explicit transactions keep statements on one server session", async () => {
  const paths = [];
  const client = new Grafeno({
    url: "http://grafeno.test",
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      paths.push(`${init?.method} ${path}`);
      if (path.endsWith("/transactions")) return json({ id: "tx-1", read_only: false, started_at: "now", timeout_secs: 30, statements: 0, failed: null });
      if (path.endsWith("/query")) return json({ columns: [], rows: [], stats: {} });
      return json(undefined, 204);
    },
  });
  await client.namespace("default").transaction(async (tx) => {
    await tx.query("CREATE (:Note)");
    await tx.query("CREATE (:Tag)");
  });
  assert.deepEqual(paths, [
    "POST /v1/default/transactions",
    "POST /v1/default/transactions/tx-1/query",
    "POST /v1/default/transactions/tx-1/query",
    "POST /v1/default/transactions/tx-1/commit",
  ]);
});
