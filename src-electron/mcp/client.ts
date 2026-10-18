import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
 * MCP Client that spawns the existing LSC MCP server as a child process
 * using the official MCP SDK client and stdio transport.
 */
export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
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

  start(): Promise<void> {
    this.starting ??= this.connect().finally(() => (this.starting = null));
    return this.starting;
  }

  private async connect(): Promise<void> {
    const serverScript = path.join(this.serverDir, "dist", "index.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverScript],
      cwd: this.serverDir,
      // LSC_STUDIO_FIXES registers the Studio fix tools — applied only from the Studio UI.
      env: { ...process.env, LSC_STUDIO_FIXES: "1" } as Record<string, string>,
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
