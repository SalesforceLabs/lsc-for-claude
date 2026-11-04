/**
 * Visit Engagement: structure data for the preview (owned by the structure stream; see ./index.ts).
 * Settings, the account to visit record type map, compliance statements and
 * the attendees of group visits: read-only, bounded SOQL, each part failing soft on its own.
 */

import { query, type Row } from "../../helpers.js";
import { configRecords } from "../fabs.js";
import { type ScreenContext, softFail } from "../context.js";

export interface VisitStructure {
  /** ProviderVisitSettings.ShowDocumentId (default true): the Submit menu's "Document ID" item. */
  showDocumentId: boolean;
  /** ProviderVisitSettings.DefaultVisitDuration in minutes (30 when unset). */
  durationMinutes: number;
  /** AccountProviderVisitRecordTypeMapping: which Visit record types an account record type may use (names), in sort order. */
  recordTypeMap: { accountRecordType: string; visitRecordType: string; sort: number }[];
  /** ComplianceStatementDef rows for the Visit module, agreements first by sort order. */
  compliance: { id: string; label: string; required: boolean; sort: number; note?: boolean }[];
  /** Child visits (attendees) by parent visit Id. */
  attendees: Record<string, { id: string; name: string; account?: string; status?: string }[]>;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const key = (row: Row | undefined, k: string): unknown =>
  row?.[Object.keys(row).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k];

export async function collectVisitStructure(ctx: ScreenContext): Promise<VisitStructure> {
  const { org, adminOrg } = ctx;
  const [cfg, mapping, rtRows, defs, kids] = await Promise.all([
    ctx.config(["ProviderVisitSettings"]).catch(() => ({}) as Record<string, Row>),
    configRecords("AccountProviderVisitRecordTypeMapping", adminOrg).catch(
      softFail(ctx, "Visit record types", [])
    ),
    query(
      `SELECT Id, Name, SobjectType FROM RecordType WHERE SobjectType IN ('Account','ProviderVisit','Visit') AND IsActive = true LIMIT 500`,
      org
    ).catch(softFail(ctx, "Record types", [] as Row[])),
    ctx.scope("ComplianceStatementDef") === undefined
      ? Promise.resolve([] as Row[])
      : // Fields from the server package (MngEventConstants CMPSTMT_*); the org's Visit statements are ModuleType 'Visit'.
        query(
          `SELECT Id, StatementType, StatementText, StatementRequirementLevel, DisplayOrder FROM ComplianceStatementDef WHERE ModuleType = 'Visit' AND StatementType IN ('ComplianceAgreement','ComplianceNote') ORDER BY DisplayOrder LIMIT 200`,
          org
        ).catch(() =>
          query(`SELECT FIELDS(STANDARD) FROM ComplianceStatementDef LIMIT 200`, org).catch(
            softFail(ctx, "Compliance statements", [] as Row[])
          )
        ),
    query(
      `SELECT Id, Name, ParentVisitId, Status, Account.Name FROM Visit WHERE ParentVisitId != null AND CreatedDate = LAST_N_DAYS:90 LIMIT 500`,
      org
    ).catch(softFail(ctx, "Attendee visits", [] as Row[])),
  ]);

  const rtName = new Map(rtRows.map((r) => [str(r.Id), str(r.Name)]));
  const settings = cfg.ProviderVisitSettings;
  const duration = Number(key(settings, "DefaultVisitDuration"));
  const show = key(settings, "ShowDocumentId");

  const attendees: VisitStructure["attendees"] = {};
  for (const k of kids) {
    const parent = str(k.ParentVisitId);
    (attendees[parent] ??= []).push({
      id: str(k.Id),
      name: str(k.Name),
      account: str((k.Account as Row | null)?.Name) || undefined,
      status: str(k.Status) || undefined,
    });
  }

  return {
    showDocumentId: show === undefined || show === null ? true : String(show) !== "false",
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 30,
    recordTypeMap: mapping
      .map((m) => ({
        accountRecordType: rtName.get(str(m.fields.AccountRecordTypeId)) ?? "",
        visitRecordType: rtName.get(str(m.fields.ProviderVisitRecordTypeId)) ?? "",
        sort: Number(m.fields.SortOrder ?? 0),
      }))
      .filter((m) => m.accountRecordType && m.visitRecordType)
      .sort((a, b) => a.sort - b.sort),
    compliance: defs
      .map((d) => ({
        id: str(d.Id),
        label: str(key(d, "StatementText") || key(d, "StatementLabelText") || key(d, "Name")),
        type: str(key(d, "StatementType") || key(d, "Type")).toLowerCase(),
        required: /required|mandatory/i.test(
          str(key(d, "StatementRequirementLevel") || key(d, "ValidationType"))
        ),
        sort: Number(key(d, "DisplayOrder") ?? key(d, "SortOrder") ?? 0),
        module: str(key(d, "Module") || key(d, "ModuleType")).toLowerCase(),
        active: key(d, "IsActive") !== false,
      }))
      .filter(
        (d) =>
          d.label &&
          d.active &&
          (d.type === "" || /agreement|note/.test(d.type)) &&
          (d.module === "" || /call|visit/.test(d.module))
      )
      .sort((a, b) => a.sort - b.sort)
      .map(({ id, label, required, sort, type }) => ({
        id,
        label,
        required: required && !/note/.test(type),
        sort,
        note: /note/.test(type),
      })),
    attendees,
  };
}
