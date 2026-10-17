import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { DeltaResult } from "../perf/device/delta.js";
import { simulateInitialSync, type SimulationResult } from "../perf/simulate.js";

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(title: string, e: unknown) {
  return text(`# ${title}\n\n${e instanceof Error ? e.message : String(e)}`);
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function renderDelta(d: DeltaResult, topTables: number): string {
  const t = d.totals;
  let out = `\n## Delta sync (last synced ${d.sinceHours} h ago)\n\n`;
  out += `| Phase | Seconds | Requests |\n|---|---|---|\n`;
  out += `| Record visibility | ${t.visibilitySeconds.toFixed(1)} | ${t.visibilityRequests} |\n`;
  out += `| Changed-record download | ${t.fetchSeconds.toFixed(1)} | ${t.fetchRequests} |\n`;
  out += `| Total | ${t.seconds.toFixed(1)} | ${t.requests} |\n\n`;
  out += `**To download:** ${t.toDownload.toLocaleString("en-US")}, **fetched:** ${t.recordsFetched.toLocaleString("en-US")}, **to delete (informational):** ${t.toDelete.toLocaleString("en-US")}, **response size:** ${mb(t.bytes)}, across ${t.tablesChecked} tables (${t.tablesSkipped} skipped, ${t.tablesFailed} failed)\n\n`;
  const rows = d.tables.filter((x) => !x.skipped).sort((a, b) => b.seconds - a.seconds || b.toDownload - a.toDownload);
  out += `| Table | Local ids | Visibility requests | To download | To delete | Fetched | Fetch requests | MB | Seconds | Note |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const x of rows.slice(0, topTables)) {
    const note = x.error ? `error: ${x.error}` : (x.truncated ?? "");
    out += `| ${x.sobject} | ${x.localIds.toLocaleString("en-US")} | ${x.visibilityRequests} | ${x.toDownload.toLocaleString("en-US")} | ${x.toDelete.toLocaleString("en-US")} | ${x.recordsFetched.toLocaleString("en-US")} | ${x.fetchRequests} | ${(x.bytes / (1024 * 1024)).toFixed(2)} | ${x.seconds.toFixed(1)} | ${cell(note)} |\n`;
  }
  if (rows.length > topTables) out += `\n${rows.length - topTables} more table(s) in the JSON output.\n`;
  const skipped = d.tables.filter((x) => x.skipped);
  if (skipped.length > 0) {
    out += `\n**Delta skipped:**\n\n`;
    for (const x of skipped) out += `- ${x.sobject}: ${x.skipped}\n`;
  }
  out += `\n${d.notes.map((n) => `- ${n}`).join("\n")}\n`;
  return out;
}

export function renderSimulation(r: SimulationResult, topTables = 25): string {
  const t = r.totals;
  let out = `# Simulated First Sync\n\n`;
  out += `**User:** ${r.user.username}${r.user.profile ? ` (${r.user.profile})` : ""}${r.user.territory ? `, territory ${r.user.territory}` : ""}\n`;
  out += `**Org:** ${r.org.instanceUrl} (API ${r.org.apiVersion})  \n**Flow:** ${r.flow}\n\n`;
  out += `| Phase | Seconds | Size | Requests |\n|---|---|---|---|\n`;
  out += `| Metadata download (${r.metadata.version}) | ${r.metadata.seconds.toFixed(1)} | ${mb(r.metadata.bytes)} | ${r.metadata.requests} |\n`;
  out += `| Data download (network only) | ${t.seconds.toFixed(1)} | ${mb(t.bytes)} | ${t.requests} |\n\n`;
  out += `**Records:** ${t.records.toLocaleString("en-US")} across ${t.tablesDownloaded} tables (${t.tablesSkipped} skipped, ${t.tablesFailed} failed)\n\n`;

  const ranked = [...r.tables].sort((a, b) => b.seconds - a.seconds || b.records - a.records);
  out += `## Slowest tables\n\n| Table | Records | Requests | MB | Seconds | Note |\n|---|---|---|---|---|---|\n`;
  for (const x of ranked.slice(0, topTables)) {
    const note = x.error ? `error: ${x.error}` : (x.skipped ? `skipped: ${x.skipped}` : (x.truncated ?? ""));
    out += `| ${x.sobject} | ${x.records.toLocaleString("en-US")} | ${x.requests} | ${(x.bytes / (1024 * 1024)).toFixed(2)} | ${x.seconds.toFixed(1)} | ${cell(note)} |\n`;
  }
  if (ranked.length > topTables) out += `\n${ranked.length - topTables} more table(s) in the JSON output.\n`;

  const problems = r.tables.filter((x) => x.error || x.skipped);
  if (problems.length > 0) {
    out += `\n## Skipped or failed\n\n`;
    for (const x of problems) out += `- **${x.sobject}**: ${x.error ? `error: ${x.error}` : x.skipped}\n`;
  }
  if (r.delta) out += renderDelta(r.delta, topTables);
  out += renderContentSection(r.content);
  out += `\n## Notes\n\n${r.notes.map((n) => `- ${n}`).join("\n")}\n`;
  return out;
}

export function register(server: McpServer) {
  server.tool(
    "simulate_initial_sync",
    "Simulate the network part of an LSC iOS app INITIAL sync for one end user, from Node. Authenticates as that user through the sf CLI, calls user-info, downloads and verifies the metadata archive (MD5), builds the table list and WHERE tags exactly as the app does, then downloads every table in the app's order (enhanced Connect flow or legacy REST flow, chosen from the org's settings). Reports per-table records, requests, bytes and seconds, plus metadata download time, so it can be compared with DeviceSyncSummary rows. Network time only (no SQLCipher writes, indexes or file binaries). Read-only against the org: it creates no records and registers no device. The username must already be authenticated in the sf CLI as the end user (not an admin) for device-accurate numbers.",
    {
      username: z
        .string()
        .describe(
          "sf CLI alias or username of the END USER, already authenticated (e.g. `sf org login jwt --username <user> --client-id <key> --jwt-key-file <file> --instance-url <url>` or `sf org login web`)"
        ),
      apiVersion: z.string().optional().describe("Optional: API version, e.g. 67.0 (default: the org's CLI API version)"),
      territory: z.string().optional().describe("Optional: territory name, id or developer name (default: the user's first leaf territory)"),
      forceFlow: z.enum(["enhanced", "legacy"]).optional().describe("Optional: override the flow chosen from the org's settings"),
      include: z.array(z.string()).optional().describe("Optional: only download these SObjects"),
      exclude: z.array(z.string()).optional().describe("Optional: skip these SObjects"),
      maxSeconds: z.number().int().min(10).max(7200).optional().default(900).describe("Stop starting new work after this many seconds (default 900)"),
      tableTimeoutSeconds: z.number().int().min(5).max(3600).optional().default(300).describe("Per-table time limit (default 300)"),
      maxRecordsPerTable: z.number().int().min(1).optional().describe("Optional: stop each table after this many records"),
      maxTotalRecords: z.number().int().min(1).optional().describe("Optional: stop the whole run after this many records"),
      legacyPaging: z
        .enum(["batch", "sequential"])
        .optional()
        .default("batch")
        .describe("Legacy flow only: fetch later pages through composite/batch like the app (batch), or follow nextRecordsUrl (sequential)"),
      outputPath: z.string().optional().describe("Optional: write the full result as JSON to this path"),
    },
    { title: "Simulate initial sync", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ username, apiVersion, territory, forceFlow, include, exclude, maxSeconds, tableTimeoutSeconds, maxRecordsPerTable, maxTotalRecords, legacyPaging, outputPath }) => {
      try {
        const result = await simulateInitialSync({
          username,
          apiVersion,
          territory,
          forceFlow,
          include,
          exclude,
          maxSeconds,
          tableTimeoutSeconds,
          maxRecordsPerTable,
          maxTotalRecords,
          legacyPaging,
        });
        let report = renderSimulation(result);
        if (outputPath) {
          const resolved = path.resolve(outputPath);
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, JSON.stringify(result, null, 2));
          report += `\nFull result written to \`${resolved}\`.\n`;
        }
        return text(report);
      } catch (e) {
        return failure("First-Sync Simulation Failed", e);
      }
    }
  );
}

/** Markdown for the content-download phase; empty when it did not run. */
export function renderContentSection(c: SimulationResult["content"]): string {
  if (!c) return "";
  const kinds = [["Attachments", c.attachments], ["CLM content", c.clm]] as const;
  let out = `\n## Content downloads (outside the sync window; not in the totals above)\n\n`;
  out += `| Kind | Files | Size | Seconds | Failures | Skipped | Note |\n|---|---|---|---|---|---|---|\n`;
  for (const [label, k] of kinds) {
    if (!k) continue;
    const bound = k.truncated ? "at least " : "";
    out += `| ${label} | ${bound}${k.files.toLocaleString("en-US")} of ${k.candidates.toLocaleString("en-US")} | ${bound}${mb(k.bytes)} | ${k.seconds.toFixed(1)} | ${k.failures} | ${k.skipped} | ${cell(k.truncated ?? "")} |\n`;
  }
  for (const [label, k] of kinds) {
    if (!k || k.largest.length === 0) continue;
    out += `\nLargest ${label.toLowerCase()}:\n\n`;
    for (const f of k.largest) out += `- ${cell(f.name)}: ${mb(f.bytes)} in ${f.seconds.toFixed(1)} s\n`;
  }
  for (const [label, k] of kinds) if (k?.errors?.length) out += `\n${label} failures, for example: ${k.errors.map(cell).join("; ")}\n`;
  out += `\nCaps per kind: ${c.limits.maxFiles.toLocaleString("en-US")} files, ${mb(c.limits.maxBytes)}. Total ${c.seconds.toFixed(1)} s.\n`;
  return out;
}
