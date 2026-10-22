/** Custom script test runner: loads the record, user and context data, then runs the script. */

import { buildVisitContext } from "./context-data.js";
import { pickFields, plainRow, sqlString } from "./fields.js";
import { runScript } from "./run.js";
import type { OrgReader, Row, ScriptTestRequest, ScriptTestResult } from "./types.js";

export { createOrgReader } from "./org-reader.js";
export { listScriptTestRecords } from "./records.js";
export { runScript, type RunInput } from "./run.js";
export * from "./types.js";

interface LoadedRecord {
  object: string;
  fields: Row;
  rt: string | null;
  linkField: "ProviderVisitId" | "VisitId";
}

async function loadRecord(
  reader: OrgReader,
  object: string,
  where: string,
  notes: string[]
): Promise<LoadedRecord | null> {
  const info = await reader.describe(object);
  if (!info) {
    notes.push(`${object} isn't in this org or isn't readable.`);
    return null;
  }
  const { fields } = pickFields(info);
  const rows = await reader.query(
    `SELECT ${fields.join(", ")} FROM ${object} WHERE ${where} LIMIT 1`
  );
  if (!rows[0]) return null;
  const row = plainRow(rows[0]);
  let rt: string | null = null;
  if (typeof row.RecordTypeId === "string") {
    try {
      const rts = await reader.query(
        `SELECT Name FROM RecordType WHERE Id = ${sqlString(row.RecordTypeId)}`
      );
      rt = rts[0] ? String(rts[0].Name) : null;
    } catch {
      rt = null;
    }
  }
  return { object, fields: row, rt, linkField: object === "Visit" ? "VisitId" : "ProviderVisitId" };
}

function failed(message: string, notes: string[], started: number): ScriptTestResult {
  return {
    ok: false,
    results: [],
    outcome: "none",
    logs: [],
    queries: [],
    error: { message },
    contract: [],
    durationMs: Date.now() - started,
    notes,
  };
}

export async function runScriptTest(
  req: ScriptTestRequest,
  reader: OrgReader
): Promise<ScriptTestResult> {
  const started = Date.now();
  const notes: string[] = [];
  const isVav = req.type === "VisitActionValidation";

  let record: LoadedRecord | null = null;
  try {
    if (req.recordId) {
      if (!/^[a-zA-Z0-9]{15,18}$/.test(req.recordId))
        return failed(`${req.recordId} isn't a valid record Id.`, notes, started);
      const id = sqlString(req.recordId);
      if (isVav) {
        record =
          (await loadRecord(reader, "ProviderVisit", `Id = ${id}`, notes)) ??
          (await loadRecord(reader, "ProviderVisit", `VisitId = ${id}`, notes));
        if (!record) {
          record = await loadRecord(reader, "Visit", `Id = ${id}`, notes);
          if (record)
            notes.push(
              "No ProviderVisit exists for this Visit, so the Visit itself is used as the record."
            );
        }
      } else if (req.objectName) {
        record = await loadRecord(reader, req.objectName, `Id = ${id}`, notes);
      } else {
        return failed(
          "Choose which object this script runs on before testing it against a record.",
          notes,
          started
        );
      }
      if (!record)
        return failed(
          `Couldn't find record ${req.recordId}${isVav ? " as a ProviderVisit or Visit" : ""}. It may have been deleted, or the connected admin can't read it.`,
          notes,
          started
        );
    } else {
      notes.push(
        "No record was chosen, so record.stringValue() and the other getters return undefined."
      );
    }
  } catch (e) {
    return failed(
      `Couldn't read the record: ${e instanceof Error ? e.message : String(e)}`,
      notes,
      started
    );
  }

  let user: Row = {};
  try {
    const u = await reader.user(req.userId);
    if (u) user = u;
    else
      notes.push(
        "The connected user couldn't be read, so user.stringValue() and the other getters return undefined."
      );
  } catch (e) {
    notes.push(
      `The user couldn't be read (${e instanceof Error ? e.message : String(e)}), so user.stringValue() returns undefined.`
    );
  }

  let nsPrefix: string | null = null;
  try {
    const ns = await reader.namespace();
    nsPrefix = ns ? `${ns}__` : null;
  } catch {
    nsPrefix = null;
  }

  let contextData: unknown = null;
  if (isVav) {
    if (record) {
      try {
        contextData = await buildVisitContext(
          reader,
          req.platform,
          record.fields,
          record.object,
          record.linkField,
          notes
        );
      } catch (e) {
        contextData = {};
        notes.push(
          `The visit's context data couldn't be built (${e instanceof Error ? e.message : String(e)}); getContextData() returns an empty object.`
        );
      }
    } else {
      contextData = {};
    }
  }

  return runScript({
    code: req.code,
    type: req.type,
    platform: req.platform,
    env: req.env,
    record: {
      object: record?.object ?? req.objectName ?? (isVav ? "ProviderVisit" : ""),
      fields: record?.fields ?? {},
      rt: record?.rt ?? null,
    },
    user: { fields: user },
    contextData,
    nsPrefix,
    reader,
    notes,
  });
}
