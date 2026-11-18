/**
 * Preview and apply for `editPresentation` (Studio → Build → Intelligent Content). The preview re-reads the
 * presentation and refuses when the org changed in a part the change touches; applying re-runs the preview,
 * writes only those parts with the composite sObjects API, and returns the swap as its undo.
 */

import { apiRequest, dataPath, describeSObject } from "../../salesforce/cli.js";
import { step, type FixTracker } from "../fix-progress.js";
import { ID_PATTERN, inList, query } from "../helpers.js";
import { isProductionOrg } from "../metadata/live.js";
import type { FixPreview, FixResult } from "../types.js";
import {
  changedParts,
  checkCurrent,
  describeChanges,
  draftProblem,
  draftWarnings,
  PART_LABEL,
  planIsEmpty,
  planWrites,
  type WritePlan,
} from "./logic.js";
import { readState, sharedPages, type PresentationState } from "./read.js";
import type { EditPresentationFix, PresentationDraft } from "./types.js";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const today = () => new Date().toISOString().slice(0, 10);

/** Gestures and statuses the org takes, read with the preview (an empty list skips the check). */
export async function picklistValues(
  org: string
): Promise<{ status: string[]; gesture: string[] }> {
  try {
    const d = await describeSObject("Presentation", org);
    const values = (name: string) =>
      (
        (d.success ? d.data?.fields.find((f) => f.name === name) : undefined) as
          | { picklistValues?: { value: string; active: boolean }[] }
          | undefined
      )?.picklistValues
        ?.filter((p) => p.active)
        .map((p) => p.value) ?? [];
    return { status: values("Status"), gesture: values("PlayerGestureSectionSide") };
  } catch {
    return { status: [], gesture: [] };
  }
}

interface EditPlan {
  preview: FixPreview;
  state?: PresentationState;
  plan?: WritePlan;
}

async function plan(
  fix: EditPresentationFix,
  org: string,
  progress?: FixTracker,
  apply = false
): Promise<EditPlan> {
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: describeChanges(fix.presentationName, fix.from, fix.to),
    warnings: [],
  };
  const blocked = (message: string): EditPlan => ({ preview: { ...preview, blocked: message } });
  if (!ID_PATTERN.test(fix.presentationId)) return blocked("Not a presentation Id.");

  const parts = changedParts(fix.from, fix.to);
  if (!parts.length) return blocked("Nothing to change.");

  const added = fix.to.pages
    .filter((p) => !fix.from.pages.some((q) => q.pageId === p.pageId))
    .map((p) => p.pageId);
  const [state, values] = await step(progress, "read", () =>
    Promise.all([readState(org, fix.presentationId, added), picklistValues(org)])
  );
  if (!state) return blocked(`${fix.presentationName} no longer exists.`);

  const problem = draftProblem(fix.to, values.status, values.gesture);
  if (problem) return blocked(problem);
  const missing = added.filter((id) => !state.rows.pageState.has(id));
  if (missing.length)
    return blocked("A page being added no longer exists. Refresh the presentation.");

  const check = checkCurrent(state.draft, fix.from, fix.to);
  if (check.state === "applied")
    return blocked(apply ? "Already applied." : "Already applied. Refresh the presentation.");
  if (check.state === "changed") {
    return blocked(
      `${fix.presentationName} changed in the org since it was opened (${check.parts.map(PART_LABEL).join(", ")}). Refresh it and make the change again.`
    );
  }

  const shared = await sharedPages(
    org,
    fix.presentationId,
    fix.to.pages.map((p) => p.pageId)
  ).catch(() => ({}));
  preview.warnings = draftWarnings(fix.from, fix.to, shared, today());
  preview.production = await isProductionOrg(org).catch(() => false);
  const writes = planWrites(state.draft, state.rows, fix.to, parts);
  if (planIsEmpty(writes)) return blocked("Already applied.");
  return { preview, state, plan: writes };
}

export async function previewEditPresentation(
  fix: EditPresentationFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  return (await plan(fix, org, progress)).preview;
}

// --- Composite writes ----------------------------------------------------------------------

interface SaveResult {
  id?: string;
  success: boolean;
  errors?: { message?: string; statusCode?: string }[];
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function failure(results: SaveResult[] | undefined, fallback: string): string | null {
  if (!Array.isArray(results)) return fallback;
  const bad = results.find((r) => !r.success);
  if (!bad) return null;
  return (
    bad.errors
      ?.map((e) => e.message || e.statusCode)
      .filter(Boolean)
      .join("; ") || fallback
  );
}

export async function composite(
  method: "POST" | "PATCH",
  type: string,
  records: Record<string, unknown>[],
  org: string
): Promise<string[]> {
  const ids: string[] = [];
  for (const part of chunks(records, 200)) {
    const res = await apiRequest<SaveResult[]>(
      await dataPath(org, "/composite/sobjects"),
      method,
      { allOrNone: true, records: part.map((r) => ({ attributes: { type }, ...r })) },
      org
    );
    if (!res.success) throw new Error(res.error || `Couldn't write ${type}.`);
    const err = failure(res.data, `Couldn't write ${type}.`);
    if (err) throw new Error(`${type}: ${err}`);
    ids.push(...(res.data ?? []).map((r) => s(r.id)));
  }
  return ids;
}

export async function remove(ids: string[], org: string): Promise<void> {
  for (const part of chunks(
    ids.filter((id) => ID_PATTERN.test(id)),
    200
  )) {
    const res = await apiRequest<SaveResult[]>(
      await dataPath(org, `/composite/sobjects?ids=${part.join(",")}&allOrNone=true`),
      "DELETE",
      undefined,
      org
    );
    if (!res.success) throw new Error(res.error || "Couldn't delete records.");
    const err = failure(res.data, "Couldn't delete records.");
    // A row someone else already deleted is fine.
    if (err && !/ENTITY_IS_DELETED|INVALID_CROSS_REFERENCE_KEY/.test(err)) throw new Error(err);
  }
}

/** Page shares a new territory, or a newly linked page, needs: one per page and group, where none exists. */
async function addPageShares(pageIds: string[], groupIds: string[], org: string): Promise<void> {
  const pages = pageIds.filter((id) => ID_PATTERN.test(id));
  const groups = groupIds.filter((id) => ID_PATTERN.test(id));
  if (!pages.length || !groups.length) return;
  const existing = new Set<string>();
  for (const part of chunks(pages, 200)) {
    const rows = await query(
      `SELECT ParentId, UserOrGroupId FROM PresentationPageShare WHERE ParentId IN (${inList(part)}) AND UserOrGroupId IN (${inList(groups)})`,
      org
    );
    for (const r of rows) existing.add(`${s(r.ParentId)}:${s(r.UserOrGroupId)}`);
  }
  const records = pages.flatMap((p) =>
    groups
      .filter((g) => !existing.has(`${p}:${g}`))
      .map((g) => ({
        ParentId: p,
        UserOrGroupId: g,
        AccessLevel: "Edit",
        RowCause: "LSC4CEAutoShare",
      }))
  );
  if (records.length) await composite("POST", "PresentationPageShare", records, org);
}

/**
 * Page shares to take back when `groupIds` lose `pageIds` (a removed territory, or pages taken out): only where
 * the page isn't linked to another presentation the group still sees, and only the shares Studio would have made.
 */
export async function removePageShares(
  presentationId: string,
  pageIds: string[],
  groupIds: string[],
  org: string
): Promise<void> {
  const pages = pageIds.filter((id) => ID_PATTERN.test(id));
  const groups = groupIds.filter((id) => ID_PATTERN.test(id));
  if (!pages.length || !groups.length) return;
  const links = await query(
    `SELECT PresentationId, PresentationPageId FROM PresentationLinkedPage
     WHERE PresentationPageId IN (${inList(pages)}) AND PresentationId != '${presentationId}'`,
    org
  );
  const others = [...new Set(links.map((l) => s(l.PresentationId)))];
  const stillSees = new Set<string>();
  if (others.length) {
    const shares = await query(
      `SELECT ParentId, UserOrGroupId FROM PresentationShare WHERE ParentId IN (${inList(others)}) AND UserOrGroupId IN (${inList(groups)})`,
      org
    );
    const groupsOf = new Map<string, string[]>();
    for (const r of shares)
      groupsOf.set(s(r.ParentId), [...(groupsOf.get(s(r.ParentId)) ?? []), s(r.UserOrGroupId)]);
    for (const l of links)
      for (const g of groupsOf.get(s(l.PresentationId)) ?? [])
        stillSees.add(`${s(l.PresentationPageId)}:${g}`);
  }
  const rows = await query(
    `SELECT Id, ParentId, UserOrGroupId FROM PresentationPageShare WHERE ParentId IN (${inList(pages)})
     AND UserOrGroupId IN (${inList(groups)}) AND RowCause IN ('Manual', 'LSC4CEAutoShare')`,
    org
  );
  await remove(
    rows
      .filter((r) => !stillSees.has(`${s(r.ParentId)}:${s(r.UserOrGroupId)}`))
      .map((r) => s(r.Id)),
    org
  );
}

export async function write(
  id: string,
  state: PresentationState,
  to: PresentationDraft,
  p: WritePlan,
  org: string,
  progress?: FixTracker
): Promise<void> {
  const groupsAfter = to.shares.map((x) => x.groupId);
  const groupsBefore = state.draft.shares.map((x) => x.groupId);

  // Topics first: an org without topics on presentations refuses them, and nothing else is written yet.
  if (p.createTopics.length || p.deleteTopics.length) {
    await step(progress, "topics", async () => {
      await remove(p.deleteTopics, org);
      if (p.createTopics.length) {
        await composite(
          "POST",
          "TopicAssignment",
          p.createTopics.map((t) => ({ TopicId: t, EntityId: id })),
          org
        ).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(
            /permissions to assign topics/i.test(message)
              ? "Topics aren't switched on for presentations in this org. In Setup, open Topics for Objects and turn them on for Presentation."
              : message
          );
        });
      }
    });
  }

  if (p.presentation) {
    await step(progress, "presentation", async () => {
      const res = await apiRequest(
        await dataPath(org, `/sobjects/Presentation/${id}`),
        "PATCH",
        p.presentation,
        org
      );
      if (!res.success) throw new Error(res.error || "Couldn't update the presentation.");
    });
  }

  if (p.deleteLinks.length || p.createLinks.length || p.reorderLinks.length) {
    await step(progress, "pages", async () => {
      const top = Math.max(
        0,
        ...[...state.rows.links.values()].map((l) => l.order),
        to.pages.length
      );
      // Pages that stay but move go out of the way before new ones take their places.
      await remove(p.deleteLinks, org);
      if (p.reorderLinks.length) {
        await composite(
          "PATCH",
          "PresentationLinkedPage",
          p.reorderLinks.map((l, i) => ({ Id: l.Id, DisplayOrder: top + 1 + i })),
          org
        );
      }
      if (p.createLinks.length) {
        await composite(
          "POST",
          "PresentationLinkedPage",
          p.createLinks.map((l) => ({ PresentationId: id, ...l })),
          org
        );
      }
      if (p.reorderLinks.length) {
        await composite(
          "PATCH",
          "PresentationLinkedPage",
          p.reorderLinks.map((l) => ({ Id: l.Id, DisplayOrder: l.DisplayOrder })),
          org
        );
      }
      const removedPages = state.draft.pages
        .filter((x) => !to.pages.some((y) => y.pageId === x.pageId))
        .map((x) => x.pageId);
      // Reps who see the presentation now see its new pages; pages taken out go from them unless another presentation shows them.
      await addPageShares(
        p.createLinks.map((l) => l.PresentationPageId),
        groupsAfter,
        org
      );
      await removePageShares(id, removedPages, groupsBefore, org);
    });
  }

  if (p.mandatory.length || p.createProducts.length || p.deleteProducts.length) {
    await step(progress, "page-settings", async () => {
      if (p.mandatory.length) await composite("PATCH", "PresentationPage", p.mandatory, org);
      await remove(p.deleteProducts, org);
      if (p.createProducts.length)
        await composite("POST", "PresentationPageProduct", p.createProducts, org);
    });
  }

  if (p.addShares.length || p.removeShares.length) {
    await step(progress, "shares", async () => {
      const shareIds = p.removeShares.flatMap((g) => state.rows.shares.get(g) ?? []);
      await remove(shareIds, org);
      await removePageShares(
        id,
        to.pages.map((x) => x.pageId),
        p.removeShares,
        org
      );
      if (p.addShares.length) {
        await composite(
          "POST",
          "PresentationShare",
          p.addShares.map((x) => ({
            ParentId: id,
            UserOrGroupId: x.groupId,
            AccessLevel: "Edit",
            RowCause: "LSC4CEAutoShare",
          })),
          org
        );
        await addPageShares(
          to.pages.map((x) => x.pageId),
          p.addShares.map((x) => x.groupId),
          org
        );
      }
    });
  }
}

export async function applyEditPresentation(
  fix: EditPresentationFix,
  org: string,
  progress?: FixTracker
): Promise<FixResult> {
  const { preview, state, plan: writes } = await plan(fix, org, progress, true);
  if (preview.blocked || !state || !writes)
    return { ok: false, message: preview.blocked ?? "Nothing to change." };
  try {
    await write(fix.presentationId, state, fix.to, writes, org, progress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `${message} ${await rollBack(fix, org)}` };
  }
  return {
    ok: true,
    message: `Updated ${fix.to.fields.name || fix.presentationName}.`,
    undo: {
      ...fix,
      label: `Undo: ${fix.label}`,
      presentationName: fix.to.fields.name || fix.presentationName,
      from: fix.to,
      to: fix.from,
    },
  };
}

/** After a failed write: puts back what was written, in the parts the change touched. Says how it went. */
async function rollBack(fix: EditPresentationFix, org: string): Promise<string> {
  try {
    const state = await readState(
      org,
      fix.presentationId,
      fix.from.pages.map((p) => p.pageId)
    );
    if (!state) return "The presentation is gone, so nothing could be put back.";
    const parts = changedParts(fix.from, fix.to);
    const back = planWrites(state.draft, state.rows, fix.from, parts);
    if (planIsEmpty(back)) return "Nothing was changed.";
    await write(fix.presentationId, state, fix.from, back, org);
    return "What had been written was put back.";
  } catch {
    return "Part of the change may have been made and couldn't be put back; refresh the presentation to see where it stands.";
  }
}
