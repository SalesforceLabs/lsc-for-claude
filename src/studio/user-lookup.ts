/**
 * Resolving "who" and "which feature" from the words a person types in chat, for check_user_access:
 * a user by Id, username, email or name, a feature by id or title.
 */

import { ID_PATTERN, inList, query, type Row } from "./helpers.js";
import { listFeatures } from "./features.js";

export interface UserMatch {
  id: string;
  name: string;
  username: string;
  profile: string | null;
}

export type UserLookup =
  | { kind: "one"; user: UserMatch }
  | { kind: "many"; matches: UserMatch[] }
  | { kind: "none" };

type Querier = (soql: string) => Promise<Row[]>;

const MAX_MATCHES = 10;

function toMatch(r: Row): UserMatch {
  const profile = (r.Profile as { Name?: unknown } | null | undefined)?.Name;
  return {
    id: String(r.Id),
    name: String(r.Name ?? ""),
    username: String(r.Username ?? ""),
    profile: profile ? String(profile) : null,
  };
}

/** Decides among candidate rows: an exact username/email/name match wins over a partial one. */
export function chooseUser(term: string, rows: Row[]): UserLookup {
  const matches = rows.map(toMatch);
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "one", user: matches[0] };
  const t = term.trim().toLowerCase();
  const exact = rows.filter((r, i) => {
    const m = matches[i];
    return (
      m.id.toLowerCase() === t ||
      m.username.toLowerCase() === t ||
      String(r.Email ?? "").toLowerCase() === t ||
      m.name.toLowerCase() === t
    );
  });
  if (exact.length === 1) return { kind: "one", user: toMatch(exact[0]) };
  // Active users come first in the query; when exactly one of the candidates is active it is the one meant.
  const active = rows.filter((r) => r.IsActive === true);
  if (active.length === 1 && exact.length === 0) return { kind: "one", user: toMatch(active[0]) };
  return { kind: "many", matches: matches.slice(0, MAX_MATCHES) };
}

export async function findUser(term: string, run: Querier): Promise<UserLookup> {
  const t = term.trim();
  const select = "SELECT Id, Name, Username, Email, IsActive, Profile.Name FROM User";
  if (ID_PATTERN.test(t) && t.startsWith("005")) {
    return chooseUser(t, await run(`${select} WHERE Id = ${inList([t])}`));
  }
  const like = t.replace(/[\\'%_]/g, (c) => `\\${c}`);
  const rows = await run(
    `${select} WHERE IsActive = true AND (Name LIKE '%${like}%' OR Username LIKE '%${like}%' OR Email LIKE '%${like}%') ORDER BY Name LIMIT 25`
  );
  if (rows.length > 0) return chooseUser(t, rows);
  const inactive = await run(
    `${select} WHERE IsActive = false AND (Name LIKE '%${like}%' OR Username LIKE '%${like}%' OR Email LIKE '%${like}%') ORDER BY Name LIMIT 25`
  );
  return chooseUser(t, inactive);
}

export function findUserInOrg(term: string, org: string): Promise<UserLookup> {
  return findUser(term, (soql) => query(soql, org));
}

/** A feature by id, title or a word of its title ("samples", "Sample Management"); null when none or several fit. */
export function resolveFeatureId(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const features = listFeatures();
  const exact = features.find((f) => f.id.toLowerCase() === t || f.title.toLowerCase() === t);
  if (exact) return exact.id;
  const partial = features.filter(
    (f) =>
      f.id.toLowerCase().includes(t) ||
      f.title.toLowerCase().includes(t) ||
      t.includes(f.id.toLowerCase())
  );
  return partial.length === 1 ? partial[0].id : null;
}
