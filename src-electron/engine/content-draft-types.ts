/**
 * Pages Roz drafts for Intelligent Content (Studio → Build → Intelligent Content). A draft is kept on this
 * computer, never in the org, until it's put in a new presentation through the tray. A copy of these types
 * is in src-renderer/components/studio/content/content-types.ts.
 */

export interface ContentDraftFile {
  path: string;
  content: string;
}

export interface ContentDraftCheck {
  level: "error" | "warning";
  message: string;
  file?: string;
}

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
  /** The org's connection username, lowercased. */
  org: string;
  /** The page's name, as it will be in the org. */
  name: string;
  createdAt: string;
  updatedAt: string;
  files: ContentDraftFile[];
  checks: ContentDraftCheck[];
  /** Bumps on every write, so the preview knows to load again. */
  revision: number;
  turns: ContentDraftTurn[];
  /** The first slide's thumbnail as a data URL; never stored, added on the way to the renderer. */
  thumbnail?: string;
}

export type ContentDraftEvent =
  | { type: "turn"; turn: ContentDraftTurn }
  | { type: "step"; turnId: string; step: ContentDraftStep }
  | { type: "reply-delta"; turnId: string; text: string }
  | { type: "writing"; turnId: string; path: string; chars: number }
  | { type: "draft"; draft: ContentDraft };
