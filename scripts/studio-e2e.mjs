#!/usr/bin/env node
// Drive the built MCP server (dist/index.js) the way Roz does — Studio fix tools on, a target org set —
// to exercise Studio operations end to end against a real org. Build first (npm run build).
//
//   node scripts/studio-e2e.mjs ORG < calls.jsonl     one call per line: {"tool": "...", "args": {...}}
//   node scripts/studio-e2e.mjs ORG TOOL 'JSON_ARGS'   a single call
//
// Each result is printed as one JSON line: {"tool", "ok", "ms", "result"} (result is the tool's text,
// parsed as JSON when it is JSON). Calls run in order on one server, so state (jobs, caches) carries over.
// As a module: `import { connect } from "./studio-e2e.mjs"` → `const s = await connect(org); await s.call(tool, args); await s.close()`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function connect(org) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(ROOT, "dist", "index.js")],
    cwd: ROOT,
    env: { ...process.env, LSC_STUDIO_FIXES: "1" },
    stderr: "ignore",
  });
  const client = new Client({ name: "studio-e2e", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  const call = async (tool, args = {}, timeoutMs = 600_000) => {
    const started = Date.now();
    try {
      const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs });
      const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
      let result = text;
      try {
        result = JSON.parse(text);
      } catch {
        // plain text
      }
      return { tool, ok: !res.isError, ms: Date.now() - started, result };
    } catch (e) {
      return { tool, ok: false, ms: Date.now() - started, result: String(e?.message ?? e) };
    }
  };
  if (org) {
    const set = await call("set_target_org", { org });
    if (!set.ok) throw new Error(`set_target_org ${org} failed: ${JSON.stringify(set.result)}`);
  }
  return { call, close: () => client.close() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [org, tool, json] = process.argv.slice(2);
  if (!org) {
    console.error("usage: node scripts/studio-e2e.mjs ORG [TOOL 'JSON_ARGS'] (or calls as JSON lines on stdin)");
    process.exit(2);
  }
  const s = await connect(org);
  if (tool) {
    console.log(JSON.stringify(await s.call(tool, json ? JSON.parse(json) : {})));
  } else {
    for await (const line of readline.createInterface({ input: process.stdin })) {
      if (!line.trim()) continue;
      const { tool: t, args } = JSON.parse(line);
      console.log(JSON.stringify(await s.call(t, args)));
    }
  }
  await s.close();
}
