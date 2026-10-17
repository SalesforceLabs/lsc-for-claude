/**
 * Logs a user in through the LSC mobile app's own connected app, for the
 * first-sync simulator. The org serves the mobile sync endpoints (user-info,
 * metadata download) only to that connected app, so sf CLI logins get 404.
 *
 * The flow is the iOS app's: OAuth web-server flow with PKCE and no client
 * secret, redirecting to the app's mobilesfdc:// URI, which the login window
 * intercepts instead of following. Tokens stay in this process's memory for
 * the app session; they are never written to disk, logged, or sent to the
 * renderer.
 */

import { BrowserWindow } from "electron";
import crypto from "crypto";

/** The LSC iOS app's connected app (OCE/bootconfig.plist); LSC_MOBILE_CLIENT_ID overrides it. */
const MOBILE_CLIENT_ID = process.env.LSC_MOBILE_CLIENT_ID || "3MVG9fphf4bStCMm3y6cqtc75utQZroK4ESpim6XJQQIVbIQngnkw48n2LpgWV8JCnNCy7wwyefL5kHDVtla3";
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
  displayName?: string;
  orgId?: string;
  instanceUrl: string;
}

interface MobileLogin extends MobileLoginInfo {
  loginUrl: string;
  accessToken: string;
  refreshToken?: string;
  issuedAt: number;
}

const logins = new Map<string, MobileLogin>();

const base64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const publicInfo = ({ id, username, displayName, orgId, instanceUrl }: MobileLogin): MobileLoginInfo => ({
  id,
  username,
  displayName,
  orgId,
  instanceUrl,
});

async function tokenRequest(loginUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: MOBILE_CLIENT_ID, ...params }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = [data.error, data.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`;
    throw new Error(`Salesforce rejected the login (${reason}).`);
  }
  return data;
}

/** Show the Salesforce login page; resolves with the authorization code from the mobilesfdc:// redirect. */
function authorize(loginUrl: string, parent: BrowserWindow | undefined, challenge: string, state: string): Promise<string> {
  const url = new URL(`${loginUrl}/services/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: MOBILE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: SCOPES,
    state,
    // QA switch between users, so never reuse a remembered session.
    prompt: "login",
  }).toString();

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 520,
      height: 760,
      title: "Log in as a mobile user",
      webPreferences: {
        // A fresh in-memory partition per login: no cookies from earlier logins or the app.
        partition: `mobile-login-${state}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
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
    win.webContents.on("will-redirect", intercept);
    win.webContents.on("will-navigate", intercept);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("closed", () => finish(new Error("Login window closed.")));
    win.loadURL(url.toString()).catch(() => {
      // Aborted loads (the intercepted redirect) reject here; real failures surface in the window.
    });
  });
}

/** Log in through the LSC mobile app's connected app; resolves once the user has signed in. */
export async function startMobileLogin(loginUrl: string, parent?: BrowserWindow): Promise<MobileLoginInfo> {
  const base = loginUrl.trim().replace(/\/+$/, "");
  if (!isSalesforceUrl(base)) throw new Error(`"${loginUrl}" is not a Salesforce HTTPS login URL.`);

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
    displayName: typeof identity.display_name === "string" ? identity.display_name : undefined,
    orgId: typeof identity.organization_id === "string" ? identity.organization_id : undefined,
    instanceUrl,
    loginUrl: base,
    accessToken,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    issuedAt: Date.now(),
  };
  logins.set(login.id, login);
  return publicInfo(login);
}

export function listMobileLogins(): MobileLoginInfo[] {
  return [...logins.values()].map(publicInfo);
}

export function removeMobileLogin(id: string): void {
  logins.delete(id);
}

/** The login's token for a run, refreshed first when it's old enough to expire mid-run. */
export async function mobileLoginCredentials(
  id: string
): Promise<{ instanceUrl: string; accessToken: string; username: string; orgId?: string }> {
  const login = logins.get(id);
  if (!login) throw new Error("That mobile login has ended. Log in again.");
  if (login.refreshToken && Date.now() - login.issuedAt > REFRESH_AFTER_MS) {
    try {
      const token = await tokenRequest(login.loginUrl, { grant_type: "refresh_token", refresh_token: login.refreshToken });
      if (typeof token.access_token === "string") {
        login.accessToken = token.access_token;
        login.issuedAt = Date.now();
        if (typeof token.instance_url === "string" && isSalesforceUrl(token.instance_url)) login.instanceUrl = token.instance_url;
      }
    } catch {
      // Keep the current token; the run reports it if it has expired.
    }
  }
  return { instanceUrl: login.instanceUrl, accessToken: login.accessToken, username: login.username, orgId: login.orgId };
}
