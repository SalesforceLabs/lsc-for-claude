/**
 * Studio edits to org metadata outside the Admin Console: custom script code,
 * validation rules, the Visit engagement sidebar (page layout related lists),
 * and page layouts, compact layouts and Lightning pages edited in the iPad preview (`editMetadata`).
 *
 * Same contract as fixes.ts — previews re-read the live org and refuse (`blocked`)
 * when it no longer matches what the map saw; applying re-runs the preview and
 * returns the inverse fix.
 */

import { apiRequest, cachedDescribeSObject, deployMetadata, describeSObject, updateToolingRecord } from "../salesforce/cli.js";
import {
  MAX_SIDEBAR_RELATED_LISTS,
  countRelatedLists,
  hasRelatedList,
  insertRelatedList,
  layoutDeployPath,
  recordNameField,
  removeRelatedList,
  retrieveLayoutXml,
  writeLayoutXml,
  type RetrievedLayout,
} from "../salesforce/visit-layout.js";
import { assertId, assertNames, PUBLISH_WARNING } from "./change-helpers.js";
import { deployDoc, validateDoc, withDoc, type MetadataDoc } from "./metadata/doc.js";
import { applyCompactOps, StaleCompactError } from "./metadata/compact-ops.js";
import { applyLayoutOps, relatedListCount, StaleLayoutError, type LayoutChange } from "./metadata/layout-ops.js";
import { applyListViewOps, StaleListViewError } from "./metadata/listview-ops.js";
import { applyFlexiPageOps, flexiPageWarnings, StaleFlexiPageError } from "./metadata/flexipage-ops.js";
import { compactLayoutRecordTypes, isManagedFlexiPage, knownFlexiPageReach, isProductionOrg, layoutProfiles, liveListViewOf, splitCompactName, splitListViewName } from "./metadata/live.js";
import { applyCopy, previewCopy } from "./metadata/copy-fix.js";
import { serializeXml, type XmlNode } from "./metadata/xml.js";
import { scriptCodeFindings } from "./collect.js";
import { lineCount, lineDiff } from "./diff.js";
import { query, type Row } from "./helpers.js";
import { step, type FixTracker } from "./fix-progress.js";
import type { CompactLayoutEditFix, CompactOp, FixPreview, FixResult, FlexiPageEditFix, FlexiPageOp, LayoutOp, ListViewOp, StudioFix } from "./types.js";

type ScriptFix = Extract<StudioFix, { kind: "setCustomScriptCode" }>;
type LayoutFix = Extract<StudioFix, { kind: "setLayoutRelatedList" }>;
type RuleFix = Extract<StudioFix, { kind: "setActive" }> & { record: { type: "validationRule" } };
type MetadataFix = Extract<StudioFix, { kind: "editMetadata" }>;
type CopyFix = Extract<StudioFix, { kind: "copyForProfile" }>;

// --- Custom script code ----------------------------------------------------------

const sizeOf = (code: string) => `${lineCount(code)} lines, ${code.length} characters`;

async function previewSetCustomScriptCode(fix: ScriptFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  assertId(fix.scriptId);
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      { target: fix.scriptName, field: "CodeText", before: sizeOf(fix.from), after: sizeOf(fix.to), diff: lineDiff(fix.from, fix.to) },
    ],
    warnings: [],
  };
  const [row] = await step(progress, "read", () => query(`SELECT Id, CodeText FROM LifeScienceCustomScript WHERE Id = '${fix.scriptId}'`, org));
  if (!row) return { ...preview, blocked: `${fix.scriptName} no longer exists.` };

  const current = String(row.CodeText ?? "");
  if (current === fix.to) return { ...preview, blocked: "Already applied. Refresh the map." };
  if (current !== fix.from) {
    return { ...preview, blocked: `${fix.scriptName}'s code changed since the map was loaded. Refresh the map and try again.` };
  }

  // The platform can refuse writes to CodeText (it's normally filled by Refresh in the Admin Console).
  const described = await step(progress, "describe", () => describeSObject("LifeScienceCustomScript", org));
  const field = described.success ? described.data?.fields.find((f) => f.name === "CodeText") : undefined;
  if (field && !field.updateable) {
    return {
      ...preview,
      blocked:
        "This org doesn't let the API write CodeText. Edit the script's LWC, deploy it, then click Refresh in Admin Console > Workflow Configuration > Custom Scripts.",
    };
  }

  for (const f of scriptCodeFindings(fix.to)) preview.warnings.push(f.detail ? `${f.title}. ${f.detail}` : f.title);
  preview.warnings.push("Clicking Refresh in Admin Console > Custom Scripts overwrites CodeText from the deployed LWC, discarding this edit.");
  return preview;
}

async function applySetCustomScriptCode(fix: ScriptFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const preview = await previewSetCustomScriptCode(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  // Raw API call: the code can be large and multi-line, which `sf data update record --values` can't carry.
  const res = await step(progress, "write", () =>
    apiRequest<void>(`/services/data/v66.0/sobjects/LifeScienceCustomScript/${fix.scriptId}`, "PATCH", { CodeText: fix.to }, org)
  );
  if (!res.success) return { ok: false, message: res.error || "Couldn't update the script." };
  return {
    ok: true,
    message: `${fix.scriptName}: code updated (${sizeOf(fix.from)} → ${sizeOf(fix.to)}).`,
    undo: { ...fix, label: `Restore code of ${fix.scriptName}`, from: fix.to, to: fix.from },
  };
}

// --- Validation rule active switch -----------------------------------------------

async function findRule(id: string, org: string): Promise<Row | undefined> {
  assertId(id);
  const [row] = await query(
    `SELECT Id, ValidationName, Active, ManageableState, NamespacePrefix, Metadata FROM ValidationRule WHERE Id = '${id}'`,
    org,
    true
  );
  return row;
}

export const isRuleFix = (fix: Extract<StudioFix, { kind: "setActive" }>): fix is RuleFix => fix.record.type === "validationRule";

export async function previewRuleActive(
  fix: RuleFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { metadata?: Record<string, unknown>; id?: string }> {
  const onOff = (v: boolean) => (v ? "Active" : "Inactive");
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [{ target: fix.record.label, field: "Status", before: onOff(fix.from), after: onOff(fix.to) }],
    warnings: [],
  };
  const row = await step(progress, "read", () => findRule(fix.record.id, org));
  if (!row) return { ...preview, blocked: `${fix.record.label} no longer exists.` };
  if (!!row.Active === fix.to) return { ...preview, blocked: `Already ${onOff(fix.to).toLowerCase()}. Refresh the map.` };

  preview.warnings.push(
    fix.to
      ? "Records that already break this rule stay as they are, but users get its error the next time they save one."
      : `Turns this rule off for every user, import, and integration saving these records.`
  );
  if (row.ManageableState === "installed") {
    preview.warnings.push(`Belongs to an installed package${row.NamespacePrefix ? ` (${row.NamespacePrefix})` : ""}; Salesforce may refuse the change.`);
  }
  return { ...preview, metadata: (row.Metadata ?? {}) as Record<string, unknown>, id: String(row.Id) };
}

export async function applyRuleActive(fix: RuleFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const preview = await previewRuleActive(fix, org, progress);
  if (preview.blocked || !preview.metadata || !preview.id) return { ok: false, message: preview.blocked || "Nothing to update." };
  // A Tooling API update must carry the rule's whole Metadata, so send what was just read with `active` changed.
  const metadata = Object.fromEntries(Object.entries({ ...preview.metadata, active: fix.to }).filter(([, v]) => v !== null));
  const ruleId = preview.id;
  const res = await step(progress, "write", () => updateToolingRecord("ValidationRule", ruleId, { Metadata: metadata }, org));
  if (!res.success) return { ok: false, message: res.error || "Couldn't update the validation rule." };
  return {
    ok: true,
    message: `${fix.record.label} is now ${fix.to ? "active" : "inactive"}.`,
    undo: { ...fix, label: `${fix.from ? "Activate" : "Deactivate"} ${fix.record.label}`, from: fix.to, to: fix.from },
  };
}

// --- Visit engagement sidebar ------------------------------------------------------

/** Sidebar rows come from the object's DB Schema record — without an active one the list shows no data. */
async function dbSchemaWarning(objectName: string, org: string): Promise<string | null> {
  try {
    assertNames(objectName);
    const [rec] = await query(
      `SELECT Id, IsActive FROM LifeSciConfigRecord WHERE DeveloperName = 'DbSchema_${objectName}' LIMIT 1`,
      org,
      true
    );
    if (!rec) return `No DB Schema record for ${objectName}, so its records won't sync to the iPad and the sidebar item will be empty.`;
    if (!rec.IsActive) return `The DB Schema record for ${objectName} is switched off, so the sidebar item will show no data.`;
  } catch {
    // Advisory only.
  }
  return null;
}

async function previewSetLayoutRelatedList(
  fix: LayoutFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { layout?: Extract<RetrievedLayout, { ok: true }> }> {
  assertNames(fix.relationshipName, fix.objectName);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };

  const layout = await step(progress, "retrieve", () => retrieveLayoutXml(fix.layoutName, org, progress?.statusHook("retrieve")));
  progress?.begin("diff");
  if (!layout.ok) {
    return { ...preview, blocked: `Couldn't retrieve ${fix.layoutLabel}${layout.error ? `: ${layout.error}` : ". It may no longer exist."}` };
  }

  const count = countRelatedLists(layout.xml);
  const present = hasRelatedList(layout.xml, fix.relationshipName);
  const entry = `${fix.relationshipName} (${fix.objectName})`;
  const nameField = fix.add ? await recordNameField(fix.objectName, org) : undefined;
  preview.changes.push(
    fix.add
      ? {
          target: fix.layoutLabel,
          field: "Sidebar related list",
          before: `${count} of ${MAX_SIDEBAR_RELATED_LISTS}`,
          after: `${count + 1} of ${MAX_SIDEBAR_RELATED_LISTS}`,
          diff: [
            "+ <relatedLists>",
            "+     <excludeButtons>New</excludeButtons>",
            `+     <fields>${nameField ?? "NAME"}</fields>`,
            `+     <relatedList>${fix.relationshipName}</relatedList>`,
            "+ </relatedLists>",
          ],
        }
      : { target: fix.layoutLabel, field: "Sidebar related list", before: `${count} of ${MAX_SIDEBAR_RELATED_LISTS} (${entry})`, after: `${count - 1} of ${MAX_SIDEBAR_RELATED_LISTS}` }
  );

  if (fix.add && present) return { ...preview, blocked: `${entry} is already a related list on ${fix.layoutLabel}. Refresh the map.` };
  if (!fix.add && !present) return { ...preview, blocked: `${entry} is no longer a related list on ${fix.layoutLabel}. Refresh the map.` };
  if (fix.add && count >= MAX_SIDEBAR_RELATED_LISTS) {
    return {
      ...preview,
      blocked: `${fix.layoutLabel} already has ${count} related lists — the sidebar holds ${MAX_SIDEBAR_RELATED_LISTS} (8 out-of-the-box + 2 custom). Remove one first.`,
    };
  }

  preview.warnings.push(`Deploys ${fix.layoutLabel} to the org — every profile assigned this layout gets the change.`);
  if (fix.add) {
    const dbWarning = await dbSchemaWarning(fix.objectName, org);
    if (dbWarning) preview.warnings.push(dbWarning);
  }
  preview.warnings.push(PUBLISH_WARNING);
  progress?.end("diff");
  return { ...preview, layout };
}

async function applySetLayoutRelatedList(fix: LayoutFix, org: string, progress?: FixTracker): Promise<FixResult> {
  const preview = await previewSetLayoutRelatedList(fix, org, progress);
  if (preview.blocked || !preview.layout) return { ok: false, message: preview.blocked || "Nothing to update." };
  const { layout } = preview;
  writeLayoutXml(layout, fix.add ? insertRelatedList(layout.xml, fix.relationshipName, await recordNameField(fix.objectName, org)) : removeRelatedList(layout.xml, fix.relationshipName));
  const deployed = await step(progress, "deploy", () => (progress ? deployMetadata(layoutDeployPath(layout), org, progress.statusHook("deploy")) : deployMetadata(layoutDeployPath(layout), org)));
  if (!deployed.success) {
    return { ok: false, message: `Deploying ${fix.layoutLabel} failed: ${deployed.error || "unknown error"}. Nothing was changed.` };
  }
  return {
    ok: true,
    message: `${fix.add ? "Added" : "Removed"} ${fix.relationshipName} ${fix.add ? "to" : "from"} ${fix.layoutLabel}.`,
    undo: {
      ...fix,
      label: `${fix.add ? "Remove" : "Add"} ${fix.objectName} ${fix.add ? "from" : "to"} the sidebar of ${fix.layoutLabel}`,
      add: !fix.add,
    },
  };
}

// --- Page layouts edited in the iPad preview ------------------------------------------

/** "…the layout for 3 profiles (A, B, C)" — every profile assigned the layout gets a deployed change. */
async function layoutReach(fix: MetadataFix, org: string): Promise<string> {
  const profiles = await layoutProfiles(fix.doc.fullName, org);
  if (!profiles) return `Deploys ${fix.doc.label} to the org — every profile assigned this layout gets the change.`;
  if (!profiles.length) return `Deploys ${fix.doc.label} to the org. No profile is assigned this layout.`;
  const shown = profiles.length > 4 ? `${profiles.slice(0, 4).join(", ")} and ${profiles.length - 4} more` : profiles.join(", ");
  return profiles.length === 1
    ? `Deploys ${fix.doc.label} to the org — it's the layout for ${shown}.`
    : `Deploys ${fix.doc.label} to the org — it's the layout for ${profiles.length} profiles (${shown}), and they all get the change.`;
}

// --- Compact layouts (the record header) edited in the iPad preview ----------------------

const COMPACT_OPS = new Set<string>(["moveCompactField", "removeCompactField", "addCompactField"]);
const isCompactFix = (fix: MetadataFix): fix is CompactLayoutEditFix => fix.doc.type === "CompactLayout";

/** "…the compact layout for 2 record types (A, B)" — compact layouts are assigned per record type, for every profile. */
async function compactReach(fix: MetadataFix, org: string): Promise<string> {
  const types = await compactLayoutRecordTypes(fix.doc.fullName, org);
  const label = fix.doc.label;
  if (!types) return `Deploys ${label} to the org — every record type assigned this compact layout gets the change, for every profile.`;
  if (!types.length) return `Deploys ${label} to the org. No record type is assigned this compact layout.`;
  const shown = types.length > 4 ? `${types.slice(0, 4).join(", ")} and ${types.length - 4} more` : types.join(", ");
  return types.length === 1
    ? `Deploys ${label} to the org — it's the compact layout for the ${shown} record type, for every profile.`
    : `Deploys ${label} to the org — it's the compact layout for ${types.length} record types (${shown}), for every profile.`;
}

/** The fix's ops applied to the document; ops of the wrong kind for the document are refused. */
function applyFixOps(fix: MetadataFix, root: XmlNode): { root: XmlNode; inverse: (LayoutOp | CompactOp)[]; changes: LayoutChange[] } {
  const ops = fix.ops as (LayoutOp | CompactOp)[];
  if (ops.some((o) => COMPACT_OPS.has(o.op) !== isCompactFix(fix))) throw new Error(`These edits don't apply to a ${fix.doc.type}.`);
  return isCompactFix(fix) ? applyCompactOps(root, fix.ops) : applyLayoutOps(root, fix.ops as LayoutOp[]);
}

/** A new related list shows the child's record-name field; the org refuses `NAME` for many objects, so ask the child's describe. */
async function withNameFields(ops: LayoutOp[], org: string): Promise<LayoutOp[]> {
  return Promise.all(
    ops.map(async (op) => {
      if (op.op !== "addRelatedList" || op.xml || op.nameField || !op.object) return op;
      const nameField = await recordNameField(op.object, org);
      return nameField ? { ...op, nameField } : op;
    })
  );
}

interface MetadataPlan {
  preview: FixPreview;
  root?: XmlNode;
  inverse?: (LayoutOp | CompactOp | FlexiPageOp | ListViewOp)[];
}

const FLEXIPAGE_OPS = new Set(["moveComponent", "removeComponent", "addComponent", "setComponentProperty"]);

/** `forApply` leaves out what only the review dialog shows (who is reached, production), keeping every check that can block. */
async function planEditMetadata(fix: MetadataFix, doc: MetadataDoc, org: string, progress?: FixTracker, forApply = false): Promise<MetadataPlan> {
  progress?.begin("diff");
  if (fix.ops.some((op) => FLEXIPAGE_OPS.has(op.op) !== (fix.doc.type === "FlexiPage") || LISTVIEW_OPS.has(op.op) !== (fix.doc.type === "ListView"))) {
    throw new Error(`These changes aren't ${fix.doc.type} edits.`);
  }
  if (fix.doc.type === "ListView") return planEditListView(fix, doc, org, progress, forApply);
  if (fix.doc.type === "FlexiPage") return planEditFlexiPage(fix, doc, org, progress, forApply);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  if (!fix.ops.length) return { preview: { ...preview, blocked: "Nothing to change." } };
  let result: ReturnType<typeof applyFixOps>;
  try {
    result = applyFixOps(fix.doc.type === "Layout" ? ({ ...fix, ops: await withNameFields(fix.ops as LayoutOp[], org) } as MetadataFix) : fix, doc.root);
  } catch (e) {
    if (!(e instanceof StaleLayoutError) && !(e instanceof StaleCompactError)) throw e;
    return { preview: { ...preview, blocked: `${fix.doc.label} changed since the preview was loaded: ${e.message} Refresh the preview.` } };
  }
  const after = serializeXml(result.root);
  const diff = lineDiff(doc.xml, after);
  if (!diff.length) return { preview: { ...preview, blocked: `${fix.doc.label} already looks like this. Refresh the preview.` } };
  preview.changes = result.changes.map((c) => ({ target: fix.doc.label, ...c }));
  preview.changes[preview.changes.length - 1].diff = diff;
  progress?.end("diff");

  if (fix.doc.type === "Layout" && fix.doc.fullName.startsWith("Visit-")) {
    const [before, now] = [relatedListCount(doc.root), relatedListCount(result.root)];
    // An undo puts back related lists it carries the XML of (the layout may already be over the cap); anything new is held to it.
    const addsNew = (fix.ops as LayoutOp[]).some((op) => op.op === "addRelatedList" && !op.xml);
    if (now > before && now > MAX_SIDEBAR_RELATED_LISTS && addsNew) {
      return {
        preview: {
          ...preview,
          blocked: `${fix.doc.label} would have ${now} related lists — the visit sidebar holds ${MAX_SIDEBAR_RELATED_LISTS} (8 out-of-the-box + 2 custom). Remove one first.`,
        },
      };
    }
  }

  const [reach, production, ...dbWarnings] = await Promise.all([
    forApply ? "" : step(progress, "reach", () => (isCompactFix(fix) ? compactReach(fix, org) : layoutReach(fix, org))),
    forApply ? false : step(progress, "production", () => isProductionOrg(org)),
    ...(fix.ops as (LayoutOp | CompactOp)[]).flatMap((op) =>
      op.op === "addRelatedList" && op.object && !op.xml ? [dbSchemaWarning(op.object, org)] : []
    ),
  ]);
  preview.warnings.push(reach as string, ...(dbWarnings as (string | null)[]).filter((w): w is string => !!w), PUBLISH_WARNING);
  if (production) preview.production = true;
  return { preview, root: result.root, inverse: result.inverse };
}

// --- Lightning pages edited in the iPad preview ------------------------------------

/**
 * "…the page for 3 profiles (A, B, C) and the default in App X" when every app was read lately; otherwise a plain warning,
 * since reading them all can take a minute in big orgs — the review dialog offers that on request (`studio_page_reach`).
 */
function flexiPageReachWarning(fix: MetadataFix, org: string): { warning: string; known: boolean } {
  const reach = knownFlexiPageReach(fix.doc.fullName, org);
  if (!reach) return { warning: `Deploys ${fix.doc.label} to the org — other profiles and apps may use it too, and everyone who gets it gets the change.`, known: false };
  const { profiles, appDefaults } = reach;
  const list = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", "));
  if (!profiles.length && !appDefaults.length) {
    return { warning: `Deploys ${fix.doc.label} to the org. No app assigns it to a profile, but it may be an object's or the org's default page.`, known: true };
  }
  const parts = [
    ...(profiles.length ? [profiles.length === 1 ? `the page for ${profiles[0]}` : `the page for ${profiles.length} profiles (${list(profiles)})`] : []),
    ...(appDefaults.length ? [`the default in ${list(appDefaults)}`] : []),
  ];
  return { warning: `Deploys ${fix.doc.label} to the org — it's ${parts.join(" and ")}, and everyone who gets it gets the change.`, known: true };
}

async function planEditFlexiPage(fix: MetadataFix, doc: MetadataDoc, org: string, progress?: FixTracker, forApply = false): Promise<MetadataPlan> {
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  if (!fix.ops.length) return { preview: { ...preview, blocked: "Nothing to change." } };
  const ops = fix.ops as FlexiPageOp[];
  let result: ReturnType<typeof applyFlexiPageOps>;
  try {
    result = applyFlexiPageOps(doc.root, ops);
  } catch (e) {
    if (!(e instanceof StaleFlexiPageError)) throw e;
    return { preview: { ...preview, blocked: `${fix.doc.label} changed since the preview was loaded: ${e.message} Refresh the preview.` } };
  }
  const diff = lineDiff(doc.xml, serializeXml(result.root));
  if (!diff.length) return { preview: { ...preview, blocked: `${fix.doc.label} already looks like this. Refresh the preview.` } };
  preview.changes = result.changes.map((c) => ({ target: fix.doc.label, ...c }));
  preview.changes[preview.changes.length - 1].diff = diff;
  progress?.end("diff");

  const [managed, production] = await Promise.all([
    isManagedFlexiPage(fix.doc.fullName, org),
    forApply ? false : step(progress, "production", () => isProductionOrg(org)),
  ]);
  if (managed) {
    return {
      preview: {
        ...preview,
        blocked: `${fix.doc.label} was installed from a managed package, so it can't be changed. Clone it in Lightning App Builder, assign the copy, and edit that.`,
      },
    };
  }
  if (!forApply) {
    const reach = flexiPageReachWarning(fix, org);
    preview.warnings.push(reach.warning);
    if (!reach.known) preview.reachPage = fix.doc.fullName;
  }
  preview.warnings.push(...flexiPageWarnings(ops, result.root), PUBLISH_WARNING);
  if (production) preview.production = true;
  return { preview, root: result.root, inverse: result.inverse };
}

// --- List views edited in the iPad preview ------------------------------------------

const LISTVIEW_OPS = new Set<string>(["moveListColumn", "removeListColumn", "addListColumn", "setListFilterScope", "setListFilters"]);

const SHARED_KINDS: Record<string, string> = {
  allInternalUsers: "all internal users",
  allPartnerUsers: "all partner users",
  group: "group",
  role: "role",
  roleAndSubordinates: "role and subordinates",
  roleAndSubordinatesInternal: "role and subordinates",
  territory: "territory",
  territoryAndSubordinates: "territory and subordinates",
};

/** "...shared with group A, role B" - who sees the list view; a view with no sharing is every user's. */
function listViewReach(label: string, sharedTo: { kind: string; name: string }[] | null): string {
  if (!sharedTo) return `Deploys ${label} to the org - it's shared with all users, and they all get the change.`;
  if (!sharedTo.length) return `Deploys ${label} to the org. It isn't shared with anyone but its owner.`;
  const shown = sharedTo.slice(0, 4).map((s) => (s.name ? `${SHARED_KINDS[s.kind] ?? s.kind} ${s.name}` : (SHARED_KINDS[s.kind] ?? s.kind)));
  const more = sharedTo.length > 4 ? ` and ${sharedTo.length - 4} more` : "";
  return `Deploys ${label} to the org - it's shared with ${shown.join(", ")}${more}, and everyone it's shared with gets the change.`;
}

async function planEditListView(fix: MetadataFix, doc: MetadataDoc, org: string, progress?: FixTracker, forApply = false): Promise<MetadataPlan> {
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  if (!fix.ops.length) return { preview: { ...preview, blocked: "Nothing to change." } };
  const live = liveListViewOf(fix.doc.fullName, doc.root);
  if (live.managed) {
    return {
      preview: { ...preview, blocked: `${fix.doc.label} was installed from a managed package, so it can't be changed. Create a copy in Setup and edit that.` },
    };
  }
  let result: ReturnType<typeof applyListViewOps>;
  try {
    result = applyListViewOps(doc.root, fix.ops as ListViewOp[]);
  } catch (e) {
    if (!(e instanceof StaleListViewError)) throw e;
    return { preview: { ...preview, blocked: `${fix.doc.label} changed since the preview was loaded: ${e.message} Refresh the preview.` } };
  }
  const diff = lineDiff(doc.xml, serializeXml(result.root));
  if (!diff.length) return { preview: { ...preview, blocked: `${fix.doc.label} already looks like this. Refresh the preview.` } };
  preview.changes = result.changes.map((c) => ({ target: fix.doc.label, ...c }));
  preview.changes[preview.changes.length - 1].diff = diff;
  progress?.end("diff");
  preview.warnings.push(listViewReach(fix.doc.label, live.sharedTo));
  // The iPad lists an object's views live, so reps see a deployed change without a metadata cache publish.
  preview.warnings.push("The iPad reads list views from the org when a rep opens the list, so no publish to iPad is needed.");
  if (!forApply && (await step(progress, "production", () => isProductionOrg(org)))) preview.production = true;
  return { preview, root: result.root, inverse: result.inverse };
}

async function previewEditMetadata(fix: MetadataFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  const title = fix.label;
  try {
    if (isCompactFix(fix)) splitCompactName(fix.doc.fullName);
    if (fix.doc.type === "ListView") splitListViewName(fix.doc.fullName);
    progress?.begin("retrieve");
    return await withDoc(
      fix.doc.type,
      fix.doc.fullName,
      org,
      async (doc) => {
        progress?.end("retrieve");
        const { preview, root } = await planEditMetadata(fix, doc, org, progress);
        // Layout rules the XML can't show (required fields, read-only system fields, related lists the object doesn't offer): ask the org.
        if (!preview.blocked && root && fix.doc.type === "Layout") {
          const refused = await step(progress, "validate", () => validateDoc(doc, root, org)).catch(() => null);
          if (refused) return { ...preview, blocked: `The org would refuse this change: ${refused}` };
        }
        return preview;
      },
      progress?.statusHook("retrieve")
    );
  } catch (e) {
    progress?.fail("retrieve");
    return { org, title, changes: [], warnings: [], blocked: e instanceof Error ? e.message : String(e) };
  }
}

async function applyEditMetadata(fix: MetadataFix, org: string, progress?: FixTracker): Promise<FixResult> {
  try {
    if (isCompactFix(fix)) splitCompactName(fix.doc.fullName);
    if (fix.doc.type === "ListView") splitListViewName(fix.doc.fullName);
    progress?.begin("retrieve");
    return await withDoc(fix.doc.type, fix.doc.fullName, org, async (doc) => {
      progress?.end("retrieve");
      const { preview, root, inverse } = await planEditMetadata(fix, doc, org, progress, true);
      if (preview.blocked || !root || !inverse) return { ok: false, message: preview.blocked || "Nothing to update." };
      try {
        await step(progress, "deploy", () => deployDoc(doc, root, org, progress?.statusHook("deploy")));
      } catch (e) {
        return { ok: false, message: `${e instanceof Error ? e.message : String(e)}. Nothing was changed.` };
      }
      return {
        ok: true,
        message: `Updated ${fix.doc.label}.`,
        undo: { kind: "editMetadata", label: `Undo: ${fix.label}`, doc: fix.doc, ops: inverse } as MetadataFix,
      };
    }, progress?.statusHook("retrieve"));
  } catch (e) {
    progress?.fail("retrieve");
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// --- Public API (dispatched from fixes.ts) --------------------------------------------

export type EditFix = ScriptFix | LayoutFix | RuleFix | MetadataFix | CopyFix;

export function isEditFix(fix: StudioFix): fix is EditFix {
  return (
    fix.kind === "setCustomScriptCode" ||
    fix.kind === "setLayoutRelatedList" ||
    fix.kind === "editMetadata" ||
    fix.kind === "copyForProfile" ||
    (fix.kind === "setActive" && isRuleFix(fix))
  );
}

export async function previewEdit(fix: EditFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  switch (fix.kind) {
    case "setCustomScriptCode":
      return previewSetCustomScriptCode(fix, org, progress);
    case "setLayoutRelatedList": {
      const { layout: _layout, ...preview } = await previewSetLayoutRelatedList(fix, org, progress);
      return preview;
    }
    case "setActive": {
      const { metadata: _metadata, id: _id, ...preview } = await previewRuleActive(fix, org, progress);
      return preview;
    }
    case "editMetadata":
      return previewEditMetadata(fix, org, progress);
    case "copyForProfile":
      return previewCopy(fix, org, progress);
  }
}

export async function applyEdit(fix: EditFix, org: string, progress?: FixTracker): Promise<FixResult> {
  switch (fix.kind) {
    case "setCustomScriptCode":
      return applySetCustomScriptCode(fix, org, progress);
    case "setLayoutRelatedList":
      return applySetLayoutRelatedList(fix, org, progress);
    case "setActive":
      return applyRuleActive(fix, org, progress);
    case "editMetadata":
      return applyEditMetadata(fix, org, progress);
    case "copyForProfile":
      return applyCopy(fix, org, progress);
  }
}
