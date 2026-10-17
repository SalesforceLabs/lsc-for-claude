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
  annotateSharing,
  loadDbSchemaEntries,
  mayOvercount,
  upperBoundRecords,
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
  DEFAULT_TELEMETRY_DAYS,
  METRICS,
  effectiveThresholds,
  evaluateMetric,
  overallStatus,
} from "./nfr.js";
import { DEFAULT_SELECT_COUNT, resolvePersonaUsers } from "./users.js";

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

/** Where a run is: 1-based persona and user positions, and tables counted in the current territory pass. */
export interface StepProgress {
  persona?: number;
  personas?: number;
  user?: number;
  users?: number;
  tables?: { done: number; total: number };
}

/**
 * Progress callback; `step` is a short human-readable description of the work
 * starting now. Called again with the same step as tables are counted.
 */
export type StepHook = (step: string, progress?: StepProgress) => void;

export async function profileUsers(
  configOrg: OrgQuerier,
  countOrg: OrgQuerier,
  userRefs: string[],
  opts: { territory?: string; maxTerritories?: number; onStep?: StepHook } & Partial<ProfileOptions> = {}
): Promise<UserVolume[]> {
  const options: ProfileOptions = { ...DEFAULT_PROFILE_OPTIONS, ...opts };
  opts.onStep?.("Reading DB Schema records");
  const entries = await loadDbSchemaEntries(configOrg);
  const results: UserVolume[] = [];

  for (const [index, ref] of userRefs.entries()) {
    const at = { user: index + 1, users: userRefs.length };
    let user: UserContext;
    opts.onStep?.(`Loading ${ref}`, at);
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
      const step = `Counting ${tables.length} tables for ${user.username}${territory ? ` in ${territory.name}` : ""}`;
      opts.onStep?.(step, { ...at, tables: { done: 0, total: tables.length } });
      volumes.push(
        await profileTerritory(countOrg, user, territory, tables, options, (done, total) =>
          opts.onStep?.(step, { ...at, tables: { done, total } })
        )
      );
    }

    const { permissionSets, ...rest } = user;
    results.push({
      user: { ...rest, permissionSetCount: permissionSets.size },
      tableCount: tables.length,
      territories: volumes,
    });
  }
  opts.onStep?.("Checking object sharing");
  await annotateSharing(configOrg, results.flatMap((r) => r.territories));
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
  /** Usernames (or ids) actually tested, in order: the persona's own users, then those `select` picked. */
  users: string[];
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
  options: Partial<ProfileOptions> & { onStep?: StepHook } = {}
): Promise<AssessmentResult> {
  const personas: PersonaResult[] = [];
  for (const [index, persona] of profile.personas.entries()) {
    const prefix = `${persona.name} (${index + 1}/${profile.personas.length})`;
    const at = { persona: index + 1, personas: profile.personas.length };
    const onStep: StepHook | undefined =
      options.onStep && ((step, progress) => options.onStep?.(`${prefix}: ${step}`, { ...at, ...progress }));

    let users = persona.users ?? [];
    let selectError: string | undefined;
    if (persona.select) {
      onStep?.(`Selecting the heaviest ${persona.select.profile} users`);
      try {
        users = (await resolvePersonaUsers(configOrg, persona, profile.telemetry?.days ?? DEFAULT_TELEMETRY_DAYS)).users;
      } catch (e) {
        selectError = `Couldn't select ${persona.select.profile} users: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const volumes = users.length
      ? await profileUsers(configOrg, countOrg, users, {
          territory: persona.territory,
          ...options,
          onStep,
        })
      : [];
    if (selectError || (persona.select && users.length === 0)) {
      const profileName = persona.select?.profile ?? "";
      volumes.unshift({
        user: { id: "", username: "", name: `${profileName} users`, profileId: "", profileName, territories: [], permissionSetCount: 0 },
        tableCount: 0,
        territories: [],
        error: selectError ?? `No active users have the profile “${profileName}”.`,
      });
    }

    let telemetry: TelemetrySummary | undefined;
    let telemetryError: string | undefined;
    const usernames = volumes.map((v) => v.user.username).filter(Boolean);
    if (usernames.length === 0) {
      // An empty username filter would read every user's syncs.
      telemetryError = "No users to read telemetry for.";
    } else {
      onStep?.("Reading field telemetry");
      try {
        telemetry = (
          await loadTelemetry(configOrg, describeTelemetryFields, {
            days: profile.telemetry?.days ?? DEFAULT_TELEMETRY_DAYS,
            usernames,
          })
        ).summary;
      } catch (e) {
        telemetryError = e instanceof Error ? e.message : String(e);
      }
    }
    const evaluations = evaluatePersona(profile, persona, volumes, telemetry);
    personas.push({
      persona,
      users,
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
        const via = t.note ?? (t.idTag ? `via ${t.idTag}` : "");
        const scope = mayOvercount(t) ? `org-wide count, ${t.sharingModel ?? "unknown"} sharing — upper bound` : "";
        const note = t.status === "counted" ? [via, scope].filter(Boolean).join("; ") : `**${t.status}**: ${t.note ?? ""}`;
        out += `| ${t.sobject} | ${t.status === "counted" ? fmt(t.records) : "—"} | ${fmt(t.deviceRequests ?? undefined)} | ${t.matchedBy} | ${note.replace(/\|/g, "\\|")} |\n`;
      }
      if (terr.tables.length > topTables) {
        out += `\n*${terr.tables.length - topTables} smaller table(s) omitted.*\n`;
      }
      const upper = upperBoundRecords(terr);
      if (upper > 0) {
        out += `\n${fmt(upper)} of these records come from tables whose filter isn't scoped to the user, on objects with restricted sharing — counted org-wide, so the user may download fewer.\n`;
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

  const o = summary.outcomes;
  let out = `**Window:** last ${days} day(s) · **Syncs:** ${summary.samples} · **Failure rate:** ${fmt(summary.failureRatePct)}%\n\n`;
  out += `Outcomes: ${o.completed} completed · ${o.failed} failed downloads · ${o.cancelled} cancelled · ${o["stopped-early"]} stopped before downloading. The failure rate counts failed downloads against completed and failed syncs only; timings use completed syncs.\n\n`;
  out += `| Metric | n | p50 | p90 | p95 | max | unit |\n|---|---:|---:|---:|---:|---:|---|\n`;
  out += row("Initial sync (total)", summary.initial.total, "s");
  out += row("Initial sync (data download)", summary.initial.download, "s");
  out += row("Initial sync records (excl. files and attachments)", summary.initial.records, "records");
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
    const select = p.persona.select;
    if (select) {
      const listed = new Set((p.persona.users ?? []).map((u) => u.trim().toLowerCase()));
      const picked = (p.users ?? []).filter((u) => !listed.has(u.toLowerCase()));
      out += `**Users:** the ${select.count ?? DEFAULT_SELECT_COUNT} heaviest active users with the profile ${select.profile}`;
      out += picked.length ? ` — ${picked.join(", ")}` : " — none found";
      out += listed.size ? `, plus ${listed.size} listed in the plan` : "";
      out += `\n\n`;
    }
    out += renderEvaluations(p.evaluations) + "\n";
    out += `## Predicted sync volume\n\n` + renderVolumes(p.volumes, 10);
    out += `## Field telemetry (DeviceSyncSummary)\n\n`;
    if (p.telemetryError) out += `➖ ${p.telemetryError}\n\n`;
    else if (p.telemetry && p.telemetry.samples > 0) out += renderTelemetry(p.telemetry, days) + "\n";
    else out += `➖ No syncs recorded for these users in the last ${days} day(s).\n\n`;
  }
  out += `---\n\n**Legend:** ✅ pass · ⚠️ warn · ❌ fail · ℹ️ measured, no threshold in profile · ➖ no data\n\n`;
  out += `**Method notes:** Predicted volumes replay each persona user's own DB Schema filters (their profile, permission sets, territories, and {USER.*} tags) with COUNT() queries as the connected user. Tables whose filter isn't scoped to the user are counted org-wide, which is exact for objects every user can read and an upper bound (flagged) where sharing is restricted. Device request counts follow the app's legacy visibility-pass chunking and are an estimate. Telemetry comes from real devices and reflects their hardware and networks.\n`;
  return out;
}
