import React, { useMemo, useState } from "react";
import type { CreateConfigFix, ProfileOption, StudioItem } from "./types";
import ProfilePicker from "./ProfilePicker";
import {
  apiNameFor,
  draftProfiles,
  fieldInputs,
  formProblems,
  FORMS,
  initialValues,
  profilesWhere,
  type FieldSpec,
  type FormValue,
} from "./templates";

interface CreateDialogProps {
  /** The prefilled record — from "+ New", "Duplicate…", a finding, or a queued create being edited. */
  draft: CreateConfigFix;
  /** The item being duplicated, for its current values and where it keeps its profiles. */
  source?: StudioItem;
  /** Object API names offered as suggestions in object fields. */
  objects: string[];
  profiles: ProfileOption[];
  onCancel: () => void;
  /** Adds the record to pending changes — nothing is written to the org here. */
  onQueue: (fix: CreateConfigFix) => void;
}

/** Form for a new Admin Console record. Its button queues the record; the tray's review applies it. */
export default function CreateDialog({ draft, source, objects, profiles, onCancel, onQueue }: CreateDialogProps) {
  const spec = FORMS[draft.category];
  const copying = !!draft.copyFrom;
  const where = profilesWhere(draft, source);
  const [recordLabel, setRecordLabel] = useState(draft.recordLabel);
  const [developerName, setDeveloperName] = useState(draft.developerName);
  // The API name follows the label until the admin edits it.
  const [nameEdited, setNameEdited] = useState(copying || !!draft.recordLabel);
  const [values, setValues] = useState<Record<string, FormValue>>(() => initialValues(draft, source));
  const [touched, setTouched] = useState<Set<string>>(() => new Set(draft.fields.map((f) => f.name)));
  const [assigned, setAssigned] = useState<string[]>(() => draftProfiles(draft, source));
  const [profilesTouched, setProfilesTouched] = useState(false);
  const [active, setActive] = useState(draft.active);
  const [picking, setPicking] = useState(false);
  const [tried, setTried] = useState(false);

  const problems = useMemo(
    () => (spec ? formProblems(spec, values, { developerName, recordLabel, copying }) : ["Studio has no form for this kind of record."]),
    [spec, values, developerName, recordLabel, copying]
  );
  if (!spec) return null;
  const known = new Set(profiles.map((p) => p.name.toLowerCase()));

  const set = (name: string, v: FormValue) => {
    setValues((s) => ({ ...s, [name]: v }));
    setTouched((t) => new Set(t).add(name));
  };
  const setLabel = (v: string) => {
    setRecordLabel(v);
    if (!nameEdited) setDeveloperName(apiNameFor(v, spec.prefix));
  };

  const submit = () => {
    setTried(true);
    if (problems.length) return;
    onQueue({
      ...draft,
      label: copying ? `Duplicate ${draft.copyFrom} as ${recordLabel}` : `New ${spec.noun}: ${recordLabel}`,
      developerName,
      recordLabel,
      fields: fieldInputs(spec, values, { copying, touched, profiles: assigned, profilesTouched, profilesIn: where }),
      profiles: where === "assignments" ? assigned : [],
      active,
    });
  };

  return (
    <div className="studio-modal-backdrop" onClick={onCancel}>
      <div className="studio-modal studio-create" role="dialog" aria-label={draft.label} onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">{copying ? `Duplicate · ${draft.copyFrom}` : `New ${spec.noun}`}</span>
          <button className="studio-icon-btn" onClick={onCancel} title="Close">
            ×
          </button>
        </div>
        <h2 className="studio-inspector-title">{draft.label}</h2>
        {copying && (
          <p className="studio-inspector-desc">
            Every setting is copied from {draft.copyFrom}. Change only what should differ.
          </p>
        )}

        <div className="studio-form">
          <label className="studio-form-row">
            <span className="studio-form-label">Label</span>
            <input className="studio-input" value={recordLabel} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </label>
          <label className="studio-form-row">
            <span className="studio-form-label">API name</span>
            <input
              className="studio-input mono"
              value={developerName}
              maxLength={80}
              onChange={(e) => {
                setNameEdited(true);
                setDeveloperName(e.target.value);
              }}
            />
          </label>

          {spec.fields
            .filter((f) => !f.showIf || f.showIf(values))
            .map((f) => (
              <FieldRow key={f.name} spec={f} value={values[f.name]} values={values} copying={copying && !touched.has(f.name)} objects={objects} onChange={(v) => set(f.name, v)} />
            ))}

          <div className="studio-form-row">
            <span className="studio-form-label">Who sees this</span>
            <div className="studio-form-field">
              <div className="studio-chips">
                {assigned.length === 0 && (
                  <span className="studio-edit-value">{where === "field" ? "Every profile (none listed)" : "No profiles yet"}</span>
                )}
                {assigned.map((n) => (
                  <span key={n} className={`studio-chip${known.has(n.toLowerCase()) ? "" : " unknown"}`} title={known.has(n.toLowerCase()) ? undefined : "No profile with this name exists"}>
                    {n}
                  </span>
                ))}
                <button className="studio-link-btn" onClick={() => setPicking((v) => !v)}>
                  {picking ? "Done" : "Choose"}
                </button>
              </div>
              {picking && (
                <ProfilePicker
                  selected={assigned}
                  profiles={profiles}
                  onChange={(to) => {
                    setAssigned(to);
                    setProfilesTouched(true);
                  }}
                />
              )}
            </div>
          </div>

          <label className="studio-form-row">
            <span className="studio-form-label">Active</span>
            <span className="studio-form-field">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Switch on when created
            </span>
          </label>
        </div>

        {tried && problems.length > 0 && (
          <div className="studio-finding error">
            {problems.map((p) => (
              <div key={p} className="studio-finding-detail">
                {p}
              </div>
            ))}
          </div>
        )}
        <p className="studio-edit-note">Nothing is created until you review and apply pending changes.</p>

        <div className="studio-modal-actions">
          <button className="studio-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="studio-btn primary" onClick={submit}>
            Add to pending changes
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  spec,
  value,
  values,
  copying,
  objects,
  onChange,
}: {
  spec: FieldSpec;
  value: FormValue | undefined;
  values: Record<string, FormValue>;
  /** Untouched on a duplicate — the original's value is kept. */
  copying: boolean;
  objects: string[];
  onChange: (v: FormValue) => void;
}) {
  const help = typeof spec.help === "function" ? spec.help(values) : spec.help;
  const listId = spec.suggest ? `studio-suggest-${spec.name}` : undefined;
  const placeholder = copying ? "Copied from the original" : undefined;
  let input: React.ReactNode;
  switch (spec.input) {
    case "picklist":
      input = (
        <select className="studio-input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {!spec.required && <option value="">{copying ? "Copied from the original" : "—"}</option>}
          {spec.required && !value && <option value="">Choose…</option>}
          {spec.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
      break;
    case "boolean":
      input = <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
      break;
    case "longtext":
      input = <textarea className="studio-input mono" rows={3} value={String(value ?? "")} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      input = (
        <input
          className={`studio-input${spec.suggest ? " mono" : ""}`}
          type={spec.input === "number" ? "number" : "text"}
          min={spec.min}
          max={spec.max}
          list={listId}
          value={String(value ?? "")}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <label className="studio-form-row">
      <span className="studio-form-label">
        {spec.label}
        {spec.required && " *"}
      </span>
      <span className="studio-form-field">
        {input}
        {listId && (
          <datalist id={listId}>
            {objects.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
        {help && <span className="studio-form-help">{help}</span>}
      </span>
    </label>
  );
}
