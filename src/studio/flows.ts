/**
 * The org's record-triggered flows, read once and shared.
 *
 * FlowDefinitionView is slow on the server (12-24 s per distinct query), so the feature maps and the
 * "What changed" list ask it for the same rows — every record-triggered flow with its modified date —
 * and each filters them as its own WHERE clause would have.
 */

import { sharedRead } from "../config/read-cache.js";
import { query, type Row } from "./helpers.js";

export const RECORD_TRIGGERED_FLOWS_SQL =
  "SELECT DurableId, ApiName, Label, ProcessType, TriggerType, IsActive, TriggerObjectOrEventLabel, LastModifiedDate FROM FlowDefinitionView WHERE TriggerType IN ('RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete')";

export function recordTriggeredFlows(org: string): Promise<Row[]> {
  return sharedRead(org, "studio:record-triggered-flows", () =>
    query(RECORD_TRIGGERED_FLOWS_SQL, org)
  );
}
