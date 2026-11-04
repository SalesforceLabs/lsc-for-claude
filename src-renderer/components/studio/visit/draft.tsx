import React, { createContext, useContext, useMemo, useState } from "react";
import type { PublishedIpad, PublishedLayout } from "../published-types";
import type { SheetContext } from "../ipad-sheet-ui";

/**
 * The visit being edited in the preview, shared by the shell (structure/), the sidebar and related
 * sections (sections/) and the Save / Sign / Submit checks (checks/). Held in memory only: nothing is
 * ever written to the org.
 *
 * Ownership: each stream adds fields only inside its own block below, so edits don't collide.
 */

export interface VisitRow {
  /** The record's Id, or a local id for a row added in the preview. */
  id: string;
  values: Record<string, string>;
}

export interface VisitDraft {
  // ── structure ──
  /** Header field values by API name (Visit and ProviderVisit fields). */
  values: Record<string, string>;
  recordTypeName?: string;
  /** Compliance statement ticks, by ComplianceStatementDef Id. */
  compliance: Record<string, boolean>;
  signature?: { type: "digital" | "physical"; documentId?: string };
  status?: string;
  /** The attendee (child visit) open in the carousel, if any. */
  attendeeId?: string;

  // ── sections ──
  /** Rows of each sidebar section, by object API name (e.g. ProviderVisitProdDetailing). */
  rows: Record<string, VisitRow[]>;
  /** The sidebar card that is open (Section.key from sections/logic.ts); one at a time. */
  openSection?: string;
  /** Set once the rows of an edited visit were seeded from the org, so reopening a card doesn't refill them. */
  rowsSeeded?: boolean;

  // ── checks ──
  /** Field-level errors from the last Save / Sign / Submit, by field API name. */
  fieldErrors: Record<string, string>;
  delayReason?: string;
  /** The last Save / Sign / Submit's messages (VisitEngine.ValidationMessage): "global" ones are drawn as a banner at the top of the form, "compliance" above the compliance statements. */
  checkMessages: { text: string; severity: "error" | "warning"; where: "global" | "compliance" }[];
}

export interface VisitEditorContext {
  sheet: SheetContext;
  snapshot: PublishedIpad;
  /** Id of the visit being edited; undefined for a new one. */
  editId?: string;
  layouts: PublishedLayout[];
  draft: VisitDraft;
  update: (patch: Partial<VisitDraft> | ((d: VisitDraft) => Partial<VisitDraft>)) => void;
  /** Open an attendee (child visit) of this visit in the shell, or the parent again with undefined. Sets `draft.attendeeId`. */
  openAttendee?: (id: string | undefined) => void;
}

const Ctx = createContext<VisitEditorContext | undefined>(undefined);

export function emptyDraft(): VisitDraft {
  return { values: {}, compliance: {}, rows: {}, fieldErrors: {}, checkMessages: [] };
}

export function VisitDraftProvider({
  sheet,
  editId,
  layouts,
  initial,
  children,
}: {
  sheet: SheetContext;
  editId?: string;
  layouts: PublishedLayout[];
  initial: () => VisitDraft;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<VisitDraft>(initial);
  const value = useMemo<VisitEditorContext>(
    () => ({
      sheet,
      snapshot: sheet.snapshot,
      editId,
      layouts,
      draft,
      update: (patch) =>
        setDraft((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) })),
      openAttendee: (id) => setDraft((d) => ({ ...d, attendeeId: id })),
    }),
    [sheet, editId, layouts, draft]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVisit(): VisitEditorContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVisit outside VisitDraftProvider");
  return v;
}
