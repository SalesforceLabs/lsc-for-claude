/**
 * Preview and apply for `createPresentation` and its undo, `deletePresentation` (Studio → Build → Intelligent
 * Content → New presentation). A new presentation is put together from the org's ZIP pages and pages Roz
 * drafted. Drafted pages go up first (the draft folder zipped, a ContentVersion, a PresentationPage linked to
 * its file), then the Presentation (Type ZIP, Intelligent Content), then the same writes an edit makes. A
 * presentation with drafted pages is only ever made inactive and undistributed: someone has to review the
 * content before it's switched on. A failed create deletes what it made; the undo deletes the presentation and
 * the pages and files it made, and puts back the required setting and products of the org pages it used.
 */

import { rmSync } from "node:fs";
import { uploadContentVersion } from "../../salesforce/cli.js";
import { step, type FixTracker } from "../fix-progress.js";
import { ID_PATTERN, inList, query } from "../helpers.js";
import { isProductionOrg } from "../metadata/live.js";
import type { FixPreview, FixResult } from "../types.js";
import { checkDraft, draftExists, zipDraft } from "./drafts.js";
import { composite, picklistValues, remove, write } from "./fixes.js";
import {
  describeChanges,
  draftProblem,
  draftWarnings,
  planIsEmpty,
  planWrites,
  type Part,
} from "./logic.js";
import { readState, sharedPages } from "./read.js";
import {
  NEW_PAGE_PREFIX,
  type CreatePresentationFix,
  type DeletePresentationFix,
  type DraftPage,
  type PresentationDraft,
} from "./types.js";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const today = () => new Date().toISOString().slice(0, 10);

/** What reviewers have to do before a presentation with drafted pages is switched on. */
export const REVIEW_WARNING =
  "Roz drafted some of these pages. They're saved inactive and not distributed: have them through medical, legal and regulatory review before anyone switches the presentation on or sends it to territories.";

const isNew = (pageId: string) => pageId.startsWith(NEW_PAGE_PREFIX);
const ALL_PARTS: Part[] = [
  "field:name",
  "field:status",
  "field:activationDate",
  "field:deactivationDate",
  "field:gesture",
  "field:pinchZoom",
  "field:doubleTapZoom",
  "field:canEmail",
  "field:locked",
  "pages",
  "mandatory",
  "products",
  "topics",
  "shares",
];

/** A presentation before it exists: every field empty, so the review lists what it's made with. */
const NOTHING: PresentationDraft = {
  fields: {
    name: "",
    status: "",
    activationDate: null,
    deactivationDate: null,
    gesture: null,
    pinchZoom: false,
    doubleTapZoom: false,
    canEmail: false,
    locked: false,
  },
  pages: [],
  topics: [],
  shares: [],
};

const blank = (d: PresentationDraft): PresentationDraft => ({
  fields: d.fields,
  pages: [],
  topics: [],
  shares: [],
});

interface CreatePlan {
  preview: FixPreview;
  existing: string[];
}

async function planCreate(
  fix: CreatePresentationFix,
  org: string,
  progress?: FixTracker
): Promise<CreatePlan> {
  const to = fix.draft;
  const existing = to.pages.map((p) => p.pageId).filter((id) => !isNew(id));
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: describeChanges(to.fields.name.trim() || "New presentation", NOTHING, to, true),
    warnings: [],
  };
  const blocked = (message: string): CreatePlan => ({
    preview: { ...preview, blocked: message },
    existing,
  });

  if (!to.pages.length) return blocked("Add at least one page.");
  if (existing.some((id) => !ID_PATTERN.test(id))) return blocked("A page isn't a page Id.");
  for (const p of to.pages.filter((p) => isNew(p.pageId))) {
    if (!fix.newPages.some((n) => n.pageId === p.pageId))
      return blocked(`${p.name} isn't a page in the org or one Roz drafted.`);
  }
  if (fix.newPages.length) {
    if (to.fields.status !== "Inactive")
      return blocked(
        "A presentation with pages Roz drafted is saved inactive. Switch it on after the pages have been reviewed."
      );
    if (to.shares.length)
      return blocked(
        "A presentation with pages Roz drafted isn't distributed until its pages have been reviewed. Take the territories off."
      );
  }

  const [values, pages, named] = await step(progress, "read", () =>
    Promise.all([
      picklistValues(org),
      existing.length
        ? query(
            `SELECT Id, Name, Type, Status, IsAdditionalContent FROM PresentationPage WHERE Id IN (${inList(existing)})`,
            org
          )
        : Promise.resolve([]),
      query(
        `SELECT Id FROM Presentation WHERE Name = '${to.fields.name.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' AND Status != 'Deleted' LIMIT 1`,
        org
      ).catch(() => []),
    ])
  );
  const problem = draftProblem(to, values.status, values.gesture);
  if (problem) return blocked(problem);

  const byId = new Map(pages.map((p) => [s(p.Id), p]));
  for (const p of to.pages.filter((p) => !isNew(p.pageId))) {
    const row = byId.get(p.pageId);
    if (!row) return blocked(`${p.name} is no longer in the org. Take it out and try again.`);
    if (s(row.Type) !== "ZIP")
      return blocked(
        `${p.name} is a ${s(row.Type) || "non-ZIP"} page. Only HTML ZIP pages can be put together into a new presentation.`
      );
    if (row.IsAdditionalContent === true)
      return blocked(`${p.name} is additional content, which slides open, not a page of its own.`);
    if (s(row.Status) !== "Active")
      preview.warnings.push(
        `${p.name} is ${s(row.Status).toLowerCase() || "not active"}, so reps don't see it.`
      );
  }
  for (const n of fix.newPages) {
    if (!draftExists(n.draftId))
      return blocked(
        `The files Roz drafted for ${n.name} aren't on this computer any more. Open the draft again and add it to a new presentation.`
      );
    const errors = checkDraft(n.draftId).filter((c) => c.level === "error");
    if (errors.length) return blocked(`${n.name}: ${errors[0].message}`);
  }

  if (fix.newPages.length) preview.warnings.unshift(REVIEW_WARNING);
  if (named.length)
    preview.warnings.push(`There's already a presentation called ${to.fields.name.trim()}.`);
  const shared = await sharedPages(org, "", existing).catch(() => ({}));
  // Org pages keep their own required setting and products: compare with how they are now.
  const before = await pageSettings(org, existing);
  preview.warnings.push(...draftWarnings({ ...blank(to), pages: before }, to, shared, today()));
  preview.warnings = [...new Set(preview.warnings)];
  preview.production = await isProductionOrg(org).catch(() => false);
  return { preview, existing };
}

/** The org pages' own required setting and products, as draft pages. */
async function pageSettings(org: string, pageIds: string[]): Promise<DraftPage[]> {
  if (!pageIds.length) return [];
  const [pages, products] = await Promise.all([
    query(
      `SELECT Id, Name, IsMandatory FROM PresentationPage WHERE Id IN (${inList(pageIds)})`,
      org
    ),
    query(
      `SELECT PresentationPageId, ProductId, Product.Name FROM PresentationPageProduct WHERE PresentationPageId IN (${inList(pageIds)})`,
      org
    ),
  ]);
  return pages.map((p) => ({
    pageId: s(p.Id),
    name: s(p.Name),
    mandatory: p.IsMandatory === true,
    products: products
      .filter((x) => s(x.PresentationPageId) === s(p.Id))
      .map((x) => ({
        id: s(x.ProductId),
        name: s((x.Product as { Name?: string } | null)?.Name) || s(x.ProductId),
      })),
  }));
}

export async function previewCreatePresentation(
  fix: CreatePresentationFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  return (await planCreate(fix, org, progress)).preview;
}

export async function applyCreatePresentation(
  fix: CreatePresentationFix,
  org: string,
  progress?: FixTracker
): Promise<FixResult> {
  const { preview, existing } = await planCreate(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  const created: DeletePresentationFix["created"] = { pageIds: [], contentDocumentIds: [] };
  const before = await pageSettings(org, existing);
  let presentationId = "";
  const idOf = new Map<string, string>();
  try {
    if (fix.newPages.length)
      await step(progress, "upload", async () => {
        for (const n of fix.newPages) {
          const page = fix.draft.pages.find((p) => p.pageId === n.pageId)!;
          {
            const zip = await zipDraft(n.draftId);
            try {
              const up = await uploadContentVersion(zip, n.name, org, "application/zip");
              if (!up.success || !up.data?.contentDocumentId)
                throw new Error(up.error || `Couldn't upload ${n.name}.`);
              created.contentDocumentIds.push(up.data.contentDocumentId);
              const [pageId] = await composite(
                "POST",
                "PresentationPage",
                [
                  {
                    Name: n.name,
                    Type: "ZIP",
                    Status: "Active",
                    ContentDocumentId: up.data.contentDocumentId,
                    IsMandatory: page.mandatory,
                  },
                ],
                org
              );
              created.pageIds.push(pageId);
              idOf.set(n.pageId, pageId);
              // The page needs its file shared with it, or the app can't download it.
              await composite(
                "POST",
                "ContentDocumentLink",
                [
                  {
                    ContentDocumentId: up.data.contentDocumentId,
                    LinkedEntityId: pageId,
                    ShareType: "I",
                    Visibility: "InternalUsers",
                  },
                ],
                org
              );
            } finally {
              rmSync(zip, { force: true });
            }
          }
        }
      });
    await step(progress, "presentation", async () => {
      [presentationId] = await composite(
        "POST",
        "Presentation",
        [
          {
            Name: fix.draft.fields.name.trim(),
            Status: "Inactive",
            Type: "ZIP",
            UsageType: "IntelligentContent",
          },
        ],
        org
      );
    });
    const to: PresentationDraft = {
      ...fix.draft,
      fields: { ...fix.draft.fields, name: fix.draft.fields.name.trim() },
      pages: fix.draft.pages.map((p) => ({ ...p, pageId: idOf.get(p.pageId) ?? p.pageId })),
    };
    const state = await readState(
      org,
      presentationId,
      to.pages.map((p) => p.pageId)
    );
    if (!state) throw new Error("The new presentation couldn't be read back.");
    const writes = planWrites(state.draft, state.rows, to, ALL_PARTS);
    if (!planIsEmpty(writes)) await write(presentationId, state, to, writes, org, progress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const back = await tearDown(org, presentationId, created, before).then(
      () => "Nothing was left behind.",
      () => "Part of it may be left in the org; look for it in the presentation list."
    );
    return { ok: false, message: `${message} ${back}` };
  }
  const name = fix.draft.fields.name.trim();
  return {
    ok: true,
    message: `Created ${name}${fix.newPages.length ? " (inactive, for review)" : ""}.`,
    undo: {
      kind: "deletePresentation",
      label: `Undo: ${fix.label}`,
      presentationId,
      presentationName: name,
      created,
      before,
      recreate: fix,
    },
  };
}

/**
 * Takes a presentation the builder made out of the org: the territories off (and their page shares), the org
 * pages' own settings put back, then the presentation, then the pages and files it made that nothing else uses.
 */
async function tearDown(
  org: string,
  presentationId: string,
  created: DeletePresentationFix["created"],
  before: DraftPage[],
  progress?: FixTracker
): Promise<void> {
  if (ID_PATTERN.test(presentationId)) {
    const state = await readState(
      org,
      presentationId,
      before.map((p) => p.pageId)
    );
    if (state) {
      const was = new Map(before.map((p) => [p.pageId, p]));
      const target: PresentationDraft = {
        ...state.draft,
        pages: state.draft.pages.filter((p) => was.has(p.pageId)).map((p) => was.get(p.pageId)!),
        shares: [],
      };
      const writes = planWrites(state.draft, state.rows, target, [
        "mandatory",
        "products",
        "shares",
      ]);
      if (!planIsEmpty(writes)) await write(presentationId, state, target, writes, org, progress);
      await step(progress, "presentation", () => remove([presentationId], org));
    }
  }
  if (!created.pageIds.length && !created.contentDocumentIds.length) return;
  await step(progress, "pages", async () => {
    const pages = created.pageIds.filter((id) => ID_PATTERN.test(id));
    const [links, rows] = pages.length
      ? await Promise.all([
          query(
            `SELECT PresentationPageId FROM PresentationLinkedPage WHERE PresentationPageId IN (${inList(pages)})`,
            org
          ),
          query(
            `SELECT Id, ContentDocumentId FROM PresentationPage WHERE Id IN (${inList(pages)})`,
            org
          ),
        ])
      : [[], []];
    // A drafted page someone has since put in another presentation stays, with its file.
    const used = new Set(links.map((r) => s(r.PresentationPageId)));
    const keepDocs = new Set(
      rows.filter((r) => used.has(s(r.Id))).map((r) => s(r.ContentDocumentId))
    );
    await remove(
      pages.filter((id) => !used.has(id)),
      org
    );
    await remove(
      created.contentDocumentIds.filter((d) => !keepDocs.has(d)),
      org
    );
  });
}

export async function previewDeletePresentation(
  fix: DeletePresentationFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.presentationName,
        field: "Presentation",
        before: "In the org",
        after: "Deleted",
      },
      ...(fix.created.pageIds.length
        ? [
            {
              target: fix.presentationName,
              field: "Pages Roz drafted",
              before: `${fix.created.pageIds.length} in the org`,
              after: "Deleted, with their files",
            },
          ]
        : []),
      ...fix.before.map((p) => ({
        target: p.name,
        field: "Required, products",
        before: "As the new presentation left them",
        after: `Put back: ${p.mandatory ? "required" : "not required"}, ${p.products.length ? p.products.map((x) => x.name).join(", ") : "no products"}`,
      })),
    ],
    warnings: [],
  };
  if (!ID_PATTERN.test(fix.presentationId))
    return { ...preview, blocked: "Not a presentation Id." };
  const state = await step(progress, "read", () => readState(org, fix.presentationId));
  if (!state) return { ...preview, blocked: "Already deleted." };
  if (state.draft.fields.status === "Active")
    preview.warnings.push("It's active. Reps who have it lose it on their next sync.");
  if (state.draft.shares.length || state.otherShares)
    preview.warnings.push("It's distributed to territories; deleting it takes it off them.");
  const kept = fix.created.pageIds.filter((id) => ID_PATTERN.test(id));
  if (kept.length) {
    const others = await query(
      `SELECT PresentationPageId, Presentation.Name FROM PresentationLinkedPage WHERE PresentationPageId IN (${inList(kept)}) AND PresentationId != '${fix.presentationId}'`,
      org
    ).catch(() => []);
    if (others.length)
      preview.warnings.push(
        `Some drafted pages are in other presentations now (${[...new Set(others.map((r) => s((r.Presentation as { Name?: string } | null)?.Name)))].join(", ")}), so they're kept.`
      );
  }
  preview.production = await isProductionOrg(org).catch(() => false);
  return preview;
}

export async function applyDeletePresentation(
  fix: DeletePresentationFix,
  org: string,
  progress?: FixTracker
): Promise<FixResult> {
  const preview = await previewDeletePresentation(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  try {
    await tearDown(org, fix.presentationId, fix.created, fix.before, progress);
  } catch (err) {
    return {
      ok: false,
      message: `${err instanceof Error ? err.message : String(err)} Part of it may be left in the org; refresh the presentation list.`,
    };
  }
  return {
    ok: true,
    message: `Deleted ${fix.presentationName}.`,
    undo: { ...fix.recreate, label: fix.recreate.label.replace(/^Undo: /, "") },
  };
}
