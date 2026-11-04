/**
 * Pure logic of the Visit Engagement sidebar (lifesciences-ios module/Visit/Visit): which sections the
 * sidebar offers and in what order (Engine/PluginCreation.swift, VisitEngine.sortRelatedPlugins), which
 * products each product section lists, and the Attendees groups. No React, no org calls.
 */

import type {
  AttendeeCandidate,
  InventoryBatch,
  InventoryItem,
  SectionProduct,
  SectionSettings,
  VisitSections,
} from "./types";

export type SectionId =
  | "clm"
  | "details"
  | "messages"
  | "discussions"
  | "samples"
  | "dtp"
  | "items"
  | "attendees"
  | "assessments"
  | "custom";

export interface SectionDef {
  id: SectionId;
  /** The child object the section edits (Visit for Attendees). */
  object: string;
  /** Child relationship names the layout uses for the related list (the object's bare name also matches). */
  names: string[];
  /** Title when the layout's related list carries no label. */
  title: string;
  /** Hard-coded title (Attendees, Compliance Activity); the others take the layout's related list label. */
  fixedTitle?: boolean;
  /** Messages and discussions: drawn under each Details row in the form, never a sidebar card. */
  nested?: boolean;
  /** Samples, Items and DTP: greyed out for an organisation account that isn't allowed them. */
  product: boolean;
}

/** The default order: CLM, Details, Messages, Discussions, Samples, DTP, Items, Attendees, Compliance Activity (Engine/PluginCreation.swift). */
export const SECTION_DEFS: SectionDef[] = [
  {
    id: "clm",
    names: ["PresentationForum"],
    object: "PresentationForum",
    title: "Content",
    product: false,
  },
  {
    id: "details",
    names: ["VisitProdDetailings"],
    object: "ProviderVisitProdDetailing",
    title: "Details",
    product: false,
  },
  {
    id: "messages",
    names: ["VisitDtlProductMsgs"],
    object: "ProviderVisitDtlProductMsg",
    title: "Messages",
    nested: true,
    product: false,
  },
  {
    id: "discussions",
    names: ["VisitProdDiscussions"],
    object: "ProviderVisitProdDiscussion",
    title: "Discussions",
    nested: true,
    product: false,
  },
  {
    id: "samples",
    names: ["ProductDisbursement"],
    object: "ProductDisbursement",
    title: "Samples",
    product: true,
  },
  {
    id: "dtp",
    names: ["VisitRqstSamples"],
    object: "ProviderVisitRqstSample",
    title: "Drop Ship Samples",
    product: true,
  },
  {
    id: "items",
    names: ["VisitMarketingItems"],
    object: "ProviderVisitMarketingItem",
    title: "Items",
    product: true,
  },
  {
    id: "attendees",
    names: ["ParentVisits"],
    object: "Visit",
    title: "Attendees",
    fixedTitle: true,
    product: false,
  },
  {
    id: "assessments",
    names: ["AssessmentTasks"],
    object: "AssessmentTask",
    title: "Compliance Activity",
    fixedTitle: true,
    product: false,
  },
];

/** VisitEngine.maxTopLevelPlugins. */
export const MAX_SECTIONS = 10;
/** logAVisitConfig.js: custom related lists on the visit, and their fields. */
export const MAX_CUSTOM_SECTIONS = 2;
export const MAX_CUSTOM_FIELDS = 5;
/** Attendees: candidates per group. */
export const ATTENDEE_GROUP_CAP = 5;

/** `childVisitAllowedObjects`: a child (attendee) visit only edits these. */
export const CHILD_VISIT_SECTIONS = new Set<SectionId>([
  "details",
  "messages",
  "samples",
  "items",
  "dtp",
]);

export interface LayoutRelated {
  name: string;
  label: string;
}

export interface Section {
  /** Stable key: the section id, or `custom:<object>`. */
  key: string;
  id: SectionId;
  object: string;
  title: string;
  /** Has a sidebar card (AssessmentTask is canShowInMenu: false: a form section only). */
  menu: boolean;
  /** Greyed out (opacity .6): an organisation account that can't take it, or nothing to pick from. */
  dimmed: boolean;
  /** Why it is dimmed, for the card's tooltip. */
  dimmedWhy?: string;
}

export interface SectionsInput {
  related: LayoutRelated[];
  permissions?: VisitSections["permissions"];
  childVisit?: boolean;
  /** The account is an organisation (HCO) and its record type isn't in HCOTypesForSamplesAndItems. */
  hcoOff?: boolean;
  /** Whether the viewer has anything to pick for each product section. */
  hasOptions?: Partial<Record<SectionId, boolean>>;
}

/** `Object.Field` or `Object` from a layout related list to the object. */
export function relatedObject(name: string): string {
  return name.split(".")[0];
}

/** Create and edit rights; an object whose rights weren't read counts as allowed. */
export function canEditObject(
  permissions: VisitSections["permissions"] | undefined,
  object: string
): boolean {
  const p = permissions?.[object];
  return !p || (p.create && p.edit);
}

/** A related list's own label; one the layout left untranslated (equal to its name) counts as none. */
function layoutLabel(r: LayoutRelated): string {
  return r.label && r.label !== r.name ? r.label : "";
}

function findRelated(def: SectionDef, related: LayoutRelated[]): number {
  // The Visit layout names related lists by child relationship (VisitProdDetailings, ParentVisits) or bare
  // object (ProductDisbursement); `Object.Field` is the other form a layout can use.
  const byName = related.findIndex((r) => def.names.includes(relatedObject(r.name)));
  if (byName >= 0) return byName;
  const byObject = related.findIndex((r) => relatedObject(r.name) === def.object);
  if (byObject >= 0) return byObject;
  // Last resort: the layout's label.
  const labels: Record<string, string[]> = {
    attendees: ["Attendees"],
    clm: ["Content", "Presentation Forums"],
  };
  const ls = labels[def.id];
  return ls ? related.findIndex((r) => ls.includes(r.label)) : -1;
}

/**
 * The sidebar's sections, in order. A section is in when its related list is on the Visit layout and
 * the viewer can create and edit its object; the order follows the layout's related lists, with
 * sections the layout doesn't order by name after them in the default order; custom (`__c`) lists
 * belong to the parent visit; at most MAX_SECTIONS.
 */
export function buildSections(input: SectionsInput): Section[] {
  const { related, permissions, childVisit } = input;
  const found: { section: Section; at: number; rank: number }[] = [];
  SECTION_DEFS.forEach((def, rank) => {
    if (def.id === "clm" && childVisit) return;
    if (childVisit && !CHILD_VISIT_SECTIONS.has(def.id)) return;
    if (def.nested) return;
    const at = findRelated(def, related);
    if (at < 0) return;
    if (def.id !== "clm" && !canEditObject(permissions, def.object)) return;
    const hcoOff = def.product && input.hcoOff;
    const empty = def.product && input.hasOptions?.[def.id] === false;
    found.push({
      at,
      rank,
      section: {
        key: def.id,
        id: def.id,
        object: def.object,
        // RealMetadataProvider: the layout's relatedListLabel for the object, "" when it has none (never the object's label).
        title: def.fixedTitle ? def.title : layoutLabel(related[at]),
        menu: def.id !== "assessments",
        dimmed: !!(hcoOff || empty),
        dimmedWhy: hcoOff
          ? "This account type can't take samples or items."
          : empty
            ? "Nothing available to add."
            : undefined,
      },
    });
  });
  if (!childVisit) {
    related
      .filter((r) => /__c$/.test(relatedObject(r.name)))
      .filter((r) => canEditObject(permissions, relatedObject(r.name)))
      .slice(0, MAX_CUSTOM_SECTIONS)
      .forEach((r, i) => {
        const object = relatedObject(r.name);
        found.push({
          at: related.indexOf(r),
          rank: SECTION_DEFS.length + i,
          section: {
            key: `custom:${object}`,
            id: "custom",
            object,
            title: layoutLabel(r) || object,
            menu: true,
            dimmed: false,
          },
        });
      });
  }
  found.sort((a, b) => a.at - b.at || a.rank - b.rank);
  return found.slice(0, MAX_SECTIONS).map((f) => f.section);
}

/** HCOTypesForSamplesAndItems: an organisation account takes samples, items and DTP only for the record types listed. */
export function hcoOff(
  organisation: boolean | undefined,
  recordTypeLabel: string | undefined,
  settings: Pick<SectionSettings, "hcoTypesForSamplesAndItems"> | undefined
): boolean {
  if (!organisation) return false;
  const allowed = settings?.hcoTypesForSamplesAndItems ?? [];
  return (
    !recordTypeLabel || !allowed.some((a) => a.toLowerCase() === recordTypeLabel.toLowerCase())
  );
}

// ── products ──

export type ProductKind = "sample" | "dtp" | "item" | "detail";

/** What a marketable product is for: DTP by distribution method, samples and items by specification. Best effort: the org's picklists vary. */
export function productKind(p: SectionProduct): ProductKind {
  if (/direct|dtp/i.test(p.distribution ?? "")) return "dtp";
  if (/item|promo|leave/i.test(p.specification ?? "")) return "item";
  if (/sample/i.test(p.specification ?? "")) return "sample";
  return "detail";
}

export function productsFor(kind: ProductKind, products: SectionProduct[]): SectionProduct[] {
  const own = products.filter((p) => productKind(p) === kind);
  // An org that tags nothing still lets the rep pick: the device lists every available product.
  return own.length || kind !== "detail" ? own : products;
}

// The org spells them NotRequired / Optional / Mandatory (LifeSciMarketableProduct.SignatureRequirementLevel).
const SIGNATURE_RANK: Record<string, number> = {
  none: 0,
  notrequired: 0,
  optional: 1,
  required: 2,
  mandatory: 2,
};

/**
 * The strictest SignatureRequirementLevel among the products on a visit's rows (the sidebar's rows
 * carry ProductId). Returns the org's own spelling; undefined when no row has a product with a level.
 */
export function strictestSignatureLevel(
  rows: Record<string, { values: Record<string, string> }[]>,
  products: SectionProduct[]
): string | undefined {
  const byId = new Map(products.map((p) => [p.id, p.signatureLevel]));
  let best: string | undefined;
  let rank = -1;
  for (const list of Object.values(rows))
    for (const r of list) {
      const level = byId.get(r.values.ProductId ?? "");
      if (!level) continue;
      const k = SIGNATURE_RANK[level.toLowerCase()] ?? 0;
      if (k > rank) {
        rank = k;
        best = level;
      }
    }
  return best;
}

// ── Details ──

/** The "Indication • TherapeuticArea" subtitle of a detailing row. */
export function detailSubtitle(
  p: Pick<SectionProduct, "indication" | "therapeuticArea"> | undefined
): string {
  return [p?.indication, p?.therapeuticArea].filter(Boolean).join(" • ");
}

export interface DetailBadge {
  text: string;
  tone: "info" | "warn";
}

/** #n for its place, Off Label (when the org allows discussing them), From Intelligent Content. */
export function detailBadges(
  values: Record<string, string>,
  index: number,
  settings: Pick<SectionSettings, "discussOffLabelProducts">
): DetailBadge[] {
  const out: DetailBadge[] = [{ text: `#${index + 1}`, tone: "info" }];
  if (settings.discussOffLabelProducts && values.IsOffLabel === "true")
    out.push({ text: "Off Label", tone: "warn" });
  if (values.IsGeneratedFromPresentation === "true")
    out.push({ text: "From Intelligent Content", tone: "info" });
  return out;
}

/** ShowRecentSidebar: the picker lists the products used lately (those already on visits) first and only those. */
export function detailOptions(
  products: SectionProduct[],
  settings: Pick<SectionSettings, "showRecentSidebar">,
  recentIds: string[]
): SectionProduct[] {
  if (!settings.showRecentSidebar) return products;
  const recent = new Set(recentIds);
  const used = products.filter((p) => recent.has(p.id));
  return used.length ? used : products;
}

// ── Samples ──

export interface LotOption {
  /** ProductBatchItem Id, or "" for the None lot. */
  id: string;
  batchId?: string;
  label: string;
  remaining?: number;
}

/** A sample row's lot choices: RequireBatchNumber drops None, ShowExpiredBatches lists expired lots. */
export function lotOptions(
  itemId: string,
  batches: InventoryBatch[],
  settings: Pick<SectionSettings, "requireBatchNumber" | "showExpiredBatches">,
  today: string
): LotOption[] {
  const lots = batches
    .filter((b) => b.productItemId === itemId)
    .filter((b) => settings.showExpiredBatches || !b.expires || b.expires.slice(0, 10) >= today)
    .map((b) => ({
      id: b.id,
      batchId: b.batchId,
      label: b.lot || b.batchId || b.id,
      remaining: b.remaining,
    }));
  return settings.requireBatchNumber ? lots : [{ id: "", label: "None" }, ...lots];
}

/** The quantity a new sample or item row starts with: the product's DefaultDistributionQuantity, else 1. */
export function defaultQuantity(product: SectionProduct | undefined): string {
  return String(
    product?.defaultQuantity && product.defaultQuantity > 0 ? product.defaultQuantity : 1
  );
}

export function inventoryProduct(
  item: InventoryItem | undefined,
  products: SectionProduct[]
): SectionProduct | undefined {
  return item ? products.find((p) => p.id === item.productId) : undefined;
}

// ── Attendees ──

export interface AttendeeGroup {
  key: "address" | "affiliation" | "other";
  title: string;
  accounts: AttendeeCandidate[];
}

/**
 * Who can be added next to the visit's account: same address, affiliated, then the rest, five each,
 * skipping the account itself and anyone already an attendee (AttendeesPlugin).
 */
export function attendeeGroups(
  pool: AttendeeCandidate[],
  accountId: string | undefined,
  attendeeAccountIds: string[]
): AttendeeGroup[] {
  const self = pool.find((a) => a.id === accountId);
  const taken = new Set([accountId, ...attendeeAccountIds]);
  const left = pool.filter((a) => !taken.has(a.id));
  const same = left.filter((a) => self?.addressKey && a.addressKey === self.addressKey);
  const sameIds = new Set(same.map((a) => a.id));
  const aff = left.filter((a) => !sameIds.has(a.id) && self?.affiliated.includes(a.id));
  const affIds = new Set(aff.map((a) => a.id));
  const other = left.filter((a) => !sameIds.has(a.id) && !affIds.has(a.id));
  return (
    [
      { key: "address", title: "Same Address", accounts: same.slice(0, ATTENDEE_GROUP_CAP) },
      { key: "affiliation", title: "Affiliated", accounts: aff.slice(0, ATTENDEE_GROUP_CAP) },
      { key: "other", title: "Other", accounts: other.slice(0, ATTENDEE_GROUP_CAP) },
    ] as AttendeeGroup[]
  ).filter((g) => g.accounts.length);
}

export const REMOVE_ATTENDEE_TITLE = "Remove attendee?";
export const removeAttendeeMessage = (name: string) =>
  `Do you want to remove ${name} from this Visit?`;
