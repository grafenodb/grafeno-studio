import { createDesktopFetch } from "./desktop-fetch.ts";

// The desktop application (Tauri): when the Studio runs in its window,
// `window.__TAURI__` is there, and these helpers reach the app's commands.
// In a browser they are absent and the Studio works as before.

type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

interface TauriGlobal {
  core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
  event: { listen: Listen };
  /** This window: events the app sends to it alone (menus, files to open). */
  webviewWindow?: { getCurrentWebviewWindow: () => { listen: Listen } };
}

const tauri = typeof window === "undefined" ? undefined : (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

/** Whether the Studio runs inside the Grafeno desktop app. */
export const isDesktop = tauri !== undefined;

/**
 * The internal origin of a window's database file: the app sends its
 * requests to the engine it started for the file, with that session's
 * token, which the Studio never sees.
 */
export const LOCAL_URL = "http://grafeno.local";

/** Where the engine's installers are explained. */
export const INSTALL_URL = "https://github.com/grafenodb/grafeno/blob/main/docs/install.md";

/** The Grafeno engine installed on this computer. */
export interface EngineInfo {
  path: string;
  /** Such as `grafeno 0.1.0`. */
  version: string;
}

export interface DesktopSession {
  url: string;
  path: string;
  name: string;
  /** The installed engine serving it. */
  engine: EngineInfo;
}

export interface RecentDatabase {
  path: string;
  name: string;
  exists: boolean;
}

export interface StoredScript {
  owner: string;
  id: string;
  name: string;
  text: string;
  namespace: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  }
  return btoa(chunks.join(""));
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!tauri) return Promise.reject(new Error("not in the desktop app"));
  return tauri.core.invoke<T>(command, args);
}

export const desktop = {
  session: () => invoke<DesktopSession | null>("session"),
  /** The installed engine, or null: database files need one. */
  engine: () => invoke<EngineInfo | null>("engine_info"),
  /** Another window, with its own connection. */
  newWindow: () => invoke<void>("open_window"),
  open: (path: string) => invoke<DesktopSession>("open_database", { path }),
  close: () => invoke<void>("close_database"),
  recent: () => invoke<RecentDatabase[]>("recent"),
  forgetRecent: (path: string) => invoke<void>("forget_recent", { path }),
  pickDatabase: (create: boolean) => invoke<string | null>("pick_database", { create }),
  pickSave: (name: string, extension: string) => invoke<string | null>("pick_save", { name, extension }),
  pickOpen: (extensions: string[]) => invoke<string | null>("pick_open", { extensions }),
  writeText: (path: string, contents: string) => invoke<void>("write_text", { path, contents }),
  readText: (path: string) => invoke<string>("read_text", { path }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  writeBytes: (path: string, bytes: ArrayBuffer) => invoke<void>("write_bytes", { path, bytesBase64: toBase64(new Uint8Array(bytes)) }),
  restoreTo: (source: string, path: string) => invoke<number>("restore_database", { source, path }),
  localScripts: (owner: string) => invoke<StoredScript[]>("local_scripts", { owner }),
  localPutScript: (script: StoredScript) => invoke<void>("local_put_script", { script }),
  localDeleteScript: (owner: string, id: string) => invoke<void>("local_delete_script", { owner, id }),
  localSetting: (owner: string, key: string) => invoke<string | null>("local_setting", { owner, key }),
  localPutSetting: (owner: string, key: string, value: string) => invoke<void>("local_put_setting", { owner, key, value }),
  listen: <T>(event: string, handler: (payload: T) => void): (() => void) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    // Each window listens to what is sent to it: a menu acts on the focused window only.
    const current = tauri?.webviewWindow?.getCurrentWebviewWindow();
    const listen: Listen | undefined = current ? current.listen.bind(current) : tauri?.event.listen;
    void listen?.<T>(event, (message) => handler(message.payload)).then((unlisten) => {
      if (stopped) unlisten();
      else stop = unlisten;
    });
    return () => {
      stopped = true;
      stop?.();
    };
  },
};

/** Local requests run in-process; remote ones go through the native agent. */
export const desktopFetch = createDesktopFetch(invoke);

/** Saves text to a file the user picks: a dialog in the app, a download in a browser. */
export async function saveText(name: string, text: string, type: string): Promise<boolean> {
  if (isDesktop) {
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "txt";
    const path = await desktop.pickSave(name, extension);
    if (!path) return false;
    await desktop.writeText(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

// Web links open in the system browser, not in the app's window.
if (isDesktop) {
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const href = link?.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) {
      event.preventDefault();
      void desktop.openExternal(href);
    }
  });
}
