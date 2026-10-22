import { execFile } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Which sf CLI connections are LSC admins. Only an admin's connection makes sense as the app's
 * workspace — Studio's writes, Admin Console tools and the metadata cache need it — while rep
 * logins (added for First sync, say) and orgs without LSC just crowd the org menu.
 *
 * Each connection is checked as itself: one query for the standard `LifeSciencesCommercialAdmin`
 * permission set and whether its user is assigned it. Customers clone that permission set, but a
 * clone can't be told from any other custom set, so only the standard one counts.
 */

/** `admin`: holds the LSC admin permission set. `user`: an LSC org, but not an admin. `other`: no LSC. */
export type OrgRole = "admin" | "user" | "other";

export const ADMIN_PERMISSION_SET = "LifeSciencesCommercialAdmin";

/** A connection's role is checked again after this long, or when the org menu is refreshed. */
const ROLE_TTL_MS = 24 * 60 * 60_000;
/** sf spawns at once; each takes a few seconds. */
const CONCURRENCY = 3;

const soqlString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function roleQuery(username: string): string {
  return (
    `SELECT Id, (SELECT Id FROM Assignments WHERE Assignee.Username = ${soqlString(username)}) ` +
    `FROM PermissionSet WHERE Name = '${ADMIN_PERMISSION_SET}'`
  );
}

/** The role in `sf data query --json` output for `roleQuery`, or undefined if the query failed. */
export function parseRoleResult(stdout: string): OrgRole | undefined {
  const start = stdout.indexOf("{");
  if (start < 0) return undefined;
  let data;
  try {
    data = JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
  if (data?.status !== 0 || !Array.isArray(data?.result?.records)) return undefined;
  const records: Array<{ Assignments?: { totalSize?: number } | null }> = data.result.records;
  // No such permission set: LSC isn't in this org.
  if (!records.length) return "other";
  return records.some((r) => (r.Assignments?.totalSize ?? 0) > 0) ? "admin" : "user";
}

type RoleEntry = { role: OrgRole; checkedAt: number };

export class OrgRoles {
  private entries: Record<string, RoleEntry> = {};
  private checking = new Set<string>();
  private queue: string[] = [];
  private active = 0;

  constructor(
    private file: string,
    private onChange: (roles: Record<string, OrgRole>) => void,
    private runCheck: (username: string) => Promise<OrgRole | undefined> = checkRole
  ) {
    try {
      this.entries = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      // No roles checked yet.
    }
  }

  /** Every known role, by lowercased username. */
  all(): Record<string, OrgRole> {
    return Object.fromEntries(Object.entries(this.entries).map(([u, e]) => [u, e.role]));
  }

  get(username: string): OrgRole | undefined {
    return this.entries[username.toLowerCase()]?.role;
  }

  /**
   * Check the connections that have no role yet, or an old one (all of them with `force`), in the
   * background; `onChange` gets the roles as checks finish. Logged-out connections can't be
   * queried, so they keep what they had.
   */
  check(connections: Array<{ username: string; connected: boolean }>, options: { force?: boolean } = {}): void {
    const now = Date.now();
    for (const c of connections) {
      const key = c.username.toLowerCase();
      const entry = this.entries[key];
      if (!c.connected || this.checking.has(key)) continue;
      if (!options.force && entry && now - entry.checkedAt < ROLE_TTL_MS) continue;
      this.checking.add(key);
      this.queue.push(c.username);
    }
    this.pump();
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length) {
      const username = this.queue.shift()!;
      this.active++;
      this.runCheck(username)
        .catch(() => undefined)
        .then((role) => {
          const key = username.toLowerCase();
          this.checking.delete(key);
          this.active--;
          // A failed check keeps the last answer; it's tried again on the next listing.
          if (role) {
            const changed = this.entries[key]?.role !== role;
            this.entries[key] = { role, checkedAt: Date.now() };
            this.save();
            if (changed) this.onChange(this.all());
          }
          this.pump();
        });
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
    } catch {
      // Roles are only a cache; they're checked again next time.
    }
  }
}

function checkRole(username: string): Promise<OrgRole | undefined> {
  return new Promise((resolve) => {
    execFile(
      "sf",
      ["data", "query", "--target-org", username, "--query", roleQuery(username), "--json"],
      { timeout: 30_000 },
      (_error, stdout) => resolve(parseRoleResult(stdout ?? ""))
    );
  });
}
