/** Reads the org as a test user (a mobile login Studio made), for the builder's describe and sample calls. */

import { createTokenSession, type DeviceHttp, type TokenLogin } from "../../perf/device/session.js";

const API = "/services/data/v68.0";

export type RunAs = TokenLogin;

/** Thrown for an expired or refused login, so the turn says "sign in again" instead of falling back to the admin. */
export class RunAsError extends Error {}

/** A GET as the login; the token stays inside the session (Salesforce https hosts only) and never appears in an error. */
export async function userGet(login: RunAs, path: string, http: DeviceHttp = createTokenSession(login).http): Promise<{ status: number; data: unknown }> {
  const res = await http({ method: "GET", url: `${API}${path}`, headers: { Accept: "application/json" } });
  if (res.status === 401) throw new RunAsError(`${login.username}'s login has expired — sign in again.`);
  let data: unknown = null;
  try {
    const text = res.body.toString("utf8");
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** The message of a platform error body. */
export function errorMessage(data: unknown, fallback: string): string {
  const first = (Array.isArray(data) ? data[0] : data) as { message?: unknown } | undefined;
  return typeof first?.message === "string" ? first.message : fallback;
}
