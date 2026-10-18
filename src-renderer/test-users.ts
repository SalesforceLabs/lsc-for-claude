import type { MobileLoginInfo } from "./types";

/**
 * Test users are reps' mobile logins — made through the LSC mobile app's connected app, so they see
 * what an iPad sees. They belong to one org and are never offered in another.
 */

/** 15- and 18-character org Ids of the same org compare equal. */
export function sameOrgId(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.slice(0, 15) === b.slice(0, 15);
}

/** The org's test users, signed-in first, then by name. */
export function testUsersFor(logins: MobileLoginInfo[], orgId: string | undefined): MobileLoginInfo[] {
  if (!orgId) return [];
  return logins
    .filter((l) => sameOrgId(l.orgId, orgId))
    .sort((a, b) => Number(a.status === "expired") - Number(b.status === "expired") || testUserName(a).localeCompare(testUserName(b)));
}

export function testUserName(login: MobileLoginInfo): string {
  return login.displayName || login.username;
}

export type TestUserTone = "pass" | "warning" | "info";

/** The status pill: signed in (and remembered), signed in until Roz quits, or expired. */
export function testUserStatus(login: MobileLoginInfo): { label: string; tone: TestUserTone; detail: string } {
  if (login.status === "expired") {
    return { label: "Expired", tone: "warning", detail: "Salesforce ended this login (revoked, or the password changed). Sign in again." };
  }
  if (!login.remembered) {
    return { label: "Until Roz quits", tone: "info", detail: "Salesforce gave no refresh token, so this login ends when Roz quits." };
  }
  return { label: "Signed in", tone: "pass", detail: "Remembered in the keychain; Roz renews it as needed." };
}

/** The test user signed in as this user, if any — a signed-in login before an expired one. */
export function testUserFor(logins: MobileLoginInfo[], userId: string | undefined): MobileLoginInfo | undefined {
  if (!userId) return undefined;
  const mine = logins.filter((l) => !!l.userId && l.userId.slice(0, 15) === userId.slice(0, 15));
  return mine.find((l) => l.status === "signedIn") ?? mine[0];
}
