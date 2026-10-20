import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAudit,
  formatAuditResults,
  getValidationGroups,
  diagnose,
  formatDiagnosis,
} from "../validation/index.js";
import { runToolingQuery } from "../salesforce/cli.js";
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
        .describe("markdown (default) for a readable report; json for { items, checkedOrg, orgNote? }, the form the app renders as a card"),
    },
    async ({ symptom, checkOrg, format }) => {
      if (format === "json") {
        try {
          return { content: [{ type: "text", text: JSON.stringify(await diagnosePayload(symptom, checkOrg)) }] };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
        }
      }
      let targetOrg: string | undefined;
      let orgNote = "";
      if (checkOrg !== false) {
        const validation = await validateOrgConnection();
        if (validation.valid) targetOrg = validation.targetOrg;
        else orgNote = `\n_No org checked: ${validation.error ?? "no org connected"}_\n`;
      }
      const diagnosis = await diagnose(symptom, targetOrg);
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
        .describe("Narrow the check to one feature by id or title, e.g. 'samples' or 'Sample Management'"),
    },
    async ({ user, feature }) => {
      const text = (data: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], ...(isError ? { isError: true } : {}) });
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) return text({ error: connection.error || "No Salesforce org connected." }, true);
      const org = connection.targetOrg;
      let featureId: string | null = null;
      if (feature?.trim()) {
        featureId = resolveFeatureId(feature);
        if (!featureId) return text({ error: `No single feature matches "${feature}". Omit feature to check the user overall.` }, true);
      }
      try {
        return await withSharedReads(async () => {
          const found = await findUserInOrg(user, org);
          if (found.kind === "none") return text({ error: `No user found for "${user}".` }, true);
          if (found.kind === "many") {
            return text({ matches: found.matches, message: `Several users match "${user}". Ask which one is meant, then call again with the username or Id.` });
          }
          const trace = await traceUser(found.user.id, featureId, org);
          return text({ resolvedUser: { id: found.user.id, name: found.user.name, username: found.user.username }, ...trace });
        });
      } catch (error) {
        return text({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }
  );

  // ============================================================================
  // DB SCHEMA TOOLS
  // ============================================================================

  /**
   * Query LifeSciConfigAssignment records for a set of parent record IDs and resolve
   * AssignedToId references to Profile/PermissionSet names.
   *
   * LifeSciConfigAssignment fields (per Tooling API describe):
   *   - LifeSciConfigRecordId: FK to parent record
   *   - AssignedToId: FK to Profile or PermissionSet (ID like 00eXXX for Profile)
   *   - AssignmentLevel: "Profile" or "PermissionSet"
   */
  async function queryAssignments(
    recordIds: string[],
    targetOrg: string
  ): Promise<Map<string, Array<{ id: string; name: string; level: string }>>> {
    const result = new Map<string, Array<{ id: string; name: string; level: string }>>();

    if (recordIds.length === 0) return result;

    // Query assignments
    const idFilter =
      recordIds.length === 1
        ? `LifeSciConfigRecordId = '${recordIds[0]}'`
        : `LifeSciConfigRecordId IN (${recordIds.map((id) => `'${id}'`).join(",")})`;

    const assignQuery = `SELECT Id, LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE ${idFilter}`;
    const assignResult = await runToolingQuery(assignQuery, targetOrg);

    if (!assignResult.success || !assignResult.data?.records?.length) {
      return result;
    }

    // Collect unique AssignedToId values and group by record
    const assignedToIds = new Set<string>();
    const rawAssignments: Array<Record<string, unknown>> = [];

    for (const r of assignResult.data.records) {
      const a = r as Record<string, unknown>;
      rawAssignments.push(a);
      if (a.AssignedToId) assignedToIds.add(a.AssignedToId as string);
    }

    // Resolve Profile/PermissionSet names
    const nameMap = new Map<string, string>();
    if (assignedToIds.size > 0) {
      const idList = [...assignedToIds].map((id) => `'${id}'`).join(",");

      // Try Profile first
      const profileQuery = `SELECT Id, Name FROM Profile WHERE Id IN (${idList})`;
      const profileResult = await runToolingQuery(profileQuery, targetOrg);
      if (profileResult.success && profileResult.data?.records) {
        for (const p of profileResult.data.records) {
          const pr = p as Record<string, unknown>;
          nameMap.set(pr.Id as string, pr.Name as string);
        }
      }

      // Check for any unresolved IDs (might be PermissionSets)
      const unresolvedIds = [...assignedToIds].filter((id) => !nameMap.has(id));
      if (unresolvedIds.length > 0) {
        const psIdList = unresolvedIds.map((id) => `'${id}'`).join(",");
        const psQuery = `SELECT Id, Name FROM PermissionSet WHERE Id IN (${psIdList})`;
        const psResult = await runToolingQuery(psQuery, targetOrg);
        if (psResult.success && psResult.data?.records) {
          for (const ps of psResult.data.records) {
            const psr = ps as Record<string, unknown>;
            nameMap.set(psr.Id as string, psr.Name as string);
          }
        }
      }
    }

    // Build result map
    for (const a of rawAssignments) {
      const parentId = a.LifeSciConfigRecordId as string;
      const assignedToId = a.AssignedToId as string;
      const level = (a.AssignmentLevel as string) || "Profile";
      const name = nameMap.get(assignedToId) || assignedToId;

      if (!result.has(parentId)) {
        result.set(parentId, []);
      }
      result.get(parentId)!.push({ id: assignedToId, name, level });
    }

    return result;
  }

  /**
   * Look up a Profile ID by name via the Tooling API.
   */
  async function resolveProfileId(profileName: string, targetOrg: string): Promise<string | null> {
    const query = `SELECT Id FROM Profile WHERE Name = '${profileName.replace(/'/g, "\\'")}' LIMIT 1`;
    const result = await runToolingQuery(query, targetOrg);
    if (result.success && result.data?.records?.length) {
      return (result.data.records[0] as Record<string, unknown>).Id as string;
    }
    return null;
  }

  // Helper: map DataType to the Tooling API value column name.
  // The Tooling API's LifeSciConfigFieldValue has 12 queryable value columns
  // (per the Life Sciences Developer Guide, LifeSciConfigFieldValue object reference):
  //   TextValue, IntegerValue, PicklistValue, HasBooleanValue, LongTextValue,
  //   ObjectValue, FieldValue, UrlValue, NumberValue, PhoneValue, DateTimeValue, DateValue
  function getValueColumn(dataType: string): string {
    switch (dataType) {
      case "TEXT":
        return "TextValue";
      case "INTEGER":
        return "IntegerValue";
      case "PICKLIST":
        return "PicklistValue";
      case "BOOLEAN":
        return "HasBooleanValue";
      case "LONGTEXT":
        return "LongTextValue";
      case "OBJECT":
        return "ObjectValue";
      case "FIELD":
        return "FieldValue";
      case "URL":
        return "UrlValue";
      case "NUMBER":
        return "NumberValue";
      case "PHONE":
        return "PhoneValue";
      case "MULTIPICKLIST":
        return "LongTextValue"; // semicolon-separated in LongTextValue
      case "RECORDREFERENCE":
        return "TextValue"; // record IDs stored in TextValue
      default:
        return "TextValue";
    }
  }

  // Helper: extract value from a field value record
  // Checks all 12 Tooling API value columns in priority order.
  function extractFieldValue(f: Record<string, unknown>): unknown {
    return (
      f.TextValue ??
      f.PicklistValue ??
      f.IntegerValue ??
      f.LongTextValue ??
      f.ObjectValue ??
      f.FieldValue ??
      f.UrlValue ??
      f.NumberValue ??
      f.PhoneValue ??
      f.DateTimeValue ??
      f.DateValue ??
      (f.HasBooleanValue !== null && f.HasBooleanValue !== undefined ? f.HasBooleanValue : null)
    );
  }

  // Helper: normalize DbSchema name — accepts "Visit" or "DbSchema_Visit"
  function normalizeDbSchemaName(name: string): string {
    return /^dbschema_/i.test(name) ? name : `DbSchema_${name}`;
  }

  // All 12 value columns on LifeSciConfigFieldValue (per the Life Sciences Developer Guide)
  const FV_VALUE_COLUMNS = [
    "TextValue",
    "IntegerValue",
    "PicklistValue",
    "HasBooleanValue",
    "LongTextValue",
    "ObjectValue",
    "FieldValue",
    "UrlValue",
    "NumberValue",
    "PhoneValue",
    "DateTimeValue",
    "DateValue",
  ];

  /**
   * Query LifeSciConfigFieldValue records for a set of parent record IDs.
   * Returns a map of parentId → field values.
   */
  async function queryFieldValues(
    recordIds: string[],
    targetOrg: string,
    includeParentId: boolean = false
  ): Promise<{
    fieldValuesByRecord: Map<string, Array<Record<string, unknown>>>;
    queryError?: string;
  }> {
    const columns = FV_VALUE_COLUMNS;
    const fieldValuesByRecord = new Map<string, Array<Record<string, unknown>>>();

    const parentIdCol = includeParentId ? ", LifeSciConfigRecordId" : "";

    const chunkSize = 50;
    for (let i = 0; i < recordIds.length; i += chunkSize) {
      const chunk = recordIds.slice(i, i + chunkSize);

      let fvQuery: string;

      if (chunk.length === 1) {
        fvQuery = `SELECT Id, FieldName, DataType, ${columns.join(", ")}${parentIdCol} FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId = '${chunk[0]}' ORDER BY FieldName`;
      } else {
        const idList = chunk.map((id) => `'${id}'`).join(",");
        fvQuery = `SELECT Id, FieldName, DataType, ${columns.join(", ")}, LifeSciConfigRecordId FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId IN (${idList}) ORDER BY FieldName`;
      }

      const fvResult = await runToolingQuery(fvQuery, targetOrg);

      if (!fvResult.success) {
        return { fieldValuesByRecord, queryError: fvResult.error || "Unknown query error" };
      }

      if (fvResult.data?.records) {
        for (const fv of fvResult.data.records) {
          const f = fv as Record<string, unknown>;
          const parentId = (f.LifeSciConfigRecordId as string) || chunk[0];
          if (!fieldValuesByRecord.has(parentId)) {
            fieldValuesByRecord.set(parentId, []);
          }
          fieldValuesByRecord.get(parentId)!.push(f);
        }
      }
    }

    return { fieldValuesByRecord };
  }
}
