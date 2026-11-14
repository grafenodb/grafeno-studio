import assert from "node:assert/strict";
import { test } from "node:test";

import { Grafeno } from "@grafenodb/client";
import { parseSteps } from "../src/palace.ts";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("route steps are read from text: * repeats, < goes against the arrow", () => {
  assert.deepEqual(parseSteps("hit, depends_on*, <maintains"), [
    { label: "hit", backward: false, repeat: false },
    { label: "depends_on", backward: false, repeat: true },
    { label: "maintains", backward: true, repeat: false },
  ]);
  assert.deepEqual(parseSteps("<supersedes*"), [{ label: "supersedes", backward: true, repeat: true }]);
  assert.deepEqual(parseSteps(" , \n"), []);
});

test("memory tools are listed and run in the namespace, a refusal thrown with the tool's words", async () => {
  const calls = [];
  const client = new Grafeno({
    url: "http://grafeno.test",
    fetch: async (url, init) => {
      calls.push({ path: new URL(url).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/tools")) return json({ tools: [{ name: "palace_map", description: "Map", inputSchema: { type: "object" } }] });
      if (url.endsWith("/palace_map")) return json({ content: [{ type: "text", text: "{}" }], structuredContent: { palaces: [] }, isError: false });
      return json({ content: [{ type: "text", text: "name a topic or a node" }], isError: true });
    },
  });
  const graph = client.namespace("agent");
  assert.deepEqual((await graph.tools()).map((tool) => tool.name), ["palace_map"]);
  assert.deepEqual(await graph.tool("palace_map"), { palaces: [] });
  await assert.rejects(graph.tool("palace_walk", {}), (error) => error.code === "tool_error" && /topic/.test(error.message));
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["GET /v1/agent/tools", "POST /v1/agent/tools/palace_map", "POST /v1/agent/tools/palace_walk"],
  );
  assert.deepEqual(calls[1].body, {});
});
