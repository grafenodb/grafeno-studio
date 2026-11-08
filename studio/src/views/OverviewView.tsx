import { useEffect, useState } from "react";

import { describeError, formatTime, go, labelColor } from "../api.ts";
import { Icon, type IconName } from "../icons.tsx";
import { InspectorPanel } from "../components/InspectorPanel.tsx";
import { useStudio } from "../context.ts";
import type { NamespaceStats } from "../../../client/src/index.ts";

function Bars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries[0]?.[1] ?? 1;
  if (entries.length === 0) return <div className="muted small">None.</div>;
  return (
    <div className="overview-bars">
      {entries.map(([label, count]) => (
        <div className="overview-bar-row" key={label}>
          <span className="dot" style={{ background: labelColor(label) }} />
          <span className="overview-bar-label" title={label}>{label}</span>
          <span className="mono overview-bar-count">{count.toLocaleString()}</span>
          <span className="overview-bar-track" aria-hidden="true">
            <span style={{ width: `${(count / top) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function OverviewView() {
  const { client, namespace, namespaces, setNamespace, revision, newNode, newEdge } = useStudio();
  const [stats, setStats] = useState<NamespaceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client.namespace(namespace).stats().then(setStats).catch((e) => setError(describeError(e)));
  }, [client, namespace, revision]);

  return (
    <div className="stack overview-page">
      <div className="page-head overview-head">
        <div className="overview-heading">
          <h1>Overview</h1>
          <p className="muted">{namespace}</p>
        </div>
        <div className="row overview-actions">
          <button onClick={() => newNode({ onCreated: (id) => go("explorer", id) })}>
            <Icon name="node" /> New node
          </button>
          <button onClick={() => newEdge()}>
            <Icon name="link" /> New fact
          </button>
          <button className="primary" onClick={() => go("scripts")}>
            <Icon name="scripts" /> Open scripts
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="overview-grid">
        <section className="panel overview-namespaces">
          <header className="panel-heading">
            <div>
              <h2>Namespaces</h2>
            </div>
            <span className="panel-count">{namespaces.length}</span>
          </header>
          {namespaces.length === 0 && (
            <p className="muted small">
              The database is empty. Create a node with <strong>New node</strong>, or run a script in{" "}
              <a href="#/scripts">Scripts</a>, such as <code>CREATE (n:Note {"{"}title: 'Hello'{"}"});</code>
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Nodes</th>
                  <th>Facts</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {namespaces.map((info) => (
                  <tr
                    key={info.name}
                    className={info.name === namespace ? "clickable selected" : "clickable"}
                    onClick={() => setNamespace(info.name)}
                  >
                    <td className="namespace-name" title={info.name}>
                      <strong>{info.name}</strong>
                      {info.description && <div className="muted small">{info.description}</div>}
                    </td>
                    <td className="mono">{info.nodes === 0 ? <span className="muted">empty</span> : info.nodes}</td>
                    <td className="mono">{info.edges}</td>
                    <td className="muted small">{formatTime(info.created_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {stats && (
          <InspectorPanel title="Namespace details" subtitle={namespace} className="overview-composition">
      {stats && (
        <section className="property-list" aria-label="Namespace totals">
          {[
            ["Nodes", stats.nodes, "node"],
            ["Facts", stats.edges, "link"],
            ["Texts", stats.texts, "file"],
            ["Vectors", stats.vectors, "graph"],
            ["Dimension", stats.vector_dimension ?? "—", "target"],
          ].map(([label, value, icon], index) => (
            <article key={label} className={index < 2 ? "metric primary-metric" : "metric"}>
              <Icon name={icon as IconName} size={16} />
              <div>
                <span className="metric-label">{label}</span>
                <strong className="metric-value">{typeof value === "number" ? value.toLocaleString() : value}</strong>
              </div>
            </article>
          ))}
        </section>
      )}
            <div className="composition-grid">
              <section>
                <h3>Node labels</h3>
                <Bars counts={stats.node_labels} />
              </section>
              <section>
                <h3>Fact types</h3>
                <Bars counts={stats.edge_labels} />
              </section>
            </div>
          </InspectorPanel>
        )}
      </div>
    </div>
  );
}
