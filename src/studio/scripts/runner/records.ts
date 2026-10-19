/** Recent records the panel can run a script against. */

import { sqlString } from "./fields.js";
import type { OrgReader, Row, ScriptTestRecord, ScriptTestRecordsRequest, ScriptTestRecordsResult } from "./types.js";

const LIMIT = 25;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function names(reader: OrgReader, object: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const rows = await reader.query(`SELECT Id, Name FROM ${object} WHERE Id IN (${[...new Set(ids)].map(sqlString).join(", ")})`);
    for (const r of rows) out.set(String(r.Id), String(r.Name ?? ""));
  } catch {
    /* names are a nicety */
  }
  return out;
}

async function visitCounts(reader: OrgReader, ids: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const list = ids.map(sqlString).join(", ");
  const sources: [string, string][] = [
    ["ProviderVisitProdDetailing", "Details"],
    ["ProviderVisitDtlProductMsg", "Messages"],
    ["ProviderVisitProdDiscussion", "Discussions"],
  ];
  await Promise.all(
    sources.map(async ([object, label]) => {
      try {
        const rows = await reader.query(`SELECT ProviderVisitId, COUNT(Id) c FROM ${object} WHERE ProviderVisitId IN (${list}) GROUP BY ProviderVisitId`);
        for (const r of rows) {
          const id = String(r.ProviderVisitId);
          if (!out.has(id)) out.set(id, new Map());
          out.get(id)!.set(`${object}|${label}`, Number(r.c));
        }
      } catch {
        /* object missing: no count */
      }
    }),
  );
  return out;
}

async function accountMatches(reader: OrgReader, search: string): Promise<string[]> {
  try {
    const rows = await reader.query(`SELECT Id FROM Account WHERE Name LIKE ${sqlString(`%${search}%`)} LIMIT 200`);
    return rows.map((r) => String(r.Id));
  } catch {
    return [];
  }
}

export async function listScriptTestRecords(req: ScriptTestRecordsRequest, reader: OrgReader): Promise<ScriptTestRecordsResult> {
  const notes: string[] = [];
  const search = req.search?.trim() ?? "";
  const objectName = req.type === "VisitActionValidation" ? "ProviderVisit" : req.objectName?.trim() || "";
  if (!objectName) return { objectName: "", records: [], notes: ["This script has no object yet, so there are no records to test against."] };
  if (!/^[A-Za-z0-9_]+$/.test(objectName)) return { objectName, records: [], notes: [`${objectName} isn't a valid object name.`] };

  const info = await reader.describe(objectName);
  if (!info) return { objectName, records: [], notes: [`${objectName} isn't in this org or isn't readable.`] };
  const has = (f: string) => info.fields.some((x) => x.name === f);
  const wanted = ["Id", "Name", "AccountId", "PlannedStartTime", "Status", "LastModifiedDate"].filter(has);

  const filters: string[] = [];
  if (search) {
    const like = sqlString(`%${search}%`);
    const parts: string[] = [];
    if (has("Name")) parts.push(`Name LIKE ${like}`);
    if (has("AccountId")) {
      const ids = await accountMatches(reader, search);
      if (ids.length) parts.push(`AccountId IN (${ids.map(sqlString).join(", ")})`);
    }
    if (!parts.length) return { objectName, records: [], notes };
    filters.push(`(${parts.join(" OR ")})`);
  }
  const order = has("PlannedStartTime") ? "PlannedStartTime DESC NULLS LAST" : "LastModifiedDate DESC";
  const rows: Row[] = await reader.query(
    `SELECT ${wanted.join(", ")} FROM ${objectName}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ${LIMIT}`,
  );

  const accounts = has("AccountId") ? await names(reader, "Account", rows.map((r) => str(r.AccountId)).filter((x): x is string => !!x)) : new Map<string, string>();
  const counts = objectName === "ProviderVisit" && rows.length ? await visitCounts(reader, rows.map((r) => String(r.Id))) : new Map<string, Map<string, number>>();

  const records: ScriptTestRecord[] = rows.map((r) => {
    const id = String(r.Id);
    const c = counts.get(id);
    return {
      id,
      objectName,
      name: str(r.Name) ?? id,
      accountName: str(r.AccountId) ? (accounts.get(String(r.AccountId)) ?? null) : null,
      date: str(r.PlannedStartTime),
      status: str(r.Status),
      children: c
        ? [...c.entries()].map(([k, count]) => {
            const [object, label] = k.split("|");
            return { object, label, count };
          })
        : [],
    };
  });
  if (rows.length === LIMIT) notes.push(`Showing the ${LIMIT} most recent. Search by account or record name to find others.`);
  return { objectName, records, notes };
}
