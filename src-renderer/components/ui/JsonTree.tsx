import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Limited } from "./Limited";

interface JsonTreeProps {
  value: unknown;
  /** Levels open at first. */
  openDepth?: number;
  className?: string;
}

/**
 * A JSON value as a collapsible tree. A branch's children are only drawn once it's opened,
 * and long ones show their first rows with "Show more", so a 20 MB file stays responsive.
 */
export default function JsonTree({ value, openDepth = 1, className }: JsonTreeProps) {
  return (
    <div className={`ui-json${className ? ` ${className}` : ""}`} role="tree">
      <JsonNode name={null} value={value} depth={0} openDepth={openDepth} />
    </div>
  );
}

function JsonNode({
  name,
  value,
  depth,
  openDepth,
}: {
  name: string | null;
  value: unknown;
  depth: number;
  openDepth: number;
}) {
  const branch = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < openDepth);
  const label = name !== null && <span className="ui-json-key">{name}</span>;
  if (!branch) {
    return (
      <div
        className="ui-json-row"
        role="treeitem"
        style={{ paddingLeft: `calc(${depth} * var(--space-4) + 18px)` }}
      >
        {label}
        {label && <span className="ui-json-colon">:</span>}
        <JsonLeaf value={value} />
      </div>
    );
  }
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as object);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <div role="treeitem" aria-expanded={open}>
      <button
        type="button"
        className="ui-json-row ui-json-toggle"
        style={{ paddingLeft: `calc(${depth} * var(--space-4))` }}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`ui-json-chevron${open ? " open" : ""}`}
        />
        {label}
        {label && <span className="ui-json-colon">:</span>}
        <span className="ui-json-summary">{summary}</span>
      </button>
      {open && (
        <div role="group">
          <Limited
            items={entries}
            render={([k, v]) => (
              <JsonNode key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} />
            )}
          />
        </div>
      )}
    </div>
  );
}

function JsonLeaf({ value }: { value: unknown }) {
  if (typeof value === "string")
    return <span className="ui-json-string">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="ui-json-number">{value}</span>;
  if (typeof value === "boolean") return <span className="ui-json-bool">{String(value)}</span>;
  return <span className="ui-json-null">null</span>;
}
