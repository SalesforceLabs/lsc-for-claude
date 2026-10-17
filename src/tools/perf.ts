import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { runSoqlQuery, runToolingQuery, cachedDescribeSObject } from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import type { OrgQuerier } from "../perf/sync-volume.js";
import {
  loadTelemetry,
  profileUsers,
  renderAssessment,
  renderTelemetry,
  renderVolumes,
  runAssessment,
} from "../perf/assessment.js";
import { loadNfrProfile, parseNfrProfile } from "../perf/nfr.js";

function querier(targetOrg: string): OrgQuerier {
  return {
    soql: (q) => runSoqlQuery(q, targetOrg),
    tooling: (q) => runToolingQuery(q, targetOrg),
  };
}

function telemetryFields(targetOrg: string): () => Promise<Set<string>> {
  return async () => {
    const result = await cachedDescribeSObject("DeviceSyncSummary", targetOrg);
    return new Set(result.success ? (result.data?.fields ?? []).map((f) => f.name) : []);
  };
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(title: string, e: unknown) {
  return text(`# ${title}\n\n${e instanceof Error ? e.message : String(e)}`);
}

const targetOrgParam = z
  .string()
  .optional()
  .describe("Optional: org alias/username for configuration reads. Uses current target org if not specified.");

const countAsOrgParam = z
  .string()
  .optional()
  .describe(
    "Optional: org alias authenticated AS the persona user, used for the COUNT() queries so record sharing matches the device exactly. Defaults to the target org (the connected user's visibility, typically an admin)."
  );

export function register(server: McpServer) {
  server.tool(
    "profile_sync_volume",
    "Predict how much data the LSC mobile app will sync for specific users, before any device is involved. Resolves each user's DB Schema records (profile/permission set), substitutes WhereSoql tags ({USER.ID}, {USER.TERRITORY}, {ACCOUNT.IDS}, {OT2A.OBJ.IDS}, ...) per territory exactly as the app does, and runs COUNT() queries. Returns predicted records per table, estimated device SOQL request counts, and filters that fail to execute. Read-only; safe in production.",
    {
      users: z.array(z.string()).min(1).describe("Usernames or User Ids of representative field users"),
      territory: z
        .string()
        .optional()
        .describe("Optional: territory name or Id to profile. Default: each of the user's territories in the active model (up to 5)."),
      idsPerQuery: z
        .number()
        .int()
        .min(10)
        .max(400)
        .optional()
        .describe("Optional: ids inlined per COUNT() query for {ACCOUNT.IDS}/{OT2A.OBJ.IDS} filters (default 200)"),
      targetOrg: targetOrgParam,
      countAsOrg: countAsOrgParam,
    },
    async ({ users, territory, idsPerQuery, targetOrg, countAsOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;
      if (!effectiveOrg) return text(`# Cannot Profile Sync Volume\n\n${validation.error}`);

      try {
        const volumes = await profileUsers(querier(effectiveOrg), querier(countAsOrg || effectiveOrg), users, {
          territory,
          ...(idsPerQuery ? { idsPerQuery } : {}),
        });
        let report = `# Predicted Mobile Sync Volume\n\n**Org:** ${effectiveOrg}${countAsOrg ? ` (counts as ${countAsOrg})` : ""}\n\n`;
        report += renderVolumes(volumes);
        report += `---\n\nCounts are for an initial (full) sync. Without \`countAsOrg\`, counts use the connected user's record visibility, which can exceed what the field user can see.\n`;
        return text(report);
      } catch (e) {
        return failure("Sync Volume Profiling Failed", e);
      }
    }
  );

  server.tool(
    "analyze_sync_telemetry",
    "Analyze real-device sync performance from DeviceSyncSummary records uploaded by the LSC iOS app after every sync. Reports p50/p90/p95/max for initial and delta sync duration, download/upload phases, metadata cache download, records downloaded, device DB size, failure rate, and breakdowns by network and app version, plus the slowest syncs. Read-only; safe in production.",
    {
      days: z.number().int().min(1).max(365).optional().default(30).describe("Look-back window in days (default 30)"),
      users: z.array(z.string()).optional().describe("Optional: restrict to these usernames"),
      profileName: z.string().optional().describe("Optional: restrict to users with this profile name"),
      targetOrg: targetOrgParam,
    },
    async ({ days, users, profileName, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;
      if (!effectiveOrg) return text(`# Cannot Analyze Sync Telemetry\n\n${validation.error}`);

      try {
        const { summary } = await loadTelemetry(querier(effectiveOrg), telemetryFields(effectiveOrg), {
          days,
          usernames: users,
          profileName,
        });
        let report = `# Mobile Sync Telemetry\n\n**Org:** ${effectiveOrg}\n`;
        if (users?.length) report += `**Users:** ${users.join(", ")}\n`;
        if (profileName) report += `**Profile:** ${profileName}\n`;
        report += "\n";
        report +=
          summary.samples === 0
            ? `No DeviceSyncSummary records in the last ${days} day(s) for this filter.\n`
            : renderTelemetry(summary, days);
        return text(report);
      } catch (e) {
        return failure("Sync Telemetry Analysis Failed", e);
      }
    }
  );

  server.tool(
    "run_perf_assessment",
    "Run an LSC performance assessment against an NFR profile (YAML): for each persona, predicts sync volume (profile_sync_volume) and summarizes field telemetry (analyze_sync_telemetry), then evaluates every metric against the profile's warn/fail thresholds and reports pass/warn/fail with the user, territory, or table that drove each result. Optionally writes the full result as JSON for CI or archiving. Read-only against the org.",
    {
      profilePath: z.string().optional().describe("Path to an NFR profile YAML file"),
      profileYaml: z.string().optional().describe("Inline NFR profile YAML (alternative to profilePath)"),
      outputPath: z.string().optional().describe("Optional: write the full result as JSON to this path"),
      targetOrg: targetOrgParam,
      countAsOrg: countAsOrgParam,
    },
    async ({ profilePath, profileYaml, outputPath, targetOrg, countAsOrg }) => {
      if (!profilePath && !profileYaml) {
        return text("# Missing NFR Profile\n\nProvide `profilePath` or `profileYaml`. See the `lsc-performance-validation` skill for the format.");
      }
      let profile;
      try {
        profile = profilePath ? loadNfrProfile(profilePath) : parseNfrProfile(profileYaml as string);
      } catch (e) {
        return failure("Invalid NFR Profile", e);
      }

      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;
      if (!effectiveOrg) return text(`# Cannot Run Assessment\n\n${validation.error}`);

      try {
        const result = await runAssessment(
          profile,
          effectiveOrg,
          querier(effectiveOrg),
          querier(countAsOrg || effectiveOrg),
          telemetryFields(effectiveOrg)
        );
        let report = renderAssessment(result, profile.telemetry?.days ?? 30);
        if (outputPath) {
          const resolved = path.resolve(outputPath);
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, JSON.stringify(result, null, 2));
          report += `\nFull result written to \`${resolved}\`.\n`;
        }
        return text(report);
      } catch (e) {
        return failure("Performance Assessment Failed", e);
      }
    }
  );
}
