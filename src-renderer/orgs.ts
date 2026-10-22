/** Renderer copies of the org types in src-electron/orgs.ts, and how the UI shows an org. */

export type OrgKind = "production" | "sandbox" | "scratch" | "developer" | "trial";

/** `admin`: holds LifeSciencesCommercialAdmin. `user`: an LSC org, not an admin. `other`: no LSC. */
export type OrgRole = "admin" | "user" | "other";

export interface SfOrg {
  alias?: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isDefault?: boolean;
  kind: OrgKind;
  /** False when the sf CLI can't refresh the login. */
  connected: boolean;
  status?: string;
  /** Unset until the connection has been checked. */
  role?: OrgRole;
}

/** The org a session or saved item belongs to, as recorded when it was tied to it. */
export interface OrgRef {
  username: string;
  label: string;
  orgId?: string;
  instanceUrl?: string;
}

/** The value Settings stores for an org (`sfTargetOrg`). */
export const orgKey = (o: { alias?: string; username: string }) => o.alias || o.username;

export const matchesOrg = (o: { alias?: string; username: string }, key: string) =>
  o.alias?.toLowerCase() === key.toLowerCase() || o.username.toLowerCase() === key.toLowerCase();

export const sameUsername = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const toOrgRef = (o: SfOrg): OrgRef => ({
  username: o.username,
  label: orgKey(o),
  orgId: o.orgId || undefined,
  instanceUrl: o.instanceUrl || undefined,
});

export const KIND_LABEL: Record<OrgKind, string> = {
  production: "Production",
  sandbox: "Sandbox",
  scratch: "Scratch",
  developer: "Developer",
  trial: "Trial",
};

/** Production is the one kind that gets a tone: changes there reach real users. */
export const kindTone = (kind: OrgKind) => (kind === "production" ? "warning" : "neutral");

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Up to two letters for an org's avatar: "chiesi-794" → "C7", "Pfizer FDE" → "PF". */
export function orgMonogram(label: string): string {
  const name = label.split("@")[0];
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** The label to show for a recorded org: the connection's current alias if it's still there. */
export function orgLabel(ref: OrgRef, orgs: SfOrg[]): string {
  const live = orgs.find((o) => sameUsername(o.username, ref.username));
  return live ? orgKey(live) : ref.label;
}

/** A session's org as the composer shows it. */
export interface SessionOrgView {
  ref: OrgRef;
  label: string;
  kind?: OrgKind;
  /** `expired`: the sf CLI can't refresh the login; `missing`: the connection is gone from `sf org list`. */
  state: "ok" | "expired" | "missing";
  /** The alias to log in again with, so the new login replaces the old one. */
  loginAlias?: string;
}

export function sessionOrgView(ref: OrgRef, orgs: SfOrg[], loading: boolean): SessionOrgView {
  const live = orgs.find((o) => sameUsername(o.username, ref.username) || matchesOrg(o, ref.username));
  if (live) {
    return { ref, label: orgKey(live), kind: live.kind, state: live.connected ? "ok" : "expired", loginAlias: live.alias };
  }
  // A label that isn't the username is the alias the connection had.
  const alias = ref.label && !sameUsername(ref.label, ref.username) ? ref.label : undefined;
  return { ref, label: ref.label, state: loading ? "ok" : "missing", loginAlias: alias };
}

/** Another org's sessions, for the sidebar's empty state: where to switch to find them. */
export interface OrgSessions {
  /** What `select` takes: the connection's alias, else its username. */
  key: string;
  count: number;
}

/**
 * Sessions tied to orgs other than `current`, grouped by org, most sessions first (then most recent).
 * `total` counts them all; `orgs` lists only connections still in `sf org list`, so each can be switched to.
 */
export function sessionsElsewhere(
  sessions: Array<{ org: OrgRef | null; updatedAt: string }>,
  current: string | undefined,
  orgs: SfOrg[]
): { total: number; orgs: OrgSessions[] } {
  let total = 0;
  const byOrg = new Map<string, { key: string; count: number; latest: string }>();
  for (const s of sessions) {
    if (!s.org || sameUsername(s.org.username, current)) continue;
    total++;
    const live = orgs.find((o) => sameUsername(o.username, s.org!.username));
    if (!live) continue;
    const id = live.username.toLowerCase();
    const entry = byOrg.get(id) ?? { key: orgKey(live), count: 0, latest: "" };
    entry.count++;
    if (s.updatedAt > entry.latest) entry.latest = s.updatedAt;
    byOrg.set(id, entry);
  }
  const ranked = [...byOrg.values()].sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
  return { total, orgs: ranked.map(({ key, count }) => ({ key, count })) };
}
