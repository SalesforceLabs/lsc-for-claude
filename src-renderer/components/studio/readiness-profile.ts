/** The profiles readiness can be shown for: those with LSC users, iPad profiles first (`studio_scope`). */

export interface ReadinessProfile {
  name: string;
  users: number;
  group: "ipad" | "web" | "admin" | "out";
}

/** iPad profiles, then web-only ones, each by users; admins and profiles without LSC aren't offered. */
export function pickerProfiles(all: ReadinessProfile[]): ReadinessProfile[] {
  const rank = (p: ReadinessProfile) => (p.group === "ipad" ? 0 : 1);
  return all
    .filter((p) => p.group === "ipad" || p.group === "web")
    .sort((a, b) => rank(a) - rank(b) || b.users - a.users || a.name.localeCompare(b.name));
}

export function profileLabel(p: ReadinessProfile): string {
  return `${p.name} · ${p.users} ${p.users === 1 ? "user" : "users"}${p.group === "web" ? " (web only)" : ""}`;
}
