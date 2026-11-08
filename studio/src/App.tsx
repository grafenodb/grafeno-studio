import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type About,
  type Connection,
  type NamespaceInfo,
  clientFor,
  defaultUrl,
  describeError,
  displayName,
  forgetConnection,
  forgetServer,
  go,
  labelColor,
  loadConnection,
  loadServers,
  probe,
  saveConnection,
  saveServer,
} from "./api.ts";
import { EdgeForm, NodeForm } from "./components/Forms.tsx";
import { type ConfirmOptions, type NewEdgeOptions, type NewNodeOptions, type Studio, StudioContext, useStudio } from "./context.ts";
import { Icon, type IconName, Logo } from "./icons.tsx";
import { Modal, useNodeSearch } from "./ui.tsx";
import { type DesktopSession, desktop, isDesktop, saveText } from "./desktop.ts";
import { AdminView } from "./views/AdminView.tsx";
import { AccessView } from "./views/AccessView.tsx";
import { ClusterView } from "./views/ClusterView.tsx";
import { ExplorerView } from "./views/ExplorerView.tsx";
import { GraphView } from "./views/GraphView.tsx";
import { MemoryView } from "./views/MemoryView.tsx";
import { OverviewView } from "./views/OverviewView.tsx";
import { ScriptsView } from "./views/ScriptsView.tsx";
import { SearchView } from "./views/SearchView.tsx";
import { StartView } from "./views/StartView.tsx";
import {
  addWorkspaceDocument,
  readWorkspaceDocuments,
  workspaceDocument,
  workspaceStorageKey,
  writeWorkspaceDocuments,
  type WorkspaceDocument,
} from "./workspace-documents.ts";

export { useStudio };

/** The views; `needs` is the engine capability a view uses (hidden without it). */
const VIEWS: { id: string; title: string; icon: IconName; hint: string; needs?: string }[] = [
  { id: "overview", title: "Overview", icon: "overview", hint: "Namespaces and what they hold" },
  { id: "explorer", title: "Explorer", icon: "explorer", hint: "Browse, create and edit nodes" },
  { id: "graph", title: "Graph", icon: "graph", hint: "Draw and connect the graph" },
  { id: "scripts", title: "Scripts", icon: "scripts", hint: "Write and run GQ scripts" },
  { id: "search", title: "Search", icon: "search", hint: "Full text, recall and context" },
  { id: "memory", title: "Memory", icon: "memory", hint: "Duplicates, decay, consolidation", needs: "memory" },
  { id: "admin", title: "Administration", icon: "admin", hint: "Check, rebuild, export, import" },
  { id: "cluster", title: "Cluster", icon: "cluster", hint: "Members, Raft groups, lag, where namespaces live", needs: "cluster" },
  { id: "access", title: "Access", icon: "access", hint: "Users, roles and their privileges", needs: "roles" },
];

function parseHash(): { view: string; param?: string } {
  const [raw, param] = window.location.hash.replace(/^#\/?/, "").split("/");
  const view = raw === "query" ? "scripts" : raw;
  const known = VIEWS.find((v) => v.id === view);
  return { view: known ? known.id : "overview", param: param ? decodeURIComponent(param) : undefined };
}

type Theme = "system" | "light" | "dark";

function readSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings are a convenience.
  }
}

function serverLabel(address: string): string {
  try {
    const members = address.split(",").map((value) => new URL(value.trim()).host);
    return members.length > 1 ? `${members[0]} +${members.length - 1}` : members[0];
  } catch {
    return address;
  }
}

function ConnectScreen({ initial, error, onConnect }: {
  initial: Connection;
  error: string | null;
  onConnect: (connection: Connection, remember: boolean) => void;
}) {
  const [url, setUrl] = useState(initial.url);
  const [mode, setMode] = useState<"signin" | "token">("signin");
  const [token, setToken] = useState(initial.token);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [remember, setRemember] = useState(false);
  const [setup, setSetup] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [servers, setServers] = useState(loadServers);
  const cleanUrl = url.trim().replace(/\/+$/, "");

  const rememberServer = (secret: string) => {
    if (remember) setServers(saveServer({ name: serverLabel(cleanUrl), url: cleanUrl, token: secret }));
  };

  // An open server with no accounts offers to make the first one.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      clientFor({ url: cleanUrl, token: "" })
        .authStatus()
        .then((status) => live && setSetup(status.setup))
        .catch(() => live && setSetup(false));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [cleanUrl]);

  const signIn = async () => {
    setProblem(null);
    if (setup && password !== again) {
      setProblem("The passwords differ.");
      return;
    }
    setBusy(true);
    try {
      const client = clientFor({ url: cleanUrl, token: "" });
      const tokens = setup ? await client.setup(name.trim(), password) : await client.signIn(name.trim(), password);
      rememberServer("");
      onConnect({ url: cleanUrl, token: tokens.access_token, refresh: tokens.refresh_token, user: tokens.account.name }, remember);
    } catch (failure) {
      setProblem(describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connect">
      <div className="connect-art" aria-hidden="true" />
      <form
        className="connect-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "signin") void signIn();
          else {
            rememberServer(token.trim());
            onConnect({ url: cleanUrl, token: token.trim() }, remember);
          }
        }}
      >
        <div className="connect-brand">
          <Logo size={56} />
          <div>
            <h1>Grafeno Studio</h1>
            <p className="muted">The graph engine for agent memory.</p>
          </div>
        </div>
        {servers.length > 0 && (
          <div className="connect-servers" aria-label="Saved servers">
            <span className="muted small">Saved servers</span>
            {servers.map((server) => (
              <div className="connect-server" key={server.url}>
                <button
                  type="button"
                  className="connect-server-target"
                  title={server.url}
                  onClick={() => {
                    setUrl(server.url);
                    setToken(server.token);
                    setMode(server.token ? "token" : "signin");
                    setProblem(null);
                  }}
                >
                  <span className="live-dot" />
                  <span><strong>{server.name || serverLabel(server.url)}</strong><small>{server.url}</small></span>
                </button>
                <button type="button" className="ghost icon-button" title={`Forget ${server.name}`} onClick={() => setServers(forgetServer(server.url))}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="field">
          Server URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:7810" required />
        </label>
        <div className="row" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "primary" : "ghost"} onClick={() => setMode("signin")}>
            {setup ? "Create the first account" : "Sign in"}
          </button>
          <button type="button" role="tab" aria-selected={mode === "token"} className={mode === "token" ? "primary" : "ghost"} onClick={() => setMode("token")}>
            Token or key
          </button>
        </div>
        {mode === "signin" ? (
          <>
            {setup && <p className="muted small" style={{ margin: 0 }}>This server has no accounts yet: the first one you make is its superuser.</p>}
            <label className="field">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
            </label>
            <label className="field">
              Password {setup && <span className="hint">at least 10 characters</span>}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} required />
            </label>
            {setup && (
              <label className="field">
                Password again
                <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
              </label>
            )}
          </>
        ) : (
          <label className="field">
            Token <span className="hint">the server's --token, or an API key</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </label>
        )}
        <label className="check small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this browser
        </label>
        {(problem ?? error) && <div className="error">{problem ?? error}</div>}
        <button className="primary big" type="submit" disabled={busy}>
          {busy ? "Signing in…" : mode === "signin" ? (setup ? "Create and sign in" : "Sign in") : "Connect"}
        </button>
      </form>
    </div>
  );
}

function NamespaceMenu() {
  const { namespace, namespaces, setNamespace, createNamespace, toast } = useStudio();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<{ message: string; existing?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const reset = () => {
    setCreating(false);
    setName("");
    setDescription("");
    setProblem(null);
  };
  const choose = (value: string) => {
    setOpen(false);
    reset();
    if (value !== namespace) {
      setNamespace(value);
      toast(`Switched to namespace “${value}”.`, "info");
    }
  };
  const create = async () => {
    const value = name.trim();
    if (!value) return;
    if (namespaces.some((info) => info.name === value)) {
      setProblem({ message: `“${value}” already exists.`, existing: value });
      return;
    }
    setBusy(true);
    try {
      await createNamespace(value, description.trim() || undefined);
      setOpen(false);
      reset();
      toast(`Created namespace “${value}” and switched to it.`, "ok");
    } catch (error) {
      const message = describeError(error);
      setProblem(message.includes("already exists") ? { message: `“${value}” already exists.`, existing: value } : { message });
    } finally {
      setBusy(false);
    }
  };
  const known = namespaces.some((info) => info.name === namespace);
  return (
    <div className="ns-menu namespace-menu" ref={box}>
      <button className="ns-button" onClick={() => setOpen((value) => !value)} title="Switch or create a namespace">
        <span className="ns-dot" />
        <span className="muted small">namespace</span>
        <strong>{namespace}</strong>
        {!known && <span className="muted small">(not created)</span>}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu">
          <div className="muted small menu-note">Switch to</div>
          {namespaces.length === 0 && <div className="muted small menu-note">No namespaces yet: create the first one.</div>}
          {namespaces.map((info) => (
            <button key={info.name} className={info.name === namespace ? "menu-item active" : "menu-item"} onClick={() => choose(info.name)} title={info.description}>
              <span className="grow ellipsis">{info.name}</span>
              <span className="muted small mono">{info.nodes === 0 ? "empty" : `${info.nodes} nodes`}</span>
              {info.name === namespace && <Icon name="check" size={14} />}
            </button>
          ))}
          {creating ? (
            <form
              className="menu-form stack tight"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setProblem(null);
                }}
                placeholder="Name of the new namespace"
                maxLength={128}
              />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" />
              {problem && (
                <div className="error small">
                  {problem.message}{" "}
                  {problem.existing && (
                    <button type="button" className="link-button" onClick={() => choose(problem.existing!)}>
                      Switch to it
                    </button>
                  )}
                </div>
              )}
              <div className="row">
                <button type="button" className="ghost" onClick={reset}>
                  Cancel
                </button>
                <div className="spacer" />
                <button className="primary" type="submit" disabled={busy || !name.trim()}>
                  Create
                </button>
              </div>
            </form>
          ) : (
            <button className="menu-item" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> New namespace…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ApplicationMenuAction {
  label: string;
  run: () => void;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean | (() => boolean);
  danger?: boolean;
}

interface ApplicationMenuDefinition {
  label: string;
  groups: ApplicationMenuAction[][];
}

/** The in-workspace menu bar, shared by the browser and Desktop builds. */
function ApplicationMenus({ menus }: { menus: ApplicationMenuDefinition[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !bar.current?.contains(event.target as Node) && setOpen(null);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const focusMenu = (label: string) => {
    window.requestAnimationFrame(() => {
      const root = bar.current?.querySelector<HTMLElement>(`[data-application-menu="${label}"]`);
      root?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    });
  };
  const moveTop = (label: string, direction: number) => {
    const index = menus.findIndex((menu) => menu.label === label);
    const next = menus[(index + direction + menus.length) % menus.length];
    setOpen(next.label);
    bar.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${next.label}"]`)?.focus();
  };

  return (
    <div className="application-menus" role="menubar" aria-label="Application menu" ref={bar}>
      {menus.map((menu) => (
        <div className="application-menu" data-application-menu={menu.label} key={menu.label}>
          <button
            className={open === menu.label ? "application-menu-trigger active" : "application-menu-trigger"}
            type="button"
            role="menuitem"
            data-menu-trigger={menu.label}
            aria-haspopup="menu"
            aria-expanded={open === menu.label}
            onClick={() => setOpen((value) => (value === menu.label ? null : menu.label))}
            onMouseEnter={() => open && setOpen(menu.label)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                moveTop(menu.label, event.key === "ArrowRight" ? 1 : -1);
              } else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(menu.label);
                focusMenu(menu.label);
              }
            }}
          >
            {menu.label}
          </button>
          {open === menu.label && (
            <div
              className="application-menu-popup"
              role="menu"
              aria-label={menu.label}
              onKeyDown={(event) => {
                const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')];
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  items[event.key === "Home" ? 0 : items.length - 1]?.focus();
                } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveTop(menu.label, event.key === "ArrowRight" ? 1 : -1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(null);
                  bar.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menu.label}"]`)?.focus();
                }
              }}
            >
              {menu.groups.map((group, groupIndex) => (
                <div className="application-menu-group" key={groupIndex}>
                  {group.map((item) => {
                    const disabled = typeof item.disabled === "function" ? item.disabled() : item.disabled;
                    return (
                      <button
                        className={`application-menu-item ${item.danger ? "danger-item" : ""}`.trim()}
                        type="button"
                        role="menuitem"
                        disabled={disabled}
                        key={item.label}
                        onClick={() => {
                          setOpen(null);
                          item.run();
                        }}
                      >
                        <span className="application-menu-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                        <span>{item.label}</span>
                        {item.shortcut && <kbd>{item.shortcut}</kbd>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Ctrl+K: jump to a view, run an action or open a node. */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const { newNode, newEdge, namespaces, setNamespace, supports } = useStudio();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { results, searching } = useNodeSearch(query, 6);
  const text = query.trim().toLowerCase();
  const commands = [
    ...VIEWS.filter((view) => !view.needs || supports(view.needs)).map((view) => ({ key: `v-${view.id}`, icon: view.icon, title: `Go to ${view.title}`, hint: view.hint, run: () => go(view.id) })),
    { key: "new-node", icon: "node" as IconName, title: "New node", hint: "Create a node", run: () => newNode({ onCreated: (id) => go("explorer", id) }) },
    { key: "new-edge", icon: "link" as IconName, title: "New fact", hint: "Connect two nodes", run: () => newEdge() },
    ...namespaces.map(({ name }) => ({ key: `ns-${name}`, icon: "folder" as IconName, title: `Namespace: ${name}`, hint: "Switch namespace", run: () => setNamespace(name) })),
  ].filter((command) => !text || command.title.toLowerCase().includes(text) || command.hint.toLowerCase().includes(text));
  const nodes = results.map((node) => ({
    key: `n-${node.id}`,
    icon: "node" as IconName,
    title: displayName(node),
    hint: node.labels.join(", "),
    color: labelColor(node.labels[0] ?? ""),
    run: () => go("explorer", node.id),
  }));
  const items = [...commands.slice(0, text ? 8 : 12), ...nodes];
  const pick = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    item.run();
  };
  return (
    <div className="backdrop top" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder="Go to a view, create something, or find a node…"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") pick(active);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {items.length === 0 && <div className="muted pad small">{searching ? "Searching…" : "Nothing matches."}</div>}
          {items.map((item, index) => (
            <button
              key={item.key}
              className={index === active ? "palette-item active" : "palette-item"}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(index)}
            >
              {"color" in item ? <span className="dot" style={{ background: item.color as string }} /> : <Icon name={item.icon} />}
              <span className="grow-text">{item.title}</span>
              <span className="muted small">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Toast {
  id: number;
  message: string;
  kind: "ok" | "error" | "info";
}

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [version, setVersion] = useState<string>("");
  const [about, setAbout] = useState<About | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [route, setRoute] = useState(parseHash);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [namespace, setNamespaceState] = useState(() => readSetting("grafeno.studio.namespace", ""));
  const [documents, setDocuments] = useState<WorkspaceDocument[]>(() => {
    const initial = parseHash();
    return [workspaceDocument(initial.view, readSetting("grafeno.studio.namespace", "") || "default", initial.param)];
  });
  const [activeDocument, setActiveDocument] = useState(() => documents[0].id);
  const [loadedWorkspace, setLoadedWorkspace] = useState("");
  const [schema, setSchema] = useState<Studio["schema"]>({ labels: {}, edgeLabels: {} });
  const [revision, setRevision] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirming, setConfirming] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [nodeForm, setNodeForm] = useState<NewNodeOptions | null>(null);
  const [edgeForm, setEdgeForm] = useState<NewEdgeOptions | null>(null);
  const [palette, setPalette] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [queryRunning, setQueryRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readSetting("grafeno.studio.collapsed", "") === "1");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const value = Number(readSetting("grafeno.studio.sidebar-width", "224"));
    return Number.isFinite(value) ? Math.min(360, Math.max(184, value)) : 224;
  });
  const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(() => new Set());
  const [theme, setTheme] = useState<Theme>(() => readSetting("grafeno.studio.theme", "light") as Theme);

  useEffect(() => {
    // Light is the default look; "system" follows the system's choice.
    document.documentElement.dataset.theme = theme;
    writeSetting("grafeno.studio.theme", theme);
  }, [theme]);

  // The database file open in the desktop app, when the Studio runs there.
  const [local, setLocal] = useState<DesktopSession | null>(null);

  const toast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, message, kind }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const connect = useCallback(async (candidate: Connection, remember?: boolean) => {
    setChecking(true);
    try {
      const { version, about } = await probe(candidate);
      if (remember !== undefined) saveConnection(candidate, remember);
      setVersion(version);
      setAbout(about);
      setConnection(candidate);
      setError(null);
    } catch (problem) {
      setError(describeError(problem));
      setConnection(null);
    } finally {
      setChecking(false);
    }
  }, []);

  // Try a saved connection, then the server that served the Studio. In the
  // desktop app: the database the app has open, or its start screen.
  useEffect(() => {
    if (isDesktop) {
      void desktop
        .session()
        .then((session) => {
          if (!session) {
            setChecking(false);
            return;
          }
          setLocal(session);
          return connect({ url: session.url, token: "" });
        })
        .catch((problem) => {
          setError(describeError(problem));
          setChecking(false);
        });
      return;
    }
    const saved = loadConnection();
    void connect(saved ?? { url: defaultUrl(), token: "" }, saved ? undefined : false).then(() => {
      if (!saved) setError(null);
    });
  }, [connect]);

  const openLocal = useCallback(
    async (path: string) => {
      setChecking(true);
      try {
        const session = await desktop.open(path);
        if (local?.url !== session.url) {
          // A draft and its suggestions belong to the previous database.
          setNodeForm(null);
          setEdgeForm(null);
          setPalette(false);
          setToasts([]);
          setNamespaces([]);
          setNamespaceState("");
          setSchema({ labels: {}, edgeLabels: {} });
          go("overview");
        }
        setLocal(session);
        await connect({ url: session.url, token: "" });
      } catch (problem) {
        // A failed open keeps the previous session in the engine and the UI.
        const message = describeError(problem);
        setError(message);
        toast(message, "error");
        setChecking(false);
      }
    },
    [connect, toast, local],
  );

  const closeLocal = useCallback(async () => {
    await desktop.close();
    setLocal(null);
    setConnection(null);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const state = (event: Event) => setQueryRunning(Boolean((event as CustomEvent<{ running: boolean }>).detail?.running));
    window.addEventListener("grafeno:query-state", state);
    return () => window.removeEventListener("grafeno:query-state", state);
  }, []);

  const client = useMemo(() => (connection ? clientFor(connection) : null), [connection]);
  const current = namespace || "default";
  const currentInfo = namespaces.find((info) => info.name === current);
  const workspaceKey = connection
    ? workspaceStorageKey(local?.path ?? `${connection.url}|${connection.user ?? "anonymous"}`)
    : "";

  useEffect(() => {
    if (!workspaceKey || loadedWorkspace === workspaceKey) return;
    const saved = readWorkspaceDocuments(workspaceKey);
    const explicitRoute = route.view !== "overview" || Boolean(route.param);
    if (saved && !explicitRoute) {
      const active = saved.documents.find((item) => item.id === saved.active) ?? saved.documents[0];
      setDocuments(saved.documents);
      setActiveDocument(active.id);
      setNamespaceState(active.namespace);
      writeSetting("grafeno.studio.namespace", active.namespace);
      setRoute({ view: active.view, param: active.param });
      go(active.view, active.param);
    } else {
      const document = workspaceDocument(route.view, current, route.param);
      setDocuments((list) => addWorkspaceDocument(saved?.documents ?? list, document));
      setActiveDocument(document.id);
    }
    setLoadedWorkspace(workspaceKey);
  }, [workspaceKey, loadedWorkspace, route, current]);

  useEffect(() => {
    if (!workspaceKey || loadedWorkspace !== workspaceKey) return;
    const document = workspaceDocument(route.view, current, route.param);
    setDocuments((list) => addWorkspaceDocument(list, document));
    setActiveDocument(document.id);
  }, [route, current, workspaceKey, loadedWorkspace]);

  useEffect(() => {
    if (!workspaceKey || loadedWorkspace !== workspaceKey) return;
    writeWorkspaceDocuments(workspaceKey, { documents, active: activeDocument });
  }, [documents, activeDocument, workspaceKey, loadedWorkspace]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".workspace-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [activeDocument, documents]);

  useEffect(() => {
    setExpandedNamespaces((value) => {
      if (value.has(current)) return value;
      const next = new Set(value);
      next.add(current);
      return next;
    });
  }, [current]);

  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = event.clientX;
    const width = sidebarWidth;
    const move = (next: PointerEvent) => setSidebarWidth(Math.min(360, Math.max(184, width + next.clientX - start)));
    const finish = (next: PointerEvent) => {
      const value = Math.min(360, Math.max(184, width + next.clientX - start));
      setSidebarWidth(value);
      writeSetting("grafeno.studio.sidebar-width", String(value));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .namespaces()
      .then((list) => {
        if (cancelled) return;
        setNamespaces(list);
        // A remembered namespace that was dropped falls back to the first one.
        setNamespaceState((value) => (list.some((info) => info.name === value) ? value : list[0]?.name || value || "default"));
      })
      .catch((problem) => {
        if (!cancelled) toast(describeError(problem), "error");
      });
    return () => { cancelled = true; };
  }, [client, revision, toast]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .namespace(current)
      .stats()
      .then((stats) => {
        if (!cancelled) setSchema({ labels: stats.node_labels, edgeLabels: stats.edge_labels });
      })
      .catch(() => {
        if (!cancelled) setSchema({ labels: {}, edgeLabels: {} });
      });
    return () => { cancelled = true; };
  }, [client, current, revision]);

  const setNamespace = useCallback((name: string) => {
    setNamespaceState(name);
    writeSetting("grafeno.studio.namespace", name);
  }, []);

  const activateDocument = useCallback((document: WorkspaceDocument) => {
    setActiveDocument(document.id);
    setNamespace(document.namespace);
    setRoute({ view: document.view, param: document.param });
    go(document.view, document.param);
  }, [setNamespace]);

  const closeDocument = useCallback((id: string) => {
    const index = documents.findIndex((item) => item.id === id);
    if (index < 0) return;
    let remaining = documents.filter((item) => item.id !== id);
    if (remaining.length === 0) remaining = [workspaceDocument("overview", current)];
    setDocuments(remaining);
    if (id === activeDocument) activateDocument(remaining[Math.min(index, remaining.length - 1)]);
  }, [documents, activeDocument, current, activateDocument]);

  useEffect(() => {
    const onDocumentKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "w") {
        event.preventDefault();
        closeDocument(activeDocument);
        return;
      }
      if (event.key !== "PageUp" && event.key !== "PageDown") return;
      event.preventDefault();
      const index = documents.findIndex((item) => item.id === activeDocument);
      if (index < 0 || documents.length < 2) return;
      const direction = event.key === "PageDown" ? 1 : -1;
      activateDocument(documents[(index + direction + documents.length) % documents.length]);
    };
    window.addEventListener("keydown", onDocumentKey);
    return () => window.removeEventListener("keydown", onDocumentKey);
  }, [documents, activeDocument, activateDocument, closeDocument]);

  const changed = useCallback(() => setRevision((value) => value + 1), []);

  // The desktop app's menu: its items arrive as events.
  const menuActions = useRef<(id: string) => void>(() => undefined);
  menuActions.current = (id: string) => {
    const day = new Date().toISOString().slice(0, 10);
    const pick = async (create: boolean) => {
      const path = await desktop.pickDatabase(create);
      if (path) await openLocal(path);
    };
    if (id === "new" || id === "open") void pick(id === "new");
    else if (id === "close" || id === "connect") {
      if (local) void closeLocal();
      else {
        forgetConnection();
        setConnection(null);
      }
    } else if (id === "palette") setPalette(true);
    else if (id.startsWith("theme:")) setTheme(id.slice("theme:".length) as Theme);
    else if (id.startsWith("view:")) go(id.slice("view:".length));
    else if (id === "export" && client) {
      void client
        .export()
        .then((text) => saveText(`grafeno-all-${day}.jsonl`, text, "application/x-ndjson"))
        .then((saved) => saved && toast("Exported every namespace.", "ok"))
        .catch((problem) => toast(describeError(problem), "error"));
    } else if (id === "import" && client) {
      void desktop
        .pickOpen(["jsonl", "ndjson", "json"])
        .then(async (path) => {
          if (!path) return;
          const stats = await client.import(await desktop.readText(path));
          toast(`Imported ${stats.nodes} nodes and ${stats.edges} facts in ${stats.namespaces} namespaces.`, "ok");
          changed();
        })
        .catch((problem) => toast(describeError(problem), "error"));
    }
  };
  useEffect(() => {
    if (!isDesktop) return;
    const stopMenu = desktop.listen<string>("menu", (id) => menuActions.current(id));
    const stopOpen = desktop.listen<string>("open-path", (path) => void openLocal(path));
    return () => {
      stopMenu();
      stopOpen();
    };
  }, [openLocal]);
  const createNamespace = useCallback(
    async (name: string, description?: string) => {
      if (!client) return;
      const info = await client.createNamespace(name, description);
      setNamespaces((list) => [...list, info].sort((a, b) => (a.name < b.name ? -1 : 1)));
      setNamespace(info.name);
      changed();
    },
    [client, setNamespace, changed],
  );
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirming({ ...options, resolve })), []);

  if (checking && !connection) {
    return (
      <div className="connect">
        <div className="connect-art" aria-hidden="true" />
        <div className="loading">
          <Logo size={48} />
          <span className="muted">Connecting…</span>
        </div>
      </div>
    );
  }
  if ((!connection || !client) && isDesktop) {
    return <StartView error={error} busy={checking} saved={loadConnection()} onOpen={(path) => void openLocal(path)} onConnect={(candidate, remember) => void connect(candidate, remember)} />;
  }
  if (!connection || !client) {
    return (
      <ConnectScreen
        initial={{ url: defaultUrl(), token: "" }}
        error={error}
        onConnect={(candidate, remember) => void connect(candidate, remember)}
      />
    );
  }

  const studio: Studio = {
    client,
    connection,
    supports: (capability) => about?.capabilities.includes(capability) ?? false,
    namespace: current,
    setNamespace,
    namespaces,
    createNamespace,
    schema,
    revision,
    changed,
    toast,
    confirm,
    newNode: (options = {}) => setNodeForm(options),
    newEdge: (options = {}) => setEdgeForm(options),
  };
  const view = route.view;
  const layout = view === "graph" ? "main canvas-view" : view === "scripts" || view === "explorer" ? "main full" : "main";
  const closeConfirm = (ok: boolean) => {
    confirming?.resolve(ok);
    setConfirming(null);
  };
  const disconnect = () => {
    if (local) {
      void closeLocal();
      return;
    }
    if (connection.refresh) void clientFor(connection).signOut().catch(() => undefined);
    forgetConnection();
    setConnection(null);
  };
  const openExternal = (url: string) => {
    if (isDesktop) void desktop.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  const editEnabled = (command: string) => {
    try {
      return document.queryCommandEnabled(command);
    } catch {
      return false;
    }
  };
  const edit = (command: string) => {
    try {
      document.execCommand(command);
    } catch {
      // Browser editing commands are intentionally unavailable outside an editor.
    }
  };
  const newScript = () => {
    go("scripts");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("grafeno:query-new")), 50);
  };
  const query = (name: "run" | "run-all" | "stop") => window.dispatchEvent(new CustomEvent(`grafeno:query-${name}`));
  const resetLayout = () => {
    setCollapsed(false);
    setSidebarWidth(224);
    writeSetting("grafeno.studio.collapsed", "0");
    writeSetting("grafeno.studio.sidebar-width", "224");
    window.dispatchEvent(new CustomEvent("grafeno:layout-reset"));
  };
  const menus: ApplicationMenuDefinition[] = [
    {
      label: "File",
      groups: [
        [
          { label: "New node…", run: () => setNodeForm({ onCreated: (id) => go("explorer", id) }) },
          { label: "New fact…", run: () => setEdgeForm({}) },
          { label: "New script", run: newScript, shortcut: "Ctrl+Shift+N" },
        ],
        ...(isDesktop
          ? [[
              { label: "New database…", run: () => void desktop.pickDatabase(true).then((path) => { if (path) void openLocal(path); }) },
              { label: "Open database…", run: () => void desktop.pickDatabase(false).then((path) => { if (path) void openLocal(path); }), shortcut: "Ctrl+O" },
            ]]
          : []),
        [
          { label: "Close tab", run: () => closeDocument(activeDocument), shortcut: "Ctrl+W" },
          { label: local ? "Close database" : connection.user ? "Sign out" : "Disconnect", run: disconnect, danger: true },
        ],
      ],
    },
    {
      label: "Edit",
      groups: [
        [
          { label: "Undo", run: () => edit("undo"), shortcut: "Ctrl+Z", disabled: () => !editEnabled("undo") },
          { label: "Redo", run: () => edit("redo"), shortcut: "Ctrl+Y", disabled: () => !editEnabled("redo") },
        ],
        [
          { label: "Cut", run: () => edit("cut"), shortcut: "Ctrl+X", disabled: () => !editEnabled("cut") },
          { label: "Copy", run: () => edit("copy"), shortcut: "Ctrl+C", disabled: () => !editEnabled("copy") },
          { label: "Paste", run: () => edit("paste"), shortcut: "Ctrl+V", disabled: () => !editEnabled("paste") },
        ],
        [{ label: "Find or jump to…", run: () => setPalette(true), shortcut: "Ctrl+K" }],
      ],
    },
    {
      label: "View",
      groups: [
        [
          {
            label: collapsed ? "Show namespace explorer" : "Hide namespace explorer",
            run: () => {
              setCollapsed((value) => !value);
              writeSetting("grafeno.studio.collapsed", collapsed ? "0" : "1");
            },
          },
          { label: "Command palette…", run: () => setPalette(true), shortcut: "Ctrl+K" },
          { label: "Reset layout", run: resetLayout },
        ],
        [
          { label: "Light theme", run: () => setTheme("light"), checked: theme === "light" },
          { label: "Dark theme", run: () => setTheme("dark"), checked: theme === "dark" },
          { label: "System theme", run: () => setTheme("system"), checked: theme === "system" },
        ],
        ...(document.fullscreenEnabled
          ? [[{ label: document.fullscreenElement ? "Exit fullscreen" : "Fullscreen", run: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()), shortcut: "F11" }]]
          : []),
      ],
    },
    {
      label: "Query",
      groups: [
        [{ label: "New query", run: newScript, shortcut: "Ctrl+Shift+N" }],
        [
          { label: "Run query", run: () => query("run"), shortcut: "Ctrl+Enter", disabled: view !== "scripts" || queryRunning },
          { label: "Run all", run: () => query("run-all"), shortcut: "F5", disabled: view !== "scripts" || queryRunning },
          { label: "Stop query", run: () => query("stop"), disabled: view !== "scripts" || !queryRunning },
        ],
      ],
    },
    {
      label: "Tools",
      groups: [[
        { label: "Search", run: () => go("search") },
        { label: "Administration", run: () => go("admin") },
        ...(studio.supports("cluster") ? [{ label: "Cluster", run: () => go("cluster") }] : []),
        ...(studio.supports("roles") ? [{ label: "Access control", run: () => go("access") }] : []),
      ]],
    },
    {
      label: "Help",
      groups: [
        [
          { label: "Grafeno documentation", run: () => openExternal("https://github.com/grafenodb/grafeno/tree/main/docs") },
          { label: "Query language reference", run: () => openExternal("https://github.com/grafenodb/grafeno/blob/main/docs/query-language.md") },
        ],
        [
          { label: "Keyboard shortcuts", run: () => setShortcutsOpen(true) },
          { label: "About Grafeno Studio", run: () => setAboutOpen(true) },
        ],
      ],
    },
  ];

  return (
    <StudioContext.Provider value={studio}>
      <div
        className={collapsed ? "app collapsed" : "app"}
        aria-busy={checking}
        style={{ "--rail-open": `${sidebarWidth}px` } as CSSProperties}
      >
        <header className="topbar">
          <a className="topbar-brand" href="#/overview">
            <Logo size={30} />
            <span className="brand-text">
              Grafeno <span>Studio</span>
            </span>
          </a>
          <ApplicationMenus menus={menus} />
          <nav className="toolbar-nav" aria-label="Studio tools">
            {VIEWS.filter((item) => !item.needs || studio.supports(item.needs)).map((item) => (
              <a key={item.id} href={`#/${item.id}`} className={item.id === view ? "toolbar-item active" : "toolbar-item"} title={item.hint}>
                <Icon name={item.icon} size={20} />
                <span>{item.title}</span>
              </a>
            ))}
          </nav>
        </header>
        <aside className="sidebar">
          <div className="sidebar-pane-heading">
            <div>
              <strong>Namespaces</strong>
              <span>Graph workspaces</span>
            </div>
            <span className="sidebar-count">{namespaces.length}</span>
          </div>
          <button className="sidebar-search" onClick={() => setPalette(true)}>
            <Icon name="search" size={15} />
            <span>Search or jump to…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="sidebar-tree">
            {namespaces.map((info) => {
              const expanded = expandedNamespaces.has(info.name);
              return (
                <div className="sidebar-tree-group" key={info.name}>
                  <button
                    className={info.name === current ? "sidebar-tree-item active" : "sidebar-tree-item"}
                    onClick={() => {
                      setNamespace(info.name);
                      setExpandedNamespaces((value) => {
                        const next = new Set(value);
                        if (expanded) next.delete(info.name);
                        else next.add(info.name);
                        return next;
                      });
                    }}
                    title={info.description || info.name}
                    aria-expanded={expanded}
                  >
                    <Icon name={expanded ? "chevronDown" : "chevronRight"} size={13} />
                    <Icon name="explorer" size={15} />
                    <span>
                      <strong>{info.name}</strong>
                      <small>{info.nodes.toLocaleString()} nodes · {info.edges.toLocaleString()} facts</small>
                    </span>
                  </button>
                  {expanded && (
                    <div className="sidebar-tree-children" role="group" aria-label={`${info.name} tools`}>
                      <a href="#/explorer" onClick={() => setNamespace(info.name)} className={info.name === current && view === "explorer" ? "active" : ""}>
                        <Icon name="node" size={13} /> Nodes <span>{info.nodes.toLocaleString()}</span>
                      </a>
                      <a href="#/graph" onClick={() => setNamespace(info.name)} className={info.name === current && view === "graph" ? "active" : ""}>
                        <Icon name="link" size={13} /> Facts <span>{info.edges.toLocaleString()}</span>
                      </a>
                      <a href="#/scripts" onClick={() => setNamespace(info.name)} className={info.name === current && view === "scripts" ? "active" : ""}>
                        <Icon name="scripts" size={13} /> Query
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
            {namespaces.length === 0 && <p className="muted small sidebar-empty">No namespaces yet.</p>}
          </div>
          <div className="sidebar-foot">
            <div className="theme-switch" role="group" aria-label="Theme">
              {(["dark", "light", "system"] as Theme[]).map((option) => (
                <button key={option} className={theme === option ? "active" : ""} onClick={() => setTheme(option)} title={`${option} theme`}>
                  <Icon name={option === "light" ? "sun" : option === "dark" ? "moon" : "monitor"} size={14} />
                </button>
              ))}
            </div>
            <button
              className="ghost nav-item collapse-button"
              onClick={() => {
                setCollapsed((value) => !value);
                writeSetting("grafeno.studio.collapsed", collapsed ? "0" : "1");
              }}
              title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
              aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            >
              <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={18} />
              <span>{collapsed ? "Expand" : "Collapse"}</span>
            </button>
          </div>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="Resize namespace explorer"
            aria-orientation="vertical"
            aria-valuemin={184}
            aria-valuemax={360}
            aria-valuenow={sidebarWidth}
            tabIndex={collapsed ? -1 : 0}
            onPointerDown={resizeSidebar}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
              event.preventDefault();
              const next = event.key === "Home" ? 224 : Math.min(360, Math.max(184, sidebarWidth + (event.key === "ArrowRight" ? 12 : -12)));
              setSidebarWidth(next);
              writeSetting("grafeno.studio.sidebar-width", String(next));
            }}
          />
        </aside>
        <div className="workspace-tabs" role="tablist" aria-label="Open workspace documents">
          {documents.map((document) => {
            const definition = VIEWS.find((item) => item.id === document.view) ?? VIEWS[0];
            const selected = document.id === activeDocument;
            const title = document.param && document.view === "explorer"
              ? `Node ${document.param.slice(0, 8)}`
              : definition.title;
            return (
              <div key={document.id} className={selected ? "workspace-tab active" : "workspace-tab"}>
                <button
                  className="workspace-tab-target"
                  role="tab"
                  aria-selected={selected}
                  title={`${title} — ${document.namespace}`}
                  onClick={() => activateDocument(document)}
                  onAuxClick={(event) => event.button === 1 && closeDocument(document.id)}
                >
                  <Icon name={definition.icon} size={14} />
                  <span>{title}</span>
                  <small>{document.namespace}</small>
                </button>
                <button className="workspace-tab-close" aria-label={`Close ${title}`} title="Close (Ctrl+W)" onClick={() => closeDocument(document.id)}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <main className={layout} key={`${connection.url}-${current}-${view}`}>
          {view === "overview" && <OverviewView />}
          {view === "explorer" && <ExplorerView selected={route.param} />}
          {view === "graph" && <GraphView seed={route.param} />}
          {view === "scripts" && <ScriptsView />}
          {view === "search" && <SearchView />}
          {view === "memory" && <MemoryView />}
          {view === "admin" && <AdminView />}
          {view === "cluster" && <ClusterView />}
          {view === "access" && <AccessView />}
        </main>
        <footer className="statusbar">
          <span className="status-connection"><span className="live-dot" /> Connected</span>
          <span className="status-divider" />
          <span className="ellipsis" title={local ? local.path : connection.url}>{local ? local.name : connection.url.replace(/^https?:\/\//, "")}</span>
          <span className="status-divider" />
          <span className="mono">{current}</span>
          <span className="spacer" />
          {currentInfo && <span>{currentInfo.nodes.toLocaleString()} nodes · {currentInfo.edges.toLocaleString()} facts</span>}
          <span className="status-divider" />
          <span className="mono">Grafeno {version}</span>
        </footer>
      </div>

      {nodeForm && <NodeForm options={nodeForm} onClose={() => setNodeForm(null)} />}
      {edgeForm && <EdgeForm options={edgeForm} onClose={() => setEdgeForm(null)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {shortcutsOpen && (
        <Modal title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)}>
          <div className="shortcut-list">
            <span>Command palette</span><kbd>Ctrl K</kbd>
            <span>Close active tab</span><kbd>Ctrl W</kbd>
            <span>Previous / next tab</span><kbd>Ctrl PageUp / PageDown</kbd>
            <span>Run query</span><kbd>Ctrl Enter</kbd>
            <span>Run all queries</span><kbd>F5</kbd>
          </div>
        </Modal>
      )}
      {aboutOpen && (
        <Modal title="About Grafeno Studio" onClose={() => setAboutOpen(false)}>
          <div className="about-studio">
            <Logo size={44} />
            <div><strong>Grafeno Studio</strong><p className="muted">Graph Database IDE · Engine {version}</p></div>
          </div>
        </Modal>
      )}
      {confirming && (
        <Modal
          title={confirming.title}
          onClose={() => closeConfirm(false)}
          footer={
            <>
              <div className="spacer" />
              <button onClick={() => closeConfirm(false)}>Cancel</button>
              <button className={confirming.danger ? "danger solid" : "primary"} autoFocus onClick={() => closeConfirm(true)}>
                {confirming.confirm ?? "Confirm"}
              </button>
            </>
          }
        >
          {confirming.message && <p className="muted">{confirming.message}</p>}
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.kind}`} onClick={() => setToasts((list) => list.filter((t) => t.id !== item.id))}>
            <Icon name={item.kind === "error" ? "x" : item.kind === "ok" ? "check" : "command"} size={15} />
            {item.message}
          </div>
        ))}
      </div>
    </StudioContext.Provider>
  );
}
