import { useEffect, useRef, useState } from "react";

import {
  type About,
  type Connection,
  LOCAL_SERVICE,
  type SavedServer,
  describeError,
  findLocalService,
  forgetServer,
  loadServers,
  memberUrls,
  saveServer,
} from "../api.ts";
import { type EngineInfo, INSTALL_URL, type RecentDatabase, desktop } from "../desktop.ts";
import { Icon, Logo } from "../icons.tsx";

/**
 * The desktop app's start, for one window: open or create a database file
 * (served by the Grafeno engine installed on this computer), or connect to
 * a Grafeno server: the local service, a saved one, or a cluster by its
 * members. Each window has its own connection.
 */
export function StartView({
  error,
  busy,
  saved,
  onOpen,
  onConnect,
}: {
  error: string | null;
  busy: boolean;
  saved: Connection | null;
  onOpen: (path: string) => void;
  onConnect: (connection: Connection, remember: boolean) => void;
}) {
  const active = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const unavailable = busy || recovering;
  const [recent, setRecent] = useState<RecentDatabase[]>([]);
  // undefined while looking; null when none is installed.
  const [engine, setEngine] = useState<EngineInfo | null | undefined>(undefined);
  const [service, setService] = useState<About | null>(null);
  const [servers, setServers] = useState<SavedServer[]>(() => loadServers());
  const [name, setName] = useState("");
  const [url, setUrl] = useState(saved?.url ?? LOCAL_SERVICE);
  const [token, setToken] = useState(saved?.token ?? "");
  const [remember, setRemember] = useState(saved !== null);

  const refresh = () => void desktop.recent().then(setRecent).catch(() => setRecent([]));
  const lookForEngine = () => void desktop.engine().then(setEngine).catch(() => setEngine(null));
  useEffect(() => {
    active.current = true;
    refresh();
    lookForEngine();
    void findLocalService().then((found) => active.current && setService(found));
    return () => { active.current = false; };
  }, []);

  const noEngine = engine === null;
  const files = unavailable || engine == null;

  const pick = async (create: boolean) => {
    const path = await desktop.pickDatabase(create);
    if (path) onOpen(path);
  };

  const recover = async () => {
    setRecovering(true);
    setRecoveryError(null);
    try {
      const source = await desktop.pickOpen(["redb", "grafeno"]);
      if (!source) return;
      const path = await desktop.pickSave("recovered.redb", "redb");
      if (!path) return;
      await desktop.restoreTo(source, path);
      // A pending recovery does not replace a database opened from the menu.
      if (active.current) onOpen(path);
    } catch (problem) {
      if (active.current) setRecoveryError(describeError(problem));
    } finally {
      if (active.current) setRecovering(false);
    }
  };

  const connectTo = (server: { name?: string; url: string; token: string }, keep: boolean) => {
    const clean = memberUrls(server.url).join(",");
    if (keep) setServers(saveServer({ name: server.name?.trim() || clean, url: clean, token: server.token }));
    onConnect({ url: clean, token: server.token.trim() }, keep);
  };

  return (
    <div className="connect start">
      <div className="connect-art" aria-hidden="true" />
      <div className="start-card">
        <div className="connect-brand">
          <Logo size={60} />
          <div>
            <h1>Grafeno</h1>
            <p className="muted">The graph engine for agent memory and knowledge.</p>
          </div>
          <button className="ghost" style={{ marginLeft: "auto" }} title="Another window, with its own connection (Ctrl+Shift+N)" onClick={() => void desktop.newWindow()}>
            <Icon name="plus" /> New window
          </button>
        </div>
        {(recoveryError || error) && <div className="error">{recoveryError || error}</div>}
        <div className="start-grid">
          <section className="stack tight">
            <h3>On this computer</h3>
            {noEngine ? (
              <div className="notice stack tight">
                <strong>No Grafeno engine is installed.</strong>
                <span className="small">
                  Database files open with the engine installed on this computer, as pgAdmin works with PostgreSQL.
                  Install it, then look again.
                </span>
                <div className="row">
                  <button className="primary" onClick={() => void desktop.openExternal(INSTALL_URL)}>
                    <Icon name="link" /> Install the engine
                  </button>
                  <button onClick={lookForEngine}>Look again</button>
                </div>
              </div>
            ) : (
              <p className="muted small">
                A database file, served by the installed engine while it is open, for this window only (a loopback port
                and a token of its own).{" "}
                {engine && <span className="mono" title={engine.path}>{engine.version}</span>}
              </p>
            )}
            <div className="row">
              <button className="primary" disabled={files} onClick={() => void pick(true)}>
                <Icon name="plus" /> New database…
              </button>
              <button disabled={files} onClick={() => void pick(false)}>
                <Icon name="folder" /> Open…
              </button>
            </div>
            <button disabled={files} onClick={() => void recover()}>
              {recovering ? "Checking the backup…" : "Recover a backup…"}
            </button>
            <p className="muted small">Into a new file: the backup stays as it is, and an existing file is never replaced.</p>
            <div className="recent-list">
              {recent.length === 0 && <div className="muted small">No recent databases yet.</div>}
              {recent.map((item) => (
                <div key={item.path} className={item.exists ? "recent-item" : "recent-item missing"}>
                  <button className="recent-open" disabled={files || !item.exists} onClick={() => onOpen(item.path)} title={item.path}>
                    <span className="ns-dot" />
                    <span className="recent-text">
                      <strong>{item.name}</strong>
                      <span className="muted small mono ellipsis">{item.exists ? item.path : `missing: ${item.path}`}</span>
                    </span>
                  </button>
                  <button
                    className="ghost icon-button"
                    title="Forget it (the file stays)"
                    onClick={() => void desktop.forgetRecent(item.path).then(refresh)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="stack tight">
            <h3>A Grafeno server</h3>
            {service && (
              <div className="recent-item">
                <button className="recent-open" disabled={unavailable} onClick={() => { setUrl(LOCAL_SERVICE); setName("This computer"); }} title={LOCAL_SERVICE}>
                  <span className="ns-dot" />
                  <span className="recent-text">
                    <strong>The Grafeno service on this computer</strong>
                    <span className="muted small mono ellipsis">{LOCAL_SERVICE} · {service.version}</span>
                  </span>
                </button>
              </div>
            )}
            {servers.length > 0 && (
              <div className="recent-list">
                {servers.map((server) => (
                  <div key={server.url} className="recent-item">
                    <button className="recent-open" disabled={unavailable} onClick={() => connectTo(server, true)} title={server.url}>
                      <span className="ns-dot" />
                      <span className="recent-text">
                        <strong>{server.name}</strong>
                        <span className="muted small mono ellipsis">
                          {memberUrls(server.url).length > 1 ? `cluster of ${memberUrls(server.url).length}: ` : ""}
                          {server.url}
                        </span>
                      </span>
                    </button>
                    <button className="ghost icon-button" title="Forget this server" onClick={() => setServers(forgetServer(server.url))}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              className="stack tight"
              onSubmit={(event) => {
                event.preventDefault();
                connectTo({ name, url, token }, remember);
              }}
            >
              <label className="field">
                Name <span className="hint">optional, for the list</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" />
              </label>
              <label className="field">
                Address <span className="hint">a cluster: its members, separated by commas</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:7810" required />
              </label>
              <label className="field">
                Token or key <span className="hint">or sign in after connecting</span>
                <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
              </label>
              <label className="check small">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Keep it in the list
              </label>
              <button type="submit" disabled={unavailable}>
                <Icon name="link" /> Connect
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
