/** A few real records for the builder model, through a SELECT-only guard. */

import { runSoqlQuery } from "../../salesforce/cli.js";
import { errorMessage, RunAsError, userGet, type RunAs } from "./run-as.js";

export const MAX_SAMPLE_ROWS = 5;

/** The text with the contents of string literals blanked (same length), so keywords inside them are ignored. */
function blankStrings(soql: string): string {
  return soql.replace(/'(?:[^'\\]|\\.)*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");
}

/** Validates the query and forces its top-level LIMIT to at most MAX_SAMPLE_ROWS. Throws with the reason when it isn't an acceptable SELECT. */
export function guardSampleQuery(soql: string): string {
  const text = soql.trim();
  if (!text) throw new Error("The query is empty.");
  const blank = blankStrings(text);
  if ((blank.match(/'/g)?.length ?? 0) % 2)
    throw new Error("The query has an unterminated string.");
  if (blank.includes(";")) throw new Error("Only one statement is allowed (no semicolons).");
  if (!/^select\b/i.test(blank)) throw new Error("Only SELECT queries can be sampled.");
  if (/\b(insert|update|delete|upsert|merge|undelete)\b/i.test(blank))
    throw new Error("Only SELECT queries can be sampled.");
  if (/\bfor\s+(update|view|reference)\b/i.test(blank))
    throw new Error("FOR UPDATE / VIEW / REFERENCE aren't allowed.");
  if (/--|\/\*|\*\//.test(blank)) throw new Error("Comments aren't allowed in the query.");

  // The top-level LIMIT is the one outside any parentheses (subqueries have their own).
  let depth = 0;
  let limitAt = -1;
  let limitLen = 0;
  let limitValue = 0;
  for (let i = 0; i < blank.length; i++) {
    const c = blank[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) {
      const m = /^limit\s+(\d+)\b/i.exec(blank.slice(i));
      if (m && (i === 0 || /\s/.test(blank[i - 1]))) {
        limitAt = i;
        limitLen = m[0].length;
        limitValue = Number(m[1]);
        break;
      }
    }
  }
  if (limitAt >= 0) {
    return (
      text.slice(0, limitAt) +
      `LIMIT ${Math.min(limitValue, MAX_SAMPLE_ROWS)}` +
      text.slice(limitAt + limitLen)
    );
  }
  if (/\blimit\b/i.test(blank.replace(/\([^()]*\)/g, "")))
    throw new Error("LIMIT must be a number.");
  // Before OFFSET if there is one; LIMIT comes before OFFSET in SOQL.
  const offset = /\boffset\s+\d+\s*$/i.exec(text);
  return offset
    ? `${text.slice(0, offset.index).trimEnd()} LIMIT ${MAX_SAMPLE_ROWS} ${offset[0]}`
    : `${text} LIMIT ${MAX_SAMPLE_ROWS}`;
}

export interface SampleResult {
  records: Record<string, unknown>[];
  totalSize: number;
}

function stripAttributes(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "attributes") continue;
    out[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? stripAttributes(v as Record<string, unknown>)
        : v;
  }
  return out;
}

/** `as`: run the query as that test user, so sharing and field-level security apply to what the model sees. */
export async function sampleRecords(soql: string, org: string, as?: RunAs): Promise<SampleResult> {
  const guarded = guardSampleQuery(soql);
  if (as) {
    const res = await userGet(as, `/query?q=${encodeURIComponent(guarded)}`);
    if (res.status !== 200)
      throw new RunAsError(
        `The query failed as ${as.username}: ${errorMessage(res.data, `HTTP ${res.status}`)}`
      );
    const body = res.data as { records?: Record<string, unknown>[]; totalSize?: number };
    const records = (body.records ?? []).slice(0, MAX_SAMPLE_ROWS).map(stripAttributes);
    return { records, totalSize: body.totalSize ?? records.length };
  }
  const result = await runSoqlQuery(guarded, org, { maxRows: MAX_SAMPLE_ROWS });
  if (!result.success || !result.data) throw new Error(result.error || "The query failed.");
  return {
    records: result.data.records.slice(0, MAX_SAMPLE_ROWS).map(stripAttributes),
    totalSize: result.data.totalSize,
  };
}
