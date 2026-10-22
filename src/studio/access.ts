/**
 * Studio user access — give a user (or take away) a permission set, a
 * permission set group, or a territory. Read side: a user's current access and
 * what can be given, for the inspector's access panel and "Give same access as…".
 */

import { step, type FixTracker } from "./fix-progress.js";
import { createRecord, deleteRecord } from "../salesforce/cli.js";
import { assertId } from "./change-helpers.js";
import { count, query, type Row } from "./helpers.js";
import type {
  AccessOptions,
  AccessRef,
  FixPreview,
  FixResult,
  StudioFix,
  UserAccess,
} from "./types.js";

type AccessFix = Extract<StudioFix, { kind: "assignAccess" | "removeAccess" }>;

const OPTION_LIMIT = 2000;

/** Where each kind of access is stored, and how it's described. */
const KINDS = {
  permissionSet: {
    sobject: "PermissionSetAssignment",
    user: "AssigneeId",
    target: "PermissionSetId",
    noun: "Permission sets",
  },
  permissionSetGroup: {
    sobject: "PermissionSetAssignment",
    user: "AssigneeId",
    target: "PermissionSetGroupId",
    noun: "Permission set groups",
  },
  territory: {
    sobject: "UserTerritory2Association",
    user: "UserId",
    target: "Territory2Id",
    noun: "Territories",
  },
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
    query(
      `SELECT Id, Territory2Id, Territory2.Name FROM UserTerritory2Association WHERE UserId = '${userId}'`,
      org
    ),
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
          ? {
              type: "permissionSetGroup" as const,
              id: String(r.PermissionSetGroupId),
              label: String(rel(r, "PermissionSetGroup.MasterLabel")),
              assignmentId: String(r.Id),
            }
          : {
              type: "permissionSet" as const,
              id: String(r.PermissionSetId),
              label: String(rel(r, "PermissionSet.Label")),
              assignmentId: String(r.Id),
            }
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

/** Options for one kind that were cut off: how many are listed and how many match. */
export interface OptionsCutOff {
  listed: number;
  total: number;
}

/** `AccessOptions`, plus which lists were cut at the limit (absent when nothing was). */
export type AccessOptionsResult = AccessOptions & {
  truncated?: Partial<
    Record<"permissionSets" | "permissionSetGroups" | "territories", OptionsCutOff>
  >;
};

/** A `LIKE` pattern matching `term` anywhere, with its wildcards and quotes escaped. */
const likeTerm = (term: string) => `'%${term.replace(/[\\'%_]/g, (c) => `\\${c}`)}%'`;

/**
 * What can be given to a user. `search` filters by name on the server so a big
 * org's list can be narrowed past the first 2,000; a list still cut off says so
 * in `truncated`, with the true number of matches.
 */
export async function accessOptions(org: string, search?: string): Promise<AccessOptionsResult> {
  const term = search?.trim();
  const and = (field: string) => (term ? ` AND ${field} LIKE ${likeTerm(term)}` : "");
  // Session-based sets need activation in a session; group-owned sets are assigned through their group.
  const setWhere = `IsOwnedByProfile = false AND PermissionSetGroupId = null AND Type IN ('Regular', 'Standard')${and("Label")}`;
  const groupWhere = term ? `WHERE MasterLabel LIKE ${likeTerm(term)}` : "";
  const terrWhere = term ? `WHERE Name LIKE ${likeTerm(term)}` : "";
  const [sets, groups, territories] = await Promise.all([
    query(
      `SELECT Id, Label FROM PermissionSet WHERE ${setWhere} ORDER BY Label LIMIT ${OPTION_LIMIT + 1}`,
      org
    ),
    query(
      `SELECT Id, MasterLabel FROM PermissionSetGroup ${groupWhere} ORDER BY MasterLabel LIMIT ${OPTION_LIMIT + 1}`,
      org
    ),
    query(
      `SELECT Id, Name, Territory2Model.Name, Territory2Model.State FROM Territory2 ${terrWhere} ORDER BY Name LIMIT ${OPTION_LIMIT + 1}`,
      org
    ),
  ]);
  const truncated: NonNullable<AccessOptionsResult["truncated"]> = {};
  const cut = async (key: keyof typeof truncated, rows: Row[], totalQuery: string) => {
    if (rows.length <= OPTION_LIMIT) return rows;
    truncated[key] = {
      listed: OPTION_LIMIT,
      total: await count(totalQuery, org).catch(() => rows.length),
    };
    return rows.slice(0, OPTION_LIMIT);
  };
  const [setRows, groupRows, territoryRows] = await Promise.all([
    cut("permissionSets", sets, `SELECT COUNT() FROM PermissionSet WHERE ${setWhere}`),
    cut("permissionSetGroups", groups, `SELECT COUNT() FROM PermissionSetGroup ${groupWhere}`),
    cut("territories", territories, `SELECT COUNT() FROM Territory2 ${terrWhere}`),
  ]);
  return {
    permissionSets: setRows.map((r) => ({
      type: "permissionSet",
      id: String(r.Id),
      label: String(r.Label),
    })),
    permissionSetGroups: groupRows.map((r) => ({
      type: "permissionSetGroup",
      id: String(r.Id),
      label: String(r.MasterLabel),
    })),
    territories: territoryRows.map((r) => ({
      type: "territory",
      id: String(r.Id),
      label: String(r.Name),
      model: String(rel(r, "Territory2Model.Name") ?? ""),
      planning: rel(r, "Territory2Model.State") !== "Active",
    })),
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };
}

// --- Change --------------------------------------------------------------------

/** The thing being given still exists; for territories, whether its model is live. */
async function findTarget(access: AccessRef, org: string): Promise<{ planning?: string } | null> {
  switch (access.type) {
    case "permissionSet":
      return (await query(`SELECT Id FROM PermissionSet WHERE Id = '${access.id}'`, org))[0]
        ? {}
        : null;
    case "permissionSetGroup":
      return (await query(`SELECT Id FROM PermissionSetGroup WHERE Id = '${access.id}'`, org))[0]
        ? {}
        : null;
    case "territory": {
      const [t] = await query(
        `SELECT Id, Territory2Model.Name, Territory2Model.State FROM Territory2 WHERE Id = '${access.id}'`,
        org
      );
      if (!t) return null;
      return rel(t, "Territory2Model.State") === "Active"
        ? {}
        : { planning: String(rel(t, "Territory2Model.Name")) };
    }
  }
}

async function findAssignment(
  userId: string,
  access: AccessRef,
  org: string
): Promise<string | null> {
  const k = KINDS[access.type];
  const [row] = await query(
    `SELECT Id FROM ${k.sobject} WHERE ${k.user} = '${userId}' AND ${k.target} = '${access.id}'`,
    org
  );
  return row ? String(row.Id) : null;
}

export async function previewAccess(
  fix: AccessFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview> {
  return step(progress, "read", () => previewAccessNow(fix, org));
}

async function previewAccessNow(fix: AccessFix, org: string): Promise<FixPreview> {
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
    if (await findAssignment(fix.userId, fix.access, org))
      return block(`${fix.userName} already has ${fix.access.label}. Refresh the map.`);
    const target = await findTarget(fix.access, org);
    if (!target) return block(`${fix.access.label} no longer exists.`);
    if (fix.access.type === "territory") {
      preview.warnings.push(
        target.planning
          ? `${fix.access.label} is in ${target.planning}, which isn't the active territory model — the user gets its accounts only once that model is activated.`
          : "The user gets the territory's aligned accounts on their next sync."
      );
    } else {
      preview.warnings.push(
        "Salesforce refuses this if the user is missing a license the permission set needs."
      );
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

export async function applyAccess(
  fix: AccessFix,
  org: string,
  progress?: FixTracker
): Promise<FixResult> {
  const preview = await previewAccess(fix, org, progress);
  if (preview.blocked) return { ok: false, message: preview.blocked };
  const k = KINDS[fix.access.type];

  if (fix.kind === "assignAccess") {
    const res = await step(progress, "write", () =>
      createRecord(k.sobject, { [k.user]: fix.userId, [k.target]: fix.access.id }, org)
    );
    if (!res.success || !res.data?.id)
      return {
        ok: false,
        message: res.error || `Couldn't give ${fix.access.label} to ${fix.userName}.`,
      };
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
  const res = await step(progress, "write", async () => {
    const assignmentId = (await findAssignment(fix.userId, fix.access, org))!;
    return deleteRecord(k.sobject, assignmentId, org);
  });
  if (!res.success)
    return {
      ok: false,
      message: res.error || `Couldn't remove ${fix.access.label} from ${fix.userName}.`,
    };
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
