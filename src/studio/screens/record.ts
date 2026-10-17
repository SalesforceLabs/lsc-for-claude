/**
 * Record screen (SFFlexipageViewController and its record views) — the data the
 * viewer's iPad shows for the records its list views open. Read-only: SOQL and
 * REST GETs, batched per object so the query count stays bounded.
 */

import { apiRequest } from "../../salesforce/cli.js";
import { ID_PATTERN, inList, query, type Row } from "../helpers.js";
import { listCell, MULTI_ENTITY, trimNamespace, type PublishedComponent, type PublishedListData } from "../published.js";
import type { ScreenContext } from "./context.js";
import type { RecordFieldSpec } from "./record-fields.js";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

/** Records read per list view (the first page is 20; the preview opens the top of it). */
const PER_LIST = 10;
/** Records read per object across its lists. */
const PER_OBJECT = 30;
/** Related-list rows shown before "View All" (GenericRelatedListViewController). */
export const RELATED_ROWS = 5;
const API = "/services/data/v68.0";

export interface PublishedRelated {
  /** `Child.Field`, the key of the layout's related list. */
  key: string;
  /** The flexipage `relatedListApiName` (child relationship name) that shows it. */
  api: string;
  label: string;
  object: string;
  count: number;
  columns: { label: string; type: string }[];
  rows: { id: string; cells: string[] }[];
}

export interface PublishedInlineCard {
  title: string;
  /** The record's object, and its cells in order: `half` is slds-size_1-of-2. */
  object: string;
  cells: { label: string; field: string; half: boolean }[];
}

export interface PublishedRecordData {
  id: string;
  object: string;
  recordType: string | null;
  title: string;
  /** Formatted values by object (the record's, then its multi-entity partner's) and lower-cased field API name. */
  values: Record<string, Record<string, string>>;
  /** The multi-entity partner (Visit ↔ ProviderVisit) and its id. */
  linked?: { object: string; id: string };
  /** Whether the section header shows the Edit pencil (FlexipageViewActionsService.isEditActionAllowed). */
  editable: boolean;
  related: Record<string, PublishedRelated>;
  /** Expenses tab: row count and the total, formatted with the currency. */
  expenses?: { count: number; total: string };
}

export interface PublishedRecords {
  byId: Record<string, PublishedRecordData>;
  /** Theme (circle color and glyph) of related-list objects, by object. */
  themes: Record<string, { color: string; iconUrl: string }>;
  /** Org-defined inline components (`lscMobileInline_*`) by component name. */
  inline: Record<string, PublishedInlineCard>;
}

interface Describe {
  name: string;
  fields: Map<string, Row>;
  children: Row[];
  recordTypes: Map<string, string>;
  nameField: string;
  updateable: boolean;
}

// ---------- pure helpers (unit-tested) ----------

/** Layout related-list key (`Child.Field`) for a flexipage `relatedListApiName` (a child relationship name). */
export function relatedKey(children: Row[], apiName: string): string | null {
  const c = children.find((x) => str(x.relationshipName) === apiName);
  return c ? `${str(c.childSObject)}.${str(c.field)}` : null;
}

/**
 * MultiEntity / Visit rule: a submitted (Completed) or signed visit, or one the
 * viewer doesn't own, has no Edit; so does a record the viewer can't edit.
 */
export function isEditable(input: { object: string; status: string; ownerId: string; viewerId: string; hasEditAccess: boolean; updateable: boolean; signed?: boolean }): boolean {
  if (!input.hasEditAccess || !input.updateable) return false;
  if (input.object === "Visit" || input.object === "ProviderVisit") {
    return input.status !== "Completed" && !input.signed && input.ownerId === input.viewerId;
  }
  return true;
}

/** The menu's actions: Edit is the section pencil, Unlock is hidden, and ChangeOwner* is unsupported. */
export function menuActions(actionNames: string[]): string[] {
  return actionNames.filter((a) => !/^(?:\w+\.)?edit$/i.test(a) && !/unlock$/i.test(a) && !/^ChangeOwner/i.test(a));
}

/** Action label: `Visit.lsc4ce__Email` → "Email". */
export function actionLabel(name: string): string {
  const base = name.split(".").pop() ?? name;
  return base.replace(/^\w+__/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

/** Parses an org-defined inline LWC (card title, then label/value cells) into a card; null when it isn't that shape. */
export function parseInlineCard(html: string, js: string): PublishedInlineCard | null {
  const title = /<lightning-card[^>]*\btitle="([^"]*)"/.exec(html)?.[1];
  if (title === undefined) return null;
  const fieldsByProp = new Map<string, string>();
  let object = "";
  for (const m of js.matchAll(/(\w+)\s*:\s*getFieldValue\(\s*\w+\s*,\s*"(\w+)\.(\w+)"\s*\)/g)) {
    fieldsByProp.set(m[1], m[3]);
    object = m[2];
  }
  const cells: PublishedInlineCard["cells"] = [];
  for (const m of html.matchAll(/slds-size_(\d)-of-(\d)[^"]*"[\s\S]*?<p[^>]*field-label[^>]*>([^<]*)<\/p>\s*<p[^>]*field-value[^>]*>\{\w+\.(\w+)\}<\/p>/g)) {
    const field = fieldsByProp.get(m[4]);
    if (field) cells.push({ label: m[3].trim(), field, half: m[1] === "1" && m[2] === "2" });
  }
  return object && cells.length ? { title, object, cells } : null;
}

/** A multi-select picklist value or single one, as its label. */
function picklistText(value: string, labels: Record<string, string> | undefined, describeField: Row | undefined): string {
  const lookup = (v: string) => labels?.[v] ?? str(arr(describeField?.picklistValues).find((p) => str(p.value) === v)?.label) ?? v;
  return value
    .split(";")
    .map((v) => lookup(v) || v)
    .join("; ");
}

function addressText(a: Row): string {
  const line = [str(a.street), [str(a.city), str(a.state)].filter(Boolean).join(", "), str(a.postalCode)].filter(Boolean).join(" ");
  return [line, str(a.country)].filter(Boolean).join(" ");
}

type Format = { timeZone: string; locale: string };

/** One field's value as the record screen prints it. */
export function formatValue(value: unknown, spec: Pick<RecordFieldSpec, "type" | "picklist">, describeField: Row | undefined, format: Format): string {
  if (value === null || value === undefined || value === "") return "";
  const type = str(describeField?.type).toLowerCase() || spec.type;
  if (type === "address" || (typeof value === "object" && !Array.isArray(value))) return addressText(obj(value));
  if (type === "picklist" || type === "multipicklist") return picklistText(str(value), spec.picklist, describeField);
  if (type === "boolean") return listCell(value, "boolean", format);
  return listCell(value, type, format);
}

// ---------- collector ----------

const describeCache = new WeakMap<ScreenContext, Map<string, Promise<Describe | null>>>();

function describeOf(ctx: ScreenContext, object: string): Promise<Describe | null> {
  let cache = describeCache.get(ctx);
  if (!cache) describeCache.set(ctx, (cache = new Map()));
  const hit = cache.get(object);
  if (hit) return hit;
  const p = (async () => {
    const r = await apiRequest<Row>(`${API}/sobjects/${object}/describe`, "GET", undefined, ctx.org).catch(() => null);
    if (!r?.success || !r.data) return null;
    const d = r.data;
    const fields = new Map(arr(d.fields).map((f) => [str(f.name).toLowerCase(), f]));
    return {
      name: object,
      fields,
      children: arr(d.childRelationships),
      recordTypes: new Map(arr(d.recordTypeInfos).map((t) => [str(t.recordTypeId), str(t.developerName)])),
      nameField: str(arr(d.fields).find((f) => f.nameField === true)?.name) || "Name",
      updateable: d.updateable !== false,
    } satisfies Describe;
  })();
  cache.set(object, p);
  return p;
}

const layoutObject = (layoutName: string) => layoutName.slice(0, Math.max(0, layoutName.indexOf("-")));

/** Every layout item the record screen can show for an object: its layouts' sections and its compact layouts. */
function specsFor(ctx: ScreenContext, object: string): RecordFieldSpec[] {
  const out: RecordFieldSpec[] = [];
  for (const [name, layout] of Object.entries(ctx.core.layouts)) {
    if (layoutObject(name) !== object) continue;
    for (const s of layout.sections) for (const col of s.fields ?? []) out.push(...col);
  }
  for (const [name, fields] of Object.entries(ctx.core.compactFields ?? {})) if (name.startsWith(`${object}.`)) out.push(...fields);
  return out;
}

/** Page components of the object's record types' flexipages, tabs flattened. */
function pageComponents(ctx: ScreenContext, object: string): PublishedComponent[] {
  const pages = new Set(ctx.core.objects[object]?.recordTypes.map((r) => r.flexiPage).filter((x): x is string => !!x));
  const flat = (c: PublishedComponent): PublishedComponent[] => [c, ...(c.tabs ?? []).flatMap((t) => t.components.flatMap(flat))];
  return [...pages].flatMap((p) => (ctx.core.pages[p]?.regions ?? []).flatMap((r) => r.components.flatMap(flat)));
}

interface Fetched {
  rows: Row[];
  /** Selected path → the spec used to format it. */
  specs: Map<string, RecordFieldSpec>;
  describe: Describe;
}

/** Reads `ids` of `object` (or `where`) with every layout field the describe knows; lookups come as `Rel.Name`. */
async function fetchRows(ctx: ScreenContext, object: string, where: string, extra: string[]): Promise<Fetched | null> {
  const describe = await describeOf(ctx, object);
  if (!describe) return null;
  const specs = new Map<string, RecordFieldSpec>();
  for (const s of specsFor(ctx, object)) {
    if (s.name.includes(".")) continue;
    const f = describe.fields.get(s.name.toLowerCase());
    if (f) specs.set(str(f.name), { ...s, name: str(f.name) });
  }
  const paths = new Set<string>(["Id", describe.nameField, ...extra]);
  if (describe.fields.has("recordtypeid")) paths.add("RecordTypeId");
  if (describe.fields.has("ownerid")) paths.add("OwnerId");
  for (const name of specs.keys()) {
    const f = describe.fields.get(name.toLowerCase());
    paths.add(name);
    if (f && str(f.type) === "reference" && f.relationshipName) paths.add(`${str(f.relationshipName)}.Name`);
  }
  const select = (list: string[]) => `SELECT ${list.join(", ")} FROM ${object} WHERE ${where}`;
  try {
    return { rows: await query(select([...paths]), ctx.org), specs, describe };
  } catch {
    // A relationship with no Name, or an unreadable field: fall back to the scalar fields.
    const scalar = [...paths].filter((p) => !p.includes("."));
    try {
      return { rows: await query(select(scalar), ctx.org), specs, describe };
    } catch {
      return null;
    }
  }
}

function toValues(ctx: ScreenContext, fetched: Fetched, row: Row, unsynced: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of fetched.specs) {
    const f = fetched.describe.fields.get(name.toLowerCase());
    const raw = row[name];
    if (f && str(f.type) === "reference") {
      const rel = f.relationshipName ? obj(row[str(f.relationshipName)]) : {};
      const shown = unsynced.has(str(raw)) ? "" : str(rel.Name);
      out[name.toLowerCase()] = shown;
      continue;
    }
    out[name.toLowerCase()] = formatValue(raw, spec, f, ctx.format);
  }
  return out;
}

/** Ids of referenced records the device would not have downloaded (its local join finds nothing). A polymorphic lookup is kept when any target holds the record. */
async function unsyncedIds(ctx: ScreenContext, fetched: Fetched[]): Promise<Set<string>> {
  const targetsOf = new Map<string, Set<string>>();
  for (const f of fetched) {
    for (const name of f.specs.keys()) {
      const field = f.describe.fields.get(name.toLowerCase());
      if (str(field?.type) !== "reference") continue;
      const targets = arr(field?.referenceTo).length ? (field?.referenceTo as unknown[]).map(str) : [];
      for (const r of f.rows) {
        const id = str(r[name]);
        if (!ID_PATTERN.test(id)) continue;
        const set = targetsOf.get(id) ?? new Set<string>();
        targets.forEach((t) => set.add(t));
        targetsOf.set(id, set);
      }
    }
  }
  const idsByTarget = new Map<string, string[]>();
  for (const [id, targets] of targetsOf) for (const t of targets) idsByTarget.set(t, [...(idsByTarget.get(t) ?? []), id]);
  /** Ids a target's local table holds: "all" when its filter can't be checked or is empty. */
  const held = new Map<string, Set<string> | "all" | "none">();
  await Promise.all(
    [...idsByTarget].map(async ([target, ids]) => {
      const condition = ctx.scope(target);
      if (condition === undefined) return void held.set(target, "none");
      if (!condition) return void held.set(target, "all");
      const found = await query(`SELECT Id FROM ${target} WHERE Id IN (${inList(ids)}) AND (${condition})`, ctx.org).catch(() => null);
      held.set(target, found ? new Set(found.map((r) => str(r.Id))) : "all");
    })
  );
  const unsynced = new Set<string>();
  for (const [id, targets] of targetsOf) {
    const kept = [...targets].some((t) => {
      const h = held.get(t);
      return h === "all" || (h instanceof Set && h.has(id));
    });
    if (targets.size && !kept) unsynced.add(id);
  }
  return unsynced;
}

/** First rows per list view, grouped by object. */
function idsByObject(lists: Record<string, PublishedListData>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, data] of Object.entries(lists)) {
    const object = key.slice(0, key.indexOf("."));
    const ids = out.get(object) ?? [];
    for (const r of data.rows.slice(0, PER_LIST)) if (ID_PATTERN.test(r.id) && !ids.includes(r.id) && ids.length < PER_OBJECT) ids.push(r.id);
    out.set(object, ids);
  }
  return out;
}

async function relatedLists(ctx: ScreenContext, object: string, ids: string[], d: Describe): Promise<Map<string, PublishedRelated[]>> {
  const out = new Map<string, PublishedRelated[]>(ids.map((id) => [id, []]));
  const keys = new Map<string, string>();
  for (const c of pageComponents(ctx, object)) {
    const api = c.properties.relatedListApiName;
    const key = api ? relatedKey(d.children, api) : null;
    if (key) keys.set(key, api);
  }
  const layouts = Object.entries(ctx.core.layouts).filter(([n]) => layoutObject(n) === object);
  const layoutList = (key: string) => layouts.flatMap(([, l]) => l.relatedLists).find((r) => r.name === key);
  await Promise.all(
    [...keys.keys()].map(async (key) => {
      const [child, field] = key.split(".");
      const cd = await describeOf(ctx, child);
      if (!cd || !cd.fields.has(field.toLowerCase())) return;
      const layoutRl = layoutList(key);
      const condition = ctx.scope(child);
      const label = layoutRl?.label || child;
      const specs = (layoutRl?.columns ?? []).filter((s) => s.name);
      const columns = await Promise.all(
        (specs.length ? specs : [{ name: cd.nameField, label: "", type: "string" }]).map(async (s) => {
          const own = cd.fields.get(s.name.toLowerCase());
          // A dotted column (MessageRecord.ContentText) is labelled by the related object's own field.
          let far: Row | undefined;
          if (!own && s.name.includes(".")) {
            const [rel, leaf] = s.name.split(".");
            const via = [...cd.fields.values()].find((f) => str(f.relationshipName).toLowerCase() === rel.toLowerCase());
            const target = str(arr(via?.referenceTo)[0]);
            far = target ? (await describeOf(ctx, target))?.fields.get(leaf.toLowerCase()) : undefined;
          }
          const f = own ?? far;
          return { label: s.label || str(f?.label) || s.name, type: str(f?.type).toLowerCase() || s.type };
        })
      );
      const base: Omit<PublishedRelated, "count" | "rows"> = { key, api: keys.get(key) ?? "", label, object: child, columns };
      const add = (id: string, count: number, rows: PublishedRelated["rows"]) => out.get(id)?.push({ ...base, count, rows });
      if (condition === undefined) return ids.forEach((id) => add(id, 0, []));
      const scoped = condition ? ` AND (${condition})` : "";
      const counts = new Map<string, number>();
      try {
        const grouped = await query(`SELECT ${field} p, COUNT(Id) c FROM ${child} WHERE ${field} IN (${inList(ids)})${scoped} GROUP BY ${field}`, ctx.org);
        for (const g of grouped) counts.set(str(g.p), Number(g.c) || 0);
      } catch {
        return;
      }
      const rowsBy = new Map<string, PublishedRelated["rows"]>();
      if ([...counts.values()].some((n) => n > 0)) {
        const paths = (specs.length ? specs : [{ name: cd.nameField, label: "", type: "string" }]).map((s) => s.name);
        const select = (p: string[]) => `SELECT Id, ${field}, ${[...new Set(p)].join(", ")} FROM ${child} WHERE ${field} IN (${inList(ids)})${scoped} ORDER BY ${cd.nameField} DESC LIMIT 200`;
        const rel = (name: string) => {
          const f = cd.fields.get(name.toLowerCase());
          return f && str(f.type) === "reference" && f.relationshipName ? `${str(f.relationshipName)}.Name` : name;
        };
        const records = await query(select(paths.map(rel)), ctx.org).catch(() => query(select(paths.filter((p) => !p.includes("."))), ctx.org).catch(() => [] as Row[]));
        for (const r of records) {
          const parent = str(r[field]);
          const list = rowsBy.get(parent) ?? [];
          if (list.length >= RELATED_ROWS) continue;
          const cells = (specs.length ? specs : [{ name: cd.nameField, label: "", type: "string" } as RecordFieldSpec]).map((s) => {
            const f = cd.fields.get(s.name.toLowerCase());
            if (f && str(f.type) === "reference") return str(obj(r[str(f.relationshipName)]).Name);
            const raw = s.name.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Row)[k] : undefined), r);
            return formatValue(raw, s, f, ctx.format);
          });
          list.push({ id: str(r.Id), cells });
          rowsBy.set(parent, list);
        }
      }
      for (const id of ids) add(id, counts.get(id) ?? 0, rowsBy.get(id) ?? []);
    })
  );
  return out;
}

async function themeOf(ctx: ScreenContext, object: string): Promise<{ color: string; iconUrl: string } | null> {
  const fromCore = ctx.core.objects[object]?.theme;
  if (fromCore) return fromCore;
  const r = await apiRequest<Row>(`${API}/ui-api/object-info/${object}`, "GET", undefined, ctx.org).catch(() => null);
  const t = obj(r?.success ? r.data?.themeInfo : null);
  return t.color ? { color: `#${str(t.color).replace(/^#/, "")}`, iconUrl: str(t.iconUrl) } : null;
}

async function inlineCards(ctx: ScreenContext, objects: string[]): Promise<Record<string, PublishedInlineCard>> {
  const names = new Set(objects.flatMap((o) => pageComponents(ctx, o)).map((c) => trimNamespace(c.name)).filter((n) => /^lscMobileInline_\w+$/.test(n)));
  const out: Record<string, PublishedInlineCard> = {};
  await Promise.all(
    [...names].map(async (n) => {
      const files = await query(`SELECT FilePath, Source FROM LightningComponentResource WHERE LightningComponentBundle.DeveloperName = '${n}'`, ctx.org, true).catch(() => [] as Row[]);
      const source = (ext: string) => str(files.find((f) => str(f.FilePath).endsWith(ext))?.Source);
      const card = parseInlineCard(source(".html"), source(".js"));
      if (card) out[n] = card;
    })
  );
  return out;
}

export async function collectRecords(ctx: ScreenContext, lists: Record<string, PublishedListData>): Promise<PublishedRecords | undefined> {
  const wanted = idsByObject(lists);
  const byId: Record<string, PublishedRecordData> = {};
  const themes: Record<string, { color: string; iconUrl: string }> = {};
  const objects = [...wanted.keys()].filter((o) => ctx.core.objects[o] && wanted.get(o)?.length);
  if (!objects.length) return undefined;

  await Promise.all(
    objects.map(async (object) => {
      const ids = wanted.get(object) ?? [];
      const partner = MULTI_ENTITY[object]?.with;
      const [main, access] = await Promise.all([
        fetchRows(ctx, object, `Id IN (${inList(ids)})`, ["Status"].filter(() => object === "Visit")),
        query(`SELECT RecordId, HasEditAccess FROM UserRecordAccess WHERE UserId = '${ctx.userId}' AND RecordId IN (${inList(ids)})`, ctx.org).catch(() => [] as Row[]),
      ]);
      if (!main) return;
      // The partner record is the one whose lookup points back at this record (MultiEntityViewModel.getFetchQuery).
      let linkedFetch: Fetched | null = null;
      let linkField = "";
      if (partner && ctx.core.objects[object]?.recordTypes.some((r) => r.multiEntity)) {
        const pd = await describeOf(ctx, partner);
        linkField = str(arr([...(pd?.fields.values() ?? [])]).find((f) => arr(f.referenceTo).map(str).includes(object) && f.nameField !== true)?.name);
        if (pd && linkField) linkedFetch = await fetchRows(ctx, partner, `${linkField} IN (${inList(ids)})`, [linkField, "Status"].filter((p) => p !== "Status" || pd.fields.has("status")));
      }
      const unsynced = await unsyncedIds(ctx, linkedFetch ? [main, linkedFetch] : [main]);
      const rel = await relatedLists(ctx, object, ids, main.describe);
      const edit = new Map(access.map((a) => [str(a.RecordId), a.HasEditAccess === true]));
      const components = pageComponents(ctx, object);
      const expensesOn = components.some((c) => trimNamespace(c.name) === "ExpensesListView");
      const expenses = expensesOn ? await readExpenses(ctx, ids) : undefined;

      for (const row of main.rows) {
        const id = str(row.Id);
        const values: Record<string, Record<string, string>> = { [object]: toValues(ctx, main, row, unsynced) };
        const partnerRow = linkedFetch?.rows.find((r) => str(r[linkField]).slice(0, 15) === id.slice(0, 15));
        if (linkedFetch && partnerRow) values[partner] = toValues(ctx, linkedFetch, partnerRow, unsynced);
        const rtName = main.describe.recordTypes.get(str(row.RecordTypeId)) ?? null;
        const status = str(partnerRow?.Status ?? row.Status);
        byId[id] = {
          id,
          object,
          recordType: rtName,
          title: str(row[main.describe.nameField]),
          values,
          ...(partnerRow && partner ? { linked: { object: partner, id: str(partnerRow.Id) } } : {}),
          editable: isEditable({ object, status, ownerId: str(row.OwnerId), viewerId: ctx.userId, hasEditAccess: edit.get(id) === true, updateable: main.describe.updateable }),
          related: Object.fromEntries((rel.get(id) ?? []).map((r) => [r.key, r])),
          ...(expenses ? { expenses: expenses.get(id) ?? { count: 0, total: `${expenses.currency} 0.00` } } : {}),
        };
      }
    })
  );
  if (!Object.keys(byId).length) return undefined;

  const children = [...new Set(Object.values(byId).flatMap((r) => Object.values(r.related).map((x) => x.object)))];
  await Promise.all(
    children.map(async (c) => {
      const t = await themeOf(ctx, c);
      if (t) themes[c] = t;
    })
  );
  return { byId, themes, inline: await inlineCards(ctx, objects) };
}

/** Expenses tab: ExpenseOriginId → Visit; the total sums Amount in the org's currency. */
async function readExpenses(ctx: ScreenContext, ids: string[]): Promise<Map<string, { count: number; total: string }> & { currency: string }> {
  const out = new Map<string, { count: number; total: string }>() as Map<string, { count: number; total: string }> & { currency: string };
  const corporate = await query("SELECT IsoCode FROM CurrencyType WHERE IsCorporate = true", ctx.org).catch(() => [] as Row[]);
  const iso = str(corporate[0]?.IsoCode);
  out.currency = /^[A-Z]{3}$/.test(iso) ? iso : "USD";
  const rows = await query(`SELECT ExpenseOriginId, Amount FROM Expense WHERE ExpenseOriginId IN (${inList(ids)})`, ctx.org).catch(() => [] as Row[]);
  const sums = new Map<string, { count: number; sum: number }>();
  for (const r of rows) {
    const s = sums.get(str(r.ExpenseOriginId)) ?? { count: 0, sum: 0 };
    s.count++;
    s.sum += Number(r.Amount) || 0;
    sums.set(str(r.ExpenseOriginId), s);
  }
  for (const [id, s] of sums) out.set(id, { count: s.count, total: `${out.currency} ${s.sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` });
  return out;
}
