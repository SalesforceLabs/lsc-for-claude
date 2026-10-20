import React, { useMemo } from "react";
import { CircleQuestionMark, Plus, Search } from "lucide-react";
import StatusIcon from "../../ui/StatusIcon";
import { countLabel, groupRows, type LibraryRow } from "./script-library-logic";

interface ScriptLibraryProps {
  rows: LibraryRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onNew: () => void;
  query: string;
  onQuery: (query: string) => void;
  /** The "How custom scripts work" page is open. */
  aboutOpen: boolean;
  onAbout: () => void;
}

/** The scripts in the org, by type, with a search and a way to start a new one. */
export default function ScriptLibrary({ rows, selectedKey, onSelect, onNew, query, onQuery, aboutOpen, onAbout }: ScriptLibraryProps) {
  const groups = useMemo(() => groupRows(rows, query), [rows, query]);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <aside className="scripts-library" aria-label="Custom scripts">
      <div className="scripts-library-head">
        <div className="scripts-search">
          <Search size={14} aria-hidden="true" />
          <input
            className="ui-field"
            type="search"
            value={query}
            placeholder="Search"
            aria-label="Search scripts"
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <button className="studio-btn primary" onClick={onNew}>
          <Plus size={14} aria-hidden="true" />
          New script
        </button>
      </div>
      <div className="scripts-library-list">
        {groups.map((g) => (
          <section key={g.type} aria-label={g.label}>
            <h2 className="ui-section-title">
              {g.label}
              <span className="count">{countLabel(g.rows.length)}</span>
            </h2>
            <ul>
              {g.rows.map((r) => {
                const selected = r.key === selectedKey;
                return (
                  <li key={r.key}>
                    <button
                      className={`scripts-row${selected ? " selected" : ""}`}
                      aria-current={selected ? "true" : undefined}
                      onClick={() => onSelect(r.key)}
                      title={`${r.name} — ${r.status.label}. ${r.status.detail}`}
                    >
                      <StatusIcon tone={r.status.tone} size={18} />
                      <span className="scripts-row-text">
                        <span className="scripts-row-name">{r.name}</span>
                        <span className="scripts-row-status">{r.status.label}</span>
                      </span>
                      {r.queued ? (
                        <span className="ui-pill warning">Queued</span>
                      ) : r.dirty ? (
                        <span className="scripts-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {query && shown === 0 && <p className="scripts-library-none">No script matches “{query}”.</p>}
      </div>
      <div className="scripts-library-foot">
        <button className={`scripts-row${aboutOpen ? " selected" : ""}`} aria-current={aboutOpen ? "page" : undefined} onClick={onAbout}>
          <CircleQuestionMark size={16} aria-hidden="true" />
          <span className="scripts-row-name">How custom scripts work</span>
        </button>
      </div>
    </aside>
  );
}
