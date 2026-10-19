/**
 * What `record.getContextData()` returns in a Visit Action Validation script:
 * the visit and the records the rep entered on it, read from the org.
 *
 * Web keys are `Object.VisitId` plus a `ProviderVisit` header; the iPad uses
 * plain object names. Objects or fields the org doesn't have are skipped with a
 * note, never an error.
 */

import { pickFields, plainRow, sqlString } from "./fields.js";
import { type OrgReader, type Platform, type Row } from "./types.js";

const CHILD_CAP = 200;

/** Child objects read for the visit. */
const VISIT_CHILDREN = ["ProviderVisitProdDetailing", "ProductDisbursement", "ProviderVisitRqstSample", "ProviderVisitMarketingItem"] as const;
/** Grandchildren read per detail, linked through `ProviderVisitProductDtlId`. */
const DETAIL_CHILDREN = ["ProviderVisitDtlProductMsg", "ProviderVisitProdDiscussion"] as const;

/** A way a child object can point at the visit: its field, and the ids that field holds. */
interface Link {
  field: string;
  ids: string[];
}

/** Reads the object's rows through the first link whose field the object has. */
async function readChildren(reader: OrgReader, object: string, links: Link[], notes: string[]): Promise<Row[]> {
  const info = await reader.describe(object);
  if (!info) {
    notes.push(`${object} isn't in this org (or isn't readable), so it's left out of the visit's context data.`);
    return [];
  }
  const link = links.find((l) => l.ids.length && info.fields.some((f) => f.name === l.field));
  if (!link) {
    if (links.some((l) => l.ids.length)) {
      notes.push(`${object} has no ${links.map((l) => l.field).join(" or ")} field here, so it's left out of the visit's context data.`);
    }
    return [];
  }
  const { fields } = pickFields(info);
  const list = link.ids.map(sqlString).join(", ");
  try {
    const rows = await reader.query(`SELECT ${fields.join(", ")} FROM ${object} WHERE ${link.field} IN (${list}) LIMIT ${CHILD_CAP + 1}`);
    if (rows.length > CHILD_CAP) notes.push(`${object}: only the first ${CHILD_CAP} rows are in the visit's context data.`);
    return rows.slice(0, CHILD_CAP).map(plainRow);
  } catch (e) {
    notes.push(`${object} couldn't be read (${e instanceof Error ? e.message : String(e)}); it's left out of the visit's context data.`);
    return [];
  }
}

/**
 * @param linkField  the child objects' field pointing at the record (`ProviderVisitId` or `VisitId`)
 */
export async function buildVisitContext(
  reader: OrgReader,
  platform: Platform,
  header: Row,
  recordObject: string,
  linkField: "ProviderVisitId" | "VisitId",
  notes: string[],
): Promise<Row> {
  const web = platform === "web";
  const key = (object: string) => (web ? `${object}.VisitId` : object);
  const ctx: Row = {};
  const id = String(header.Id);

  ctx[web ? "ProviderVisit" : recordObject === "ProviderVisit" ? "Visit" : recordObject] = header;

  // Some children point at the ProviderVisit, others (ProductDisbursement) only at the Visit.
  const visitId = recordObject === "Visit" ? id : typeof header.VisitId === "string" ? header.VisitId : null;
  const links: Link[] = [
    { field: linkField, ids: [id] },
    { field: "VisitId", ids: visitId ? [visitId] : [] },
  ];

  let details: Row[] = [];
  for (const object of VISIT_CHILDREN) {
    const rows = await readChildren(reader, object, links, notes);
    ctx[key(object)] = rows;
    if (object === "ProviderVisitProdDetailing") details = rows;
  }

  // Messages and discussions hang off each detail.
  const detailIds = details.map((d) => String(d.Id));
  for (const object of DETAIL_CHILDREN) {
    const rows = await readChildren(reader, object, [{ field: "ProviderVisitProductDtlId", ids: detailIds }], notes);
    for (const d of details) d[key(object)] = rows.filter((r) => r.ProviderVisitProductDtlId === d.Id);
  }

  // Presentations shown at the visit, and attendee visits.
  if (visitId) {
    ctx[web ? "PresentationForum.ForumReferenceId" : "PresentationForum"] = await readChildren(
      reader,
      "PresentationForum",
      [{ field: "ForumReferenceId", ids: [visitId] }],
      notes,
    );
    const children = await readChildren(reader, "Visit", [{ field: "ParentVisitId", ids: [visitId] }], notes);
    if (children.length || web) ctx[web ? "Visit.ParentVisitId" : "ChildVisit"] = children;
  }

  if (!web) {
    notes.push(
      "iPad context data uses plain object names (ProviderVisitProdDetailing, ProductDisbursement, ...). The header key (Visit) and ChildVisit are inferred from the official example, not confirmed against the app.",
    );
  }
  notes.push(`Context data is read from saved records, so edits the rep has made on the iPad but not saved aren't in it (at most ${CHILD_CAP} rows per object).`);
  return ctx;
}
