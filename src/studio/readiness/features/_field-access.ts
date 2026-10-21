import { fieldProfiles } from "../../collectors/territory-users.js";
import { inList, plural, query, queryByIds } from "../../helpers.js";
import type { StudioCheckResult } from "../index.js";

/**
 * Whether the active users of the field profiles can read `object` through their profile or any permission
 * set they hold (PermissionSetAssignment includes the profile's own set). Shared by the Next Best, Events and
 * Medical Inquiries "field users can read" checks. Two steps: SOQL won't nest the ObjectPermissions semi-join.
 * ObjectPermissions is read only for the sets the field users hold: filtered by SobjectType alone it
 * takes seconds even in a small org, by ParentId it uses the index.
 */
export async function fieldUsersReadResult(
  org: string,
  object: string,
  label: string
): Promise<StudioCheckResult> {
  const profiles = await fieldProfiles(org);
  if (!profiles.length)
    return {
      pass: true,
      skip: true,
      detail: "No field profiles found (profiles with LSC Mobile app settings).",
    };
  const users = `SELECT Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND Profile.Name IN (${inList(profiles)})`;
  const held = query(
    `SELECT PermissionSetId FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND Assignee.Profile.Name IN (${inList(profiles)}) GROUP BY PermissionSetId`,
    org
  );
  const [totals, grants] = await Promise.all([
    query(`${users} GROUP BY Profile.Name`, org),
    held.then((rows) =>
      queryByIds(
        "ParentId",
        "ObjectPermissions",
        "ParentId",
        rows.map((r) => String(r.PermissionSetId)),
        org,
        `SobjectType = '${object}' AND PermissionsRead = true`
      )
    ),
  ]);
  const total = totals.reduce((n, r) => n + Number(r.cnt ?? 0), 0);
  if (!total) return { pass: true, skip: true, detail: "The field profiles have no active users." };
  const without = grants.length
    ? await query(
        `${users} AND Id NOT IN (SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId IN (${inList([...new Set(grants.map((g) => String(g.ParentId)))])})) GROUP BY Profile.Name`,
        org
      )
    : totals;
  const missing = without.reduce((n, r) => n + Number(r.cnt ?? 0), 0);
  if (!missing)
    return { pass: true, detail: `All ${plural(total, "active field user")} can read ${label}.` };
  return {
    pass: false,
    detail: grants.length
      ? `${missing} of ${plural(total, "active field user")} can't read ${label}.`
      : `No profile or permission set grants Read on ${label}.`,
    examples: without.map((r) => `${r.pn}: ${plural(Number(r.cnt ?? 0), "user")}`),
  };
}
