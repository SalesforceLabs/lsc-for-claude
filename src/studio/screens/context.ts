/**
 * What a native screen's collector gets: the viewer, the org, and the
 * device's sync scope. Collectors are read-only (SOQL and REST GETs) and run
 * live for each preview, as the viewer — never saved with the snapshot.
 */

import type { Row } from "../helpers.js";
import type { SnapshotCore } from "../published.js";

export interface ScreenContext {
  core: SnapshotCore;
  userId: string;
  org: string;
  /** The viewer's territories in the active model. */
  territories: { id: string; name: string }[];
  /** The viewer's time zone and locale (`en-US` form), for formatting like the device. */
  format: { timeZone: string; locale: string };
  /**
   * The DB Schema filter the device downloads `table` with, the viewer's tags
   * filled in: undefined = a table it doesn't sync, null = a filter that can't
   * be reproduced, "" = every record the user can read.
   */
  scope: (table: string) => string | null | undefined;
  /** Admin Console settings as the viewer's device reads them, by category. */
  config: (categories: string[]) => Promise<Record<string, Row>>;
  /** Record what a screen couldn't read in full (shown with the preview; a load with notes isn't cached). */
  note: (message: string) => void;
}

/** Errors that mean too much data or too slow an answer, not "this org doesn't have it": worth a note, and never cached. */
const SCALE_ERROR =
  /too many|timed out|took longer than|didn't answer within|running for too long|QUERY_TIMEOUT|REQUEST_LIMIT_EXCEEDED|EXCEEDED_ID_LIMIT|SERVER_UNAVAILABLE|UNABLE_TO_LOCK_ROW|socket hang up|ECONN|ETIMEDOUT|ENOTFOUND|HTTP 5\d\d/i;

export function isScaleError(err: unknown): boolean {
  return SCALE_ERROR.test(err instanceof Error ? err.message : String(err));
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A `.catch` for a read whose failure leaves part of a screen empty: notes it
 * when the cause is scale (so the empty part isn't mistaken for no data), and
 * stays quiet when the org simply lacks the object or field.
 */
export function softFail<T>(ctx: Pick<ScreenContext, "note">, what: string, fallback: T): (err: unknown) => T {
  return (err) => {
    if (isScaleError(err)) ctx.note(`${what}: ${errorText(err)}`);
    return fallback;
  };
}

/** Reject if `p` takes longer than `ms`; the work behind it isn't cancelled, but it's no longer waited on. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}
