/**
 * Help for the model when the org rejects a SOQL query for a field name, and the
 * text `describe_sobject` returns. Pure apart from `fieldHintForError`, which
 * reads (and caches) one describe.
 */
import { describeSObject, type SObjectDescribeResult } from "../salesforce/cli.js";

type Describe = SObjectDescribeResult;

/** The object whose field list would fix a rejected query, or null. */
export function objectForFieldError(error: string, query: string): string | null {
  // No such column 'Product2Id' on entity 'ProductTerritoryAvailability'.
  const column = /No such column '[^']+' on entity '(\w+)'/.exec(error);
  // Didn't understand relationship 'Product2' in field path. … / Invalid field … on object
  const relationship = /Didn't understand relationship '[^']+'|INVALID_FIELD/.test(error);
  if (column) return column[1];
  if (!relationship) return null;
  return fromObject(query);
}

/** The top-level FROM object of a query (subqueries ignored). */
export function fromObject(query: string): string | null {
  const flat = query.replace(/\(\s*SELECT[\s\S]*?\)/gi, "()");
  return /\bFROM\s+(\w+)/i.exec(flat)?.[1] ?? null;
}

/** One line per field family: plain names, then lookups with their relationship name. */
export function fieldListText(describe: Describe): string {
  const fields = describe.fields.filter((f) => !f.deprecatedAndHidden);
  const plain = fields.filter((f) => f.type !== "reference").map((f) => f.name);
  const lookups = fields
    .filter((f) => f.type === "reference")
    .map((f) => {
      const to = f.referenceTo?.length ? ` → ${f.referenceTo.join("/")}` : "";
      const rel = f.relationshipName ? ` (as ${f.relationshipName}.…)` : "";
      return `${f.name}${to}${rel}`;
    });
  const lines = [`**Fields on ${describe.name}** (from the org's describe):`, plain.join(", ")];
  if (lookups.length) lines.push(`**Lookups:** ${lookups.join(", ")}`);
  const poly = fields.filter((f) => f.type === "reference" && (f.referenceTo?.length ?? 0) > 1);
  if (poly.length)
    lines.push(
      `${poly.map((f) => f.relationshipName ?? f.name).join(", ")} can point to several objects, so only Id and Name are queryable through ${poly.length > 1 ? "them" : "it"}; query the target object for other fields.`
    );
  return lines.join("\n\n");
}

/** Text for a polymorphic-lookup error, where the "entity" is the shared Name record. */
function polymorphicHint(error: string): string | null {
  const m = /No such column '(\w+)' on entity 'Name'/.exec(error);
  if (!m) return null;
  return `'${m[1]}' was read through a lookup that can point to several objects (such as Owner), which only exposes Id and Name. Query the target object (for example User) by that Id instead.`;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; describe: Describe }>();

/** Clear the describe cache (tests). */
export function clearFieldHintCache(): void {
  cache.clear();
}

/** A field list to append to a rejected query's error, or "" when it doesn't apply. */
export async function fieldHintForError(
  error: string,
  query: string,
  org: string,
  describe: typeof describeSObject = describeSObject
): Promise<string> {
  const poly = polymorphicHint(error);
  if (poly) return poly;
  const object = objectForFieldError(error, query);
  if (!object || !/^\w+$/.test(object)) return "";
  const key = `${org.toLowerCase()}|${object.toLowerCase()}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const result = await describe(object, org).catch(() => null);
    if (!result?.success || !result.data) return "";
    hit = { at: Date.now(), describe: result.data };
    cache.set(key, hit);
  }
  return `${fieldListText(hit.describe)}\n\nFix the query from this list; don't guess another name.`;
}

/** The `describe_sobject` text: a field table, picklist values, optionally only `only`. */
export function describeText(data: Describe, only?: string[]): string {
  const wanted = only?.length ? new Set(only.map((f) => f.toLowerCase())) : null;
  const all = data.fields.filter((f) => !f.deprecatedAndHidden || wanted);
  const shown = wanted ? all.filter((f) => wanted.has(f.name.toLowerCase())) : all.slice(0, 100);
  let message = `# ${data.label} (${data.name})\n\n`;
  message += wanted
    ? `## Fields (${shown.length} of ${data.fields.length})\n\n`
    : `## Fields (${data.fields.length})\n\n`;
  message += `| Field | Label | Type | Required | Updateable | Values / points to |\n`;
  message += `| --- | --- | --- | --- | --- | --- |\n`;
  for (const f of shown) {
    message += `| ${f.name} | ${f.label} | ${f.type} | ${f.required ? "Yes" : "No"} | ${f.updateable ? "Yes" : "No"} | ${extraFor(f)} |\n`;
  }
  if (wanted) {
    const found = new Set(shown.map((f) => f.name.toLowerCase()));
    const missing = (only ?? []).filter((f) => !found.has(f.toLowerCase()));
    if (missing.length)
      message += `\n**Not on ${data.name}:** ${missing.join(", ")}. Every field: call again without \`fields\`.\n`;
  } else if (data.fields.length > 100) {
    const rest = data.fields.slice(100).map((f) => f.name);
    message += `\n**Other fields (${rest.length}):** ${rest.join(", ")}\n\nPass \`fields\` to see their types and values.\n`;
  }
  return message;
}

function extraFor(f: Describe["fields"][number]): string {
  if (f.type === "reference" && f.referenceTo?.length)
    return `${f.referenceTo.join(", ")}${f.relationshipName ? ` (as ${f.relationshipName})` : ""}`;
  const values = (f.picklistValues ?? []).filter((v) => v.active !== false).map((v) => v.value);
  if (!values.length) return "";
  const cut =
    values.length > 25
      ? `${values.slice(0, 25).join(", ")}, … (${values.length})`
      : values.join(", ");
  return cut.replace(/\|/g, "\\|");
}
