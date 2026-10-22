/**
 * Which test-user logins ride along with a `studio_ipad_published` call, and how they show in its
 * cache key. The key carries login ids only (never tokens), so a load read as the rep and one read
 * as the admin are cached apart, and a login that expires or is forgotten changes the key.
 */

export interface RepLoginRef {
  id: string;
  userId?: string;
  status: string;
}

const same15 = (a: string, b: string) => a.slice(0, 15) === b.slice(0, 15);

/** Signed-in logins that could read as the viewer: only that user's when one is named, else every one with a known user. */
export function repLoginsFor(logins: RepLoginRef[], viewerUserId?: string): RepLoginRef[] {
  return logins.filter((l) => l.status === "signedIn" && !!l.userId && (!viewerUserId || same15(l.userId, viewerUserId)));
}

/** The call's args as cached: the same plus the ids of the logins offered, so sources never mix. */
export function cacheArgsWithRepLogins(args: Record<string, unknown>, offered: RepLoginRef[]): Record<string, unknown> {
  return offered.length ? { ...args, readAs: offered.map((l) => l.id).sort() } : args;
}
