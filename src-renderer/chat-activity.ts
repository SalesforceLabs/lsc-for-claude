/**
 * Plain-words labels for what Roz is doing in a reply: each tool call as a phrase ("Searching the
 * knowledge base", "Searched the knowledge base"), with the argument that says what it was about,
 * and the reply's activity line ("Thinking…", "Querying the org…", "Drawing a diagram…").
 */
import type { ChatMessage, ToolCall } from "./hooks/useChat";

interface ToolPhrase {
  running: string;
  done: string;
}

const PHRASES: Record<string, ToolPhrase> = {
  search_lsc_knowledge: { running: "Searching the knowledge base", done: "Searched the knowledge base" },
  list_lsc_modules: { running: "Listing LSC modules", done: "Listed LSC modules" },
  get_lsc_module_docs: { running: "Reading module docs", done: "Read module docs" },
  explain_lsc_concept: { running: "Looking up a concept", done: "Looked up a concept" },
  get_lsc_admin_setup: { running: "Reading admin setup", done: "Read admin setup" },
  list_lsc_help_docs: { running: "Listing help docs", done: "Listed help docs" },
  get_lsc_help_doc: { running: "Reading help docs", done: "Read help docs" },
  get_lsc_guide: { running: "Reading a guide", done: "Read a guide" },
  get_lsc_troubleshooting: { running: "Reading troubleshooting docs", done: "Read troubleshooting docs" },
  get_lsc_exercise: { running: "Reading an exercise", done: "Read an exercise" },
  get_release_notes: { running: "Reading release notes", done: "Read release notes" },
  salesforce_docs_search: { running: "Searching Salesforce Help", done: "Searched Salesforce Help" },
  salesforce_docs_fetch: { running: "Reading Salesforce Help", done: "Read Salesforce Help" },
  check_lsc_setup: { running: "Checking the setup", done: "Checked the setup" },
  list_sf_orgs: { running: "Listing orgs", done: "Listed orgs" },
  open_org: { running: "Opening the org", done: "Opened the org" },
  run_soql: { running: "Querying the org", done: "Queried the org" },
  describe_sobject: { running: "Describing an object", done: "Described an object" },
  get_record: { running: "Reading a record", done: "Read a record" },
  create_record: { running: "Creating a record", done: "Created a record" },
  update_record: { running: "Updating a record", done: "Updated a record" },
  delete_record: { running: "Deleting a record", done: "Deleted a record" },
  bulk_create_records: { running: "Creating records", done: "Created records" },
  bulk_update_records: { running: "Updating records", done: "Updated records" },
  run_apex: { running: "Running Apex", done: "Ran Apex" },
  deploy_metadata: { running: "Deploying metadata", done: "Deployed metadata" },
  retrieve_metadata: { running: "Retrieving metadata", done: "Retrieved metadata" },
  list_admin_settings: { running: "Reading Admin Console settings", done: "Read Admin Console settings" },
  update_admin_setting: { running: "Updating an Admin Console setting", done: "Updated an Admin Console setting" },
  create_admin_setting: { running: "Creating an Admin Console setting", done: "Created an Admin Console setting" },
  list_trigger_handlers: { running: "Reading trigger handlers", done: "Read trigger handlers" },
  toggle_trigger_handler: { running: "Switching a trigger handler", done: "Switched a trigger handler" },
  list_db_schema: { running: "Reading DB Schema", done: "Read DB Schema" },
  get_db_schema: { running: "Reading a DB Schema record", done: "Read a DB Schema record" },
  create_db_schema: { running: "Creating a DB Schema record", done: "Created a DB Schema record" },
  update_db_schema: { running: "Updating a DB Schema record", done: "Updated a DB Schema record" },
  toggle_db_schema: { running: "Switching a DB Schema record", done: "Switched a DB Schema record" },
  list_lsc_actions: { running: "Reading actions", done: "Read actions" },
  list_navigation_tabs: { running: "Reading navigation tabs", done: "Read navigation tabs" },
  list_users: { running: "Listing users", done: "Listed users" },
  list_permission_sets: { running: "Reading permission sets", done: "Read permission sets" },
  health_check: { running: "Running a health check", done: "Ran a health check" },
  get_org_status: { running: "Reading the org's status", done: "Read the org's status" },
  audit_mobile_config: { running: "Auditing mobile configuration", done: "Audited mobile configuration" },
  diagnose_lsc_issue: { running: "Matching the issue to known causes", done: "Matched the issue to known causes" },
  check_mobile_cache_status: { running: "Checking the mobile metadata cache", done: "Checked the mobile metadata cache" },
  generate_mobile_metadata_cache: { running: "Generating the mobile metadata cache", done: "Generated the mobile metadata cache" },
  export_config: { running: "Exporting configuration", done: "Exported configuration" },
  diff_orgs: { running: "Comparing orgs", done: "Compared orgs" },
  profile_sync_volume: { running: "Predicting sync volume", done: "Predicted sync volume" },
  analyze_sync_telemetry: { running: "Reading sync telemetry", done: "Read sync telemetry" },
  simulate_initial_sync: { running: "Simulating a first sync", done: "Simulated a first sync" },
};

/** `check_visit_config` → "Checking visit configuration". */
const CHECK_CONFIG = /^check_([a-z_]+)_config$/;

/** Arguments that say what a call is about, most telling first. */
const DETAIL_KEYS = [
  "query", "soql", "q", "concept", "topic", "term", "module", "moduleName", "slug", "release",
  "objectName", "sobject", "sObjectType", "object", "developerName", "category", "name", "label",
  "recordId", "username", "profile", "url",
];

/** Strips an MCP server prefix (`mcp__salesforce-docs__salesforce_docs_search`). */
function bareName(name: string): string {
  const parts = name.split("__");
  return parts[parts.length - 1];
}

function humanize(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toolPhrase(name: string): ToolPhrase {
  const bare = bareName(name);
  const known = PHRASES[bare];
  if (known) return known;
  const check = CHECK_CONFIG.exec(bare);
  if (check) {
    const area = check[1].replace(/_/g, " ");
    return { running: `Checking ${area} configuration`, done: `Checked ${area} configuration` };
  }
  const plain = humanize(bare);
  return { running: plain, done: plain };
}

/** The argument that says what the call was about, on one line and at most `max` characters. */
export function toolDetail(input: Record<string, unknown> | undefined, max = 80): string | undefined {
  if (!input) return undefined;
  for (const key of DETAIL_KEYS) {
    const value = input[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) continue;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return undefined;
}

/** A tool row's label: what it does or did. */
export function toolLabel(tool: ToolCall): string {
  const phrase = toolPhrase(tool.name);
  return tool.status === "running" || tool.status === "pending" ? phrase.running : phrase.done;
}

/** "Searched the knowledge base ×3, Queried the org" — a collapsed group's summary. */
export function summarizeTools(tools: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) {
    const label = toolPhrase(t.name).done;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(", ");
}

/**
 * Where an unclosed ```mermaid fence starts in `text`, or -1 when every diagram is complete — a
 * half-written chart isn't drawn until its fence closes.
 */
export function openMermaidFence(text: string): number {
  let open = -1;
  let inFence = false;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (/^```/.test(line.trim())) {
      if (inFence) {
        inFence = false;
        open = -1;
      } else {
        inFence = true;
        open = /^```\s*mermaid\b/i.test(line.trim()) ? offset : -1;
      }
    }
    offset += line.length + 1;
  }
  return inFence ? open : -1;
}

export interface Activity {
  /** What the reply is doing now, ending in "…". */
  label: string;
  /** What the running tool is about, shown after the label. */
  detail?: string;
  /** Changes when the activity does, to restart its timer. */
  key: string;
  /** Whether to show how long it's been going — not while text visibly flows. */
  timed: boolean;
}

/** What a streaming reply is doing now, or null once it's finished. */
export function replyActivity(msg: ChatMessage): Activity | null {
  if (!msg.isStreaming) return null;
  const last = msg.blocks[msg.blocks.length - 1];
  if (!last) return { label: "Thinking…", key: "thinking:0", timed: true };
  if (last.type === "text") {
    if (openMermaidFence(last.text) >= 0) return { label: "Drawing a diagram…", key: `diagram:${msg.blocks.length}`, timed: true };
    return { label: "Writing…", key: `writing:${msg.blocks.length}`, timed: false };
  }
  const tools = msg.blocks.flatMap((b) => (b.type === "tool" ? [b.tool] : []));
  const running = tools.find((t) => t.status === "running");
  if (running) {
    return { label: `${toolPhrase(running.name).running}…`, detail: toolDetail(running.input), key: `tool:${running.id}`, timed: true };
  }
  // A pending call is one the model is still writing — from the outside, that's thinking.
  return { label: "Thinking…", key: `thinking:${msg.blocks.length}`, timed: true };
}

/** Slowest steady reveal, in characters a second. */
const MIN_REVEAL_CPS = 90;

/**
 * How far a streamed reply's text is revealed after `dtMs` more: it eases toward what has
 * arrived (about a quarter second behind, twice as fast once the text has stopped growing), so
 * bursty network chunks read as a steady flow.
 */
export function advanceReveal(shown: number, total: number, dtMs: number, finishing: boolean): number {
  if (shown >= total) return total;
  const backlog = total - shown;
  const cps = Math.max(MIN_REVEAL_CPS, backlog * (finishing ? 8 : 4));
  return Math.min(total, shown + (cps * Math.min(dtMs, 100)) / 1000);
}

/** Where to cut `text` to reveal about `n` characters: at the end of a word, so words never appear half-written. */
export function revealCut(text: string, n: number): number {
  const at = Math.floor(n);
  if (at >= text.length) return text.length;
  if (at <= 0) return 0;
  const rest = text.slice(at, at + 24).search(/\s/);
  return rest < 0 ? at : at + rest;
}
