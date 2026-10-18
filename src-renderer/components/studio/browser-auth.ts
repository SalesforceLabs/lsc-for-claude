import type { MobileLoginInfo } from "../../types";

/**
 * Who the iPad preview's in-app browser signs a page in as — a copy of `BrowserAuth` / `partitionFor` in
 * src-electron/studio-browser.ts, which checks the guest is in the partition named here.
 */
export type BrowserAuth = { loginId: string } | { cli: true } | { public: true };

export function partitionFor(auth: BrowserAuth): string {
  if ("loginId" in auth) return `studio-browser:${auth.loginId}`;
  return `studio-browser:${"cli" in auth ? "cli" : "public"}`;
}

const SALESFORCE_HOST = /(^|\.)(salesforce\.com|force\.com|salesforce-setup\.com|salesforce\.mil|crmforce\.mil|sfcrmproducts\.cn)$/i;

/** The My Domain name a Salesforce host belongs to: "acme--uat" for acme--uat.sandbox.lightning.force.com. */
export function myDomainOf(host: string): string | null {
  if (!SALESFORCE_HOST.test(host) || !host.includes(".")) return null;
  return host.split(".")[0].toLowerCase() || null;
}

const MY_DOMAIN_HOST = /^([^.]+)\.((?:[^.]+\.)*?)(?:lightning\.force\.com|my\.salesforce\.com|my\.salesforce-setup\.com)$/i;

/** The login URL for a page's org — its My Domain, sandbox and scratch parts kept — or null when it can't tell. */
export function loginUrlFor(host: string): string | null {
  const m = MY_DOMAIN_HOST.exec(host);
  return m ? `https://${m[1].toLowerCase()}.${m[2].toLowerCase()}my.salesforce.com` : null;
}

function domainOfUrl(url: string): string | null {
  try {
    return myDomainOf(new URL(url).hostname);
  } catch {
    return null;
  }
}

export interface AuthChoice {
  /** Who to sign the page in as; null when Studio has to ask (no login for the rep yet). */
  auth: BrowserAuth | null;
  /** Mobile logins on the page's org, for signing in as someone else. */
  candidates: MobileLoginInfo[];
}

/**
 * Sign in as the previewed rep when Studio holds their mobile login; otherwise use the choice made earlier
 * for this rep, if it still applies. Pages outside Salesforce load signed out.
 */
export function chooseAuth(
  url: string,
  logins: MobileLoginInfo[],
  viewerUserId: string | null,
  remembered: BrowserAuth | null
): AuthChoice {
  const domain = domainOfUrl(url);
  if (!domain) return { auth: { public: true }, candidates: [] };
  const candidates = logins.filter((l) => domainOfUrl(l.instanceUrl) === domain);
  const rep = viewerUserId ? candidates.find((l) => sameUserId(l.userId, viewerUserId)) : undefined;
  if (rep) return { auth: { loginId: rep.id }, candidates };
  if (remembered && ("cli" in remembered || ("loginId" in remembered && candidates.some((l) => l.id === remembered.loginId)))) {
    return { auth: remembered, candidates };
  }
  return { auth: null, candidates };
}

/** 15- and 18-character Ids of the same record compare equal. */
export function sameUserId(a: string | undefined, b: string): boolean {
  return !!a && a.slice(0, 15) === b.slice(0, 15);
}
