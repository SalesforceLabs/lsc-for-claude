/**
 * Logs a user in through the LSC mobile app's own connected app, for the
 * first-sync simulator. The org serves the mobile sync endpoints (user-info,
 * metadata download) only to that connected app, so sf CLI logins get 404.
 *
 * The flow is the iOS app's: OAuth web-server flow with PKCE and no client
 * secret, redirecting to the app's mobilesfdc:// URI, which the login window
 * intercepts instead of following. Tokens never leave the main process: they
 * aren't logged or sent to the renderer. Logins with a refresh token are
 * remembered across restarts, encrypted with the OS keychain like model keys
 * (secrets.ts); the rest last until Roz quits.
 */

import type { BrowserWindow } from "electron";
import { openLoginWindow } from "./login-window.js";
import crypto from "crypto";
import { loadSettings } from "./settings.js";
import { deleteSecret, getSecret, setSecret } from "./secrets.js";

/**
 * The LSC mobile app's connected-app consumer key: the Settings value first,
 * then LSC_MOBILE_CLIENT_ID. It isn't shipped in this repo; it is the iOS
 * app's bootconfig.plist remoteAccessConsumerKey. Read per call so a change
 * in Settings applies without a restart.
 */
export function mobileClientId(): string {
  const id = loadSettings().mobileClientId?.trim() || process.env.LSC_MOBILE_CLIENT_ID?.trim();
  if (!id) {
    throw new Error(
      "Set the LSC mobile app consumer key in Settings (remoteAccessConsumerKey in the iOS app's bootconfig.plist), or set LSC_MOBILE_CLIENT_ID and restart Studio."
    );
  }
  return id;
}
const REDIRECT_URI = "mobilesfdc:///mobilesdk/detect/oauth/done";
const SCOPES = "api web refresh_token";
/** Tokens older than this are refreshed before a run starts. */
const REFRESH_AFTER_MS = 15 * 60_000;

const SALESFORCE_HOST = /(^|\.)(salesforce\.com|force\.com|salesforce\.mil|crmforce\.mil|sfcrmproducts\.cn)$/i;

function isSalesforceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && SALESFORCE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** What the renderer sees of a login. */
export interface MobileLoginInfo {
  id: string;
  username: string;
  /** The user's Id, so the iPad preview can pick the login for the rep it shows. */
  userId?: string;
  displayName?: string;
  orgId?: string;
  instanceUrl: string;
  /** `expired`: Salesforce turned the refresh token down (revoked, or the user's password changed) — sign in again. */
  status: "signedIn" | "expired";
  /** Kept across restarts; false when Salesforce gave no refresh token, so it ends when Roz quits. */
  remembered: boolean;
}

interface MobileLogin extends Omit<MobileLoginInfo, "status" | "remembered"> {
  loginUrl: string;
  accessToken: string;
  refreshToken?: string;
  issuedAt: number;
  expired?: boolean;
}

const logins = new Map<string, MobileLogin>();

const STORE_KEY = "mobile-logins";
let loaded = false;

/** The remembered logins, read from the keychain on first use. */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  let saved: unknown;
  try {
    saved = JSON.parse(getSecret(STORE_KEY) ?? "[]");
  } catch {
    return;
  }
  if (!Array.isArray(saved)) return;
  for (const l of saved as Partial<MobileLogin>[]) {
    const ok =
      typeof l.id === "string" &&
      typeof l.username === "string" &&
      typeof l.accessToken === "string" &&
      typeof l.refreshToken === "string" &&
      typeof l.instanceUrl === "string" &&
      typeof l.loginUrl === "string" &&
      isSalesforceUrl(l.instanceUrl) &&
      isSalesforceUrl(l.loginUrl);
    if (ok) logins.set(l.id as string, { ...(l as MobileLogin), issuedAt: Number(l.issuedAt) || 0, expired: !!l.expired });
  }
}

function save(): void {
  const keep = [...logins.values()].filter((l) => l.refreshToken);
  try {
    if (keep.length) setSecret(STORE_KEY, JSON.stringify(keep));
    else deleteSecret(STORE_KEY);
  } catch {
    // Not remembered this time; the logins still work until Roz quits.
  }
}

const listeners = new Set<(logins: MobileLoginInfo[]) => void>();

/** Called with every login whenever one is added, removed, or expires. */
export function onMobileLoginsChanged(listener: (logins: MobileLoginInfo[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  save();
  const list = listMobileLogins();
  for (const l of listeners) l(list);
}

const base64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const publicInfo = ({ id, username, userId, displayName, orgId, instanceUrl, refreshToken, expired }: MobileLogin): MobileLoginInfo => ({
  id,
  username,
  userId,
  displayName,
  orgId,
  instanceUrl,
  status: expired ? "expired" : "signedIn",
  remembered: !!refreshToken,
});

/** Salesforce answered and said no — as opposed to the request not getting through. */
class TokenRejected extends Error {}

async function tokenRequest(loginUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: mobileClientId(), ...params }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = [data.error, data.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`;
    const message = `Salesforce rejected the login (${reason}).`;
    // 400 invalid_grant is how a revoked or expired refresh token comes back; a 5xx is Salesforce having trouble.
    throw res.status === 400 || res.status === 401 ? new TokenRejected(message) : new Error(message);
  }
  return data;
}

/** Show the Salesforce login page; resolves with the authorization code from the mobilesfdc:// redirect. */
function authorize(loginUrl: string, parent: BrowserWindow | undefined, challenge: string, state: string): Promise<string> {
  const url = new URL(`${loginUrl}/services/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: mobileClientId(),
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: SCOPES,
    state,
    // QA switch between users, so never reuse a remembered session.
    prompt: "login",
  }).toString();

  return new Promise((resolve, reject) => {
    // A fresh in-memory partition per login: no cookies from earlier logins or the app.
    const { win, page } = openLoginWindow({ parent, title: "Sign in a test user", partition: `mobile-login-${state}` });
    let settled = false;
    const finish = (err: Error | null, code?: string) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.close();
      if (err) reject(err);
      else resolve(code as string);
    };
    const intercept = (event: { preventDefault: () => void }, target: string) => {
      if (!target.startsWith("mobilesfdc:")) return;
      event.preventDefault();
      const params = new URL(target).searchParams;
      if (params.get("error")) {
        finish(new Error(`Login failed: ${params.get("error_description") ?? params.get("error")}`));
      } else if (params.get("state") !== state || !params.get("code")) {
        finish(new Error("Login failed: the response didn't match this login."));
      } else {
        finish(null, params.get("code") as string);
      }
    };
    page.on("will-redirect", intercept);
    page.on("will-navigate", intercept);
    page.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("closed", () => finish(new Error("Login window closed.")));
    page.loadURL(url.toString()).catch(() => {
      // Aborted loads (the intercepted redirect) reject here; real failures surface in the window.
    });
  });
}

/** Log in through the LSC mobile app's connected app; resolves once the user has signed in. */
export async function startMobileLogin(loginUrl: string, parent?: BrowserWindow): Promise<MobileLoginInfo> {
  ensureLoaded();
  const base = loginUrl.trim().replace(/\/+$/, "");
  if (!isSalesforceUrl(base)) throw new Error(`"${loginUrl}" is not a Salesforce HTTPS login URL.`);
  mobileClientId();

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(12));
  const code = await authorize(base, parent, challenge, state);

  const token = await tokenRequest(base, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const accessToken = token.access_token as string | undefined;
  const instanceUrl = token.instance_url as string | undefined;
  if (!accessToken || !instanceUrl || !isSalesforceUrl(instanceUrl)) throw new Error("Salesforce returned an incomplete login.");

  // The identity URL names the user the token belongs to.
  let identity: Record<string, unknown> = {};
  if (typeof token.id === "string" && isSalesforceUrl(token.id)) {
    const res = await fetch(token.id, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (res.ok) identity = (await res.json()) as Record<string, unknown>;
  }
  const username = typeof identity.username === "string" ? identity.username : "";
  if (!username) throw new Error("Logged in, but Salesforce didn't say which user — try again.");

  // One login per user: logging in again replaces the old token.
  for (const [id, l] of logins) if (l.username.toLowerCase() === username.toLowerCase()) logins.delete(id);
  const login: MobileLogin = {
    id: `mobile-${base64url(crypto.randomBytes(6))}`,
    username,
    userId: typeof identity.user_id === "string" ? identity.user_id : undefined,
    displayName: typeof identity.display_name === "string" ? identity.display_name : undefined,
    orgId: typeof identity.organization_id === "string" ? identity.organization_id : undefined,
    instanceUrl,
    loginUrl: base,
    accessToken,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    issuedAt: Date.now(),
  };
  logins.set(login.id, login);
  changed();
  return publicInfo(login);
}

/** Sign in again as an expired login's user, on the same login URL. */
export async function renewMobileLogin(id: string, parent?: BrowserWindow): Promise<MobileLoginInfo> {
  ensureLoaded();
  const login = logins.get(id);
  if (!login) throw new Error("That login was removed.");
  return startMobileLogin(login.loginUrl, parent);
}

export function listMobileLogins(): MobileLoginInfo[] {
  ensureLoaded();
  return [...logins.values()].map(publicInfo);
}

export function removeMobileLogin(id: string): void {
  ensureLoaded();
  if (logins.delete(id)) changed();
}

async function refresh(login: MobileLogin): Promise<void> {
  if (!login.refreshToken) return;
  try {
    const token = await tokenRequest(login.loginUrl, { grant_type: "refresh_token", refresh_token: login.refreshToken });
    if (typeof token.access_token === "string") {
      const wasExpired = login.expired;
      login.accessToken = token.access_token;
      login.issuedAt = Date.now();
      login.expired = false;
      if (typeof token.instance_url === "string" && isSalesforceUrl(token.instance_url)) login.instanceUrl = token.instance_url;
      if (wasExpired) changed();
      else save();
    }
  } catch (error) {
    // Turned down: the user has to sign in again. Not reached (offline, say): keep the current token.
    if (error instanceof TokenRejected && !login.expired) {
      login.expired = true;
      changed();
    }
  }
}

/** Refresh the logins not refreshed lately, so their status is current (when a list of test users opens). */
export async function checkMobileLogins(): Promise<MobileLoginInfo[]> {
  ensureLoaded();
  await Promise.all([...logins.values()].filter((l) => Date.now() - l.issuedAt > REFRESH_AFTER_MS).map(refresh));
  return listMobileLogins();
}

function usableLogin(id: string): MobileLogin {
  ensureLoaded();
  const login = logins.get(id);
  if (!login) throw new Error("That test user was forgotten. Sign them in again from Studio → Test users.");
  if (login.expired) throw new Error(`${login.displayName ?? login.username}'s login has expired. Sign in again.`);
  return login;
}

/** The login's token for a run, refreshed first when it's old enough to expire mid-run. */
export async function mobileLoginCredentials(
  id: string
): Promise<{ instanceUrl: string; accessToken: string; username: string; orgId?: string }> {
  const login = usableLogin(id);
  if (Date.now() - login.issuedAt > REFRESH_AFTER_MS) await refresh(login);
  if (login.expired) throw new Error(`${login.displayName ?? login.username}'s login has expired. Sign in again.`);
  return { instanceUrl: login.instanceUrl, accessToken: login.accessToken, username: login.username, orgId: login.orgId };
}

/**
 * A single-use frontdoor link that signs a browser in as the login's user and lands on `path` — the
 * singleaccess endpoint `sf org open` uses, which needs the token's `web` scope. A rejected token is
 * refreshed once and retried, since the endpoint answers 403 rather than 401 for an expired session.
 */
export async function mobileLoginFrontdoor(id: string, path: string): Promise<{ url: string; instanceUrl: string; username: string }> {
  const login = usableLogin(id);
  if (Date.now() - login.issuedAt > REFRESH_AFTER_MS) await refresh(login);
  const request = async () => {
    const url = new URL("/services/oauth2/singleaccess", login.instanceUrl);
    url.searchParams.set("redirect_uri", path);
    return fetch(url, { headers: { Authorization: `Bearer ${login.accessToken}`, Accept: "application/json" } });
  };
  let res = await request();
  if ((res.status === 401 || res.status === 403) && login.refreshToken) {
    await refresh(login);
    res = await request();
  }
  const data = (await res.json().catch(() => ({}))) as { frontdoor_uri?: string; error?: string; error_description?: string };
  if (!res.ok || !data.frontdoor_uri || !isSalesforceUrl(data.frontdoor_uri)) {
    const reason = [data.error, data.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`;
    throw new Error(`Salesforce wouldn't sign the page in as ${login.username} (${reason}).`);
  }
  return { url: data.frontdoor_uri, instanceUrl: login.instanceUrl, username: login.username };
}
