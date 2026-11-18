/**
 * Reads for the Intelligent Content builder: the library, one presentation as a draft with the ids of
 * the records behind it, and what can be added to it (pages, topics, products, territories).
 */

import { describeSObject } from "../../salesforce/cli.js";
import { ID_PATTERN, inList, query, queryResult, type Row } from "../helpers.js";
import { isProductionOrg } from "../metadata/live.js";
import { addPageImages, addThumbnails } from "../screens/content.js";
import type { PublishedContentCard } from "../screens/content.js";
import type { DraftRows } from "./logic.js";
import type {
  DraftShare,
  Named,
  NewPresentationOptions,
  PageOption,
  PresentationDetail,
  PresentationDraft,
  PresentationLibrary,
  PresentationSummary,
  TerritoryOption,
} from "./types.js";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const LIBRARY_LIMIT = 2000;
const OPTION_LIMIT = 2000;
/** Library rows that get a first-page image (most recently changed first). */
const LIBRARY_THUMBNAILS = 24;
const MISSING =
  /INVALID_TYPE|sObject type|not supported|isn't supported|doesn't exist|does not exist/i;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function inChunks(
  ids: string[],
  build: (list: string) => string,
  org: string
): Promise<Row[]> {
  const valid = [...new Set(ids)].filter((id) => ID_PATTERN.test(id));
  if (!valid.length) return [];
  return (await Promise.all(chunks(valid, 200).map((c) => query(build(inList(c)), org)))).flat();
}

const relName = (r: Row, rel: string) => s((r[rel] as Row | null | undefined)?.Name);

// --- Library ---------------------------------------------------------------------------------

export async function loadLibrary(org: string): Promise<PresentationLibrary> {
  let res;
  try {
    res = await queryResult(
      `SELECT Id, Name, Status, Type, ActivationDate, DeactivationDate, IsCustom, LastModifiedDate, LastModifiedBy.Name
       FROM Presentation WHERE Status != 'Deleted' ORDER BY LastModifiedDate DESC LIMIT ${LIBRARY_LIMIT + 1}`,
      org
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (MISSING.test(message))
      return { presentations: [], unavailable: "This org has no Intelligent Content objects." };
    throw err;
  }
  const rows = res.records.slice(0, LIBRARY_LIMIT);
  const ids = rows.map((r) => s(r.Id));
  const [links, topics, shares] = await Promise.all([
    inChunks(
      ids,
      (l) =>
        `SELECT PresentationId, DisplayOrder, PresentationPage.PageNumber, PresentationPage.ContentDocumentId
         FROM PresentationLinkedPage WHERE PresentationId IN (${l}) ORDER BY PresentationId, DisplayOrder`,
      org
    ),
    inChunks(
      ids,
      (l) => `SELECT EntityId, Topic.Name FROM TopicAssignment WHERE EntityId IN (${l})`,
      org
    ).catch(() => [] as Row[]),
    inChunks(
      ids,
      (l) =>
        `SELECT ParentId, UserOrGroupId FROM PresentationShare WHERE ParentId IN (${l}) AND RowCause IN ('Manual', 'LSC4CEAutoShare')`,
      org
    ).catch(() => [] as Row[]),
  ]);
  const linked = new Map<string, Row[]>();
  for (const l of links)
    linked.set(s(l.PresentationId), [...(linked.get(s(l.PresentationId)) ?? []), l]);
  const topicsOf = new Map<string, string[]>();
  for (const t of topics)
    topicsOf.set(s(t.EntityId), [...(topicsOf.get(s(t.EntityId)) ?? []), relName(t, "Topic")]);
  // Distribution counts only territory groups, as the builder does.
  const groups = await territoryGroups(
    shares.map((r) => s(r.UserOrGroupId)),
    org
  ).catch(() => new Map<string, GroupRow>());
  const territoriesOf = new Map<string, Set<string>>();
  for (const r of shares) {
    const g = groups.get(s(r.UserOrGroupId));
    if (!g) continue;
    const set = territoriesOf.get(s(r.ParentId)) ?? new Set<string>();
    set.add(g.groupId);
    territoriesOf.set(s(r.ParentId), set);
  }

  const presentations: PresentationSummary[] = rows.map((r) => ({
    id: s(r.Id),
    name: s(r.Name),
    status: s(r.Status),
    type: s(r.Type),
    activationDate: (r.ActivationDate as string | null) ?? null,
    deactivationDate: (r.DeactivationDate as string | null) ?? null,
    pages: linked.get(s(r.Id))?.length ?? 0,
    territories: territoriesOf.get(s(r.Id))?.size ?? 0,
    topics: (topicsOf.get(s(r.Id)) ?? []).filter(Boolean).sort(),
    isCustom: r.IsCustom === true,
    lastModified: s(r.LastModifiedDate),
    lastModifiedBy: relName(r, "LastModifiedBy"),
  }));

  // First-page images for the most recently changed (the same images the iPad's grid uses).
  const cards = presentations
    .slice(0, LIBRARY_THUMBNAILS)
    .map((p) => ({ id: p.id, type: p.type }) as PublishedContentCard);
  await addThumbnails(cards, linked, org).catch(() => undefined);
  const thumbs = new Map(cards.map((c) => [c.id, c.thumbnail]));
  for (const p of presentations) if (thumbs.get(p.id)) p.thumbnail = thumbs.get(p.id);

  return {
    presentations,
    ...(res.records.length > LIBRARY_LIMIT
      ? {
          note: `Showing the ${LIBRARY_LIMIT.toLocaleString("en-US")} most recently changed presentations.`,
        }
      : {}),
  };
}

// --- One presentation ------------------------------------------------------------------------

interface GroupRow {
  groupId: string;
  territoryId: string;
  subordinates: boolean;
}

/** The territory groups among `ids` (Territory and TerritoryAndSubordinates), by group id. */
async function territoryGroups(ids: string[], org: string): Promise<Map<string, GroupRow>> {
  const groupIds = ids.filter((id) => id.startsWith("00G"));
  const rows = await inChunks(
    groupIds,
    (l) =>
      `SELECT Id, RelatedId, Type FROM Group WHERE Id IN (${l}) AND Type IN ('Territory', 'TerritoryAndSubordinates')`,
    org
  );
  return new Map(
    rows.map((g) => [
      s(g.Id),
      {
        groupId: s(g.Id),
        territoryId: s(g.RelatedId),
        subordinates: s(g.Type) === "TerritoryAndSubordinates",
      },
    ])
  );
}

const PRESENTATION_FIELDS = `Id, Name, Status, Type, UsageType, IsCustom, ActivationDate, DeactivationDate, PlayerGestureSectionSide,
  IsPinchZoomEnabled, IsDoubleTapZoomEnabled, CanSendByEmail, IsPresentationLocked, LastModifiedDate, LastModifiedBy.Name`;

export interface PresentationState {
  row: Row;
  draft: PresentationDraft;
  rows: DraftRows;
  /** PresentationShare rows the builder doesn't manage. */
  otherShares: number;
}

/**
 * The presentation as a draft, with the ids of its records. `extraPages` are pages not in it yet whose own state
 * (mandatory, products) a change needs.
 */
export async function readState(
  org: string,
  presentationId: string,
  extraPages: string[] = []
): Promise<PresentationState | null> {
  if (!ID_PATTERN.test(presentationId)) throw new Error("Not a presentation Id.");
  const [[row], links, topics, shares] = await Promise.all([
    query(`SELECT ${PRESENTATION_FIELDS} FROM Presentation WHERE Id = '${presentationId}'`, org),
    query(
      `SELECT Id, DisplayOrder, PresentationPageId, PresentationPage.Name FROM PresentationLinkedPage
       WHERE PresentationId = '${presentationId}' ORDER BY DisplayOrder, Id`,
      org
    ),
    query(
      `SELECT Id, TopicId, Topic.Name FROM TopicAssignment WHERE EntityId = '${presentationId}'`,
      org
    ),
    query(
      `SELECT Id, UserOrGroupId, RowCause FROM PresentationShare WHERE ParentId = '${presentationId}'`,
      org
    ),
  ]);
  if (!row || s(row.Status) === "Deleted") return null;

  const pageIds = [...new Set([...links.map((l) => s(l.PresentationPageId)), ...extraPages])];
  const [pages, products] = await Promise.all([
    inChunks(
      pageIds,
      (l) => `SELECT Id, Name, IsMandatory FROM PresentationPage WHERE Id IN (${l})`,
      org
    ),
    inChunks(
      pageIds,
      (l) =>
        `SELECT Id, PresentationPageId, ProductId, Product.Name FROM PresentationPageProduct WHERE PresentationPageId IN (${l})`,
      org
    ),
  ]);
  const pageState: DraftRows["pageState"] = new Map(
    pages.map((p) => [
      s(p.Id),
      { mandatory: p.IsMandatory === true, products: new Map<string, string>() },
    ])
  );
  const productNames = new Map<string, Named[]>();
  for (const p of products) {
    const page = s(p.PresentationPageId);
    pageState.get(page)?.products.set(s(p.ProductId), s(p.Id));
    productNames.set(page, [
      ...(productNames.get(page) ?? []),
      { id: s(p.ProductId), name: relName(p, "Product") || s(p.ProductId) },
    ]);
  }

  const managed = shares.filter(
    (r) => s(r.RowCause) === "Manual" || s(r.RowCause) === "LSC4CEAutoShare"
  );
  const groups = await territoryGroups(
    managed.map((r) => s(r.UserOrGroupId)),
    org
  );
  const territoryIds = [...new Set([...groups.values()].map((g) => g.territoryId))];
  const territories = await inChunks(
    territoryIds,
    (l) => `SELECT Id, Name FROM Territory2 WHERE Id IN (${l})`,
    org
  );
  const territoryName = new Map(territories.map((t) => [s(t.Id), s(t.Name)]));
  const shareRows = new Map<string, string[]>();
  for (const r of managed) {
    const g = s(r.UserOrGroupId);
    if (groups.has(g)) shareRows.set(g, [...(shareRows.get(g) ?? []), s(r.Id)]);
  }
  const draftShares: DraftShare[] = [...shareRows.keys()]
    .map((g) => {
      const grp = groups.get(g)!;
      return {
        groupId: g,
        territoryId: grp.territoryId,
        name: territoryName.get(grp.territoryId) ?? grp.territoryId,
        subordinates: grp.subordinates,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const draft: PresentationDraft = {
    fields: {
      name: s(row.Name),
      status: s(row.Status),
      activationDate: (row.ActivationDate as string | null) ?? null,
      deactivationDate: (row.DeactivationDate as string | null) ?? null,
      gesture: (row.PlayerGestureSectionSide as string | null) ?? null,
      pinchZoom: row.IsPinchZoomEnabled === true,
      doubleTapZoom: row.IsDoubleTapZoomEnabled === true,
      canEmail: row.CanSendByEmail === true,
      locked: row.IsPresentationLocked === true,
    },
    pages: links.map((l) => {
      const id = s(l.PresentationPageId);
      return {
        pageId: id,
        name: relName(l, "PresentationPage") || id,
        mandatory: pageState.get(id)?.mandatory ?? false,
        products: (productNames.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
    topics: topics
      .map((t) => ({ id: s(t.TopicId), name: relName(t, "Topic") }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    shares: draftShares,
  };
  return {
    row,
    draft,
    rows: {
      links: new Map(
        links.map((l) => [
          s(l.PresentationPageId),
          { id: s(l.Id), order: Number(l.DisplayOrder) || 0 },
        ])
      ),
      pageState,
      topics: new Map(topics.map((t) => [s(t.TopicId), s(t.Id)])),
      shares: shareRows,
    },
    // The owner's own row comes with every record; it isn't a distribution.
    otherShares:
      shares.filter((r) => s(r.RowCause) !== "Owner").length -
      [...shareRows.values()].flat().length,
  };
}

/** The other presentations each page is linked to. */
export async function sharedPages(
  org: string,
  presentationId: string,
  pageIds: string[]
): Promise<Record<string, string[]>> {
  const rows = await inChunks(
    pageIds,
    (l) =>
      `SELECT PresentationPageId, Presentation.Name FROM PresentationLinkedPage
       WHERE PresentationPageId IN (${l}) AND PresentationId != '${presentationId}'`,
    org
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[s(r.PresentationPageId)] ??= []).push(relName(r, "Presentation"));
  return out;
}

async function picklist(object: string, field: string, org: string): Promise<string[]> {
  try {
    const d = await describeSObject(object, org);
    const f = d.success ? d.data?.fields.find((x) => x.name === field) : undefined;
    return (
      (f as { picklistValues?: { value: string; active: boolean }[] } | undefined)
        ?.picklistValues ?? []
    )
      .filter((p) => p.active)
      .map((p) => p.value);
  } catch {
    return [];
  }
}

async function options(
  org: string,
  /** Null for a new presentation: every ZIP page is offered (a PDF presentation shows one PDF, so its pages can't be put together). */
  presentationId: string | null,
  notes: string[]
): Promise<PresentationDetail["options"]> {
  const cut = (rows: Row[], what: string) => {
    if (rows.length > OPTION_LIMIT)
      notes.push(
        `Only the first ${OPTION_LIMIT.toLocaleString("en-US")} ${what} are offered; search finds them by name.`
      );
    return rows.slice(0, OPTION_LIMIT);
  };
  const [pages, topics, products, model] = await Promise.all([
    query(
      `SELECT Id, Name, Type, Status, IsMandatory FROM PresentationPage WHERE IsAdditionalContent = false
       ${
         presentationId
           ? `AND Id NOT IN (SELECT PresentationPageId FROM PresentationLinkedPage WHERE PresentationId = '${presentationId}')`
           : "AND Type = 'ZIP' AND Status = 'Active'"
       }
       ORDER BY LastModifiedDate DESC LIMIT ${OPTION_LIMIT + 1}`,
      org
    ).catch(() => [] as Row[]),
    query(
      `SELECT Id, Name FROM Topic WHERE NetworkId = null ORDER BY Name LIMIT ${OPTION_LIMIT + 1}`,
      org
    ).catch(() => [] as Row[]),
    query(
      `SELECT Id, Name FROM LifeSciMarketableProduct ORDER BY Name LIMIT ${OPTION_LIMIT + 1}`,
      org
    ).catch(() => [] as Row[]),
    query(`SELECT Id FROM Territory2Model WHERE State = 'Active' LIMIT 1`, org).catch(
      () => [] as Row[]
    ),
  ]);
  const pageRows = cut(pages, "pages");
  const pageIds = pageRows.map((p) => s(p.Id));
  const [where, pageProducts] = await Promise.all([
    inChunks(
      pageIds,
      (l) =>
        `SELECT PresentationPageId, Presentation.Name FROM PresentationLinkedPage WHERE PresentationPageId IN (${l})`,
      org
    ).catch(() => [] as Row[]),
    inChunks(
      pageIds,
      (l) =>
        `SELECT PresentationPageId, ProductId, Product.Name FROM PresentationPageProduct WHERE PresentationPageId IN (${l})`,
      org
    ),
  ]);
  const productsOf = new Map<string, Named[]>();
  for (const r of pageProducts) {
    const id = s(r.PresentationPageId);
    productsOf.set(id, [
      ...(productsOf.get(id) ?? []),
      { id: s(r.ProductId), name: relName(r, "Product") || s(r.ProductId) },
    ]);
  }
  const inPresentations = new Map<string, string[]>();
  for (const r of where)
    inPresentations.set(s(r.PresentationPageId), [
      ...(inPresentations.get(s(r.PresentationPageId)) ?? []),
      relName(r, "Presentation"),
    ]);

  let territories: TerritoryOption[] = [];
  if (model[0]) {
    const rows = await query(
      `SELECT Id, Name, ParentTerritory2Id FROM Territory2 WHERE Territory2ModelId = '${s(model[0].Id)}' ORDER BY Name LIMIT ${OPTION_LIMIT + 1}`,
      org
    ).catch(() => [] as Row[]);
    const terr = cut(rows, "territories");
    const groups = await inChunks(
      terr.map((t) => s(t.Id)),
      (l) =>
        `SELECT Id, RelatedId, Type FROM Group WHERE RelatedId IN (${l}) AND Type IN ('Territory', 'TerritoryAndSubordinates')`,
      org
    ).catch(() => [] as Row[]);
    const byTerritory = new Map<string, { groupId?: string; subordinatesGroupId?: string }>();
    for (const g of groups) {
      const entry = byTerritory.get(s(g.RelatedId)) ?? {};
      if (s(g.Type) === "Territory") entry.groupId = s(g.Id);
      else entry.subordinatesGroupId = s(g.Id);
      byTerritory.set(s(g.RelatedId), entry);
    }
    territories = terr.map((t) => ({
      territoryId: s(t.Id),
      name: s(t.Name),
      parentId: (t.ParentTerritory2Id as string | null) ?? null,
      ...byTerritory.get(s(t.Id)),
    }));
  } else {
    notes.push(
      "The org has no active territory model, so there are no territories to distribute to."
    );
  }

  return {
    pages: pageRows.map(
      (p): PageOption => ({
        id: s(p.Id),
        name: s(p.Name),
        type: s(p.Type),
        status: s(p.Status),
        presentations: (inPresentations.get(s(p.Id)) ?? []).filter(Boolean),
        mandatory: p.IsMandatory === true,
        products: (productsOf.get(s(p.Id)) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      })
    ),
    topics: cut(topics, "topics").map((t) => ({ id: s(t.Id), name: s(t.Name) })),
    products: cut(products, "products").map((p) => ({ id: s(p.Id), name: s(p.Name) })),
    territories,
    notes,
  };
}

export async function loadDetail(
  org: string,
  presentationId: string
): Promise<PresentationDetail | { error: string }> {
  const state = await readState(org, presentationId);
  if (!state) return { error: "This presentation no longer exists." };
  const notes: string[] = [];
  const pageIds = state.draft.pages.map((p) => p.pageId);
  const [shared, opts, statusValues, gestureValues, production, pageThumbnails] = await Promise.all(
    [
      sharedPages(org, presentationId, pageIds).catch(() => ({})),
      options(org, presentationId, notes),
      picklist("Presentation", "Status", org),
      picklist("Presentation", "PlayerGestureSectionSide", org),
      isProductionOrg(org).catch(() => false),
      pageImages(org, presentationId, s(state.row.Type)).catch(() => ({})),
    ]
  );
  return {
    id: presentationId,
    type: s(state.row.Type),
    usageType: (state.row.UsageType as string | null) ?? null,
    isCustom: state.row.IsCustom === true,
    lastModified: s(state.row.LastModifiedDate),
    lastModifiedBy: relName(state.row, "LastModifiedBy"),
    draft: state.draft,
    statusValues: statusValues.filter((v) => v !== "Deleted"),
    gestureValues,
    sharedPages: shared,
    pageThumbnails,
    otherShares: state.otherShares,
    options: opts,
    production,
  };
}

/** What a new presentation's editor offers: ZIP pages, topics, products, territories, and the picklists. */
export async function loadNewOptions(org: string): Promise<NewPresentationOptions> {
  const notes: string[] = [];
  const [opts, statusValues, gestureValues, production] = await Promise.all([
    options(org, null, notes),
    picklist("Presentation", "Status", org),
    picklist("Presentation", "PlayerGestureSectionSide", org),
    isProductionOrg(org).catch(() => false),
  ]);
  return {
    statusValues: statusValues.filter((v) => v !== "Deleted"),
    gestureValues,
    options: opts,
    production,
  };
}

/** Images for pages by id (pages picked for a new presentation, which has no links to read them through). */
export async function pageThumbnails(
  org: string,
  pageIds: string[]
): Promise<Record<string, string>> {
  const ids = pageIds.filter((id) => ID_PATTERN.test(id));
  if (!ids.length) return {};
  const rows = await inChunks(
    ids,
    (l) =>
      `SELECT Id, Type, PageNumber, ContentDocumentId FROM PresentationPage WHERE Id IN (${l})`,
    org
  );
  const out: Record<string, string> = {};
  for (const type of new Set(rows.map((r) => s(r.Type)))) {
    const links = rows
      .filter((r) => s(r.Type) === type)
      .map((r) => ({
        PresentationPageId: s(r.Id),
        PresentationPage: { PageNumber: r.PageNumber, ContentDocumentId: r.ContentDocumentId },
      }));
    Object.assign(out, await addPageImages(links, type, org));
  }
  return out;
}

/** Each linked page's image, by page id (the first PAGE_IMAGES pages). */
async function pageImages(
  org: string,
  presentationId: string,
  type: string
): Promise<Record<string, string>> {
  const links = await query(
    `SELECT PresentationPageId, DisplayOrder, PresentationPage.PageNumber, PresentationPage.ContentDocumentId
     FROM PresentationLinkedPage WHERE PresentationId = '${presentationId}' ORDER BY DisplayOrder, Id`,
    org
  );
  return addPageImages(links, type, org);
}
