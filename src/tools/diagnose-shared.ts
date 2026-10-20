import { withSharedReads } from "../config/read-cache.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import { diagnose, diagnosisItems, type DiagnosisItem } from "../validation/diagnose.js";

export interface DiagnosisPayload {
  items: DiagnosisItem[];
  checkedOrg: string | null;
  orgNote?: string;
}

/** Match a symptom and, unless `checkOrg` is false, check the causes against the connected org. Shared by studio_diagnose and diagnose_lsc_issue. */
export async function diagnosePayload(text: string, checkOrg: boolean | undefined): Promise<DiagnosisPayload> {
  let org: string | undefined;
  let orgNote: string | undefined;
  if (checkOrg !== false) {
    const connection = await validateOrgConnection();
    if (connection.valid && connection.targetOrg) org = connection.targetOrg;
    else orgNote = connection.error || "No Salesforce org connected.";
  }
  const diagnosis = await (org ? withSharedReads(() => diagnose(text, org)) : diagnose(text));
  return { items: diagnosisItems(diagnosis), checkedOrg: org ?? null, ...(orgNote ? { orgNote } : {}) };
}
