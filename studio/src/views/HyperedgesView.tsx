import { useCallback, useEffect, useMemo, useState } from "react";
import type { HyperEdge } from "@grafenodb/client";

import { describeError, displayName, go } from "../api.ts";
import { HyperedgeCard, useParticipantNames } from "../components/Hyperedges.tsx";
import { useStudio } from "../context.ts";
import { Icon } from "../icons.tsx";
import { Empty } from "../ui.tsx";

const PAGE = 100;

/** Facts that relate several nodes, each in a role: a page at a time. */
export function HyperedgesView({ selected }: { selected?: string }) {
  const { client, namespace, revision } = useStudio();
  const [label, setLabel] = useState("");
  const [edges, setEdges] = useState<HyperEdge[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);

  const loadPage = useCallback(
    async (after?: string) => {
      try {
        const page = await client.namespace(namespace).listHyperedges({ label: label || undefined, after, limit: PAGE });
        setEdges((current) => (after ? [...current, ...page.items] : page.items));
        setNext(page.next);
        setError(null);
        // The labels seen so far, to filter by.
        setLabels((known) => [...new Set([...known, ...page.items.map((edge) => edge.label)])].sort());
      } catch (problem) {
        setError(describeError(problem));
      }
    },
    [client, namespace, label],
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage, revision]);

  const shown = useMemo(() => edges.filter((edge) => edge.expired_at === null), [edges]);
  const names = useParticipantNames(shown);
  const chosen = shown.find((edge) => edge.id === selected);

  if (shown.length === 0 && !label && !error) {
    return (
      <div className="page">
        <Empty title={`No hyperedges in “${namespace}”`}>
          A hyperedge relates two or more nodes at once, each in a role: who proposed a decision, who reviewed it, the task it is about. Create one in Scripts with{" "}
          <code>MATCH (a {"{"}name: 'Ana'{"}"}), (t:Task) CREATE HYPEREDGE :decision [(a) AS proposer, (t) AS subject]</code>.
        </Empty>
      </div>
    );
  }

  return (
    <div className="explorer">
      <section className="explorer-list">
        <div className="list-tools">
          <div className="input-icon">
            <Icon name="filter" />
            <input value={label} onChange={(event) => setLabel(event.target.value.trim())} placeholder="Filter by label…" />
          </div>
        </div>
        <div className="chips scroll">
          <button className={label === "" ? "chip active" : "chip"} onClick={() => setLabel("")}>
            All
          </button>
          {labels.map((name) => (
            <button key={name} className={label === name ? "chip active" : "chip"} onClick={() => setLabel(label === name ? "" : name)}>
              {name}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="node-list">
          {shown.length === 0 && <div className="muted small pad">No hyperedges{label ? ` labeled ${label}` : ""}.</div>}
          {shown.map((edge) => (
            <div key={edge.id} className={edge.id === selected ? "node-row selected" : "node-row"} onClick={() => go("hyperedges", edge.id)}>
              <span className="hex hyper" />
              <span className="node-row-text">
                <span className="node-name">{edge.label}</span>
                <span className="faint small">
                  {edge.participants
                    .slice(0, 4)
                    .map((p) => {
                      const node = names.get(p.node);
                      return `${p.role ? `${p.role}: ` : ""}${node ? displayName(node) : p.node.slice(-8)}`;
                    })
                    .join(" · ")}
                  {edge.participants.length > 4 ? ` · +${edge.participants.length - 4}` : ""}
                </span>
              </span>
            </div>
          ))}
          {next && (
            <button className="ghost load-more" onClick={() => void loadPage(next)}>
              Load more
            </button>
          )}
        </div>
      </section>
      <section className="explorer-detail">
        {chosen ? (
          <div className="detail">
            <HyperedgeCard edge={chosen} names={names} onChanged={() => go("hyperedges")} />
          </div>
        ) : (
          <Empty title="Choose a hyperedge">Its participants in their roles, its properties and its time appear here.</Empty>
        )}
      </section>
    </div>
  );
}
