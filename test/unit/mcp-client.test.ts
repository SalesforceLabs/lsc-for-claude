import { describe, it, expect, vi, beforeEach } from "vitest";

const spawned = vi.hoisted(() => ({ connects: 0 }));

vi.mock("../../src-electron/mcp/utility-transport.js", () => ({ UtilityProcessTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    onclose?: () => void;
    async connect() {
      spawned.connects++;
    }
    async listTools() {
      return { tools: [{ name: "t", description: "", inputSchema: {} }] };
    }
    async callTool() {
      return { content: [] };
    }
    async close() {
      this.onclose?.();
    }
  },
}));

import { McpClient } from "../../src-electron/mcp/client.js";
import { McpPool } from "../../src-electron/mcp/pool.js";

beforeEach(() => {
  spawned.connects = 0;
});

describe("McpClient.start", () => {
  it("spawns one server however often it is asked, including concurrently", async () => {
    const client = new McpClient();
    await Promise.all([client.start(), client.start()]);
    await client.start();
    await client.start();
    expect(spawned.connects).toBe(1);
  });

  it("spawns again after a stop", async () => {
    const client = new McpClient();
    await client.start();
    await client.stop();
    await client.start();
    expect(spawned.connects).toBe(2);
  });

  it("keeps one server per org across pool gets", async () => {
    const pool = new McpPool(() => new McpClient());
    const org = { username: "Admin@Example.com", target: "admin" };
    const a = await pool.get(org);
    const b = await pool.get({ ...org, username: "admin@example.com" });
    expect(b).toBe(a);
    expect(spawned.connects).toBe(1);
  });
});
