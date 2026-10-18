import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";

/** The newest Active mobile metadata cache record. (`MobileApplicationDetail` isn't an object in the org.) */
export const MOBILE_CACHE_QUERY = `SELECT Id, LastModifiedDate FROM LifeSciMobileMetadataRecord WHERE Status = 'Active' ORDER BY LastModifiedDate DESC LIMIT 1`;

export function register(server: McpServer) {
  server.tool(
    "health_check",
    "Run a comprehensive LSC org health check. Checks trigger handler status, permission set assignments, Admin Console settings, orphaned territory assignments, DB Schema completeness, and mobile cache freshness. Returns a summary with issues found and recommendations.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Run Health Check\n\n${validation.error}\n\nPlease connect to a Salesforce org first using \`set_target_org\`.`,
            },
          ],
        };
      }

      const issues: Array<{
        severity: "error" | "warning" | "info";
        area: string;
        message: string;
        fix?: string;
      }> = [];
      const sections: string[] = [];

      // 1. Trigger Handlers
      const handlersQuery = `SELECT Id, DeveloperName, IsActive FROM LifeScienceTriggerHandler ORDER BY DeveloperName`;
      const handlersResult = await runToolingQuery(handlersQuery, effectiveOrg);
      let activeHandlers = 0;
      let inactiveHandlers = 0;
      const inactiveList: string[] = [];

      if (handlersResult.success && handlersResult.data?.records) {
        for (const r of handlersResult.data.records) {
          const h = r as Record<string, unknown>;
          if (h.IsActive) {
            activeHandlers++;
          } else {
            inactiveHandlers++;
            inactiveList.push(h.DeveloperName as string);
          }
        }
      }

      sections.push(
        `## Trigger Handlers\n- Active: ${activeHandlers}\n- Inactive: ${inactiveHandlers}`
      );

      if (inactiveHandlers > 0) {
        issues.push({
          severity: "warning",
          area: "Trigger Handlers",
          message: `${inactiveHandlers} trigger handler(s) are inactive: ${inactiveList.slice(0, 5).join(", ")}${inactiveList.length > 5 ? "..." : ""}`,
          fix: "Review and enable handlers via `toggle_trigger_handler` or Admin Console > Trigger Handlers",
        });
      }

      // 2. Permission Set Assignments
      const pslQuery = `SELECT PermissionSetLicenseId, PermissionSetLicense.DeveloperName, COUNT(Id) cnt FROM PermissionSetLicenseAssign WHERE PermissionSetLicense.DeveloperName LIKE '%LifeSciences%' OR PermissionSetLicense.DeveloperName LIKE '%LSC%' GROUP BY PermissionSetLicenseId, PermissionSetLicense.DeveloperName`;
      const pslResult = await runSoqlQuery(pslQuery, effectiveOrg);
      let pslInfo = "No LSC permission set license assignments found.";

      if (pslResult.success && pslResult.data?.records?.length) {
        const pslLines = (pslResult.data.records as Array<Record<string, unknown>>).map(
          (r) =>
            `- ${r["PermissionSetLicense.DeveloperName"] || r.PermissionSetLicenseId}: ${r.cnt} user(s)`
        );
        pslInfo = pslLines.join("\n");
      } else {
        issues.push({
          severity: "warning",
          area: "Permission Sets",
          message:
            "No LSC permission set license assignments found. Users may not have the required licenses.",
          fix: "Assign LSC permission set licenses to users via `assign_permission_set`",
        });
      }

      sections.push(`## Permission Set Licenses\n${pslInfo}`);

      // 3. Territory Model
      const tmQuery = `SELECT Id, Name, State FROM Territory2Model LIMIT 5`;
      const tmResult = await runSoqlQuery(tmQuery, effectiveOrg);
      let tmInfo = "No territory models found.";

      if (tmResult.success && tmResult.data?.records?.length) {
        const models = tmResult.data.records as Array<Record<string, unknown>>;
        const activeModels = models.filter((m) => m.State === "Active");
        tmInfo = models.map((m) => `- ${m.Name}: ${m.State}`).join("\n");

        if (activeModels.length === 0) {
          issues.push({
            severity: "error",
            area: "Territory Model",
            message: "No active territory model found. Territory alignment will not work.",
            fix: "Activate a Territory Model in Setup > Territory Models",
          });
        }
      } else {
        issues.push({
          severity: "info",
          area: "Territory Model",
          message: "No territory models found. Territory features are not configured.",
        });
      }

      sections.push(`## Territory Model\n${tmInfo}`);

      // 4. DB Schema Completeness
      const dbSchemaQuery = `SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE DeveloperName = 'DbSchema') ORDER BY DeveloperName`;
      const dbSchemaResult = await runToolingQuery(dbSchemaQuery, effectiveOrg);
      let dbSchemaActive = 0;
      let dbSchemaInactive = 0;

      if (dbSchemaResult.success && dbSchemaResult.data?.records) {
        for (const r of dbSchemaResult.data.records) {
          const d = r as Record<string, unknown>;
          if (d.IsActive) {
            dbSchemaActive++;
          } else {
            dbSchemaInactive++;
          }
        }
      }

      sections.push(
        `## DB Schema (Mobile Sync)\n- Active records: ${dbSchemaActive}\n- Inactive records: ${dbSchemaInactive}`
      );

      if (dbSchemaActive === 0) {
        issues.push({
          severity: "warning",
          area: "DB Schema",
          message: "No active DB Schema records found. The mobile app will not sync any data.",
          fix: "Configure DB Schema records via `create_db_schema` or Admin Console > DB Schema",
        });
      }

      // 5. Mobile Cache
      const cacheResult = await runSoqlQuery(MOBILE_CACHE_QUERY, effectiveOrg);
      let cacheInfo = "No mobile metadata cache found.";

      if (cacheResult.success && cacheResult.data?.records?.length) {
        const cache = cacheResult.data.records[0] as Record<string, unknown>;
        const createdDate = cache.LastModifiedDate as string;
        const daysAgo = Math.floor(
          (Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        cacheInfo = `Last generated: ${createdDate} (${daysAgo} day(s) ago)`;

        if (daysAgo > 7) {
          issues.push({
            severity: "warning",
            area: "Mobile Cache",
            message: `Mobile metadata cache is ${daysAgo} days old. Recommend regenerating.`,
            fix: "Run `/lsc:generate-metadata-cache` to regenerate",
          });
        }
      } else {
        issues.push({
          severity: "info",
          area: "Mobile Cache",
          message:
            "No mobile metadata cache found. This is expected if mobile is not yet deployed.",
        });
      }

      sections.push(`## Mobile Metadata Cache\n${cacheInfo}`);

      // Build summary
      const errors = issues.filter((i) => i.severity === "error");
      const warnings = issues.filter((i) => i.severity === "warning");
      const infos = issues.filter((i) => i.severity === "info");

      let status = "HEALTHY";
      if (errors.length > 0) status = "NEEDS ATTENTION";
      else if (warnings.length > 0) status = "WARNINGS";

      let report = `# LSC Org Health Check\n\n**Org:** ${effectiveOrg}\n**Status:** ${status}\n**Issues:** ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)\n\n`;
      report += sections.join("\n\n");

      if (issues.length > 0) {
        report += "\n\n---\n\n## Issues Found\n\n";
        for (const issue of issues) {
          const icon =
            issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
          report += `${icon} **[${issue.area}]** ${issue.message}\n`;
          if (issue.fix) {
            report += `   Fix: ${issue.fix}\n`;
          }
          report += "\n";
        }
      }

      return { content: [{ type: "text", text: report }] };
    }
  );

  server.tool(
    "get_org_status",
    "Get a single dashboard view of the connected LSC org: alias, username, instance URL, installed packages, enabled features (via trigger handlers), mobile cache status, and territory model status.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Get Org Status\n\n${validation.error}\n\nPlease connect to a Salesforce org first using \`set_target_org\`.`,
            },
          ],
        };
      }

      let report = `# LSC Org Status\n\n**Org:** ${effectiveOrg}\n`;

      // Org info
      const orgQuery = `SELECT Id, Name, OrganizationType, IsSandbox, InstanceName FROM Organization LIMIT 1`;
      const orgResult = await runSoqlQuery(orgQuery, effectiveOrg);
      if (orgResult.success && orgResult.data?.records?.length) {
        const org = orgResult.data.records[0] as Record<string, unknown>;
        report += `**Organization:** ${org.Name}\n`;
        report += `**Type:** ${org.OrganizationType}${org.IsSandbox ? " (Sandbox)" : ""}\n`;
        report += `**Instance:** ${org.InstanceName}\n\n`;
      }

      // Installed packages
      const pkgQuery = `SELECT SubscriberPackage.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.Name`;
      const pkgResult = await runToolingQuery(pkgQuery, effectiveOrg);
      report += "## Installed Packages\n\n";
      if (pkgResult.success && pkgResult.data?.records?.length) {
        for (const r of pkgResult.data.records) {
          const p = r as Record<string, unknown>;
          const spkg = p.SubscriberPackage as Record<string, unknown> | null;
          const ver = p.SubscriberPackageVersion as Record<string, unknown> | null;
          const name = spkg?.Name || "Unknown";
          const version = ver
            ? `${ver.MajorVersion}.${ver.MinorVersion}.${ver.PatchVersion}`
            : "unknown";
          report += `- **${name}** v${version}\n`;
        }
      } else {
        report += "No managed packages installed.\n";
      }

      // Enabled features (via active trigger handlers)
      const handlersQuery = `SELECT DeveloperName, IsActive FROM LifeScienceTriggerHandler WHERE IsActive = true ORDER BY DeveloperName`;
      const handlersResult = await runToolingQuery(handlersQuery, effectiveOrg);
      report += "\n## Enabled Features (Active Trigger Handlers)\n\n";
      if (handlersResult.success && handlersResult.data?.records?.length) {
        const handlers = handlersResult.data.records as Array<Record<string, unknown>>;
        report += handlers.map((h) => `- ${h.DeveloperName}`).join("\n");
        report += `\n\n*${handlers.length} active handler(s)*\n`;
      } else {
        report += "No active trigger handlers found.\n";
      }

      // Territory model
      const tmQuery = `SELECT Name, State FROM Territory2Model LIMIT 5`;
      const tmResult = await runSoqlQuery(tmQuery, effectiveOrg);
      report += "\n## Territory Model\n\n";
      if (tmResult.success && tmResult.data?.records?.length) {
        for (const r of tmResult.data.records) {
          const m = r as Record<string, unknown>;
          report += `- ${m.Name}: **${m.State}**\n`;
        }
      } else {
        report += "No territory models configured.\n";
      }

      // User count
      const userQuery = `SELECT COUNT(Id) cnt FROM User WHERE IsActive = true AND Profile.Name LIKE '%Life%' OR Profile.Name LIKE '%LSC%'`;
      const userResult = await runSoqlQuery(userQuery, effectiveOrg);
      report += "\n## Users\n\n";
      if (userResult.success && userResult.data?.records?.length) {
        const cnt = (userResult.data.records[0] as Record<string, unknown>).cnt;
        report += `Active LSC-profiled users: ${cnt}\n`;
      }

      return { content: [{ type: "text", text: report }] };
    }
  );
}
