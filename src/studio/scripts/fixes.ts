/**
 * Preview and apply for the custom script change kinds: create, save, delete and assign (plus the older
 * `setCustomScriptCode`, now on the same save path). Same contract as edits.ts — previews re-read the org and
 * set `blocked` when it no longer matches what the editor saw; applying re-runs the preview and returns the
 * inverse fix.
 */

import { describeSObject } from "../../salesforce/cli.js";
import { assertId } from "../change-helpers.js";
import { lineCount, lineDiff } from "../diff.js";
import { step, type FixTracker } from "../fix-progress.js";
import { query, type Row } from "../helpers.js";
import { isProductionOrg } from "../metadata/live.js";
import type { FixChange, FixPreview, FixResult } from "../types.js";
import { analyzeScript, CODE_TEXT_LIMIT } from "./checks.js";
import { findBundle, lwcNameProblem, readBundle } from "./lwc.js";
import { bundleEditable } from "./library.js";
import { assignStage, createScript, deleteScript, fieldsOf, readScriptRow, saveScript, stageReferences, type SaveHooks } from "./save.js";
import type {
  AssignCustomScriptFix,
  CreateCustomScriptFix,
  DeleteCustomScriptFix,
  SaveCustomScriptFix,
  ScriptFields,
  ScriptRole,
} from "./types.js";

export type ScriptKindFix = CreateCustomScriptFix | SaveCustomScriptFix | DeleteCustomScriptFix | AssignCustomScriptFix;

/** The script fix kinds this module handles (not the older `setCustomScriptCode`). */
export const isScriptKindFix = (fix: { kind: string }): fix is ScriptKindFix =>
  fix.kind === "createCustomScript" || fix.kind === "saveCustomScript" || fix.kind === "deleteCustomScript" || fix.kind === "assignCustomScript";

const sizeOf = (code: string) => `${lineCount(code)} lines, ${code.length} characters`;
const sameCode = (a: string, b: string) => a.trim() === b.trim();
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(none)" : String(v));

const FIELD_LABEL: Record<keyof ScriptFields, string> = {
  name: "Name",
  componentName: "Component",
  type: "Type",
  objectName: "Object",
  operationEventType: "Event",
};

const hooksFor = (progress?: FixTracker): SaveHooks => ({
  step: (key, fn) => step(progress, key, fn),
  onStatus: progress?.statusHook("lwc"),
});

async function codeTextWritable(org: string): Promise<boolean> {
  try {
    const d = await describeSObject("LifeScienceCustomScript", org);
    return !!(d.success && d.data?.fields.find((f) => f.name === "CodeText")?.updateable);
  } catch {
    return false;
  }
}

/** Review warnings from the static checks: errors and warnings only. */
function checkWarnings(code: string, fields: ScriptFields): string[] {
  return analyzeScript(code, { type: fields.type, objectName: fields.objectName, operationEventType: fields.operationEventType })
    .filter((d) => d.severity !== "info")
    .map((d) => d.message);
}

/** Problems that make a save impossible, in plain words. */
function fieldProblem(fields: ScriptFields, only?: (keyof ScriptFields)[]): string | null {
  const check = (k: keyof ScriptFields) => !only || only.includes(k);
  if (check("name") && !fields.name.trim()) return "The script needs a name.";
  if (check("componentName")) {
    const lwc = lwcNameProblem(fields.componentName);
    if (lwc) return lwc;
  }
  if (check("type") && fields.type !== "Validation" && fields.type !== "Checklist" && fields.type !== "VisitActionValidation") return "Pick a script type.";
  return null;
}

function codeProblem(code: string): string | null {
  if (code.length > CODE_TEXT_LIMIT) {
    return `The script is ${code.length.toLocaleString("en-US")} characters, over the ${CODE_TEXT_LIMIT.toLocaleString("en-US")} the platform can store.`;
  }
  return null;
}

// --- Save ------------------------------------------------------------------------------------

interface SavePlan {
  preview: FixPreview;
  current?: { code: string; fields: ScriptFields };
  next?: { code: string; fields: ScriptFields };
  writable: boolean;
}

async function planSave(fix: SaveCustomScriptFix, org: string, progress?: FixTracker): Promise<SavePlan> {
  assertId(fix.scriptId);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  const blocked = (message: string): SavePlan => ({ preview: { ...preview, blocked: message }, writable: false });

  const row = await step(progress, "read", () => readScriptRow(org, fix.scriptId));
  if (!row) return blocked(`${fix.scriptName} no longer exists.`);
  const current = { code: String(row.CodeText ?? ""), fields: fieldsOf(row) };
  const next = {
    code: fix.to.code ?? fix.from.code,
    fields: { ...fix.from.fields, ...(fix.to.fields ?? {}) } as ScriptFields,
  };

  // Org already holds the result.
  const fieldKeys = Object.keys(FIELD_LABEL) as (keyof ScriptFields)[];
  const sameFields = (a: ScriptFields, b: ScriptFields) => fieldKeys.every((k) => (a[k] ?? null) === (b[k] ?? null));
  if (sameCode(current.code, next.code) && sameFields(current.fields, next.fields)) return blocked("Already applied. Refresh the library.");
  if (!sameCode(current.code, fix.from.code) || !sameFields(current.fields, fix.from.fields)) {
    return blocked(`${fix.scriptName} changed in the org since you opened it. Reload it and try again.`);
  }

  // Only fields being changed are checked: a script the org already holds may predate today's naming rules.
  const edited = Object.keys(fix.to.fields ?? {}) as (keyof ScriptFields)[];
  const problem = (edited.length ? fieldProblem(next.fields, edited) : null) ?? codeProblem(next.code);
  if (problem) return blocked(problem);

  const writable = await step(progress, "describe", () => codeTextWritable(org));
  const codeChanged = !sameCode(current.code, next.code);
  const target = next.fields.componentName;

  if (target !== current.fields.componentName) {
    const [taken] = await query(`SELECT Id, Name FROM LifeScienceCustomScript WHERE ComponentName = '${target}' AND Id != '${fix.scriptId}' LIMIT 1`, org);
    if (taken) return blocked(`${String(taken.Name)} already uses the component ${target}.`);
  }

  if (codeChanged || target !== current.fields.componentName) {
    const bundle = await findBundle(org, target);
    if (bundle && !bundleEditable(bundle) && !writable) {
      return blocked(
        `${target} belongs to a package, so its code can't be changed here, and this org doesn't let the API write a script's code directly. Change it in its package, then click Refresh in Admin Console > Custom Scripts.`
      );
    }
    if (bundle && target !== current.fields.componentName) {
      preview.warnings.push(`The component ${target} already exists; its code will be replaced with this script's.`);
    }
    if (!bundle) preview.warnings.push(`The component ${target} doesn't exist, so it will be created.`);
  }

  const changes: FixChange[] = [];
  if (codeChanged) {
    changes.push({ target: fix.scriptName, field: "Code", before: sizeOf(current.code), after: sizeOf(next.code), diff: lineDiff(current.code, next.code) });
  }
  for (const k of fieldKeys) {
    if ((current.fields[k] ?? null) !== (next.fields[k] ?? null)) {
      changes.push({ target: fix.scriptName, field: FIELD_LABEL[k], before: show(current.fields[k]), after: show(next.fields[k]) });
    }
  }
  preview.changes = changes;
  if (codeChanged) preview.warnings.push(...checkWarnings(next.code, next.fields));
  if (next.fields.type !== current.fields.type || next.fields.objectName !== current.fields.objectName || next.fields.operationEventType !== current.fields.operationEventType) {
    preview.warnings.push("Changing the type, object or event changes where and when this script runs.");
    if (next.fields.type === "VisitActionValidation" || current.fields.type === "VisitActionValidation") {
      preview.warnings.push(...checkWarnings(next.code, next.fields).filter((w) => !preview.warnings.includes(w)));
    }
  }
  preview.production = await isProductionOrg(org);
  return { preview, current, next, writable };
}

export async function previewSaveScript(fix: SaveCustomScriptFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  return (await planSave(fix, org, progress)).preview;
}

export async function applySaveScript(fix: SaveCustomScriptFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const plan = await planSave(fix, org, progress);
  if (plan.preview.blocked || !plan.current || !plan.next) return { ok: false, message: plan.preview.blocked ?? "Nothing to save." };
  const res = await saveScript(org, { scriptId: fix.scriptId, current: plan.current, next: plan.next, codeTextWritable: plan.writable }, hooksFor(progress));
  if (!res.ok) return { ok: false, message: res.error };
  const to: SaveCustomScriptFix["to"] = {};
  if (fix.to.code !== undefined) to.code = fix.from.code;
  if (fix.to.fields) to.fields = Object.fromEntries(Object.keys(fix.to.fields).map((k) => [k, fix.from.fields[k as keyof ScriptFields]])) as Partial<ScriptFields>;
  return {
    ok: true,
    message: `${plan.next.fields.name} saved${fix.to.code !== undefined ? ` (${sizeOf(plan.current.code)} → ${sizeOf(plan.next.code)})` : ""}.`,
    undo: {
      kind: "saveCustomScript",
      label: `Undo: ${fix.label}`,
      scriptId: fix.scriptId,
      scriptName: plan.next.fields.name,
      from: { code: plan.next.code, fields: plan.next.fields },
      to,
    },
  };
}

// --- Create ----------------------------------------------------------------------------------

const fieldsFrom = (fix: CreateCustomScriptFix): ScriptFields => ({
  name: fix.name,
  componentName: fix.componentName,
  type: fix.type,
  objectName: fix.objectName,
  operationEventType: fix.operationEventType,
});

async function stageNames(org: string, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  if (ids.length === 0) return out;
  ids.forEach(assertId);
  const rows = await query(
    `SELECT Id, Name, ObjectName, ValidationCustomScriptId, ChecklistCustomScriptId FROM LifeSciStageObject WHERE Id IN (${ids.map((i) => `'${i}'`).join(",")})`,
    org
  );
  for (const r of rows) out.set(String(r.Id).slice(0, 15), r);
  return out;
}

export async function previewCreateScript(fix: CreateCustomScriptFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  const fields = fieldsFrom(fix);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  const problem = fieldProblem(fields) ?? codeProblem(fix.code);
  if (problem) return { ...preview, blocked: problem };

  const [bundle, same, stages, vavs] = await step(progress, "read", () =>
    Promise.all([
      findBundle(org, fix.componentName),
      query(`SELECT Id, Name FROM LifeScienceCustomScript WHERE ComponentName = '${fix.componentName}' LIMIT 1`, org),
      stageNames(org, (fix.assign ?? []).map((a) => a.stageObjectId)),
      fix.type === "VisitActionValidation" ? query("SELECT Id, Name FROM LifeScienceCustomScript WHERE Type = 'VisitActionValidation' ORDER BY CreatedDate", org) : Promise.resolve([] as Row[]),
    ])
  );
  if (same[0]) return { ...preview, blocked: `${String(same[0].Name)} already uses the component ${fix.componentName}.` };
  if (bundle) {
    const files = await findBundleCode(org, fix.componentName);
    if (!(fix.adoptBundle && files !== null && sameCode(files, fix.code))) {
      return { ...preview, blocked: `A component named ${fix.componentName} already exists in the org. Pick another name.` };
    }
    preview.warnings.push(`The existing component ${fix.componentName} has the same code and will be reused.`);
  }

  for (const a of fix.assign ?? []) {
    const stage = stages.get(a.stageObjectId.slice(0, 15));
    if (!stage) return { ...preview, blocked: "A stage object this script was to be assigned to no longer exists." };
    if (a.role === "validation" && fix.type !== "Validation") return { ...preview, blocked: "Only a Validation script can be the validation script of a stage object." };
    if (a.role === "checklist" && fix.type !== "Checklist") return { ...preview, blocked: "Only a Checklist script can be the checklist script of a stage object." };
  }

  const changes: FixChange[] = [
    { target: fix.name, field: "New script", before: "(does not exist)", after: [fix.type, fix.objectName].filter(Boolean).join(" · ") },
    { target: fix.name, field: "Component", before: "(none)", after: fix.componentName },
  ];
  if (fix.operationEventType) changes.push({ target: fix.name, field: "Event", before: "(none)", after: fix.operationEventType });
  changes.push({ target: fix.name, field: "Code", before: "(empty)", after: sizeOf(fix.code), diff: lineDiff("", fix.code) });
  for (const a of fix.assign ?? []) {
    const stage = stages.get(a.stageObjectId.slice(0, 15))!;
    const existing = a.role === "validation" ? stage.ValidationCustomScriptId : stage.ChecklistCustomScriptId;
    changes.push({
      target: String(stage.Name),
      field: a.role === "validation" ? "Validation script" : "Checklist script",
      before: existing ? "another script" : "(none)",
      after: fix.name,
    });
    if (existing) preview.warnings.push(`${String(stage.Name)} already uses another ${a.role} script; this replaces it.`);
  }
  preview.changes = changes;
  preview.warnings.push(...checkWarnings(fix.code, fields));
  if (fix.type === "VisitActionValidation" && vavs.length > 0) {
    preview.warnings.push(`Only the first visit action validation script runs — ${String(vavs[0].Name)} does, so this one won't.`);
  }
  if ((fix.type === "Validation" || fix.type === "Checklist") && !(fix.assign ?? []).length) {
    preview.warnings.push(`${fix.type} scripts run only when a stage object uses them. Assign it after creating.`);
  }
  preview.production = await isProductionOrg(org);
  return preview;
}

async function findBundleCode(org: string, name: string): Promise<string | null> {
  return (await readBundle(org, name))?.js ?? null;
}

export async function applyCreateScript(fix: CreateCustomScriptFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const preview = await previewCreateScript(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  const res = await createScript(org, { fields: fieldsFrom(fix), code: fix.code, assign: fix.assign ?? [], adoptBundle: !!fix.adoptBundle }, hooksFor(progress));
  if (!res.ok) return { ok: false, message: res.error };
  return {
    ok: true,
    message: `${fix.name} created.`,
    undo: { kind: "deleteCustomScript", label: `Undo: ${fix.label}`, scriptId: res.scriptId, scriptName: fix.name, deleteBundle: res.createdBundle },
  };
}

// --- Delete ----------------------------------------------------------------------------------

export async function previewDeleteScript(fix: DeleteCustomScriptFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  assertId(fix.scriptId);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  const [row, refs] = await step(progress, "read", () => Promise.all([readScriptRow(org, fix.scriptId), stageReferences(org, fix.scriptId)]));
  if (!row) return { ...preview, blocked: `${fix.scriptName} no longer exists.` };
  const fields = fieldsOf(row);
  preview.changes.push({ target: fix.scriptName, field: "Script", before: [fields.type, fields.objectName].filter(Boolean).join(" · "), after: "(deleted)" });
  for (const r of refs) {
    preview.changes.push({
      target: r.stageObjectName,
      field: r.role === "validation" ? "Validation script" : "Checklist script",
      before: fix.scriptName,
      after: "(none)",
    });
  }
  if (refs.length) preview.warnings.push(`${refs.length === 1 ? "A stage object uses" : `${refs.length} stage objects use`} this script; ${refs.length === 1 ? "it stops" : "they stop"} running it.`);
  if (fix.deleteBundle) preview.changes.push({ target: fix.scriptName, field: "Component", before: fields.componentName, after: "(deleted)" });
  else preview.warnings.push(`The component ${fields.componentName} stays in the org.`);
  preview.warnings.push("Undo recreates the script from the code it has now.");
  preview.production = await isProductionOrg(org);
  return preview;
}

export async function applyDeleteScript(fix: DeleteCustomScriptFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const preview = await previewDeleteScript(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  const row = (await readScriptRow(org, fix.scriptId))!;
  const fields = fieldsOf(row);
  const code = String(row.CodeText ?? "");
  const res = await deleteScript(org, fix.scriptId, fields.componentName, fix.deleteBundle, hooksFor(progress));
  if (!res.ok) return { ok: false, message: res.error };
  const undo: CreateCustomScriptFix = {
    kind: "createCustomScript",
    label: `Undo: ${fix.label}`,
    name: fields.name,
    componentName: fields.componentName,
    type: fields.type,
    objectName: fields.objectName,
    operationEventType: fields.operationEventType,
    code,
    assign: res.cleared.length ? res.cleared : undefined,
    adoptBundle: !res.bundleDeleted,
  };
  return { ok: true, message: `${fix.scriptName} deleted.${res.bundleNote ? ` ${res.bundleNote}` : ""}`, undo };
}

// --- Assign ----------------------------------------------------------------------------------

const ROLE_FIELD: Record<ScriptRole, "ValidationCustomScriptId" | "ChecklistCustomScriptId"> = {
  validation: "ValidationCustomScriptId",
  checklist: "ChecklistCustomScriptId",
};

export async function previewAssignScript(fix: AssignCustomScriptFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  assertId(fix.stageObjectId);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  const ids = [fix.from, fix.to].filter((x): x is string => !!x);
  ids.forEach(assertId);
  const [stage, scripts, hasPath] = await step(progress, "read", () =>
    Promise.all([
      stageNames(org, [fix.stageObjectId]),
      ids.length ? query(`SELECT Id, Name, Type FROM LifeScienceCustomScript WHERE Id IN (${ids.map((i) => `'${i}'`).join(",")})`, org) : Promise.resolve([] as Row[]),
      query(`SELECT Id FROM LifeSciStagePath WHERE StageObjectId = '${fix.stageObjectId}' LIMIT 1`, org).catch(() => null),
    ])
  );
  const so = stage.get(fix.stageObjectId.slice(0, 15));
  if (!so) return { ...preview, blocked: `${fix.stageObjectName} no longer exists.` };
  const nameOf = (id: string | null) => (id ? String(scripts.find((s) => String(s.Id).startsWith(id.slice(0, 15)))?.Name ?? "another script") : "(none)");

  const now = (so[ROLE_FIELD[fix.role]] as string | null) || null;
  const same = (a: string | null, b: string | null) => (a ?? "").slice(0, 15) === (b ?? "").slice(0, 15);
  if (same(now, fix.to)) return { ...preview, blocked: "Already applied. Refresh the library." };
  if (!same(now, fix.from)) return { ...preview, blocked: `${fix.stageObjectName} now uses a different ${fix.role} script. Reload and try again.` };

  if (fix.to) {
    const target = scripts.find((s) => String(s.Id).startsWith(fix.to!.slice(0, 15)));
    if (!target) return { ...preview, blocked: "The script no longer exists." };
    const want = fix.role === "validation" ? "Validation" : "Checklist";
    if (target.Type !== want) return { ...preview, blocked: `${String(target.Name)} is a ${String(target.Type)} script; a stage object's ${fix.role} script has to be a ${want} script.` };
    if (hasPath && hasPath.length === 0) preview.warnings.push(`${fix.stageObjectName} has no stage path, so the script has no stage to run in.`);
  }
  preview.changes.push({
    target: fix.stageObjectName,
    field: fix.role === "validation" ? "Validation script" : "Checklist script",
    before: nameOf(fix.from),
    after: nameOf(fix.to),
  });
  preview.production = await isProductionOrg(org);
  return preview;
}

export async function applyAssignScript(fix: AssignCustomScriptFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const preview = await previewAssignScript(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  const res = await step(progress, "write", () => assignStage(org, fix.stageObjectId, fix.role, fix.to));
  if (!res.ok) return { ok: false, message: res.error };
  return {
    ok: true,
    message: fix.to ? `${fix.stageObjectName} now uses the script as its ${fix.role} script.` : `${fix.stageObjectName} no longer has a ${fix.role} script.`,
    undo: { ...fix, label: `Undo: ${fix.label}`, from: fix.to, to: fix.from },
  };
}

// --- Dispatch --------------------------------------------------------------------------------

export function previewScriptFix(fix: ScriptKindFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  switch (fix.kind) {
    case "createCustomScript":
      return previewCreateScript(fix, org, progress);
    case "saveCustomScript":
      return previewSaveScript(fix, org, progress);
    case "deleteCustomScript":
      return previewDeleteScript(fix, org, progress);
    case "assignCustomScript":
      return previewAssignScript(fix, org, progress);
  }
}

export function applyScriptFix(fix: ScriptKindFix, org: string, progress?: FixTracker): Promise<FixResult> {
  switch (fix.kind) {
    case "createCustomScript":
      return applyCreateScript(fix, org, progress);
    case "saveCustomScript":
      return applySaveScript(fix, org, progress);
    case "deleteCustomScript":
      return applyDeleteScript(fix, org, progress);
    case "assignCustomScript":
      return applyAssignScript(fix, org, progress);
  }
}
