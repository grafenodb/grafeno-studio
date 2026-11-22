import { useCallback, useEffect, useState } from "react";
import type { HyperEdge, Node } from "@grafenodb/client";

import { describeError, displayName, formatTime } from "../api.ts";
import { useStudio } from "../context.ts";
import { Icon } from "../icons.tsx";
import { useTask } from "../ui.tsx";

/** Names of the nodes these hyperedges name, read in one request. */
export function useParticipantNames(edges: HyperEdge[]): Map<string, Node> {
  const { client, namespace } = useStudio();
  const [names, setNames] = useState(new Map<string, Node>());
  const ids = [...new Set(edges.flatMap((edge) => edge.participants.map((p) => p.node)))].sort();
  const key = ids.join(",");
  useEffect(() => {
    if (ids.length === 0) {
      setNames(new Map());
      return;
    }
    let current = true;
    client
      .namespace(namespace)
      .readMany({ nodes: ids })
      .then((found) => {
        if (!current) return;
        const map = new Map<string, Node>();
        for (const node of found.nodes) if (node) map.set(node.id, node);
        setNames(map);
      })
      .catch(() => current && setNames(new Map()));
    return () => {
      current = false;
    };
    // `key` stands for `ids`.
  }, [client, namespace, key]);
  return names;
}

/** One hyperedge: its participants in their roles, properties, time and actions. */
export function HyperedgeCard({
  edge,
  names,
  focus,
  onChanged,
}: {
  edge: HyperEdge;
  names: Map<string, Node>;
  /** A node shown as "this node" rather than linked. */
  focus?: string;
  onChanged?: () => void;
}) {
  const { client, namespace, changed, confirm, toast } = useStudio();
  const graph = client.namespace(namespace);
  const { busy, run } = useTask();
  const now = Date.now() * 1000;
  const ended = edge.valid_to !== null && edge.valid_to <= now;
  const retracted = edge.expired_at !== null;

  const act = async (action: "invalidate" | "retract" | "delete") => {
    if (action === "delete") {
      const ok = await confirm({
        title: `Delete this ${edge.label}?`,
        message: "Its history is lost; to keep it, end it instead. Its participants stay.",
        confirm: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    if (action === "retract") {
      const ok = await confirm({
        title: `Retract this ${edge.label}?`,
        message: "It was a mistake. It stays visible to KNOWN AT queries.",
        confirm: "Retract",
      });
      if (!ok) return;
    }
    await run(async () => {
      if (action === "delete") await graph.deleteHyperedge(edge.id);
      else if (action === "retract") await graph.retractHyperedge(edge.id);
      else await graph.invalidateHyperedge(edge.id, new Date().toISOString());
      toast(action === "delete" ? "Hyperedge deleted." : action === "retract" ? "Hyperedge retracted." : "Hyperedge ended today.", "ok");
      changed();
      onChanged?.();
    });
  };

  return (
    <div className={ended || retracted ? "hyperedge ended" : "hyperedge"}>
      <div className="hyperedge-head">
        <span className="mono accent">{edge.label}</span>
        <span className="faint small mono">{edge.id.slice(-8)}</span>
        {retracted && <span className="badge">retracted</span>}
        <span className="spacer" />
        <span className="fact-tools">
          {!ended && !retracted && (
            <button className="ghost icon-button" title="It stopped being true today (keeps its history)" disabled={busy} onClick={() => void act("invalidate")}>
              <Icon name="clock" size={14} />
            </button>
          )}
          {!retracted && (
            <button className="ghost icon-button" title="Retract: it was a mistake" disabled={busy} onClick={() => void act("retract")}>
              <Icon name="ban" size={14} />
            </button>
          )}
          <button className="ghost icon-button danger" title="Delete" disabled={busy} onClick={() => void act("delete")}>
            <Icon name="trash" size={14} />
          </button>
        </span>
      </div>
      <ul className="participants">
        {edge.participants.map((participant) => {
          const node = names.get(participant.node);
          const name = node ? displayName(node) : participant.node.slice(-8);
          return (
            <li key={`${participant.node}/${participant.role ?? ""}`}>
              <span className="muted small role">{participant.role ?? "—"}</span>
              {participant.node === focus ? <strong>{name}</strong> : <a href={`#/explorer/${participant.node}`}>{name}</a>}
            </li>
          );
        })}
      </ul>
      {Object.keys(edge.props).length > 0 && <pre className="small">{JSON.stringify(edge.props, null, 2)}</pre>}
      {(edge.valid_from !== null || edge.valid_to !== null) && (
        <div className="muted small">
          {edge.valid_from !== null ? formatTime(edge.valid_from).slice(0, 10) : "…"} → {edge.valid_to !== null ? formatTime(edge.valid_to).slice(0, 10) : "now"}
        </div>
      )}
    </div>
  );
}

/** The hyperedges a node takes part in, for its detail. */
export function NodeHyperedges({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const { client, namespace, revision, supports } = useStudio();
  const [edges, setEdges] = useState<HyperEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const names = useParticipantNames(edges);
  const enabled = supports("hyperedges");

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setEdges(await client.namespace(namespace).nodeHyperedges(id));
      setError(null);
    } catch (problem) {
      setError(describeError(problem));
    }
  }, [client, namespace, id, enabled]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  if (!enabled || (edges.length === 0 && !error)) return null;
  return (
    <section>
      <div className="section-head">
        <h3>
          Hyperedges <span className="muted">{edges.length}</span>
        </h3>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="hyperedge-list">
        {edges.map((edge) => (
          <HyperedgeCard key={edge.id} edge={edge} names={names} focus={id} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}
