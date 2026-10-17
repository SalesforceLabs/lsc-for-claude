/**
 * Orchestrates sync-volume profiling and field telemetry for personas, and
 * renders the results as markdown.
 */

import {
  type OrgQuerier,
  type TerritoryVolume,
  type UserContext,
  type ProfileOptions,
  DEFAULT_PROFILE_OPTIONS,
  loadDbSchemaEntries,
  loadUserContext,
  profileTerritory,
  selectApplicableTables,
} from "./sync-volume.js";
import {
  type SyncSample,
  type TelemetrySummary,
  buildTelemetryQuery,
  summarize,
  toSyncSample,
} from "./telemetry.js";
import {
  type MetricEvaluation,
  type NfrProfile,
  type Persona,
  METRICS,
  effectiveThresholds,
  evaluateMetric,
  overallStatus,
} from "./nfr.js";

export interface UserVolume {
  user: Omit<UserContext, "permissionSets"> & { permissionSetCount: number };
  tableCount: number;
  territories: TerritoryVolume[];
  error?: string;
}

/** Worst territory = the one with the most predicted records. */
export function worstTerritory(volume: UserVolume): TerritoryVolume | undefined {
  return [...volume.territories].sort((a, b) => b.totalRecords - a.totalRecords)[0];
}

export async function profileUsers(
  configOrg: OrgQuerier,
  countOrg: OrgQuerier,
  userRefs: string[],
  opts: { territory?: string; maxTerritories?: number } & Partial<ProfileOptions> = {}
): Promise<UserVolume[]> {
  const options: ProfileOptions = { ...DEFAULT_PROFILE_OPTIONS, ...opts };
  const entries = await loadDbSchemaEntries(configOrg);
  const results: UserVolume[] = [];

  for (const ref of userRefs) {
    let user: UserContext;
    try {
      user = await loadUserContext(configOrg, ref);
    } catch (e) {
      results.push({
        user: { id: "", username: ref, name: ref, profileId: "", profileName: "", territories: [], permissionSetCount: 0 },
        tableCount: 0,
        territories: [],
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const tables = selectApplicableTables(entries, user);
    let territories: Array<{ id: string; name: string } | null> = user.territories;
    if (opts.territory) {
      const wanted = opts.territory.toLowerCase();
      territories = user.territories.filter(
        (t) => t.name.toLowerCase() === wanted || t.id === opts.territory
      );
    }
    if (territories.length === 0) territories = [null];
    territories = territories.slice(0, opts.maxTerritories ?? 5);

    const volumes: TerritoryVolume[] = [];
    for (const territory of territories) {
      volumes.push(await profileTerritory(countOrg, user, territory, tables, options));
    }

    const { permissionSets, ...rest } = user;
    results.push({
      user: { ...rest, permissionSetCount: permissionSets.size },
      tableCount: tables.length,
      territories: volumes,
    });
  }
  return results;
}

export async function loadTelemetry(
  org: OrgQuerier,
  describeFields: () => Promise<Set<string>>,
  filters: { days: number; usernames?: string[]; profileName?: string }
): Promise<{ samples: SyncSample[]; summary: TelemetrySummary }> {
  const fields = await describeFields();
  if (fields.size === 0) {
    throw new Error("DeviceSyncSummary is not available in this org (describe returned no fields).");
  }
  const result = await org.soql(buildTelemetryQuery(fields, filters));
  if (!result.success) throw new Error(`DeviceSyncSummary query failed: ${result.error}`);
  const samples = (result.data?.records ?? [])
    .map((r) => toSyncSample(r))
    .filter((s): s is SyncSample => s !== null);
  return { samples, summary: summarize(samples) };
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export interface PersonaResult {
  persona: Persona;
  volumes: UserVolume[];
  telemetry?: TelemetrySummary;
  telemetryError?: string;
  evaluations: MetricEvaluation[];
  status: "pass" | "warn" | "fail";
}

export interface AssessmentResult {
  profile: string;
  org: string;
  generatedAt: string;
  status: "pass" | "warn" | "fail";
  personas: PersonaResult[];
}

function maxOf(values: number[]): number | undefined {
  return values.length ? Math.max(...values) : undefined;
}

export function evaluatePersona(
  profile: NfrProfile,
  persona: Persona,
  volumes: UserVolume[],
  telemetry: TelemetrySummary | undefined
): MetricEvaluation[] {
  const t = effectiveThresholds(profile, persona);
  const worst = volumes
    .map((v) => ({ v, terr: worstTerritory(v) }))
    .filter((x): x is { v: UserVolume; terr: TerritoryVolume } => x.terr !== undefined);

  const byTotal = [...worst].sort((a, b) => b.terr.totalRecords - a.terr.totalRecords)[0];
  const byTable = [...worst].sort(
    (a, b) => (b.terr.largestTable?.records ?? 0) - (a.terr.largestTable?.records ?? 0)
  )[0];
  const byRequests = [...worst].sort(
    (a, b) => b.terr.totalDeviceRequests - a.terr.totalDeviceRequests
  )[0];
  const where = (x: { v: UserVolume; terr: TerritoryVolume } | undefined) =>
    x ? `${x.v.user.username}${x.terr.territory ? ` / ${x.terr.territory.name}` : ""}` : undefined;

  return [
    evaluateMetric("predictedRecordsTotal", maxOf(worst.map((x) => x.terr.totalRecords)), t.predictedRecordsTotal, where(byTotal)),
    evaluateMetric(
      "predictedRecordsPerTable",
      maxOf(worst.map((x) => x.terr.largestTable?.records ?? 0)),
      t.predictedRecordsPerTable,
      byTable?.terr.largestTable ? `${byTable.terr.largestTable.sobject} for ${where(byTable)}` : undefined
    ),
    evaluateMetric("deviceSoqlRequests", maxOf(worst.map((x) => x.terr.totalDeviceRequests)), t.deviceSoqlRequests, where(byRequests)),
    evaluateMetric("initialSyncP95Sec", telemetry?.initial.total.p95, t.initialSyncP95Sec, telemetry ? `n=${telemetry.initial.total.n}` : undefined),
    evaluateMetric("deltaSyncP95Sec", telemetry?.delta.total.p95, t.deltaSyncP95Sec, telemetry ? `n=${telemetry.delta.total.n}` : undefined),
    evaluateMetric("metadataDownloadP95Sec", telemetry?.metadataDownload.p95, t.metadataDownloadP95Sec, telemetry ? `n=${telemetry.metadataDownload.n}` : undefined),
    evaluateMetric("syncFailureRatePct", telemetry?.failureRatePct, t.syncFailureRatePct, telemetry ? `n=${telemetry.samples}` : undefined),
    evaluateMetric("dbSizeP95Gb", telemetry?.dbSizeGb.p95, t.dbSizeP95Gb, telemetry ? `n=${telemetry.dbSizeGb.n}` : undefined),
  ];
}

export async function runAssessment(
  profile: NfrProfile,
  orgName: string,
  configOrg: OrgQuerier,
  countOrg: OrgQuerier,
  describeTelemetryFields: () => Promise<Set<string>>,
  options: Partial<ProfileOptions> = {}
): Promise<AssessmentResult> {
  const personas: PersonaResult[] = [];
  for (const persona of profile.personas) {
    const volumes = await profileUsers(configOrg, countOrg, persona.users, {
      territory: persona.territory,
      ...options,
    });
    let telemetry: TelemetrySummary | undefined;
    let telemetryError: string | undefined;
    try {
      telemetry = (
        await loadTelemetry(configOrg, describeTelemetryFields, {
          days: profile.telemetry?.days ?? 30,
          usernames: volumes.map((v) => v.user.username).filter(Boolean),
        })
      ).summary;
    } catch (e) {
      telemetryError = e instanceof Error ? e.message : String(e);
    }
    const evaluations = evaluatePersona(profile, persona, volumes, telemetry);
    personas.push({
      persona,
      volumes,
      telemetry,
      telemetryError,
      evaluations,
      status: overallStatus(evaluations),
    });
  }
  return {
    profile: profile.name,
    org: orgName,
    generatedAt: new Date().toISOString(),
    status: personas.some((p) => p.status === "fail")
      ? "fail"
      : personas.some((p) => p.status === "warn")
        ? "warn"
        : "pass",
    personas,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<string, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  "no-data": "➖",
  "no-threshold": "ℹ️",
};

function fmt(n: number | undefined, digits = 1): string {
  if (n === undefined) return "—";
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(digits);
}

export function renderVolumes(volumes: UserVolume[], topTables = 15): string {
  let out = "";
  for (const v of volumes) {
    out += `## ${v.user.name} (${v.user.username})\n\n`;
    if (v.error) {
      out += `❌ ${v.error}\n\n`;
      continue;
    }
    out += `- **Profile:** ${v.user.profileName}\n- **Permission sets:** ${v.user.permissionSetCount}\n- **DB Schema tables synced:** ${v.tableCount}\n- **Territories (active model):** ${v.user.territories.length || "none"}\n\n`;
    for (const terr of v.territories) {
      out += `### ${terr.territory ? `Territory: ${terr.territory.name}` : "No territory"}\n\n`;
      out += `**Predicted records:** ${fmt(terr.totalRecords)} · **Estimated device SOQL requests:** ${fmt(terr.totalDeviceRequests)}\n\n`;
      out += `| SObject | Records | Device requests | Matched by | Note |\n|---|---:|---:|---|---|\n`;
      for (const t of terr.tables.slice(0, topTables)) {
        const note = t.status === "counted" ? (t.note ?? (t.idTag ? `via ${t.idTag}` : "")) : `**${t.status}**: ${t.note ?? ""}`;
        out += `| ${t.sobject} | ${t.status === "counted" ? fmt(t.records) : "—"} | ${fmt(t.deviceRequests ?? undefined)} | ${t.matchedBy} | ${note.replace(/\|/g, "\\|")} |\n`;
      }
      if (terr.tables.length > topTables) {
        out += `\n*${terr.tables.length - topTables} smaller table(s) omitted.*\n`;
      }
      const problems = terr.tables.filter((t) => t.status !== "counted");
      if (problems.length) {
        out += `\n${problems.length} table(s) could not be counted — see notes. Errors usually mean the WhereSoql filter is invalid for this user and will fail on device too.\n`;
      }
      out += "\n";
    }
  }
  return out;
}

export function renderTelemetry(summary: TelemetrySummary, days: number): string {
  const row = (label: string, d: { n: number; p50?: number; p90?: number; p95?: number; max?: number }, unit: string) =>
    `| ${label} | ${d.n} | ${fmt(d.p50)} | ${fmt(d.p90)} | ${fmt(d.p95)} | ${fmt(d.max)} | ${unit} |\n`;

  let out = `**Window:** last ${days} day(s) · **Syncs:** ${summary.samples} · **Failure rate:** ${fmt(summary.failureRatePct)}%\n\n`;
  out += `| Metric | n | p50 | p90 | p95 | max | unit |\n|---|---:|---:|---:|---:|---:|---|\n`;
  out += row("Initial sync (total)", summary.initial.total, "s");
  out += row("Initial sync (data download)", summary.initial.download, "s");
  out += row("Initial sync records", summary.initial.records, "records");
  out += row("Delta sync (total)", summary.delta.total, "s");
  out += row("Delta sync (download)", summary.delta.download, "s");
  out += row("Delta sync (upload)", summary.delta.upload, "s");
  out += row("Metadata cache download", summary.metadataDownload, "s");
  out += row("Device DB size", summary.dbSizeGb, "GB");

  if (summary.byNetwork.length) {
    out += `\n**Delta sync p95 by network:** ${summary.byNetwork.map((g) => `${g.key} ${fmt(g.deltaP95)}s (n=${g.n})`).join(" · ")}\n`;
  }
  if (summary.byAppVersion.length) {
    out += `\n| App version | Syncs | Delta p95 (s) | Failure rate |\n|---|---:|---:|---:|\n`;
    for (const g of summary.byAppVersion) {
      out += `| ${g.key} | ${g.n} | ${fmt(g.deltaP95)} | ${fmt(g.failureRatePct)}% |\n`;
    }
  }
  if (summary.slowest.length) {
    out += `\n**Slowest syncs:**\n\n| When | User | Kind | Total (s) | Records |\n|---|---|---|---:|---:|\n`;
    for (const s of summary.slowest) {
      out += `| ${s.createdDate} | ${s.user} | ${s.kind} | ${fmt(s.totalSec)} | ${fmt(s.downloadedRecords)} |\n`;
    }
  }
  return out;
}

export function renderEvaluations(evals: MetricEvaluation[]): string {
  let out = `| | Metric | Measured | Warn | Fail | Where |\n|---|---|---:|---:|---:|---|\n`;
  for (const e of evals) {
    const m = METRICS[e.metric];
    out += `| ${STATUS_ICON[e.status]} | ${m.label} | ${fmt(e.value)} ${e.value !== undefined ? m.unit : ""} | ${fmt(e.threshold?.warn)} | ${fmt(e.threshold?.fail)} | ${e.detail ?? ""} |\n`;
  }
  return out;
}

export function renderAssessment(result: AssessmentResult, days: number): string {
  let out = `# LSC Performance Assessment: ${result.profile}\n\n**Org:** ${result.org}\n**Generated:** ${result.generatedAt}\n**Overall:** ${STATUS_ICON[result.status]} ${result.status.toUpperCase()}\n\n`;
  for (const p of result.personas) {
    out += `---\n\n# Persona: ${p.persona.name} ${STATUS_ICON[p.status]} ${p.status.toUpperCase()}\n\n`;
    out += renderEvaluations(p.evaluations) + "\n";
    out += `## Predicted sync volume\n\n` + renderVolumes(p.volumes, 10);
    out += `## Field telemetry (DeviceSyncSummary)\n\n`;
    if (p.telemetryError) out += `➖ ${p.telemetryError}\n\n`;
    else if (p.telemetry && p.telemetry.samples > 0) out += renderTelemetry(p.telemetry, days) + "\n";
    else out += `➖ No syncs recorded for these users in the last ${days} day(s).\n\n`;
  }
  out += `---\n\n**Legend:** ✅ pass · ⚠️ warn · ❌ fail · ℹ️ measured, no threshold in profile · ➖ no data\n\n`;
  out += `**Method notes:** Predicted volumes replay each user's DB Schema filters with COUNT() queries as the connected org user — run with \`countAsOrg\` set to the persona's own login for sharing-exact counts. Device request counts follow the app's legacy visibility-pass chunking and are an estimate. Telemetry comes from real devices and reflects their hardware and networks.\n`;
  return out;
}
