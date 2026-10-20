import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FilePlus2, FileText, MessageSquareText, TriangleAlert, X } from "lucide-react";
import { useAssistantName } from "../../../hooks/useAssistantName";
import type { ScriptSummary, ScriptType } from "./script-model";
import { componentNameProblem, deriveComponentName, scriptNameProblem } from "./script-names";
import { existingVisitScripts, TYPE_BLURB, TYPE_LABEL, TYPE_ORDER } from "./script-library-logic";
import { blankCodeFor, templatesFor } from "./script-templates";

export type StartMode = "describe" | "template" | "blank";

export interface NewScriptInit {
  name: string;
  componentName: string;
  componentNameEdited: boolean;
  type: ScriptType;
  code: string;
  /** What the admin asked Ask Roz for; sent as the first message of the draft's conversation. */
  describe?: string;
}

interface NewScriptDialogProps {
  scripts: readonly ScriptSummary[];
  /** Component names that are taken: the library's and those of drafts and queued creates. */
  takenComponentNames: readonly string[];
  /** The visit script already queued to be created, if any (counts like an existing one). */
  onCreate: (init: NewScriptInit) => void;
  onCancel: () => void;
  onOpenScript: (id: string) => void;
  /** The type picked when the dialog opens. */
  initialType?: ScriptType;
}

type Step = "type" | "name" | "start";

/** Choose a type, name the script, then say how to start. Nothing is created until the draft is saved. */
export default function NewScriptDialog({ scripts, takenComponentNames, onCreate, onCancel, onOpenScript, initialType }: NewScriptDialogProps) {
  const assistant = useAssistantName();
  const [step, setStep] = useState<Step>("type");
  const [type, setType] = useState<ScriptType>(initialType ?? "Validation");
  const [name, setName] = useState("");
  const [componentName, setComponentName] = useState("");
  const [componentEdited, setComponentEdited] = useState(false);
  const [mode, setMode] = useState<StartMode>("describe");
  const [describe, setDescribe] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const visit = useMemo(() => existingVisitScripts(scripts), [scripts]);
  const templates = useMemo(() => templatesFor(type), [type]);
  // The first template is selected until another is picked, so its code shows straight away.
  const template = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;
  const nameProblem = name ? scriptNameProblem(name) : null;
  const compProblem = componentName ? componentNameProblem(componentName, takenComponentNames) : null;
  const nameReady = !scriptNameProblem(name) && !componentNameProblem(componentName, takenComponentNames);
  const startReady = mode === "blank" || (mode === "describe" && describe.trim().length > 0) || (mode === "template" && !!template);

  const setNameAndDerive = (value: string) => {
    setName(value);
    if (!componentEdited) setComponentName(deriveComponentName(value));
  };

  const pickType = (t: ScriptType) => {
    setType(t);
    setTemplateId(null);
  };

  const create = () => {
    if (!nameReady || !startReady) return;
    onCreate({
      name: name.trim(),
      componentName,
      componentNameEdited: componentEdited,
      type,
      code: mode === "template" && template ? template.code : blankCodeFor(type),
      describe: mode === "describe" ? describe.trim() : undefined,
    });
  };

  const stepNumber = step === "type" ? 1 : step === "name" ? 2 : 3;

  return (
    <div className="studio-modal-backdrop" onClick={onCancel}>
      <div className="studio-modal scripts-new" role="dialog" aria-label="New script" onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">New script · step {stepNumber} of 3</span>
          <button className="ui-icon-btn" onClick={onCancel} title="Close" aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {step === "type" && (
          <>
            <h2 className="studio-inspector-title">What should the script do?</h2>
            <div className="scripts-choices" role="radiogroup" aria-label="Script type">
              {TYPE_ORDER.map((t) => (
                <button key={t} role="radio" aria-checked={type === t} className={`scripts-choice${type === t ? " selected" : ""}`} onClick={() => pickType(t)}>
                  <span className="scripts-choice-title">{TYPE_LABEL[t]}</span>
                  <span className="scripts-choice-blurb">{TYPE_BLURB[t]}</span>
                </button>
              ))}
            </div>
            {type === "VisitActionValidation" && visit.length > 0 && (
              <div className="scripts-callout warning" role="note">
                <TriangleAlert size={16} aria-hidden="true" />
                <div>
                  <strong>A visit script already exists.</strong> Only the first one runs; add your checks to it instead.
                  <div>
                    <button className="studio-link-btn" onClick={() => onOpenScript(visit[0].id)}>
                      Open {visit[0].name}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {step === "name" && (
          <>
            <h2 className="studio-inspector-title">Name your {TYPE_LABEL[type].toLowerCase()} script</h2>
            <div className="studio-form">
              <label className="studio-form-row">
                <span className="studio-form-label">Name</span>
                <span className="studio-form-field">
                  <input className="studio-input ui-field" value={name} maxLength={80} autoFocus placeholder="e.g. Visit checks" onChange={(e) => setNameAndDerive(e.target.value)} />
                  {nameProblem && <span className="studio-form-help scripts-problem">{nameProblem}</span>}
                </span>
              </label>
              <label className="studio-form-row">
                <span className="studio-form-label">Component name</span>
                <span className="studio-form-field">
                  <input
                    className="studio-input ui-field mono"
                    value={componentName}
                    maxLength={80}
                    spellCheck={false}
                    onChange={(e) => {
                      setComponentEdited(true);
                      setComponentName(e.target.value);
                    }}
                  />
                  {compProblem ? (
                    <span className="studio-form-help scripts-problem">{compProblem}</span>
                  ) : (
                    <span className="studio-form-help">The script is stored as a Lightning Web Component with this name. It can't change later.</span>
                  )}
                </span>
              </label>
            </div>
          </>
        )}

        {step === "start" && (
          <>
            <h2 className="studio-inspector-title">How do you want to start?</h2>
            <div className="scripts-choices" role="radiogroup" aria-label="Starting point">
              <button role="radio" aria-checked={mode === "describe"} className={`scripts-choice${mode === "describe" ? " selected" : ""}`} onClick={() => setMode("describe")}>
                <span className="scripts-choice-title">
                  <MessageSquareText size={14} aria-hidden="true" /> Describe it
                </span>
                <span className="scripts-choice-blurb">Tell {assistant} what it should check and it writes the first version.</span>
              </button>
              <button role="radio" aria-checked={mode === "template"} className={`scripts-choice${mode === "template" ? " selected" : ""}`} onClick={() => setMode("template")}>
                <span className="scripts-choice-title">
                  <FileText size={14} aria-hidden="true" /> Start from a template
                </span>
                <span className="scripts-choice-blurb">A working script you change to fit.</span>
              </button>
              <button role="radio" aria-checked={mode === "blank"} className={`scripts-choice${mode === "blank" ? " selected" : ""}`} onClick={() => setMode("blank")}>
                <span className="scripts-choice-title">
                  <FilePlus2 size={14} aria-hidden="true" /> Blank
                </span>
                <span className="scripts-choice-blurb">The empty wrapper for this type, ready for your code.</span>
              </button>
            </div>
            {mode === "describe" && (
              <label className="ui-label">
                What should it check?
                <textarea
                  className="ui-field scripts-describe"
                  value={describe}
                  autoFocus
                  placeholder="e.g. Block the visit if a sample was left from an expired lot"
                  onChange={(e) => setDescribe(e.target.value)}
                />
              </label>
            )}
            {mode === "template" && (
              <div className="scripts-templates">
                <ul className="scripts-template-list" role="listbox" aria-label="Templates">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button role="option" aria-selected={template?.id === t.id} className={`scripts-template${template?.id === t.id ? " selected" : ""}`} onClick={() => setTemplateId(t.id)}>
                        <span className="scripts-choice-title">{t.title}</span>
                        <span className="scripts-choice-blurb">{t.blurb}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <pre className="scripts-template-preview" aria-label="Template code" tabIndex={0}>
                  {template ? template.code : "Pick a template to preview its code."}
                </pre>
              </div>
            )}
          </>
        )}

        <div className="studio-modal-actions scripts-new-actions">
          {step !== "type" && (
            <button className="studio-btn ghost scripts-new-back" onClick={() => setStep(step === "start" ? "name" : "type")}>
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
          )}
          <button className="studio-btn ghost" onClick={onCancel}>
            Cancel
          </button>
          {step === "type" && (
            <button className="studio-btn primary" onClick={() => setStep("name")}>
              Next
            </button>
          )}
          {step === "name" && (
            <button className="studio-btn primary" disabled={!nameReady} onClick={() => setStep("start")}>
              Next
            </button>
          )}
          {step === "start" && (
            <button className="studio-btn primary" disabled={!startReady} onClick={create}>
              Create draft
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
