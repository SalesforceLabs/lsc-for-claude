/**
 * Visit Engagement sections (lifesciences-ios module/Visit): what the sidebar and the related sections
 * read beyond the cache's Visit layout. Read-only and bounded; every read fails soft (`softFail`), so a
 * missing object leaves its part empty rather than the whole screen.
 *
 * The renderer keeps a structural copy in src-renderer/components/studio/visit/sections/types.ts — keep
 * the two equal by hand (test/unit/studio/visit/sections-types.test.ts compares them).
 */

import { inList, query, queryByIds, type Row } from "../../helpers.js";
import { type ScreenContext, softFail } from "../context.js";

/** ProviderVisitSettings values the sidebar reads (Utils/Constants.swift `VisitSettings`). */
export interface SectionSettings {
  /** ShowRecentSidebar: Details shows the products used lately instead of all of them. */
  showRecentSidebar: boolean;
  /** DiscussOffLabelProducts: the Off Label badge and toggle on a detailing row. */
  discussOffLabelProducts: boolean;
  /** HCOTypesForSamplesAndItems: HCO record types (labels) that can still take samples, items and DTP. */
  hcoTypesForSamplesAndItems: string[];
  /** RequireBatchNumber: a sample row needs a lot; "None" isn't offered. */
  requireBatchNumber: boolean;
  /** ShowExpiredBatches: expired lots are listed. */
  showExpiredBatches: boolean;
  /** ValidateSampleLimits: the Samples card shows a Sample Limits button. */
  validateSampleLimits: boolean;
  /** NextVisitProductObjectivesFieldsType: None / Text / Picklist / PicklistAndText. */
  nextVisitObjectives: string;
}

/** One product the rep can detail, sample or hand out (LifeSciMarketableProduct joined to Product2). */
export interface SectionProduct {
  /** The Product2 Id (what the child rows' ProductId holds). */
  id: string;
  name: string;
  /** LifeSciMarketableProduct.Type: Brand, Indication, Therapeutic Area, Sample, Item ... */
  type?: string;
  /** ProductSpecificationType: separates sample products from marketing items and plain products. */
  specification?: string;
  /** DistributionMethod: Direct to Physician products are DTP, the rest are handed out. */
  distribution?: string;
  /**
   * SignatureRequirementLevel as the org stores it (e.g. None / Optional / Required). The structure
   * stream's signature level is the highest level among the visit's product rows: look a row's
   * ProductId up here.
   */
  signatureLevel?: string;
  defaultQuantity?: number;
  parentBrandId?: string;
  parentIndicationId?: string;
  parentTherapeuticAreaId?: string;
  indication?: string;
  therapeuticArea?: string;
}

/** An active product message (ProductGuidance) a detailing row can share. */
export interface SectionMessage {
  id: string;
  /** The product it belongs to (ProductReferenceRecordId). */
  productId: string;
  text: string;
  group?: string;
}

/** A ProductItem in the rep's inventory (a product held at a location). */
export interface InventoryItem {
  id: string;
  productId: string;
  locationId?: string;
  quantity?: number;
}

/** A lot of a product item (ProductBatchItem). */
export interface InventoryBatch {
  id: string;
  productItemId: string;
  batchId?: string;
  lot?: string;
  expires?: string;
  remaining?: number;
}

/** An account the Attendees section can add; the groups are worked out in the renderer from the visit's account. */
export interface AttendeeCandidate {
  id: string;
  name: string;
  person: boolean;
  /** City + postal code, lower-cased, the "same address" key. */
  addressKey?: string;
  /** Ids of accounts this one is affiliated with. */
  affiliated: string[];
}

/** A child row of an existing visit: its Id and its values by API name. */
export interface SeedRow {
  id: string;
  values: Record<string, string>;
}

export interface VisitSections {
  settings: SectionSettings;
  /** Object API name to whether the viewer can create / edit it. Absent = not read (treated as allowed). */
  permissions: Record<string, { create: boolean; edit: boolean }>;
  products: SectionProduct[];
  messages: SectionMessage[];
  inventory: { items: InventoryItem[]; batches: InventoryBatch[] };
  attendeePool: AttendeeCandidate[];
  /** Child rows of the viewer's recent visits: visit Id to object API name to rows. */
  children: Record<string, Record<string, SeedRow[]>>;
  /**
   * The org gaters for the Files and Visitors sidebar sections (`orgHasVisitEngagementFiles`,
   * `orgHasVisitEngagementVisitors`) can't be read from here, so both are reported off.
   */
  gates: { files: boolean; visitors: boolean };
}

/** Child objects the sidebar edits; also the objects whose permissions are read. */
export const SECTION_OBJECTS = [
  "ProviderVisitProdDetailing",
  "ProviderVisitDtlProductMsg",
  "ProviderVisitProdDiscussion",
  "ProductDisbursement",
  "ProviderVisitRqstSample",
  "ProviderVisitMarketingItem",
  "AssessmentTask",
  "Visit",
] as const;

const CAP = {
  products: 300,
  messages: 400,
  inventory: 300,
  batches: 500,
  pool: 150,
  visits: 40,
  rows: 400,
};

const configKey = (row: Row | undefined, key: string): unknown =>
  row?.[Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key];
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number | undefined =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);

/** Settings as the sidebar reads them; unset booleans are false, as on the device. */
export function readSettings(row: Row | undefined): SectionSettings {
  const flag = (k: string) => configKey(row, k) === true || configKey(row, k) === "true";
  return {
    showRecentSidebar: flag("ShowRecentSidebar"),
    discussOffLabelProducts: flag("DiscussOffLabelProducts"),
    hcoTypesForSamplesAndItems: str(configKey(row, "HCOTypesForSamplesAndItems"))
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean),
    requireBatchNumber: flag("RequireBatchNumber"),
    showExpiredBatches: flag("ShowExpiredBatches"),
    validateSampleLimits: flag("ValidateSampleLimits"),
    nextVisitObjectives: str(configKey(row, "NextVisitProductObjectivesFieldsType")) || "None",
  };
}

/** Create / edit rights per object, OR-ed across the viewer's permission sets (and profile). */
export function mergePermissions(rows: Row[]): Record<string, { create: boolean; edit: boolean }> {
  const out: Record<string, { create: boolean; edit: boolean }> = {};
  for (const r of rows) {
    const o = str(r.SobjectType);
    if (!o) continue;
    const cur = out[o] ?? { create: false, edit: false };
    out[o] = {
      create: cur.create || r.PermissionsCreate === true,
      edit: cur.edit || r.PermissionsEdit === true,
    };
  }
  return out;
}

/** The "same address" key: city and postal code, lower-cased; undefined when both are empty. */
export function addressKey(city: unknown, postal: unknown): string | undefined {
  const k = [str(city), str(postal)].map((s) => s.trim().toLowerCase());
  return k[0] || k[1] ? k.join("|") : undefined;
}

function seed(r: Row, fields: string[]): SeedRow {
  const values: Record<string, string> = {};
  for (const f of fields) if (r[f] !== null && r[f] !== undefined) values[f] = str(r[f]);
  return { id: str(r.Id), values };
}

const CHILD_FIELDS: Record<string, { fields: string[]; key: string }> = {
  ProviderVisitProdDetailing: {
    fields: [
      "ProductId",
      "Priority",
      "IsOffLabel",
      "NextPrvdVisitObjectives",
      "IsGeneratedFromPresentation",
      "IndicationId",
      "TherapeuticAreaId",
    ],
    key: "ProviderVisitId",
  },
  ProductDisbursement: {
    fields: ["ProductItemId", "ProductionBatchId", "QuantityDisbursed"],
    key: "VisitId",
  },
  ProviderVisitRqstSample: { fields: ["ProductId", "RequestedQuantity"], key: "ProviderVisitId" },
  ProviderVisitMarketingItem: { fields: ["ProductId", "Quantity"], key: "ProviderVisitId" },
};

export async function collectVisitSections(ctx: ScreenContext): Promise<VisitSections | undefined> {
  const me = ctx.userId;
  const [cfg, perms, products, messages, inventory, pool, children] = await Promise.all([
    ctx
      .config(["ProviderVisitSettings"])
      .catch(softFail(ctx, "Visit settings", {} as Record<string, Row>)),
    readPermissions(ctx),
    readProducts(ctx),
    readMessages(ctx),
    readInventory(ctx),
    readAttendeePool(ctx),
    readChildren(ctx, me),
  ]);
  return {
    settings: readSettings(cfg.ProviderVisitSettings),
    permissions: perms,
    products,
    messages,
    inventory,
    attendeePool: pool,
    children,
    gates: { files: false, visitors: false },
  };
}

async function readPermissions(ctx: ScreenContext) {
  const rows = await query(
    `SELECT SobjectType, PermissionsCreate, PermissionsEdit FROM ObjectPermissions
     WHERE SobjectType IN (${inList([...SECTION_OBJECTS])})
     AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${ctx.userId}') LIMIT 200`,
    ctx.adminOrg
  ).catch(softFail(ctx, "Visit object permissions", [] as Row[]));
  return mergePermissions(rows);
}

async function readProducts(ctx: ScreenContext): Promise<SectionProduct[]> {
  const scope = ctx.scope("LifeSciMarketableProduct");
  if (scope === undefined) return [];
  const where = ["IsActive = true", scope || ""].filter(Boolean).join(" AND ");
  const rows = await query(
    `SELECT Id, ProductId, Product.Name, Type, ProductSpecificationType, DistributionMethod, SignatureRequirementLevel,
            DefaultDistributionQuantity, ParentBrandProductId, ParentIndicationId, ParentTherapeuticAreaId
     FROM LifeSciMarketableProduct WHERE ${where} LIMIT ${CAP.products}`,
    ctx.org
  ).catch(softFail(ctx, "Products", [] as Row[]));
  const names = new Map<string, string>();
  const parents = [
    ...new Set(
      rows
        .flatMap((r) => [r.ParentIndicationId, r.ParentTherapeuticAreaId])
        .map(str)
        .filter(Boolean)
    ),
  ];
  if (parents.length)
    for (const p of await queryByIds(
      "Id, ProductId, Product.Name",
      "LifeSciMarketableProduct",
      "Id",
      parents,
      ctx.org
    ).catch(softFail(ctx, "Product parents", [] as Row[])))
      names.set(str(p.Id), str((p.Product as Row | null)?.Name));
  return rows.map((r) => ({
    id: str(r.ProductId),
    name: str((r.Product as Row | null)?.Name),
    type: str(r.Type) || undefined,
    specification: str(r.ProductSpecificationType) || undefined,
    distribution: str(r.DistributionMethod) || undefined,
    signatureLevel: str(r.SignatureRequirementLevel) || undefined,
    defaultQuantity: num(r.DefaultDistributionQuantity),
    parentBrandId: str(r.ParentBrandProductId) || undefined,
    parentIndicationId: str(r.ParentIndicationId) || undefined,
    parentTherapeuticAreaId: str(r.ParentTherapeuticAreaId) || undefined,
    indication: names.get(str(r.ParentIndicationId)) || undefined,
    therapeuticArea: names.get(str(r.ParentTherapeuticAreaId)) || undefined,
  }));
}

async function readMessages(ctx: ScreenContext): Promise<SectionMessage[]> {
  const scope = ctx.scope("ProductGuidance");
  if (scope === undefined) return [];
  const where = ["IsActive = true", scope || ""].filter(Boolean).join(" AND ");
  const rows = await query(
    `SELECT Id, ProductReferenceRecordId, ContentText, GroupName FROM ProductGuidance WHERE ${where} ORDER BY Priority ASC LIMIT ${CAP.messages}`,
    ctx.org
  ).catch(softFail(ctx, "Product messages", [] as Row[]));
  return rows.map((r) => ({
    id: str(r.Id),
    productId: str(r.ProductReferenceRecordId),
    text: str(r.ContentText),
    group: str(r.GroupName) || undefined,
  }));
}

async function readInventory(ctx: ScreenContext) {
  const itemScope = ctx.scope("ProductItem");
  if (itemScope === undefined) return { items: [], batches: [] };
  const items = await query(
    `SELECT Id, Product2Id, LocationId, QuantityOnHand FROM ProductItem${itemScope ? ` WHERE ${itemScope}` : ""} LIMIT ${CAP.inventory}`,
    ctx.org
  ).catch(softFail(ctx, "Sample inventory", [] as Row[]));
  const ids = items.map((i) => str(i.Id));
  const batches = ids.length
    ? await queryByIds(
        "Id, ProductItemId, ProductionBatchId, Lot, ExpirationDate, RemainingQuantity",
        "ProductBatchItem",
        "ProductItemId",
        ids,
        ctx.org,
        "IsActive = true"
      ).catch(softFail(ctx, "Sample lots", [] as Row[]))
    : [];
  return {
    items: items.map((i) => ({
      id: str(i.Id),
      productId: str(i.Product2Id),
      locationId: str(i.LocationId) || undefined,
      quantity: num(i.QuantityOnHand),
    })),
    batches: batches.slice(0, CAP.batches).map((b) => ({
      id: str(b.Id),
      productItemId: str(b.ProductItemId),
      batchId: str(b.ProductionBatchId) || undefined,
      lot: str(b.Lot) || undefined,
      expires: str(b.ExpirationDate) || undefined,
      remaining: num(b.RemainingQuantity),
    })),
  };
}

async function readAttendeePool(ctx: ScreenContext): Promise<AttendeeCandidate[]> {
  const scope = ctx.scope("Account");
  if (scope === undefined) return [];
  const accounts = await query(
    `SELECT Id, Name, IsPersonAccount, BillingCity, BillingPostalCode FROM Account${scope ? ` WHERE ${scope}` : ""} ORDER BY Name ASC LIMIT ${CAP.pool}`,
    ctx.org
  ).catch(softFail(ctx, "Attendee accounts", [] as Row[]));
  const ids = accounts.map((a) => str(a.Id));
  const aff = new Map<string, Set<string>>();
  if (ids.length) {
    const rows = await queryByIds(
      "AccountId, RelatedAccountId",
      "ProviderAffiliation",
      "AccountId",
      ids,
      ctx.org
    ).catch(softFail(ctx, "Attendee affiliations", [] as Row[]));
    const held = new Set(ids);
    for (const r of rows) {
      const a = str(r.AccountId);
      const b = str(r.RelatedAccountId);
      if (!held.has(b)) continue;
      (aff.get(a) ?? aff.set(a, new Set()).get(a)!).add(b);
      (aff.get(b) ?? aff.set(b, new Set()).get(b)!).add(a);
    }
  }
  return accounts.map((a) => ({
    id: str(a.Id),
    name: str(a.Name),
    person: a.IsPersonAccount === true,
    addressKey: addressKey(a.BillingCity, a.BillingPostalCode),
    affiliated: [...(aff.get(str(a.Id)) ?? [])],
  }));
}

/** Child rows of the viewer's most recent visits, so an edited visit opens with its sections filled. */
async function readChildren(ctx: ScreenContext, me: string): Promise<VisitSections["children"]> {
  const visits = await query(
    `SELECT Id FROM Visit WHERE (CreatedById = '${me}' OR OwnerId = '${me}') ORDER BY LastModifiedDate DESC LIMIT ${CAP.visits}`,
    ctx.org
  ).catch(softFail(ctx, "Recent visits", [] as Row[]));
  const ids = visits.map((v) => str(v.Id));
  const out: VisitSections["children"] = {};
  if (!ids.length) return out;
  const add = (visitId: string, object: string, row: SeedRow) => {
    ((out[visitId] ??= {})[object] ??= []).push(row);
  };
  const detailVisit = new Map<string, string>();
  await Promise.all(
    Object.entries(CHILD_FIELDS).map(async ([object, { fields, key }]) => {
      const rows = await queryByIds(
        ["Id", key, ...fields].join(", "),
        object,
        key,
        ids,
        ctx.org
      ).catch(softFail(ctx, `${object} rows`, [] as Row[]));
      for (const r of rows.slice(0, CAP.rows)) {
        const v = str(r[key]);
        if (object === "ProviderVisitProdDetailing") detailVisit.set(str(r.Id), v);
        add(v, object, seed(r, fields));
      }
    })
  );
  const detailIds = [...detailVisit.keys()];
  if (detailIds.length) {
    await Promise.all(
      (
        [
          ["ProviderVisitDtlProductMsg", ["MessageRecordId", "ReactionType", "CapturedReaction"]],
          ["ProviderVisitProdDiscussion", ["RecordTypeId"]],
        ] as [string, string[]][]
      ).map(async ([object, fields]) => {
        const rows = await queryByIds(
          ["Id", "ProviderVisitProductDtlId", ...fields].join(", "),
          object,
          "ProviderVisitProductDtlId",
          detailIds,
          ctx.org
        ).catch(softFail(ctx, `${object} rows`, [] as Row[]));
        for (const r of rows.slice(0, CAP.rows))
          add(
            detailVisit.get(str(r.ProviderVisitProductDtlId)) ?? "",
            object,
            seed(r, [...fields, "ProviderVisitProductDtlId"])
          );
      })
    );
  }
  const kids = await queryByIds(
    "Id, ParentVisitId, AccountId, Account.Name",
    "Visit",
    "ParentVisitId",
    ids,
    ctx.org
  ).catch(softFail(ctx, "Attendee visits", [] as Row[]));
  for (const r of kids.slice(0, CAP.rows))
    add(str(r.ParentVisitId), "Visit", {
      id: str(r.Id),
      values: { AccountId: str(r.AccountId), AccountName: str((r.Account as Row | null)?.Name) },
    });
  delete out[""];
  return out;
}
