/**
 * Studio user access — give a user (or take away) a permission set, a
 * permission set group, or a territory. Read side: a user's current access and
 * what can be given, for the inspector's access panel and "Give same access as…".
 */

import { createRecord, deleteRecord } from "../salesforce/cli.js";
import { assertId } from "./change-helpers.js";
import { query, type Row } from "./helpers.js";
import type { AccessOptions, AccessRef, FixPreview, FixResult, StudioFix, UserAccess } from "./types.js";

type AccessFix = Extract<StudioFix, { kind: "assignAccess" | "removeAccess" }>;

const OPTION_LIMIT = 2000;

/** Where each kind of access is stored, and how it's described. */
const KINDS = {
  permissionSet: { sobject: "PermissionSetAssignment", user: "AssigneeId", target: "PermissionSetId", noun: "Permission sets" },
  permissionSetGroup: { sobject: "PermissionSetAssignment", user: "AssigneeId", target: "PermissionSetGroupId", noun: "Permission set groups" },
  territory: { sobject: "UserTerritory2Association", user: "UserId", target: "Territory2Id", noun: "Territories" },
} as const;

function rel(r: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], r);
}

// --- Read ------------------------------------------------------------------------

export async function userAccess(userId: string, org: string): Promise<UserAccess> {
  assertId(userId);
  const [licenses, assignments, territories] = await Promise.all([
    query(
      `SELECT Id, PermissionSetLicenseId, PermissionSetLicense.MasterLabel FROM PermissionSetLicenseAssign WHERE AssigneeId = '${userId}'`,
      org
    ),
    query(
      `SELECT Id, PermissionSetId, PermissionSet.Label, PermissionSetGroupId, PermissionSetGroup.MasterLabel FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSet.IsOwnedByProfile = false`,
      org
    ),
    query(`SELECT Id, Territory2Id, Territory2.Name FROM UserTerritory2Association WHERE UserId = '${userId}'`, org),
  ]);
  return {
    userId,
    licenses: licenses.map((r) => ({
      assignmentId: String(r.Id),
      pslId: String(r.PermissionSetLicenseId),
      label: String(rel(r, "PermissionSetLicense.MasterLabel")),
    })),
    access: [
      // A group assignment shows up against the group's aggregate permission set — report the group.
      ...assignments.map((r) =>
        r.PermissionSetGroupId
          ? { type: "permissionSetGroup" as const, id: String(r.PermissionSetGroupId), label: String(rel(r, "PermissionSetGroup.MasterLabel")), assignmentId: String(r.Id) }
          : { type: "permissionSet" as const, id: String(r.PermissionSetId), label: String(rel(r, "PermissionSet.Label")), assignmentId: String(r.Id) }
      ),
      ...territories.map((r) => ({
        type: "territory" as const,
        id: String(r.Territory2Id),
        label: String(rel(r, "Territory2.Name")),
        assignmentId: String(r.Id),
      })),
    ],
  };
}

export async function accessOptions(org: string): Promise<AccessOptions> {
  const [sets, groups, territories] = await Promise.all([
    // Session-based sets need activation in a session; group-owned sets are assigned through their group.
    query(
      `SELECT Id, Label FROM PermissionSet WHERE IsOwnedByProfile = false AND PermissionSetGroupId = null AND Type IN ('Regular', 'Standard') ORDER BY Label LIMIT ${OPTION_LIMIT}`,
      org
    ),
    query(`SELECT Id, MasterLabel FROM PermissionSetGroup ORDER BY MasterLabel LIMIT ${OPTION_LIMIT}`, org),
    query(
      `SELECT Id, Name, Territory2Model.Name, Territory2Model.State FROM Territory2 ORDER BY Name LIMIT ${OPTION_LIMIT}`,
      org
    ),
  ]);
  return {
    permissionSets: sets.map((r) => ({ type: "permissionSet", id: String(r.Id), label: String(r.Label) })),
    permissionSetGroups: groups.map((r) => ({ type: "permissionSetGroup", id: String(r.Id), label: String(r.MasterLabel) })),
    territories: territories.map((r) => ({
      type: "territory",
      id: String(r.Id),
      label: String(r.Name),
      model: String(rel(r, "Territory2Model.Name") ?? ""),
      planning: rel(r, "Territory2Model.State") !== "Active",
    })),
  };
}

// --- Change --------------------------------------------------------------------

/** The thing being given still exists; for territories, whether its model is live. */
async function findTarget(access: AccessRef, org: string): Promise<{ planning?: string } | null> {
  switch (access.type) {
    case "permissionSet":
      return (await query(`SELECT Id FROM PermissionSet WHERE Id = '${access.id}'`, org))[0] ? {} : null;
    case "permissionSetGroup":
      return (await query(`SELECT Id FROM PermissionSetGroup WHERE Id = '${access.id}'`, org))[0] ? {} : null;
    case "territory": {
      const [t] = await query(`SELECT Id, Territory2Model.Name, Territory2Model.State FROM Territory2 WHERE Id = '${access.id}'`, org);
      if (!t) return null;
      return rel(t, "Territory2Model.State") === "Active" ? {} : { planning: String(rel(t, "Territory2Model.Name")) };
    }
  }
}

async function findAssignment(userId: string, access: AccessRef, org: string): Promise<string | null> {
  const k = KINDS[access.type];
  const [row] = await query(`SELECT Id FROM ${k.sobject} WHERE ${k.user} = '${userId}' AND ${k.target} = '${access.id}'`, org);
  return row ? String(row.Id) : null;
}

export async function previewAccess(fix: AccessFix, org: string): Promise<FixPreview> {
  assertId(fix.userId);
  assertId(fix.access.id);
  const adding = fix.kind === "assignAccess";
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.userName,
        field: KINDS[fix.access.type].noun,
        before: adding ? "—" : fix.access.label,
        after: `${adding ? "+" : "−"} ${fix.access.label}`,
      },
    ],
    warnings: [],
  };
  const block = (blocked: string) => ({ ...preview, blocked });

  if (adding) {
    const [user] = await query(`SELECT Id, IsActive FROM User WHERE Id = '${fix.userId}'`, org);
    if (!user) return block("The user no longer exists.");
    if (!user.IsActive) return block("The user is inactive.");
    if (await findAssignment(fix.userId, fix.access, org)) return block(`${fix.userName} already has ${fix.access.label}. Refresh the map.`);
    const target = await findTarget(fix.access, org);
    if (!target) return block(`${fix.access.label} no longer exists.`);
    if (fix.access.type === "territory") {
      preview.warnings.push(
        target.planning
          ? `${fix.access.label} is in ${target.planning}, which isn't the active territory model — the user gets its accounts only once that model is activated.`
          : "The user gets the territory's aligned accounts on their next sync."
      );
    } else {
      preview.warnings.push("Salesforce refuses this if the user is missing a license the permission set needs.");
    }
    return preview;
  }

  assertId((fix as Extract<AccessFix, { kind: "removeAccess" }>).assignmentId);
  const current = await findAssignment(fix.userId, fix.access, org);
  if (!current) return block(`${fix.userName} no longer has ${fix.access.label}. Refresh the map.`);
  preview.warnings.push(
    fix.access.type === "territory"
      ? "The user loses the territory's accounts on their next sync."
      : `${fix.userName} loses whatever ${fix.access.label} grants straight away.`
  );
  return preview;
}

export async function applyAccess(fix: AccessFix, org: string): Promise<FixResult> {
  const preview = await previewAccess(fix, org);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  const k = KINDS[fix.access.type];

  if (fix.kind === "assignAccess") {
    const res = await createRecord(k.sobject, { [k.user]: fix.userId, [k.target]: fix.access.id }, org);
    if (!res.success || !res.data?.id) return { ok: false, message: res.error || `Couldn't give ${fix.access.label} to ${fix.userName}.` };
    return {
      ok: true,
      message: `Gave ${fix.access.label} to ${fix.userName}.`,
      undo: {
        kind: "removeAccess",
        label: `Remove ${fix.access.label} from ${fix.userName}`,
        userId: fix.userId,
        userName: fix.userName,
        access: fix.access,
        assignmentId: res.data.id,
      },
    };
  }

  // Delete what's there now — the assignment may have been recreated since the map was loaded.
  const assignmentId = (await findAssignment(fix.userId, fix.access, org))!;
  const res = await deleteRecord(k.sobject, assignmentId, org);
  if (!res.success) return { ok: false, message: res.error || `Couldn't remove ${fix.access.label} from ${fix.userName}.` };
  return {
    ok: true,
    message: `Removed ${fix.access.label} from ${fix.userName}.`,
    undo: {
      kind: "assignAccess",
      label: `Give ${fix.access.label} to ${fix.userName}`,
      userId: fix.userId,
      userName: fix.userName,
      access: fix.access,
    },
  };
}
