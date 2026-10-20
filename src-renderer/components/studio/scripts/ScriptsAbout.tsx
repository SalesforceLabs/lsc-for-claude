import React from "react";
import {
  ArrowRight,
  Ban,
  CircleCheck,
  ClipboardCheck,
  Code,
  Database,
  FileCode2,
  FileText,
  Hand,
  ListChecks,
  Plus,
  Route,
  Stethoscope,
  TriangleAlert,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAssistantName } from "../../../hooks/useAssistantName";
import type { ScriptType } from "./script-model";
import { TYPE_LABEL } from "./script-library-logic";

interface ScriptsAboutProps {
  /** Start a new script, optionally of one type. */
  onNew: (type?: ScriptType) => void;
  /** Shown when the org already has scripts and this page was opened from the list. */
  onClose?: () => void;
}

interface Kind {
  type: ScriptType;
  icon: LucideIcon;
  when: string;
  wiredBy: string;
  note: string;
}

const KINDS: Kind[] = [
  {
    type: "VisitActionValidation",
    icon: Stethoscope,
    when: "A rep saves, signs or submits a visit.",
    wiredBy: "Runs for every visit. Set the object to ProviderVisit and the event to On update.",
    note: "Only one runs per org (the oldest), so put all your visit checks in it.",
  },
  {
    type: "Validation",
    icon: Workflow,
    when: "Someone runs a workflow action, such as moving an inquiry to its next stage.",
    wiredBy: "A stage object's Validation script field points at it.",
    note: "Each stage object can have its own.",
  },
  {
    type: "Checklist",
    icon: ListChecks,
    when: "A rep taps the info icon on a Record Update action.",
    wiredBy: "A stage object's Checklist script field points at it.",
    note: "Shows what's done and what's missing, before the rep tries the action.",
  },
];

const OUTCOMES: { icon: LucideIcon; tone: "error" | "warning" | "pass"; status: string; result: string }[] = [
  { icon: Ban, tone: "error", status: "error", result: "The action is blocked until the rep fixes it." },
  { icon: TriangleAlert, tone: "warning", status: "warning", result: "The rep sees every warning and can carry on." },
  { icon: CircleCheck, tone: "pass", status: "success", result: "Checklists show it. Validations stay quiet." },
];

const LADDER: { icon: LucideIcon; title: string; use: string; current?: boolean }[] = [
  { icon: FileText, title: "Validation rule", use: "One object, and a formula can express the check." },
  {
    icon: FileCode2,
    title: "Custom script",
    use: "The check spans the visit's samples, product details or attendees, needs a query, or has to work offline on the iPad.",
    current: true,
  },
  { icon: Code, title: "Apex trigger", use: "The data isn't synced to the iPad. Runs online only, so iPad reps miss it until they sync." },
];

function Node({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="scripts-about-node">
      <span className="scripts-about-node-icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="scripts-about-node-title">{title}</span>
      <div className="scripts-about-node-body">{children}</div>
    </div>
  );
}

function Arrow() {
  return (
    <span className="scripts-about-arrow" aria-hidden="true">
      <ArrowRight size={16} />
    </span>
  );
}

/** What custom scripts are, when each kind runs and when to use one, drawn as diagrams. The page's empty state. */
export default function ScriptsAbout({ onNew, onClose }: ScriptsAboutProps) {
  const assistant = useAssistantName();
  return (
    <div className="scripts-about ui-enter">
      <div className="scripts-about-inner">
        <header className="scripts-about-head">
          <span className="scripts-about-logo">
            <FileCode2 size={20} aria-hidden="true" />
          </span>
          <div className="scripts-about-intro">
            <h1>{onClose ? "How custom scripts work" : "No custom scripts yet"}</h1>
            <p>
              A custom script is a short piece of JavaScript that checks a record when a rep acts on it. It runs on the web and in the iPad app, offline
              too. Describe what you want checked and {assistant} writes the first version, or start from a template.
            </p>
          </div>
          <div className="scripts-about-actions">
            <button className="studio-btn primary" onClick={() => onNew()}>
              <Plus size={14} aria-hidden="true" />
              New script
            </button>
            {onClose && (
              <button className="ui-icon-btn" aria-label="Close" title="Close" onClick={onClose}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <section aria-labelledby="scripts-about-flow">
          <h2 className="ui-section-title" id="scripts-about-flow">
            How a script runs
          </h2>
          <div className="scripts-about-flow">
            <Node icon={Hand} title="A rep acts">
              Saves, signs or submits a visit, or runs a workflow action.
            </Node>
            <Arrow />
            <Node icon={FileCode2} title="The script runs">
              <span>
                It reads the record with <code>record</code>, queries other data with <code>db</code> and checks who's asking with <code>user</code>.
              </span>
              <span className="scripts-about-chips">
                <span className="ui-pill">Web</span>
                <span className="ui-pill">iPad, offline too</span>
              </span>
            </Node>
            <Arrow />
            <Node icon={ClipboardCheck} title="It returns results">
              <span>A list of messages, each with a status.</span>
              <code className="scripts-about-code">{"[{ title, status }]"}</code>
            </Node>
            <Arrow />
            <div className="scripts-about-outcomes" role="list" aria-label="What the rep sees">
              {OUTCOMES.map((o) => (
                <div key={o.status} className={`scripts-about-outcome ${o.tone}`} role="listitem">
                  <o.icon size={16} aria-hidden="true" />
                  <span>
                    <code>{o.status}</code>
                    <span className="scripts-about-outcome-text">{o.result}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="scripts-about-kinds">
          <h2 className="ui-section-title" id="scripts-about-kinds">
            Three kinds
          </h2>
          <div className="scripts-about-kinds">
            {KINDS.map((k) => (
              <article key={k.type} className="scripts-about-kind">
                <div className="scripts-about-kind-head">
                  <span className="scripts-about-node-icon">
                    <k.icon size={16} aria-hidden="true" />
                  </span>
                  <h3>{TYPE_LABEL[k.type]}</h3>
                </div>
                <dl>
                  <dt>Runs when</dt>
                  <dd>{k.when}</dd>
                  <dt>Turned on by</dt>
                  <dd>{k.wiredBy}</dd>
                </dl>
                <p className="scripts-about-kind-note">{k.note}</p>
                <button className="studio-btn sm" onClick={() => onNew(k.type)}>
                  <Plus size={14} aria-hidden="true" />
                  New {TYPE_LABEL[k.type].toLowerCase()} script
                </button>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="scripts-about-when">
          <h2 className="ui-section-title" id="scripts-about-when">
            When to use one
          </h2>
          <ol className="scripts-about-ladder">
            {LADDER.map((step, i) => (
              <li key={step.title} className={step.current ? "current" : undefined} aria-current={step.current ? "true" : undefined}>
                <span className="scripts-about-node-icon">
                  <step.icon size={16} aria-hidden="true" />
                </span>
                <span className="scripts-about-ladder-text">
                  <span className="scripts-about-ladder-title">
                    {step.title}
                    {i === 0 && <span className="ui-pill pass">Try first</span>}
                    {i === LADDER.length - 1 && <span className="ui-pill warning">Last resort</span>}
                  </span>
                  <span>{step.use}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="scripts-about-where">
          <h2 className="ui-section-title" id="scripts-about-where">
            Where it lives
          </h2>
          <div className="scripts-about-flow compact">
            <Node icon={Code} title="LWC bundle">
              The code, in a component with no markup.
            </Node>
            <Arrow />
            <Node icon={Database} title="Custom script record">
              Holds a copy of the code. This copy is what runs.
            </Node>
            <Arrow />
            <Node icon={Route} title="Stage object or visit">
              Decides when it runs.
            </Node>
          </div>
          <p className="scripts-about-foot">
            When you save in Studio, the code goes to the component and the record together, so Admin Console's Refresh never undoes your edit. Reps
            need read access to the script records, and objects a script queries must be synced to the iPad.
          </p>
        </section>
      </div>
    </div>
  );
}
