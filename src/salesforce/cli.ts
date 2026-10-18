/**
 * Salesforce CLI wrapper
 * Executes sf commands and handles output parsing
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import { cacheGet, cacheSet, queryCacheKey, describeCacheKey } from "../cache.js";

const execAsync = promisify(exec);

export interface CliResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  rawOutput?: string;
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
 * A unique directory is created per process (session) using the PID.
 */
const TMP_SFDX_PROJECT_DIR = path.join(os.tmpdir(), `lsc-sfdx-project-${process.pid}`);

export function ensureTmpSfdxProject(): string {
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
          sourceApiVersion: "62.0",
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
  options: { targetOrg?: string; timeout?: number; cwd?: string } = {}
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
 * List all authenticated orgs
 */
export async function listOrgs(): Promise<CliResult<SfOrgListResult>> {
  return execSfCommand<SfOrgListResult>("org", ["list"]);
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
export async function runSoqlQuery(
  query: string,
  targetOrg: string,
  options: { useToolingApi?: boolean } = {}
): Promise<CliResult<SoqlQueryResult>> {
  const args = ["query", "--query", query];
  if (options.useToolingApi) {
    args.push("--use-tooling-api");
  }
  return execSfCommand<SoqlQueryResult>("data", args, {
    targetOrg,
  });
}

/**
 * Run a Tooling API SOQL query
 */
export async function runToolingQuery(
  query: string,
  targetOrg: string
): Promise<CliResult<SoqlQueryResult>> {
  return runSoqlQuery(query, targetOrg, { useToolingApi: true });
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
    cacheSet(targetOrg, key, result, options.ttlMs);
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
    cacheSet(targetOrg, key, result, ttlMs);
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
  const endpoint = `/services/data/v66.0/tooling/sobjects/${objectName}`;
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
  const endpoint = `/services/data/v66.0/tooling/sobjects/${objectName}/${recordId}`;
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
  const endpoint = `/services/data/v66.0/tooling/sobjects/${objectName}/${recordId}`;
  return apiRequest<void>(endpoint, "DELETE", undefined, targetOrg);
}

/**
 * Describe an SObject
 */
export async function describeSObject(
  objectName: string,
  targetOrg: string
): Promise<CliResult<SObjectDescribeResult>> {
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
  targetOrg: string
): Promise<CliResult<unknown>> {
  const cwd = ensureTmpSfdxProject();
  return execSfCommand("project", ["deploy", "start", "--source-dir", sourcePath], {
    targetOrg,
    timeout: 300000,
    cwd,
  });
}

/**
 * Delete one metadata component (a destructive-changes deploy of an otherwise empty package).
 * The component must not be in use (a layout still assigned, a page still activated).
 */
export async function deleteMetadata(type: string, fullName: string, targetOrg: string): Promise<CliResult<unknown>> {
  const cwd = ensureTmpSfdxProject();
  const dir = path.join(cwd, "destructive", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}    <version>62.0</version>\n</Package>\n`;
  const escaped = fullName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  fs.writeFileSync(path.join(dir, "package.xml"), xml(""));
  fs.writeFileSync(
    path.join(dir, "destructiveChanges.xml"),
    xml(`    <types>\n        <members>${escaped}</members>\n        <name>${type}</name>\n    </types>\n`)
  );
  try {
    return await execSfCommand(
      "project",
      ["deploy", "start", "--manifest", path.join(dir, "package.xml"), "--post-destructive-changes", path.join(dir, "destructiveChanges.xml")],
      { targetOrg, timeout: 300000, cwd }
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
  targetOrg: string
): Promise<CliResult<{ outputDir: string }>> {
  const projectDir = ensureTmpSfdxProject();
  const relativeOutput = path.join("retrieve-output", `${Date.now()}`);
  const absoluteOutput = path.join(projectDir, relativeOutput);
  fs.mkdirSync(absoluteOutput, { recursive: true });

  const result = await execSfCommand(
    "project",
    ["retrieve", "start", ...[metadata].flat().flatMap((m) => ["--metadata", m]), "--output-dir", relativeOutput],
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
  const tmpFile = path.join(os.tmpdir(), `apex-${Date.now()}.apex`);
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
  return new Promise((resolve) => {
    const args = ["api", "request", "rest", endpoint, "--method", method];

    if (body) {
      args.push("--body", JSON.stringify(body));
    } else if (method === "DELETE") {
      // SF CLI bug: DELETE without --body fails with "No 'mode' found in 'body' entry"
      args.push("--body", JSON.stringify({ mode: "raw" }));
    }

    args.push("--target-org", targetOrg);

    const child = spawn("sf", args, {
      stdio: "pipe",
      timeout: 120000,
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
 * Generate mobile metadata cache by calling the Connect API
 */
export async function generateMobileMetadataCache(
  parentMetadataRecordId: string,
  apiVersion: string,
  prefix: string,
  targetOrg: string
): Promise<CliResult<unknown>> {
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
  const result = await execSfCommand<Record<string, unknown>>("org", ["display"], {
    targetOrg,
  });

  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Failed to get org credentials" };
  }

  const accessToken = result.data.accessToken as string | undefined;
  const instanceUrl = result.data.instanceUrl as string | undefined;

  if (!accessToken || !instanceUrl) {
    return {
      success: false,
      error:
        "Org credentials missing accessToken or instanceUrl. Re-authenticate with: sf org login web",
    };
  }

  return { success: true, data: { accessToken, instanceUrl } };
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

  const url = `${instanceUrl}/services/data/v62.0/sobjects/ContentVersion`;

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
  const endpoint = "/services/data/v66.0/connect/life-sciences/commercial/bulk-presentation";

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
export async function openOrg(
  targetOrg: string,
  pagePath?: string
): Promise<CliResult<{ url: string; orgId: string; username: string }>> {
  const args = ["open"];
  if (pagePath) {
    args.push("--path", pagePath);
  }

  return execSfCommand<{ url: string; orgId: string; username: string }>("org", args, {
    targetOrg,
  });
}
