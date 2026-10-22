/**
 * Chat writes go through review. The chat tool loop asks `gateTool` before it runs any tool; for a
 * tool that writes to the org (or the machine) the gate either queues the change in Studio's
 * pending-changes tray (when Studio can make it: `fix-for-tool.ts` on the server) or asks the user
 * to Allow / Deny it in the conversation. Read-only tools pass untouched.
 *
 * No Electron imports: the window is reached through `send`, so this is testable on its own.
 */

import { randomUUID } from "node:crypto";
import type { ToolHost } from "../mcp/pool.js";
import type { SessionOrg } from "./session-org.js";

// --- Which tools write -------------------------------------------------------------

/** Tools that change the org (or, for install_sf_cli, this machine) — each needs review. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "add_navigation_tab",
  "add_visit_engagement_sidebar_item",
  "assign_permission_set",
  "assign_presentation_content",
  "bulk_create_records",
  "bulk_update_records",
  "create_admin_setting",
  "create_custom_action",
  "create_db_schema",
  "create_quick_action",
  "create_record",
  "delete_lsc_action",
  "delete_record",
  "deploy_metadata",
  "distribute_presentation",
  "generate_mobile_metadata_cache",
  "import_config", // only its ui and apply modes — see isWrite
  "install_sf_cli",
  "run_apex",
  "toggle_db_schema",
  "toggle_trigger_handler",
  "unassign_permission_set",
  "update_admin_setting",
  "update_db_schema",
  "update_lsc_action",
  "update_record",
  "upload_presentation",
]);

/**
 * Tools that only read the org. retrieve_metadata writes to a temporary project and open_org opens
 * the browser without review; run_perf_assessment and simulate_initial_sync with an `outputPath`,
 * and any read naming another org, are asked about (`readApprovalSummary`).
 */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  "analyze_sync_telemetry",
  "audit_mobile_config",
  "check_account_config",
  "check_activity_plan_config",
  "check_briefings_config",
  "check_lsc_setup",
  "check_mobile_cache_status",
  "check_sample_config",
  "check_territory_config",
  "check_user_access",
  "check_user_config",
  "check_visit_config",
  "describe_sobject",
  "diagnose_lsc_issue",
  "diff_orgs",
  "explain_lsc_concept",
  "export_config",
  "get_db_schema",
  "get_lsc_admin_setup",
  "get_lsc_exercise",
  "get_lsc_guide",
  "get_lsc_help_doc",
  "get_lsc_module_docs",
  "get_lsc_troubleshooting",
  "get_org_status",
  "get_record",
  "get_release_notes",
  "health_check",
  "list_admin_settings",
  "list_db_schema",
  "list_lsc_actions",
  "list_lsc_help_docs",
  "list_lsc_modules",
  "list_navigation_tabs",
  "list_permission_sets",
  "list_sf_orgs",
  "list_trigger_handlers",
  "list_users",
  "list_validation_groups",
  "open_org",
  "profile_sync_volume",
  "retrieve_metadata",
  "run_perf_assessment",
  "run_soql",
  "search_lsc_knowledge",
  "set_target_org", // refused for sessions by the engine before the gate
  "simulate_initial_sync",
]);

/** Whether this call changes anything. Unknown tools count as writes: a new tool is reviewed until classified. */
export function isWrite(name: string, input: Record<string, unknown>): boolean {
  if (name === "import_config") return input.mode === "ui" || input.mode === "apply";
  if (READ_TOOLS.has(name)) return false;
  return true;
}

// --- What a call will do, in a sentence --------------------------------------------

const keysOf = (v: unknown): string => (v && typeof v === "object" ? Object.keys(v).join(", ") : "");
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const list = (v: unknown): string => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "");
const withFields = (base: string, fields: string) => (fields ? `${base} (${fields})` : base);

/** One plain sentence: what the call changes. */
export function describeWrite(name: string, input: Record<string, unknown>): string {
  const i = input;
  switch (name) {
    case "create_record":
      return withFields(`Create a ${text(i.objectName) || "new"} record`, keysOf(i.values));
    case "update_record":
      return withFields(`Update ${text(i.objectName)} ${text(i.recordId)}`.trim(), keysOf(i.values));
    case "delete_record":
      return `Delete ${text(i.objectName)} record ${text(i.recordId)}`.trim();
    case "bulk_create_records":
      return `Create ${plural(countOf(i.records), "record")} on ${text(i.sobjectType) || "an object"}`;
    case "bulk_update_records":
      return `Update ${plural(countOf(i.records), "record")} on ${text(i.sobjectType) || "an object"}`;
    case "run_apex": {
      const lines = text(i.code).split("\n").length;
      return `Run ${plural(lines, "line")} of anonymous Apex in the org`;
    }
    case "deploy_metadata":
      return `Deploy the metadata in ${text(i.sourcePath) || "a local folder"} to the org`;
    case "create_quick_action":
      return `Create the quick action "${text(i.label) || text(i.developerName)}"${i.isActive === false ? " (inactive)" : ""}`;
    case "create_custom_action":
      return `Create the custom action "${text(i.label) || text(i.developerName)}"`;
    case "update_lsc_action":
      return withFields(`Update the action ${text(i.actionId) || ""}`.trim(), [i.label !== undefined ? "label" : "", i.isActive !== undefined ? "active" : "", i.fieldValues ? keysOf(i.fieldValues) : ""].filter(Boolean).join(", "));
    case "delete_lsc_action":
      return `Delete the action ${text(i.actionName) || text(i.actionId)}`;
    case "toggle_trigger_handler":
      return `${i.active ? "Turn on" : "Turn off"} the trigger handler ${text(i.handlerName)}`;
    case "toggle_db_schema":
      return `${i.active ? "Turn on" : "Turn off"} the DB Schema record ${text(i.name)}`;
    case "update_db_schema":
      return withFields(`Update the DB Schema record ${text(i.name)}`, Object.keys(i).filter((k) => !["name", "targetOrg"].includes(k)).join(", "));
    case "create_db_schema":
      return `Create a DB Schema record for ${text(i.objectName)}`;
    case "update_admin_setting":
      return withFields(`Update the Admin Console setting ${text(i.recordId)}`, [keysOf(i.fields), Array.isArray(i.fieldValues) ? list((i.fieldValues as Array<{ fieldName?: unknown }>).map((f) => f.fieldName)) : ""].filter(Boolean).join(", "));
    case "create_admin_setting":
      return `Create the Admin Console setting "${text(i.label) || text(i.developerName)}" in ${text(i.category)}`;
    case "add_navigation_tab":
      return `Add the "${text(i.label)}" tab to LSC Mobile`;
    case "assign_permission_set":
    case "unassign_permission_set": {
      const who = countOf(i.userIds) + countOf(i.usernames);
      return `${name === "assign_permission_set" ? "Give" : "Remove"} the permission set ${text(i.permissionSetName)} ${name === "assign_permission_set" ? "to" : "from"} ${plural(who, "user")}`;
    }
    case "generate_mobile_metadata_cache":
      return `Regenerate the mobile metadata cache for ${list(i.profileNames) || "the chosen profiles"}`;
    case "upload_presentation":
      return `Upload the presentation ${text(i.presentationName) || text(i.filePath)}`;
    case "distribute_presentation":
      return `Share a presentation with ${plural(countOf(i.territoryIds), "territory")}`;
    case "assign_presentation_content":
      return "Assign topics and products to a presentation";
    case "add_visit_engagement_sidebar_item":
      return `Add ${text(i.objectName)} to the visit engagement sidebar on ${text(i.layoutName) || "the Visit layout"}`;
    case "import_config":
      return i.mode === "apply" ? "Apply selected configuration from a snapshot to the org" : "Open the configuration import review and apply screen for the org";
    case "install_sf_cli":
      return "Install the Salesforce CLI on this computer";
    default:
      return `Run ${name}`;
  }
}

// --- Approvals -------------------------------------------------------------------

export interface ApprovalRequestInfo {
  requestId: string;
  convId: string;
  toolId: string;
  name: string;
  input: Record<string, unknown>;
  summary: string;
  production: boolean;
}

export type Send = (channel: string, payload: unknown) => boolean;

interface Pending {
  info: ApprovalRequestInfo;
  settle: (allowed: boolean) => void;
}

/** Approvals waiting for the user, across sessions. */
export class ApprovalBroker {
  private pending = new Map<string, Pending>();

  constructor(private send: Send) {}

  /**
   * Ask the user. Resolves false when denied, when `signal` aborts (the run was stopped), or when
   * the window can't be reached — a run never hangs on an answer nobody can give.
   */
  request(info: Omit<ApprovalRequestInfo, "requestId">, signal: AbortSignal): Promise<boolean> {
    const full: ApprovalRequestInfo = { ...info, requestId: randomUUID() };
    return new Promise<boolean>((resolve) => {
      let done = false;
      const settle = (allowed: boolean) => {
        if (done) return;
        done = true;
        this.pending.delete(full.requestId);
        signal.removeEventListener("abort", onAbort);
        this.send("chat:approval-settled", { requestId: full.requestId, convId: full.convId, toolId: full.toolId, allowed });
        resolve(allowed);
      };
      const onAbort = () => settle(false);
      if (signal.aborted) return resolve(false);
      this.pending.set(full.requestId, { info: full, settle });
      signal.addEventListener("abort", onAbort);
      if (!this.send("chat:approval-request", full)) settle(false);
    });
  }

  /** The user's answer; false when the request is gone (answered, or its run stopped). */
  respond(requestId: string, allow: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    entry.settle(allow);
    return true;
  }

  list(): ApprovalRequestInfo[] {
    return [...this.pending.values()].map((p) => p.info);
  }
}

// --- The gate --------------------------------------------------------------------

export interface GateResult {
  text: string;
  isError: boolean;
}

export const DECLINED_TEXT = "The user declined this change. Don't retry it; ask what they'd like instead.";

/** The refusal for a write naming another org than the session's. */
export function otherOrgRefusal(org: SessionOrg): string {
  return `This session works on ${org.ref.label || org.ref.username}; it can't change another org. Call the tool again without targetOrg, or tell the user to start a session in the other org.`;
}

/** True when `target` (an alias or username) is not the session's org. */
export function namesOtherOrg(org: SessionOrg, target: unknown): boolean {
  if (typeof target !== "string" || !target.trim()) return false;
  const t = target.trim().toLowerCase();
  return t !== org.ref.username.toLowerCase() && t !== (org.ref.label ?? "").toLowerCase();
}

/** Inputs naming an sf CLI connection a call runs as, besides the session's own. */
const ORG_INPUTS = ["targetOrg", "sourceOrg", "countAsOrg"];

function orgInputs(name: string, input: Record<string, unknown>): string[] {
  const keys = name === "simulate_initial_sync" ? [...ORG_INPUTS, "username"] : ORG_INPUTS;
  return keys.map((k) => input[k]).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim());
}

/**
 * The connections a call names that are on another org than the session's. A login on the session's
 * own org (a rep's, for counting or a first sync) isn't another org; one sf CLI doesn't know is.
 */
export async function otherOrgsNamed(
  org: SessionOrg,
  name: string,
  input: Record<string, unknown>,
  resolveOrgId: (key: string) => Promise<string | undefined>
): Promise<string[]> {
  const others: string[] = [];
  for (const key of orgInputs(name, input)) {
    if (!namesOtherOrg(org, key) || others.includes(key)) continue;
    const id = await resolveOrgId(key).catch(() => undefined);
    const own = org.ref.orgId;
    if (id && own && id.slice(0, 15) === own.slice(0, 15)) continue;
    others.push(key);
  }
  return others;
}

/** Read tools that save a file wherever `outputPath` says. */
const FILE_OUTPUT_TOOLS = new Set(["run_perf_assessment", "simulate_initial_sync"]);

/** Why a read-only call still needs the user's yes, in a sentence, or null. */
export function readApprovalSummary(name: string, input: Record<string, unknown>, otherOrgs: string[]): string | null {
  const parts: string[] = [];
  if (otherOrgs.length) parts.push(`read from ${otherOrgs.length === 1 ? "another org" : "other orgs"}, ${otherOrgs.join(" and ")}`);
  const out = typeof input.outputPath === "string" ? input.outputPath.trim() : "";
  if (FILE_OUTPUT_TOOLS.has(name) && out) parts.push(`save its result to ${out} on this computer`);
  return parts.length ? `Run ${name} and ${parts.join(", and ")}` : null;
}

interface ToolChangeLike {
  fix: { label?: string };
}

interface FixesAnswer {
  changes?: ToolChangeLike[];
  note?: string;
  unsupported?: string;
}

export interface WriteGateOptions {
  convId: string;
  org: SessionOrg | null;
  /** The session's MCP server — the gate calls `studio_fix_for_tool` on it, which the model can't. */
  host: Pick<ToolHost, "callTool">;
  broker: ApprovalBroker;
  send: Send;
  /** The org Id of an sf CLI alias or username, to tell another login on the session's org from another org. */
  resolveOrgId?: (key: string) => Promise<string | undefined>;
}

async function fixesFor(host: WriteGateOptions["host"], name: string, input: Record<string, unknown>): Promise<FixesAnswer | null> {
  try {
    const res = await host.callTool("studio_fix_for_tool", { name, input });
    if (res.isError) return null;
    return JSON.parse(res.content.map((c) => c.text).join("")) as FixesAnswer;
  } catch {
    return null;
  }
}

/** The `gateTool` hook for one session. */
export function createWriteGate(opts: WriteGateOptions) {
  const { convId, org, host, broker, send } = opts;
  const resolveOrgId = opts.resolveOrgId ?? (async () => undefined);
  const orgName = (org?.ref.username ?? "").toLowerCase();

  return async (call: { id: string; name: string; input: Record<string, unknown>; signal: AbortSignal }): Promise<GateResult | null> => {
    const { id, name, input, signal } = call;
    const production = org?.kind === "production";
    const otherOrgs = org ? await otherOrgsNamed(org, name, input, resolveOrgId) : [];
    if (!isWrite(name, input)) {
      // Reads stay in the session's org too; reaching another org, or saving a file, is the user's call.
      const summary = readApprovalSummary(name, input, otherOrgs);
      if (!summary) return null;
      const allowed = await broker.request({ convId, toolId: id, name, input, summary, production: false }, signal);
      return allowed ? null : { text: DECLINED_TEXT, isError: true };
    }
    // A write runs in the session's org only: a per-call targetOrg would reach past it unreviewed.
    if (org && namesOtherOrg(org, input.targetOrg)) return { text: otherOrgRefusal(org), isError: true };

    // A write that also reads another org (import_config's sourceOrg) is asked about as a whole.
    const answer = otherOrgs.length ? null : await fixesFor(host, name, input);
    if (signal.aborted) return { text: DECLINED_TEXT, isError: true };

    if (answer && !answer.unsupported && Array.isArray(answer.changes)) {
      if (answer.changes.length === 0) {
        return {
          text: JSON.stringify({ status: "no-change", message: `${answer.note ?? "Nothing to change."} Nothing was queued or written.` }),
          isError: false,
        };
      }
      const changes = answer.changes.map((c) => c.fix.label ?? "Change");
      if (send("tray:queue", { convId, toolId: id, org: orgName, changes: answer.changes })) {
        return {
          text: JSON.stringify({
            status: "queued",
            changes,
            ...(answer.note ? { note: answer.note } : {}),
            message:
              "Queued in Studio's tray for the user to review and apply. Nothing has been written yet. Tell the user the change is waiting in Studio (Review & apply) and don't call the tool again.",
          }),
          isError: false,
        };
      }
      // The window is gone: nobody can review a queued change, and nobody can answer an approval either.
      return { text: DECLINED_TEXT, isError: true };
    }

    const summary = describeWrite(name, input) + (otherOrgs.length ? `, reading ${otherOrgs.join(" and ")}` : "");
    const allowed = await broker.request({ convId, toolId: id, name, input, summary, production }, signal);
    return allowed ? null : { text: DECLINED_TEXT, isError: true };
  };
}
