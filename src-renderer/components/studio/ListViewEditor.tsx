import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import StatusIcon from "../ui/StatusIcon";
import type { PendingChange } from "./changes";
import {
  filterableFields,
  filterProblem,
  IPAD_SCOPES,
  listViewNotes,
  MAX_LIST_FILTERS,
  OPERATIONS,
  setFilters,
  setScope,
  type ListViewDraft,
} from "./listview-draft";
import type { ListViewFilter } from "./types";

/**
 * A list view's filter scope and filter rows, in the block inspector: edits are
 * queued as soon as they're valid (a value when its field is left or Enter is
 * pressed). Sort isn't offered: the Metadata API has no sort setting.
 */
export default function ListViewEditor({
  draft,
  editable,
  pending,
  onChange,
}: {
  draft: ListViewDraft;
  /** Draft mode: Published explains, it doesn't queue. */
  editable: boolean;
  pending: PendingChange[];
  onChange: (next: PendingChange[]) => void;
}) {
  const { scope, filters, logic } = draft.target;
  const fields = filterableFields(draft);
  const title = editable ? undefined : "Switch to Draft to queue changes";
  const scopes = scope && !(IPAD_SCOPES as readonly string[]).includes(scope) ? [...IPAD_SCOPES, scope] : [...IPAD_SCOPES];
  const [logicText, setLogicText] = useState(logic ?? "");
  useEffect(() => setLogicText(logic ?? ""), [logic]);
  const logicProblem = filters.length > 1 && logicText.trim() ? filterProblem(filters, logicText.trim()) : null;

  const replace = (i: number, f: ListViewFilter) => {
    const next = setFilters(draft, filters.map((x, k) => (k === i ? f : x)), undefined, pending);
    if (next) onChange(next);
  };

  return (
    <div className="studio-form studio-listview-editor">
      <label className="studio-form-row">
        <span className="studio-form-label">Filter scope</span>
        <span className="studio-form-field">
          <select
            className="ui-field"
            value={scope ?? "Everything"}
            disabled={!editable}
            title={title}
            onChange={(e) => onChange(setScope(draft, e.target.value, pending))}
          >
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s === "Mine" ? "Mine (my records)" : s === "Everything" ? "Everything (all visible records)" : `${s} (the iPad treats this as Everything)`}
              </option>
            ))}
          </select>
        </span>
      </label>

      <div className="studio-form-row">
        <span className="studio-form-label">Filters</span>
        <span className="studio-form-field studio-listview-filters">
          {filters.length === 0 && <span className="studio-form-help">No filters: every record in scope is listed.</span>}
          {filters.map((f, i) => (
            <FilterRow
              key={i}
              index={i}
              filter={f}
              fields={fields}
              editable={editable}
              onChange={(next) => replace(i, next)}
              onRemove={() => {
                const rows = filters.filter((_, k) => k !== i);
                const next = setFilters(draft, rows, undefined, pending);
                if (next) onChange(next);
              }}
            />
          ))}
          <button
            type="button"
            className="studio-btn sm"
            disabled={!editable || !fields.length || filters.length >= MAX_LIST_FILTERS}
            title={title ?? (filters.length >= MAX_LIST_FILTERS ? `A list view holds at most ${MAX_LIST_FILTERS} filters` : fields.length ? "Add a filter" : "No filterable field to use")}
            onClick={() => {
              const next = setFilters(draft, [...filters, { field: fields[0].name, operation: "equals", value: "" }], undefined, pending);
              if (next) onChange(next);
            }}
          >
            <Plus size={14} aria-hidden />
            Add filter
          </button>
        </span>
      </div>

      {filters.length > 1 && (
        <label className="studio-form-row">
          <span className="studio-form-label">Filter logic</span>
          <span className="studio-form-field">
            <input
              className="studio-input mono"
              value={logicText}
              placeholder="All filters must match (AND)"
              disabled={!editable}
              title={title}
              aria-invalid={!!logicProblem}
              onChange={(e) => setLogicText(e.target.value)}
              onBlur={() => {
                const text = logicText.trim().toUpperCase();
                if (text === (logic ?? "") || (!text && logic === null)) return;
                const next = setFilters(draft, filters, text || null, pending);
                if (next) onChange(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setLogicText(logic ?? "");
              }}
            />
            {logicProblem && (
              <span className="studio-form-help" role="status">
                <StatusIcon tone="error" size={14} />
                {logicProblem}
              </span>
            )}
          </span>
        </label>
      )}

      {listViewNotes(draft).map((n) => (
        <p key={n} className="studio-form-help" role="status">
          <StatusIcon tone="warning" size={14} />
          {n}
        </p>
      ))}
    </div>
  );
}

function FilterRow({
  index,
  filter,
  fields,
  editable,
  onChange,
  onRemove,
}: {
  index: number;
  filter: ListViewFilter;
  fields: { name: string; label: string }[];
  editable: boolean;
  onChange: (f: ListViewFilter) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(filter.value);
  useEffect(() => setValue(filter.value), [filter.value]);
  const known = fields.some((f) => f.name === filter.field);
  const commit = () => {
    if (value !== filter.value) onChange({ ...filter, value });
  };
  const n = index + 1;
  return (
    <span className="studio-listview-filter">
      <span className="studio-listview-filter-no">{n}</span>
      {known ? (
        <select
          className="ui-field"
          aria-label={`Filter ${n} field`}
          value={filter.field}
          disabled={!editable}
          onChange={(e) => onChange({ ...filter, field: e.target.value })}
        >
          {fields.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="studio-input mono" title="This field can't be changed here">
          {filter.field}
        </span>
      )}
      <select
        className="ui-field"
        aria-label={`Filter ${n} operation`}
        value={filter.operation}
        disabled={!editable}
        onChange={(e) => onChange({ ...filter, operation: e.target.value })}
      >
        {OPERATIONS.some((o) => o.value === filter.operation) ? null : <option value={filter.operation}>{filter.operation}</option>}
        {OPERATIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        className="studio-input"
        aria-label={`Filter ${n} value`}
        value={value}
        disabled={!editable}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setValue(filter.value);
        }}
      />
      <button type="button" className="studio-btn ghost sm" disabled={!editable} onClick={onRemove} aria-label={`Remove filter ${n}`} title="Remove this filter">
        <Trash2 size={14} aria-hidden />
      </button>
    </span>
  );
}
