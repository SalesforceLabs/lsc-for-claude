/**
 * Exact sync-volume table list for a persona user who has a mobile login in
 * Studio: the same user-info call and metadata download the first-sync
 * simulator makes, run as that user, then the device's own schema build
 * (readable-field filtering included). This replaces the admin-side
 * approximation in compiled-schema.ts for that user only; every other user, and
 * any failure, falls through to the wrapped source.
 *
 * Read-only: one GET (user-info), one POST (the metadata download action is a
 * read) and Range GETs for the archive. userDeviceId is never sent. The tokens
 * live only in the sessions built here and never reach a note or an error.
 */

import type { ApplicableTable, UserContext } from "./sync-volume.js";
import type { CompiledSchemaSource, CompiledSchemaTables } from "./compiled-schema.js";
import { downloadMetadata, type MetadataResult } from "./device/metadata.js";
import { buildSchema, type SchemaTable } from "./device/schema.js";
import { createTokenSession, type DeviceSession, type TokenLogin } from "./device/session.js";
import { fetchUserInfo, type UserInfo } from "./device/user-info.js";

export interface UserSchemaDeps {
  /** Mobile logins Studio holds; matched to persona users by username, case-insensitively. */
  logins: TokenLogin[];
  /** Used for users without a login, and when a login's download fails. */
  base?: CompiledSchemaSource;
  /** Test seams. */
  sessionFor?: (login: TokenLogin) => DeviceSession;
  fetchUserInfo?: (session: DeviceSession) => Promise<UserInfo>;
  downloadMetadata?: (session: DeviceSession, metadataRecordId: string) => Promise<MetadataResult>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Ids are compared on their 15-character form; user-info and SOQL may return either length. */
const sameId = (a: string, b: string) => a.length >= 15 && b.length >= 15 && a.slice(0, 15) === b.slice(0, 15);

export function toApplicableTable(t: SchemaTable): ApplicableTable {
  return {
    entry: {
      developerName: t.developerName,
      sobject: t.sobject,
      type: "",
      whereSoql: t.whereSoql ?? null,
      profileIds: new Set(),
      profileNames: new Set(),
      permissionSets: new Set(),
    },
    matchedBy: t.fromPermissionSet ? "permissionSet" : "profile",
  };
}

/** Index logins by lower-cased username; the last one listed wins. */
function byUsername(logins: TokenLogin[]): Map<string, TokenLogin> {
  return new Map(logins.map((l) => [l.username.toLowerCase(), l]));
}

export function createUserSchemaSource(deps: UserSchemaDeps): CompiledSchemaSource {
  const logins = byUsername(deps.logins);
  const sessionFor = deps.sessionFor ?? ((login: TokenLogin) => createTokenSession(login));
  const getInfo = deps.fetchUserInfo ?? ((s: DeviceSession) => fetchUserInfo(s));
  const download = deps.downloadMetadata ?? ((s: DeviceSession, id: string) => downloadMetadata(s, id));
  const cache = new Map<string, Promise<{ ok: CompiledSchemaTables & { userId: string } } | { reason: string }>>();

  const load = (login: TokenLogin) => {
    const key = login.username.toLowerCase();
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const session = sessionFor(login);
        const info = await getInfo(session);
        const entity = info.metadataEntities[0];
        if (!entity) return { reason: "user-info returned no metadata record for the user" };
        const md = await download(session, entity.id);
        const schema = buildSchema({ files: md.files, usp: md.info.userSpecificPermissions, assignedPermissionSets: info.permissionSets });
        return {
          ok: {
            userId: info.user.id,
            tables: schema.tables.map(toApplicableTable),
            notes: [
              `Table list taken from ${login.username}'s own metadata download (${entity.name}, mobile login): the tables the device would sync, including field-level filtering.`,
              ...schema.notes,
            ],
            source: "user-download" as const,
          },
        };
      })().catch((e): { reason: string } => ({ reason: errorMessage(e) }));
      cache.set(key, pending);
    }
    return pending;
  };

  const fallBack = async (user: Parameters<CompiledSchemaSource["tablesFor"]>[0], username: string, why: string) => {
    const note = `Mobile login for ${username} could not supply the user's metadata (${why}); `;
    if (!deps.base) return { fallbackReason: `${note}no other schema source was available` };
    const next = await deps.base.tablesFor(user);
    return "result" in next
      ? { result: { ...next.result, notes: [`${note}fell back to the profile's archive.`, ...next.result.notes] } }
      : { fallbackReason: `${note}${next.fallbackReason}` };
  };

  return {
    async tablesFor(user: Pick<UserContext, "id" | "profileId" | "profileName" | "permissionSets"> & { username?: string }) {
      const login = user.username ? logins.get(user.username.toLowerCase()) : undefined;
      if (!login) return deps.base ? deps.base.tablesFor(user) : { fallbackReason: "no mobile login for this user" };

      const loaded = await load(login);
      if ("reason" in loaded) return fallBack(user, login.username, loaded.reason);
      const { userId, ...result } = loaded.ok;
      if (!sameId(userId, user.id)) {
        return fallBack(user, login.username, "the login belongs to a different user than the persona's, so it may be a different org");
      }
      return { result };
    },
  };
}
