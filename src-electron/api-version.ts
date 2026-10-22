/**
 * The Salesforce API version pinned per org, from the status bar's version menu.
 * Kept in settings.json under `apiVersions`, keyed by the org's lowercased username
 * like sourceControl; an org with no entry uses its own (newest) version. The org's
 * MCP server holds the pin in memory, so it is set again each time the server starts.
 */

import type { Settings } from "./settings.js";

const keyOf = (username: string) => username.trim().toLowerCase();

export function apiVersionFor(settings: Settings, username: string | undefined): string | null {
  if (!username) return null;
  return settings.apiVersions?.[keyOf(username)] ?? null;
}

/** Settings with this org's pin set, or dropped (null). */
export function withApiVersion(settings: Settings, username: string, version: string | null): Settings {
  const all = { ...(settings.apiVersions ?? {}) };
  if (version) all[keyOf(username)] = version;
  else delete all[keyOf(username)];
  return { ...settings, apiVersions: all };
}
