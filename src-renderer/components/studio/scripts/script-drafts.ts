import type { PendingChange } from "../changes";
import {
  scriptAssignChange,
  scriptChangeKey,
  scriptCreateChange,
  scriptFix,
  scriptSaveChange,
  type EventType,
  type ScriptDetail,
  type ScriptFields,
  type ScriptType,
  type StageObjectRow,
} from "./script-model";
import { componentNameProblem, scriptNameProblem } from "./script-names";
import type { CreateCustomScriptFix } from "./script-types";

/** What the editor holds for one script while it is open: edits kept in memory, never written until queued and applied. */
export interface ScriptDraft {
  /** The script's id, or `new:<componentName>` for one that isn't in the org yet. */
  key: string;
  isNew: boolean;
  fields: ScriptFields;
  code: string;
  /** Wanted stage-object assignments (`<stageObjectId>:<role>` -> uses this script). Missing = as in the org. */
  assign: Record<string, boolean>;
  /** The script as the org had it when it was loaded; null for a new one. */
  baseline: { fields: ScriptFields; code: string } | null;
  /** The component name was typed by hand, so it stops following the name. */
  componentNameEdited: boolean;
}

export const VAV_OBJECT = "ProviderVisit";
export const VAV_EVENT: EventType = "OnUpdate";

export const newKey = (componentName: string) => `new:${componentName}`;
export const isNewKey = (key: string) => key.startsWith("new:");
export const stageKey = (stageObjectId: string, role: "validation" | "checklist") => `${stageObjectId}:${role}`;

/** The stage-object role a type is assigned in, or null when it isn't assigned (the visit script runs by itself). */
export function roleOf(type: ScriptType): "validation" | "checklist" | null {
  return type === "Validation" ? "validation" : type === "Checklist" ? "checklist" : null;
}

export function fieldsOf(s: { name: string; componentName: string; type: ScriptType; objectName: string | null; operationEventType: EventType | null }): ScriptFields {
  return { name: s.name, componentName: s.componentName, type: s.type, objectName: s.objectName, operationEventType: s.operationEventType };
}

export function draftFromDetail(d: ScriptDetail): ScriptDraft {
  const fields = fieldsOf(d);
  return { key: d.id, isNew: false, fields, code: d.code, assign: {}, baseline: { fields, code: d.code }, componentNameEdited: true };
}

export function newDraft(init: { name: string; componentName: string; type: ScriptType; code: string; componentNameEdited?: boolean }): ScriptDraft {
  const isVav = init.type === "VisitActionValidation";
  return {
    key: newKey(init.componentName),
    isNew: true,
    fields: {
      name: init.name,
      componentName: init.componentName,
      type: init.type,
      objectName: isVav ? VAV_OBJECT : null,
      operationEventType: isVav ? VAV_EVENT : null,
    },
    code: init.code,
    assign: {},
    baseline: null,
    componentNameEdited: init.componentNameEdited ?? false,
  };
}

/** Stage-object assignments the org has for a script. */
export function orgAssignments(scriptId: string, stageObjects: readonly StageObjectRow[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of stageObjects) {
    if (s.validationScriptId === scriptId) out[stageKey(s.id, "validation")] = true;
    if (s.checklistScriptId === scriptId) out[stageKey(s.id, "checklist")] = true;
  }
  return out;
}

/** Whether a stage object uses the script, with the draft's wishes laid over the org's. */
export function usesScript(d: ScriptDraft, stage: StageObjectRow, role: "validation" | "checklist"): boolean {
  const wanted = d.assign[stageKey(stage.id, role)];
  if (wanted !== undefined) return wanted;
  if (d.isNew) return false;
  return (role === "validation" ? stage.validationScriptId : stage.checklistScriptId) === d.key;
}

/** Fields that differ from the org's (all of them for a new script). */
export function changedFields(d: ScriptDraft): Partial<ScriptFields> {
  const base = d.baseline?.fields;
  const out: Partial<ScriptFields> = {};
  for (const k of Object.keys(d.fields) as (keyof ScriptFields)[]) {
    if (!base || d.fields[k] !== base[k]) (out as Record<string, unknown>)[k] = d.fields[k];
  }
  return out;
}

export interface AssignDelta {
  stage: StageObjectRow;
  role: "validation" | "checklist";
  from: string | null;
  to: string | null;
}

/** Stage objects whose script changes because of this draft (for an existing script). */
export function assignDeltas(d: ScriptDraft, stageObjects: readonly StageObjectRow[]): AssignDelta[] {
  if (d.isNew) return [];
  const role = roleOf(d.fields.type);
  const out: AssignDelta[] = [];
  for (const stage of stageObjects) {
    for (const r of ["validation", "checklist"] as const) {
      if (r !== role && d.assign[stageKey(stage.id, r)] === undefined) continue;
      const wanted = d.assign[stageKey(stage.id, r)];
      if (wanted === undefined) continue;
      const current = r === "validation" ? stage.validationScriptId : stage.checklistScriptId;
      const uses = current === d.key;
      if (wanted === uses) continue;
      out.push({ stage, role: r, from: current, to: wanted ? d.key : null });
    }
  }
  return out;
}

/** Whether the draft has anything to save: code, fields or assignments that differ from the org's. */
export function draftIsDirty(d: ScriptDraft, stageObjects: readonly StageObjectRow[] = []): boolean {
  if (d.isNew) return true;
  if (d.code !== d.baseline?.code) return true;
  if (Object.keys(changedFields(d)).length > 0) return true;
  return assignDeltas(d, stageObjects).length > 0;
}

/** What stops the draft from being saved, in plain words. */
export function draftProblems(d: ScriptDraft, takenComponentNames: readonly string[]): string[] {
  const out: string[] = [];
  const name = scriptNameProblem(d.fields.name);
  if (name) out.push(name);
  const own = d.baseline?.fields.componentName.toLowerCase();
  const comp = componentNameProblem(
    d.fields.componentName,
    takenComponentNames.filter((n) => n.toLowerCase() !== own)
  );
  if (comp) out.push(`Component name: ${comp}`);
  if (!d.code.trim()) out.push("The script has no code yet.");
  return out;
}

/** Visit action validation scripts silently don't run without these two settings. */
export function vavSettingsProblem(f: ScriptFields): string | null {
  if (f.type !== "VisitActionValidation") return null;
  if (f.objectName !== VAV_OBJECT && f.operationEventType !== VAV_EVENT) return "Won't run until Object is ProviderVisit and Event is OnUpdate.";
  if (f.objectName !== VAV_OBJECT) return "Won't run until Object is ProviderVisit.";
  if (f.operationEventType !== VAV_EVENT) return "Won't run until Event is OnUpdate.";
  return null;
}

/** Changing the type resets the settings that belong to a type. */
export function withType(d: ScriptDraft, type: ScriptType): ScriptDraft {
  if (type === d.fields.type) return d;
  const isVav = type === "VisitActionValidation";
  const fields: ScriptFields = {
    ...d.fields,
    type,
    objectName: isVav ? VAV_OBJECT : d.fields.type === "VisitActionValidation" ? null : d.fields.objectName,
    operationEventType: isVav ? VAV_EVENT : d.fields.type === "VisitActionValidation" ? null : d.fields.operationEventType,
  };
  // Assignments belong to a role; switching type drops the ones wished for under the old one.
  return { ...d, fields, assign: {} };
}

/** The tray entries that saving this draft queues. */
export function draftChanges(d: ScriptDraft, stageObjects: readonly StageObjectRow[]): PendingChange[] {
  if (d.isNew) {
    const role = roleOf(d.fields.type);
    const assign = role
      ? stageObjects.filter((s) => usesScript(d, s, role)).map((s) => ({ stageObjectId: s.id, role }))
      : [];
    return [
      scriptCreateChange({
        name: d.fields.name.trim(),
        componentName: d.fields.componentName,
        type: d.fields.type,
        objectName: d.fields.objectName,
        operationEventType: d.fields.operationEventType,
        code: d.code,
        ...(assign.length ? { assign } : {}),
      }),
    ];
  }
  const out: PendingChange[] = [];
  const fields = changedFields(d);
  const codeChanged = d.code !== d.baseline?.code;
  if (codeChanged || Object.keys(fields).length) {
    out.push(
      scriptSaveChange({
        scriptId: d.key,
        scriptName: d.fields.name,
        from: d.baseline!,
        to: { ...(codeChanged ? { code: d.code } : {}), ...(Object.keys(fields).length ? { fields } : {}) },
      })
    );
  }
  for (const a of assignDeltas(d, stageObjects)) {
    out.push(scriptAssignChange({ stageObjectId: a.stage.id, stageObjectName: a.stage.name, role: a.role, from: a.from, to: a.to }));
  }
  return out;
}

/** The tray with these script changes queued: each replaces whatever is queued for the same key. */
export function queueScriptChanges(pending: readonly PendingChange[], changes: readonly PendingChange[]): PendingChange[] {
  const keys = new Set(changes.map((c) => scriptChangeKey(c.fix)).filter((k): k is string => !!k));
  return [...pending.filter((p) => !keys.has(scriptChangeKey(p.fix) ?? "")), ...changes];
}

/** The tray without what is queued for a script (its save, create or delete; assignments stay). */
export function withoutScriptChanges(pending: readonly PendingChange[], key: string): PendingChange[] {
  return pending.filter((p) => {
    const k = scriptChangeKey(p.fix);
    return k !== `script:${key}` && k !== `script-delete:${key}` && !(isNewKey(key) && k === `script-new:${key.slice(4)}`);
  });
}

/** Library keys that have something queued: ids for saves and deletes, `new:` keys for creates. */
export function queuedScriptKeys(pending: readonly PendingChange[]): Set<string> {
  const out = new Set<string>();
  for (const p of pending) {
    const f = scriptFix(p.fix);
    if (f?.kind === "saveCustomScript" || f?.kind === "deleteCustomScript") out.add(f.scriptId);
    if (f?.kind === "createCustomScript") out.add(newKey(f.componentName));
  }
  return out;
}

/** Whether the script has a delete waiting in the tray. */
export function deleteQueued(pending: readonly PendingChange[], key: string): boolean {
  return pending.some((p) => scriptChangeKey(p.fix) === `script-delete:${key}`);
}

/** A draft rebuilt from a create waiting in the tray (after a reload the in-memory draft is gone). */
export function draftFromQueuedCreate(pending: readonly PendingChange[], componentName: string): ScriptDraft | null {
  let hit: CreateCustomScriptFix | undefined;
  for (const p of pending) {
    const f = scriptFix(p.fix);
    if (f?.kind === "createCustomScript" && f.componentName === componentName) hit = f;
  }
  if (!hit) return null;
  const d = newDraft({ name: hit.name || componentName, componentName, type: hit.type, code: hit.code, componentNameEdited: true });
  d.fields = { ...d.fields, objectName: hit.objectName ?? null, operationEventType: hit.operationEventType ?? null };
  for (const a of hit.assign ?? []) d.assign[stageKey(a.stageObjectId, a.role)] = true;
  return d;
}

/** A fresh draft equals what the org now has — the save went through. */
export function matchesOrg(d: ScriptDraft, fresh: ScriptDetail): boolean {
  const f = fieldsOf(fresh);
  return d.code === fresh.code && (Object.keys(f) as (keyof ScriptFields)[]).every((k) => d.fields[k] === f[k]);
}
