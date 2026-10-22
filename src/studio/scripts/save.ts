/**
 * Writing a custom script: its LWC bundle, its record and the stage objects that use it.
 *
 * Inserting or updating a `LifeScienceCustomScript` copies the LWC's .js into `CodeText` (verified on a real
 * org), so code is saved by writing the bundle first and touching the record after, then reading `CodeText`
 * back. Where the bundle can't be written (a package's component) and `CodeText` is updateable, `CodeText`
 * is written directly; otherwise the save is refused with a plain explanation.
 *
 * Every function returns `{ ok: false, error }` instead of throwing for an org refusal, and leaves the org as
 * it found it when a later step fails (best effort, reported in `error`).
 */

import { apiRequest, dataPath } from "../../salesforce/cli.js";
import type { StatusHook } from "../../salesforce/direct-metadata.js";
import { query, type Row } from "../helpers.js";
import { createBundle, deleteBundle, readBundle, writeBundleJs } from "./lwc.js";
import { bundleEditable } from "./library.js";
import type { ScriptFields, ScriptRole } from "./types.js";

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const errorOf = (r: { error?: string }) => r.error || "The org refused the change.";

/** The org's fields for the record, API-named. */
function recordBody(fields: Partial<ScriptFields>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.name !== undefined) body.Name = fields.name;
  if (fields.componentName !== undefined) body.ComponentName = fields.componentName;
  if (fields.type !== undefined) body.Type = fields.type;
  if (fields.objectName !== undefined) body.ObjectName = fields.objectName;
  if (fields.operationEventType !== undefined) body.OperationEventType = fields.operationEventType;
  return body;
}

export async function readCodeText(org: string, scriptId: string): Promise<string | null> {
  const [row] = await query(
    `SELECT CodeText FROM LifeScienceCustomScript WHERE Id = '${scriptId}'`,
    org
  );
  return row ? String(row.CodeText ?? "") : null;
}

export async function readScriptRow(org: string, scriptId: string): Promise<Row | null> {
  const [row] = await query(
    `SELECT Id, Name, ComponentName, Type, ObjectName, OperationEventType, CodeText FROM LifeScienceCustomScript WHERE Id = '${scriptId}'`,
    org
  );
  return row ?? null;
}

export function fieldsOf(row: Row): ScriptFields {
  return {
    name: String(row.Name ?? ""),
    componentName: String(row.ComponentName ?? ""),
    type: row.Type as ScriptFields["type"],
    objectName: row.ObjectName ? String(row.ObjectName) : null,
    operationEventType: (row.OperationEventType
      ? String(row.OperationEventType)
      : null) as ScriptFields["operationEventType"],
  };
}

const sameCode = (a: string, b: string) => a.trim() === b.trim();

export interface SaveInput {
  scriptId: string;
  /** What the record has now. */
  current: { code: string; fields: ScriptFields };
  /** What it should have after. */
  next: { code: string; fields: ScriptFields };
  /** Whether CodeText is updateable in this org (the fallback for components that can't be written). */
  codeTextWritable: boolean;
}

export interface SaveHooks {
  /** Wrap a stage of the save, for step progress: "lwc" (writing the component), "record" (the script), "verify". */
  step?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  onStatus?: StatusHook;
}

const run = <T>(hooks: SaveHooks, key: string, fn: () => Promise<T>) =>
  hooks.step ? hooks.step(key, fn) : fn();

/**
 * Save a script's code and fields. Returns the CodeText the org holds afterwards.
 */
export async function saveScript(
  org: string,
  input: SaveInput,
  hooks: SaveHooks = {}
): Promise<Outcome<{ codeText: string; how: string }>> {
  const { scriptId, current, next } = input;
  const codeChanged = !sameCode(current.code, next.code);
  const component = next.fields.componentName;
  const renamed = component !== current.fields.componentName;

  // 1. The component's code.
  let rollbackBundle: (() => Promise<void>) | null = null;
  let viaCodeText = false;
  let how = "the component";
  const lwc = await run(hooks, "lwc", async (): Promise<Outcome> => {
    const existing = await readBundle(org, component);
    if (!existing) {
      // No bundle: make one from the code (a script made before components, or a renamed component).
      const made = await createBundle(
        org,
        component,
        next.fields.name || component,
        next.code,
        hooks.onStatus
      );
      if (!made.ok) {
        if (input.codeTextWritable) {
          viaCodeText = true;
          how = "CodeText";
          return { ok: true };
        }
        return { ok: false, error: `Couldn't create the component ${component}: ${made.error}` };
      }
      rollbackBundle = async () => {
        await deleteBundle(org, component);
      };
      how = "a new component";
      return { ok: true };
    }
    if (!codeChanged && !renamed && existing.js !== null && sameCode(existing.js, next.code))
      return { ok: true };
    if (existing.js !== null && sameCode(existing.js, next.code)) return { ok: true };
    if (!bundleEditable(existing.bundle)) {
      if (input.codeTextWritable) {
        viaCodeText = true;
        how = "CodeText";
        return { ok: true };
      }
      return {
        ok: false,
        error: `${component} belongs to a package, so its code can't be changed here, and this org doesn't let the API write a script's code directly. Change the component in its package, then click Refresh in Admin Console > Custom Scripts.`,
      };
    }
    const previous = existing.js ?? "";
    const wrote = await writeBundleJs(org, component, next.code, hooks.onStatus);
    if (!wrote.ok) return { ok: false, error: wrote.error };
    how = wrote.how === "tooling" ? "the component (Tooling API)" : "the component (deploy)";
    rollbackBundle = async () => {
      await writeBundleJs(org, component, previous, hooks.onStatus);
    };
    return { ok: true };
  });
  if (!lwc.ok) return lwc;

  // 2. The record: fields plus a touch (ComponentName) so the platform re-reads the component into CodeText.
  const undoRecord = async () => {
    await apiRequest(
      await dataPath(org, `/sobjects/LifeScienceCustomScript/${scriptId}`),
      "PATCH",
      recordBody(current.fields),
      org
    );
  };
  const body: Record<string, unknown> = {
    ...recordBody({ ...next.fields }),
    ComponentName: component,
  };
  if (viaCodeText) body.CodeText = next.code;
  const patched = await run(hooks, "record", async () =>
    apiRequest<void>(
      await dataPath(org, `/sobjects/LifeScienceCustomScript/${scriptId}`),
      "PATCH",
      body,
      org
    )
  );
  if (!patched.success) {
    if (rollbackBundle) await (rollbackBundle as () => Promise<void>)().catch(() => undefined);
    return { ok: false, error: errorOf(patched) };
  }

  // 3. Read it back.
  const codeText = await run(hooks, "verify", () => readCodeText(org, scriptId));
  if (codeText === null || !sameCode(codeText, next.code)) {
    await undoRecord().catch(() => undefined);
    if (rollbackBundle) await (rollbackBundle as () => Promise<void>)().catch(() => undefined);
    return {
      ok: false,
      error:
        "The script's stored code didn't match what was saved, so the change was undone. Check that the component's code is valid and try again.",
    };
  }
  return { ok: true, codeText, how };
}

export interface CreateInput {
  fields: ScriptFields;
  code: string;
  assign: { stageObjectId: string; role: ScriptRole }[];
  /** An existing bundle is reused when its code is the same (the undo of a delete). */
  adoptBundle: boolean;
}

const STAGE_FIELD: Record<ScriptRole, string> = {
  validation: "ValidationCustomScriptId",
  checklist: "ChecklistCustomScriptId",
};

export async function assignStage(
  org: string,
  stageObjectId: string,
  role: ScriptRole,
  scriptId: string | null
): Promise<Outcome> {
  const res = await apiRequest<void>(
    await dataPath(org, `/sobjects/LifeSciStageObject/${stageObjectId}`),
    "PATCH",
    { [STAGE_FIELD[role]]: scriptId },
    org
  );
  return res.success ? { ok: true } : { ok: false, error: errorOf(res) };
}

/**
 * Create a script: the component first, then the record (which copies the code), then read CodeText back, then
 * assign. Rolls back in reverse when a step fails.
 */
export async function createScript(
  org: string,
  input: CreateInput,
  hooks: SaveHooks = {}
): Promise<Outcome<{ scriptId: string; createdBundle: boolean }>> {
  const { fields, code } = input;
  let createdBundle = false;

  const lwc = await run(hooks, "lwc", async (): Promise<Outcome> => {
    const existing = await readBundle(org, fields.componentName);
    if (existing) {
      if (input.adoptBundle && existing.js !== null && sameCode(existing.js, code))
        return { ok: true };
      return {
        ok: false,
        error: `A component named ${fields.componentName} already exists in the org. Pick another name.`,
      };
    }
    const made = await createBundle(
      org,
      fields.componentName,
      fields.name || fields.componentName,
      code,
      hooks.onStatus
    );
    if (!made.ok) return { ok: false, error: `Couldn't create the component: ${made.error}` };
    createdBundle = true;
    return { ok: true };
  });
  if (!lwc.ok) return lwc;
  const dropBundle = async () => {
    if (createdBundle) await deleteBundle(org, fields.componentName).catch(() => undefined);
  };

  const created = await run(hooks, "record", async () =>
    apiRequest<{ id: string }>(
      await dataPath(org, `/sobjects/LifeScienceCustomScript`),
      "POST",
      recordBody(fields),
      org
    )
  );
  const scriptId = created.success ? created.data?.id : undefined;
  if (!scriptId) {
    await dropBundle();
    return { ok: false, error: errorOf(created) };
  }
  const dropRecord = async () => {
    await apiRequest(
      await dataPath(org, `/sobjects/LifeScienceCustomScript/${scriptId}`),
      "DELETE",
      undefined,
      org
    );
  };

  const stored = await run(hooks, "verify", () => readCodeText(org, scriptId));
  if (stored === null || !sameCode(stored, code)) {
    await dropRecord().catch(() => undefined);
    await dropBundle();
    return {
      ok: false,
      error:
        "The new script's stored code didn't match the component, so it was removed. Try again.",
    };
  }

  const done: { stageObjectId: string; role: ScriptRole }[] = [];
  for (const a of input.assign) {
    const res = await run(hooks, "assign", () =>
      assignStage(org, a.stageObjectId, a.role, scriptId)
    );
    if (!res.ok) {
      for (const d of done)
        await assignStage(org, d.stageObjectId, d.role, null).catch(() => undefined);
      await dropRecord().catch(() => undefined);
      await dropBundle();
      return { ok: false, error: `Couldn't assign the script to the stage object: ${res.error}` };
    }
    done.push(a);
  }
  return { ok: true, scriptId, createdBundle };
}

/** Stage objects (id and role) that point at a script. */
export async function stageReferences(
  org: string,
  scriptId: string
): Promise<{ stageObjectId: string; stageObjectName: string; role: ScriptRole }[]> {
  let rows: Row[] = [];
  try {
    rows = await query(
      `SELECT Id, Name, ValidationCustomScriptId, ChecklistCustomScriptId FROM LifeSciStageObject WHERE ValidationCustomScriptId = '${scriptId}' OR ChecklistCustomScriptId = '${scriptId}'`,
      org
    );
  } catch {
    return [];
  }
  const out: { stageObjectId: string; stageObjectName: string; role: ScriptRole }[] = [];
  for (const r of rows) {
    const id = String(r.Id);
    const name = String(r.Name ?? "");
    if (
      r.ValidationCustomScriptId &&
      String(r.ValidationCustomScriptId).startsWith(scriptId.slice(0, 15))
    )
      out.push({ stageObjectId: id, stageObjectName: name, role: "validation" });
    if (
      r.ChecklistCustomScriptId &&
      String(r.ChecklistCustomScriptId).startsWith(scriptId.slice(0, 15))
    )
      out.push({ stageObjectId: id, stageObjectName: name, role: "checklist" });
  }
  return out;
}

/** Delete a script: clear the stage objects that use it, delete the record, then (optionally) its component. */
export async function deleteScript(
  org: string,
  scriptId: string,
  componentName: string,
  withBundle: boolean,
  hooks: SaveHooks = {}
): Promise<
  Outcome<{
    cleared: { stageObjectId: string; role: ScriptRole }[];
    bundleDeleted: boolean;
    bundleNote?: string;
  }>
> {
  const refs = await stageReferences(org, scriptId);
  const cleared: { stageObjectId: string; role: ScriptRole }[] = [];
  const restore = async () => {
    for (const c of cleared)
      await assignStage(org, c.stageObjectId, c.role, scriptId).catch(() => undefined);
  };
  for (const r of refs) {
    const res = await run(hooks, "unassign", () => assignStage(org, r.stageObjectId, r.role, null));
    if (!res.ok) {
      await restore();
      return {
        ok: false,
        error: `Couldn't remove the script from ${r.stageObjectName}: ${res.error}`,
      };
    }
    cleared.push({ stageObjectId: r.stageObjectId, role: r.role });
  }
  const del = await run(hooks, "record", async () =>
    apiRequest<void>(
      await dataPath(org, `/sobjects/LifeScienceCustomScript/${scriptId}`),
      "DELETE",
      undefined,
      org
    )
  );
  if (!del.success) {
    await restore();
    return { ok: false, error: errorOf(del) };
  }
  let bundleDeleted = false;
  let bundleNote: string | undefined;
  if (withBundle) {
    const gone = await run(hooks, "lwc", () => deleteBundle(org, componentName));
    if (gone.ok) bundleDeleted = true;
    else
      bundleNote = `The script was deleted, but its component ${componentName} couldn't be: ${gone.error}`;
  }
  return { ok: true, cleared, bundleDeleted, bundleNote };
}
