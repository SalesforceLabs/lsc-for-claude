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

  constructor(serverDir?: string) {
    this.serverDir = serverDir ?? path.resolve(__dirname, "..", "..");
  }

  async start(): Promise<void> {
    const serverScript = path.join(this.serverDir, "dist", "index.js");

    this.transport = new StdioClientTransport({
      command: "node",
      args: [serverScript],
      cwd: this.serverDir,
      // LSC_STUDIO_FIXES registers the Studio fix tools — applied only from the Studio UI.
      env: { ...process.env, LSC_STUDIO_FIXES: "1" } as Record<string, string>,
    });

    this.client = new Client(
      { name: "lsc-assistant", version: "0.1.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);

    // Discover available tools
    await this.refreshTools();
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }

  /** Respawn the server in place (dev reload) — engines keep their reference to this client. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getTools(): ToolDefinition[] {
    return this.tools.filter((t) => !t.name.startsWith(STUDIO_TOOL_PREFIX));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<McpToolResult> {
    if (!this.client) throw new Error("MCP client not connected");

    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
    );

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
