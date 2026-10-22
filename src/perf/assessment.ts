/**
 * Orchestrates sync-volume profiling and field telemetry for personas, and
 * renders the results as markdown.
 */

import {
  type OrgQuerier,
  type TerritoryVolume,
  type UserContext,
  type ProfileOptions,
  type ApplicableTable,
  DEFAULT_PROFILE_OPTIONS,
  annotateSharing,
  incompleteTables,
  loadDbSchemaEntries,
  mayOvercount,
  upperBoundRecords,
  loadUserContext,
  mapWithConcurrency,
  memoizeQuerier,
  pickLargestTerritories,
  profileTerritory,
  selectApplicableTables,
} from "./sync-volume.js";
import {
  type SyncSample,
  type TelemetryCoverage,
  type TelemetryFilters,
  type TelemetrySummary,
  TELEMETRY_ROW_LIMIT,
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
  markIncomplete,
  overallStatus,
} from "./nfr.js";
import { DEFAULT_SELECT_COUNT, resolvePersonaUsers } from "./users.js";
import { type CompiledSchemaSource, type SchemaSource, diffTables } from "./compiled-schema.js";

export interface UserVolume {
  user: Omit<UserContext, "permissionSets"> & { permissionSetCount: number };
  tableCount: number;
  territories: TerritoryVolume[];
  /** Where the table list came from: the user's own metadata download, the profile's compiled archive, or the raw DB Schema records. */
  schemaSource?: SchemaSource;
  /** How the table list was derived, and why the compiled schema wasn't used when it wasn't. */
  schemaNotes?: string[];
  /** Set when the territory cap left some of the user's territories out, e.g. "Checked the 5 largest of 40 territories". */
  territoryNote?: string;
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

/** Territories of one user counted at once; the shared limiter still caps requests in flight. */
const TERRITORY_CONCURRENCY = 3;

export async function profileUsers(
  configOrgIn: OrgQuerier,
  countOrgIn: OrgQuerier,
  userRefs: string[],
  opts: {
    territory?: string;
    maxTerritories?: number;
    onStep?: StepHook;
    /** Prefer the compiled metadata archive over DB Schema records; falls back per user. */
    compiledSchema?: CompiledSchemaSource;
  } & Partial<ProfileOptions> = {}
): Promise<UserVolume[]> {
  // One answer per distinct query for this call (the same COUNT() in several territories or for several users).
  const configOrg = memoizeQuerier(configOrgIn);
  const countOrg = countOrgIn === configOrgIn ? configOrg : memoizeQuerier(countOrgIn);
  // Users in the same territory share the id lists their tables are counted from.
  const options: ProfileOptions = {
    ...DEFAULT_PROFILE_OPTIONS,
    ...opts,
    idCache: opts.idCache ?? new Map(),
  };
  opts.onStep?.("Reading DB Schema records");
  const entries = await loadDbSchemaEntries(configOrg);

  // Each user's setup (account, table list, territories) is only reads, and users of one profile share
  // one archive download, so every user is prepared at once; the counting then runs user by user.
  type Prepared =
    | { error: UserVolume }
    | {
        user: UserContext;
        tables: ApplicableTable[];
        schemaSource: SchemaSource;
        schemaNotes: string[];
        territories: Array<{ id: string; name: string } | null>;
        territoryNote?: string;
      };
  const prepare = async (ref: string, index: number): Promise<Prepared> => {
    const at = { user: index + 1, users: userRefs.length };
    let user: UserContext;
    opts.onStep?.(`Loading ${ref}`, at);
    try {
      user = await loadUserContext(configOrg, ref);
    } catch (e) {
      return {
        error: {
          user: {
            id: "",
            username: ref,
            name: ref,
            profileId: "",
            profileName: "",
            territories: [],
            permissionSetCount: 0,
          },
          tableCount: 0,
          territories: [],
          error: e instanceof Error ? e.message : String(e),
        },
      };
    }

    const dbSchemaTables = selectApplicableTables(entries, user);
    let tables = dbSchemaTables;
    let schemaSource: SchemaSource = "db-schema";
    const schemaNotes: string[] = [];
    if (opts.compiledSchema) {
      opts.onStep?.(`Reading compiled metadata schema for ${user.username}`, at);
      const compiled = await opts.compiledSchema.tablesFor(user);
      if ("result" in compiled) {
        tables = compiled.result.tables;
        schemaSource = compiled.result.source ?? "compiled";
        schemaNotes.push(...compiled.result.notes);
        const diff = diffTables(tables, dbSchemaTables);
        if (diff.differing.length + diff.onlyCompiled.length + diff.onlyDbSchema.length > 0) {
          const list = (names: string[]) =>
            names.slice(0, 8).join(", ") + (names.length > 8 ? ", …" : "");
          const parts = [
            diff.differing.length
              ? `${diff.differing.length} table(s) have a different WhereSoql (${list(diff.differing)})`
              : "",
            diff.onlyCompiled.length
              ? `${diff.onlyCompiled.length} only in the compiled schema (${list(diff.onlyCompiled)})`
              : "",
            diff.onlyDbSchema.length
              ? `${diff.onlyDbSchema.length} only in DB Schema records (${list(diff.onlyDbSchema)})`
              : "",
          ].filter(Boolean);
          schemaNotes.push(`Compiled schema vs DB Schema records: ${parts.join("; ")}.`);
        } else {
          schemaNotes.push("Compiled schema and DB Schema records agree on tables and WhereSoql.");
        }
      } else {
        schemaNotes.push(
          `Used DB Schema records: compiled schema unavailable (${compiled.fallbackReason}).`
        );
      }
    }
    let territories: Array<{ id: string; name: string } | null> = user.territories;
    if (opts.territory) {
      const wanted = opts.territory.toLowerCase();
      territories = user.territories.filter(
        (t) => t.name.toLowerCase() === wanted || t.id === opts.territory
      );
    }
    if (territories.length === 0) territories = [null];
    let territoryNote: string | undefined;
    if (territories[0] !== null) {
      const cap = await pickLargestTerritories(
        countOrg,
        territories as Array<{ id: string; name: string }>,
        opts.maxTerritories ?? 5
      );
      territories = cap.picked;
      territoryNote = cap.note;
    }
    return { user, tables, schemaSource, schemaNotes, territories, territoryNote };
  };
  const prepared = userRefs.map((ref, index) => prepare(ref, index));
  // A later user's setup failing must not surface as an unhandled rejection while an earlier user counts.
  for (const p of prepared) p.catch(() => undefined);

  const results: UserVolume[] = [];
  for (const [index, pending] of prepared.entries()) {
    const at = { user: index + 1, users: userRefs.length };
    const prep = await pending;
    if ("error" in prep) {
      results.push(prep.error);
      continue;
    }
    const { user, tables, schemaSource, schemaNotes, territories, territoryNote } = prep;

    // Territories of one user count together (the id lists they share are read once); progress sums them.
    const doneBy = territories.map(() => 0);
    const step = (territory: { name: string } | null) =>
      `Counting ${tables.length} tables for ${user.username}${territory ? ` in ${territory.name}` : ""}`;
    opts.onStep?.(step(territories[0]), {
      ...at,
      tables: { done: 0, total: tables.length * territories.length },
    });
    const volumes: TerritoryVolume[] = await mapWithConcurrency(
      territories,
      TERRITORY_CONCURRENCY,
      (territory) => {
        const slot = territories.indexOf(territory);
        return profileTerritory(countOrg, user, territory, tables, options, (done) => {
          doneBy[slot] = done;
          opts.onStep?.(step(territory), {
            ...at,
            tables: {
              done: doneBy.reduce((a, b) => a + b, 0),
              total: tables.length * territories.length,
            },
          });
        });
      }
    );

    const { permissionSets, ...rest } = user;
    results.push({
      user: { ...rest, permissionSetCount: permissionSets.size },
      tableCount: tables.length,
      territories: volumes,
      ...(territoryNote ? { territoryNote } : {}),
      ...(opts.compiledSchema ? { schemaSource, schemaNotes } : {}),
    });
  }
  opts.onStep?.("Checking object sharing");
  await annotateSharing(
    configOrg,
    results.flatMap((r) => r.territories)
  );
  return results;
}

/** Users per telemetry query, so a long IN list stays inside the URL. */
const TELEMETRY_USER_CHUNK = 200;
/** Most slices a sampled window is cut into. */
const MAX_TELEMETRY_SLICES = 60;
/** Fewest syncs read from one slice of a sampled window. */
const MIN_SLICE_ROWS = 100;
const DAY_MS = 86_400_000;

type TelemetryRow = Record<string, unknown>;

async function telemetryRows(
  org: OrgQuerier,
  fields: Set<string>,
  filters: TelemetryFilters
): Promise<TelemetryRow[]> {
  const result = await org.soql(buildTelemetryQuery(fields, filters));
  if (!result.success) throw new Error(`DeviceSyncSummary query failed: ${result.error}`);
  return (result.data?.records ?? []) as TelemetryRow[];
}

function chunked<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size)
  );
}

/** The user filters a telemetry read is split into: ids where the usernames resolve, in chunks. */
async function telemetryScopes(
  org: OrgQuerier,
  filters: { usernames?: string[]; userIds?: string[] }
): Promise<Array<Pick<TelemetryFilters, "usernames" | "userIds">>> {
  if (filters.userIds?.length)
    return chunked(filters.userIds, TELEMETRY_USER_CHUNK).map((userIds) => ({ userIds }));
  if (!filters.usernames?.length) return [{}];
  const resolved: string[] = [];
  try {
    for (const names of chunked(filters.usernames, TELEMETRY_USER_CHUNK)) {
      const list = names.map((n) => `'${n.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(",");
      const result = await org.soql(`SELECT Id FROM User WHERE Username IN (${list})`);
      if (!result.success) throw new Error(result.error);
      resolved.push(...(result.data?.records ?? []).map((r) => String(r.Id)));
    }
  } catch {
    // The join on CreatedBy.Username is slower but reads the same rows.
    return chunked(filters.usernames, TELEMETRY_USER_CHUNK).map((usernames) => ({ usernames }));
  }
  // No such users means no syncs to read — never an unfiltered read.
  return chunked(resolved, TELEMETRY_USER_CHUNK).map((userIds) => ({ userIds }));
}

const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Read DeviceSyncSummary for the window. One query reads up to the row cap
 * (newest first); a window with more syncs than that is read again as slices of
 * the window with a cap each, so the percentiles describe the whole window
 * rather than only its newest days. The summary's `coverage` says which happened.
 */
export async function loadTelemetry(
  org: OrgQuerier,
  describeFields: () => Promise<Set<string>>,
  filters: { days: number; usernames?: string[]; userIds?: string[]; profileName?: string }
): Promise<{ samples: SyncSample[]; summary: TelemetrySummary }> {
  const fields = await describeFields();
  if (fields.size === 0) {
    throw new Error(
      "DeviceSyncSummary is not available in this org (describe returned no fields)."
    );
  }
  const scopes = await telemetryScopes(org, filters);
  const days = Math.max(1, Math.floor(filters.days));
  const base = { days, profileName: filters.profileName };

  let rows: TelemetryRow[] = [];
  let capped = false;
  if (scopes.length > 0) {
    const first = await mapWithConcurrency(scopes, DEFAULT_PROFILE_OPTIONS.concurrency, (scope) =>
      telemetryRows(org, fields, { ...base, ...scope })
    );
    rows = first.flat();
    capped = first.some((r) => r.length >= TELEMETRY_ROW_LIMIT);
  }

  let sliceDays: number | undefined;
  if (capped) {
    const size = Math.max(1, Math.ceil(days / MAX_TELEMETRY_SLICES));
    sliceDays = size;
    const slices = Math.ceil(days / size);
    const perSlice = Math.max(MIN_SLICE_ROWS, Math.floor(TELEMETRY_ROW_LIMIT / slices));
    const todayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const windowStart = todayStart - days * DAY_MS;
    const jobs = scopes.flatMap((scope) =>
      Array.from({ length: slices }, (_, i) => ({
        scope,
        range: {
          from: isoSeconds(windowStart + i * size * DAY_MS),
          to: isoSeconds(
            i === slices - 1 ? todayStart + DAY_MS : windowStart + (i + 1) * size * DAY_MS
          ),
        },
      }))
    );
    rows = (
      await mapWithConcurrency(jobs, DEFAULT_PROFILE_OPTIONS.concurrency, (job) =>
        telemetryRows(org, fields, { ...base, ...job.scope, range: job.range, limit: perSlice })
      )
    ).flat();
  }

  const seen = new Set<string>();
  const samples = rows
    .filter((r) => !seen.has(String(r.Id)) && seen.add(String(r.Id)))
    .map((r) => toSyncSample(r))
    .filter((s): s is SyncSample => s !== null)
    .sort((a, b) => (a.createdDate < b.createdDate ? 1 : a.createdDate > b.createdDate ? -1 : 0));
  const coverage: TelemetryCoverage = {
    mode: capped ? "sampled" : "all",
    limit: TELEMETRY_ROW_LIMIT,
    ...(sliceDays ? { sliceDays } : {}),
    ...(samples.length
      ? { oldest: samples[samples.length - 1].createdDate, newest: samples[0].createdDate }
      : {}),
  };
  return { samples, summary: { ...summarize(samples), coverage } };
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

  // A table that couldn't be counted contributes 0 to every volume metric, so
  // none of them may pass while one is missing.
  const gaps = incompleteSummary(volumes);
  const volume = (e: MetricEvaluation) => (gaps ? markIncomplete(e, gaps) : e);
  const sampled = telemetry?.coverage?.mode === "sampled" ? ", sampled" : "";

  return [
    volume(
      evaluateMetric(
        "predictedRecordsTotal",
        maxOf(worst.map((x) => x.terr.totalRecords)),
        t.predictedRecordsTotal,
        where(byTotal)
      )
    ),
    volume(
      evaluateMetric(
        "predictedRecordsPerTable",
        maxOf(worst.map((x) => x.terr.largestTable?.records ?? 0)),
        t.predictedRecordsPerTable,
        byTable?.terr.largestTable
          ? `${byTable.terr.largestTable.sobject} for ${where(byTable)}`
          : undefined
      )
    ),
    volume(
      evaluateMetric(
        "deviceSoqlRequests",
        maxOf(worst.map((x) => x.terr.totalDeviceRequests)),
        t.deviceSoqlRequests,
        where(byRequests)
      )
    ),
    evaluateMetric(
      "initialSyncP95Sec",
      telemetry?.initial.total.p95,
      t.initialSyncP95Sec,
      telemetry ? `n=${telemetry.initial.total.n}${sampled}` : undefined
    ),
    evaluateMetric(
      "deltaSyncP95Sec",
      telemetry?.delta.total.p95,
      t.deltaSyncP95Sec,
      telemetry ? `n=${telemetry.delta.total.n}${sampled}` : undefined
    ),
    evaluateMetric(
      "metadataDownloadP95Sec",
      telemetry?.metadataDownload.p95,
      t.metadataDownloadP95Sec,
      telemetry ? `n=${telemetry.metadataDownload.n}${sampled}` : undefined
    ),
    evaluateMetric(
      "syncFailureRatePct",
      telemetry?.failureRatePct,
      t.syncFailureRatePct,
      telemetry ? `n=${telemetry.samples}${sampled}` : undefined
    ),
    evaluateMetric(
      "dbSizeP95Gb",
      telemetry?.dbSizeGb.p95,
      t.dbSizeP95Gb,
      telemetry ? `n=${telemetry.dbSizeGb.n}${sampled}` : undefined
    ),
  ];
}

/**
 * Why a persona's volume numbers may be understated: tables that errored, timed
 * out, or were counted from a cut-off id list, and users who couldn't be loaded.
 * Undefined when everything was counted in full.
 */
export function incompleteSummary(volumes: UserVolume[]): string | undefined {
  const names = new Set<string>();
  for (const v of volumes)
    for (const terr of v.territories) for (const t of incompleteTables(terr)) names.add(t.sobject);
  const failedUsers = volumes.filter((v) => v.error).length;
  if (names.size === 0 && failedUsers === 0) return undefined;
  const list = [...names].slice(0, 6).join(", ") + (names.size > 6 ? ", …" : "");
  return [
    names.size
      ? `${names.size} table${names.size === 1 ? "" : "s"} could not be counted in full (${list})`
      : "",
    failedUsers ? `${failedUsers} user${failedUsers === 1 ? "" : "s"} could not be loaded` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function runAssessment(
  profile: NfrProfile,
  orgName: string,
  configOrgIn: OrgQuerier,
  countOrgIn: OrgQuerier,
  describeTelemetryFields: () => Promise<Set<string>>,
  options: Partial<ProfileOptions> & {
    onStep?: StepHook;
    compiledSchema?: CompiledSchemaSource;
  } = {}
): Promise<AssessmentResult> {
  // One answer per distinct query for the whole run, across personas and users.
  const configOrg = memoizeQuerier(configOrgIn);
  const countOrg = countOrgIn === configOrgIn ? configOrg : memoizeQuerier(countOrgIn);
  const personas: PersonaResult[] = [];
  for (const [index, persona] of profile.personas.entries()) {
    const prefix = `${persona.name} (${index + 1}/${profile.personas.length})`;
    const at = { persona: index + 1, personas: profile.personas.length };
    const onStep: StepHook | undefined =
      options.onStep &&
      ((step, progress) => options.onStep?.(`${prefix}: ${step}`, { ...at, ...progress }));

    let users = persona.users ?? [];
    let selectError: string | undefined;
    if (persona.select) {
      onStep?.(`Selecting the heaviest ${persona.select.profile} users`);
      try {
        users = (
          await resolvePersonaUsers(
            configOrg,
            persona,
            profile.telemetry?.days ?? DEFAULT_TELEMETRY_DAYS
          )
        ).users;
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
        user: {
          id: "",
          username: "",
          name: `${profileName} users`,
          profileId: "",
          profileName,
          territories: [],
          permissionSetCount: 0,
        },
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
            ...(volumes.every((v) => !v.user.username || v.user.id)
              ? { userIds: volumes.map((v) => v.user.id).filter(Boolean) }
              : { usernames }),
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
  incomplete: "🚧",
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
    const source =
      v.schemaSource === "user-download"
        ? "the user's own metadata download"
        : v.schemaSource === "compiled"
          ? "compiled metadata schema"
          : "DB Schema records";
    out += `- **Profile:** ${v.user.profileName}\n- **Permission sets:** ${v.user.permissionSetCount}\n- **Tables synced:** ${v.tableCount} (from ${source})\n- **Territories (active model):** ${v.user.territories.length || "none"}\n\n`;
    for (const note of v.schemaNotes ?? []) out += `- *Schema:* ${note}\n`;
    if (v.territoryNote) out += `- *Territories:* ${v.territoryNote}\n`;
    if (v.schemaNotes?.length || v.territoryNote) out += "\n";
    for (const terr of v.territories) {
      out += `### ${terr.territory ? `Territory: ${terr.territory.name}` : "No territory"}\n\n`;
      const gaps = incompleteTables(terr);
      out += `**Predicted records:** ${gaps.length ? "at least " : ""}${fmt(terr.totalRecords)} · **Estimated device SOQL requests:** ${fmt(terr.totalDeviceRequests)}\n\n`;
      out += `| SObject | Records | Device requests | Matched by | Note |\n|---|---:|---:|---|---|\n`;
      for (const t of terr.tables.slice(0, topTables)) {
        const via = t.note ?? (t.idTag ? `via ${t.idTag}` : "");
        const scope = mayOvercount(t)
          ? `org-wide count, ${t.sharingModel ?? "unknown"} sharing — upper bound`
          : "";
        const label = t.status === "timed-out" ? "timed out" : t.status;
        const note =
          t.status === "counted"
            ? [via, scope].filter(Boolean).join("; ")
            : `**${label}**: ${t.note ?? ""}`;
        out += `| ${t.sobject} | ${t.status === "counted" ? `${t.lowerBound ? "≥ " : ""}${fmt(t.records)}` : "—"} | ${fmt(t.deviceRequests ?? undefined)} | ${t.matchedBy} | ${note.replace(/\|/g, "\\|")} |\n`;
      }
      if (terr.tables.length > topTables) {
        out += `\n*${terr.tables.length - topTables} smaller table(s) omitted.*\n`;
      }
      const upper = upperBoundRecords(terr);
      if (upper > 0) {
        out += `\n${fmt(upper)} of these records come from tables whose filter isn't scoped to the user, on objects with restricted sharing — counted org-wide, so the user may download fewer.\n`;
      }
      const problems = terr.tables.filter((t) => t.status !== "counted");
      if (gaps.length) {
        out += `\n🚧 **${gaps.length} table(s) could not be counted in full, so the totals above are minimums** — see notes.\n`;
      }
      const timedOut = terr.tables.filter((t) => t.status === "timed-out");
      if (timedOut.length) {
        out += `\n${timedOut.length} table(s) timed out (${timedOut.map((t) => t.sobject).join(", ")}) — the table is too large to count in time, which is a sync-size problem rather than a bad filter.\n`;
      }
      const errors = problems.filter((t) => t.status === "error");
      if (errors.length) {
        out += `\n${errors.length} table(s) could not be counted — see notes. Errors usually mean the WhereSoql filter is invalid for this user and will fail on device too.\n`;
      }
      const notEstimated = problems.length - timedOut.length - errors.length;
      if (notEstimated) {
        out += `\n${notEstimated} table(s) not estimated — their filters are resolved on the device at sync time (see notes).\n`;
      }
      out += "\n";
    }
  }
  return out;
}

/** One line saying the telemetry covers a sample of the window rather than every sync; undefined when it covers all. */
export function telemetryCoverageNote(
  coverage: TelemetryCoverage | undefined,
  days: number
): string | undefined {
  if (!coverage || coverage.mode !== "sampled") return undefined;
  const slice =
    coverage.sliceDays && coverage.sliceDays > 1
      ? `each ${coverage.sliceDays}-day slice`
      : "each day";
  const span =
    coverage.oldest && coverage.newest
      ? ` (${coverage.oldest.slice(0, 10)} to ${coverage.newest.slice(0, 10)})`
      : "";
  return `🚧 **Sampled:** more than ${fmt(coverage.limit)} syncs matched the last ${days} day(s), so the newest syncs from ${slice} of the window were read${span}. Percentiles describe that sample, not every sync.`;
}

export function renderTelemetry(summary: TelemetrySummary, days: number): string {
  const row = (
    label: string,
    d: { n: number; p50?: number; p90?: number; p95?: number; max?: number },
    unit: string
  ) =>
    `| ${label} | ${d.n} | ${fmt(d.p50)} | ${fmt(d.p90)} | ${fmt(d.p95)} | ${fmt(d.max)} | ${unit} |\n`;

  const o = summary.outcomes;
  let out = `**Window:** last ${days} day(s) · **Syncs:** ${summary.samples} · **Failure rate:** ${fmt(summary.failureRatePct)}%\n\n`;
  const coverage = telemetryCoverageNote(summary.coverage, days);
  if (coverage) out += `${coverage}\n\n`;
  out += `Outcomes: ${o.completed} completed · ${o.failed} failed downloads · ${o.cancelled} cancelled · ${o["stopped-early"]} stopped before downloading. The failure rate counts failed downloads against completed and failed syncs only; timings use completed syncs.\n\n`;
  out += `| Metric | n | p50 | p90 | p95 | max | unit |\n|---|---:|---:|---:|---:|---:|---|\n`;
  out += row("Initial sync (total)", summary.initial.total, "s");
  out += row("Initial sync (data download)", summary.initial.download, "s");
  out += row(
    "Initial sync records (excl. files and attachments)",
    summary.initial.records,
    "records"
  );
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
    const where = [e.detail, e.incomplete ? `incomplete: ${e.incomplete}` : ""]
      .filter(Boolean)
      .join(" — ");
    out += `| ${STATUS_ICON[e.status]} | ${m.label} | ${e.incomplete && e.value !== undefined ? "≥ " : ""}${fmt(e.value)} ${e.value !== undefined ? m.unit : ""} | ${fmt(e.threshold?.warn)} | ${fmt(e.threshold?.fail)} | ${where} |\n`;
  }
  return out;
}

export function renderAssessment(result: AssessmentResult, days: number): string {
  let out = `# LSC Performance Assessment: ${result.profile}\n\n**Org:** ${result.org}\n**Generated:** ${result.generatedAt}\n**Overall:** ${STATUS_ICON[result.status]} ${result.status.toUpperCase()}\n\n`;
  const gaps = result.personas
    .map((p) => ({ name: p.persona.name, why: incompleteSummary(p.volumes) }))
    .filter((g) => g.why);
  if (gaps.length) {
    out += `🚧 **Incomplete:** ${gaps.map((g) => `${g.name}: ${g.why}`).join(" · ")}. Volume metrics that include them are minimums and can't pass.\n\n`;
  }
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
    else if (p.telemetry && p.telemetry.samples > 0)
      out += renderTelemetry(p.telemetry, days) + "\n";
    else out += `➖ No syncs recorded for these users in the last ${days} day(s).\n\n`;
  }
  out += `---\n\n**Legend:** ✅ pass · ⚠️ warn · ❌ fail · 🚧 incomplete (a minimum — some tables couldn't be counted in full) · ℹ️ measured, no threshold in profile · ➖ no data\n\n`;
  out += `**Method notes:** Predicted volumes replay each persona user's own table filters — taken from the compiled mobile metadata schema in their profile's archive when available, otherwise from the DB Schema records (each user's source is listed above), and resolved against their profile, permission sets, territories, and {USER.*} tags — with COUNT() queries as the connected user. Tables whose filter isn't scoped to the user are counted org-wide, which is exact for objects every user can read and an upper bound (flagged) where sharing is restricted. Device request counts follow the app's legacy visibility-pass chunking and are an estimate. Telemetry comes from real devices and reflects their hardware and networks.\n`;
  return out;
}
