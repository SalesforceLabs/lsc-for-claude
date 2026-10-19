/**
 * The Salesforce API version, per org. Every call that names a version asks here
 * (through `orgApiVersion` / `dataPath` in cli.ts, or the direct path's credentials):
 * the version pinned for the org's instance, else the newest the org serves (what
 * the sf CLI reports), else FALLBACK_API_VERSION.
 *
 * Pins are keyed by instance host, so every alias of a connection and every
 * test-user login on the same org use the same version. A test-user login has no
 * sf CLI to report the org's newest version, so the one its instance last
 * reported through the CLI is used.
 *
 * The Electron app keeps the user's choice per org and pins it on the org's MCP
 * server when it starts and whenever it changes (`studio_set_api_version`).
 */

/** Used only when the org's own version can't be read. */
export const FALLBACK_API_VERSION = "67.0";

const pins = new Map<string, string>();
const reportedByHost = new Map<string, string>();

function hostOf(instanceUrl: string): string | null {
  try {
    return new URL(instanceUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

/** "68", "v68.0" or "68.0" → "68.0"; anything else → null. */
export function normalizeVersion(v: string | undefined | null): string | null {
  if (!v) return null;
  const bare = v.trim().replace(/^v/i, "");
  if (!/^\d{2}(\.0)?$/.test(bare)) return null;
  return bare.includes(".") ? bare : `${bare}.0`;
}

/** Pin `version` for the org at `instanceUrl`, or (null) go back to the org's own version. */
export function pinApiVersion(instanceUrl: string, version: string | null): void {
  const host = hostOf(instanceUrl);
  if (!host) return;
  const v = normalizeVersion(version);
  if (v) pins.set(host, v);
  else pins.delete(host);
}

export function pinnedApiVersion(instanceUrl: string | undefined): string | null {
  const host = instanceUrl ? hostOf(instanceUrl) : null;
  return (host && pins.get(host)) || null;
}

export function anyApiVersionPinned(): boolean {
  return pins.size > 0;
}

/** The version to use for an org whose instance and reported version are known (either may be missing). */
export function resolveApiVersion(instanceUrl: string | undefined, reported: string | undefined): string {
  const host = instanceUrl ? hostOf(instanceUrl) : null;
  const v = normalizeVersion(reported);
  if (host && v) reportedByHost.set(host, v);
  return pinnedApiVersion(instanceUrl) ?? v ?? (host && reportedByHost.get(host)) ?? FALLBACK_API_VERSION;
}

/** Newest first, from the instance's `/services/data/` list. */
export function sortVersions(versions: string[]): string[] {
  return [...new Set(versions.map(normalizeVersion).filter((v): v is string => !!v))].sort((a, b) => parseFloat(b) - parseFloat(a));
}

/** For tests. */
export function clearApiVersionPins(): void {
  pins.clear();
  reportedByHost.clear();
}
