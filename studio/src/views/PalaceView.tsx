import { useCallback, useEffect, useMemo, useState } from "react";

import { describeError } from "../api.ts";
import { useStudio } from "../context.ts";
import { Empty } from "../ui.tsx";
import { parseSteps } from "../palace.ts";

// What the palace tools answer (`POST /v1/{ns}/tools/{name}`), as far as
// this view reads it. The tools write nothing here: every call is a read.

interface Door {
  room: string;
  name: string;
  path: string;
}

interface AnchoredMemory {
  id: string;
  name: string;
  labels: string[];
  note?: string;
}

interface LocusMap {
  id: string;
  name: string;
  position: number;
  count: number;
  /** Absent when nothing is anchored there, or the map was not asked for them. */
  memories?: AnchoredMemory[];
}

interface RoomMap {
  id: string;
  name: string;
  topic?: string;
  description?: string;
  memories: number;
  loci: LocusMap[];
  /** Absent when it has none. */
  doors?: Door[];
}

interface PalaceMap {
  id: string;
  name: string;
  description?: string;
  rooms: RoomMap[];
}

interface Hop {
  edge: string;
  label: string;
  forward: boolean;
  node: string;
  name: string;
}

/** Empty lists are left out of the answer. */
interface Justification {
  sources?: string[];
  known: unknown;
  supported_by?: string[];
  contradicted_by?: string[];
  superseded_by?: string[];
  archived: boolean;
}

interface Reached {
  id: string;
  name: string;
  labels: string[];
  hops: number;
  relevance?: number;
  via?: Hop[];
  found_by: string;
  justification: Justification;
}

interface Walk {
  places: { id: string; kind: string; path: string; score: number }[];
  memories: Reached[];
  hint?: string;
}

interface Entered {
  context: string;
  tokens: number;
  tokens_estimated?: boolean;
  left_out: number;
  checkpoint?: { task: string; summary: string; next?: string[] } | null;
  hint?: string;
}

interface Item {
  id: string;
  kind: string;
  text: string;
  why: string;
}

interface Clash {
  kind: string;
  constraint: string;
  action: string;
  settled: boolean;
  new_fact: Item;
  old_fact: Item;
}

interface Reflection {
  scope: string;
  nothing: boolean;
  known: {
    memories: number;
    facts: number;
    memories_by_kind: Record<string, number>;
    by_evidence?: Record<string, number>;
    verified: Item[];
  };
  uncertain: Item[];
  unsupported?: Item[];
  conflicts: Clash[];
  stale: Item[];
  gaps: Item[];
  next: { what: string; how: string; about: string[] }[];
  totals: Record<string, number>;
  limits: { notes: string[] };
}

interface Proposal {
  kind: string;
  how: string;
  name?: string;
  room_name?: string;
  [key: string]: unknown;
}

interface Routes {
  from_name: string;
  routes: { nodes: string[]; hops: Hop[] }[];
  cut: boolean;
  hint?: string;
}

type Tab = "enter" | "map" | "reflect";

function MemoryLink({ id, name }: { id: string; name: string }) {
  return (
    <a href={`#/explorer/${id}`} title={id}>
      {name}
    </a>
  );
}

function Way({ hops }: { hops?: Hop[] }) {
  if (!hops?.length) return null;
  return (
    <span className="muted small mono">
      {hops.map((hop, index) => (
        <span key={`${hop.edge}-${index}`}>
          {hop.forward ? ` -${hop.label}→ ` : ` ←${hop.label}- `}
          {hop.name}
        </span>
      ))}
    </span>
  );
}

function Section({ title, items, total }: { title: string; items?: Item[]; total?: number }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <h3 style={{ margin: 0 }}>
        {title} <span className="muted">({total ?? items.length})</span>
      </h3>
      {items.map((item) => (
        <div key={`${title}-${item.id}`} className="small">
          {item.kind === "fact" ? item.text : <MemoryLink id={item.id} name={item.text} />}{" "}
          <span className="muted">— {item.why}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The palaces of a namespace, read through the memory tools: rooms and their
 * loci, a room entered as an agent would at the start of a session, what is
 * known and not known there, walks from a topic, routes along relations, and
 * proposals to arrange a palace better. Nothing here writes.
 */
export function PalaceView() {
  const { client, namespace } = useStudio();
  const graph = useMemo(() => client.namespace(namespace), [client, namespace]);
  const [palaces, setPalaces] = useState<PalaceMap[] | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("enter");
  const [entered, setEntered] = useState<Entered | null>(null);
  const [roomMap, setRoomMap] = useState<RoomMap | null>(null);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [topic, setTopic] = useState("");
  const [walk, setWalk] = useState<Walk | null>(null);
  const [from, setFrom] = useState("");
  const [steps, setSteps] = useState("");
  const [routes, setRoutes] = useState<Routes | null>(null);
  const [review, setReview] = useState<{ palace: string; proposals: Proposal[]; hint?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (problem) {
      setError(describeError(problem));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setPalaces(null);
    setRoomId(null);
    setWalk(null);
    setRoutes(null);
    setReview(null);
    void run(async () => {
      const map = await graph.tool<{ palaces: PalaceMap[] }>("palace_map");
      setPalaces(map.palaces);
      const first = map.palaces.flatMap((palace) => palace.rooms)[0];
      if (first) setRoomId(first.id);
    });
  }, [graph, run]);

  useEffect(() => {
    if (!roomId) return;
    setEntered(null);
    setRoomMap(null);
    setReflection(null);
    void run(async () => {
      if (tab === "enter") setEntered(await graph.tool<Entered>("palace_enter", { room: roomId }));
      if (tab === "map") setRoomMap((await graph.tool<{ room: RoomMap }>("palace_map", { room: roomId })).room);
      if (tab === "reflect") setReflection(await graph.tool<Reflection>("palace_reflect", { room: roomId }));
    });
  }, [graph, roomId, tab, run]);

  const room = palaces?.flatMap((palace) => palace.rooms.map((item) => ({ ...item, palace }))).find((item) => item.id === roomId);

  if (palaces && palaces.length === 0) {
    return (
      <div className="stack">
        <h1>Palaces</h1>
        <Empty title={`No palace in “${namespace}” yet`}>
          A palace arranges memories that already exist into rooms and places, without copying them. Agents make them with the
          palace tools (palace_create, palace_create_room, palace_anchor); this view shows them.
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Palaces</h1>
      <p className="muted small" style={{ margin: 0 }}>
        Memories arranged into rooms and places, read as an agent reads them. Nothing here writes: agents arrange palaces with the
        palace tools.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(200px, 1fr) 3fr", alignItems: "start" }}>
        <div className="panel stack">
          <h2>Rooms</h2>
          {!palaces && <div className="muted small">Loading…</div>}
          {palaces?.map((palace) => (
            <div key={palace.id} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{palace.name}</strong>
                <button
                  className="small"
                  disabled={busy}
                  title="Proposals to arrange this palace better; nothing is applied"
                  onClick={() =>
                    void run(async () => {
                      const found = await graph.tool<{ proposals: Proposal[]; hint?: string }>("palace_review", { palace: palace.id });
                      setReview({ palace: palace.name, proposals: found.proposals, hint: found.hint });
                    })
                  }
                >
                  Review
                </button>
              </div>
              {palace.rooms.map((item) => (
                <button
                  key={item.id}
                  className={item.id === roomId ? "active" : ""}
                  style={{ justifyContent: "space-between", display: "flex" }}
                  onClick={() => setRoomId(item.id)}
                  title={item.topic ?? item.name}
                >
                  <span>{item.name}</span>
                  <span className="muted">{item.memories}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="panel stack">
          {room ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>
                  {room.palace.name} / {room.name}
                  {room.topic && <span className="muted small"> · {room.topic}</span>}
                </h2>
                <div className="segmented">
                  {(["enter", "map", "reflect"] as Tab[]).map((item) => (
                    <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
                      {item === "enter" ? "Enter" : item === "map" ? "Loci" : "Reflect"}
                    </button>
                  ))}
                </div>
              </div>
              {(room.doors?.length ?? 0) > 0 && (
                <div className="small muted">
                  Doors to:{" "}
                  {room.doors?.map((door, index) => (
                    <span key={door.room}>
                      {index > 0 && ", "}
                      <a href="#/palace" onClick={(event) => { event.preventDefault(); setRoomId(door.room); }}>{door.path}</a>
                    </span>
                  ))}
                </div>
              )}

              {tab === "enter" && entered && (
                <div className="stack">
                  <div className="muted small">
                    {entered.tokens} tokens{entered.tokens_estimated ? " (estimated)" : ""}
                    {entered.left_out > 0 && ` · ${entered.left_out} left out`}
                  </div>
                  <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{entered.context}</pre>
                  {entered.checkpoint ? (
                    <div className="small">
                      <strong>Checkpoint “{entered.checkpoint.task}”:</strong> {entered.checkpoint.summary}
                      {entered.checkpoint.next?.length ? <span className="muted"> · next: {entered.checkpoint.next.join("; ")}</span> : null}
                    </div>
                  ) : (
                    <div className="muted small">No checkpoint about this room.</div>
                  )}
                </div>
              )}

              {tab === "map" && roomMap && (
                <div className="stack">
                  {roomMap.loci.map((locus) => (
                    <div key={locus.id} className="stack" style={{ gap: 2 }}>
                      <strong className="small">
                        {locus.name} <span className="muted">({locus.count})</span>
                      </strong>
                      {(locus.memories ?? []).map((memory) => (
                        <div key={memory.id} className="small">
                          <MemoryLink id={memory.id} name={memory.name} />{" "}
                          <span className="muted">{memory.labels.join(", ")}</span>
                          {memory.note && <span className="muted"> — {memory.note}</span>}
                        </div>
                      ))}
                      {(locus.memories ?? []).length === 0 && <div className="muted small">Nothing here.</div>}
                    </div>
                  ))}
                </div>
              )}

              {tab === "reflect" && reflection && (
                <div className="stack">
                  {reflection.nothing ? (
                    <div className="muted small">Nothing is stored here.</div>
                  ) : (
                    <>
                      <div className="small">
                        {reflection.known.memories} memories, {reflection.known.facts} facts
                        {reflection.known.by_evidence && (
                          <span className="muted">
                            {" · "}
                            {Object.entries(reflection.known.by_evidence)
                              .map(([category, count]) => `${category}: ${count}`)
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                      <Section title="Verified" items={reflection.known.verified} total={reflection.totals.verified} />
                      <Section title="Uncertain" items={reflection.uncertain} total={reflection.totals.uncertain} />
                      <Section title="Stated with no source" items={reflection.unsupported} total={reflection.totals.unsupported} />
                      {reflection.conflicts.length > 0 && (
                        <div className="stack" style={{ gap: 4 }}>
                          <h3 style={{ margin: 0 }}>
                            Conflicts <span className="muted">({reflection.totals.conflicts})</span>
                          </h3>
                          {reflection.conflicts.map((clash) => (
                            <div key={`${clash.new_fact.id}-${clash.old_fact.id}`} className={`small ${clash.settled ? "" : "warn"}`}>
                              <strong>{clash.kind === "change" ? "Change" : "Contradiction"}</strong>: {clash.new_fact.text}{" "}
                              <span className="muted">against</span> {clash.old_fact.text}{" "}
                              <span className="muted">({clash.constraint}, {clash.action})</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <Section title="Out of date" items={reflection.stale} total={reflection.totals.stale} />
                      <Section title="Gaps" items={reflection.gaps} total={reflection.totals.gaps} />
                      {reflection.next.length > 0 && (
                        <div className="stack" style={{ gap: 4 }}>
                          <h3 style={{ margin: 0 }}>To check next</h3>
                          {reflection.next.map((step) => (
                            <div key={step.what} className="small">
                              {step.what} <span className="muted">— {step.how} ({step.about.length})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="muted small">{reflection.limits.notes.join(" ")}</div>
                </div>
              )}
              {busy && !entered && !roomMap && !reflection && <div className="muted small">Loading…</div>}
            </>
          ) : (
            <div className="muted small">Choose a room.</div>
          )}
        </div>
      </div>

      <div className="panel stack">
        <h2>Walk</h2>
        <p className="muted small" style={{ margin: 0 }}>
          From a topic to the memories around it: the rooms that match, what is anchored there, and what relations lead to. Each
          memory says how it was found and, apart, what supports it.
        </p>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!topic.trim()) return;
            void run(async () => setWalk(await graph.tool<Walk>("palace_walk", { topic, order: "relevance" })));
          }}
        >
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="A topic, in its words" style={{ flex: 1 }} />
          <button type="submit" disabled={busy || !topic.trim()}>Walk</button>
        </form>
        {walk && walk.memories.length === 0 && <div className="muted small">{walk.hint ?? "Nothing found."}</div>}
        {walk?.memories.map((memory) => (
          <div key={memory.id} className="stack" style={{ gap: 2 }}>
            <div className="small">
              <MemoryLink id={memory.id} name={memory.name} /> <span className="muted">{memory.labels.join(", ")}</span>
              {memory.hops > 0 && <Way hops={memory.via} />}
            </div>
            <div className="muted small">
              {memory.found_by}
              {(memory.justification.sources?.length ?? 0) > 0 && ` · ${memory.justification.sources?.length} sources`}
              {(memory.justification.supported_by?.length ?? 0) > 0 && ` · supported by ${memory.justification.supported_by?.length}`}
              {(memory.justification.contradicted_by?.length ?? 0) > 0 && ` · contradicted by ${memory.justification.contradicted_by?.length}`}
              {(memory.justification.superseded_by?.length ?? 0) > 0 && " · replaced by a newer one"}
            </div>
          </div>
        ))}
      </div>

      <div className="panel stack">
        <h2>Route</h2>
        <p className="muted small" style={{ margin: 0 }}>
          From a node, relations followed in order: <code>hit, depends_on*, &lt;maintains</code> goes from an incident to what it
          hit, everything that depends on, and who maintains the end. <code>*</code> follows a relation as far as it goes,{" "}
          <code>&lt;</code> against its arrow.
        </p>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => setRoutes(await graph.tool<Routes>("palace_route", { from: from.trim(), steps: parseSteps(steps) })));
          }}
        >
          <input value={from} onChange={(event) => setFrom(event.target.value)} placeholder="Id of the node to start from" className="mono" />
          <input value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="Steps: supersedes*" style={{ flex: 1 }} />
          <button type="submit" disabled={busy || !from.trim() || parseSteps(steps).length === 0}>Follow</button>
        </form>
        {routes && (
          <div className="stack" style={{ gap: 4 }}>
            {routes.routes.length === 0 && <div className="muted small">{routes.hint ?? "No route."}</div>}
            {routes.routes.map((route, index) => (
              <div key={index} className="small">
                {routes.from_name}
                <Way hops={route.hops} />
              </div>
            ))}
            {routes.cut && <div className="muted small">Cut short: more ways were left to follow.</div>}
          </div>
        )}
      </div>

      {review && (
        <div className="panel stack">
          <h2>
            Review of {review.palace} <span className="muted">({review.proposals.length})</span>
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Proposals only: each names the call an agent would make. Nothing is applied.
          </p>
          {review.hint && <div className="muted small">{review.hint}</div>}
          {review.proposals.length === 0 && <div className="muted small">Nothing to propose.</div>}
          {review.proposals.map((proposal, index) => (
            <div key={index} className="small">
              <strong>{proposal.kind.replaceAll("_", " ")}</strong>
              {proposal.name ? `: ${proposal.name}` : ""}
              {proposal.room_name ? ` in ${proposal.room_name}` : ""}
              {typeof proposal.text === "string" ? ` — ${proposal.text}` : ""}
              <span className="muted"> · {proposal.how}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
