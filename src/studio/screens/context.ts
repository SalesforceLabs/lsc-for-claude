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
}
