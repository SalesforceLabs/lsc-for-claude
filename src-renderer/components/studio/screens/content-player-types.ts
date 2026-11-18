/** Renderer copy of `ContentPlayer` (src/studio/screens/content-player.ts), with `root` swapped for the URL prefix the files are served under. */

export interface ContentPlayerSlide {
  index: number;
  pageId: string;
  pageName: string;
  pageIndex: number;
  /** The slide's id: its file name (`01_index.html`), or `pdf page N`. */
  name: string;
  kind: "html" | "pdf";
  /** Path under `base`. */
  file: string;
  thumbnail?: string;
  mandatory: boolean;
}

export interface ContentPlayerAsset {
  pageId: string;
  name: string;
  title: string;
  /** Images under `base`, top to bottom; empty when the preview can't show it. */
  files: string[];
}

export interface ContentPlayerData {
  /** lsc-frame://clm/<token>/ */
  base: string;
  presentation: {
    id: string;
    name: string;
    type: string;
    gesture: string;
    pinchZoom: boolean;
    doubleTapZoom: boolean;
  };
  pages: { id: string; name: string; sourceSystemIdentifier: string }[];
  slides: ContentPlayerSlide[];
  assets: ContentPlayerAsset[];
  notes: string[];
}
