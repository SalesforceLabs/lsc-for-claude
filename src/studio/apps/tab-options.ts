/** Who can be given a nav tab app and which apps can hold it, for the Deploy dialog. */

import { query } from "../helpers.js";

export interface TabProfileOption {
  /** The profile's name as users know it. */
  label: string;
  /** The metadata name `tab.profiles` takes (standard profiles differ from their label: "System Administrator" is "Admin"). */
  name: string;
  activeUsers: number;
  /** Active users on it who hold an LSC permission set. */
  lscUsers: number;
}

export interface TabOptions {
  profiles: TabProfileOption[];
  apps: { fullName: string; label: string }[];
}

/** Standard profiles whose metadata name isn't their label. */
const STANDARD_PROFILE_NAMES: Record<string, string> = {
  "System Administrator": "Admin",
  "Standard User": "Standard",
  "Read Only": "ReadOnly",
  "Marketing User": "MarketingProfile",
  "Contract Manager": "ContractManager",
  "Solution Manager": "SolutionManager",
  "Standard Platform User": "StandardAul",
};

export const profileMetadataName = (label: string) => STANDARD_PROFILE_NAMES[label] ?? label;

const count = (r: Record<string, unknown>) => Number(r.cnt ?? r.expr0 ?? 0);

/** Profiles with active users (those with LSC permission sets first, then by size) and the org's own Lightning apps (standard apps can't be edited). */
export async function tabOptions(org: string): Promise<TabOptions> {
  const [all, lsc, apps] = await Promise.all([
    query(
      `SELECT Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY Profile.Name`,
      org
    ),
    query(
      `SELECT Assignee.Profile.Name pn, COUNT_DISTINCT(AssigneeId) cnt FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSet.Name LIKE 'LifeSciences%' GROUP BY Assignee.Profile.Name`,
      org
    ).catch(() => []),
    query(
      `SELECT DeveloperName, NamespacePrefix, Label FROM AppDefinition ORDER BY Label`,
      org
    ).catch(() => []),
  ]);
  const lscBy = new Map(lsc.filter((r) => r.pn).map((r) => [String(r.pn), count(r)]));
  const profiles = all
    .filter((r) => r.pn)
    .map(
      (r): TabProfileOption => ({
        label: String(r.pn),
        name: profileMetadataName(String(r.pn)),
        activeUsers: count(r),
        lscUsers: lscBy.get(String(r.pn)) ?? 0,
      })
    )
    .sort(
      (a, b) =>
        b.lscUsers - a.lscUsers || b.activeUsers - a.activeUsers || a.label.localeCompare(b.label)
    );
  return {
    profiles,
    apps: apps
      .filter((a) => a.DeveloperName && a.NamespacePrefix !== "standard")
      .map((a) => ({
        fullName: a.NamespacePrefix
          ? `${a.NamespacePrefix}__${a.DeveloperName}`
          : String(a.DeveloperName),
        label: String(a.Label ?? a.DeveloperName),
      })),
  };
}
