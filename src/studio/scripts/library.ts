/**
 * The custom script library and a script's detail for Studio's editor (docs/design/custom-scripts-studio.md).
 *
 * A script is a `LifeScienceCustomScript` record whose `CodeText` is copied from an LWC bundle's .js.
 * Whether it runs depends on its type: only the earliest Visit Action Validation runs, and a Validation or
 * Checklist script runs only when a `LifeSciStageObject` points at it and the object has a stage path.
 */

import { describeSObject } from "../../salesforce/cli.js";
import { query, inList, ID_PATTERN, type Row } from "../helpers.js";
import { analyzeScript } from "./checks.js";
import type {
  ScriptAssignment,
  ScriptDetail,
  ScriptLibrary,
  ScriptStatus,
  ScriptSummary,
  ScriptType,
  StageObjectRow,
} from "./types.js";

const TYPE_ORDER: Record<string, number> = {
  VisitActionValidation: 0,
  Validation: 1,
  Checklist: 2,
};

const day = (iso: unknown) => {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/** An org without the custom script objects answers with INVALID_TYPE / "not supported"; that's not an error here. */
export function isMissingObject(e: unknown): boolean {
  return /INVALID_TYPE|sObject type .* is not supported|doesn't exist|does not exist|No such column|NOT_FOUND/i.test(
    String((e as Error)?.message ?? e)
  );
}

export interface BundleInfo {
  id: string;
  developerName: string;
  namespace: string | null;
  manageableState: string | null;
  lastModifiedDate: string | null;
}

/** Bundles by lower-cased developer name. */
async function readBundles(org: string, names: string[]): Promise<Map<string, BundleInfo>> {
  const out = new Map<string, BundleInfo>();
  const valid = [...new Set(names.filter((n) => /^\w+$/.test(n)))];
  for (let i = 0; i < valid.length; i += 150) {
    const rows = await query(
      `SELECT Id, DeveloperName, NamespacePrefix, ManageableState, LastModifiedDate FROM LightningComponentBundle WHERE DeveloperName IN (${inList(valid.slice(i, i + 150))})`,
      org,
      true
    );
    for (const r of rows) {
      out.set(String(r.DeveloperName).toLowerCase(), {
        id: String(r.Id),
        developerName: String(r.DeveloperName),
        namespace: str(r.NamespacePrefix),
        manageableState: str(r.ManageableState),
        lastModifiedDate: str(r.LastModifiedDate),
      });
    }
  }
  return out;
}

/** Whether a bundle's code can be written: customer-created (no namespace) and not installed from a package. */
export const bundleEditable = (b: BundleInfo | undefined) =>
  !!b && !b.namespace && (!b.manageableState || b.manageableState === "unmanaged");

async function codeTextWritable(org: string): Promise<boolean> {
  try {
    const d = await describeSObject("LifeScienceCustomScript", org);
    const f = d.success ? d.data?.fields.find((x) => x.name === "CodeText") : undefined;
    return !!f?.updateable;
  } catch {
    return false;
  }
}

async function readSharing(org: string): Promise<ScriptLibrary["sharing"]> {
  try {
    const [row] = await query(
      `SELECT InternalSharingModel FROM EntityDefinition WHERE QualifiedApiName = 'LifeScienceCustomScript'`,
      org,
      true
    );
    const internalAccess = str(row?.InternalSharingModel);
    if (internalAccess === "Private") {
      return {
        internalAccess,
        note: "Scripts are private by default, so reps may not be able to read them. Share them with reps (a sharing rule or Public Read Only) or they won't run on the iPad.",
      };
    }
    return { internalAccess };
  } catch {
    return { internalAccess: null };
  }
}

interface Statusing {
  vavs: Row[];
  stageByScript: Map<string, ScriptAssignment[]>;
  stageObjects: StageObjectRow[];
  pathObjects: Set<string>;
}

function statusOf(r: Row, s: Statusing, diag: { error: number; warning: number }): ScriptStatus {
  const type = r.Type as ScriptType;
  if (type === "VisitActionValidation") {
    const first = s.vavs[0];
    if (r.ObjectName !== "ProviderVisit" || r.OperationEventType !== "OnUpdate") {
      return {
        tone: "error",
        label: "Won't run",
        detail:
          "A visit action validation runs only with the object ProviderVisit and the event OnUpdate.",
      };
    }
    if (first && first.Id !== r.Id) {
      return {
        tone: "error",
        label: "Won't run",
        detail: `Only the first visit action validation script runs — ${String(first.Name)} (created ${day(first.CreatedDate)}) does.`,
      };
    }
    return {
      tone: diag.error ? "error" : "pass",
      label: "Runs at Save, Sign and Submit",
      detail: "This is the visit action validation script the app runs.",
    };
  }
  const where = s.stageByScript.get(String(r.Id)) ?? [];
  if (where.length === 0) {
    return {
      tone: "warning",
      label: "Not assigned",
      detail: `${type === "Checklist" ? "Checklist" : "Validation"} scripts run only when a stage object uses them.`,
    };
  }
  const noPath = where.filter((w) => !s.pathObjects.has(w.stageObjectId));
  if (noPath.length === where.length) {
    return {
      tone: "warning",
      label: "No stage path",
      detail: `${noPath.map((w) => w.objectName).join(", ")} has no stage path, so this script has no stage to run in.`,
    };
  }
  return {
    tone: "pass",
    label: `Runs on ${[...new Set(where.map((w) => w.objectName))].join(", ")}`,
    detail: "A stage object with a stage path uses this script.",
  };
}

function summaryFrom(r: Row, bundle: BundleInfo | undefined, s: Statusing): ScriptSummary {
  const code = String(r.CodeText ?? "");
  const type = r.Type as ScriptType;
  const diags = analyzeScript(code, {
    type,
    objectName: str(r.ObjectName),
    operationEventType: str(r.OperationEventType),
  });
  const findingCount = {
    error: diags.filter((d) => d.severity === "error").length,
    warning: diags.filter((d) => d.severity === "warning").length,
  };
  return {
    id: String(r.Id),
    name: String(r.Name ?? ""),
    componentName: String(r.ComponentName ?? ""),
    type,
    objectName: str(r.ObjectName),
    operationEventType: str(r.OperationEventType) as ScriptSummary["operationEventType"],
    createdDate: String(r.CreatedDate ?? ""),
    lastModifiedDate: String(r.LastModifiedDate ?? ""),
    lastModifiedBy: str((r.LastModifiedBy as Row | null)?.Name),
    codeSize: code.length,
    lwc: {
      exists: !!bundle,
      namespace: bundle?.namespace ?? null,
      lastModifiedDate: bundle?.lastModifiedDate ?? null,
      editable: bundleEditable(bundle),
    },
    assignedTo: s.stageByScript.get(String(r.Id)) ?? [],
    status: statusOf(r, s, findingCount),
    findingCount,
  };
}

const SCRIPT_FIELDS =
  "Id, Name, ComponentName, Type, ObjectName, OperationEventType, CodeText, CreatedDate, LastModifiedDate, LastModifiedBy.Name";

async function readStageObjects(
  org: string
): Promise<{ stageObjects: StageObjectRow[]; pathObjects: Set<string>; note?: string }> {
  let rows: Row[] = [];
  let note: string | undefined;
  try {
    rows = await query(
      "SELECT Id, Name, ObjectName, IsControlledByStagePath, ValidationCustomScriptId, ChecklistCustomScriptId FROM LifeSciStageObject ORDER BY Name",
      org
    );
  } catch (e) {
    if (!isMissingObject(e))
      note = "The stage objects couldn't be read, so which scripts are assigned isn't shown.";
  }
  const pathObjects = new Set<string>();
  if (rows.length) {
    try {
      for (const p of await query(
        "SELECT StageObjectId FROM LifeSciStagePath GROUP BY StageObjectId",
        org
      ))
        pathObjects.add(String(p.StageObjectId));
    } catch (e) {
      if (!isMissingObject(e))
        note =
          "The stage paths couldn't be read, so whether assigned scripts can run isn't checked.";
      // Don't claim "no stage path" when we couldn't look.
      for (const r of rows) pathObjects.add(String(r.Id));
    }
  }
  return {
    stageObjects: rows.map((r) => ({
      id: String(r.Id),
      name: String(r.Name ?? ""),
      objectName: String(r.ObjectName ?? ""),
      controlledByStagePath: r.IsControlledByStagePath === true,
      validationScriptId: str(r.ValidationCustomScriptId),
      checklistScriptId: str(r.ChecklistCustomScriptId),
    })),
    pathObjects,
    note,
  };
}

function statusing(
  scripts: Row[],
  stageObjects: StageObjectRow[],
  pathObjects: Set<string>
): Statusing {
  const stageByScript = new Map<string, ScriptAssignment[]>();
  const add = (scriptId: string | null, so: StageObjectRow, role: ScriptAssignment["role"]) => {
    if (!scriptId) return;
    const list = stageByScript.get(scriptId) ?? [];
    list.push({ stageObjectId: so.id, stageObjectName: so.name, objectName: so.objectName, role });
    stageByScript.set(scriptId, list);
  };
  for (const so of stageObjects) {
    add(so.validationScriptId, so, "validation");
    add(so.checklistScriptId, so, "checklist");
  }
  const vavs = scripts.filter((r) => r.Type === "VisitActionValidation");
  return { vavs, stageByScript, stageObjects, pathObjects };
}

/** The earliest Visit Action Validation that is set up to run is the one the app runs. */
function runningVav(vavs: Row[]): string | null {
  return vavs.length ? String(vavs[0].Id) : null;
}

export async function collectScriptLibrary(org: string): Promise<ScriptLibrary> {
  const empty = (note: string): ScriptLibrary => ({
    unavailable: true,
    scripts: [],
    stageObjects: [],
    runningVisitScriptId: null,
    sharing: { internalAccess: null },
    codeTextWritable: false,
    note,
  });

  let rows: Row[];
  try {
    rows = await query(
      `SELECT ${SCRIPT_FIELDS} FROM LifeScienceCustomScript ORDER BY CreatedDate, Id`,
      org
    );
  } catch (e) {
    if (isMissingObject(e))
      return empty(
        "This org has no custom script objects, so there are no custom scripts to show."
      );
    throw e;
  }

  const notes: string[] = [];
  const [stage, bundles, sharing, writable] = await Promise.all([
    readStageObjects(org),
    readBundles(
      org,
      rows.map((r) => String(r.ComponentName ?? ""))
    ).catch(() => {
      notes.push("The LWC bundles couldn't be read, so whether each script has one isn't shown.");
      return new Map<string, BundleInfo>();
    }),
    readSharing(org),
    codeTextWritable(org),
  ]);
  if (stage.note) notes.push(stage.note);

  const s = statusing(rows, stage.stageObjects, stage.pathObjects);
  const scripts = rows
    .map((r) => summaryFrom(r, bundles.get(String(r.ComponentName ?? "").toLowerCase()), s))
    .sort(
      (a, b) =>
        (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
        a.createdDate.localeCompare(b.createdDate) ||
        a.id.localeCompare(b.id)
    );

  return {
    scripts,
    stageObjects: stage.stageObjects,
    runningVisitScriptId: runningVav(s.vavs),
    sharing,
    codeTextWritable: writable,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}

/** The bundle's .js and the names of its other files. */
export async function readBundleFiles(
  org: string,
  bundleId: string,
  componentName: string
): Promise<{ js: string | null; others: string[] }> {
  const files = await query(
    `SELECT FilePath, Source FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundleId}'`,
    org,
    true
  );
  const jsPath = `lwc/${componentName}/${componentName}.js`.toLowerCase();
  let js: string | null = null;
  const others: string[] = [];
  for (const f of files) {
    const p = String(f.FilePath ?? "");
    if (p.toLowerCase() === jsPath) js = String(f.Source ?? "");
    else others.push(p.split("/").pop() ?? p);
  }
  return { js, others: others.sort() };
}

export async function collectScriptDetail(id: string, org: string): Promise<ScriptDetail> {
  if (!ID_PATTERN.test(id)) throw new Error("That isn't a script id.");
  const [found, vavs, stage] = await Promise.all([
    query(`SELECT ${SCRIPT_FIELDS} FROM LifeScienceCustomScript WHERE Id = '${id}'`, org),
    query(
      "SELECT Id, Name, Type, CreatedDate FROM LifeScienceCustomScript WHERE Type = 'VisitActionValidation' ORDER BY CreatedDate, Id",
      org
    ),
    readStageObjects(org),
  ]);
  const r = found[0];
  if (!r) throw new Error("That script no longer exists.");
  const componentName = String(r.ComponentName ?? "");
  const bundles = await readBundles(org, [componentName]).catch(
    () => new Map<string, BundleInfo>()
  );
  const bundle = bundles.get(componentName.toLowerCase());
  const s = statusing([...vavs, r], stage.stageObjects, stage.pathObjects);
  const summary = summaryFrom(r, bundle, s);

  let lwcCode: string | null = null;
  let lwcOtherFiles: string[] = [];
  if (bundle) {
    try {
      const files = await readBundleFiles(org, bundle.id, componentName);
      lwcCode = files.js;
      lwcOtherFiles = files.others;
    } catch {
      // leave null: "can't read"
    }
  }
  const code = String(r.CodeText ?? "");
  const drift: ScriptDetail["drift"] = !bundle
    ? "no-lwc"
    : lwcCode !== null && lwcCode.trim() !== code.trim()
      ? "lwc-ahead"
      : "none";
  return { ...summary, code, lwcCode, lwcOtherFiles, drift };
}
