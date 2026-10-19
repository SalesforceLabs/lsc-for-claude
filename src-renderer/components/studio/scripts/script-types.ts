/**
 * Types for Studio's custom script library, editor and fixes (docs/design/custom-scripts-studio.md).
 *
 * Self-contained so the renderer keeps a byte-identical copy
 * (`src-renderer/components/studio/scripts/script-types.ts`, kept equal by a test).
 */

export type ScriptType = "Validation" | "Checklist" | "VisitActionValidation";
export type ScriptEvent = "OnCreate" | "OnUpdate" | "OnDelete";
export type ScriptRole = "validation" | "checklist";

/** The record fields of a script besides its code. */
export interface ScriptFields {
  name: string;
  componentName: string;
  type: ScriptType;
  objectName: string | null;
  operationEventType: ScriptEvent | null;
}

export interface ScriptAssignment {
  stageObjectId: string;
  stageObjectName: string;
  objectName: string;
  role: ScriptRole;
}

export interface ScriptStatus {
  tone: "pass" | "warning" | "error" | "info";
  label: string;
  detail: string;
}

export interface ScriptSummary {
  id: string;
  name: string;
  componentName: string;
  type: ScriptType;
  objectName: string | null;
  operationEventType: ScriptEvent | null;
  createdDate: string;
  lastModifiedDate: string;
  lastModifiedBy: string | null;
  /** CodeText length. */
  codeSize: number;
  lwc: { exists: boolean; namespace: string | null; lastModifiedDate: string | null; editable: boolean };
  assignedTo: ScriptAssignment[];
  status: ScriptStatus;
  findingCount: { error: number; warning: number };
}

export interface StageObjectRow {
  id: string;
  name: string;
  objectName: string;
  controlledByStagePath: boolean;
  validationScriptId: string | null;
  checklistScriptId: string | null;
}

export interface ScriptLibrary {
  /** Ordered by type (visit action validation, validation, checklist), then creation. */
  scripts: ScriptSummary[];
  stageObjects: StageObjectRow[];
  runningVisitScriptId: string | null;
  /** The org-wide default for the script object; `note` when reps may not be able to read scripts. */
  sharing: { internalAccess: string | null; note?: string };
  /** CodeText is updateable through the API in this org. */
  codeTextWritable: boolean;
  /** Set when the org has no custom script objects or part of the library couldn't be read. */
  note?: string;
  /** The org has no custom script object (LSC isn't installed or the connection can't see it). */
  unavailable?: boolean;
}

export interface ScriptDetail extends ScriptSummary {
  /** CodeText. */
  code: string;
  /** The bundle's .js; null when there is no bundle or it couldn't be read. */
  lwcCode: string | null;
  /** Other files in the bundle (html, css, tests) — kept when the code is saved. */
  lwcOtherFiles: string[];
  /** lwc-ahead: the LWC's .js differs from CodeText (deployed but not refreshed). */
  drift: "none" | "lwc-ahead" | "no-lwc";
}

// --- Fix kinds (members of StudioFix, in both the server's and the renderer's union) ---------------

export interface CreateCustomScriptFix {
  kind: "createCustomScript";
  label: string;
  name: string;
  /** The LWC folder name. */
  componentName: string;
  type: ScriptType;
  objectName: string | null;
  operationEventType: ScriptEvent | null;
  code: string;
  assign?: { stageObjectId: string; role: ScriptRole }[];
  /** Set by the undo of a delete: an existing bundle is reused when its code is the same. */
  adoptBundle?: boolean;
}

export interface SaveCustomScriptFix {
  kind: "saveCustomScript";
  label: string;
  scriptId: string;
  scriptName: string;
  /** What the editor saw — the change is refused if the org's code or fields are no longer this. */
  from: { code: string; fields: ScriptFields };
  to: { code?: string; fields?: Partial<ScriptFields> };
}

export interface DeleteCustomScriptFix {
  kind: "deleteCustomScript";
  label: string;
  scriptId: string;
  scriptName: string;
  deleteBundle: boolean;
}

export interface AssignCustomScriptFix {
  kind: "assignCustomScript";
  label: string;
  stageObjectId: string;
  stageObjectName: string;
  role: ScriptRole;
  from: string | null;
  to: string | null;
}
