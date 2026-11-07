import { useEffect, useRef, useState } from "react";

import { displayName, go, labelColor } from "../api.ts";
import { VIRTUALIZE_AFTER, virtualWindow } from "../graph/virtual-table.ts";

type Json = unknown;

function isNode(value: Json): value is { id: string; labels: string[]; props: Record<string, unknown>; created_at: number } {
  return typeof value === "object" && value !== null && "labels" in value && "created_at" in value;
}

function isEdge(value: Json): value is { id: string; label: string; from: string; to: string; recorded_at: number } {
  return typeof value === "object" && value !== null && "from" in value && "recorded_at" in value;
}

/** One value of a query result: nodes link to the explorer. */
export function Cell({ value }: { value: Json }) {
  if (value === null || value === undefined) return <span className="muted">null</span>;
  if (isNode(value)) {
    return (
      <a href={`#/explorer/${value.id}`} title={value.id}>
        <span className="dot" style={{ background: labelColor(value.labels[0] ?? "") }} /> {displayName(value)}{" "}
        <span className="muted small">:{value.labels.join(":")}</span>
      </a>
    );
  }
  if (isEdge(value)) return <span className="mono">[:{value.label}]</span>;
  if (Array.isArray(value)) {
    return (
      <span>
        [
        {value.map((item, index) => (
          <span key={index}>
            {index > 0 && ", "}
            <Cell value={item} />
          </span>
        ))}
        ]
      </span>
    );
  }
  if (typeof value === "object") return <span className="mono">{JSON.stringify(value)}</span>;
  return <span>{String(value)}</span>;
}

export function ResultTable({ columns, rows }: { columns: string[]; rows: Json[][] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const virtual = rows.length > VIRTUALIZE_AFTER;
  useEffect(() => {
    const element = wrap.current;
    if (!element || !virtual) return;
    const update = () => setViewport((value) => ({ ...value, height: element.clientHeight || 600 }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [virtual]);
  useEffect(() => {
    if (!virtual || !wrap.current) return;
    wrap.current.scrollTop = 0;
    setViewport((value) => ({ ...value, top: 0 }));
  }, [rows, virtual]);
  if (columns.length === 0) return null;
  const window = virtual ? virtualWindow(viewport.top, viewport.height, rows.length) : { start: 0, end: rows.length, before: 0, after: 0 };
  return (
    <div
      className={virtual ? "table-wrap virtual-table-wrap" : "table-wrap"}
      ref={wrap}
      onScroll={virtual ? (event) => setViewport((value) => ({ ...value, top: event.currentTarget.scrollTop })) : undefined}
    >
      <table className={virtual ? "virtual-table" : undefined}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {window.before > 0 && <tr className="virtual-spacer" aria-hidden="true"><td colSpan={Math.max(1, columns.length)} style={{ height: window.before }} /></tr>}
          {rows.slice(window.start, window.end).map((row, offset) => {
            const index = window.start + offset;
            return (
            <tr key={index}>
              {row.map((value, column) => (
                <td key={column}>
                  <Cell value={value} />
                </td>
              ))}
            </tr>
            );
          })}
          {window.after > 0 && <tr className="virtual-spacer" aria-hidden="true"><td colSpan={Math.max(1, columns.length)} style={{ height: window.after }} /></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function openNode(id: string): void {
  go("explorer", id);
}
