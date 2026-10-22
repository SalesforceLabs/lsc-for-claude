/**
 * The org's Salesforce API version for the Electron app's status bar: what it is, the
 * versions the org serves, and pinning one (`studio_api_version` / `studio_set_api_version`).
 * The app saves the choice per org and pins it again whenever the org's MCP server starts.
 */
import { invalidateSharedReads } from "../config/read-cache.js";
import {
  FALLBACK_API_VERSION,
  normalizeVersion,
  pinApiVersion,
  sortVersions,
} from "../salesforce/api-version.js";
import { apiRequest, orgApiVersionDetails } from "../salesforce/cli.js";
import { resetLwcSessions } from "./lwc/request.js";

export interface ApiVersionInfo {
  /** The version calls use now. */
  version: string;
  /** The version the user pinned for this org, or null for the org's own. */
  pinned: string | null;
  /** The org's own (newest) version, used when nothing is pinned. */
  orgDefault: string;
  /** Versions the org serves, newest first; empty when they couldn't be read. */
  available: string[];
}

async function availableVersions(org: string): Promise<string[]> {
  const res = await apiRequest<Array<{ version?: string }>>(
    "/services/data/",
    "GET",
    undefined,
    org
  );
  if (!res.success || !Array.isArray(res.data)) return [];
  return sortVersions(res.data.map((v) => v.version ?? ""));
}

export async function apiVersionInfo(org: string): Promise<ApiVersionInfo> {
  const [details, available] = await Promise.all([
    orgApiVersionDetails(org),
    availableVersions(org),
  ]);
  return {
    version: details.version,
    pinned: details.pinned,
    orgDefault: details.reported ?? available[0] ?? FALLBACK_API_VERSION,
    available,
  };
}

/** Pin `version` for the org (null: back to the org's own). Refuses a version the org doesn't serve. */
export async function setApiVersion(org: string, version: string | null): Promise<ApiVersionInfo> {
  const details = await orgApiVersionDetails(org);
  if (!details.instanceUrl)
    throw new Error(
      "Couldn't read the org's login, so its API version can't be set. Log in to the org again."
    );
  let pin: string | null = null;
  if (version !== null) {
    pin = normalizeVersion(version);
    if (!pin) throw new Error(`"${version}" isn't an API version. Use one like 66.0.`);
    const available = await availableVersions(org);
    if (available.length && !available.includes(pin)) {
      throw new Error(`This org doesn't serve API version ${pin}. Its newest is ${available[0]}.`);
    }
  }
  pinApiVersion(details.instanceUrl, pin);
  // Shared reads and live-LWC sessions were made with the old version.
  invalidateSharedReads(org);
  resetLwcSessions();
  return apiVersionInfo(org);
}
