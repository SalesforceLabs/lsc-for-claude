import React, { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import type { PropertyEdit } from "./flexipage-draft";
import { fieldIpadNote } from "./component-props";
import StatusIcon from "../ui/StatusIcon";
import Spinner from "../ui/Spinner";

/**
 * The properties sheet of a Lightning page component in the inspector: one
 * typed field per property, with the org's value and a reset when the pending
 * value differs, the typed check, and whether the iPad reads it at all. Text
 * and numbers queue when the field is left or Enter is pressed (one undo step
 * per edit, not per keystroke); switches and choices queue at once.
 */
export default function PropertiesSheet({
  properties,
  draft,
  loading,
  note,
  dynamic,
  componentNote,
  notDrawn = false,
  onSet,
  onReset,
}: {
  properties: PropertyEdit[];
  draft: boolean;
  /** The definitions are still being read. */
  loading: boolean;
  /** What is partial about the definitions. */
  note?: string;
  /** The component reads every property it has, whatever its name. */
  dynamic?: string;
  /** What the iPad does with the component as a whole: not drawn (so no property is used), an inline LWC's height only, or not traced. */
  componentNote?: string;
  /** The iPad doesn't draw the component: the note above says so once, so the fields stay quiet. */
  notDrawn?: boolean;
  onSet: (edit: PropertyEdit, value: string) => void;
  onReset: (edit: PropertyEdit) => void;
}) {
  if (!properties.length && !loading && !note && !componentNote) return null;
  return (
    <section className="studio-propsheet" aria-label="Properties">
      <h4 className="studio-propsheet-title">
        Properties
        {loading && <Spinner size={12} />}
      </h4>
      {componentNote && <p className="studio-form-help">{componentNote}</p>}
      {dynamic && <p className="studio-form-help">{dynamic}</p>}
      {note && <p className="studio-form-help">{note}</p>}
      <div className="studio-form">
        {properties.map((p) => (
          <PropertyField key={p.property} edit={p} draft={draft} notDrawn={notDrawn} onSet={(value) => onSet(p, value)} onReset={() => onReset(p)} />
        ))}
      </div>
    </section>
  );
}

function PropertyField({ edit, draft, notDrawn, onSet, onReset }: { edit: PropertyEdit; draft: boolean; notDrawn: boolean; onSet: (value: string) => void; onReset: () => void }) {
  const { def } = edit;
  const ipadNote = fieldIpadNote(def, notDrawn);
  const [value, setValue] = useState(edit.value);
  useEffect(() => setValue(edit.value), [edit.value]);
  const { problem, warning } = edit.check(value);
  const off = !draft || edit.readOnly;
  const why = !draft ? "Switch to Draft to queue changes" : edit.readOnly ? "This identifies the component" : undefined;
  const commit = () => {
    if (value !== edit.value && !problem) onSet(value);
  };
  const id = `studio-prop-${edit.property}`;
  let input: React.ReactNode;
  if (def.type === "Boolean") {
    input = (
      <label className="ui-check">
        <input id={id} type="checkbox" checked={value === "true"} disabled={off} title={why} onChange={(e) => onSet(e.target.checked ? "true" : "false")} />
        {value === "true" ? "On" : "Off"}
      </label>
    );
  } else if (def.type === "Picklist") {
    input = (
      <select id={id} className="studio-input" value={value} disabled={off} title={why} aria-invalid={!!problem} onChange={(e) => onSet(e.target.value)}>
        {(!def.required || !value) && <option value="">{def.required ? "Choose…" : "—"}</option>}
        {[...(def.options ?? []), ...(value && !def.options?.includes(value) ? [value] : [])].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (def.multiline) {
    input = (
      <textarea
        id={id}
        className="studio-input mono"
        rows={4}
        value={value}
        disabled={off}
        title={why}
        aria-invalid={!!problem}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setValue(edit.value);
        }}
      />
    );
  } else {
    input = (
      <input
        id={id}
        className="studio-input"
        type={def.type === "Integer" ? "number" : "text"}
        min={def.type === "Integer" ? (def.min ?? 1) : undefined}
        max={def.type === "Integer" ? def.max : undefined}
        value={value}
        disabled={off}
        title={why}
        aria-invalid={!!problem}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setValue(edit.value);
        }}
      />
    );
  }
  return (
    <div className={`studio-form-row${def.ipad === "unused" ? " studio-prop-unused" : ""}`}>
      <label className="studio-form-label" htmlFor={id}>
        {def.label}
        {def.required && <span aria-hidden> *</span>}
      </label>
      <span className="studio-form-field">
        {input}
        {ipadNote && <span className="studio-form-help">{ipadNote}</span>}
        {def.description && <span className="studio-form-help">{def.description}</span>}
        {(problem || warning) && (
          <span className="studio-form-help" role="status">
            <StatusIcon tone={problem ? "error" : "warning"} size={14} />
            {problem ?? warning}
          </span>
        )}
        {edit.changed && (
          <span className="studio-form-help studio-prop-org">
            Org: {edit.orgValue === null ? "not set" : <code>{edit.orgValue.length > 60 ? `${edit.orgValue.slice(0, 60)}…` : edit.orgValue}</code>}
            {draft && (
              <button type="button" className="studio-btn ghost sm" onClick={onReset} title="Put the org's value back">
                <Undo2 size={12} aria-hidden />
                Reset
              </button>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
