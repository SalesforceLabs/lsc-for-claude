/**
 * The in-app browser behind custom actions in Studio's iPad preview. The page
 * loads in a <webview> guest with an in-memory session of its own per identity.
 * Salesforce pages are signed in as the previewed rep through their mobile login
 * (the singleaccess endpoint), or — when the user asks — as Studio's sf CLI
 * connection through `sf org open --url-only`. Either way the one-time
 * frontdoor link is loaded here in the main process and never reaches the
 * renderer. Other https pages load as they are, signed out.
 */

import { execFile } from "child_process";
import { session, webContents, type WebContents } from "electron";
import { loadSettings } from "./settings.js";
import { mobileLoginFrontdoor } from "./mobile-login.js";

/** Prefix of the guest sessions: in-memory, one per identity for the app session, never the app's own. */
export const STUDIO_BROWSER_PARTITION = "studio-browser";

/** Who a preview page is signed in as: a mobile login (the rep), the sf CLI connection, or nobody. */
export type BrowserAuth = { loginId: string } | { cli: true } | { public: true };

/** The guest session for an identity, so one user's cookies never sign another's page in. */
export function partitionFor(auth: BrowserAuth): string {
  if ("loginId" in auth) return `${STUDIO_BROWSER_PARTITION}:${auth.loginId}`;
  return `${STUDIO_BROWSER_PARTITION}:${"cli" in auth ? "cli" : "public"}`;
}

const SALESFORCE_HOST = /(^|\.)(salesforce\.com|force\.com|salesforce-setup\.com|salesforce\.mil|crmforce\.mil|sfcrmproducts\.cn)$/i;

/** The My Domain name a Salesforce host belongs to: "acme--uat" for acme--uat.sandbox.lightning.force.com. */
export function myDomainOf(host: string): string | null {
  if (!SALESFORCE_HOST.test(host)) return null;
  const label = host.split(".")[0].toLowerCase();
  return label && host.includes(".") ? label : null;
}

/** Whether `url` is on the same My Domain as `other` (a frontdoor link or a login's instance). */
export function sameOrg(url: URL, other: URL): boolean {
  const a = myDomainOf(url.hostname);
  return !!a && a === myDomainOf(other.hostname);
}

interface OrgOpen {
  url: string;
  username?: string;
}

/** `sf org open --url-only` for the target org: a one-time frontdoor link that lands on `path`. */
function frontdoorFor(path: string): Promise<OrgOpen> {
  const org = loadSettings().sfTargetOrg;
  const args = ["org", "open", "--url-only", "--json", "--path", path];
  if (org) args.push("--target-org", org);
  return new Promise((resolve, reject) => {
    execFile("sf", args, { timeout: 30000 }, (error, stdout) => {
      try {
        const data = JSON.parse(stdout);
        if (data?.result?.url) return resolve({ url: data.result.url, username: data.result.username });
        reject(new Error(data?.message ?? error?.message ?? "sf org open returned no URL"));
      } catch {
        reject(new Error(error?.message ?? "Couldn't read sf org open's output"));
      }
    });
  });
}

/** The guest a renderer asked to load into — only a <webview> of this window in the identity's partition. */
function guestOf(host: WebContents, id: number, auth: BrowserAuth): WebContents {
  const guest = webContents.fromId(id);
  if (!guest || guest.getType() !== "webview" || guest.hostWebContents !== host) {
    throw new Error("Not a preview browser of this window.");
  }
  // fromPartition is cached by name, so this is the session the <webview partition> attached to.
  if (guest.session !== session.fromPartition(partitionFor(auth))) {
    throw new Error("The preview browser isn't in its own session.");
  }
  return guest;
}

export interface BrowserOpenResult {
  /** The org user the page was signed in as; absent when the page loaded signed out. */
  signedInAs?: string;
  /** Why the page couldn't be signed in, when it loaded signed out anyway. */
  note?: string;
}

/** Load `target` into the preview browser `guestId`, signed in as `auth` when it's a page of that user's org. */
export async function openInPreviewBrowser(
  host: WebContents,
  guestId: number,
  target: string,
  auth: BrowserAuth
): Promise<BrowserOpenResult> {
  const url = new URL(target);
  if (url.protocol !== "https:") throw new Error("The preview only loads https pages.");
  const guest = guestOf(host, guestId, auth);
  const load = (u: string) =>
    guest.loadURL(u).catch(() => {
      // Redirect chains reject the first load; real failures show in the page itself.
    });
  const path = url.pathname + url.search + url.hash;
  const signedOut = async (note: string) => {
    await load(url.toString());
    return { note };
  };

  if (!myDomainOf(url.hostname) || "public" in auth) {
    await load(url.toString());
    return {};
  }
  if ("loginId" in auth) {
    let door: Awaited<ReturnType<typeof mobileLoginFrontdoor>>;
    try {
      door = await mobileLoginFrontdoor(auth.loginId, path);
    } catch (error) {
      return signedOut(error instanceof Error ? error.message : String(error));
    }
    if (!sameOrg(url, new URL(door.instanceUrl))) {
      return signedOut(`This page is on another org than ${door.username}'s, so it loaded signed out.`);
    }
    await load(door.url);
    return { signedInAs: door.username };
  }
  let door: OrgOpen;
  try {
    door = await frontdoorFor(path);
  } catch (error) {
    return signedOut(`Couldn't sign in with the sf CLI: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!sameOrg(url, new URL(door.url))) return signedOut("This page is on another org than Studio's, so it loaded signed out.");
  await load(door.url);
  return { signedInAs: door.username };
}
