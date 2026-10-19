import { app, ipcMain, BrowserWindow, dialog, shell, net } from "electron";
import { execFile, spawn } from "child_process";
import { watch } from "fs";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

/** Studio tools that take `refresh` to read the org again rather than reuse its short shared reads. */
const STUDIO_REFRESHABLE = new Set(["studio_feature_map", "studio_readiness", "studio_setup_overview", "studio_user_trace", "studio_drift"]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConversationEngine } from "../engine/conversation.js";
import { McpClient, STUDIO_TOOL_PREFIX } from "../mcp/client.js";
import { McpPool, type PoolOrg } from "../mcp/pool.js";
import { cacheArgsWithRepLogins, repLoginsFor, type RepLoginRef } from "../engine/rep-logins.js";
import { listSfOrgs, orgKey, pickOrg, resolveOrg, sameOrgId, toOrgRef, type OrgKind, type OrgRef } from "../orgs.js";
import { OrgRoles } from "../org-roles.js";
import type { SessionOrg } from "../engine/session-org.js";
import {
  checkMobileLogins,
  listMobileLogins,
  mobileLoginCredentials,
  onMobileLoginsChanged,
  removeMobileLogin,
  renewMobileLogin,
  startMobileLogin,
} from "../mobile-login.js";
import { PromptBuilder } from "../engine/prompt-builder.js";
import { LLMProvider } from "../llm/provider.js";
import { detectClaudeCodeGateway } from "../llm/claude-code-config.js";
import { apiStyle, Connection, CONNECTION_KINDS, connectionLabel } from "../llm/connection.js";
import { chatModels, cleanConnection, createProvider, testConnection } from "../llm/create.js";
import { loadSettings, migrateSettings, saveSettings, Settings } from "../settings.js";
import { applyAppIcon } from "../app-icon.js";
import { applyTheme } from "../theme.js";
import { getSecret, hasSecret, setSecret } from "../secrets.js";
import {
  listConversations,
  createConversation,
  deleteConversation,
  getConversation,
  bindConversationOrg,
  bindConversationsOrg,
  searchConversations,
  orgUsernameForLabel,
  getMessages,
  addMessage,
  updateConversationTitle,
  togglePinConversation,
} from "../engine/history.js";
import {
  listLibraryItems,
  createLibraryItem,
  deleteLibraryItem,
  searchLibraryItems,
} from "../engine/library.js";
import { getStudioCacheRow, setStudioCacheText, clearStudioCache } from "../engine/studio-cache.js";
import { isCacheable } from "../engine/studio-cache-policy.js";
import {
  INVALIDATED_BY_MAP_REFRESH,
  INVALIDATED_BY_PUBLISH,
  bumpGeneration,
  generationOf,
  toolsInvalidatedByApply,
} from "../engine/studio-invalidation.js";
import { createInFlight } from "../engine/in-flight.js";
import { openInPreviewBrowser, type BrowserAuth } from "../studio-browser.js";
import {
  adoptUnassigned,
  listPerfPlans,
  savePerfPlan,
  deletePerfPlan,
  listPerfRuns,
  getPerfRun,
  savePerfRun,
  deletePerfRun,
  listPerfSims,
  getPerfSim,
  savePerfSim,
  deletePerfSim,
  type PerfRunRecord,
  type PerfSimRecord,
} from "../engine/perf-store.js";

const studioInFlight = createInFlight<{ data?: unknown; error?: string }>();

/** Drop cached Studio results for an org and make loads already in flight skip the cache. */
function invalidate(org: string, tools: string[]): void {
  bumpGeneration(org);
  for (const tool of tools) clearStudioCache(org, tool);
}

const STUDIO_CACHED_TOOLS = new Set([
  "studio_feature_map",
  "studio_item_detail",
  "studio_list_profiles",
  "studio_access_options",
  "studio_ipad_published",
  "studio_unpublished",
  "studio_readiness",
  "studio_setup_overview",
  "studio_sync_overview",
  "studio_sync_user",
]);

// Shared resources (created once at engine:start)
let llm: LLMProvider | null = null;
// The running connection and the models it lists, so the picker only offers ones it serves
let llmConnection: Connection | null = null;
let llmModels: string[] | null = null;
// One MCP server per Salesforce connection (see pool.ts); Studio uses the selected org's.
let mcpPool: McpPool | null = null;
let poolSweep: NodeJS.Timeout | null = null;
let promptBuilder: PromptBuilder | null = null;
let engineStarting: Promise<unknown> | null = null;

// Studio opens before the engine starts and asks for data right away; it waits on this.
let mcpStarted = false;
let resolveMcpReady: () => void = () => {};
let mcpReady = new Promise<void>((resolve) => (resolveMcpReady = resolve));

/** A server for `org`, pointed at it every time it (re)starts — the target lives in the server's memory. */
function createOrgClient(org: PoolOrg): McpClient {
  return new McpClient(undefined, async (client) => {
    if (!org.target) return;
    try {
      await client.callTool("set_target_org", { org: org.target });
    } catch {
      // The org may have been logged out; tools report the connection problem themselves.
    }
  });
}

interface SelectedOrg {
  /** Null only when there's no org to work in at all. */
  ref: OrgRef | null;
  kind?: OrgKind;
  pool: PoolOrg;
}

/** The org selected in the app: the one in Settings, else the sf CLI default (or the only connection). */
async function selectedOrg(): Promise<SelectedOrg> {
  const key = loadSettings().sfTargetOrg;
  const org = await resolveOrg(key);
  if (org) return { ref: toOrgRef(org), kind: org.kind, pool: { username: org.username, target: orgKey(org) } };
  if (key) {
    // Logged out or renamed: keep it by name, so nothing quietly runs in another org.
    const username = orgUsernameForLabel(key) ?? key;
    return { ref: { username, label: key }, pool: { username, target: key } };
  }
  return { ref: null, pool: { username: "", target: "" } };
}

/** The server for a session's org; by its username, so a renamed alias still finds it. */
async function sessionOrg(ref: OrgRef | null): Promise<{ org: SessionOrg | null; pool: PoolOrg }> {
  if (!ref) return { org: null, pool: { username: "", target: "" } };
  const live = pickOrg((await listSfOrgs()).orgs, ref.username);
  return {
    org: { ref: live ? toOrgRef(live) : ref, kind: live?.kind },
    pool: { username: ref.username, target: live ? orgKey(live) : ref.username },
  };
}

/** The selected org's server, waiting briefly if the engine hasn't started yet. */
async function readyMcpClient(timeoutMs = 60_000): Promise<McpClient | null> {
  if (!mcpStarted) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([mcpReady, new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
    clearTimeout(timer);
  }
  if (!mcpStarted || !mcpPool) return null;
  return mcpPool.get((await selectedOrg()).pool);
}

/** How long a server for an org nobody's looking at stays up after its last call. */
const POOL_IDLE_MS = 10 * 60_000;

// Per-session engines
const engines = new Map<string, ConversationEngine>();

// Sessions with a run in flight, and the connection each runs as — their servers stay up.
const runningConvs = new Map<string, string>();

const secretName = (connection: Connection) => `llm:${connection.kind}`;

/** A path inside the org for `sf org open --path`: org-relative, no scheme or host, URL-safe characters only. */
const isOrgPath = (path: unknown): path is string =>
  typeof path === "string" && path.length <= 512 && /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]*$/.test(path);

/** A provider for `connection`, using `secret` if one was just entered, else the saved one. */
function providerFor(connection: Connection, secret?: string): LLMProvider {
  // net.fetch goes through Chromium: system certificates (company root CAs) and proxy settings.
  return createProvider(connection, secret || getSecret(secretName(connection)), (url, init) => net.fetch(url, init));
}

/** What the renderer needs about the running connection. */
function engineState() {
  const tools = mcpPool!.getTools();
  return {
    ok: true,
    providerType: llmConnection!.kind,
    apiStyle: apiStyle(llmConnection!.kind),
    label: connectionLabel(llmConnection!.kind),
    defaultModel: llmConnection!.model,
    toolCount: tools.length,
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
    models: llmModels ?? undefined,
  };
}

/**
 * Get or create an engine for a conversation, working in the conversation's org.
 * Restores messages from DB on first access.
 */
async function getOrCreateEngine(convId: string, ref: OrgRef | null): Promise<ConversationEngine> {
  const existing = engines.get(convId);
  if (existing) return existing;

  if (!llm || !mcpPool || !promptBuilder) {
    throw new Error("Engine not started");
  }

  const { org, pool } = await sessionOrg(ref);
  const engine = new ConversationEngine(llm, mcpPool.host(pool), promptBuilder, org);
  engine.initialize();

  // Restore message history from DB so the LLM has full conversation context
  const stored = getMessages(convId);
  if (stored.length > 0) {
    engine.restoreMessages(stored);
  }

  engines.set(convId, engine);
  return engine;
}

/** Studio jobs that live in the server's memory and would be lost by a respawn. */
const LONG_JOB_TOOLS = ["studio_sim_active", "studio_perf_active"];
const RELOAD_RETRY_MS = 15_000;

async function longJobRunning(client: McpClient): Promise<boolean> {
  for (const tool of LONG_JOB_TOOLS) {
    try {
      const result = await client.callTool(tool, {});
      const data = JSON.parse(result.content.find((c) => c.type === "text")?.text ?? "{}");
      if (data?.job) return true;
    } catch {
      // No org connected, or the server is down — nothing to protect.
    }
  }
  return false;
}

/**
 * Dev only (`electron:dev`): respawn the MCP server whenever `tsc --watch`
 * rewrites dist/, so server and Studio collector changes apply without
 * restarting the app. Studio's cache is kept so a reload doesn't re-query
 * the org — hit Refresh in Studio to see a collector change. A reload waits
 * while a first-sync simulation or performance run is in progress.
 */
function watchMcpServer(): void {
  const distDir = path.resolve(__dirname, "..", "..", "dist");
  let timer: NodeJS.Timeout | null = null;
  let reloading: Promise<void> = Promise.resolve();
  let deferred = false;
  const schedule = (delayMs: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      reloading = reloading.then(async () => {
        const clients = mcpPool?.running() ?? [];
        if (clients.length === 0) return;
        for (const client of clients) {
          if (!(await longJobRunning(client))) continue;
          if (!deferred) console.log("[dev] MCP server reload deferred until the running Studio job finishes");
          deferred = true;
          schedule(RELOAD_RETRY_MS);
          return;
        }
        deferred = false;
        try {
          await Promise.all(clients.map((client) => client.restart()));
          console.log(`[dev] MCP server reloaded (${clients.length})`);
        } catch (error) {
          console.error("[dev] MCP server reload failed:", error);
        }
      });
    }, delayMs);
  };
  try {
    watch(distDir, { recursive: true }, (_event, file) => {
      if (!file || !file.endsWith(".js")) return;
      // A deferred reload keeps polling on its own schedule.
      if (!deferred) schedule(400);
    });
  } catch (error) {
    console.error(`[dev] Can't watch ${distDir}:`, error);
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  if (process.env.LSC_RENDERER_URL) watchMcpServer();

  // --- Settings ---

  // Old settings kept keys in plain text; move them to the keychain before anything reads them.
  try {
    migrateSettings((connection, secret) => setSecret(secretName(connection), secret));
  } catch (error) {
    console.error("Couldn't migrate LLM settings:", error);
  }

  ipcMain.handle("settings:get", async () => {
    return loadSettings();
  });

  ipcMain.handle("settings:save", async (_event, settings: Settings) => {
    saveSettings(settings);
    applyAppIcon(settings.appIcon, mainWindow);
    applyTheme(settings.theme, mainWindow);
    return { ok: true };
  });

  /** Settings shows an appearance as soon as it's picked; Cancel puts the saved one back. */
  ipcMain.handle("theme:preview", async (_event, theme: unknown) => {
    applyTheme(theme, mainWindow);
  });

  // --- Connections ---

  /** What's available without asking: Claude Code's gateway, env API keys, and saved keys. */
  ipcMain.handle("provider:detect", async () => {
    const gateway = detectClaudeCodeGateway();
    let claudeCode: string | undefined;
    if (gateway) {
      try {
        claudeCode = new URL(gateway.baseUrl).host;
      } catch {
        claudeCode = gateway.baseUrl;
      }
    }
    return {
      claudeCode,
      env: { anthropic: !!process.env.ANTHROPIC_API_KEY, openai: !!process.env.OPENAI_API_KEY },
      savedSecrets: CONNECTION_KINDS.filter((kind) => hasSecret(`llm:${kind}`)),
    };
  });

  ipcMain.handle("provider:test", async (_event, connection: Connection, secret?: string) => {
    try {
      const clean = cleanConnection(connection);
      return await testConnection(providerFor(clean, secret), clean);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- Engine Lifecycle ---

  /**
   * Connect with `connection` (and a just-entered `secret`, saved to the keychain).
   * Starts the MCP server the first time; later calls only swap the model connection.
   */
  ipcMain.handle("engine:start", async (_event, connection: Connection, secret?: string) => {
    try {
      if (engineStarting) await engineStarting.catch(() => {});
      const clean = cleanConnection(connection);
      const provider = providerFor(clean, secret);
      const models = chatModels(apiStyle(clean.kind), (await provider.listModels?.()) ?? null);

      if (!mcpPool || !promptBuilder) {
        const doStart = async () => {
          const pool = new McpPool(createOrgClient);
          await pool.get((await selectedOrg()).pool);
          mcpPool = pool;
          promptBuilder = new PromptBuilder();
          mcpStarted = true;
          resolveMcpReady();
          // Servers for orgs nobody is looking at are stopped once idle; a Studio job or a run keeps one up.
          poolSweep = setInterval(async () => {
            const keep = [(await selectedOrg()).pool.username, ...runningConvs.values()];
            await pool.sweep(keep, POOL_IDLE_MS, longJobRunning).catch(() => {});
          }, 60_000);
        };
        engineStarting = doStart();
        try {
          await engineStarting;
        } finally {
          engineStarting = null;
        }
      }

      // Sessions hold the provider they were made with; they're rebuilt from history on next use.
      for (const engine of engines.values()) engine.abort();
      engines.clear();
      llm = provider;
      llmConnection = clean;
      llmModels = models;

      if (secret) setSecret(secretName(clean), secret);
      saveSettings({ ...loadSettings(), connection: clean });
      return engineState();
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("engine:stop", async () => {
    // Abort all active engines
    for (const engine of engines.values()) {
      engine.abort();
    }
    engines.clear();
    runningConvs.clear();

    if (poolSweep) clearInterval(poolSweep);
    poolSweep = null;
    await mcpPool?.stopAll();
    llm = null;
    llmConnection = null;
    llmModels = null;
    mcpPool = null;
    promptBuilder = null;
    mcpStarted = false;
    mcpReady = new Promise<void>((resolve) => (resolveMcpReady = resolve));
    return { ok: true };
  });

  // --- Chat ---

  ipcMain.handle("chat:send", async (_event, message: string | unknown[], nonce: number, convId: string, model?: string) => {
    if (!llm || !mcpPool || !promptBuilder) {
      return { ok: false, error: "Engine not started" };
    }

    let engine: ConversationEngine;
    let username: string;
    try {
      // A session from before orgs were recorded joins the selected org with its next message.
      let org = getConversation(convId)?.org ?? null;
      if (!org) {
        org = (await selectedOrg()).ref;
        if (org) bindConversationOrg(convId, org);
      }
      username = org?.username ?? "";
      engine = await getOrCreateEngine(convId, org);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    runningConvs.set(convId, username);

    // Extract text for history persistence (images are not stored in history DB)
    let textForHistory: string;
    if (Array.isArray(message)) {
      textForHistory = (message as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n");
    } else {
      textForHistory = message;
    }

    // Accumulate assistant content for server-side persistence.
    let accumulatedText = "";
    // Text that resumes after a tool call is a new paragraph; without a break the saved message runs rounds together.
    let toolSinceText = false;
    const accumulatedTools: Array<{ id: string; name: string; input?: Record<string, unknown>; result?: string; isError?: boolean; status: string }> = [];

    // ALL events are always sent — tagged with convId so the renderer decides what to display.
    // No nonce filtering on the main process side.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runPromise = engine.sendMessage(message as any, {
      onTextDelta: (text) => {
        if (toolSinceText && accumulatedText && !accumulatedText.endsWith("\n\n")) {
          accumulatedText = accumulatedText.replace(/\n?$/, "\n\n");
        }
        toolSinceText = false;
        accumulatedText += text;
        mainWindow.webContents.send("chat:text-delta", { text, nonce, convId });
      },
      onToolStart: (id, name) => {
        toolSinceText = true;
        accumulatedTools.push({ id, name, status: "running" });
        mainWindow.webContents.send("chat:tool-start", { id, name, nonce, convId });
      },
      onToolRun: (id, input) => {
        const tool = accumulatedTools.find((t) => t.id === id);
        if (tool) tool.input = input;
        mainWindow.webContents.send("chat:tool-run", { id, input, nonce, convId });
      },
      onToolResult: (id, result, isError) => {
        const tool = accumulatedTools.find((t) => t.id === id);
        if (tool) {
          tool.result = result;
          tool.isError = isError;
          tool.status = isError ? "error" : "success";
        }
        mainWindow.webContents.send("chat:tool-result", { id, result, isError, nonce, convId });
      },
      onToolEnd: (id) => {
        mainWindow.webContents.send("chat:tool-end", { id, nonce, convId });
      },
      onComplete: () => {
        mainWindow.webContents.send("chat:complete", { nonce, convId });
      },
      onError: (error) => {
        mainWindow.webContents.send("chat:error", { error, nonce, convId });
      },
    }, model);

    // Persist when the run finishes — whether it completed, errored, or was aborted.
    runPromise.finally(() => {
      runningConvs.delete(convId);
      if (convId && (accumulatedText || accumulatedTools.length > 0)) {
        addMessage(
          convId,
          "assistant",
          accumulatedText,
          accumulatedTools.length > 0
            ? accumulatedTools.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input, result: tc.result, isError: tc.isError, status: tc.status }))
            : undefined
        );
      }
    });

    return { ok: true };
  });

  // Stops the given session's run — another session (perhaps in another org) may be running too.
  ipcMain.handle("chat:abort", async (_event, convId: string) => {
    engines.get(convId)?.abort();
    return { ok: true };
  });

  ipcMain.handle("chat:clear", async () => {
    // No-op — per-session engines don't need clearing.
    // Each session has its own engine with its own message history.
    return { ok: true };
  });

  // --- Commands ---

  ipcMain.handle("commands:list", async () => {
    const pb = new PromptBuilder();
    return pb.getCommandList();
  });

  ipcMain.handle("skills:list", async () => {
    const pb = new PromptBuilder();
    return pb.getSkillIndex();
  });

  // --- Conversation History ---

  /** The selected org's sessions (and any not tied to an org); `all` for every org's. */
  ipcMain.handle("history:list", async (_event, scope: "org" | "all" = "org") => {
    const { ref } = await selectedOrg();
    return listConversations({ orgUsername: scope === "all" || !ref ? undefined : ref.username });
  });

  ipcMain.handle("history:search", async (_event, query: string, scope: "org" | "all" = "org") => {
    const { ref } = await selectedOrg();
    return searchConversations(query, { orgUsername: scope === "all" || !ref ? undefined : ref.username });
  });

  ipcMain.handle("history:get", async (_event, id: string) => getConversation(id) ?? null);

  // Sessions with no org join the selected one; sessions already in an org never move.
  ipcMain.handle("history:move-to-org", async (_event, ids: string[]) => {
    const { ref } = await selectedOrg();
    if (!ref) return { ok: false, moved: 0, error: "No org is selected" };
    return { ok: true, moved: bindConversationsOrg(ids, ref) };
  });

  // A new session works in the org selected now, for good.
  ipcMain.handle("history:create", async (_event, firstMessage: string) => {
    return createConversation(firstMessage, (await selectedOrg()).ref);
  });

  const removeConversation = (id: string) => {
    // Also remove the per-session engine
    const engine = engines.get(id);
    if (engine) {
      engine.abort();
      engines.delete(id);
    }
    deleteConversation(id);
  };

  ipcMain.handle("history:delete", async (_event, id: string) => {
    removeConversation(id);
    return { ok: true };
  });

  ipcMain.handle("history:delete-many", async (_event, ids: string[]) => {
    for (const id of ids) removeConversation(id);
    return { ok: true };
  });

  ipcMain.handle("history:rename", async (_event, id: string, title: string) => {
    updateConversationTitle(id, title);
    return { ok: true };
  });

  ipcMain.handle("history:toggle-pin", async (_event, id: string) => {
    togglePinConversation(id);
    return { ok: true };
  });

  ipcMain.handle("history:messages", async (_event, conversationId: string) => {
    return getMessages(conversationId);
  });

  ipcMain.handle(
    "history:add-message",
    async (
      _event,
      conversationId: string,
      role: "user" | "assistant",
      text: string,
      toolCalls?: unknown[]
    ) => {
      return addMessage(conversationId, role, text, toolCalls);
    }
  );

  // --- Library ---

  /** Library scope: the selected org's items (and those from no known org), or every org's. */
  const libraryOrg = async (scope: "org" | "all") => {
    if (scope === "all") return undefined;
    return (await selectedOrg()).ref?.username;
  };

  ipcMain.handle("library:list", async (_event, scope: "org" | "all" = "org") => {
    return listLibraryItems({ orgUsername: await libraryOrg(scope) });
  });

  // Saved under its session's org; from no session (or one not tied yet), the selected org.
  ipcMain.handle("library:save", async (_event, input) => {
    const fromSession = input.sourceConversationId ? getConversation(input.sourceConversationId)?.org : null;
    return createLibraryItem({ ...input, org: fromSession ?? (await selectedOrg()).ref });
  });

  ipcMain.handle("library:delete", async (_event, id: string) => {
    deleteLibraryItem(id);
    return { ok: true };
  });

  ipcMain.handle("library:search", async (_event, query: string, scope: "org" | "all" = "org") => {
    return searchLibraryItems(query, { orgUsername: await libraryOrg(scope) });
  });

  // --- Studio (direct MCP calls, no LLM) ---

  ipcMain.handle(
    "studio:call",
    async (_event, toolName: string, args: Record<string, unknown> = {}, refresh = false) => {
      if (!toolName.startsWith(STUDIO_TOOL_PREFIX)) {
        return { error: `Not a Studio tool: ${toolName}` };
      }
      // Live progress of a running preview/apply: no cache and no shared in-flight call (each poll
      // must see the state as it is now), and it makes no org calls so it never queues behind the work.
      if (toolName === "studio_fix_progress") {
        const client = await readyMcpClient();
        if (!client) return { error: "Engine not started" };
        try {
          const result = await client.callTool(toolName, args, { timeoutMs: 15_000 });
          return { data: JSON.parse(result.content.find((c) => c.type === "text")?.text ?? "{}") };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }
      // Org-backed results are persisted per org; the feature list is static and cheap.
      const cacheable = STUDIO_CACHED_TOOLS.has(toolName);
      const org = loadSettings().sfTargetOrg ?? "";
      // The published iPad reads as the previewed rep when Studio holds their login (tokens go to the engine for this call only).
      let offered: RepLoginRef[] = [];
      if (toolName === "studio_ipad_published") {
        const orgId = (await resolveOrg(loadSettings().sfTargetOrg))?.orgId;
        offered = repLoginsFor(
          listMobileLogins().filter((l) => !orgId || !l.orgId || sameOrgId(l.orgId, orgId)),
          typeof args.userId === "string" ? args.userId : undefined
        ).slice(0, 25);
      }
      const argsKey = JSON.stringify(cacheArgsWithRepLogins(args, offered));
      if (cacheable && !refresh) {
        // `cachedAt` lets a view say how old the answer is ("Updated 12 min ago").
        const cached = getStudioCacheRow(org, toolName, argsKey);
        if (cached) return { data: JSON.parse(cached.text), cachedAt: cached.cachedAt };
      }
      // Identical concurrent calls share one load (a timed-out one keeps running server-side).
      // A load that began before a write (generation) neither joins nor feeds the cache after it.
      const gen = generationOf(org);
      return studioInFlight(`${org}\u0000${toolName}\u0000${argsKey}\u0000${refresh}\u0000${gen}`, async () => {
        const client = await readyMcpClient();
        if (!client) return { error: "Engine not started" };
        try {
          // A feature map fans out to many sf CLI queries; allow well over the SDK's 60s default. The published
          // iPad adds the metadata download to its live reads (list views up to ~4 minutes, then records).
          const mobileLogins = (await Promise.all(offered.map((l) => mobileLoginCredentials(l.id).catch(() => null)))).filter((l): l is NonNullable<typeof l> => !!l);
          const callArgs = { ...args, ...(refresh && STUDIO_REFRESHABLE.has(toolName) ? { refresh: true } : {}), ...(mobileLogins.length ? { mobileLogins } : {}) };
          const result = await client.callTool(toolName, callArgs, { timeoutMs: toolName === "studio_ipad_published" ? 8 * 60_000 : 5 * 60_000 });
          const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
          const data = JSON.parse(text);
          const cachedAt = new Date().toISOString();
          // Partial results (failed surfaces, checks that couldn't run) shouldn't stick — the next open retries.
          if (cacheable && isCacheable(toolName, data) && generationOf(org) === gen) {
            // Refreshing a map means the org changed — item details may be stale too.
            if (refresh && toolName === "studio_feature_map") {
              for (const tool of INVALIDATED_BY_MAP_REFRESH) clearStudioCache(org, tool);
            }
            setStudioCacheText(org, toolName, argsKey, text);
          }
          // An applied change alters the org: drop what it can affect (not the slow, unaffected published iPad).
          if (toolName === "studio_apply_fix" && data?.ok) invalidate(org, toolsInvalidatedByApply(args.fix));
          // A finished publish changes the metadata cache surfaces.
          if (toolName === "studio_publish_status" && data?.state === "done") invalidate(org, INVALIDATED_BY_PUBLISH);
          return { data, cachedAt };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // A write that errored or timed out may still have landed.
          if (toolName === "studio_apply_fix") invalidate(org, toolsInvalidatedByApply(args.fix));
          if (/time(d)?[ -]?out/i.test(message)) {
            return {
              error:
                "This is taking longer than 5 minutes. It is still loading in the background, so try again in a minute and it should be ready.",
            };
          }
          return { error: message };
        }
      });
    }
  );

  // --- Studio performance testing: plans and run history (per org) ---

  // With no org picked in Settings the tools use the sf CLI default, so ask the engine which org
  // that is; plans and runs must be filed under the same org the runs go against.
  const currentOrg = async (): Promise<string> => {
    const chosen = loadSettings().sfTargetOrg;
    if (chosen) return chosen;
    const client = await readyMcpClient();
    if (!client) return "";
    try {
      const result = await client.callTool("studio_connected_org", {});
      const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
      return (JSON.parse(text) as { org?: string }).org ?? "";
    } catch {
      return "";
    }
  };

  ipcMain.handle("perf:listPlans", async () => {
    const org = await currentOrg();
    adoptUnassigned(org);
    return listPerfPlans(org);
  });

  ipcMain.handle(
    "perf:savePlan",
    async (_event, input: { id?: string; name: string; plan: unknown }) =>
      savePerfPlan({ ...input, org: await currentOrg() })
  );

  ipcMain.handle("perf:deletePlan", async (_event, id: string) => {
    deletePerfPlan(id);
    return { ok: true };
  });

  ipcMain.handle("perf:listRuns", async (_event, planId: string) => listPerfRuns(await currentOrg(), planId));

  ipcMain.handle("perf:getRun", async (_event, id: string) => getPerfRun(id));

  // Filed under the org the run went against, which may not be the one selected now.
  ipcMain.handle(
    "perf:saveRun",
    async (_event, input: Omit<PerfRunRecord, "id" | "org"> & { org?: string; result: unknown }) =>
      savePerfRun({ ...input, org: input.org || (await currentOrg()) })
  );

  ipcMain.handle("perf:deleteRun", async (_event, id: string) => {
    deletePerfRun(id);
    return { ok: true };
  });

  ipcMain.handle("perf:listSims", async () => listPerfSims());

  ipcMain.handle("perf:getSim", async (_event, id: string) => getPerfSim(id));

  ipcMain.handle("perf:saveSim", async (_event, input: Omit<PerfSimRecord, "id"> & { result: unknown }) => savePerfSim(input));

  ipcMain.handle("perf:deleteSim", async (_event, id: string) => {
    deletePerfSim(id);
    return { ok: true };
  });

  // Import / export test plans (YAML) and reports (Markdown, JSON) through native file dialogs.
  ipcMain.handle("perf:openFile", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Import test plan",
      properties: ["openFile"],
      filters: [{ name: "NFR profile", extensions: ["yaml", "yml"] }],
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true };
    return { canceled: false, text: await readFile(res.filePaths[0], "utf-8") };
  });

  ipcMain.handle(
    "perf:saveFile",
    async (_event, defaultName: string, text: string, kind: "yaml" | "json" | "md") => {
      const filters = {
        yaml: [{ name: "NFR profile", extensions: ["yaml"] }],
        json: [{ name: "JSON", extensions: ["json"] }],
        md: [{ name: "Markdown", extensions: ["md"] }],
      };
      const res = await dialog.showSaveDialog(mainWindow, {
        title: kind === "yaml" ? "Export test plan" : "Export report",
        defaultPath: defaultName,
        filters: filters[kind] ?? filters.json,
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      await writeFile(res.filePath, text, "utf-8");
      return { canceled: false, path: res.filePath };
    }
  );

  // --- Salesforce Org Management ---

  // Which connections are LSC admins, checked in the background; the renderer hears as roles arrive.
  const orgRoles = new OrgRoles(path.join(app.getPath("userData"), "org-roles.json"), (roles) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("sfOrg:roles", roles);
  });

  ipcMain.handle("sfOrg:list", async (_event, options?: { recheckRoles?: boolean }) => {
    const list = await listSfOrgs({ fresh: true });
    orgRoles.check(list.orgs, { force: options?.recheckRoles });
    return { ...list, orgs: list.orgs.map((o) => ({ ...o, role: orgRoles.get(o.username) })) };
  });

  // Studio and new sessions follow the selected org; sessions already running stay in theirs.
  ipcMain.handle("sfOrg:set", async (_event, org: string) => {
    // Store the alias when there is one, so per-org stores (Studio cache, test plans) keep one key.
    const match = pickOrg((await listSfOrgs()).orgs, org);
    const key = match ? orgKey(match) : org;
    saveSettings({ ...loadSettings(), sfTargetOrg: key });
    mainWindow.webContents.send("sfOrg:changed", { org: key });
    // Start its server now, so Studio's first call doesn't wait on a spawn.
    if (mcpStarted && mcpPool) mcpPool.get((await selectedOrg()).pool).catch(() => {});
    return { ok: true, org: key };
  });

  ipcMain.handle("sfOrg:login", async (_event, alias?: string, instanceUrl?: string) => {
    return new Promise((resolve) => {
      const args = ["org", "login", "web", "--json"];
      if (alias) args.push("--alias", alias);
      if (instanceUrl) args.push("--instance-url", instanceUrl);
      const child = spawn("sf", args, { stdio: "ignore", detached: true });
      child.unref();
      // Login happens asynchronously in the browser — resolve immediately
      resolve({ ok: true });
    });
  });

  // Opens the org in the default browser, signed in through the sf CLI connection — optionally on a page
  // inside it (an org-relative path such as /lightning/setup/FlexiPageList/home).
  ipcMain.handle("sfOrg:open", async (_event, org: string, path?: string) => {
    if (path !== undefined && !isOrgPath(path)) return { ok: false, error: "Not a page in the org" };
    const args = ["org", "open", "--target-org", org, "--url-only", "--json", ...(path ? ["--path", path] : [])];
    return new Promise((resolve) => {
      execFile("sf", args, { timeout: 30000 }, (error, stdout) => {
        try {
          const url = JSON.parse(stdout)?.result?.url;
          if (typeof url === "string" && url.startsWith("https://")) {
            shell.openExternal(url);
            resolve({ ok: true });
            return;
          }
        } catch {
          // Fall through to the error below.
        }
        resolve({ ok: false, error: error?.message ?? "sf org open returned no URL" });
      });
    });
  });

  // --- Studio's iPad preview browser (the frontdoor link stays in this process) ---

  ipcMain.handle("studioBrowser:open", async (event, guestId: number, url: string, auth: BrowserAuth) => {
    try {
      return await openInPreviewBrowser(event.sender, guestId, url, auth);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- Test users' mobile logins (tokens never leave the main process except to the engine) ---

  onMobileLoginsChanged((logins) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("mobileLogin:changed", logins);
  });

  ipcMain.handle("mobileLogin:start", async (_event, loginUrl: string) => {
    try {
      return { login: await startMobileLogin(loginUrl, mainWindow) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("mobileLogin:list", async () => ({ logins: listMobileLogins() }));

  // Refreshes logins not used lately, so "Signed in" / "Expired" is current.
  ipcMain.handle("mobileLogin:check", async () => ({ logins: await checkMobileLogins() }));

  ipcMain.handle("mobileLogin:renew", async (_event, id: string) => {
    try {
      return { login: await renewMobileLogin(id, mainWindow) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // An inline LWC's data request in the iPad preview, answered as the previewed rep's mobile login.
  ipcMain.handle("studio:lwcRequestAs", async (_event, loginId: string, req: { method: string; path: string; body?: unknown }) => {
    const client = await readyMcpClient();
    if (!client) return { error: "Engine not started" };
    try {
      const mobileLogin = await mobileLoginCredentials(loginId);
      const result = await client.callTool("studio_lwc_request", { ...req, mobileLogin });
      const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
      return result.isError ? { error: text } : { data: JSON.parse(text) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("mobileLogin:remove", async (_event, id: string) => {
    removeMobileLogin(id);
    return { ok: true };
  });

  ipcMain.handle("studio:simStartMobile", async (_event, loginId: string, options: Record<string, unknown> = {}) => {
    const client = await readyMcpClient();
    if (!client) return { error: "Engine not started" };
    try {
      const mobileLogin = await mobileLoginCredentials(loginId);
      const result = await client.callTool("studio_sim_start", { connection: mobileLogin.username, mobileLogin, options });
      return { data: JSON.parse(result.content.find((c) => c.type === "text")?.text ?? "{}") };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Starts a performance run; personas whose users have a mobile login get their exact table list.
  // Tokens go to the engine for this job only and never come back in a status or result.
  ipcMain.handle("studio:perfStartMobile", async (_event, plan: unknown) => {
    const client = await readyMcpClient();
    if (!client) return { error: "Engine not started" };
    try {
      // Only the selected org's test users, and only those still signed in.
      const orgId = (await resolveOrg(loadSettings().sfTargetOrg))?.orgId;
      const usable = listMobileLogins().filter((l) => l.status === "signedIn" && (!orgId || !l.orgId || sameOrgId(l.orgId, orgId)));
      const mobileLogins = (await Promise.all(usable.map((l) => mobileLoginCredentials(l.id).catch(() => null)))).filter(
        (l): l is NonNullable<typeof l> => !!l
      ).slice(0, 25);
      const result = await client.callTool("studio_perf_start", { plan, ...(mobileLogins.length ? { mobileLogins } : {}) });
      return { data: JSON.parse(result.content.find((c) => c.type === "text")?.text ?? "{}") };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- File Reading ---

  ipcMain.handle("file:read", async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, "utf-8");
      return { ok: true, content, path: filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("file:open-external", async (_event, url: string) => {
    shell.openExternal(url);
    return { ok: true };
  });

  // --- Guide Section Reading ---

  ipcMain.handle(
    "file:read-guide-section",
    async (_event, guideSlug: string, sectionSlug: string) => {
      try {
        const { readFileSync, existsSync } = await import("fs");

        // Resolve paths relative to the project root (two levels up from dist-electron/ipc/)
        const guidesDir = path.join(__dirname, "..", "..", "knowledge", "guides", guideSlug);
        const manifestPath = path.join(guidesDir, "_manifest.json");

        if (!existsSync(manifestPath)) {
          return { ok: false, error: `Guide '${guideSlug}' not found` };
        }

        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const section = manifest.sections?.find(
          (s: { slug: string }) => s.slug === sectionSlug
        );
        if (!section) {
          return { ok: false, error: `Section '${sectionSlug}' not found in guide '${guideSlug}'` };
        }

        const sectionPath = path.join(guidesDir, section.file);
        if (!existsSync(sectionPath)) {
          return { ok: false, error: `Section file not found: ${section.file}` };
        }

        const content = readFileSync(sectionPath, "utf-8");

        // Build both a lsc-local:// URL and the absolute file path for the PDF
        const pdfUrl = `lsc-local://file/documentation/${encodeURIComponent(manifest.pdfFileName)}`;
        const pdfPath = path.join(__dirname, "..", "..", "documentation", manifest.pdfFileName);

        return {
          ok: true,
          content,
          guideTitle: manifest.guideTitle,
          guideSlug: manifest.guideSlug,
          pdfFileName: manifest.pdfFileName,
          pdfUrl,
          pdfPath,
          sectionTitle: section.title,
          sectionSlug: section.slug,
          startPage: section.startPage,
          endPage: section.endPage,
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "file:open-pdf-at-page",
    async (_event, pdfFileName: string, pageNum: number) => {
      try {
        const { existsSync } = await import("fs");

        const pdfPath = path.join(__dirname, "..", "..", "documentation", pdfFileName);
        if (!existsSync(pdfPath)) {
          return { ok: false, error: `PDF not found: ${pdfFileName}` };
        }

        // Open in default PDF viewer — page navigation is manual for now
        shell.openPath(pdfPath);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Open a PDF in a dedicated Electron window with Chromium's native viewer at a specific page
  ipcMain.handle(
    "file:open-pdf-window",
    async (_event, pdfFileName: string, pageNum: number) => {
      try {
        const { existsSync } = await import("fs");
        const { pathToFileURL } = await import("url");

        const pdfPath = path.join(__dirname, "..", "..", "documentation", pdfFileName);
        if (!existsSync(pdfPath)) {
          return { ok: false, error: `PDF not found: ${pdfFileName}` };
        }

        const fileUrl = pathToFileURL(pdfPath).toString() + `#page=${pageNum}`;

        const pdfWindow = new BrowserWindow({
          width: 900,
          height: 800,
          title: `${pdfFileName} — Page ${pageNum}`,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            plugins: true,
          },
        });

        pdfWindow.loadURL(fileUrl);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
