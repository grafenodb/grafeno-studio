import assert from "node:assert/strict";
import { test } from "node:test";

import { legacyScripts, ownerKey } from "../src/client-storage.ts";

test("local data is scoped by endpoint and account without using credentials", () => {
  const first = ownerKey({ url: "HTTPS://DB.EXAMPLE/", token: "secret", user: "Ana" });
  const second = ownerKey({ url: "https://db.example", token: "another", user: "ana" });
  assert.equal(first, "https://db.example|ana");
  assert.equal(first, second);
  assert.equal(first.includes("secret"), false);
});

test("desktop session urls share one local script library", () => {
  assert.equal(ownerKey({ url: "http://grafeno.local/session/one", token: "" }), "desktop-local|anonymous");
  assert.equal(ownerKey({ url: "http://grafeno.local/session/two", token: "" }), "desktop-local|anonymous");
});

test("legacy localStorage scripts migrate with their active tab", () => {
  const migrated = legacyScripts(JSON.stringify({ scripts: [{ id: "a", name: "One", text: "RETURN 1;" }], active: "a" }), "owner", 100);
  assert.equal(migrated.active, "a");
  assert.deepEqual(migrated.scripts[0], {
    owner: "owner",
    id: "a",
    name: "One",
    text: "RETURN 1;",
    namespace: null,
    createdAt: 100,
    updatedAt: 100,
    lastOpenedAt: 100,
  });
});

test("invalid legacy data is ignored", () => {
  assert.deepEqual(legacyScripts("not json", "owner", 100), { scripts: [], active: null });
  assert.deepEqual(legacyScripts(JSON.stringify({ scripts: [{ id: 4, name: "bad", text: "" }] }), "owner", 100), { scripts: [], active: null });
});
