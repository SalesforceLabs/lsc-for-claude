/**
 * Studio edits to org metadata outside the Admin Console: custom script code,
 * validation rules, and the Visit engagement sidebar (page layout related lists).
 *
 * Same contract as fixes.ts — previews re-read the live org and refuse (`blocked`)
 * when it no longer matches what the map saw; applying re-runs the preview and
 * returns the inverse fix.
 */

import { apiRequest, deployMetadata, describeSObject, updateToolingRecord } from "../salesforce/cli.js";
import {
  MAX_SIDEBAR_RELATED_LISTS,
  countRelatedLists,
  hasRelatedList,
  insertRelatedList,
  layoutDeployPath,
  removeRelatedList,
  retrieveLayoutXml,
  writeLayoutXml,
  type RetrievedLayout,
} from "../salesforce/visit-layout.js";
import { assertId, assertNames, PUBLISH_WARNING } from "./change-helpers.js";
import { scriptCodeFindings } from "./collect.js";
import { lineCount, lineDiff } from "./diff.js";
import { query, type Row } from "./helpers.js";
import type { FixPreview, FixResult, StudioFix } from "./types.js";

type ScriptFix = Extract<StudioFix, { kind: "setCustomScriptCode" }>;
type LayoutFix = Extract<StudioFix, { kind: "setLayoutRelatedList" }>;
type RuleFix = Extract<StudioFix, { kind: "setActive" }> & { record: { type: "validationRule" } };

// --- Custom script code ----------------------------------------------------------

const sizeOf = (code: string) => `${lineCount(code)} lines, ${code.length} characters`;

async function previewSetCustomScriptCode(fix: ScriptFix, org: string): Promise<FixPreview> {
  assertId(fix.scriptId);
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      { target: fix.scriptName, field: "CodeText", before: sizeOf(fix.from), after: sizeOf(fix.to), diff: lineDiff(fix.from, fix.to) },
    ],
    warnings: [],
  };
  const [row] = await query(`SELECT Id, CodeText FROM LifeScienceCustomScript WHERE Id = '${fix.scriptId}'`, org);
  if (!row) return { ...preview, blocked: `${fix.scriptName} no longer exists.` };

  const current = String(row.CodeText ?? "");
  if (current === fix.to) return { ...preview, blocked: "Already applied. Refresh the map." };
  if (current !== fix.from) {
    return { ...preview, blocked: `${fix.scriptName}'s code changed since the map was loaded. Refresh the map and try again.` };
  }

  // The platform can refuse writes to CodeText (it's normally filled by Refresh in the Admin Console).
  const described = await describeSObject("LifeScienceCustomScript", org);
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

async function applySetCustomScriptCode(fix: ScriptFix, org: string): Promise<FixResult> {
  const preview = await previewSetCustomScriptCode(fix, org);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  // Raw API call: the code can be large and multi-line, which `sf data update record --values` can't carry.
  const res = await apiRequest<void>(
    `/services/data/v66.0/sobjects/LifeScienceCustomScript/${fix.scriptId}`,
    "PATCH",
    { CodeText: fix.to },
    org
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
  org: string
): Promise<FixPreview & { metadata?: Record<string, unknown>; id?: string }> {
  const onOff = (v: boolean) => (v ? "Active" : "Inactive");
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [{ target: fix.record.label, field: "Status", before: onOff(fix.from), after: onOff(fix.to) }],
    warnings: [],
  };
  const row = await findRule(fix.record.id, org);
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

export async function applyRuleActive(fix: RuleFix, org: string): Promise<FixResult> {
  const preview = await previewRuleActive(fix, org);
  if (preview.blocked || !preview.metadata || !preview.id) return { ok: false, message: preview.blocked || "Nothing to update." };
  // A Tooling API update must carry the rule's whole Metadata, so send what was just read with `active` changed.
  const metadata = Object.fromEntries(Object.entries({ ...preview.metadata, active: fix.to }).filter(([, v]) => v !== null));
  const res = await updateToolingRecord("ValidationRule", preview.id, { Metadata: metadata }, org);
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
  org: string
): Promise<FixPreview & { layout?: Extract<RetrievedLayout, { ok: true }> }> {
  assertNames(fix.relationshipName, fix.objectName);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };

  const layout = await retrieveLayoutXml(fix.layoutName, org);
  if (!layout.ok) {
    return { ...preview, blocked: `Couldn't retrieve ${fix.layoutLabel}${layout.error ? `: ${layout.error}` : ". It may no longer exist."}` };
  }

  const count = countRelatedLists(layout.xml);
  const present = hasRelatedList(layout.xml, fix.relationshipName);
  const entry = `${fix.relationshipName} (${fix.objectName})`;
  preview.changes.push(
    fix.add
      ? {
          target: fix.layoutLabel,
          field: "Sidebar related list",
          before: `${count} of ${MAX_SIDEBAR_RELATED_LISTS}`,
          after: `${count + 1} of ${MAX_SIDEBAR_RELATED_LISTS}`,
          diff: [
            "+ <relatedLists>",
            `+     <relatedList>${fix.relationshipName}</relatedList>`,
            "+     <fields>NAME</fields>",
            "+     <excludeButtons>New</excludeButtons>",
            "+     <excludeButtons>MassDeleteAll</excludeButtons>",
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
  return { ...preview, layout };
}

async function applySetLayoutRelatedList(fix: LayoutFix, org: string): Promise<FixResult> {
  const preview = await previewSetLayoutRelatedList(fix, org);
  if (preview.blocked || !preview.layout) return { ok: false, message: preview.blocked || "Nothing to update." };
  const { layout } = preview;
  writeLayoutXml(layout, fix.add ? insertRelatedList(layout.xml, fix.relationshipName) : removeRelatedList(layout.xml, fix.relationshipName));
  const deployed = await deployMetadata(layoutDeployPath(layout), org);
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

// --- Public API (dispatched from fixes.ts) --------------------------------------------

export type EditFix = ScriptFix | LayoutFix | RuleFix;

export function isEditFix(fix: StudioFix): fix is EditFix {
  return fix.kind === "setCustomScriptCode" || fix.kind === "setLayoutRelatedList" || (fix.kind === "setActive" && isRuleFix(fix));
}

export async function previewEdit(fix: EditFix, org: string): Promise<FixPreview> {
  switch (fix.kind) {
    case "setCustomScriptCode":
      return previewSetCustomScriptCode(fix, org);
    case "setLayoutRelatedList": {
      const { layout: _layout, ...preview } = await previewSetLayoutRelatedList(fix, org);
      return preview;
    }
    case "setActive": {
      const { metadata: _metadata, id: _id, ...preview } = await previewRuleActive(fix, org);
      return preview;
    }
  }
}

export async function applyEdit(fix: EditFix, org: string): Promise<FixResult> {
  switch (fix.kind) {
    case "setCustomScriptCode":
      return applySetCustomScriptCode(fix, org);
    case "setLayoutRelatedList":
      return applySetLayoutRelatedList(fix, org);
    case "setActive":
      return applyRuleActive(fix, org);
  }
}
