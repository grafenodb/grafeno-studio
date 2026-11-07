import type { Connection, Grafeno } from "./api.ts";
import { desktop, isDesktop, type StoredScript } from "./desktop.ts";

export type { StoredScript } from "./desktop.ts";

const DATABASE = "grafeno-studio-client";
const VERSION = 1;
const LEGACY_SCRIPTS = "grafeno.studio.scripts";
const MIGRATION = "migration.localStorageScripts.v1";
export const ACTIVE_SCRIPT = "scripts.active";

interface StoredSetting {
  owner: string;
  key: string;
  value: string;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB operation failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

let opening: Promise<IDBDatabase> | null = null;

function browserDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, VERSION);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains("scripts")) {
        const scripts = database.createObjectStore("scripts", { keyPath: ["owner", "id"] });
        scripts.createIndex("owner", "owner");
        scripts.createIndex("ownerOpened", ["owner", "lastOpenedAt"]);
      }
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: ["owner", "key"] });
      }
    };
    open.onsuccess = () => {
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error("Cannot open the local Studio database"));
  });
  return opening;
}

function normalizeEndpoint(url: string): string {
  const endpoints = url
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean)
    .map((item) => (/^http:\/\/grafeno\.local(?:\/session\/[^/]+)?$/.test(item) ? "desktop-local" : item))
    .sort();
  return endpoints.join(",") || "local";
}

export function ownerKey(connection: Connection, identity?: { name?: string }): string {
  const principal = identity?.name?.trim() || connection.user?.trim() || "anonymous";
  return `${normalizeEndpoint(connection.url)}|${principal.toLocaleLowerCase()}`;
}

export async function resolveOwner(client: Grafeno, connection: Connection): Promise<string> {
  try {
    return ownerKey(connection, await client.whoami());
  } catch {
    return ownerKey(connection);
  }
}

async function browserScripts(owner: string): Promise<StoredScript[]> {
  const database = await browserDatabase();
  const transaction = database.transaction("scripts", "readonly");
  const done = complete(transaction);
  const records = await request(transaction.objectStore("scripts").index("owner").getAll(owner) as IDBRequest<StoredScript[]>);
  await done;
  return records.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt || left.createdAt - right.createdAt);
}

async function browserPutScript(script: StoredScript): Promise<void> {
  const database = await browserDatabase();
  const transaction = database.transaction("scripts", "readwrite");
  transaction.objectStore("scripts").put(script);
  await complete(transaction);
}

async function browserDeleteScript(owner: string, id: string): Promise<void> {
  const database = await browserDatabase();
  const transaction = database.transaction("scripts", "readwrite");
  transaction.objectStore("scripts").delete([owner, id]);
  await complete(transaction);
}

async function browserSetting(owner: string, key: string): Promise<string | null> {
  const database = await browserDatabase();
  const transaction = database.transaction("settings", "readonly");
  const done = complete(transaction);
  const setting = await request(transaction.objectStore("settings").get([owner, key]) as IDBRequest<StoredSetting | undefined>);
  await done;
  return setting?.value ?? null;
}

async function browserPutSetting(owner: string, key: string, value: string): Promise<void> {
  const database = await browserDatabase();
  const transaction = database.transaction("settings", "readwrite");
  transaction.objectStore("settings").put({ owner, key, value } satisfies StoredSetting);
  await complete(transaction);
}

export const clientStorage = {
  scripts: (owner: string) => (isDesktop ? desktop.localScripts(owner) : browserScripts(owner)),
  putScript: (script: StoredScript) => (isDesktop ? desktop.localPutScript(script) : browserPutScript(script)),
  deleteScript: (owner: string, id: string) => (isDesktop ? desktop.localDeleteScript(owner, id) : browserDeleteScript(owner, id)),
  setting: (owner: string, key: string) => (isDesktop ? desktop.localSetting(owner, key) : browserSetting(owner, key)),
  putSetting: (owner: string, key: string, value: string) =>
    isDesktop ? desktop.localPutSetting(owner, key, value) : browserPutSetting(owner, key, value),
};

interface LegacyLibrary {
  scripts?: { id?: unknown; name?: unknown; text?: unknown }[];
  active?: unknown;
}

export function legacyScripts(raw: string | null, owner: string, now: number): { scripts: StoredScript[]; active: string | null } {
  if (!raw) return { scripts: [], active: null };
  try {
    const library = JSON.parse(raw) as LegacyLibrary;
    const scripts = (library.scripts ?? [])
      .filter((script) => typeof script.id === "string" && typeof script.name === "string" && typeof script.text === "string")
      .map((script, index) => ({
        owner,
        id: script.id as string,
        name: script.name as string,
        text: script.text as string,
        namespace: null,
        createdAt: now + index,
        updatedAt: now + index,
        lastOpenedAt: now + index,
      }));
    const active = typeof library.active === "string" && scripts.some((script) => script.id === library.active) ? library.active : null;
    return { scripts, active };
  } catch {
    return { scripts: [], active: null };
  }
}

export async function migrateLegacyScripts(owner: string): Promise<void> {
  if ((await clientStorage.setting(owner, MIGRATION)) === "done") return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_SCRIPTS);
  } catch {
    // Storage may be blocked, but the migration can still be marked complete.
  }
  const migrated = legacyScripts(raw, owner, Date.now());
  for (const script of migrated.scripts) await clientStorage.putScript(script);
  if (migrated.active) await clientStorage.putSetting(owner, ACTIVE_SCRIPT, migrated.active);
  await clientStorage.putSetting(owner, MIGRATION, "done");
  if (migrated.scripts.length > 0) {
    try {
      localStorage.removeItem(LEGACY_SCRIPTS);
    } catch {
      // The durable copy was made; a blocked legacy store is harmless.
    }
  }
}

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (isDesktop || !navigator.storage?.persist) return isDesktop;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
