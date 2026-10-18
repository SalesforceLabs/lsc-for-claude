import { ipcMain, BrowserWindow, dialog, shell, net } from "electron";
import { execFile, spawn } from "child_process";
import { watch } from "fs";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConversationEngine } from "../engine/conversation.js";
import { McpClient, STUDIO_TOOL_PREFIX } from "../mcp/client.js";
import { listMobileLogins, mobileLoginCredentials, removeMobileLogin, startMobileLogin } from "../mobile-login.js";
import { PromptBuilder } from "../engine/prompt-builder.js";
import { LLMProvider } from "../llm/provider.js";
import { detectClaudeCodeGateway } from "../llm/claude-code-config.js";
import { apiStyle, Connection, CONNECTION_KINDS, connectionLabel } from "../llm/connection.js";
import { chatModels, cleanConnection, createProvider, testConnection } from "../llm/create.js";
import { loadSettings, migrateSettings, saveSettings, Settings } from "../settings.js";
import { applyAppIcon } from "../app-icon.js";
import { getSecret, hasSecret, setSecret } from "../secrets.js";
import {
  listConversations,
  createConversation,
  deleteConversation,
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
import { getStudioCache, setStudioCache, clearStudioCache } from "../engine/studio-cache.js";
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

const STUDIO_CACHED_TOOLS = new Set([
  "studio_feature_map",
  "studio_item_detail",
  "studio_list_profiles",
  "studio_access_options",
  "studio_ipad_published",
  "studio_readiness",
  "studio_setup_overview",
]);

// Shared resources (created once at engine:start)
let llm: LLMProvider | null = null;
// The running connection and the models it lists, so the picker only offers ones it serves
let llmConnection: Connection | null = null;
let llmModels: string[] | null = null;
let mcpClient: McpClient | null = null;
let promptBuilder: PromptBuilder | null = null;
let engineStarting: Promise<unknown> | null = null;

// Studio opens before the engine starts and asks for data right away; it waits on this.
let mcpStarted = false;
let resolveMcpReady: () => void = () => {};
let mcpReady = new Promise<void>((resolve) => (resolveMcpReady = resolve));

/** Point the MCP server at the org chosen in Settings, so tools and per-org stores agree. */
async function applyTargetOrg(client: McpClient): Promise<void> {
  const org = loadSettings().sfTargetOrg;
  if (!org) return;
  try {
    await client.callTool("set_target_org", { org });
  } catch {
    // The org may have been logged out; tools report the connection problem themselves.
  }
}

/** The started MCP client, waiting briefly if the engine hasn't started yet. */
async function readyMcpClient(timeoutMs = 60_000): Promise<McpClient | null> {
  if (!mcpStarted) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([mcpReady, new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
    clearTimeout(timer);
  }
  return mcpStarted ? mcpClient : null;
}

// Per-session engines
const engines = new Map<string, ConversationEngine>();

// Track which session is actively streaming (for abort)
let activeConvId: string | null = null;

const secretName = (connection: Connection) => `llm:${connection.kind}`;

/** A provider for `connection`, using `secret` if one was just entered, else the saved one. */
function providerFor(connection: Connection, secret?: string): LLMProvider {
  // net.fetch goes through Chromium: system certificates (company root CAs) and proxy settings.
  return createProvider(connection, secret || getSecret(secretName(connection)), (url, init) => net.fetch(url, init));
}

/** What the renderer needs about the running connection. */
function engineState() {
  const tools = mcpClient!.getTools();
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

/** Get or create an engine for a conversation. Restores messages from DB on first access. */
function getOrCreateEngine(convId: string): ConversationEngine {
  const existing = engines.get(convId);
  if (existing) return existing;

  if (!llm || !mcpClient || !promptBuilder) {
    throw new Error("Engine not started");
  }

  const engine = new ConversationEngine(llm, mcpClient, promptBuilder);
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
        if (!mcpClient) return;
        if (await longJobRunning(mcpClient)) {
          if (!deferred) console.log("[dev] MCP server reload deferred until the running Studio job finishes");
          deferred = true;
          schedule(RELOAD_RETRY_MS);
          return;
        }
        deferred = false;
        try {
          await mcpClient.restart();
          console.log("[dev] MCP server reloaded");
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
    return { ok: true };
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

      if (!mcpClient || !promptBuilder) {
        const doStart = async () => {
          // The target org lives in the server's memory, so every (re)spawn re-applies it.
          const client = new McpClient(undefined, applyTargetOrg);
          await client.start();
          mcpClient = client;
          promptBuilder = new PromptBuilder();
          mcpStarted = true;
          resolveMcpReady();
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
    activeConvId = null;

    await mcpClient?.stop();
    llm = null;
    llmConnection = null;
    llmModels = null;
    mcpClient = null;
    promptBuilder = null;
    mcpStarted = false;
    mcpReady = new Promise<void>((resolve) => (resolveMcpReady = resolve));
    return { ok: true };
  });

  // --- Chat ---

  ipcMain.handle("chat:send", async (_event, message: string | unknown[], nonce: number, convId: string, model?: string) => {
    if (!llm || !mcpClient || !promptBuilder) {
      return { ok: false, error: "Engine not started" };
    }

    let engine: ConversationEngine;
    try {
      engine = getOrCreateEngine(convId);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    activeConvId = convId;

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
    const accumulatedTools: Array<{ id: string; name: string; result?: string; isError?: boolean; status: string }> = [];

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
      if (activeConvId === convId) {
        activeConvId = null;
      }
      if (convId && (accumulatedText || accumulatedTools.length > 0)) {
        addMessage(
          convId,
          "assistant",
          accumulatedText,
          accumulatedTools.length > 0
            ? accumulatedTools.map((tc) => ({ id: tc.id, name: tc.name, result: tc.result, isError: tc.isError, status: tc.status }))
            : undefined
        );
      }
    });

    return { ok: true };
  });

  ipcMain.handle("chat:abort", async () => {
    if (activeConvId) {
      engines.get(activeConvId)?.abort();
    }
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

  ipcMain.handle("history:list", async () => {
    return listConversations();
  });

  ipcMain.handle("history:create", async (_event, firstMessage: string) => {
    return createConversation(firstMessage);
  });

  ipcMain.handle("history:delete", async (_event, id: string) => {
    // Also remove the per-session engine
    const engine = engines.get(id);
    if (engine) {
      engine.abort();
      engines.delete(id);
    }
    deleteConversation(id);
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

  ipcMain.handle("library:list", async () => {
    return listLibraryItems();
  });

  ipcMain.handle("library:save", async (_event, input) => {
    return createLibraryItem(input);
  });

  ipcMain.handle("library:delete", async (_event, id: string) => {
    deleteLibraryItem(id);
    return { ok: true };
  });

  ipcMain.handle("library:search", async (_event, query: string) => {
    return searchLibraryItems(query);
  });

  // --- Studio (direct MCP calls, no LLM) ---

  ipcMain.handle(
    "studio:call",
    async (_event, toolName: string, args: Record<string, unknown> = {}, refresh = false) => {
      if (!toolName.startsWith(STUDIO_TOOL_PREFIX)) {
        return { error: `Not a Studio tool: ${toolName}` };
      }
      // Org-backed results are persisted per org; the feature list is static and cheap.
      const cacheable = STUDIO_CACHED_TOOLS.has(toolName);
      const org = loadSettings().sfTargetOrg ?? "";
      const argsKey = JSON.stringify(args);
      if (cacheable && !refresh) {
        const cached = getStudioCache(org, toolName, argsKey);
        if (cached !== undefined) return { data: cached };
      }
      const client = await readyMcpClient();
      if (!client) return { error: "Engine not started" };
      try {
        // A feature map fans out to many sf CLI queries; allow well over the SDK's 60s default.
        const result = await client.callTool(toolName, args, { timeoutMs: 5 * 60_000 });
        const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
        const data = JSON.parse(text);
        // A layout whose XML couldn't be retrieved shouldn't stick — the next open retries.
        if (cacheable && !data?.error && data?.sidebar?.relatedLists !== null) {
          // Refreshing a map means the org changed — item details may be stale too.
          if (refresh && toolName === "studio_feature_map") {
            clearStudioCache(org, "studio_item_detail");
            clearStudioCache(org, "studio_list_profiles");
            clearStudioCache(org, "studio_access_options");
            clearStudioCache(org, "studio_ipad_published");
          }
          setStudioCache(org, toolName, argsKey, data);
        }
        // An applied change alters the org, so every cached map for it may be stale.
        if (toolName === "studio_apply_fix" && data?.ok) clearStudioCache(org);
        // A finished publish changes the metadata cache surfaces.
        if (toolName === "studio_publish_status" && data?.state === "done") {
          clearStudioCache(org, "studio_feature_map");
          clearStudioCache(org, "studio_readiness");
          clearStudioCache(org, "studio_setup_overview");
          clearStudioCache(org, "studio_ipad_published");
        }
        return { data };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
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

  ipcMain.handle("sfOrg:list", async () => {
    return new Promise((resolve) => {
      execFile("sf", ["org", "list", "--json"], { timeout: 15000 }, (error, stdout) => {
        if (error) {
          resolve({ orgs: [], error: error.message });
          return;
        }
        try {
          const data = JSON.parse(stdout);
          const orgs: Array<{ alias?: string; username: string; orgId: string; instanceUrl: string; isDefault?: boolean }> = [];
          const seen = new Set<string>();
          for (const category of ["nonScratchOrgs", "scratchOrgs", "sandboxes", "devHubs", "other"]) {
            const list = data?.result?.[category];
            if (!Array.isArray(list)) continue;
            for (const o of list) {
              const username = o.username || o.userName;
              if (!username || seen.has(username)) continue;
              seen.add(username);
              orgs.push({
                alias: o.alias || undefined,
                username,
                orgId: o.orgId || "",
                instanceUrl: o.instanceUrl || "",
                isDefault: o.isDefaultUsername || o.isDefaultDevHub || false,
              });
            }
          }
          resolve({ orgs });
        } catch {
          resolve({ orgs: [], error: "Failed to parse sf org list output" });
        }
      });
    });
  });

  ipcMain.handle("sfOrg:set", async (_event, org: string) => {
    const settings = loadSettings();
    saveSettings({ ...settings, sfTargetOrg: org });
    if (mcpStarted && mcpClient) await applyTargetOrg(mcpClient);
    mainWindow.webContents.send("sfOrg:changed", { org });
    return { ok: true };
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

  // Opens the org in the default browser, signed in through the sf CLI connection.
  ipcMain.handle("sfOrg:open", async (_event, org: string) => {
    return new Promise((resolve) => {
      execFile("sf", ["org", "open", "--target-org", org, "--url-only", "--json"], { timeout: 30000 }, (error, stdout) => {
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

  // --- Mobile logins for the first-sync simulator (tokens never leave the main process except to the engine) ---

  ipcMain.handle("mobileLogin:start", async (_event, loginUrl: string) => {
    try {
      return { login: await startMobileLogin(loginUrl, mainWindow) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("mobileLogin:list", async () => ({ logins: listMobileLogins() }));

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
      const mobileLogins = await Promise.all(listMobileLogins().map((l) => mobileLoginCredentials(l.id)));
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
