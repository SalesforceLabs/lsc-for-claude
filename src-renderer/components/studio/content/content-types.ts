/**
 * Intelligent Content builder (Studio → Build → Intelligent Content): a presentation's settings, pages,
 * topics and territory distribution as one draft, changed through the tray with `editPresentation`.
 *
 * Structural copy of src/studio/content/types.ts — the renderer bundle cannot import from src/. Keep in sync.
 */

/** The Presentation fields the builder edits. Dates are YYYY-MM-DD. */
export interface PresentationFields {
  name: string;
  status: string;
  activationDate: string | null;
  deactivationDate: string | null;
  /** PlayerGestureSectionSide: how the rep brings up the player's bar. */
  gesture: string | null;
  pinchZoom: boolean;
  doubleTapZoom: boolean;
  canEmail: boolean;
  locked: boolean;
}

export interface Named {
  id: string;
  name: string;
}

/** A linked page, in display order. `mandatory` and `products` belong to the page, not the link. */
export interface DraftPage {
  pageId: string;
  name: string;
  mandatory: boolean;
  products: Named[];
}

/** A territory the presentation is distributed to, by its sharing group. */
export interface DraftShare {
  groupId: string;
  territoryId: string;
  name: string;
  /** The group is the territory and its children (TerritoryAndSubordinates). */
  subordinates: boolean;
}

/** Everything the builder edits about one presentation, keyed by natural keys so undo is a swap. */
export interface PresentationDraft {
  fields: PresentationFields;
  pages: DraftPage[];
  topics: Named[];
  shares: DraftShare[];
}

export interface EditPresentationFix {
  kind: "editPresentation";
  label: string;
  presentationId: string;
  presentationName: string;
  /** The presentation as the builder read it; refused if the org changed in the parts being edited. */
  from: PresentationDraft;
  to: PresentationDraft;
}

/** One row of the builder's library. */
export interface PresentationSummary {
  id: string;
  name: string;
  status: string;
  type: string;
  activationDate: string | null;
  deactivationDate: string | null;
  pages: number;
  territories: number;
  topics: string[];
  isCustom: boolean;
  lastModified: string;
  lastModifiedBy: string;
  thumbnail?: string;
}

export interface PresentationLibrary {
  presentations: PresentationSummary[];
  /** Set when the org has more presentations than the library reads. */
  note?: string;
  /** The org has no Intelligent Content objects. */
  unavailable?: string;
}

export interface PageOption {
  id: string;
  name: string;
  type: string;
  status: string;
  /** Presentations it's linked to now. */
  presentations: string[];
  /** The page's own settings, which it keeps when it's added. */
  mandatory: boolean;
  products: Named[];
}

export interface TerritoryOption {
  territoryId: string;
  name: string;
  parentId: string | null;
  /** Territory group (this territory only). */
  groupId?: string;
  /** TerritoryAndSubordinates group. */
  subordinatesGroupId?: string;
}

/** One presentation for the editor, with what can be added to it. */
export interface PresentationDetail {
  id: string;
  type: string;
  usageType: string | null;
  isCustom: boolean;
  lastModified: string;
  lastModifiedBy: string;
  draft: PresentationDraft;
  /** Picklist values the org accepts. */
  statusValues: string[];
  gestureValues: string[];
  /** Per page id: the other presentations that link it (its mandatory switch and products are shared with them). */
  sharedPages: Record<string, string[]>;
  /** Per page id: its first image, when it could be drawn. */
  pageThumbnails: Record<string, string>;
  /** Shares this builder doesn't manage (users, roles, other reasons), counted. */
  otherShares: number;
  options: {
    pages: PageOption[];
    topics: Named[];
    products: Named[];
    territories: TerritoryOption[];
    /** Set when a list was cut. */
    notes: string[];
  };
  production: boolean;
}
// --- New presentations (put together from pages, or drafted by Roz) --------------------------

/** Page ids in a new presentation's draft: an org page's Id, or `new:<draftId>` for a page Roz drafted. */
export const NEW_PAGE_PREFIX = "new:";

/** A page Roz drafted: its files are in the engine's CLM folder (`drafts/<draftId>`) and go up as a ZIP on apply. */
export interface NewPage {
  /** The draft page's id in `draft.pages` (`new:<draftId>`). */
  pageId: string;
  draftId: string;
  name: string;
}

export interface CreatePresentationFix {
  kind: "createPresentation";
  label: string;
  /** Picked when the presentation was started; keys it in the tray (`presentation-new:<key>`). */
  key: string;
  draft: PresentationDraft;
  /** Drafted pages among `draft.pages`, uploaded first. */
  newPages: NewPage[];
}

/** The undo of a create: deletes the presentation and the pages and files the create made, nothing else. */
export interface DeletePresentationFix {
  kind: "deletePresentation";
  label: string;
  presentationId: string;
  presentationName: string;
  created: { pageIds: string[]; contentDocumentIds: string[] };
  /** The org pages it used, with their required setting and products before the create. */
  before: DraftPage[];
  /** Applying this delete's undo makes the presentation again. */
  recreate: CreatePresentationFix;
}

/** What a new presentation's editor can add: the same lists as an existing one's. */
export interface NewPresentationOptions {
  statusValues: string[];
  gestureValues: string[];
  /** ZIP pages only: a PDF presentation shows one PDF, so PDF pages can't be put together. */
  options: PresentationDetail["options"];
  production: boolean;
}

// --- Roz's drafted pages -----------------------------------------------------------------------

export interface DraftFile {
  /** `01_intro.html`, `styles.css`, `img/logo.svg`: at most one folder deep. */
  path: string;
  content: string;
  /** `content` is base64 (images). */
  base64?: boolean;
}

export interface DraftCheck {
  level: "error" | "warning";
  message: string;
  file?: string;
}

/** A page Roz is drafting, kept on this computer (src-electron/engine/content-draft-types.ts has the source). */
export interface ContentDraftStep {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
}

export interface ContentDraftTurn {
  id: string;
  prompt: string;
  at: string;
  status: "running" | "done" | "failed" | "stopped";
  reply: string;
  error?: string;
  steps: ContentDraftStep[];
}

export interface ContentDraft {
  id: string;
  org: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: Array<{ path: string; content: string }>;
  checks: DraftCheck[];
  revision: number;
  turns: ContentDraftTurn[];
  /** The first slide's thumbnail as a data URL, added by the main process when it has been drawn. */
  thumbnail?: string;
}

export type ContentDraftEvent =
  | { type: "turn"; turn: ContentDraftTurn }
  | { type: "step"; turnId: string; step: ContentDraftStep }
  | { type: "reply-delta"; turnId: string; text: string }
  | { type: "writing"; turnId: string; path: string; chars: number }
  | { type: "draft"; draft: ContentDraft };
