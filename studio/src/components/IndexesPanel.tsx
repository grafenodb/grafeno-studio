import { useCallback, useEffect, useState } from "react";

import { describeError } from "../api.ts";
import { useStudio } from "../context.ts";
import { Icon } from "../icons.tsx";
import { LabelInput } from "../ui.tsx";

type CreateKind = "index" | "unique" | "key" | "required" | "typed" | "fulltext" | "vector";

interface IndexRow {
  name: string;
  label: string;
  property: string;
  unique: boolean;
  entries: number;
  on: string;
  kind: string;
  state: string;
}

interface ConstraintRow {
  name: string;
  kind: string;
  label: string;
  property: string;
  rule: string;
  on: string;
}

function record(columns: string[], row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
}

function identifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

/** Property, full-text and vector indexes plus every namespace constraint. */
export function IndexesPanel() {
  const { client, namespace, schema, confirm, toast, revision } = useStudio();
  const graph = client.namespace(namespace);
  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [constraints, setConstraints] = useState<ConstraintRow[]>([]);
  const [label, setLabel] = useState<string[]>([]);
  const [properties, setProperties] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CreateKind>("index");
  const [dataType, setDataType] = useState("STRING");
  const [analyzer, setAnalyzer] = useState("standard");
  const [dimension, setDimension] = useState(768);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [shownIndexes, shownConstraints] = await Promise.all([graph.query("SHOW INDEXES"), graph.query("SHOW CONSTRAINTS")]);
      setIndexes(shownIndexes.rows.map((row) => {
        const value = record(shownIndexes.columns, row);
        return {
          name: String(value.name ?? row[0]), label: String(value.label ?? row[1]), property: String(value.property ?? row[2]),
          unique: Boolean(value.unique ?? row[3]), entries: Number(value.entries ?? row[4]), on: String(value.on ?? row[6] ?? "nodes"),
          kind: String(value.kind ?? row[8] ?? "value"), state: String(value.state ?? row[9] ?? "online"),
        };
      }));
      setConstraints(shownConstraints.rows.map((row) => {
        const value = record(shownConstraints.columns, row);
        return { name: String(value.name ?? row[0]), kind: String(value.kind ?? row[1]), label: String(value.label ?? row[2]), property: String(value.property ?? row[3]), rule: String(value.rule ?? row[4]), on: String(value.on ?? row[5] ?? "nodes") };
      }));
    } catch (problem) {
      toast(describeError(problem), "error");
    }
  }, [client, namespace, toast]);

  useEffect(() => { void load(); }, [load, revision]);

  const create = async () => {
    const keys = properties.split(",").map((key) => key.trim()).filter(Boolean);
    if (!label[0] || keys.length === 0 || keys.some((key) => !/^[A-Za-z_]\w*$/.test(key))) {
      toast("Choose a label and one or more comma-separated property names.", "error");
      return;
    }
    if ((kind === "fulltext" || kind === "vector") && !/^[A-Za-z_]\w*$/.test(name.trim())) {
      toast("Named full-text and vector indexes need a name.", "error");
      return;
    }
    if (["unique", "required", "typed", "vector"].includes(kind) && keys.length !== 1) {
      toast(`${kind} needs exactly one property.`, "error");
      return;
    }
    const variable = "n";
    const target = `(${variable}:${identifier(label[0])})`;
    const refs = keys.map((key) => `${variable}.${identifier(key)}`);
    const named = name.trim() ? `${identifier(name.trim())} ` : "";
    let statement: string;
    if (kind === "index") statement = `CREATE INDEX ${named}FOR ${target} ON (${refs.join(", ")})`;
    else if (kind === "fulltext") statement = `CREATE FULLTEXT INDEX ${identifier(name.trim())} FOR ${target} ON EACH [${refs.join(", ")}] OPTIONS {analyzer: '${analyzer}'}`;
    else if (kind === "vector") statement = `CREATE VECTOR INDEX ${identifier(name.trim())} FOR ${target} ON (${refs[0]}) OPTIONS {dimension: ${dimension}, similarity: 'cosine', background: true}`;
    else if (kind === "key") statement = `CREATE CONSTRAINT ${named}FOR ${target} REQUIRE (${refs.join(", ")}) IS KEY`;
    else if (kind === "unique") statement = `CREATE CONSTRAINT ${named}FOR ${target} REQUIRE ${refs[0]} IS UNIQUE`;
    else if (kind === "required") statement = `CREATE CONSTRAINT ${named}FOR ${target} REQUIRE ${refs[0]} IS NOT NULL`;
    else statement = `CREATE CONSTRAINT ${named}FOR ${target} REQUIRE ${refs[0]} IS :: ${dataType}`;
    setBusy(true);
    try {
      await graph.query(statement);
      toast(kind === "index" || kind === "fulltext" || kind === "vector" ? "Index created." : "Constraint created.", "ok");
      setProperties("");
      setName("");
      await load();
    } catch (problem) {
      toast(describeError(problem), "error");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (item: { name: string }, constraint: boolean) => {
    if (!(await confirm({ title: `Drop ${constraint ? "constraint" : "index"} ${item.name}?`, message: "The data stays, but this rule or access path is removed.", confirm: "Drop", danger: true }))) return;
    try {
      await graph.query(`DROP ${constraint ? "CONSTRAINT" : "INDEX"} ${identifier(item.name)}`);
      await load();
    } catch (problem) {
      toast(describeError(problem), "error");
    }
  };

  return (
    <div className="panel stack">
      <h2>Indexes and constraints of “{namespace}”</h2>
      <p className="muted small" style={{ margin: 0 }}>Value, composite, full-text and vector indexes accelerate different workloads. Constraints protect shape, type and uniqueness.</p>

      <div className="schema-lists">
        <div className="table-wrap"><table><thead><tr><th>Index</th><th>On</th><th>Kind</th><th>Entries</th><th>State</th><th /></tr></thead><tbody>
          {indexes.length === 0 && <tr><td colSpan={6} className="muted">No indexes yet.</td></tr>}
          {indexes.map((index) => <tr key={index.name}><td className="mono">{index.name}</td><td className="mono">{index.on === "edges" ? "fact " : ":"}{index.label}({index.property})</td><td>{index.unique ? "unique" : index.kind}</td><td className="mono">{index.entries}</td><td><span className={`badge ${index.state === "online" ? "" : "warning"}`}>{index.state}</span></td><td><button className="ghost icon-button danger" onClick={() => void drop(index, index.unique)} title="Drop"><Icon name="trash" size={14} /></button></td></tr>)}
        </tbody></table></div>
        <div className="table-wrap"><table><thead><tr><th>Constraint</th><th>On</th><th>Rule</th><th /></tr></thead><tbody>
          {constraints.length === 0 && <tr><td colSpan={4} className="muted">No constraints yet.</td></tr>}
          {constraints.map((constraint) => <tr key={constraint.name}><td className="mono">{constraint.name}</td><td className="mono">{constraint.on === "edges" ? "fact " : ":"}{constraint.label}({constraint.property})</td><td>{constraint.rule || constraint.kind}</td><td><button className="ghost icon-button danger" onClick={() => void drop(constraint, true)} title="Drop"><Icon name="trash" size={14} /></button></td></tr>)}
        </tbody></table></div>
      </div>

      <div className="index-form advanced-index-form">
        <label className="field">Kind<select value={kind} onChange={(event) => setKind(event.target.value as CreateKind)}><option value="index">Property index</option><option value="fulltext">Full-text index</option><option value="vector">Vector index</option><option value="unique">Unique</option><option value="key">Composite key</option><option value="required">Required</option><option value="typed">Typed</option></select></label>
        <div className="field">Label<LabelInput value={label} onChange={setLabel} suggestions={Object.keys(schema.labels)} placeholder="Person" single /></div>
        <label className="field">Properties<input value={properties} onChange={(event) => setProperties(event.target.value)} placeholder="last, first" /></label>
        <label className="field">Name <span className="hint">required for text/vector</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="person_name" /></label>
        {kind === "typed" && <label className="field">Type<select value={dataType} onChange={(event) => setDataType(event.target.value)}>{["STRING", "INTEGER", "FLOAT", "BOOLEAN", "LIST", "MAP", "DATETIME"].map((type) => <option key={type}>{type}</option>)}</select></label>}
        {kind === "fulltext" && <label className="field">Analyzer<select value={analyzer} onChange={(event) => setAnalyzer(event.target.value)}>{["standard", "simple", "english", "spanish"].map((value) => <option key={value}>{value}</option>)}</select></label>}
        {kind === "vector" && <label className="field">Dimension<input type="number" min={1} value={dimension} onChange={(event) => setDimension(Number(event.target.value))} /></label>}
        <button className="primary" disabled={busy} onClick={() => void create()}><Icon name="plus" /> Create</button>
      </div>
    </div>
  );
}
