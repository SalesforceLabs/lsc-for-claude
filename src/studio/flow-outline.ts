/**
 * describeFlow() — turn a record-triggered flow's Tooling API `Metadata` into
 * a plain outline for LSC Studio's inspector: when it runs, the path it takes,
 * and what it changes. Health checks flag patterns that hurt with LSC Mobile,
 * where a sync uploads many records at once and runs this flow on each.
 *
 * Built straight from the metadata — no guessing — so it can be shown as fact
 * and handed to Claude as grounding for a fuller explanation.
 */

import type { FlowOutline, FlowStep, StudioFinding } from "./types.js";

/** Flow metadata as returned by the Tooling API; each element type has its own shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = Record<string, any>;

/** Metadata arrays that hold flow elements (things a connector can point at). */
const ELEMENT_KEYS = [
  "decisions",
  "assignments",
  "recordLookups",
  "recordCreates",
  "recordUpdates",
  "recordDeletes",
  "recordRollbacks",
  "actionCalls",
  "apexPluginCalls",
  "subflows",
  "loops",
  "customErrors",
  "collectionProcessors",
  "transforms",
  "waits",
  "screens",
] as const;

/** Elements that read or write records or call out — the ones that hit limits inside a loop. */
const LIMITED_KEYS = new Set(["recordLookups", "recordCreates", "recordUpdates", "recordDeletes", "actionCalls", "apexPluginCalls", "subflows"]);
/** Elements whose failure fails the save unless they have a fault path. */
const FAULTABLE_KEYS = new Set(["recordCreates", "recordUpdates", "recordDeletes", "actionCalls", "apexPluginCalls"]);

const EVENTS: Record<string, string> = {
  Create: "created",
  Update: "updated",
  CreateAndUpdate: "created or updated",
  Delete: "deleted",
};

const ACTIONS: Record<string, string> = {
  apex: "Runs Apex",
  emailAlert: "Sends email alert",
  emailSimple: "Sends an email",
  customNotificationAction: "Sends a custom notification",
  chatterPost: "Posts to Chatter",
  submit: "Submits for approval",
  quickAction: "Runs quick action",
  externalService: "Calls external service",
  flow: "Runs flow",
};

// ─── Formatting ─────────────────────────────────────────────────────────────

function ref(r: string): string {
  if (r === "$Record") return "the record";
  if (r.startsWith("$Record.")) return r.slice("$Record.".length);
  if (r.startsWith("$Record__Prior.")) return `previous ${r.slice("$Record__Prior.".length)}`;
  if (r.startsWith("$Setup.")) return `setting ${r.slice("$Setup.".length)}`;
  if (r.startsWith("$User.")) return `running user's ${r.slice("$User.".length)}`;
  return r;
}

function value(v: El | null | undefined): string {
  if (!v) return "";
  if (v.stringValue != null) return `"${v.stringValue}"`;
  if (v.booleanValue != null) return String(v.booleanValue);
  if (v.numberValue != null) return String(v.numberValue);
  if (v.dateValue != null) return String(v.dateValue);
  if (v.dateTimeValue != null) return String(v.dateTimeValue);
  if (v.elementReference != null) return ref(String(v.elementReference));
  if (v.formulaExpression != null) return String(v.formulaExpression);
  return "";
}

const OPERATORS: Record<string, string> = {
  EqualTo: "=",
  NotEqualTo: "≠",
  GreaterThan: ">",
  GreaterThanOrEqualTo: "≥",
  LessThan: "<",
  LessThanOrEqualTo: "≤",
  Contains: "contains",
  StartsWith: "starts with",
  EndsWith: "ends with",
  In: "is one of",
  NotIn: "isn't one of",
};

function condition(left: string, operator: string, right: El | null | undefined): string {
  const r = value(right);
  if (operator === "IsNull" || operator === "IsBlank") return `${left} ${r === "false" ? "is set" : "is empty"}`;
  if (operator === "IsChanged") return `${left} ${r === "false" ? "didn't change" : "changed"}`;
  const op = OPERATORS[operator] ?? operator;
  return r ? `${left} ${op} ${r}` : `${left} ${op}`;
}

/** Join conditions by "and"/"or", or spell out custom logic like "1 AND (2 OR 3)". */
function joined(conds: string[], logic: string | null | undefined): string {
  const l = (logic || "and").toLowerCase();
  if (conds.length <= 1 || l === "and" || l === "or") return conds.join(` ${l} `);
  return `${logic}, where ${conds.map((c, i) => `${i + 1}: ${c}`).join("; ")}`;
}

function filters(el: El): string[] {
  return (el.filters ?? []).map((f: El) => condition(String(f.field), String(f.operator), f.value));
}

function fieldList(assignments: El[] | null | undefined): string {
  const fields = (assignments ?? []).map((a) => String(a.field ?? a.name));
  if (fields.length === 0) return "";
  return fields.length > 4 ? `${fields.slice(0, 4).join(", ")} and ${fields.length - 4} more` : fields.join(", ");
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`);

function where(el: El): string {
  const f = filters(el);
  return f.length ? ` where ${joined(f, el.filterLogic)}` : "";
}

// ─── Parsing ────────────────────────────────────────────────────────────────

interface Element {
  key: (typeof ELEMENT_KEYS)[number];
  el: El;
}

const target = (c: El | null | undefined): string | undefined => c?.targetReference || undefined;

/** True when a record update writes back to the record that triggered the flow. */
function updatesTriggeringRecord(el: El, object: string | null): boolean {
  if (el.inputReference === "$Record") return true;
  return (
    !!object &&
    el.object === object &&
    (el.filters ?? []).some((f: El) => f.field === "Id" && f.operator === "EqualTo" && f.value?.elementReference === "$Record.Id")
  );
}

export interface FlowDescription {
  outline: FlowOutline;
  findings: StudioFinding[];
}

export function describeFlow(meta: El): FlowDescription {
  const start: El = meta.start ?? {};
  const object: string | null = start.object ?? null;
  const triggerType = String(start.triggerType ?? "");
  const afterSave = triggerType === "RecordAfterSave";
  const recordTriggerType = String(start.recordTriggerType ?? "");

  const elements = new Map<string, Element>();
  for (const key of ELEMENT_KEYS) for (const el of (meta[key] ?? []) as El[]) if (el?.name) elements.set(el.name, { key, el });

  const steps: FlowStep[] = [];
  const effects: string[] = [];
  const visited = new Set<string>();
  const inLoop: string[] = [];
  const updatesSelf: string[] = [];
  const unhandled: string[] = [];
  const errors: string[] = [];

  const labelOf = (name: string) => elements.get(name)?.el.label || name;
  const push = (depth: number, kind: FlowStep["kind"], text: string) => steps.push({ depth, kind, text });

  function describe({ key, el }: Element): { kind: FlowStep["kind"]; text: string; effect?: string } {
    const label = el.label || el.name;
    switch (key) {
      case "recordLookups":
        return { kind: "lookup", text: `${label}: gets ${el.object ?? "records"}${where(el)}` };
      case "assignments": {
        const items: El[] = el.assignmentItems ?? [];
        const onRecord = items.filter((a) => String(a.assignToReference).startsWith("$Record."));
        const text = `${label}: sets ${items.map((a) => ref(String(a.assignToReference))).join(", ") || "variables"}`;
        // In a before-save flow, assigning $Record fields is how the record gets changed.
        const effect =
          onRecord.length && !afterSave ? `Sets ${onRecord.map((a) => ref(String(a.assignToReference))).join(", ")} on the record` : undefined;
        return { kind: effect ? "change" : "assign", text, effect };
      }
      case "recordUpdates": {
        const fields = fieldList(el.inputAssignments);
        const sets = fields ? `: sets ${fields}` : "";
        if (updatesTriggeringRecord(el, object)) {
          if (afterSave) updatesSelf.push(label);
          const effect = afterSave ? `Saves the record again${sets}` : `Sets ${fields || "fields"} on the record before it's saved`;
          return { kind: "change", text: `${label}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`, effect };
        }
        const effect = el.object ? `Updates ${el.object} records${where(el)}${sets}` : `Updates the records in ${ref(String(el.inputReference))}${sets}`;
        return { kind: "change", text: `${label}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`, effect };
      }
      case "recordCreates": {
        const fields = fieldList(el.inputAssignments);
        const effect = el.object
          ? `Creates ${article(el.object)}${fields ? ` (sets ${fields})` : ""}`
          : `Creates the records in ${ref(String(el.inputReference))}`;
        return { kind: "change", text: `${label}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`, effect };
      }
      case "recordDeletes": {
        const effect = el.object ? `Deletes ${el.object} records${where(el)}` : `Deletes the records in ${ref(String(el.inputReference))}`;
        return { kind: "change", text: `${label}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`, effect };
      }
      case "recordRollbacks":
        return { kind: "change", text: `${label}: rolls back changes`, effect: "Rolls back the changes made so far" };
      case "actionCalls":
      case "apexPluginCalls": {
        const verb = key === "apexPluginCalls" ? "Runs Apex plugin" : (ACTIONS[el.actionType] ?? "Runs action");
        const name = el.actionName ?? el.apexClass ?? el.actionType ?? "";
        const effect = `${verb}${name ? ` ${name}` : ""}`;
        return { kind: "action", text: `${label}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`, effect };
      }
      case "subflows":
        return { kind: "action", text: `${label}: runs flow ${el.flowName}`, effect: `Runs flow ${el.flowName}` };
      case "customErrors": {
        const message = (el.customErrorMessages ?? []).map((m: El) => m.errorMessage).find(Boolean);
        const effect = `Stops the save with an error${message ? `: "${message}"` : ""}`;
        errors.push(label);
        return { kind: "error", text: `${label}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`, effect };
      }
      case "collectionProcessors":
        return { kind: "assign", text: `${label}: filters or sorts ${ref(String(el.collectionReference ?? "a collection"))}` };
      default:
        return { kind: "assign", text: label };
    }
  }

  /** How a branch ends when it doesn't lead anywhere new. */
  const tail = (next: string | undefined, loops: Set<string>) => (!next ? " — stops" : loops.has(next) ? " — next item" : "");

  /**
   * Follow connectors from `name`, emitting steps; decisions and loops recurse
   * one level deeper. `deferred` paths run after the save, in their own transaction.
   */
  function walk(name: string | undefined, depth: number, loops: Set<string>, deferred = false): void {
    while (name) {
      if (loops.has(name)) return; // back to the loop for the next item
      const node = elements.get(name);
      if (!node) return;
      if (visited.has(name)) {
        push(depth, "goto", `Continues at "${labelOf(name)}"`);
        return;
      }
      visited.add(name);
      const { key, el } = node;
      const label = el.label || el.name;

      if (key === "decisions") {
        push(depth, "decision", label);
        for (const rule of (el.rules ?? []) as El[]) {
          const conds = (rule.conditions ?? []).map((c: El) => condition(ref(String(c.leftValueReference)), String(c.operator), c.rightValue));
          const next = target(rule.connector);
          push(depth + 1, "outcome", `${rule.label || rule.name}${conds.length ? ` — when ${joined(conds, rule.conditionLogic)}` : ""}${tail(next, loops)}`);
          walk(next, depth + 2, loops, deferred);
        }
        const fallback = target(el.defaultConnector);
        push(depth + 1, "outcome", `Otherwise (${el.defaultConnectorLabel || "default"})${tail(fallback, loops)}`);
        walk(fallback, depth + 2, loops, deferred);
        return;
      }

      if (key === "loops") {
        push(depth, "loop", `${label}: for each item in ${ref(String(el.collectionReference))}`);
        walk(target(el.nextValueConnector), depth + 1, new Set([...loops, name]), deferred);
        name = target(el.noMoreValuesConnector);
        continue;
      }

      const d = describe(node);
      push(depth, d.kind, d.text);
      if (d.effect) effects.push(d.effect);
      if (loops.size && LIMITED_KEYS.has(key)) inLoop.push(label);
      if (FAULTABLE_KEYS.has(key)) {
        if (el.faultConnector) {
          push(depth + 1, "outcome", "If it fails");
          walk(target(el.faultConnector), depth + 2, loops, deferred);
        } else if (!deferred && (afterSave || triggerType === "RecordBeforeDelete")) {
          unhandled.push(label);
        }
      }
      name = target(el.connector);
    }
  }

  walk(target(start.connector) ?? meta.startElementReference, 0, new Set());
  for (const path of (start.scheduledPaths ?? []) as El[]) {
    push(0, "path", scheduledPathLabel(path));
    walk(target(path.connector), 1, new Set(), true);
  }

  const conditions = start.filterFormula ? [String(start.filterFormula)] : filters(start);
  const conditionLogic = start.filterFormula ? "formula" : conditions.length > 1 ? String(start.filterLogic ?? "and") : null;
  const outline: FlowOutline = {
    object,
    trigger: triggerSentence(object, triggerType, recordTriggerType),
    conditions,
    conditionLogic,
    onlyWhenChanged: !!start.doesRequireRecordChangedToMeetCriteria,
    steps,
    effects,
  };

  return { outline, findings: flowFindings({ object, triggerType, recordTriggerType, conditions, inLoop, updatesSelf, unhandled, errors }) };
}

function triggerSentence(object: string | null, triggerType: string, recordTriggerType: string): string {
  const what = object ? article(object) : "a record";
  if (triggerType === "RecordBeforeDelete") return `Before ${what} is deleted`;
  const when = triggerType === "RecordBeforeSave" ? "Before" : "After";
  return `${when} ${what} is saved — when it's ${EVENTS[recordTriggerType] ?? recordTriggerType}`;
}

function scheduledPathLabel(path: El): string {
  if (path.pathType === "AsyncAfterCommit") return `Afterwards, separately (${path.label || "run asynchronously"})`;
  const n = Number(path.offsetNumber ?? 0);
  const unit = String(path.offsetUnit ?? "").toLowerCase();
  const from = path.recordField ? path.recordField : "the save";
  return `Later: ${path.label || path.name || "scheduled path"} — ${Math.abs(n)} ${unit} ${n < 0 ? "before" : "after"} ${from}`;
}

// ─── Health checks ──────────────────────────────────────────────────────────

interface FlowFacts {
  object: string | null;
  triggerType: string;
  recordTriggerType: string;
  conditions: string[];
  inLoop: string[];
  updatesSelf: string[];
  unhandled: string[];
  errors: string[];
}

const names = (labels: string[]) => labels.map((l) => `"${l}"`).join(", ");

function flowFindings(f: FlowFacts): StudioFinding[] {
  const findings: StudioFinding[] = [];
  const object = f.object ?? "record";

  if (f.inLoop.length) {
    findings.push({
      severity: "warning",
      title: "Reads or saves records inside a loop",
      detail: `${names(f.inLoop)} run${f.inLoop.length === 1 ? "s" : ""} once per item. When an iPad sync uploads many ${object} records at once, this can hit Salesforce limits and fail the whole batch. Collect the records in the loop and save or look them up once after it.`,
    });
  }
  if (f.updatesSelf.length) {
    findings.push({
      severity: "warning",
      title: "Saves the record it was triggered by again",
      detail: `${names(f.updatesSelf)} update${f.updatesSelf.length === 1 ? "s" : ""} the triggering ${object} after it's saved, which saves it a second time and re-runs its triggers and flows. Set these fields in a before-save flow instead.`,
    });
  }
  if (f.recordTriggerType.includes("Update") && f.conditions.length === 0) {
    findings.push({
      severity: "warning",
      title: "Runs on every save",
      detail: `There are no entry conditions, so this runs every time a ${object} is saved — including every record an iPad sync uploads. Add entry conditions, and choose to run only when a record is updated to meet them.`,
    });
  }
  if (f.errors.length) {
    findings.push({
      severity: "info",
      title: "Can block the save with an error",
      detail: `${names(f.errors)} stop${f.errors.length === 1 ? "s" : ""} the save. Reps working offline only see this when the record syncs, not when they tap Save. To check on the iPad itself, use a custom script.`,
    });
  }
  if (f.unhandled.length) {
    findings.push({
      severity: "info",
      title: "No error handling",
      detail: `If ${names(f.unhandled)} fail${f.unhandled.length === 1 ? "s" : ""}, the whole ${f.triggerType === "RecordBeforeDelete" ? "delete" : "save"} fails — on the iPad, the record fails to sync. Add a fault path to handle the error.`,
    });
  }
  return findings;
}

/** The outline as indented text, for "Ask Claude about this". */
export function outlineText(o: FlowOutline): string {
  const lines = [o.trigger];
  if (o.conditions.length) lines.push(`Entry conditions (${o.conditionLogic ?? "and"}${o.onlyWhenChanged ? ", only when the record changes to meet them" : ""}):`, ...o.conditions.map((c) => `  - ${c}`));
  lines.push("Steps:", ...o.steps.map((s) => `${"  ".repeat(s.depth + 1)}- ${s.text}`));
  if (o.effects.length) lines.push("What it changes:", ...o.effects.map((e) => `  - ${e}`));
  return lines.join("\n");
}
