// Structural copy of PublishedContent in src/studio/screens/content.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedContentCard {
  id: string;
  name: string;
  type: string;
  /** Linked active pages (CLMPresentationItemViewModel.slideNames.count; for ZIP the app counts .html files, which we don't open). */
  pages: number;
  /** Medium date in the viewer's locale and zone (actualLastModifiedDate). */
  date: string;
  isCustom: boolean;
  ownedByViewer: boolean;
  /** cansendbyemail: the card gets a share button. */
  shareable: boolean;
  /** Downscaled first-page image as a data URL; undefined = the #E5E5E5 placeholder. */
  thumbnail?: string;
  /** Images of later pages (index 0 = page 2), rendered read-only from the page files; a missing entry shows a stand-in. */
  pageThumbnails?: (string | null)[];
}

export interface PublishedContentSection {
  /** "" renders as "No Category". */
  title: string;
  cardIds: string[];
}

export interface PublishedContent {
  /** CLMGridViewController: 4 columns with orgHasContentLibEnhancements (assumed on; its endpoint isn't readable), else 3. */
  columns: number;
  /** Segments: "Presentations" | "My Presentations" (ManageCustomPresentation) | "Favorites". */
  segments: string[];
  /** "+ New": ManageCustomPresentation and Presentation creatable. */
  canCreate: boolean;
  cards: PublishedContentCard[];
  /** Whether sections come from topics (the Topic table is synced); false = one untitled section. */
  hasTags: boolean;
  sections: PublishedContentSection[];
}
