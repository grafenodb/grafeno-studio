import assert from "node:assert/strict";
import { test } from "node:test";

import { legacyScripts, orderStoredScripts, ownerKey } from "../src/client-storage.ts";

const script = (id, createdAt) => ({
  owner: "owner", id, name: id, text: "", namespace: null, createdAt, updatedAt: createdAt, lastOpenedAt: createdAt,
});

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

test("script tabs restore their explicit order instead of recent-use order", () => {
  const scripts = [script("three", 30), script("one", 10), script("two", 20)];
  assert.deepEqual(orderStoredScripts(scripts, JSON.stringify(["two", "three", "one"])).map(({ id }) => id), ["two", "three", "one"]);
  assert.deepEqual(orderStoredScripts(scripts, null).map(({ id }) => id), ["one", "two", "three"]);
});
