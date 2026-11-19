import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runToolingQuery,
  cachedToolingQuery,
  createToolingRecord,
  updateToolingRecord,
} from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import {
  queryFieldValues,
  queryAssignments,
  extractFieldValue,
  getValueColumn,
} from "./helpers.js";

function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** A value for inside LIKE '%…%': quoted, with % and _ matched literally. */
function soqlLike(value: string): string {
  return soqlString(value).replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function register(server: McpServer) {
  server.tool(
    "list_trigger_handlers",
    "List LifeScienceTriggerHandler records showing active/inactive status. Use this to check which trigger handlers are enabled (e.g., DCR, Visit, Sample). Filter by object name to narrow results.",
    {
      objectName: z
        .string()
        .optional()
        .describe(
          "Optional: filter by object name (e.g., 'Visit', 'Account', 'DataChangeRequest')"
        ),
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ objectName, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot list trigger handlers: ${validation.error}` }],
        };
      }

      try {
        // LifeScienceTriggerHandler is a Tooling API object: the standard API
        // answers "sObject type 'LifeScienceTriggerHandler' is not supported".
        let query =
          "SELECT Id, DeveloperName, MasterLabel, IsActive, Description FROM LifeScienceTriggerHandler ORDER BY MasterLabel";
        if (objectName) {
          const term = soqlLike(objectName);
          query = `SELECT Id, DeveloperName, MasterLabel, IsActive, Description FROM LifeScienceTriggerHandler WHERE DeveloperName LIKE '%${term}%' OR MasterLabel LIKE '%${term}%' OR Description LIKE '%${term}%' ORDER BY MasterLabel`;
        }

        const result = await runToolingQuery(query, effectiveOrg);

        if (!result.success) {
          return {
            content: [
              { type: "text", text: `# Failed to Query Trigger Handlers\n\n${result.error}` },
            ],
          };
        }

        const records = result.data?.records || [];
        if (records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Trigger Handlers\n\nNo trigger handlers found${objectName ? ` matching "${objectName}"` : ""}.`,
              },
            ],
          };
        }

        let message = `# Trigger Handlers${objectName ? ` (filtered: "${objectName}")` : ""}\n\n`;
        message += `| Status | DeveloperName | Label | Description |\n`;
        message += `|--------|--------------|-------|-------------|\n`;

        for (const record of records) {
          const r = record as Record<string, unknown>;
          const status = r.IsActive ? "✅ Active" : "❌ Inactive";
          message += `| ${status} | ${r.DeveloperName || ""} | ${r.MasterLabel || ""} | ${r.Description || ""} |\n`;
        }

        message += `\n**Total:** ${records.length} handler(s)\n`;
        message += `\nUse \`toggle_trigger_handler\` to enable/disable a handler by its DeveloperName.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to List Trigger Handlers\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Toggle Trigger Handler
  server.tool(
    "toggle_trigger_handler",
    "Enable or disable a LifeScienceTriggerHandler by DeveloperName. Use list_trigger_handlers first to see available handlers. This is the correct way to enable/disable features like DCR, Visit compliance, etc.",
    {
      handlerName: z
        .string()
        .describe(
          "The DeveloperName of the trigger handler (e.g., 'DCRHandler', 'VisitComplianceHandler')"
        ),
      active: z.boolean().describe("Set to true to enable, false to disable"),
      targetOrg: z.string().optional().describe("Optional: specific org to update"),
    },
    async ({ handlerName, active, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot toggle trigger handler: ${validation.error}` }],
        };
      }

      try {
        // Query the handler by DeveloperName
        const query = `SELECT Id, DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = '${soqlString(handlerName)}' LIMIT 1`;
        const result = await runToolingQuery(query, effectiveOrg);

        if (!result.success) {
          return {
            content: [
              { type: "text", text: `# Failed to Query Trigger Handler\n\n${result.error}` },
            ],
          };
        }

        const records = result.data?.records || [];
        if (records.length === 0) {
          // Handler not found — list available ones
          const allQuery =
            "SELECT DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler ORDER BY MasterLabel";
          const allResult = await runToolingQuery(allQuery, effectiveOrg);
          const available = (allResult.data?.records || [])
            .map((r) => {
              const rec = r as Record<string, unknown>;
              return `- ${rec.DeveloperName} (${rec.IsActive ? "active" : "inactive"})`;
            })
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `# Handler Not Found\n\nNo trigger handler with DeveloperName "${handlerName}".\n\n## Available Handlers\n\n${available || "No handlers found in org."}`,
              },
            ],
          };
        }

        const handler = records[0] as Record<string, unknown>;
        const handlerId = handler.Id as string;
        const label = handler.MasterLabel as string;
        const wasActive = handler.IsActive as boolean;

        if (wasActive === active) {
          return {
            content: [
              {
                type: "text",
                text: `# No Change Needed\n\n**${label}** (${handlerName}) is already ${active ? "active" : "inactive"}.`,
              },
            ],
          };
        }

        // Update the handler
        const updateResult = await updateToolingRecord(
          "LifeScienceTriggerHandler",
          handlerId,
          { IsActive: active },
          effectiveOrg
        );

        if (!updateResult.success) {
          return {
            content: [
              { type: "text", text: `# Failed to Update Trigger Handler\n\n${updateResult.error}` },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `# Trigger Handler Updated\n\n**${label}** (${handlerName}): ${wasActive ? "active" : "inactive"} → **${active ? "active" : "inactive"}**\n\nThe change takes effect immediately.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Toggle Trigger Handler\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: List Admin Settings
  server.tool(
    "list_admin_settings",
    "List Admin Console settings (LifeSciConfigRecord + LifeSciConfigFieldValue) by category. Shows all settings with their field values. Use without a category to list all available categories.",
    {
      category: z
        .string()
        .optional()
        .describe(
          "Optional: category name to filter (e.g., 'Visit', 'DataChangeRequest', 'QuickAction', 'CustomAction'). Omit to list all categories."
        ),
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ category, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot list admin settings: ${validation.error}` }],
        };
      }

      try {
        if (!category) {
          // List all categories
          const catQuery =
            "SELECT Id, Category, MasterLabel FROM LifeSciConfigCategory ORDER BY Category";
          const catResult = await cachedToolingQuery(catQuery, effectiveOrg);

          if (!catResult.success) {
            return {
              content: [
                { type: "text", text: `# Failed to Query Categories\n\n${catResult.error}` },
              ],
            };
          }

          const categories = catResult.data?.records || [];
          if (categories.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Admin Console Categories\n\nNo categories found. Ensure LSC is installed in the org.`,
                },
              ],
            };
          }

          let message = `# Admin Console Categories\n\n`;
          message += `| Category | Label | ID |\n`;
          message += `|----------|-------|----|\n`;
          for (const cat of categories) {
            const c = cat as Record<string, unknown>;
            message += `| ${c.Category || ""} | ${c.MasterLabel || ""} | ${c.Id || ""} |\n`;
          }
          message += `\nUse \`list_admin_settings({ category: "<name>" })\` to see settings for a specific category.`;

          return {
            content: [{ type: "text", text: message }],
          };
        }

        // Get category ID
        const catQuery = `SELECT Id, Category FROM LifeSciConfigCategory WHERE Category = '${category}' LIMIT 1`;
        const catResult = await cachedToolingQuery(catQuery, effectiveOrg);

        if (!catResult.success || !catResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# Category Not Found\n\nNo Admin Console category "${category}". Use \`list_admin_settings()\` without a category to see all available categories.`,
              },
            ],
          };
        }

        const categoryId = catResult.data.records[0].Id as string;

        // Get all config records for this category
        const recordsQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${categoryId}' ORDER BY MasterLabel`;
        const recordsResult = await runToolingQuery(recordsQuery, effectiveOrg);

        if (!recordsResult.success) {
          return {
            content: [
              { type: "text", text: `# Failed to Query Settings\n\n${recordsResult.error}` },
            ],
          };
        }

        const records = recordsResult.data?.records || [];
        if (records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# ${category} Settings\n\nNo settings found for category "${category}".`,
              },
            ],
          };
        }

        // Batch-fetch all field values and assignments for all records
        const recordIds = records.map((r) => (r as Record<string, unknown>).Id as string);
        const { fieldValuesByRecord } = await queryFieldValues(recordIds, effectiveOrg, true);
        const assignmentsByRecord = await queryAssignments(recordIds, effectiveOrg);

        let message = `# ${category} Settings\n\n`;

        for (const record of records) {
          const r = record as Record<string, unknown>;
          const recordId = r.Id as string;
          message += `## ${r.MasterLabel} (\`${r.DeveloperName}\`)\n`;
          message += `- **ID:** ${recordId}\n`;
          message += `- **Active:** ${r.IsActive ? "Yes" : "No"}\n`;
          message += `- **Org-Level:** ${r.IsOrgLevel ? "Yes" : "No"}\n`;

          const assignments = assignmentsByRecord.get(recordId);
          if (assignments && assignments.length > 0) {
            message += `- **Profiles:** ${assignments.map((a) => a.name).join(", ")}\n`;
          }

          const fieldValues = fieldValuesByRecord.get(recordId);
          if (fieldValues && fieldValues.length > 0) {
            message += `- **Fields:**\n`;
            for (const f of fieldValues) {
              const value = extractFieldValue(f);
              message += `  - ${f.FieldName}: ${value !== null && value !== undefined ? value : "(empty)"} (${f.DataType})\n`;
            }
          }

          message += `\n`;
        }

        message += `**Total:** ${records.length} setting(s)\n`;
        message += `\nUse \`update_admin_setting\` to modify a setting, or \`create_admin_setting\` to add a new one.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to List Admin Settings\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Update Admin Setting
  server.tool(
    "update_admin_setting",
    "Update an existing Admin Console setting (LifeSciConfigRecord) or its field values (LifeSciConfigFieldValue). Use list_admin_settings first to get record IDs.",
    {
      recordId: z
        .string()
        .describe("The LifeSciConfigRecord ID to update (from list_admin_settings output)"),
      fields: z
        .record(z.unknown())
        .optional()
        .describe(
          "Top-level fields to update on the LifeSciConfigRecord (e.g., { IsActive: true, MasterLabel: 'New Label' })"
        ),
      fieldValues: z
        .array(
          z.object({
            fieldName: z
              .string()
              .describe("The FieldName of the LifeSciConfigFieldValue to update"),
            value: z.unknown().describe("The new value"),
            dataType: z
              .enum([
                "TEXT",
                "INTEGER",
                "PICKLIST",
                "BOOLEAN",
                "LONGTEXT",
                "OBJECT",
                "FIELD",
                "URL",
                "NUMBER",
                "PHONE",
                "MULTIPICKLIST",
                "RECORDREFERENCE",
              ])
              .optional()
              .describe("Data type (required only when creating a new field value)"),
          })
        )
        .optional()
        .describe("Field values to update on child LifeSciConfigFieldValue records"),
      targetOrg: z.string().optional().describe("Optional: specific org to update"),
    },
    async ({ recordId, fields, fieldValues, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot update admin setting: ${validation.error}` }],
        };
      }

      if (!fields && !fieldValues) {
        return {
          content: [
            {
              type: "text",
              text: `# Nothing to Update\n\nProvide either \`fields\` (top-level record fields) or \`fieldValues\` (child field values) to update.`,
            },
          ],
        };
      }

      try {
        const changes: string[] = [];

        // Step 1: Update top-level LifeSciConfigRecord fields
        if (fields && Object.keys(fields).length > 0) {
          const updateResult = await updateToolingRecord(
            "LifeSciConfigRecord",
            recordId,
            fields,
            effectiveOrg
          );

          if (!updateResult.success) {
            return {
              content: [
                { type: "text", text: `# Failed to Update Setting\n\n${updateResult.error}` },
              ],
            };
          }

          for (const [key, value] of Object.entries(fields)) {
            changes.push(`${key} → ${value}`);
          }
        }

        // Step 2: Update child LifeSciConfigFieldValue records
        if (fieldValues && fieldValues.length > 0) {
          // Get existing field values
          const { fieldValuesByRecord: fvMap } = await queryFieldValues([recordId], effectiveOrg);

          const existingFVs = new Map<string, Record<string, unknown>>();
          const fvRecords = fvMap.get(recordId) || [];
          for (const f of fvRecords) {
            existingFVs.set(f.FieldName as string, f);
          }

          for (const fv of fieldValues) {
            const existing = existingFVs.get(fv.fieldName);

            if (existing) {
              // Update existing field value
              const dataType = existing.DataType as string;
              const valueCol = getValueColumn(dataType);
              const updateData: Record<string, unknown> = { [valueCol]: fv.value };

              const updateResult = await updateToolingRecord(
                "LifeSciConfigFieldValue",
                existing.Id as string,
                updateData,
                effectiveOrg
              );

              if (updateResult.success) {
                const oldValue = extractFieldValue(existing);
                changes.push(`${fv.fieldName}: ${oldValue ?? "(empty)"} → ${fv.value}`);
              } else {
                changes.push(`${fv.fieldName}: FAILED — ${updateResult.error}`);
              }
            } else {
              // Create new field value
              const dataType = fv.dataType || "TEXT";
              const valueCol = getValueColumn(dataType);
              const createData: Record<string, unknown> = {
                FieldName: fv.fieldName,
                LifeSciConfigRecordId: recordId,
                DataType: dataType,
                [valueCol]: fv.value,
              };

              const createResult = await createToolingRecord(
                "LifeSciConfigFieldValue",
                createData,
                effectiveOrg
              );

              if (createResult.success) {
                changes.push(`${fv.fieldName}: (new) = ${fv.value}`);
              } else {
                changes.push(`${fv.fieldName}: FAILED to create — ${createResult.error}`);
              }
            }
          }
        }

        const hasFailures = changes.some((c) => c.includes("FAILED"));
        const title = hasFailures
          ? "Admin Setting Update — Errors Occurred"
          : "Admin Setting Updated";
        let message = `# ${title}\n\n`;
        message += `**Record ID:** ${recordId}\n\n`;
        message += `## Changes\n\n`;
        for (const change of changes) {
          message += `- ${change}\n`;
        }

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Update Admin Setting\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Create Admin Setting
  server.tool(
    "create_admin_setting",
    "Create a new Admin Console setting (LifeSciConfigRecord + LifeSciConfigFieldValue records). Use list_admin_settings to see existing settings before creating duplicates.",
    {
      category: z
        .string()
        .describe(
          "The category name (e.g., 'Visit', 'DataChangeRequest', 'Sample'). Must match an existing LifeSciConfigCategory."
        ),
      developerName: z
        .string()
        .describe("Unique developer name for the setting (alphanumeric + underscore only)"),
      label: z.string().describe("Display label for the setting"),
      isActive: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether the setting is active (default: true)"),
      isOrgLevel: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether this is an org-level setting (default: false)"),
      fields: z
        .array(
          z.object({
            name: z.string().describe("Field name"),
            dataType: z
              .enum([
                "TEXT",
                "INTEGER",
                "PICKLIST",
                "BOOLEAN",
                "LONGTEXT",
                "OBJECT",
                "FIELD",
                "URL",
                "NUMBER",
                "PHONE",
                "MULTIPICKLIST",
                "RECORDREFERENCE",
              ])
              .describe("Data type of the field"),
            value: z.unknown().describe("Field value"),
          })
        )
        .optional()
        .describe("Optional: field values to create on the setting"),
      targetOrg: z.string().optional().describe("Optional: specific org to create in"),
    },
    async ({ category, developerName, label, isActive, isOrgLevel, fields, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot create admin setting: ${validation.error}` }],
        };
      }

      try {
        // Step 1: Get category ID
        const catQuery = `SELECT Id FROM LifeSciConfigCategory WHERE Category = '${category}' LIMIT 1`;
        const catResult = await cachedToolingQuery(catQuery, effectiveOrg);

        if (!catResult.success || !catResult.data?.records?.length) {
          // List available categories for guidance
          const allCatsQuery = "SELECT Category FROM LifeSciConfigCategory ORDER BY Category";
          const allCatsResult = await cachedToolingQuery(allCatsQuery, effectiveOrg);
          const available = (allCatsResult.data?.records || [])
            .map((r) => (r as Record<string, unknown>).Category)
            .join(", ");

          return {
            content: [
              {
                type: "text",
                text: `# Category Not Found\n\nNo Admin Console category "${category}".\n\n**Available categories:** ${available || "none found"}`,
              },
            ],
          };
        }

        const categoryId = catResult.data.records[0].Id as string;
        const shouldActivate = isActive ?? true;

        // Step 2: Create the LifeSciConfigRecord as INACTIVE first.
        // The Tooling API validates that required field values exist when IsActive=true,
        // but those are child records that can only be created after the parent.
        const recordResult = await createToolingRecord(
          "LifeSciConfigRecord",
          {
            DeveloperName: developerName,
            MasterLabel: label,
            LifeSciConfigCategoryId: categoryId,
            IsActive: false,
            IsOrgLevel: isOrgLevel ?? false,
          },
          effectiveOrg
        );

        if (!recordResult.success) {
          return {
            content: [
              { type: "text", text: `# Failed to Create Admin Setting\n\n${recordResult.error}` },
            ],
          };
        }

        const recordId = recordResult.data!.id;

        // Step 3: Create LifeSciConfigFieldValue records
        const fieldErrors: string[] = [];
        if (fields && fields.length > 0) {
          for (const field of fields) {
            const valueCol = getValueColumn(field.dataType);
            const createData: Record<string, unknown> = {
              FieldName: field.name,
              LifeSciConfigRecordId: recordId,
              DataType: field.dataType,
              [valueCol]: field.value,
            };

            const fieldResult = await createToolingRecord(
              "LifeSciConfigFieldValue",
              createData,
              effectiveOrg
            );

            if (!fieldResult.success) {
              fieldErrors.push(`${field.name}: ${fieldResult.error}`);
            }
          }
        }

        // Step 4: Activate the record now that field values exist
        if (shouldActivate && fieldErrors.length === 0) {
          const activateResult = await updateToolingRecord(
            "LifeSciConfigRecord",
            recordId,
            { IsActive: true },
            effectiveOrg
          );

          if (!activateResult.success) {
            fieldErrors.push(`Activation: ${activateResult.error}`);
          }
        } else if (shouldActivate && fieldErrors.length > 0) {
          fieldErrors.push(
            "Activation skipped — fix field value errors first, then use update_admin_setting to activate"
          );
        }

        let message = `# Admin Setting Created\n\n`;
        message += `**Label:** ${label}\n`;
        message += `**Developer Name:** ${developerName}\n`;
        message += `**Category:** ${category}\n`;
        message += `**Record ID:** ${recordId}\n`;
        message += `**Active:** ${shouldActivate && fieldErrors.length === 0}\n`;
        message += `**Org-Level:** ${isOrgLevel ?? false}\n`;

        if (fields && fields.length > 0) {
          message += `**Fields Created:** ${fields.length - fieldErrors.length}/${fields.length}\n`;
        }

        if (fieldErrors.length > 0) {
          message += `\n## Warnings\n\nSome field values could not be created:\n`;
          for (const err of fieldErrors) {
            message += `- ${err}\n`;
          }
        }

        message += `\n## Next Steps\n\n`;
        message += `1. Verify in Admin Console\n`;
        message += `2. **Regenerate metadata cache** if this affects mobile\n`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Create Admin Setting\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
