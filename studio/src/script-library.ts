import type { StoredScript } from "./client-storage.ts";

const FORMAT = "grafeno-script-library";
const VERSION = 1;
const MAX_SCRIPTS = 500;
const MAX_TEXT = 10 * 1024 * 1024;

export interface ScriptLibrary {
  scripts: StoredScript[];
  active: string;
}

interface PortableLibrary {
  format: typeof FORMAT;
  version: typeof VERSION;
  exportedAt: string;
  active: string;
  scripts: {
    id: string;
    name: string;
    text: string;
    namespace: string | null;
    createdAt: number;
    updatedAt: number;
  }[];
}

export function exportScriptLibrary(library: ScriptLibrary): string {
  const portable: PortableLibrary = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    active: library.active,
    scripts: library.scripts.map(({ id, name, text, namespace, createdAt, updatedAt }) => ({
      id,
      name,
      text,
      namespace,
      createdAt,
      updatedAt,
    })),
  };
  return JSON.stringify(portable, null, 2);
}

export function importScriptLibrary(
  raw: string,
  owner: string,
  existingIds: Iterable<string>,
  makeId: () => string,
  now = Date.now(),
): ScriptLibrary {
  let source: unknown;
  try {
    source = JSON.parse(raw);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!source || typeof source !== "object") throw new Error("The selected file is not a script library.");
  const portable = source as Partial<PortableLibrary>;
  if (portable.format !== FORMAT || portable.version !== VERSION || !Array.isArray(portable.scripts)) {
    throw new Error("The selected file is not a supported Grafeno script library.");
  }
  if (portable.scripts.length === 0) throw new Error("The script library is empty.");
  if (portable.scripts.length > MAX_SCRIPTS) throw new Error(`A library can contain at most ${MAX_SCRIPTS} scripts.`);
  let bytes = 0;
  const used = new Set(existingIds);
  const ids = new Map<string, string>();
  const scripts = portable.scripts.map((candidate, index) => {
    if (!candidate || typeof candidate.name !== "string" || typeof candidate.text !== "string") {
      throw new Error(`Script ${index + 1} has an invalid name or text.`);
    }
    bytes += candidate.text.length;
    if (bytes > MAX_TEXT) throw new Error("The script library is larger than 10 MB.");
    let id = typeof candidate.id === "string" && /^[a-z0-9_-]{4,80}$/i.test(candidate.id) ? candidate.id : makeId();
    while (used.has(id)) id = makeId();
    used.add(id);
    if (typeof candidate.id === "string") ids.set(candidate.id, id);
    const createdAt = Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : now + index;
    return {
      owner,
      id,
      name: candidate.name.trim() || `Imported script ${index + 1}`,
      text: candidate.text,
      namespace: typeof candidate.namespace === "string" ? candidate.namespace : null,
      createdAt,
      updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : createdAt,
      lastOpenedAt: now + index,
    } satisfies StoredScript;
  });
  return { scripts, active: ids.get(portable.active ?? "") ?? scripts[0].id };
}
