import React, { useState } from "react";
import { Info, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import type { EventType, ScriptDetail, ScriptLibrary, ScriptType } from "./script-model";
import { scriptNameProblem } from "./script-names";
import { TYPE_LABEL, TYPE_ORDER } from "./script-library-logic";
import { roleOf, stageKey, usesScript, vavSettingsProblem, VAV_EVENT, VAV_OBJECT, withType, type ScriptDraft } from "./script-drafts";

interface ScriptDetailsProps {
  draft: ScriptDraft;
  /** The script as the org has it now; null for a draft that isn't in the org. */
  detail: ScriptDetail | null;
  library: ScriptLibrary;
  takenComponentNames?: readonly string[];
  deleteQueued: boolean;
  onChange: (next: ScriptDraft) => void;
  /** Replace the editor's code with the LWC's. */
  onLoadLwc: () => void;
  onQueueDelete: (deleteBundle: boolean) => void;
  onUndoDelete: () => void;
}

const EVENTS: { value: EventType; label: string }[] = [
  { value: "OnCreate", label: "On create" },
  { value: "OnUpdate", label: "On update" },
  { value: "OnDelete", label: "On delete" },
];

/** The settings around a script's code: names, type, where it runs, and removing it. */
export default function ScriptDetails({ draft, detail, library, deleteQueued, onChange, onLoadLwc, onQueueDelete, onUndoDelete }: ScriptDetailsProps) {
  const f = draft.fields;
  const role = roleOf(f.type);
  const vavProblem = vavSettingsProblem(f);
  const nameProblem = scriptNameProblem(f.name);
  const [deleteBundle, setDeleteBundle] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const scriptNames = new Map(library.scripts.map((s) => [s.id, s.name]));

  const setFields = (patch: Partial<typeof f>) => onChange({ ...draft, fields: { ...f, ...patch } });

  return (
    <div className="scripts-details">
      {detail?.drift === "lwc-ahead" && (
        <div className="scripts-callout warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="scripts-callout-body">
            <strong>The LWC has code that isn't running yet.</strong>
            <span>
              The app runs the saved script, not the component. Load the LWC's code to look at it, then save to make it live.
            </span>
          </div>
          <button className="studio-btn" onClick={onLoadLwc} disabled={detail.lwcCode === null}>
            Load the LWC's code
          </button>
        </div>
      )}
      {detail?.drift === "no-lwc" && (
        <div className="scripts-callout info" role="status">
          <Info size={16} aria-hidden="true" />
          <div className="scripts-callout-body">
            <strong>This script has no component in the org.</strong>
            <span>Its code is stored on the script record only.</span>
          </div>
        </div>
      )}
      {detail && !detail.lwc.editable && detail.lwc.exists && (
        <div className="scripts-callout info" role="status">
          <Info size={16} aria-hidden="true" />
          <div className="scripts-callout-body">
            <strong>The component is part of a package.</strong>
            <span>Its code can be read here but not changed.</span>
          </div>
        </div>
      )}

      <section aria-label="Settings">
        <h2 className="ui-section-title">Settings</h2>
        <div className="studio-form">
          <label className="studio-form-row">
            <span className="studio-form-label">Name</span>
            <span className="studio-form-field">
              <input className="studio-input ui-field" value={f.name} maxLength={80} onChange={(e) => setFields({ name: e.target.value })} />
              {nameProblem && <span className="studio-form-help scripts-problem">{nameProblem}</span>}
            </span>
          </label>
          <label className="studio-form-row">
            <span className="studio-form-label">Component name</span>
            <span className="studio-form-field">
              <input
                className="studio-input ui-field mono"
                value={f.componentName}
                spellCheck={false}
                readOnly
              />
              <span className="studio-form-help">The Lightning Web Component that holds the code. It can't be renamed.</span>
            </span>
          </label>
          <label className="studio-form-row">
            <span className="studio-form-label">Type</span>
            <span className="studio-form-field">
              <select
                className="studio-select"
                value={f.type}
                disabled={!draft.isNew}
                onChange={(e) => onChange(withType(draft, e.target.value as ScriptType))}
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              {!draft.isNew && <span className="studio-form-help">A script's type can't change after it is created.</span>}
            </span>
          </label>
          {f.type === "VisitActionValidation" && (
            <>
              <label className="studio-form-row">
                <span className="studio-form-label">Object</span>
                <span className="studio-form-field">
                  <input className="studio-input ui-field mono" value={f.objectName ?? ""} spellCheck={false} onChange={(e) => setFields({ objectName: e.target.value || null })} />
                </span>
              </label>
              <label className="studio-form-row">
                <span className="studio-form-label">Event</span>
                <span className="studio-form-field">
                  <select className="studio-select" value={f.operationEventType ?? ""} onChange={(e) => setFields({ operationEventType: (e.target.value || null) as EventType | null })}>
                    <option value="">Not set</option>
                    {EVENTS.map((ev) => (
                      <option key={ev.value} value={ev.value}>
                        {ev.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              {vavProblem && (
                <div className="scripts-callout error" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <div className="scripts-callout-body">
                    <strong>{vavProblem}</strong>
                    <span>A visit script with the wrong object or event is saved but never runs.</span>
                  </div>
                  <button className="studio-btn" onClick={() => setFields({ objectName: VAV_OBJECT, operationEventType: VAV_EVENT })}>
                    Set to {VAV_OBJECT} / {VAV_EVENT}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {role && (
        <section aria-label="Where it runs">
          <h2 className="ui-section-title">
            Where it runs
            <span className="count">{library.stageObjects.filter((s) => usesScript(draft, s, role)).length} of {library.stageObjects.length} stage objects</span>
          </h2>
          {library.stageObjects.length === 0 ? (
            <p className="scripts-muted">No stage objects in this org yet. Create one in Admin Console, then assign the script to it here.</p>
          ) : (
            <ul className="scripts-stage-list">
              {library.stageObjects.map((s) => {
                const checked = usesScript(draft, s, role);
                const other = role === "validation" ? s.validationScriptId : s.checklistScriptId;
                const otherName = other && other !== draft.key ? (scriptNames.get(other) ?? "another script") : null;
                return (
                  <li key={s.id}>
                    <label className="ui-check scripts-stage">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => onChange({ ...draft, assign: { ...draft.assign, [stageKey(s.id, role)]: e.target.checked } })}
                      />
                      <span className="scripts-stage-text">
                        <span className="scripts-stage-name">{s.name}</span>
                        <span className="scripts-stage-meta">
                          {s.objectName}
                          {checked && otherName ? ` · replaces ${otherName}` : otherName ? ` · now uses ${otherName}` : ""}
                          {s.controlledByStagePath ? " · controlled by a stage path" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="scripts-muted">
            {role === "validation"
              ? "A validation script runs when someone moves a record on a stage object that uses it."
              : "A checklist script runs when a rep opens the checklist on a stage object that uses it."}
          </p>
        </section>
      )}

      {!draft.isNew && (
        <section aria-label="Danger zone" className="scripts-danger">
          <h2 className="ui-section-title">Delete</h2>
          {deleteQueued ? (
            <div className="scripts-danger-row">
              <span>Delete is queued. Review it in the tray to remove this script.</span>
              <button className="studio-btn" onClick={onUndoDelete}>
                <Undo2 size={14} aria-hidden="true" />
                Keep the script
              </button>
            </div>
          ) : (
            <>
              <p className="scripts-muted">
                Deleting removes the script
                {detail && detail.assignedTo.length > 0 ? ` and clears it from ${detail.assignedTo.length === 1 ? "its stage object" : `${detail.assignedTo.length} stage objects`}` : ""}. Reps lose its checks the next time they sync.
              </p>
              {detail?.lwc.exists && detail.lwc.editable && (
                <label className="ui-check">
                  <input type="checkbox" checked={deleteBundle} onChange={(e) => setDeleteBundle(e.target.checked)} />
                  Also delete the {f.componentName} component
                </label>
              )}
              {confirming ? (
                <div className="scripts-danger-row">
                  <span>Queue deleting “{f.name}”?</span>
                  <button className="studio-btn ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button
                    className="studio-btn danger"
                    onClick={() => {
                      setConfirming(false);
                      onQueueDelete(!!detail?.lwc.exists && !!detail.lwc.editable && deleteBundle);
                    }}
                  >
                    Queue delete
                  </button>
                </div>
              ) : (
                <div>
                  <button className="studio-btn danger" onClick={() => setConfirming(true)}>
                    <Trash2 size={14} aria-hidden="true" />
                    Delete script…
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
