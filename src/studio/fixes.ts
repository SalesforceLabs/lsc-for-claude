/**
 * Studio changes — small, reversible edits suggested by findings or made in
 * the inspector. New records live in create.ts, user access in access.ts.
 *
 * Every fix is previewed against the live org before it's applied: the preview
 * re-reads current state, refuses (`blocked`) if the org no longer matches what
 * the map saw, and the apply step re-runs the preview so nothing is written on
 * stale data. Applying returns the inverse fix so the UI can offer Undo.
 */

import { urgentScope } from "../salesforce/limiter.js";
import {
  createRecord,
  createToolingRecord,
  deleteRecord,
  deleteToolingRecord,
  updateToolingRecord,
} from "../salesforce/cli.js";
import { extractFieldValue, getValueColumn, queryFieldValues } from "../tools/helpers.js";
import { applyAccess, previewAccess } from "./access.js";
import {
  assertId,
  assertNames,
  audienceWarnings,
  display,
  findConfigRecord,
  MOBILE_CATEGORIES,
  PUBLISH_WARNING,
} from "./change-helpers.js";
import { applyCreate, applyDelete, previewCreate, previewDelete, resolveNames } from "./create.js";
import { applyEdit, isEditFix, previewEdit } from "./edits.js";
import { inList, query, splitList, type Row } from "./helpers.js";
import { step, type FixTracker } from "./fix-progress.js";
import { withReach } from "./reach.js";
import type { FixPreview, FixResult, RecordRef, StudioFix } from "./types.js";

// --- Permission set licenses -------------------------------------------------

async function pslCapacity(pslId: string, org: string): Promise<Row | undefined> {
  const [row] = await query(
    `SELECT Id, MasterLabel, UsedLicenses, TotalLicenses FROM PermissionSetLicense WHERE Id = '${pslId}'`,
    org
  );
  return row;
}

async function pslAssignment(userId: string, pslId: string, org: string): Promise<Row | undefined> {
  const [row] = await query(
    `SELECT Id FROM PermissionSetLicenseAssign WHERE AssigneeId = '${userId}' AND PermissionSetLicenseId = '${pslId}'`,
    org
  );
  return row;
}

async function previewAssignPsl(
  fix: Extract<StudioFix, { kind: "assignPsl" }>,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  return step(progress, "read", () => previewAssignPslNow(fix, org));
}

async function previewAssignPslNow(
  fix: Extract<StudioFix, { kind: "assignPsl" }>,
  org: string
): Promise<FixPreview> {
  assertId(fix.userId);
  assertId(fix.pslId);
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.userName,
        field: "Permission set licenses",
        before: "—",
        after: `+ ${fix.pslLabel}`,
      },
    ],
    warnings: [],
  };
  const [user] = await query(`SELECT Id, IsActive FROM User WHERE Id = '${fix.userId}'`, org);
  if (!user) return { ...preview, blocked: "The user no longer exists." };
  if (!user.IsActive) return { ...preview, blocked: "The user is inactive." };
  if (await pslAssignment(fix.userId, fix.pslId, org)) {
    return { ...preview, blocked: `${fix.userName} already has ${fix.pslLabel}. Refresh the map.` };
  }
  const psl = await pslCapacity(fix.pslId, org);
  if (!psl) return { ...preview, blocked: "The permission set license no longer exists." };
  const used = Number(psl.UsedLicenses ?? 0);
  const total = Number(psl.TotalLicenses ?? 0);
  if (total > 0 && used >= total)
    return { ...preview, blocked: `No ${fix.pslLabel} licenses left (${used} of ${total} used).` };
  preview.warnings.push(`Uses 1 of ${total - used} remaining ${fix.pslLabel} licenses.`);
  return preview;
}

async function previewRemovePsl(
  fix: Extract<StudioFix, { kind: "removePsl" }>,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  return step(progress, "read", () => previewRemovePslNow(fix, org));
}

async function previewRemovePslNow(
  fix: Extract<StudioFix, { kind: "removePsl" }>,
  org: string
): Promise<FixPreview> {
  assertId(fix.assignmentId);
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.userName,
        field: "Permission set licenses",
        before: fix.pslLabel,
        after: `− ${fix.pslLabel}`,
      },
    ],
    warnings: [
      "Salesforce refuses the removal if the user has permission sets that require this license.",
    ],
  };
  const [row] = await query(
    `SELECT Id FROM PermissionSetLicenseAssign WHERE Id = '${fix.assignmentId}'`,
    org
  );
  if (!row) return { ...preview, blocked: "The license assignment no longer exists." };
  return preview;
}

// --- Admin Console config field values ---------------------------------------

interface FieldTarget {
  fieldValueId: string;
  dataType: string;
  current: unknown;
}

async function findField(
  category: string,
  developerName: string,
  field: string,
  org: string
): Promise<FieldTarget | null> {
  assertNames(field);
  const recordId = (await findConfigRecord(category, developerName, org))?.Id as string | undefined;
  if (!recordId) return null;
  const { fieldValuesByRecord, queryError } = await queryFieldValues([recordId], org);
  if (queryError) throw new Error(queryError);
  const fv = (fieldValuesByRecord.get(recordId) ?? []).find((f) => f.FieldName === field);
  if (!fv) return null;
  return {
    fieldValueId: String(fv.Id),
    dataType: String(fv.DataType),
    current: extractFieldValue(fv),
  };
}

const sameValue = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

async function previewSetConfigField(
  fix: Extract<StudioFix, { kind: "setConfigField" }>,
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { target?: FieldTarget }> {
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.recordLabel,
        field: fix.field,
        before: display(fix.from),
        after: display(fix.to),
      },
    ],
    warnings: [],
  };
  const target = await step(progress, "read", () =>
    findField(fix.category, fix.developerName, fix.field, org)
  );
  if (!target)
    return { ...preview, blocked: `${fix.recordLabel} no longer has a ${fix.field} value.` };
  // When the org no longer matches, show what it holds now so the row doesn't contradict the reason.
  const live = [{ ...preview.changes[0], before: display(target.current) }];
  if (sameValue(target.current, fix.to))
    return { ...preview, changes: live, blocked: "Already applied. Refresh the map." };
  if (!sameValue(target.current, fix.from)) {
    return {
      ...preview,
      changes: live,
      blocked: `${fix.field} changed since the map was loaded (now ${display(target.current)}). Refresh the map and try again.`,
    };
  }
  if (fix.field === "Profiles") {
    await step(progress, "reach", async () => {
      const to = splitList(fix.to);
      preview.warnings.push(...(await audienceWarnings(splitList(fix.from), to, org)));
      if (to.length === 0)
        preview.warnings.push("With no profiles listed, every profile sees this action.");
      // A misspelled profile would silently match nobody (create.ts says the same for a new record).
      const unknown = await resolveNames(
        "Profile",
        to.filter((n) => !splitList(fix.from).some((f) => f.toLowerCase() === n.toLowerCase())),
        org
      );
      if (unknown.missing.length)
        preview.warnings.push(`Not a profile in this org: ${unknown.missing.join(", ")}.`);
    });
  }
  if (MOBILE_CATEGORIES.has(fix.category)) preview.warnings.push(PUBLISH_WARNING);
  return { ...preview, target };
}

// --- Active / inactive ---------------------------------------------------------

/** Records switched on and off through the Admin Console / Tooling API (validation rules are handled in edits.ts). */
type SwitchRecord = Exclude<RecordRef, { type: "validationRule" }>;

async function findActiveTarget(
  record: SwitchRecord,
  org: string
): Promise<{ id: string; active: boolean } | null> {
  if (record.type === "config") {
    const row = await findConfigRecord(record.category, record.developerName, org);
    return row ? { id: String(row.Id), active: !!row.IsActive } : null;
  }
  assertNames(record.developerName);
  const [row] = await query(
    `SELECT Id, IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = '${record.developerName}' LIMIT 1`,
    org,
    true // Tooling-only entity — the standard API doesn't expose it.
  );
  return row ? { id: String(row.Id), active: !!row.IsActive } : null;
}

type SwitchFix = Extract<StudioFix, { kind: "setActive" }> & { record: SwitchRecord };

function activeWarnings(record: SwitchRecord, to: boolean): string[] {
  if (record.type === "triggerHandler") {
    return [
      to
        ? `Turns on ${record.label}'s managed logic for every user in the org.`
        : `Turns off ${record.label} for the whole org — the automation it runs stops for every user.`,
    ];
  }
  const warnings: string[] = [];
  if (record.category === "DbSchema" && !to)
    warnings.push("These records stop syncing to the iPad.");
  if (MOBILE_CATEGORIES.has(record.category)) warnings.push(PUBLISH_WARNING);
  return warnings;
}

async function previewSetActive(
  fix: Extract<StudioFix, { kind: "setActive" }> & { record: SwitchRecord },
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { targetId?: string }> {
  const onOff = (v: boolean) => (v ? "Active" : "Inactive");
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      { target: fix.record.label, field: "Status", before: onOff(fix.from), after: onOff(fix.to) },
    ],
    warnings: activeWarnings(fix.record, fix.to),
  };
  const target = await step(progress, "read", () => findActiveTarget(fix.record, org));
  if (!target) return { ...preview, blocked: `${fix.record.label} no longer exists.` };
  if (target.active === fix.to) {
    // Show the live state, so the row agrees with "Already active".
    return {
      ...preview,
      changes: [{ ...preview.changes[0], before: onOff(target.active) }],
      blocked: `Already ${onOff(fix.to).toLowerCase()}. Refresh the map.`,
    };
  }
  return { ...preview, targetId: target.id };
}

// --- Profile assignments -------------------------------------------------------

interface AssignmentTarget {
  recordId: string;
  /** Current profile assignments, lower-cased name → { assignment Id, name }. */
  current: Map<string, { id: string; name: string }>;
  /** Profile Ids for the names being added. */
  addIds: Map<string, string>;
  add: string[];
  remove: string[];
}

async function previewSetProfileAssignments(
  fix: Extract<StudioFix, { kind: "setProfileAssignments" }>,
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { target?: AssignmentTarget }> {
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.recordLabel,
        field: "Profiles",
        before: display(fix.from.join(";")),
        after: display(fix.to.join(";")),
      },
    ],
    warnings: [],
  };
  const record = await step(progress, "read", () =>
    findConfigRecord(fix.category, fix.developerName, org)
  );
  if (!record) return { ...preview, blocked: `${fix.recordLabel} no longer exists.` };
  const recordId = String(record.Id);

  const rows = await step(progress, "read", () =>
    query(
      `SELECT Id, AssignedToId FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId = '${recordId}' AND AssignmentLevel = 'Profile'`,
      org,
      true
    )
  );
  const ids = [...new Set(rows.map((r) => String(r.AssignedToId)))];
  const names = new Map(
    ids.length
      ? (await query(`SELECT Id, Name FROM Profile WHERE Id IN (${inList(ids)})`, org)).map((p) => [
          String(p.Id),
          String(p.Name),
        ])
      : []
  );
  const current = new Map(
    rows
      .filter((r) => names.has(String(r.AssignedToId)))
      .map((r) => {
        const name = names.get(String(r.AssignedToId))!;
        return [name.toLowerCase(), { id: String(r.Id), name }] as const;
      })
  );

  const key = (l: string[]) =>
    l
      .map((n) => n.toLowerCase())
      .sort()
      .join("|");
  const now = [...current.values()].map((c) => c.name);
  const live = [{ ...preview.changes[0], before: display(now.join(";")) }];
  if (key(now) === key(fix.to))
    return { ...preview, changes: live, blocked: "Already applied. Refresh the map." };
  if (key(now) !== key(fix.from)) {
    return {
      ...preview,
      changes: live,
      blocked: `Profile assignments changed since the map was loaded (now ${now.join(", ") || "none"}). Refresh the map and try again.`,
    };
  }

  const toLower = new Set(fix.to.map((n) => n.toLowerCase()));
  const add = fix.to.filter((n) => !current.has(n.toLowerCase()));
  const remove = [...current.values()]
    .filter((c) => !toLower.has(c.name.toLowerCase()))
    .map((c) => c.name);
  const found = add.length
    ? await query(`SELECT Id, Name FROM Profile WHERE Name IN (${inList(add)})`, org)
    : [];
  const addIds = new Map(found.map((p) => [String(p.Name).toLowerCase(), String(p.Id)]));
  const missing = add.filter((n) => !addIds.has(n.toLowerCase()));
  if (missing.length) return { ...preview, blocked: `Profile not found: ${missing.join(", ")}.` };

  preview.warnings.push(
    ...(await step(progress, "reach", () => audienceWarnings(fix.from, fix.to, org)))
  );
  if (fix.to.length === 0)
    preview.warnings.push("No profile will see this until it's assigned again.");
  if (MOBILE_CATEGORIES.has(fix.category)) preview.warnings.push(PUBLISH_WARNING);
  return { ...preview, target: { recordId, current, addIds, add, remove } };
}

/** Add then remove assignments; if a step fails, undo the steps already done so nothing is left half-applied. */
async function applyAssignments(
  target: AssignmentTarget,
  org: string,
  progress?: FixTracker
): Promise<string | null> {
  const total = target.add.length + target.remove.length;
  let done = 0;
  const count = () =>
    progress?.detail(
      "write",
      `${done} of ${total} profile ${total === 1 ? "assignment" : "assignments"}`
    );
  count();
  const created: string[] = [];
  const deleted: { name: string }[] = [];
  const rollback = async () => {
    for (const id of created) await deleteToolingRecord("LifeSciConfigAssignment", id, org);
    for (const { name } of deleted) {
      const profileId = (
        await query(`SELECT Id FROM Profile WHERE Name IN (${inList([name])})`, org)
      )[0]?.Id;
      if (profileId) {
        await createToolingRecord(
          "LifeSciConfigAssignment",
          {
            LifeSciConfigRecordId: target.recordId,
            AssignedToId: String(profileId),
            AssignmentLevel: "Profile",
          },
          org
        );
      }
    }
  };
  for (const name of target.add) {
    const res = await createToolingRecord(
      "LifeSciConfigAssignment",
      {
        LifeSciConfigRecordId: target.recordId,
        AssignedToId: target.addIds.get(name.toLowerCase())!,
        AssignmentLevel: "Profile",
      },
      org
    );
    if (!res.success || !res.data?.id) {
      await rollback();
      return `Couldn't assign ${name}: ${res.error || "unknown error"}. Nothing was changed.`;
    }
    created.push(res.data.id);
    done++;
    count();
  }
  for (const name of target.remove) {
    const res = await deleteToolingRecord(
      "LifeSciConfigAssignment",
      target.current.get(name.toLowerCase())!.id,
      org
    );
    if (!res.success) {
      await rollback();
      return `Couldn't unassign ${name}: ${res.error || "unknown error"}. Nothing was changed.`;
    }
    deleted.push({ name });
    done++;
    count();
  }
  return null;
}

// --- Public API --------------------------------------------------------------

/** `progress` is optional everywhere: with one, each step the change takes reports to it (studio_fix_progress). */
export async function previewFix(
  fix: StudioFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  return withReach(await previewByKind(fix, org, progress), fix);
}

async function previewByKind(
  fix: StudioFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  switch (fix.kind) {
    case "assignPsl":
      return previewAssignPsl(fix, org, progress);
    case "removePsl":
      return previewRemovePsl(fix, org, progress);
    case "setConfigField": {
      const { target: _target, ...preview } = await previewSetConfigField(fix, org, progress);
      return preview;
    }
    case "setActive": {
      if (isEditFix(fix)) return previewEdit(fix, org, progress);
      const { targetId: _id, ...preview } = await previewSetActive(fix as SwitchFix, org, progress);
      return preview;
    }
    case "setProfileAssignments": {
      const { target: _target, ...preview } = await previewSetProfileAssignments(
        fix,
        org,
        progress
      );
      return preview;
    }
    case "createConfigRecord": {
      const { plan: _plan, ...preview } = await previewCreate(fix, org, progress);
      return preview;
    }
    case "deleteConfigRecord": {
      const { snapshot: _snapshot, ...preview } = await previewDelete(fix, org, progress);
      return preview;
    }
    case "assignAccess":
    case "removeAccess":
      return previewAccess(fix, org, progress);
    case "setCustomScriptCode":
    case "createCustomScript":
    case "saveCustomScript":
    case "deleteCustomScript":
    case "assignCustomScript":
    case "setLayoutRelatedList":
    case "editMetadata":
    case "copyForProfile":
      return previewEdit(fix, org, progress);
  }
}

/** Applying is something the person is watching: its reads and writes go ahead of the background queue (see `urgentScope`). */
export function applyFix(fix: StudioFix, org: string, progress?: FixTracker): Promise<FixResult> {
  return urgentScope(() => applyFixNow(fix, org, progress));
}

async function applyFixNow(fix: StudioFix, org: string, progress?: FixTracker): Promise<FixResult> {
  switch (fix.kind) {
    case "assignPsl": {
      const preview = await previewAssignPsl(fix, org, progress);
      if (preview.blocked) return { ok: false, message: preview.blocked };
      const res = await step(progress, "write", () =>
        createRecord(
          "PermissionSetLicenseAssign",
          { AssigneeId: fix.userId, PermissionSetLicenseId: fix.pslId },
          org
        )
      );
      if (!res.success || !res.data?.id)
        return { ok: false, message: res.error || "Couldn't create the assignment." };
      return {
        ok: true,
        message: `Assigned ${fix.pslLabel} to ${fix.userName}.`,
        undo: {
          kind: "removePsl",
          label: `Remove ${fix.pslLabel} from ${fix.userName}`,
          assignmentId: res.data.id,
          userId: fix.userId,
          userName: fix.userName,
          pslId: fix.pslId,
          pslLabel: fix.pslLabel,
        },
      };
    }
    case "removePsl": {
      const preview = await previewRemovePsl(fix, org, progress);
      if (preview.blocked) return { ok: false, message: preview.blocked };
      const res = await step(progress, "write", () =>
        deleteRecord("PermissionSetLicenseAssign", fix.assignmentId, org)
      );
      if (!res.success)
        return { ok: false, message: res.error || "Couldn't remove the assignment." };
      return {
        ok: true,
        message: `Removed ${fix.pslLabel} from ${fix.userName}.`,
        undo: {
          kind: "assignPsl",
          label: `Assign ${fix.pslLabel} to ${fix.userName}`,
          userId: fix.userId,
          userName: fix.userName,
          pslId: fix.pslId,
          pslLabel: fix.pslLabel,
        },
      };
    }
    case "setConfigField": {
      const preview = await previewSetConfigField(fix, org, progress);
      if (preview.blocked || !preview.target)
        return { ok: false, message: preview.blocked || "Nothing to update." };
      const { fieldValueId, dataType } = preview.target;
      const res = await step(progress, "write", () =>
        updateToolingRecord(
          "LifeSciConfigFieldValue",
          fieldValueId,
          { [getValueColumn(dataType)]: fix.to },
          org
        )
      );
      if (!res.success) return { ok: false, message: res.error || "Couldn't update the field." };
      return {
        ok: true,
        message: `${fix.recordLabel}: ${fix.field} ${display(fix.from)} → ${display(fix.to)}.`,
        undo: {
          ...fix,
          label: `Restore ${fix.field} on ${fix.recordLabel}`,
          from: fix.to,
          to: fix.from,
        },
      };
    }
    case "setActive": {
      if (isEditFix(fix)) return applyEdit(fix, org, progress);
      const preview = await previewSetActive(fix as SwitchFix, org, progress);
      if (preview.blocked || !preview.targetId)
        return { ok: false, message: preview.blocked || "Nothing to update." };
      const sobject =
        fix.record.type === "config" ? "LifeSciConfigRecord" : "LifeScienceTriggerHandler";
      const targetId = preview.targetId;
      const res = await step(progress, "write", () =>
        updateToolingRecord(sobject, targetId, { IsActive: fix.to }, org)
      );
      if (!res.success) return { ok: false, message: res.error || "Couldn't update the record." };
      return {
        ok: true,
        message: `${fix.record.label} is now ${fix.to ? "active" : "inactive"}.`,
        undo: {
          ...fix,
          label: `${fix.from ? "Activate" : "Deactivate"} ${fix.record.label}`,
          from: fix.to,
          to: fix.from,
        },
      };
    }
    case "setProfileAssignments": {
      const preview = await previewSetProfileAssignments(fix, org, progress);
      if (preview.blocked || !preview.target)
        return { ok: false, message: preview.blocked || "Nothing to update." };
      const target = preview.target;
      const error = await step(progress, "write", () => applyAssignments(target, org, progress));
      if (error) return { ok: false, message: error };
      return {
        ok: true,
        message: `${fix.recordLabel} is now assigned to ${fix.to.join(", ") || "no profiles"}.`,
        undo: {
          ...fix,
          label: `Restore profiles on ${fix.recordLabel}`,
          from: fix.to,
          to: fix.from,
        },
      };
    }
    case "createConfigRecord":
      return applyCreate(fix, org, progress);
    case "deleteConfigRecord":
      return applyDelete(fix, org, progress);
    case "assignAccess":
    case "removeAccess":
      return applyAccess(fix, org, progress);
    case "setCustomScriptCode":
    case "createCustomScript":
    case "saveCustomScript":
    case "deleteCustomScript":
    case "assignCustomScript":
    case "setLayoutRelatedList":
    case "editMetadata":
    case "copyForProfile":
      return applyEdit(fix, org, progress);
  }
}
