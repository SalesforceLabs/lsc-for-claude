/** Structural copy of the types in src/studio/screens/visit/sections.ts — keep the two equal by hand (a test compares them). */

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
