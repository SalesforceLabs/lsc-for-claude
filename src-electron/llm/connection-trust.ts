import { isGateway, type Connection } from "./connection.js";

/**
 * Connections reach the main process from the renderer, which shows replies and org data, so a
 * connection there is not trusted on its own word:
 *
 * - A gateway's saved token goes only to the gateway it was saved for. A connection naming another
 *   URL has to be given the token again; otherwise a renderer could send the saved token anywhere.
 * - A token command is a shell command. It runs only when it is the saved connection's (written by
 *   the main process after the user connected with it) or the user has just confirmed it in a native
 *   dialog, which the renderer can't answer.
 */

/** The scheme, host and port a URL sends to, or null. */
export function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

/** Keychain name of the origin a gateway's saved token belongs to. */
export const secretOriginName = (secretName: string) => `${secretName}:origin`;

/**
 * Whether the saved token may be sent with `connection`. Official APIs have fixed URLs. For a gateway
 * the token's recorded origin must match; tokens saved before origins were recorded belong to the saved
 * connection's gateway.
 */
export function savedSecretAllowed(connection: Connection, savedOrigin: string | undefined, saved: Connection | undefined): boolean {
  if (!isGateway(connection.kind)) return true;
  const origin = originOf(connection.baseUrl);
  if (!origin) return false;
  if (savedOrigin) return savedOrigin === origin;
  return saved?.kind === connection.kind && originOf(saved.baseUrl) === origin;
}

/** Whether `connection`'s token command may run without asking: none, the saved one, or one confirmed this session. */
export function tokenCommandTrusted(connection: Connection, saved: Connection | undefined, confirmed: ReadonlySet<string>): boolean {
  const command = connection.tokenCommand?.trim();
  if (!command || !isGateway(connection.kind)) return true;
  return command === saved?.tokenCommand?.trim() || confirmed.has(command);
}
