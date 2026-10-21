/**
 * Token orgs: a Studio mobile login (the previewed rep's OAuth token) standing
 * in for an sf CLI org name, so code that reads through `runSoqlQuery` /
 * `apiRequest` can read as the rep without knowing the difference.
 *
 * The pseudo org name carries no secret (a hash of user and instance); the
 * token itself lives in this module's map and is only sent to the Salesforce
 * HTTPS instance URL the login names. A token org is never handed to the sf
 * CLI: when the direct REST path can't serve it the call fails, so a read
 * meant for the rep is never silently answered as someone else.
 */

import { createHash } from "node:crypto";
import { isSalesforceUrl, type TokenLogin } from "../perf/device/session.js";
import { resetDirect, type DirectCredentials } from "./direct.js";

const PREFIX = "token-org:";
const logins = new Map<string, DirectCredentials>();

export function isTokenOrg(org: string | undefined): boolean {
  return !!org && org.startsWith(PREFIX);
}

/** Registers (or refreshes) a login and returns the org name to read it with. Throws for a non-Salesforce URL. */
export function registerTokenOrg(login: TokenLogin, apiVersion?: string): string {
  if (!isSalesforceUrl(login.instanceUrl))
    throw new Error(`"${login.instanceUrl}" is not a Salesforce HTTPS URL.`);
  const key =
    PREFIX +
    createHash("sha256")
      .update(`${login.username.toLowerCase()}\u0000${login.instanceUrl}`)
      .digest("hex")
      .slice(0, 16);
  logins.set(key, {
    accessToken: login.accessToken,
    instanceUrl: login.instanceUrl,
    ...(apiVersion ? { apiVersion } : {}),
  });
  resetDirect(key);
  return key;
}

export function tokenOrgCredentials(org: string): DirectCredentials | null {
  return logins.get(org) ?? null;
}

export function forgetTokenOrg(org: string): void {
  logins.delete(org);
  resetDirect(org);
}

/** The newest REST API version the instance serves (what `sf org display` gives for a CLI org); undefined when it can't be read. */
export async function latestApiVersion(instanceUrl: string): Promise<string | undefined> {
  if (!isSalesforceUrl(instanceUrl)) return undefined;
  try {
    const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/services/data/`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const list = (await res.json()) as { version?: string }[];
    return list
      .map((v) => v.version)
      .filter((v): v is string => typeof v === "string")
      .sort((a, b) => parseFloat(b) - parseFloat(a))[0];
  } catch {
    return undefined;
  }
}

export const TOKEN_ORG_NO_CLI =
  "The rep's login can't be used through the sf CLI, and its direct connection to Salesforce was not available.";
