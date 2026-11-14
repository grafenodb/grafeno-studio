import { useEffect, useMemo, useState } from "react";

import type { Edge, Node, Trace, TraceEvent } from "@grafenodb/client";
import { go } from "../api.ts";
import { useStudio } from "../context.ts";
import { Icon } from "../icons.tsx";
import { MiniGraph } from "./MiniGraph.tsx";

function ids(event: TraceEvent): { nodes: string[]; edges: string[] } {
  switch (event.kind) {
    case "anchor": return { nodes: [event.node], edges: [] };
    case "expand": return { nodes: [event.from, event.to], edges: [...(event.edge ? [event.edge] : []), ...(event.edges ?? [])] };
    case "keep": return { nodes: [event.node], edges: event.edge ? [event.edge] : [] };
    case "drop": return { nodes: [...(event.node ? [event.node] : []), ...(event.nodes ?? [])], edges: event.edge ? [event.edge] : [] };
    case "row": return { nodes: event.nodes, edges: event.edges };
  }
}

function describe(event: TraceEvent): string {
  switch (event.kind) {
    case "anchor": return `Checked anchor ${event.node} via ${event.via}`;
    case "expand": return `Followed ${event.edge ?? event.edges?.length + " edges"} from ${event.from} to ${event.to}`;
    case "keep": return `Kept ${event.node}`;
    case "drop": return `Dropped ${event.node ?? event.nodes?.join(", ") ?? event.edge ?? "candidate"}: ${event.condition ?? event.reason}`;
    case "row": return `Produced row ${event.index + 1}`;
  }
}

export function TraceViewer({ trace }: { trace: Trace }) {
  const { client, namespace } = useStudio();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [records, setRecords] = useState<{ nodes: Map<string, Node>; edges: Map<string, Edge> }>({ nodes: new Map(), edges: new Map() });

  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [trace]);

  useEffect(() => {
    if (!playing || trace.events.length === 0) return;
    const timer = window.setInterval(() => {
      setCursor((value) => {
        if (value >= trace.events.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [playing, trace.events.length]);

  useEffect(() => {
    let alive = true;
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const event of trace.events) {
      const found = ids(event);
      found.nodes.forEach((id) => nodeIds.add(id));
      found.edges.forEach((id) => edgeIds.add(id));
    }
    const tagged = [
      ...[...nodeIds].map((id) => ({ kind: "node" as const, id })),
      ...[...edgeIds].map((id) => ({ kind: "edge" as const, id })),
    ];
    const batches = Array.from({ length: Math.ceil(tagged.length / 500) }, (_, index) => tagged.slice(index * 500, index * 500 + 500));
    void Promise.all(batches.map((batch) => client.namespace(namespace).readMany({
      nodes: batch.filter((item) => item.kind === "node").map((item) => item.id),
      edges: batch.filter((item) => item.kind === "edge").map((item) => item.id),
    }))).then((results) => {
      if (!alive) return;
      const nodes = new Map<string, Node>();
      const edges = new Map<string, Edge>();
      results.forEach((result) => {
        result.nodes.forEach((node) => node && nodes.set(node.id, node));
        result.edges.forEach((edge) => edge && edges.set(edge.id, edge));
      });
      setRecords({ nodes, edges });
    }).catch(() => alive && setRecords({ nodes: new Map(), edges: new Map() }));
    return () => { alive = false; };
  }, [client, namespace, trace]);

  const shown = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const event of trace.events.slice(0, cursor + 1)) {
      const found = ids(event);
      found.nodes.forEach((id) => nodeIds.add(id));
      found.edges.forEach((id) => edgeIds.add(id));
    }
    const nodes = [...nodeIds].map((id) => records.nodes.get(id)).filter((node): node is Node => Boolean(node));
    const edges = [...edgeIds].map((id) => records.edges.get(id)).filter((edge): edge is Edge => Boolean(edge));
    return [[...nodes, ...edges]];
  }, [cursor, records, trace.events]);

  const event = trace.events[cursor];
  const step = event ? trace.steps.find((item) => item.step === event.step) : undefined;

  if (trace.events.length === 0) return <div className="muted pad">The statement completed without traversal events.</div>;
  return (
    <div className="trace-viewer">
      <div className="trace-stage">
        <MiniGraph rows={shown} onOpen={(id) => go("explorer", id)} />
        <div className="trace-now">
          <span className={`trace-kind ${event.kind}`}>{event.kind}</span>
          <strong>{describe(event)}</strong>
          <span className="muted small">Step {event.step}: {step?.clause ?? "query"}</span>
        </div>
      </div>
      <div className="trace-controls">
        <button className="ghost icon-button" onClick={() => setCursor(0)} title="First event"><Icon name="chevronLeft" /></button>
        <button className="primary trace-play" onClick={() => setPlaying((value) => !value)}><Icon name={playing ? "pause" : "play"} /> {playing ? "Pause" : "Play"}</button>
        <button className="ghost icon-button" onClick={() => setCursor((value) => Math.min(trace.events.length - 1, value + 1))} title="Next event"><Icon name="chevronRight" /></button>
        <input type="range" min={0} max={trace.events.length - 1} value={cursor} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }} aria-label="Traversal event" />
        <span className="mono small">{cursor + 1} / {trace.events.length}</span>
        {trace.cut && <span className="badge warning">Trace limit reached</span>}
      </div>
      <div className="trace-timeline">
        {trace.events.map((item, index) => <button key={item.seq} className={index === cursor ? "active" : ""} onClick={() => { setPlaying(false); setCursor(index); }} title={describe(item)}><span>{item.seq}</span><i className={`trace-dot ${item.kind}`} /></button>)}
      </div>
    </div>
  );
}
