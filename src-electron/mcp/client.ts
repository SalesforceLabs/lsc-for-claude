import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UtilityProcessTransport, type ForkServer } from "./utility-transport.js";
import { ToolDefinition } from "../llm/provider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Tools that serve the Studio GUI directly; never offered to the chat model. */
export const STUDIO_TOOL_PREFIX = "studio_";

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * MCP Client that runs the existing LSC MCP server as an Electron utility process
 * (`utility-transport.ts`) using the official MCP SDK client.
 */
export class McpClient {
  private client: Client | null = null;
  private transport: UtilityProcessTransport | null = null;
  private tools: ToolDefinition[] = [];
  private serverDir: string;
  /** The (re)connect in flight, so concurrent calls share one respawn. */
  private starting: Promise<void> | null = null;
  /** Tool calls in flight, and when the last one finished — the pool only stops idle servers. */
  private inFlight = 0;
  private lastUsedAt = Date.now();

  /**
   * @param onStarted runs after every successful (re)start — e.g. to re-apply the
   *   target org, which lives in the server process's memory.
   */
  constructor(serverDir?: string, private onStarted?: (client: McpClient) => Promise<void>) {
    this.serverDir = serverDir ?? path.resolve(__dirname, "..", "..");
  }

  /** Connects if there's no server yet; a running one is left alone (the pool calls this on every `get`). */
  start(): Promise<void> {
    if (this.client && !this.starting) return Promise.resolve();
    this.starting ??= this.connect().finally(() => (this.starting = null));
    return this.starting;
  }

  private async connect(): Promise<void> {
    const serverScript = path.join(this.serverDir, "dist", "index.js");

    const transport = new UtilityProcessTransport(forkWithElectron, serverScript, {
      // Inside a packaged app the server folder is app.asar, which can't be a working directory.
      cwd: isInsideAsar(this.serverDir) ? await userDataDir() : this.serverDir,
      // LSC_STUDIO_FIXES registers the Studio fix tools — applied only from the Studio UI.
      env: { ...serverEnv(process.env), LSC_STUDIO_FIXES: "1" },
    });

    const client = new Client(
      { name: "lsc-assistant", version: "0.1.0" },
      { capabilities: {} }
    );
    // A server that exits (crash, or a failed respawn) leaves no client, so the next call starts a new one.
    client.onclose = () => {
      if (this.client === client) {
        this.client = null;
        this.transport = null;
      }
    };

    try {
      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      // Discover available tools
      await this.refreshTools();
    } catch (error) {
      if (this.client === client) {
        this.client = null;
        this.transport = null;
      }
      await client.close().catch(() => {});
      throw error;
    }
    await this.onStarted?.(this);
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.transport = null;
    await client?.close();
  }

  /** Respawn the server in place (dev reload) — engines keep their reference to this client. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Whether the server is running and has had no call for `ms`. */
  idleFor(ms: number): boolean {
    return this.inFlight === 0 && Date.now() - this.lastUsedAt >= ms;
  }

  get running(): boolean {
    return !!this.client;
  }

  getTools(): ToolDefinition[] {
    return this.tools.filter((t) => !t.name.startsWith(STUDIO_TOOL_PREFIX));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<McpToolResult> {
    this.inFlight++;
    let result;
    try {
      if (!this.client) await this.start();
      const client = this.client as Client | null;
      if (!client) throw new Error("MCP client not connected");

      result = await client.callTool(
        { name, arguments: args },
        undefined,
        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
      );
    } finally {
      this.inFlight--;
      this.lastUsedAt = Date.now();
    }

    return {
      content: (result.content as Array<{ type: string; text: string }>) || [],
      isError: result.isError as boolean | undefined,
    };
  }

  private async refreshTools(): Promise<void> {
    if (!this.client) throw new Error("MCP client not connected");

    const result = await this.client.listTools();

    this.tools = result.tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      input_schema: t.inputSchema as Record<string, unknown>,
    }));
  }
}

/** Model credentials (the app's own connection, or one set in the shell) that the org server never needs. */
const MODEL_SECRET = /^(ANTHROPIC|OPENAI|AZURE_OPENAI|CLAUDE_CODE|LITELLM)_|_API_KEY$|^AWS_(SECRET_ACCESS_KEY|SESSION_TOKEN)$/;

/**
 * The environment the MCP server starts with: the app's, without model credentials or Electron's own
 * switches. The sf CLI it runs still gets PATH, HOME, proxies, CA certificates and SF_* settings.
 */
export function serverEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || MODEL_SECRET.test(key) || key.startsWith("ELECTRON_")) continue;
    out[key] = value;
  }
  return out;
}

/** Whether `dir` is in an asar archive, which Electron reads like a folder but nothing can run in. */
export function isInsideAsar(dir: string): boolean {
  return path.resolve(dir).split(path.sep).some((part) => part.endsWith(".asar"));
}

// Electron is imported when a server starts, so tests can load this file without it.
const userDataDir = async () => (await import("electron")).app.getPath("userData");

const forkWithElectron: ForkServer = async (script, options) =>
  (await import("electron")).utilityProcess.fork(script, [], { ...options, stdio: "inherit" });
