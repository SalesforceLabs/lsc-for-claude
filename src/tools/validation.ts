import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAudit,
  formatAuditResults,
  getValidationGroups,
  diagnose,
  formatDiagnosis,
} from "../validation/index.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import { withSharedReads } from "../config/read-cache.js";
import { traceUser } from "../studio/user-trace.js";
import { findUserInOrg, resolveFeatureId } from "../studio/user-lookup.js";
import { diagnosePayload } from "./diagnose-shared.js";

export function register(server: McpServer) {
  server.tool(
    "audit_mobile_config",
    "Audit LSC Mobile configuration against best practices. Runs validation rules to identify misconfigurations that cause login failures, sync issues, and other common problems.",
    {
      group: z
        .string()
        .optional()
        .describe(
          "Validation group to run (e.g., 'mobile-login-check', 'pre-deployment', 'sync-troubleshooting', 'full-mobile-audit'). If not specified, runs all mobile rules."
        ),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to audit. Uses current target org if not specified."),
    },
    async ({ group, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Run Audit\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      try {
        // If no group specified, use full-mobile-audit
        const auditGroup = group || "full-mobile-audit";

        const auditResult = await runAudit(effectiveOrg, { group: auditGroup });
        const formattedReport = formatAuditResults(auditResult);

        return {
          content: [{ type: "text", text: formattedReport }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Audit Failed\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: List Validation Groups
  server.tool(
    "list_validation_groups",
    "List available validation groups for the audit_mobile_config tool",
    {},
    async () => {
      const groups = getValidationGroups();

      if (groups.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No validation groups found. Ensure validation rules are configured in knowledge/validation-rules/",
            },
          ],
        };
      }

      let message = "# Available Validation Groups\n\n";
      message += "Use these group names with the `audit_mobile_config` tool:\n\n";
      message += "| Group ID | Name | Rules |\n";
      message += "|----------|------|-------|\n";

      for (const group of groups) {
        message += `| \`${group.id}\` | ${group.name} | ${group.ruleCount} |\n`;
      }

      message += "\n## Group Descriptions\n\n";
      for (const group of groups) {
        message += `### ${group.name} (\`${group.id}\`)\n`;
        message += `${group.description}\n\n`;
      }

      message += "## Usage\n\n";
      message += "```\n";
      message += "audit_mobile_config({ group: 'mobile-login-check' })\n";
      message += "```\n";

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Diagnose Issue by Symptom
  server.tool(
    "diagnose_lsc_issue",
    "Diagnose an LSC error or symptom. Matches it against known causes (misconfigurations found in support investigations) and validation rules, then runs their checks against the connected org and reports which causes are present, with the fix for each. Paste the exact error text when there is one.",
    {
      symptom: z
        .string()
        .describe(
          "The error message or symptom, ideally the exact text (e.g., \"No such column 'LastModifiedDate' on entity 'ContentDocumentLink'\", 'Coming Soon tab on the iPad', 'accounts missing on the iPad')"
        ),
      checkOrg: z
        .boolean()
        .optional()
        .describe("Run the checks against the connected org (default true). Read-only."),
      format: z
        .enum(["markdown", "json"])
        .optional()
        .describe(
          "markdown (default) for a readable report; json for { items, checkedOrg, orgNote? }, the form the app renders as a card"
        ),
      suggested: z
        .array(z.string())
        .max(10)
        .optional()
        .describe(
          "Known cause ids that may fit, checked and listed as possible causes beside the word matches. Unknown ids are ignored."
        ),
    },
    async ({ symptom, checkOrg, format, suggested }) => {
      if (format === "json") {
        try {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(await diagnosePayload(symptom, checkOrg, suggested)),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
            isError: true,
          };
        }
      }
      let targetOrg: string | undefined;
      let orgNote = "";
      if (checkOrg !== false) {
        const validation = await validateOrgConnection();
        if (validation.valid) targetOrg = validation.targetOrg;
        else orgNote = `\n_No org checked: ${validation.error ?? "no org connected"}_\n`;
      }
      const diagnosis = await diagnose(symptom, targetOrg, { suggested });
      return {
        content: [{ type: "text", text: formatDiagnosis(diagnosis) + orgNote }],
      };
    }
  );

  // Tool: Check a user's access (the chat form of Studio's user trace)
  server.tool(
    "check_user_access",
    "Check one rep's setup end to end and find the first broken link: active user, license, LSC permission set license, permission sets, territory, the accounts that reach them, what DB Schema syncs to their iPad, actions, metadata cache and last sync. Use it for \"why can't <rep> see/do X\" about one named rep. It is a full trace (many queries), so never loop it over users: for \"reps can't see X\" check what reps share (the profile's navigation tabs, DB Schema, permission sets, metadata cache) and check at most one or two reps, asking the user which. It does not check navigation tabs. Read-only. Returns JSON (the user trace plus resolvedUser); when several users match it returns { matches } and nothing is traced, so ask which one.",
    {
      user: z.string().min(2).max(255).describe("The rep's name, username, email or user Id"),
      feature: z
        .string()
        .optional()
        .describe(
          "Narrow the check to one feature by id or title, e.g. 'samples' or 'Sample Management'"
        ),
    },
    async ({ user, feature }) => {
      const text = (data: unknown, isError = false) => ({
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        ...(isError ? { isError: true } : {}),
      });
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg)
        return text({ error: connection.error || "No Salesforce org connected." }, true);
      const org = connection.targetOrg;
      let featureId: string | null = null;
      if (feature?.trim()) {
        featureId = resolveFeatureId(feature);
        if (!featureId)
          return text(
            {
              error: `No single feature matches "${feature}". Omit feature to check the user overall.`,
            },
            true
          );
      }
      try {
        return await withSharedReads(async () => {
          const found = await findUserInOrg(user, org);
          if (found.kind === "none") return text({ error: `No user found for "${user}".` }, true);
          if (found.kind === "many") {
            return text({
              matches: found.matches,
              message: `Several users match "${user}". Ask which one is meant, then call again with the username or Id.`,
            });
          }
          const trace = await traceUser(found.user.id, featureId, org);
          return text({
            resolvedUser: {
              id: found.user.id,
              name: found.user.name,
              username: found.user.username,
            },
            ...trace,
          });
        });
      } catch (error) {
        return text({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }
  );
}
