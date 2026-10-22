// The custom script page's view of the shared types and change builders: types from script-types.ts (kept equal to the
// server's), checks from script-checks.ts, test results from script-test-logic.ts, and pending changes in the shape
// the editor's drafts produce. Keys come from changes.ts so the tray and the editor agree on them.
import { changeKey, type PendingChange } from "../changes";
import type { StudioFix } from "../types";
import type {
  AssignCustomScriptFix,
  CreateCustomScriptFix,
  DeleteCustomScriptFix,
  SaveCustomScriptFix,
  ScriptEvent,
  ScriptRole,
  ScriptType,
} from "./script-types";

export type { ScriptDetail, ScriptFields, ScriptLibrary, ScriptSummary, ScriptType, StageObjectRow } from "./script-types";
export type EventType = ScriptEvent;
export { analyzeScript, type ScriptDiagnostic } from "./script-checks";
export type { TestRunResult as ScriptTestResult } from "./script-test-logic";

export type ScriptFix = CreateCustomScriptFix | SaveCustomScriptFix | DeleteCustomScriptFix | AssignCustomScriptFix;

const SCRIPT_KINDS = new Set<StudioFix["kind"]>(["createCustomScript", "saveCustomScript", "deleteCustomScript", "assignCustomScript"]);

/** The fix as one of the four custom script kinds, or null for any other change. */
export function scriptFix(fix: StudioFix): ScriptFix | null {
  return SCRIPT_KINDS.has(fix.kind) ? (fix as ScriptFix) : null;
}

/** The tray key of a custom script change (`script:`, `script-new:`, `script-delete:`, `stage:`), null for others. */
export function scriptChangeKey(fix: StudioFix): string | null {
  return scriptFix(fix) ? changeKey(fix) : null;
}

export function scriptSaveChange(args: Omit<SaveCustomScriptFix, "kind" | "label">): PendingChange {
  return { fix: { kind: "saveCustomScript", label: `Save ${args.scriptName}`, ...args } };
}

export function scriptCreateChange(args: Omit<CreateCustomScriptFix, "kind" | "label">): PendingChange {
  return { fix: { kind: "createCustomScript", label: `Create script ${args.name}`, ...args } };
}

export function scriptDeleteChange(args: Omit<DeleteCustomScriptFix, "kind" | "label">): PendingChange {
  return { fix: { kind: "deleteCustomScript", label: `Delete script ${args.scriptName}`, ...args } };
}

export function scriptAssignChange(args: Omit<AssignCustomScriptFix, "kind" | "label">): PendingChange {
  const verb = args.to ? "Set" : "Clear";
  return { fix: { kind: "assignCustomScript", label: `${verb} the ${args.role} script of ${args.stageObjectName}`, ...args } };
}

export type { ScriptRole };
