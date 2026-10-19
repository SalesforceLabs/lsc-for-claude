/**
 * "Deployed from source control", per org: whether Studio reminds the user to save
 * applied changes as sfdx source files, and the folder they last saved them to.
 * Kept in settings.json under `sourceControl`, keyed by the org's lowercased username
 * (several aliases can share one connection).
 */

import type { Settings } from "./settings.js";

export interface OrgSourceControl {
  deployed: boolean;
  /** The project folder last chosen for this org — the folder picker opens there. */
  folder?: string;
}

const keyOf = (username: string) => username.trim().toLowerCase();

export function sourceControlFor(settings: Settings, username: string | undefined): OrgSourceControl {
  if (!username) return { deployed: false };
  const saved = settings.sourceControl?.[keyOf(username)];
  return { deployed: saved?.deployed === true, ...(saved?.folder ? { folder: saved.folder } : {}) };
}

/** Settings with this org's entry updated; an entry back at the defaults is dropped. */
export function withSourceControl(settings: Settings, username: string, patch: Partial<OrgSourceControl>): Settings {
  const key = keyOf(username);
  const next: OrgSourceControl = { ...sourceControlFor(settings, username), ...patch };
  const all = { ...(settings.sourceControl ?? {}) };
  if (!next.deployed && !next.folder) delete all[key];
  else all[key] = next;
  return { ...settings, sourceControl: all };
}
