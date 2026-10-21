import { execFile } from "child_process";
import type { OrgRole } from "./org-roles.js";

/**
 * The sf CLI connections the app can work in. A connection is a username on an org;
 * several aliases can point at the same org, so sessions and saved items are tied to
 * the connection's username, which is what every sf command runs as.
 */

/** What kind of org a connection is on, so the UI can mark the ones that need care. */
export type OrgKind = "production" | "sandbox" | "scratch" | "developer" | "trial";

export interface SfOrg {
  alias?: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isDefault?: boolean;
  kind: OrgKind;
  /** False when the sf CLI can't refresh the login (expired, org deleted, domain gone). */
  connected: boolean;
  /** The sf CLI's connection status when it isn't "Connected". */
  status?: string;
  /** Whether it's an LSC admin, once checked (`org-roles.ts`). */
  role?: OrgRole;
}

/** The org a session or saved item belongs to, as recorded when it was tied to it. */
export interface OrgRef {
  username: string;
  /** The alias (or username) the connection had then, shown if the connection is gone. */
  label: string;
  orgId?: string;
  instanceUrl?: string;
}

/** The value Settings stores for an org (`sfTargetOrg`) and the MCP server is targeted with. */
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

/**
 * Classify an org from its sf CLI flags and My Domain host. Trial and Developer Edition
 * orgs report `isSandbox: false`, so the host is what tells them apart from production.
 */
export function orgKind(o: { instanceUrl?: string; isSandbox?: boolean; isScratch?: boolean }): OrgKind {
  let host = "";
  try {
    host = new URL(o.instanceUrl ?? "").host.toLowerCase();
  } catch {
    // No usable URL: fall back to the flags.
  }
  if (o.isScratch || host.includes(".scratch.")) return "scratch";
  if (o.isSandbox || host.includes(".sandbox.") || /--[a-z0-9]+\.(sandbox\.)?my\./.test(host)) return "sandbox";
  if (host.includes(".develop.") || host.includes("-dev-ed.")) return "developer";
  if (host.startsWith("trailsignup-") || host.includes(".trailblaze.")) return "trial";
  return "production";
}

/** Parse `sf org list --json` into one entry per username. */
export function parseOrgList(stdout: string): SfOrg[] {
  const data = JSON.parse(stdout);
  const orgs: SfOrg[] = [];
  const seen = new Set<string>();
  for (const category of ["nonScratchOrgs", "scratchOrgs", "sandboxes", "devHubs", "other"]) {
    const list = data?.result?.[category];
    if (!Array.isArray(list)) continue;
    for (const o of list) {
      const username = o.username || o.userName;
      if (!username || seen.has(username.toLowerCase())) continue;
      seen.add(username.toLowerCase());
      // Scratch orgs report `status` ("Active") rather than `connectedStatus`.
      const status: string | undefined = o.connectedStatus;
      const connected = !status || status === "Connected" || status === "Unknown";
      orgs.push({
        alias: o.alias || undefined,
        username,
        orgId: o.orgId || "",
        instanceUrl: o.instanceUrl || "",
        isDefault: o.isDefaultUsername || o.isDefaultDevHub || false,
        kind: orgKind({ instanceUrl: o.instanceUrl, isSandbox: o.isSandbox, isScratch: o.isScratch }),
        connected,
        status: connected ? undefined : firstLine(status),
      });
    }
  }
  return orgs;
}

function firstLine(text?: string): string | undefined {
  return text?.split("\n")[0].trim() || undefined;
}

const LIST_TTL_MS = 20_000;
type OrgList = { orgs: SfOrg[]; error?: string };
/** The last listing that worked, and when. */
let cached: { at: number; list: OrgList } | undefined;
let running: Promise<OrgList> | undefined;

/**
 * The sf CLI's connections, cached briefly — resolving a session's org shouldn't spawn sf every
 * time. Once the cache is old, callers get it at once while sf runs again in the background
 * (`sf org list` takes seconds, and every session list, search and Library lookup asks);
 * `fresh` waits for a new listing. Before the first full listing there's no cache, so callers
 * get a quick one without connection status while the full one runs (`pendingOrgList`).
 */
export function listSfOrgs(options: { fresh?: boolean } = {}): Promise<OrgList> {
  if (!options.fresh && cached && Date.now() - cached.at < LIST_TTL_MS) return Promise.resolve(cached.list);
  const listing = running ?? runOrgList();
  if (options.fresh) return listing;
  return cached ? Promise.resolve(cached.list) : quickOrgList();
}

/** The full listing in progress, if any — for telling the renderer when it lands. */
export function pendingOrgList(): Promise<OrgList> | undefined {
  return running;
}

/** One listing in flight at a time; only one that worked is kept. */
function spawnOrgList(args: string[]): Promise<OrgList> {
  return new Promise<OrgList>((resolve) => {
    execFile("sf", ["org", "list", "--json", ...args], { timeout: 15000 }, (error, stdout) => {
      if (error && !stdout) {
        resolve({ orgs: [], error: error.message });
        return;
      }
      try {
        resolve({ orgs: parseOrgList(stdout) });
      } catch {
        resolve({ orgs: [], error: "Failed to parse sf org list output" });
      }
    });
  });
}

function runOrgList(): Promise<OrgList> {
  const promise = spawnOrgList([]);
  running = promise;
  promise.then((list) => {
    if (running === promise) running = undefined;
    // A failed listing isn't kept, so the next call tries again.
    if (!list.error) cached = { at: Date.now(), list };
  });
  return promise;
}

let quick: Promise<OrgList> | undefined;

/**
 * The connections without checking each login, which is what makes `sf org list` slow (about 9 s
 * with a dozen orgs, under 1 s without): every connection reads as connected until the full
 * listing says otherwise. Run once, at startup.
 */
function quickOrgList(): Promise<OrgList> {
  if (!quick) {
    const promise = spawnOrgList(["--skip-connection-status"]);
    quick = promise;
    promise.then((list) => {
      if (list.error && quick === promise) quick = undefined;
    });
  }
  return quick;
}

/**
 * The connection `key` (an alias or username) names; with no key, the one the tools
 * fall back to — the sf CLI default, or the only connection there is.
 */
/** 15- and 18-character org Ids of the same org compare equal. */
export function sameOrgId(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.slice(0, 15) === b.slice(0, 15);
}

export function pickOrg(orgs: SfOrg[], key?: string): SfOrg | undefined {
  if (key) return orgs.find((o) => matchesOrg(o, key));
  return orgs.find((o) => o.isDefault) ?? (orgs.length === 1 ? orgs[0] : undefined);
}

export async function resolveOrg(key?: string): Promise<SfOrg | undefined> {
  return pickOrg((await listSfOrgs()).orgs, key);
}

/**
 * Why `sf org login web` shouldn't start with these, or null. The login page is the user's to choose
 * (My Domain and custom login hosts included) but must be https, and an alias can't be read as a flag.
 */
export function loginArgsProblem(alias: unknown, instanceUrl: unknown): string | null {
  if (alias !== undefined && alias !== "" && (typeof alias !== "string" || !/^[^\s\p{Cc}-][^\s\p{Cc}]{0,254}$/u.test(alias))) {
    return "An alias can't contain spaces or start with a dash.";
  }
  if (instanceUrl === undefined || instanceUrl === "") return null;
  if (typeof instanceUrl !== "string") return "The login URL isn't a URL.";
  try {
    const u = new URL(instanceUrl);
    if (u.protocol !== "https:" || u.username || u.password) return "Use an https:// login URL.";
  } catch {
    return "The login URL isn't a URL.";
  }
  return null;
}
