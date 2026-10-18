import { McpClient } from "./client.js";
import type { ToolDefinition } from "../llm/provider.js";

/**
 * One MCP server per Salesforce connection. The server keeps its target org in memory,
 * so sharing one server meant that switching orgs retargeted every session mid-run —
 * including writes. Each server here is targeted once, when it starts, and never moved;
 * Studio uses the server for the org selected in the app, and each session uses the
 * server for the org it's tied to.
 */

export interface PoolOrg {
  /** The connection's username — what identifies the server. Empty for "no org". */
  username: string;
  /** What `set_target_org` is called with: the alias the app stores, else the username. */
  target: string;
}

/** What a session's engine calls tools through, without holding a server that may be stopped. */
export interface ToolHost {
  getTools(): ToolDefinition[];
  callTool: McpClient["callTool"];
}

const idOf = (username: string) => username.toLowerCase();

export class McpPool {
  private clients = new Map<string, McpClient>();
  private tools: ToolDefinition[] = [];

  /** @param create a client that targets `org` every time it (re)starts. */
  constructor(private create: (org: PoolOrg) => McpClient) {}

  /** The running (or starting) server for `org`, started if there isn't one. */
  async get(org: PoolOrg): Promise<McpClient> {
    const id = idOf(org.username);
    let client = this.clients.get(id);
    if (!client) {
      client = this.create(org);
      this.clients.set(id, client);
    }
    try {
      await client.start();
    } catch (error) {
      if (this.clients.get(id) === client) this.clients.delete(id);
      throw error;
    }
    if (this.tools.length === 0) this.tools = client.getTools();
    return client;
  }

  /** Tools are the same on every server; known once one has started. */
  getTools(): ToolDefinition[] {
    return this.tools;
  }

  /** A tool host for `org` that finds (or restarts) its server on every call. */
  host(org: PoolOrg): ToolHost {
    return {
      getTools: () => this.getTools(),
      callTool: async (name, args, options) => (await this.get(org)).callTool(name, args, options),
    };
  }

  running(): McpClient[] {
    return [...this.clients.values()];
  }

  /**
   * Stop servers idle for `idleMs` except those for `keep` usernames and those
   * `isBusy` says are holding work (a Studio job lives in its server's memory).
   */
  async sweep(keep: string[], idleMs: number, isBusy: (client: McpClient) => Promise<boolean>): Promise<void> {
    const kept = new Set(keep.map(idOf));
    for (const [id, client] of this.clients) {
      if (kept.has(id) || !client.idleFor(idleMs)) continue;
      if (await isBusy(client)) continue;
      // A call may have started while we asked.
      if (!client.idleFor(idleMs) || this.clients.get(id) !== client) continue;
      this.clients.delete(id);
      await client.stop().catch(() => {});
    }
  }

  async stopAll(): Promise<void> {
    const clients = this.running();
    this.clients.clear();
    this.tools = [];
    await Promise.all(clients.map((c) => c.stop().catch(() => {})));
  }
}
