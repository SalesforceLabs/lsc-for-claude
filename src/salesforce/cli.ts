/**
 * Salesforce CLI wrapper
 * Executes sf commands and handles output parsing
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { cacheGet, cacheSet, queryCacheKey, describeCacheKey } from "../cache.js";
import { sfLimiter } from "./limiter.js";
import { privateTmp } from "../private-tmp.js";
import {
  directDownload,
  directEnabled,
  directGet,
  directPostRead,
  directQuery,
  directToolingWrite,
  type DirectCredentials,
  type DirectOutcome,
} from "./direct.js";
import { directDelete, directDeploy, directRetrieve, type StatusHook } from "./direct-metadata.js";
import { toolingWriteMetadata } from "./tooling-metadata.js";
import { invalidateSharedReads, sharedRead, sharedReadsActive } from "../config/read-cache.js";
import { isTokenOrg, tokenOrgCredentials, TOKEN_ORG_NO_CLI } from "./token-org.js";
import {
  anyApiVersionPinned,
  FALLBACK_API_VERSION,
  normalizeVersion,
  pinnedApiVersion,
  resolveApiVersion,
} from "./api-version.js";

const execAsync = promisify(exec);

export interface CliResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  rawOutput?: string;
  /** The call was stopped at its time limit (the error says so). */
  timedOut?: boolean;
  /** A deploy the org refused (as opposed to one that couldn't run); `error` has the org's reasons. */
  rejected?: boolean;
}

export interface SfOrg {
  alias?: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isDefaultDevHub?: boolean;
  isDefaultUsername?: boolean;
  connectedStatus?: string;
}

export interface SfOrgListResult {
  nonScratchOrgs: SfOrg[];
  scratchOrgs: SfOrg[];
}

export interface SoqlQueryResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
  /**
   * Fewer records came back than matched (`totalSize`) because the row cap
   * (`maxRows`, default 50,000 — the sf CLI's own default) was reached.
   */
  truncated?: boolean;
}

/** Rows a query reads before it stops and reports `truncated` (the sf CLI's default). */
export const DEFAULT_MAX_QUERY_ROWS = 50_000;

/**
 * Thrown by query helpers when a result hit the row cap — a partial list
 * would silently undercount, so callers must opt in to partial results.
 */
export class QueryTruncatedError extends Error {
  constructor(
    readonly held: number,
    readonly totalSize: number
  ) {
    super(
      `Only ${held.toLocaleString("en-US")} of ${totalSize.toLocaleString("en-US")} matching records could be read — too many for one query.`
    );
    this.name = "QueryTruncatedError";
  }
}

export interface SObjectDescribeResult {
  name: string;
  label: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    updateable: boolean;
    createable: boolean;
    /** Set on a compound field's parts (e.g. BillingStreet → BillingAddress). */
    compoundFieldName?: string | null;
    deprecatedAndHidden?: boolean;
    /** Whether the field can be used in a list view filter. */
    filterable?: boolean;
    /** The object's record-name field. */
    nameField?: boolean;
  }>;
  childRelationships?: Array<{
    childSObject: string;
    relationshipName: string | null;
    field: string;
    deprecatedAndHidden?: boolean;
  }>;
}

/**
 * Check if Salesforce CLI is installed
 */
export async function isSfCliInstalled(): Promise<boolean> {
  try {
    await execAsync("sf --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the installed SF CLI version
 */
export async function getSfCliVersion(): Promise<CliResult<string>> {
  try {
    const { stdout } = await execAsync("sf --version");
    return { success: true, data: stdout.trim() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Install SF CLI via npm
 * Returns a promise that resolves when installation completes
 */
export async function installSfCli(): Promise<CliResult<string>> {
  try {
    // Use spawn for better handling of long-running install
    return new Promise((resolve) => {
      const isWindows = process.platform === "win32";
      const npmCmd = isWindows ? "npm.cmd" : "npm";

      const child = spawn(npmCmd, ["install", "-g", "@salesforce/cli"], {
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            data: "Salesforce CLI installed successfully",
            rawOutput: stdout,
          });
        } else {
          resolve({
            success: false,
            error: `Installation failed (exit code ${code}). ${stderr || stdout}`,
            rawOutput: stderr || stdout,
          });
        }
      });

      child.on("error", (err) => {
        resolve({
          success: false,
          error: `Failed to start installation: ${err.message}`,
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute a Salesforce CLI command with JSON output
 * Uses spawn instead of exec to properly handle special characters in arguments
 */
/**
 * Ensure a minimal SFDX project exists in a temp directory.
 * Commands like `sf project deploy/retrieve` require an sfdx-project.json.
 * One project per process, in its private temp folder.
 */
// Newer objects (Inquiry, ...) are rejected by older source API versions, which made their deploys fail.
// Calls themselves use the org's version (SF_ORG_API_VERSION when pinned); this only names the source format.
const TMP_PROJECT_API_VERSION = FALLBACK_API_VERSION;

export function ensureTmpSfdxProject(): string {
  const TMP_SFDX_PROJECT_DIR = privateTmp("sfdx-project");
  const forceAppDir = path.join(TMP_SFDX_PROJECT_DIR, "force-app");
  const projectFile = path.join(TMP_SFDX_PROJECT_DIR, "sfdx-project.json");
  // Always ensure both the project file and force-app dir exist — either may
  // be missing if the OS cleaned up the temp directory between calls.
  fs.mkdirSync(forceAppDir, { recursive: true });
  if (!fs.existsSync(projectFile)) {
    fs.writeFileSync(
      projectFile,
      JSON.stringify(
        {
          packageDirectories: [{ path: "force-app", default: true }],
          name: "lsc-tmp",
          namespace: "",
          sfdcLoginUrl: "https://login.salesforce.com",
          sourceApiVersion: TMP_PROJECT_API_VERSION,
        },
        null,
        2
      )
    );
  }
  return TMP_SFDX_PROJECT_DIR;
}

export async function execSfCommand<T>(
  command: string,
  args: string[] = [],
  options: { targetOrg?: string; timeout?: number; cwd?: string; env?: Record<string, string> } = {}
): Promise<CliResult<T>> {
  // A rep's token org is only served by the direct REST path; never hand it to the CLI.
  if (isTokenOrg(options.targetOrg)) return { success: false, error: TOKEN_ORG_NO_CLI };
  // A version pinned for the org applies to the CLI too. `sf org` commands are how the login (and so the org's instance) is read.
  if (options.targetOrg && command !== "org" && anyApiVersionPinned()) {
    options = {
      ...options,
      env: { SF_ORG_API_VERSION: await orgApiVersion(options.targetOrg), ...options.env },
    };
  }
  const run = () => sfLimiter.run(() => spawnSfJson<T>(command, args, options));
  return writesToOrg(command, args) ? asWrite(options.targetOrg, run) : run();
}

/** Drop shared reads before a write (so none starts from old data) and after it (so none read mid-write sticks). */
async function asWrite<T>(org: string | undefined, write: () => Promise<T>): Promise<T> {
  invalidateSharedReads(org);
  try {
    return await write();
  } finally {
    invalidateSharedReads(org);
  }
}

/** sf commands that change the org. */
function writesToOrg(command: string, args: string[]): boolean {
  const sub = args[0] ?? "";
  if (command === "data") return /^(create|update|delete|upsert|import)$/.test(sub);
  if (command === "project") return sub === "deploy";
  return command === "apex" && sub === "run";
}

function timeoutMessage(ms: number): string {
  return `Salesforce didn't answer within ${Math.round(ms / 1000)}s — the sf command was stopped. Large orgs can need a narrower filter.`;
}

function spawnSfJson<T>(
  command: string,
  args: string[],
  options: { targetOrg?: string; timeout?: number; cwd?: string; env?: Record<string, string> }
): Promise<CliResult<T>> {
  return new Promise((resolve) => {
    const fullArgs = [command, ...args, "--json"];

    if (options.targetOrg) {
      fullArgs.push("--target-org", options.targetOrg);
    }

    const timeout = options.timeout || 120000; // 2 minute default

    const child = spawn("sf", fullArgs, {
      stdio: "pipe",
      timeout,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    });
    const started = Date.now();

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code, signal) => {
      // Killed by the spawn timeout: stdout is partial, so say what happened.
      if (code === null && signal && Date.now() - started >= timeout - 50) {
        resolve({
          success: false,
          timedOut: true,
          error: timeoutMessage(timeout),
          rawOutput: stdout || stderr,
        });
        return;
      }
      try {
        const result = JSON.parse(stdout);

        if (result.status === 0 || result.result) {
          resolve({ success: true, data: result.result as T, rawOutput: stdout });
        } else {
          resolve({
            success: false,
            error: result.message || "Command failed",
            rawOutput: stdout,
          });
        }
      } catch {
        // If JSON parsing fails, return raw output
        if (code === 0) {
          resolve({
            success: false,
            error: `Failed to parse CLI output: ${stdout}`,
            rawOutput: stdout,
          });
        } else {
          resolve({
            success: false,
            error: stderr || stdout || `Command exited with code ${code}`,
            rawOutput: stdout || stderr,
          });
        }
      }
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        error: err.message || "Unknown error",
      });
    });
  });
}

/**
 * List all authenticated orgs. Checking each org's connection status takes about half a
 * second per org; `connectionStatus: false` skips it when only which orgs exist matters.
 */
export async function listOrgs(
  options: { connectionStatus?: boolean } = {}
): Promise<CliResult<SfOrgListResult>> {
  return execSfCommand<SfOrgListResult>(
    "org",
    options.connectionStatus === false ? ["list", "--skip-connection-status"] : ["list"]
  );
}

/**
 * Get details about a specific org
 */
export async function getOrgDisplay(targetOrg: string): Promise<CliResult<SfOrg>> {
  return execSfCommand<SfOrg>("org", ["display"], { targetOrg });
}

/**
 * Run a SOQL query
 */
/** Carries a result that must not be kept (a failure, or one cut short) out of the shared read. */
class Uncacheable {
  constructor(readonly result: CliResult<SoqlQueryResult>) {}
}

export async function runSoqlQuery(
  query: string,
  targetOrg: string,
  options: { useToolingApi?: boolean; maxRows?: number } = {}
): Promise<CliResult<SoqlQueryResult>> {
  // Inside a Studio read scope, identical queries share one read (see withSharedReads).
  if (!sharedReadsActive()) return runSoqlQueryUncached(query, targetOrg, options);
  const key = `soql:${options.useToolingApi ? "t" : "d"}:${options.maxRows ?? ""}:${query}`;
  try {
    const hit = await sharedRead(targetOrg, key, async () => {
      const r = await runSoqlQueryUncached(query, targetOrg, options);
      if (!r.success || !r.data || r.data.truncated) throw new Uncacheable(r);
      return r;
    });
    return structuredClone(hit);
  } catch (e) {
    if (e instanceof Uncacheable) return structuredClone(e.result);
    throw e;
  }
}

async function runSoqlQueryUncached(
  query: string,
  targetOrg: string,
  options: { useToolingApi?: boolean; maxRows?: number } = {}
): Promise<CliResult<SoqlQueryResult>> {
  // LSC_SF_MAX_QUERY_ROWS lowers the cap to rehearse a large org's truncation on a small one.
  const rehearsal = Number(process.env.LSC_SF_MAX_QUERY_ROWS);
  const cap =
    Number.isFinite(rehearsal) && rehearsal >= 1
      ? Math.min(rehearsal, options.maxRows ?? Infinity)
      : undefined;
  const maxRows = Math.max(1, cap ?? options.maxRows ?? DEFAULT_MAX_QUERY_ROWS);
  const direct = await directQuery(query, targetOrg, directCredentials, {
    tooling: options.useToolingApi,
    maxRows,
  });
  if (direct) {
    if (!direct.ok) return { success: false, error: direct.error, timedOut: direct.timedOut };
    return { success: true, data: markTruncated(query, direct.data) };
  }
  const args = ["query", "--query", query];
  if (options.useToolingApi) {
    args.push("--use-tooling-api");
  }
  const result = await execSfCommand<SoqlQueryResult>("data", args, {
    targetOrg,
    ...(maxRows !== DEFAULT_MAX_QUERY_ROWS
      ? { env: { SF_ORG_MAX_QUERY_LIMIT: String(maxRows) } }
      : {}),
  });
  if (result.success && result.data) result.data = markTruncated(query, result.data);
  return result;
}

const COUNT_ONLY = /^\s*select\s+count\(\s*\)\s+from\b/i;

/**
 * Flag a result that holds fewer records than matched. `SELECT COUNT()` has no
 * records by design, and LIMIT queries report `totalSize` up to the limit.
 */
export function markTruncated(query: string, data: SoqlQueryResult): SoqlQueryResult {
  const held = data.records?.length ?? 0;
  if (data.truncated || (held < (data.totalSize ?? 0) && !COUNT_ONLY.test(query))) {
    return { ...data, truncated: true };
  }
  return data;
}

/** The API version calls to `org` use: the one pinned for it in the app, else the org's newest (see api-version.ts). */
export async function orgApiVersion(org: string): Promise<string> {
  // Read once per org, failures too: the CLI fallback calls this on every request.
  let info = orgVersionInfo.get(org);
  if (!info) {
    info = directCredentials(org).catch(() => null);
    orgVersionInfo.set(org, info);
  }
  const creds = await info;
  return resolveApiVersion(creds?.instanceUrl, creds?.apiVersion);
}

const orgVersionInfo = new Map<string, Promise<DirectCredentials | null>>();

/** What the org's version is made of: its instance (pins are keyed by it), the newest version it reports, and the pin. */
export async function orgApiVersionDetails(org: string): Promise<{
  instanceUrl: string | null;
  reported: string | null;
  pinned: string | null;
  version: string;
}> {
  const version = await orgApiVersion(org);
  const creds = await orgVersionInfo.get(org);
  return {
    instanceUrl: creds?.instanceUrl ?? null,
    reported: normalizeVersion(creds?.apiVersion),
    pinned: pinnedApiVersion(creds?.instanceUrl),
    version,
  };
}

/** `/services/data/v<org's API version><rest>`; `rest` starts with "/". */
export async function dataPath(org: string, rest: string): Promise<string> {
  return `/services/data/v${await orgApiVersion(org)}${rest}`;
}

/** The sf CLI's login for an org, for the direct REST fast path. */
async function directCredentials(org: string): Promise<DirectCredentials | null> {
  if (isTokenOrg(org)) return tokenOrgCredentials(org);
  const login = await readOrgLogin(org);
  return login.success ? login.data! : null;
}

const usableToken = (v: unknown): string =>
  typeof v === "string" && v && !/redacted/i.test(v) ? v : "";

/**
 * The sf CLI's access token, instance URL and API version for an org. Recent
 * CLIs redact the token in `sf org display`, so it comes from
 * `sf org auth show-access-token`; older CLIs without that command still
 * show it in `org display` (with SF_TEMP_SHOW_SECRETS during the transition).
 */
async function readOrgLogin(org: string): Promise<CliResult<DirectCredentials>> {
  const [display, shown] = await Promise.all([
    execSfCommand<Record<string, unknown>>("org", ["display"], { targetOrg: org }),
    execSfCommand<Record<string, unknown>>("org", ["auth", "show-access-token"], {
      targetOrg: org,
    }),
  ]);
  if (!display.success || !display.data) {
    return { success: false, error: display.error || "Failed to get org credentials" };
  }
  const instanceUrl = typeof display.data.instanceUrl === "string" ? display.data.instanceUrl : "";
  const apiVersion =
    typeof display.data.apiVersion === "string" ? display.data.apiVersion : undefined;
  let accessToken = usableToken(shown.data?.accessToken) || usableToken(display.data.accessToken);
  if (!accessToken && !shown.success) {
    const revealed = await execSfCommand<Record<string, unknown>>("org", ["display"], {
      targetOrg: org,
      env: { SF_TEMP_SHOW_SECRETS: "true" },
    });
    accessToken = usableToken(revealed.data?.accessToken);
  }
  if (!accessToken || !instanceUrl) {
    return {
      success: false,
      error:
        "Org credentials missing accessToken or instanceUrl. Re-authenticate with: sf org login web",
    };
  }
  return { success: true, data: { accessToken, instanceUrl, apiVersion } };
}

/**
 * Run a Tooling API SOQL query
 */
export async function runToolingQuery(
  query: string,
  targetOrg: string,
  options: { maxRows?: number } = {}
): Promise<CliResult<SoqlQueryResult>> {
  return runSoqlQuery(query, targetOrg, { useToolingApi: true, ...options });
}

/**
 * Run a SOQL query with caching. Identical queries within the TTL window
 * return the cached result without hitting the SF CLI.
 */
export async function cachedSoqlQuery(
  query: string,
  targetOrg: string,
  options: { useToolingApi?: boolean; ttlMs?: number } = {}
): Promise<CliResult<SoqlQueryResult>> {
  const isTooling = options.useToolingApi ?? false;
  const key = queryCacheKey(query, isTooling);
  const cached = cacheGet<CliResult<SoqlQueryResult>>(targetOrg, key);
  if (cached) return cached;

  const result = await runSoqlQuery(query, targetOrg, { useToolingApi: isTooling });
  if (result.success) {
    // The raw stdout duplicates the parsed data; don't keep both.
    cacheSet(targetOrg, key, { ...result, rawOutput: undefined }, options.ttlMs);
  }
  return result;
}

/**
 * Run a Tooling API query with caching.
 */
export async function cachedToolingQuery(
  query: string,
  targetOrg: string,
  ttlMs?: number
): Promise<CliResult<SoqlQueryResult>> {
  return cachedSoqlQuery(query, targetOrg, { useToolingApi: true, ttlMs });
}

/**
 * Describe an SObject with caching. Object schemas rarely change mid-session.
 */
export async function cachedDescribeSObject(
  objectName: string,
  targetOrg: string,
  ttlMs?: number
): Promise<CliResult<SObjectDescribeResult>> {
  const key = describeCacheKey(objectName);
  const cached = cacheGet<CliResult<SObjectDescribeResult>>(targetOrg, key);
  if (cached) return cached;

  const result = await describeSObject(objectName, targetOrg);
  if (result.success) {
    cacheSet(targetOrg, key, { ...result, rawOutput: undefined }, ttlMs);
  }
  return result;
}

/**
 * Create a record via Tooling API
 */
export async function createToolingRecord(
  objectName: string,
  data: Record<string, unknown>,
  targetOrg: string
): Promise<CliResult<{ id: string }>> {
  const direct = await asWrite(targetOrg, () =>
    directToolingWrite<{ id: string }>("POST", objectName, null, data, targetOrg, directCredentials)
  );
  if (direct) return fromDirect(direct);
  const endpoint = await dataPath(targetOrg, `/tooling/sobjects/${objectName}`);
  return apiRequest<{ id: string }>(endpoint, "POST", data, targetOrg);
}

/**
 * Update a record via Tooling API (PATCH)
 */
export async function updateToolingRecord(
  objectName: string,
  recordId: string,
  data: Record<string, unknown>,
  targetOrg: string
): Promise<CliResult<void>> {
  const direct = await asWrite(targetOrg, () =>
    directToolingWrite<void>("PATCH", objectName, recordId, data, targetOrg, directCredentials)
  );
  if (direct) return fromDirect(direct);
  const endpoint = await dataPath(targetOrg, `/tooling/sobjects/${objectName}/${recordId}`);
  return apiRequest<void>(endpoint, "PATCH", data, targetOrg);
}

/**
 * Delete a record via Tooling API
 */
export async function deleteToolingRecord(
  objectName: string,
  recordId: string,
  targetOrg: string
): Promise<CliResult<void>> {
  const direct = await asWrite(targetOrg, () =>
    directToolingWrite<void>(
      "DELETE",
      objectName,
      recordId,
      undefined,
      targetOrg,
      directCredentials
    )
  );
  if (direct) return fromDirect(direct);
  const endpoint = await dataPath(targetOrg, `/tooling/sobjects/${objectName}/${recordId}`);
  return apiRequest<void>(endpoint, "DELETE", undefined, targetOrg);
}

/** A direct REST answer as the CLI wrapper's result. */
function fromDirect<T>(direct: DirectOutcome<T>): CliResult<T> {
  return direct.ok
    ? { success: true, data: direct.data }
    : { success: false, error: direct.error, timedOut: direct.timedOut };
}

/**
 * Describe an SObject
 */
export async function describeSObject(
  objectName: string,
  targetOrg: string
): Promise<CliResult<SObjectDescribeResult>> {
  if (directEnabled(targetOrg) && /^\w+$/.test(objectName)) {
    const direct = await directGet<SObjectDescribeResult>(
      await dataPath(targetOrg, `/sobjects/${objectName}/describe`),
      targetOrg,
      directCredentials
    );
    if (direct?.ok && typeof direct.data === "object") return { success: true, data: direct.data };
    if (direct && !direct.ok)
      return { success: false, error: direct.error, timedOut: direct.timedOut };
  }
  return execSfCommand<SObjectDescribeResult>("sobject", ["describe", "--sobject", objectName], {
    targetOrg,
  });
}

/**
 * Get a single record by ID
 */
export async function getRecord(
  objectName: string,
  recordId: string,
  fields: string[],
  targetOrg: string
): Promise<CliResult<Record<string, unknown>>> {
  return execSfCommand<Record<string, unknown>>(
    "data",
    [
      "get",
      "record",
      "--sobject",
      objectName,
      "--record-id",
      recordId,
      "--fields",
      fields.join(","),
    ],
    { targetOrg }
  );
}

/**
 * Create a record
 */
export async function createRecord(
  objectName: string,
  values: Record<string, unknown>,
  targetOrg: string
): Promise<CliResult<{ id: string }>> {
  const valuesStr = Object.entries(values)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

  return execSfCommand<{ id: string }>(
    "data",
    ["create", "record", "--sobject", objectName, "--values", valuesStr],
    { targetOrg }
  );
}

/**
 * Update a record
 */
export async function updateRecord(
  objectName: string,
  recordId: string,
  values: Record<string, unknown>,
  targetOrg: string
): Promise<CliResult<{ id: string }>> {
  const valuesStr = Object.entries(values)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

  return execSfCommand<{ id: string }>(
    "data",
    ["update", "record", "--sobject", objectName, "--record-id", recordId, "--values", valuesStr],
    { targetOrg }
  );
}

/**
 * Delete a record
 */
export async function deleteRecord(
  objectName: string,
  recordId: string,
  targetOrg: string
): Promise<CliResult<{ id: string }>> {
  return execSfCommand<{ id: string }>(
    "data",
    ["delete", "record", "--sobject", objectName, "--record-id", recordId],
    { targetOrg }
  );
}

/**
 * Deploy metadata to an org
 * Requires an SFDX project context — uses a temp project automatically.
 */
export async function deployMetadata(
  sourcePath: string,
  targetOrg: string,
  onStatus?: StatusHook,
  /** Validate only: the org checks the deploy and changes nothing. */
  checkOnly = false
): Promise<CliResult<unknown>> {
  const cwd = ensureTmpSfdxProject();
  // Validation stays on the Metadata API. A write of a Lightning page, compact layout or app tries the
  // Tooling API first (several times faster) and falls back to the deploy on anything but a verified save.
  const direct = await (checkOnly
    ? directDeploy(sourcePath, targetOrg, directCredentials, undefined, onStatus, true)
    : asWrite(targetOrg, async () => {
        const viaTooling = isTokenOrg(targetOrg)
          ? null
          : await toolingWriteMetadata(sourcePath, targetOrg, directCredentials, onStatus);
        return (
          viaTooling ?? directDeploy(sourcePath, targetOrg, directCredentials, undefined, onStatus)
        );
      }));
  if (direct)
    return direct.ok
      ? { success: true, data: {} }
      : {
          success: false,
          error: direct.error,
          timedOut: direct.timedOut,
          rejected: direct.rejected,
        };
  return deployOutcome(
    await execSfCommand(
      "project",
      ["deploy", "start", "--source-dir", sourcePath, ...(checkOnly ? ["--dry-run"] : [])],
      {
        targetOrg,
        timeout: 300000,
        cwd,
      }
    )
  );
}

/**
 * A deploy the org rejected still comes back from the CLI as JSON with a `result` (status "Failed",
 * `componentFailures`), which `execSfCommand` reads as success. Turn that into the failure it is,
 * carrying the org's reasons, so nothing reports a change that never landed.
 */
export function deployOutcome<T>(result: CliResult<T>): CliResult<T> {
  const data = result.data as
    | {
        success?: boolean;
        status?: string;
        numberComponentErrors?: number;
        details?: { componentFailures?: unknown };
      }
    | undefined;
  if (!data || typeof data !== "object") return result;
  const raw = data.details?.componentFailures;
  const failures = (Array.isArray(raw) ? raw : raw ? [raw] : []) as {
    fullName?: string;
    problem?: string;
    lineNumber?: number;
  }[];
  const failed =
    data.success === false ||
    (typeof data.status === "string" && /^(Failed|Canceled|Canceling)/i.test(data.status)) ||
    (data.numberComponentErrors ?? 0) > 0 ||
    failures.length > 0;
  if (!failed) return result;
  // A failure the CLI already flagged keeps its own message unless the JSON names the components.
  if (!result.success && !failures.length) return result;
  const reasons = failures.map(
    (f) =>
      `${f.fullName ? `${f.fullName}: ` : ""}${f.problem ?? "failed"}${f.lineNumber ? ` (line ${f.lineNumber})` : ""}`
  );
  return {
    ...result,
    success: false,
    rejected: failures.length > 0,
    error: reasons.length
      ? reasons.join("; ")
      : `The deploy ${String(data.status ?? "failed").toLowerCase()}.`,
  };
}

/**
 * Delete one metadata component (a destructive-changes deploy of an otherwise empty package).
 * The component must not be in use (a layout still assigned, a page still activated).
 */
export async function deleteMetadata(
  type: string,
  fullName: string,
  targetOrg: string
): Promise<CliResult<unknown>> {
  const direct = await asWrite(targetOrg, () =>
    directDelete(type, fullName, targetOrg, directCredentials)
  );
  if (direct)
    return direct.ok
      ? { success: true, data: {} }
      : { success: false, error: direct.error, timedOut: direct.timedOut };
  const cwd = ensureTmpSfdxProject();
  const dir = path.join(
    cwd,
    "destructive",
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  const version = await orgApiVersion(targetOrg);
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}    <version>${version}</version>\n</Package>\n`;
  const escaped = fullName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  fs.writeFileSync(path.join(dir, "package.xml"), xml(""));
  fs.writeFileSync(
    path.join(dir, "destructiveChanges.xml"),
    xml(
      `    <types>\n        <members>${escaped}</members>\n        <name>${type}</name>\n    </types>\n`
    )
  );
  try {
    return deployOutcome(
      await execSfCommand(
        "project",
        [
          "deploy",
          "start",
          "--manifest",
          path.join(dir, "package.xml"),
          "--post-destructive-changes",
          path.join(dir, "destructiveChanges.xml"),
        ],
        { targetOrg, timeout: 300000, cwd }
      )
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Retrieve metadata from an org.
 * Output directory must be inside the SFDX project root, so we always retrieve
 * into a timestamped subdir of the tmp project and return the actual path.
 */
export async function retrieveMetadata(
  _targetPath: string,
  metadata: string | string[],
  targetOrg: string,
  onStatus?: StatusHook
): Promise<CliResult<{ outputDir: string }>> {
  const projectDir = ensureTmpSfdxProject();
  // Unique per call: two retrieves started in the same millisecond must not share a folder.
  const relativeOutput = path.join(
    "retrieve-output",
    `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`
  );
  const absoluteOutput = path.join(projectDir, relativeOutput);
  fs.mkdirSync(absoluteOutput, { recursive: true });

  const direct = await directRetrieve(
    [metadata].flat(),
    targetOrg,
    absoluteOutput,
    directCredentials,
    undefined,
    onStatus
  );
  if (direct)
    return direct.ok
      ? { success: true, data: { outputDir: absoluteOutput } }
      : { success: false, error: direct.error, timedOut: direct.timedOut };

  const result = await execSfCommand(
    "project",
    [
      "retrieve",
      "start",
      ...[metadata].flat().flatMap((m) => ["--metadata", m]),
      "--output-dir",
      relativeOutput,
    ],
    { targetOrg, timeout: 300000, cwd: projectDir }
  );

  if (!result.success) {
    return { success: false, error: result.error, rawOutput: result.rawOutput };
  }
  return { success: true, data: { outputDir: absoluteOutput } };
}

/**
 * List metadata components of a specific type
 * Requires an SFDX project context — uses a temp project automatically.
 */
export async function listMetadata(
  metadataType: string,
  targetOrg: string
): Promise<CliResult<Array<{ fullName: string; type: string }>>> {
  const cwd = ensureTmpSfdxProject();
  return execSfCommand<Array<{ fullName: string; type: string }>>(
    "org",
    ["list", "metadata", "--metadata-type", metadataType],
    { targetOrg, cwd }
  );
}

/**
 * Run anonymous Apex code against an org
 */
export async function runAnonymousApex(
  code: string,
  targetOrg: string
): Promise<CliResult<{ compiled: boolean; success: boolean; logs: string }>> {
  // Write code to a temp file since sf apex run requires a file
  const tmpFile = path.join(privateTmp("apex"), `${crypto.randomUUID()}.apex`);
  fs.writeFileSync(tmpFile, code);
  try {
    const result = await execSfCommand<{ compiled: boolean; success: boolean; logs: string }>(
      "apex",
      ["run", "--file", tmpFile],
      { targetOrg, timeout: 120000 }
    );
    return result;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Open the org login page in browser
 */
export async function openOrgLogin(
  alias?: string,
  instanceUrl?: string
): Promise<CliResult<{ orgId: string; username: string }>> {
  const args = ["login", "web"];
  if (alias) {
    args.push("--alias", alias);
  }
  if (instanceUrl) {
    args.push("--instance-url", instanceUrl);
  }

  return execSfCommand("org", args);
}

/**
 * Generate the login command string for user to run
 */
export function getLoginCommand(alias?: string, instanceUrl?: string): string {
  let cmd = "sf org login web";
  if (alias) {
    cmd += ` --alias ${alias}`;
  }
  if (instanceUrl) {
    cmd += ` --instance-url ${instanceUrl}`;
  }
  return cmd;
}

/**
 * Make a REST API request to the target org
 */
export async function apiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown | undefined,
  targetOrg: string
): Promise<CliResult<T>> {
  if (method === "GET" && body === undefined) {
    const direct = await directGet<T>(endpoint, targetOrg, directCredentials);
    if (direct) {
      return direct.ok
        ? { success: true, data: direct.data }
        : { success: false, error: direct.error, timedOut: direct.timedOut };
    }
  }
  const run = () => sfLimiter.run(() => spawnApiRequest<T>(endpoint, method, body, targetOrg));
  return method === "GET" ? run() : asWrite(targetOrg, run);
}

/**
 * A POST that only reads (a query sent as a body, e.g. Data Cloud `ssot/query-sql`): direct REST first,
 * the CLI otherwise. Not for anything that writes — use `apiRequest`, which is serialized as a write.
 */
export async function apiReadPost<T>(
  endpoint: string,
  body: unknown,
  targetOrg: string
): Promise<CliResult<T>> {
  const direct = await directPostRead<T>(endpoint, body, targetOrg, directCredentials);
  if (direct) {
    return direct.ok
      ? { success: true, data: direct.data }
      : { success: false, error: direct.error, timedOut: direct.timedOut };
  }
  return sfLimiter.run(() => spawnApiRequest<T>(endpoint, "POST", body, targetOrg));
}

/** Download a REST body (a ContentVersion's VersionData) to a file: direct first, `sf api request rest --stream-to-file` otherwise. */
export async function downloadToFile(
  endpoint: string,
  dest: string,
  targetOrg: string,
  timeoutMs: number
): Promise<CliResult<void>> {
  const direct = await directDownload(endpoint, dest, targetOrg, directCredentials, timeoutMs);
  if (direct)
    return direct.ok
      ? { success: true }
      : { success: false, error: direct.error, timedOut: direct.timedOut };
  if (isTokenOrg(targetOrg)) return { success: false, error: TOKEN_ORG_NO_CLI };
  return sfLimiter.run(
    () =>
      new Promise<CliResult<void>>((resolve) => {
        const child = spawn(
          "sf",
          ["api", "request", "rest", endpoint, "--stream-to-file", dest, "--target-org", targetOrg],
          { stdio: "pipe", timeout: timeoutMs }
        );
        const started = Date.now();
        let stderr = "";
        child.stderr?.on("data", (d) => (stderr += d.toString()));
        child.on("error", (e) => resolve({ success: false, error: e.message }));
        child.on("close", (code, signal) => {
          if (code === 0) return resolve({ success: true });
          if (signal && Date.now() - started >= timeoutMs - 50)
            return resolve({ success: false, timedOut: true, error: timeoutMessage(timeoutMs) });
          resolve({ success: false, error: stderr.trim() || `Download failed (exit ${code})` });
        });
      })
  );
}

function spawnApiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown | undefined,
  targetOrg: string
): Promise<CliResult<T>> {
  if (isTokenOrg(targetOrg)) return Promise.resolve({ success: false, error: TOKEN_ORG_NO_CLI });
  return new Promise((resolve) => {
    const args = ["api", "request", "rest", endpoint, "--method", method];

    if (body) {
      args.push("--body", JSON.stringify(body));
    } else if (method === "DELETE") {
      // SF CLI bug: DELETE without --body fails with "No 'mode' found in 'body' entry"
      args.push("--body", JSON.stringify({ mode: "raw" }));
    }

    args.push("--target-org", targetOrg);

    const timeout = 120000;
    const child = spawn("sf", args, {
      stdio: "pipe",
      timeout,
    });
    const started = Date.now();

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code, signal) => {
      if (code === null && signal && Date.now() - started >= timeout - 50) {
        resolve({
          success: false,
          timedOut: true,
          error: timeoutMessage(timeout),
          rawOutput: stdout || stderr,
        });
        return;
      }
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve({ success: true, data: result as T, rawOutput: stdout });
        } catch {
          // Non-JSON response might still be successful (e.g., DELETE returns empty)
          resolve({ success: true, data: stdout as unknown as T, rawOutput: stdout });
        }
      } else {
        let errorMessage = "Unknown error";

        // Try to parse the actual API error from stdout first
        if (stdout.trim()) {
          try {
            const errorResult = JSON.parse(stdout);
            if (Array.isArray(errorResult) && errorResult.length > 0) {
              errorMessage = errorResult
                .map(
                  (e: { message?: string; errorCode?: string }) =>
                    `${e.errorCode || "ERROR"}: ${e.message || "Unknown"}`
                )
                .join("; ");
            } else if (errorResult.message) {
              errorMessage = errorResult.message;
            } else {
              errorMessage = stdout.trim();
            }
          } catch {
            errorMessage = stdout.trim();
          }
        }

        // Fall back to stderr, filtering out SF CLI beta warnings
        if (errorMessage === "Unknown error") {
          const filteredStderr = stderr
            .split("\n")
            .filter(
              (line: string) => !line.includes("beta") && !line.includes("Warning") && line.trim()
            )
            .join("\n")
            .trim();
          errorMessage = filteredStderr || "Unknown error";
        }

        resolve({
          success: false,
          error: errorMessage,
          rawOutput: stdout || stderr,
        });
      }
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        error: err.message || "Unknown error",
      });
    });
  });
}

/**
 * Generate mobile metadata cache by calling the Connect API. `version` defaults to the org's API version.
 */
export async function generateMobileMetadataCache(
  parentMetadataRecordId: string,
  version: string | undefined,
  prefix: string,
  targetOrg: string
): Promise<CliResult<unknown>> {
  const apiVersion = version ?? (await orgApiVersion(targetOrg));
  const endpoint = `/services/data/v${apiVersion}/connect/life-sciences/commercial/metadata/actions/generate`;
  const body = {
    parentMetadataRecordId,
    apiVersion,
    prefix,
  };

  return apiRequest(endpoint, "POST", body, targetOrg);
}

export interface OrgCredentials {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Get access token and instance URL for a target org via `sf org display`
 */
export async function getOrgCredentials(targetOrg: string): Promise<CliResult<OrgCredentials>> {
  const login = await readOrgLogin(targetOrg);
  if (!login.success) return { success: false, error: login.error };
  return {
    success: true,
    data: { accessToken: login.data!.accessToken, instanceUrl: login.data!.instanceUrl },
  };
}

export interface ContentVersionUploadResult {
  id: string;
  contentDocumentId: string;
}

/**
 * Detect the MIME content type from a file extension.
 */
function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".zip":
      return "application/zip";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

/**
 * Upload a binary file as a Salesforce ContentVersion using multipart/form-data.
 * Uses Node 18 native fetch — no external form-data library needed.
 */
export async function uploadContentVersion(
  filePath: string,
  title: string,
  targetOrg: string,
  contentType?: string
): Promise<CliResult<ContentVersionUploadResult>> {
  const credsResult = await getOrgCredentials(targetOrg);
  if (!credsResult.success || !credsResult.data) {
    return { success: false, error: credsResult.error || "Failed to get org credentials" };
  }

  const { accessToken, instanceUrl } = credsResult.data;
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const boundary = `----FormBoundary${crypto.randomBytes(16).toString("hex")}`;

  // Build multipart body manually
  const entityJson = JSON.stringify({
    Title: title,
    PathOnClient: fileName,
    Origin: "H",
  });

  const parts: Buffer[] = [];

  // Part 1: JSON entity
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="entity_content"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        entityJson +
        `\r\n`
    )
  );

  // Part 2: Binary file data
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="VersionData"; filename="${fileName}"\r\n` +
        `Content-Type: ${contentType || detectContentType(filePath)}\r\n\r\n`
    )
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n`));

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const url = `${instanceUrl}${await dataPath(targetOrg, "/sobjects/ContentVersion")}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Upload failed (${response.status}): ${errorText}` };
    }

    const result = (await response.json()) as Record<string, unknown>;
    const contentVersionId = result.id as string;

    if (!contentVersionId) {
      return { success: false, error: "Upload succeeded but no ContentVersion ID returned" };
    }

    // Query back to get the ContentDocumentId
    const queryResult = await runSoqlQuery(
      `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${contentVersionId}' LIMIT 1`,
      targetOrg
    );

    let contentDocumentId = "";
    if (queryResult.success && queryResult.data?.records?.length) {
      contentDocumentId = queryResult.data.records[0].ContentDocumentId as string;
    }

    return {
      success: true,
      data: { id: contentVersionId, contentDocumentId },
    };
  } catch (error) {
    return {
      success: false,
      error: `Upload request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface BulkPresentationPage {
  contentDocumentId: string;
  name: string;
  pageOrder: number;
}

export type BulkPresentationContentType =
  | "PRESENTATION_ZIP"
  | "PRESENTATION_PDF"
  | "PRESENTATION_PAGE";

export interface BulkPresentationPayload {
  contentType: BulkPresentationContentType;
  name: string;
  presentationId?: string;
  activationDate?: string;
  deactivationDate?: string;
  playerGesture?: string;
  enableDoubleTapZoom?: boolean;
  enablePinchZoom?: boolean;
  topics?: string[];
  sendByEmail?: boolean;
  pages: BulkPresentationPage[];
}

/**
 * Create a presentation with all its pages via the Bulk Presentation Connect API (v66.0+).
 *
 * The v66.0 schema uses:
 *   { contentType, presentation: { name, ... }, pages: [{ name, contentDocumentId }] }
 * and returns { isSuccess, jobId, message }.
 */
export async function createBulkPresentation(
  payload: BulkPresentationPayload,
  targetOrg: string
): Promise<CliResult<unknown>> {
  const endpoint = await dataPath(targetOrg, "/connect/life-sciences/commercial/bulk-presentation");

  const presentation: Record<string, unknown> = {
    name: payload.name,
  };

  if (payload.presentationId) presentation.presentationId = payload.presentationId;
  if (payload.activationDate) presentation.activationDate = payload.activationDate;
  if (payload.deactivationDate) presentation.deactivationDate = payload.deactivationDate;
  if (payload.playerGesture) presentation.playerGesture = payload.playerGesture;
  if (payload.enableDoubleTapZoom !== undefined)
    presentation.enableDoubleTapZoom = payload.enableDoubleTapZoom;
  if (payload.enablePinchZoom !== undefined) presentation.enablePinchZoom = payload.enablePinchZoom;
  if (payload.topics && payload.topics.length > 0) presentation.topics = payload.topics;
  if (payload.sendByEmail !== undefined) presentation.sendByEmail = payload.sendByEmail;

  const body: Record<string, unknown> = {
    contentType: payload.contentType,
    presentation,
    pages: payload.pages.map((p) => ({
      contentDocumentId: p.contentDocumentId,
      name: p.name,
      pageNumber: p.pageOrder,
    })),
  };

  return apiRequest(endpoint, "POST", body, targetOrg);
}

/**
 * Open the target org in the browser via `sf org open`.
 * Optional `pagePath` parameter to open a specific page (e.g., "/lightning/setup/SetupOneHome/home").
 */
/**
 * Why `pagePath` can't be opened, or null. `sf org open` signs in through frontdoor.jsp and sends the
 * browser to the path, so it must be a path on the org: no scheme or `//host` (a signed-in hop to
 * another site), no backslashes or control characters, and not the login pages themselves.
 */
export function orgPagePathProblem(pagePath: string): string | null {
  const p = pagePath.trim();
  if (!p.startsWith("/"))
    return "The page path must start with / (for example /lightning/setup/SetupOneHome/home).";
  if (
    p.startsWith("//") ||
    /^\/*[a-z][a-z0-9+.-]*:/i.test(p.slice(1)) ||
    /[\\\u0000-\u001f\u007f]/.test(p)
  ) {
    return "The page path must be a page in the org, not another site.";
  }
  let decoded = p;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    return "The page path isn't a valid URL path.";
  }
  if (
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /^\/(secur\/|frontdoor\.jsp)/i.test(decoded)
  ) {
    return "The page path must be a page in the org, not another site or a login page.";
  }
  return null;
}

export async function openOrg(
  targetOrg: string,
  pagePath?: string
): Promise<CliResult<{ url: string; orgId: string; username: string }>> {
  if (pagePath) {
    const problem = orgPagePathProblem(pagePath);
    if (problem) return { success: false, error: problem };
  }
  const args = ["open"];
  if (pagePath) {
    args.push("--path", pagePath);
  }

  return execSfCommand<{ url: string; orgId: string; username: string }>("org", args, {
    targetOrg,
  });
}
