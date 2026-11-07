import assert from "node:assert/strict";
import { test } from "node:test";

import { exportScriptLibrary, importScriptLibrary } from "../src/script-library.ts";

const stored = {
  owner: "server|ana",
  id: "script-one",
  name: "People",
  text: "MATCH (n) RETURN n;",
  namespace: "default",
  createdAt: 10,
  updatedAt: 20,
  lastOpenedAt: 30,
};

test("a script library round-trips without its local owner", () => {
  const exported = exportScriptLibrary({ scripts: [stored], active: stored.id });
  assert.equal(exported.includes("server|ana"), false);
  let sequence = 0;
  const imported = importScriptLibrary(exported, "other|bob", [], () => `new-${++sequence}`, 100);
  assert.equal(imported.active, "script-one");
  assert.equal(imported.scripts[0].owner, "other|bob");
  assert.equal(imported.scripts[0].text, stored.text);
});

test("import remaps colliding ids and the active script", () => {
  const exported = exportScriptLibrary({ scripts: [stored], active: stored.id });
  const imported = importScriptLibrary(exported, "owner", [stored.id], () => "fresh-id", 100);
  assert.equal(imported.scripts[0].id, "fresh-id");
  assert.equal(imported.active, "fresh-id");
});

test("import rejects arbitrary JSON", () => {
  assert.throws(() => importScriptLibrary("{}", "owner", [], () => "id"), /supported Grafeno script library/);
  assert.throws(() => importScriptLibrary("nope", "owner", [], () => "id"), /valid JSON/);
});
