import { useState } from "react";

import { copyText, copyValueText } from "../clipboard.ts";
import { Icon } from "../icons.tsx";

function primitive(value: unknown) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "string") return <span className="json-string">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="json-number">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="json-boolean">{String(value)}</span>;
  return <span className="json-null">{String(value)}</span>;
}

function JsonBranch({ value, depth, openDepth }: { value: unknown; depth: number; openDepth: number }) {
  const structured = typeof value === "object" && value !== null;
  const [open, setOpen] = useState(depth < openDepth);
  if (!structured) return primitive(value);

  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <span className="json-branch">
      <button className="json-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
        <span>{brackets[0]}</span>
        {!open && <span className="muted">{entries.length} {Array.isArray(value) ? "items" : "keys"}</span>}
        {!open && <span>{brackets[1]}</span>}
      </button>
      {open && (
        <span className="json-children">
          {entries.length === 0 ? (
            <span className="json-empty">{brackets[1]}</span>
          ) : (
            <>
              {entries.map(([key, item], index) => (
                <span className="json-entry" key={key}>
                  <span className="json-key">{Array.isArray(value) ? key : JSON.stringify(key)}:</span>
                  <JsonBranch value={item} depth={depth + 1} openDepth={openDepth} />
                  {index < entries.length - 1 && <span className="json-comma">,</span>}
                </span>
              ))}
              <span className="json-close">{brackets[1]}</span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

export function JsonTree({ value }: { value: unknown }) {
  const [openDepth, setOpenDepth] = useState(2);
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const changeDepth = (depth: number) => {
    setOpenDepth(depth);
    setRevision((value) => value + 1);
  };
  return (
    <div className="json-tree">
      <div className="json-tree-toolbar">
        <button className="ghost small-button" onClick={() => changeDepth(Number.POSITIVE_INFINITY)}>Expand all</button>
        <button className="ghost small-button" onClick={() => changeDepth(0)}>Collapse all</button>
        <div className="spacer" />
        <button
          className="ghost small-button"
          onClick={() => void copyText(copyValueText(value)).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          })}
        >
          <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <div className="json-tree-body mono" key={`${openDepth}-${revision}`}>
        <JsonBranch value={value} depth={0} openDepth={openDepth} />
      </div>
    </div>
  );
}
