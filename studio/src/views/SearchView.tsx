import { useEffect, useMemo, useState } from "react";

import { type Node, describeError, displayName, labelColor } from "../api.ts";
import { useStudio } from "../context.ts";
import type { Context, Fragment, Recalled, SearchHit, SearchMode } from "../../../client/src/index.ts";

type Mode = SearchMode | "recall" | "context";

const MODES: { id: Mode; title: string; help: string; capability?: string }[] = [
  { id: "text", title: "Full text", help: "Search node text or a named full-text index." },
  { id: "hybrid", title: "Hybrid", help: "Fuse full-text and vector results with ranks or weighted scores.", capability: "search.hybrid" },
  { id: "vector", title: "Vector", help: "Search an embedding, optionally through a named vector index.", capability: "search.vector" },
  { id: "recall", title: "Recall", help: "Retrieve memories, then expand and rank them through the graph." },
  { id: "context", title: "Context", help: "Pack memories and facts into a prompt-sized context." },
];

interface IndexChoice {
  name: string;
  kind: string;
}

function NodeLink({ node }: { node: Node }) {
  return <a href={`#/explorer/${node.id}`}><span className="dot" style={{ background: labelColor(node.labels[0] ?? "") }} /> {displayName(node)}</a>;
}

function FragmentText({ fragment }: { fragment: Fragment }) {
  const pieces: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of fragment.matches) {
    if (start > at) pieces.push(fragment.text.slice(at, start));
    pieces.push(<mark key={`${start}-${end}`}>{fragment.text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < fragment.text.length) pieces.push(fragment.text.slice(at));
  return <div className="search-fragment"><span className="mono faint">{fragment.field}</span>{pieces}</div>;
}

function parseEmbedding(raw: string): number[] | undefined {
  if (!raw.trim()) return undefined;
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("Embedding must be a JSON list of finite numbers.");
  }
  return value as number[];
}

export function SearchView() {
  const { client, namespace, supports } = useStudio();
  const [mode, setMode] = useState<Mode>("recall");
  const [text, setText] = useState("");
  const [embedding, setEmbedding] = useState("");
  const [textIndex, setTextIndex] = useState("");
  const [vectorIndex, setVectorIndex] = useState("");
  const [fusion, setFusion] = useState<"rank" | "weighted">("rank");
  const [fragments, setFragments] = useState(true);
  const [budget, setBudget] = useState(800);
  const [advanced, setAdvanced] = useState(false);
  const [indexes, setIndexes] = useState<IndexChoice[]>([]);
  const [hits, setHits] = useState<{ node: Node; hit: SearchHit }[] | null>(null);
  const [recalled, setRecalled] = useState<Recalled[] | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const availableModes = useMemo(() => MODES.filter((item) => !item.capability || supports(item.capability)), [supports]);
  const fulltextIndexes = indexes.filter((index) => index.kind === "fulltext");
  const vectorIndexes = indexes.filter((index) => index.kind === "vector");

  useEffect(() => {
    let alive = true;
    void client.namespace(namespace).query("SHOW INDEXES").then((result) => {
      if (!alive) return;
      const name = result.columns.indexOf("name");
      const kind = result.columns.indexOf("kind");
      if (name < 0 || kind < 0) return;
      setIndexes(result.rows.map((row) => ({ name: String(row[name]), kind: String(row[kind]) })));
    }).catch(() => alive && setIndexes([]));
    return () => { alive = false; };
  }, [client, namespace]);

  const search = async () => {
    if ((mode !== "vector" && !text.trim()) || (mode === "vector" && !embedding.trim())) return;
    const graph = client.namespace(namespace);
    setError(null);
    setHits(null);
    setRecalled(null);
    setContext(null);
    setSearching(true);
    try {
      if (mode === "text") {
        const found = await graph.searchText(text, { limit: 20, index: textIndex || undefined, fragments: fragments && Boolean(textIndex) });
        const nodes = await Promise.all(found.map((hit) => graph.getNode(hit.node)));
        setHits(found.map((hit, index) => ({ node: nodes[index], hit })));
      } else if (mode === "vector" || mode === "hybrid") {
        const vector = parseEmbedding(embedding)!;
        const found = mode === "vector"
          ? await graph.searchVector(vector, { limit: 20, index: vectorIndex || undefined })
          : await graph.search({ mode, text, embedding: vector, index: textIndex || undefined, vector_index: vectorIndex || undefined, fusion, fragments: fragments && Boolean(textIndex), limit: 20 });
        const nodes = await Promise.all(found.map((hit) => graph.getNode(hit.node)));
        setHits(found.map((hit, index) => ({ node: nodes[index], hit })));
      } else if (mode === "recall") {
        setRecalled(await graph.recall({ text, limit: 20, index: textIndex || undefined, vector_index: vectorIndex || undefined }));
      } else {
        setContext(await graph.context({ text, budget, limit: 20, index: textIndex || undefined, vector_index: vectorIndex || undefined }));
      }
    } catch (problem) {
      setError(describeError(problem));
    } finally {
      setSearching(false);
    }
  };

  const needsEmbedding = mode === "vector" || mode === "hybrid";
  const canSearch = mode === "vector" ? Boolean(embedding.trim()) : mode === "hybrid" ? Boolean(text.trim() && embedding.trim()) : Boolean(text.trim());

  return (
    <div className="stack search-view">
      <h1>Search</h1>
      <div className="panel search-console">
        <div className="chips search-modes">
          {availableModes.map((item) => <button key={item.id} className={mode === item.id ? "chip active" : "chip"} onClick={() => setMode(item.id)}>{item.title}</button>)}
        </div>
        <div className="muted small search-help">{MODES.find((item) => item.id === mode)?.help}</div>
        <div className="search-query-row">
          {mode !== "vector" && <input className="grow" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void search()} placeholder={mode === "context" ? "A question an agent would ask" : "What are you looking for?"} autoFocus />}
          {mode === "context" && <label className="row small nowrap">Budget <input type="number" min={50} step={50} value={budget} onChange={(event) => setBudget(Number(event.target.value))} /> tokens</label>}
          <button className="ghost" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>Options</button>
          <button className="primary" disabled={!canSearch || searching} onClick={() => void search()}>{searching ? "Searching…" : "Search"}</button>
        </div>
        {advanced && <div className="search-options">
          {needsEmbedding && <label className="field search-embedding">Embedding<textarea value={embedding} onChange={(event) => setEmbedding(event.target.value)} rows={2} placeholder="[0.12, -0.04, …]" className="mono" /></label>}
          {(mode === "text" || mode === "hybrid" || mode === "recall" || mode === "context") && <label className="field">Text index<select value={textIndex} onChange={(event) => setTextIndex(event.target.value)}><option value="">Node text</option>{fulltextIndexes.map((index) => <option key={index.name}>{index.name}</option>)}</select></label>}
          {(needsEmbedding || mode === "recall" || mode === "context") && vectorIndexes.length > 0 && <label className="field">Vector index<select value={vectorIndex} onChange={(event) => setVectorIndex(event.target.value)}><option value="">Node embedding</option>{vectorIndexes.map((index) => <option key={index.name}>{index.name}</option>)}</select></label>}
          {mode === "hybrid" && <label className="field">Fusion<select value={fusion} onChange={(event) => setFusion(event.target.value as "rank" | "weighted")}><option value="rank">Rank fusion</option><option value="weighted">Weighted scores</option></select></label>}
          {(mode === "text" || mode === "hybrid") && textIndex && <label className="check small"><input type="checkbox" checked={fragments} onChange={(event) => setFragments(event.target.checked)} /> Matching fragments</label>}
        </div>}
      </div>
      {error && <div className="error">{error}</div>}

      {hits && <div className="table-wrap search-results"><table><thead><tr><th>Node</th><th>Labels</th><th>Match</th><th>Score</th></tr></thead><tbody>
        {hits.length === 0 && <tr><td colSpan={4} className="muted">No matches.</td></tr>}
        {hits.map(({ node, hit }) => <tr key={node.id}><td><NodeLink node={node} /></td><td className="muted">{node.labels.join(", ")}</td><td>{hit.fragments?.map((fragment, index) => <FragmentText key={`${fragment.field}-${index}`} fragment={fragment} />) ?? <span className="muted small">{hit.text_rank ? `text #${hit.text_rank}` : "—"}{hit.vector_rank ? ` · vector #${hit.vector_rank}` : ""}</span>}</td><td className="mono">{hit.score.toFixed(4)}</td></tr>)}
      </tbody></table></div>}

      {recalled && <div className="table-wrap"><table><thead><tr><th>Node</th><th>Why</th><th>Score</th></tr></thead><tbody>
        {recalled.length === 0 && <tr><td colSpan={3} className="muted">Nothing recalled.</td></tr>}
        {recalled.map((result) => <tr key={result.node.id}><td><NodeLink node={result.node} /></td><td className="small">{result.signals.map((signal) => signal.kind === "text" ? `text #${signal.rank}` : signal.kind === "vector" ? `meaning #${signal.rank} (${signal.similarity.toFixed(2)})` : signal.kind === "graph" ? `${signal.hops} hop(s) from a match` : `importance ${signal.importance.toFixed(2)}, recency ${signal.recency.toFixed(2)}`).join(" · ")}</td><td className="mono">{result.score.toFixed(4)}</td></tr>)}
      </tbody></table></div>}

      {context && <div className="panel stack"><div className="muted small">{context.items.length} memories · {context.facts.length} facts · {context.tokens} of {budget} tokens</div><pre>{context.rendered || "No relevant memories."}</pre></div>}
    </div>
  );
}
