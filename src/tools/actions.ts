import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runSoqlQuery,
  runToolingQuery,
  cachedToolingQuery,
  createToolingRecord,
  updateToolingRecord,
  deleteToolingRecord,
} from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import { queryFieldValues, getValueColumn, extractFieldValue } from "./helpers.js";

export function register(server: McpServer) {
  server.tool(
    "list_lsc_actions",
    "THE ONLY WAY to list LSC Quick Actions or Custom Actions. NEVER use run_soql for actions - objects like LifeSciCustomAction__mdt, CustomAction__c, LifeSciConfigType__c DO NOT EXIST. This tool uses Tooling API internally.",
    {
      actionType: z
        .enum(["quick", "custom", "both"])
        .default("both")
        .describe("Type of actions to list: quick, custom, or both"),
      activeOnly: z.boolean().optional().default(false).describe("Only show active actions"),
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ actionType, activeOnly, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot list actions: ${validation.error}`,
            },
          ],
        };
      }

      const results: string[] = [];

      // Query Quick Actions
      if (actionType === "quick" || actionType === "both") {
        const activeFilter = activeOnly ? " AND IsActive = true" : "";
        const quickQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, (SELECT FieldName, PicklistValue, TextValue, IntegerValue FROM LifeSciConfigFieldValues) FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE Category = 'QuickAction')${activeFilter} ORDER BY MasterLabel`;

        const quickResult = await runToolingQuery(quickQuery, effectiveOrg);

        if (quickResult.success && quickResult.data?.records) {
          results.push(`## Quick Actions (${quickResult.data.records.length})\n`);

          if (quickResult.data.records.length === 0) {
            results.push("No quick actions found.\n");
          } else {
            results.push(
              "| ID | DeveloperName | MasterLabel | Active | Location | Action | Profiles |\n"
            );
            results.push(
              "|----|---------------|-------------|--------|----------|--------|----------|\n"
            );

            for (const record of quickResult.data.records) {
              const rec = record as Record<string, unknown>;
              const fieldValues =
                (rec.LifeSciConfigFieldValues as { records?: Array<Record<string, unknown>> })
                  ?.records || [];

              const location =
                fieldValues.find((f) => f.FieldName === "Location")?.PicklistValue || "-";
              const actionName =
                fieldValues.find((f) => f.FieldName === "ActionName")?.PicklistValue || "-";
              const profiles =
                fieldValues.find((f) => f.FieldName === "Profiles")?.TextValue || "-";

              results.push(
                `| ${rec.Id} | ${rec.DeveloperName} | ${rec.MasterLabel} | ${rec.IsActive ? "Yes" : "No"} | ${location} | ${actionName} | ${profiles} |\n`
              );
            }
          }
          results.push("\n");
        } else {
          results.push(`## Quick Actions\n\nError: ${quickResult.error}\n\n`);
        }
      }

      // Query Custom Actions
      if (actionType === "custom" || actionType === "both") {
        const activeFilter = activeOnly ? " AND IsActive = true" : "";
        const customQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, (SELECT FieldName, PicklistValue, TextValue FROM LifeSciConfigFieldValues) FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE Category = 'CustomAction')${activeFilter} ORDER BY MasterLabel`;

        const customResult = await runToolingQuery(customQuery, effectiveOrg);

        if (customResult.success && customResult.data?.records) {
          results.push(`## Custom Actions (${customResult.data.records.length})\n`);

          if (customResult.data.records.length === 0) {
            results.push("No custom actions found.\n");
          } else {
            results.push(
              "| ID | DeveloperName | MasterLabel | Active | Entity Type | Action Type | Target | Profiles |\n"
            );
            results.push(
              "|----|---------------|-------------|--------|-------------|-------------|--------|----------|\n"
            );

            for (const record of customResult.data.records) {
              const rec = record as Record<string, unknown>;
              const fieldValues =
                (rec.LifeSciConfigFieldValues as { records?: Array<Record<string, unknown>> })
                  ?.records || [];

              const entityType =
                fieldValues.find((f) => f.FieldName === "EntityType")?.PicklistValue || "-";
              const actionType =
                fieldValues.find((f) => f.FieldName === "ActionType")?.PicklistValue || "-";
              const actionTarget =
                fieldValues.find((f) => f.FieldName === "ActionTarget")?.TextValue || "-";
              const profiles =
                fieldValues.find((f) => f.FieldName === "Profiles")?.TextValue || "-";

              const truncatedTarget =
                actionTarget && String(actionTarget).length > 30
                  ? String(actionTarget).substring(0, 30) + "..."
                  : actionTarget;

              results.push(
                `| ${rec.Id} | ${rec.DeveloperName} | ${rec.MasterLabel} | ${rec.IsActive ? "Yes" : "No"} | ${entityType} | ${actionType} | ${truncatedTarget} | ${profiles} |\n`
              );
            }
          }
          results.push("\n");
        } else {
          results.push(`## Custom Actions\n\nError: ${customResult.error}\n\n`);
        }
      }

      return {
        content: [{ type: "text", text: `# LSC Actions\n\n${results.join("")}` }],
      };
    }
  );

  // Tool: Delete Quick/Custom Action
  server.tool(
    "delete_lsc_action",
    "Delete an LSC Quick/Custom Action. Accepts a record ID or a MasterLabel/DeveloperName. NEVER use run_soql or delete_record — they will FAIL.",
    {
      actionId: z
        .string()
        .describe(
          "The record ID (from list_lsc_actions) OR the MasterLabel/DeveloperName of the action to delete"
        ),
      actionName: z
        .string()
        .optional()
        .describe("Optional: The action name/label for confirmation message"),
      targetOrg: z.string().optional().describe("Optional: specific org to delete from"),
    },
    async ({ actionId, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot delete action: ${validation.error}`,
            },
          ],
        };
      }

      try {
        // Resolve actionId — could be an ID or a name
        let resolvedId = actionId;
        const looksLikeId = /^[a-zA-Z0-9]{15,18}$/.test(actionId);

        if (!looksLikeId) {
          // Treat as a name — search by MasterLabel or DeveloperName
          const nameQuery = await runToolingQuery(
            `SELECT Id, MasterLabel FROM LifeSciConfigRecord WHERE MasterLabel = '${actionId.replace(/'/g, "\\'")}' OR DeveloperName = '${actionId.replace(/'/g, "\\'")}' LIMIT 1`,
            effectiveOrg
          );

          if (!nameQuery.success || !nameQuery.data?.records?.length) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Action Not Found\n\nNo action found with name: ${actionId}\n\nUse \`list_lsc_actions\` to see available actions and their IDs.`,
                },
              ],
            };
          }

          resolvedId = (nameQuery.data.records[0] as Record<string, unknown>).Id as string;
        }

        // Verify the record exists and get its details
        const verifyQuery = await runToolingQuery(
          `SELECT Id, MasterLabel, IsActive FROM LifeSciConfigRecord WHERE Id = '${resolvedId}' LIMIT 1`,
          effectiveOrg
        );

        if (!verifyQuery.success || !verifyQuery.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# Action Not Found\n\nNo LifeSciConfigRecord found with ID: ${resolvedId}\n\nUse \`list_lsc_actions\` to see available actions and their IDs.`,
              },
            ],
          };
        }

        const record = verifyQuery.data.records[0] as Record<string, unknown>;
        const label = record.MasterLabel as string;

        // Delete associated LifeSciConfigFieldValue records first
        const fieldValuesQuery = await runToolingQuery(
          `SELECT Id FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId = '${resolvedId}'`,
          effectiveOrg
        );

        const deletedFieldValues: string[] = [];
        if (fieldValuesQuery.success && fieldValuesQuery.data?.records) {
          for (const fv of fieldValuesQuery.data.records) {
            const fvId = (fv as Record<string, unknown>).Id as string;
            const deleteResult = await deleteToolingRecord(
              "LifeSciConfigFieldValue",
              fvId,
              effectiveOrg
            );
            if (deleteResult.success) {
              deletedFieldValues.push(fvId);
            }
          }
        }

        // Delete associated LifeSciConfigAssignment records
        const assignQuery = await runToolingQuery(
          `SELECT Id FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId = '${resolvedId}'`,
          effectiveOrg
        );
        if (assignQuery.success && assignQuery.data?.records) {
          for (const a of assignQuery.data.records) {
            await deleteToolingRecord(
              "LifeSciConfigAssignment",
              (a as Record<string, unknown>).Id as string,
              effectiveOrg
            );
          }
        }

        // Delete the main LifeSciConfigRecord
        const deleteResult = await deleteToolingRecord(
          "LifeSciConfigRecord",
          resolvedId,
          effectiveOrg
        );

        if (!deleteResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Delete Action\n\n**Error:** ${deleteResult.error}\n\n**Action:** ${label} (${resolvedId})\n\nDeleted ${deletedFieldValues.length} field value record(s) before failure.`,
              },
            ],
          };
        }

        let message = `# Action Deleted Successfully\n\n`;
        message += `**Deleted:** ${label}\n`;
        message += `**Record ID:** ${resolvedId}\n`;
        message += `**Field Values Deleted:** ${deletedFieldValues.length}\n\n`;
        message += `## Next Steps\n\n`;
        message += `1. **Regenerate metadata cache** for changes to appear on mobile\n`;
        message += `2. Users must sync their mobile devices\n`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Delete Action\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Update Quick/Custom Action
  server.tool(
    "update_lsc_action",
    "Update an existing LSC Quick or Custom Action. Accepts a record ID or MasterLabel/DeveloperName. Can update the label, activation status, and field values (Location, ActionName, SortOrder, Profiles, etc.).",
    {
      actionId: z
        .string()
        .describe("The record ID or MasterLabel/DeveloperName of the action to update"),
      label: z.string().optional().describe("New display label for the action"),
      isActive: z.boolean().optional().describe("Set active/inactive"),
      fieldValues: z
        .array(
          z.object({
            fieldName: z
              .string()
              .describe(
                "Field name to update (e.g., Location, ActionName, SortOrder, Profiles, EntityType, ActionType, ActionTarget, TargetType, TargetParameters)"
              ),
            value: z.unknown().describe("New value for the field"),
          })
        )
        .optional()
        .describe("Field values to update"),
      targetOrg: z.string().optional().describe("Optional: specific org"),
    },
    async ({ actionId, label, isActive, fieldValues, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot update action: ${validation.error}` }],
        };
      }

      try {
        // Resolve actionId — could be an ID or a name
        let resolvedId = actionId;
        const looksLikeId = /^[a-zA-Z0-9]{15,18}$/.test(actionId);

        if (!looksLikeId) {
          const nameQuery = await runToolingQuery(
            `SELECT Id, MasterLabel FROM LifeSciConfigRecord WHERE MasterLabel = '${actionId.replace(/'/g, "\\'")}' OR DeveloperName = '${actionId.replace(/'/g, "\\'")}' LIMIT 1`,
            effectiveOrg
          );

          if (!nameQuery.success || !nameQuery.data?.records?.length) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Action Not Found\n\nNo action found with name: ${actionId}\n\nUse \`list_lsc_actions\` to see available actions.`,
                },
              ],
            };
          }

          resolvedId = (nameQuery.data.records[0] as Record<string, unknown>).Id as string;
        }

        const changes: string[] = [];

        // Update top-level LifeSciConfigRecord fields
        const topLevelUpdates: Record<string, unknown> = {};
        if (label !== undefined) topLevelUpdates.MasterLabel = label;
        if (isActive !== undefined) topLevelUpdates.IsActive = isActive;

        if (Object.keys(topLevelUpdates).length > 0) {
          const updateResult = await updateToolingRecord(
            "LifeSciConfigRecord",
            resolvedId,
            topLevelUpdates,
            effectiveOrg
          );

          if (updateResult.success) {
            if (label !== undefined) changes.push(`Label → ${label}`);
            if (isActive !== undefined) changes.push(`Active → ${isActive}`);
          } else {
            changes.push(`Top-level update FAILED: ${updateResult.error}`);
          }
        }

        // Update child LifeSciConfigFieldValue records
        if (fieldValues && fieldValues.length > 0) {
          const { fieldValuesByRecord: fvMap } = await queryFieldValues([resolvedId], effectiveOrg);
          const existingFVs = new Map<string, Record<string, unknown>>();
          const fvRecords = fvMap.get(resolvedId) || [];
          for (const f of fvRecords) {
            existingFVs.set(f.FieldName as string, f);
          }

          for (const fv of fieldValues) {
            const existing = existingFVs.get(fv.fieldName);

            if (existing) {
              const dataType = existing.DataType as string;
              const valueCol = getValueColumn(dataType);
              const updateResult = await updateToolingRecord(
                "LifeSciConfigFieldValue",
                existing.Id as string,
                { [valueCol]: fv.value },
                effectiveOrg
              );

              if (updateResult.success) {
                const oldValue = extractFieldValue(existing);
                changes.push(`${fv.fieldName}: ${oldValue ?? "(empty)"} → ${fv.value}`);
              } else {
                changes.push(`${fv.fieldName}: FAILED — ${updateResult.error}`);
              }
            } else {
              // Field doesn't exist yet — infer data type from common action fields
              const dataTypeMap: Record<string, string> = {
                Location: "PICKLIST",
                ActionName: "PICKLIST",
                ActionType: "PICKLIST",
                EntityType: "PICKLIST",
                TargetType: "PICKLIST",
                StandardAction: "PICKLIST",
                SortOrder: "INTEGER",
                ActionTarget: "TEXT",
                EntityName: "TEXT",
                Color: "TEXT",
                Icon: "TEXT",
                QuickAction: "TEXT",
                Profiles: "TEXT",
                TargetParameters: "TEXT",
                TargetParametersSource: "LONGTEXT",
                RecordTypes: "LONGTEXT",
                IsMobileOnly: "BOOLEAN",
                HideViewInBrowserAction: "BOOLEAN",
              };
              const dataType = dataTypeMap[fv.fieldName] || "TEXT";
              const valueCol = getValueColumn(dataType);

              const createResult = await createToolingRecord(
                "LifeSciConfigFieldValue",
                {
                  FieldName: fv.fieldName,
                  LifeSciConfigRecordId: resolvedId,
                  DataType: dataType,
                  [valueCol]: fv.value,
                },
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

        if (changes.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# No Changes Specified\n\nProvide \`label\`, \`isActive\`, or \`fieldValues\` to update.`,
              },
            ],
          };
        }

        const hasFailures = changes.some((c) => c.includes("FAILED"));
        const title = hasFailures
          ? "Action Updated — Errors Occurred"
          : "Action Updated Successfully";
        let message = `# ${title}\n\n`;
        message += `**Record ID:** ${resolvedId}\n\n`;
        message += `## Changes\n\n`;
        for (const change of changes) {
          message += `- ${change}\n`;
        }
        message += `\n**Remember:** Regenerate the metadata cache for changes to appear on mobile.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Update Action\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Create Quick Action
  server.tool(
    "create_quick_action",
    "Create an LSC Quick Action via Tooling API. Quick actions appear on the floating action button on mobile and in quick action menus on web.",
    {
      label: z
        .string()
        .describe("The display label for the quick action (e.g., 'Home Email', 'Home Visit')"),
      developerName: z
        .string()
        .describe(
          "The developer name suffix (e.g., 'HomeEmail'). The 'QuickAction_' prefix is added automatically."
        ),
      location: z
        .enum([
          "HomePage",
          "Account",
          "Visit",
          "Search",
          "NextBestCustomer",
          "Presentation",
          "VisitSearch",
        ])
        .describe("Where the quick action appears"),
      actionName: z
        .enum([
          "Email",
          "NewVisit",
          "LogCall",
          "NewTask",
          "NewEvent",
          "IntelligentContent",
          "ViewOnline",
          "Consent",
          "WebEmail",
        ])
        .describe("The predefined action to invoke"),
      sortOrder: z
        .number()
        .int()
        .min(1)
        .max(100)
        .describe("Display order (lower numbers appear first). Use 1-5 for Home page actions."),
      profiles: z
        .array(z.string())
        .optional()
        .describe(
          "Profile names that can see this action (e.g., ['Field Sales Representative', 'District Manager'])"
        ),
      isActive: z.boolean().optional().default(true).describe("Whether the action is active"),
      targetOrg: z.string().optional().describe("Optional: specific org to create in"),
    },
    async ({
      label,
      developerName: rawDevName,
      location,
      actionName,
      sortOrder,
      profiles,
      isActive,
      targetOrg,
    }) => {
      // Auto-prefix with QuickAction_ if not already present
      const developerName = rawDevName.startsWith("QuickAction_")
        ? rawDevName
        : `QuickAction_${rawDevName}`;
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot create quick action: ${validation.error}`,
            },
          ],
        };
      }

      try {
        // Step 1: Get the QuickAction category ID
        const categoryQuery = await cachedToolingQuery(
          "SELECT Id FROM LifeSciConfigCategory WHERE Category = 'QuickAction' LIMIT 1",
          effectiveOrg
        );

        if (!categoryQuery.success || !categoryQuery.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Create Quick Action\n\nCould not find QuickAction category. Ensure LSC is installed in the org.`,
              },
            ],
          };
        }

        const categoryId = categoryQuery.data.records[0].Id as string;
        const shouldActivate = isActive ?? true;

        // Step 2: Create the LifeSciConfigRecord as INACTIVE first.
        // The Tooling API validates that ActionName, SortOrder, and Location exist
        // when IsActive=true, but those are child LifeSciConfigFieldValue records
        // that can only be created after the parent. So we create inactive first,
        // add the required field values, then activate.
        // MasterLabel matches DeveloperName by convention for Quick Actions
        const masterLabel = developerName;
        const recordResult = await createToolingRecord(
          "LifeSciConfigRecord",
          {
            DeveloperName: developerName,
            MasterLabel: masterLabel,
            LifeSciConfigCategoryId: categoryId,
            IsActive: false,
            IsOrgLevel: false,
          },
          effectiveOrg
        );

        if (!recordResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Create Quick Action\n\n${recordResult.error}`,
              },
            ],
          };
        }

        const recordId = recordResult.data!.id;

        // Step 3: Create LifeSciConfigFieldValue records for the action settings
        const fieldValues: Array<Record<string, unknown>> = [
          {
            FieldName: "Location",
            PicklistValue: location,
            LifeSciConfigRecordId: recordId,
            DataType: "PICKLIST",
          },
          {
            FieldName: "ActionName",
            PicklistValue: actionName,
            LifeSciConfigRecordId: recordId,
            DataType: "PICKLIST",
          },
          {
            FieldName: "SortOrder",
            IntegerValue: sortOrder,
            LifeSciConfigRecordId: recordId,
            DataType: "INTEGER",
          },
        ];

        if (profiles && profiles.length > 0) {
          fieldValues.push({
            FieldName: "Profiles",
            TextValue: profiles.join(";"),
            LifeSciConfigRecordId: recordId,
            DataType: "TEXT",
          });
        }

        const fieldErrors: string[] = [];
        for (const fieldValue of fieldValues) {
          const fieldResult = await createToolingRecord(
            "LifeSciConfigFieldValue",
            fieldValue,
            effectiveOrg
          );

          if (!fieldResult.success) {
            fieldErrors.push(`${fieldValue.FieldName}: ${fieldResult.error}`);
          }
        }

        // Step 4: Activate the record now that required field values exist
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

        let message = `# Quick Action Created Successfully\n\n`;
        message += `**Label:** ${label}\n`;
        message += `**Developer Name:** ${developerName}\n`;
        message += `**Record ID:** ${recordId}\n`;
        message += `**Location:** ${location}\n`;
        message += `**Action:** ${actionName}\n`;
        message += `**Sort Order:** ${sortOrder}\n`;
        message += `**Active:** ${isActive ?? true}\n`;

        if (profiles && profiles.length > 0) {
          message += `**Profiles:** ${profiles.join(", ")}\n`;
        }

        if (fieldErrors.length > 0) {
          message += `\n## Warnings\n\nSome field values could not be created:\n`;
          for (const err of fieldErrors) {
            message += `- ${err}\n`;
          }
        }

        message += `\n## Next Steps\n\n`;
        message += `1. **Regenerate metadata cache** for the action to appear on mobile\n`;
        message += `2. Navigate to Admin Console > Quick and Custom Action Administration to verify\n`;
        message += `3. Test on mobile device after syncing\n`;

        if (location === "HomePage") {
          message += `\n**Note:** Only 5 quick actions can appear on the mobile Home floating button.\n`;
        }

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Create Quick Action\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Create Custom Action
  server.tool(
    "create_custom_action",
    "Create an LSC Custom Action via Tooling API. Custom actions invoke Lightning components, flows, URLs, or Agentforce utterances.",
    {
      label: z
        .string()
        .describe("The display label for the custom action (e.g., 'Search Google', 'Launch Flow')"),
      developerName: z
        .string()
        .describe(
          "The developer name suffix (e.g., 'SearchGoogle'). The 'CustomAction_' prefix is added automatically."
        ),
      entityType: z
        .enum(["HomePage", "SObject", "StagePath", "Visit"])
        .describe("Where the action is available"),
      actionType: z
        .enum(["URL", "App", "Utterance"])
        .describe(
          "Type of action: URL opens a URL, App invokes a component/flow, Utterance sends to Agentforce"
        ),
      actionTarget: z
        .string()
        .describe(
          "The target: URL for URL type, component/flow name for App type, or utterance text for Utterance type"
        ),
      targetType: z
        .enum(["Internal", "External"])
        .optional()
        .describe("For URL type: Internal opens in app, External opens in browser"),
      targetParameters: z
        .string()
        .optional()
        .describe("URL parameters (e.g., 'q=$record.Name' to pass record field values)"),
      entityName: z
        .string()
        .optional()
        .describe("For SObject entityType: the object API name (e.g., 'Account')"),
      profiles: z.array(z.string()).optional().describe("Profile names that can see this action"),
      isActive: z.boolean().optional().default(true).describe("Whether the action is active"),
      targetOrg: z.string().optional().describe("Optional: specific org to create in"),
    },
    async ({
      label,
      developerName: rawDevName,
      entityType,
      actionType,
      actionTarget,
      targetType,
      targetParameters,
      entityName,
      profiles,
      isActive,
      targetOrg,
    }) => {
      // Auto-prefix with CustomAction_ if not already present
      const developerName = rawDevName.startsWith("CustomAction_")
        ? rawDevName
        : `CustomAction_${rawDevName}`;
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot create custom action: ${validation.error}`,
            },
          ],
        };
      }

      try {
        // Step 1: Get the CustomAction category ID
        const categoryQuery = await cachedToolingQuery(
          "SELECT Id FROM LifeSciConfigCategory WHERE Category = 'CustomAction' LIMIT 1",
          effectiveOrg
        );

        if (!categoryQuery.success || !categoryQuery.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Create Custom Action\n\nCould not find CustomAction category. Ensure LSC is installed in the org.`,
              },
            ],
          };
        }

        const categoryId = categoryQuery.data.records[0].Id as string;
        const shouldActivate = isActive ?? true;

        // Step 2: Create the LifeSciConfigRecord as INACTIVE first.
        // The Tooling API validates that required field values exist when IsActive=true,
        // but those are child records that can only be created after the parent.
        // So we create inactive, add field values, then activate.
        // MasterLabel matches DeveloperName by convention for Custom Actions
        const masterLabel = developerName;
        const recordResult = await createToolingRecord(
          "LifeSciConfigRecord",
          {
            DeveloperName: developerName,
            MasterLabel: masterLabel,
            LifeSciConfigCategoryId: categoryId,
            IsActive: false,
            IsOrgLevel: false,
          },
          effectiveOrg
        );

        if (!recordResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Create Custom Action\n\n${recordResult.error}`,
              },
            ],
          };
        }

        const recordId = recordResult.data!.id;

        // Step 3: Create LifeSciConfigFieldValue records for the action settings
        const fieldValues: Array<Record<string, unknown>> = [
          {
            FieldName: "EntityType",
            PicklistValue: entityType,
            LifeSciConfigRecordId: recordId,
            DataType: "PICKLIST",
          },
          {
            FieldName: "ActionType",
            PicklistValue: actionType,
            LifeSciConfigRecordId: recordId,
            DataType: "PICKLIST",
          },
          {
            FieldName: "ActionTarget",
            TextValue: actionTarget,
            LifeSciConfigRecordId: recordId,
            DataType: "TEXT",
          },
        ];

        if (targetType) {
          fieldValues.push({
            FieldName: "TargetType",
            PicklistValue: targetType,
            LifeSciConfigRecordId: recordId,
            DataType: "PICKLIST",
          });
        }

        if (targetParameters) {
          fieldValues.push({
            FieldName: "TargetParameters",
            TextValue: targetParameters,
            LifeSciConfigRecordId: recordId,
            DataType: "TEXT",
          });
        }

        if (entityName) {
          fieldValues.push({
            FieldName: "EntityName",
            TextValue: entityName,
            LifeSciConfigRecordId: recordId,
            DataType: "TEXT",
          });
        }

        if (profiles && profiles.length > 0) {
          fieldValues.push({
            FieldName: "Profiles",
            TextValue: profiles.join(";"),
            LifeSciConfigRecordId: recordId,
            DataType: "TEXT",
          });
        }

        const fieldErrors: string[] = [];
        for (const fieldValue of fieldValues) {
          const fieldResult = await createToolingRecord(
            "LifeSciConfigFieldValue",
            fieldValue,
            effectiveOrg
          );

          if (!fieldResult.success) {
            fieldErrors.push(`${fieldValue.FieldName}: ${fieldResult.error}`);
          }
        }

        // Step 4: Activate the record now that required field values exist
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

        let message = `# Custom Action Created Successfully\n\n`;
        message += `**Label:** ${label}\n`;
        message += `**Developer Name:** ${developerName}\n`;
        message += `**Record ID:** ${recordId}\n`;
        message += `**Entity Type:** ${entityType}\n`;
        message += `**Action Type:** ${actionType}\n`;
        message += `**Action Target:** ${actionTarget}\n`;
        message += `**Active:** ${shouldActivate && fieldErrors.length === 0}\n`;

        if (targetType) {
          message += `**Target Type:** ${targetType}\n`;
        }
        if (targetParameters) {
          message += `**Parameters:** ${targetParameters}\n`;
        }
        if (entityName) {
          message += `**Entity Name:** ${entityName}\n`;
        }
        if (profiles && profiles.length > 0) {
          message += `**Profiles:** ${profiles.join(", ")}\n`;
        }

        if (fieldErrors.length > 0) {
          message += `\n## Warnings\n\nSome field values could not be created:\n`;
          for (const err of fieldErrors) {
            message += `- ${err}\n`;
          }
        }

        message += `\n## Next Steps\n\n`;
        message += `1. **Regenerate metadata cache** for the action to appear on mobile\n`;
        message += `2. Navigate to Admin Console > Quick and Custom Action Administration > Custom Actions to verify\n`;
        message += `3. Test on mobile device after syncing\n`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Create Custom Action\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
  server.tool(
    "check_mobile_cache_status",
    "THE ONLY WAY to check LSC mobile metadata cache status. NEVER use run_soql - objects like MobileMetadataCache__c, MobileApplicationDetail, lsc4ce__MobileMetadataCache__c DO NOT EXIST. The correct object is LifeSciMobileMetadataRecord (standard SOQL).",
    {
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot check cache status: ${validation.error}`,
            },
          ],
        };
      }

      try {
        const statusQuery = `SELECT Id, Name, Status, IntegrationStatus, IntegrationErrorCode, IntegrationErrorMessage, ErrorLog, LastModifiedDate, ProfileId FROM LifeSciMobileMetadataRecord ORDER BY LastModifiedDate DESC LIMIT 20`;
        const statusResult = await runSoqlQuery(statusQuery, effectiveOrg);

        if (!statusResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Check Cache Status\n\n${statusResult.error}\n\n**Note:** The correct object is \`LifeSciMobileMetadataRecord\`. Objects like \`MobileMetadataCache__c\` or \`MobileApplicationDetail\` DO NOT EXIST.`,
              },
            ],
          };
        }

        const records = statusResult.data!.records;

        if (records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Mobile Metadata Cache Status\n\nNo cache records found. No metadata cache has been generated yet.\n\nUse \`generate_mobile_metadata_cache\` to create one.`,
              },
            ],
          };
        }

        // Look up profile names for records that have ProfileId
        const profileIds = records
          .map((r) => (r as Record<string, unknown>).ProfileId)
          .filter((id) => id != null) as string[];

        const profileMap: Record<string, string> = {};
        if (profileIds.length > 0) {
          const uniqueIds = [...new Set(profileIds)];
          const profileQuery = `SELECT Id, Name FROM Profile WHERE Id IN ('${uniqueIds.join("','")}')`;
          const profileResult = await runSoqlQuery(profileQuery, effectiveOrg);
          if (profileResult.success && profileResult.data?.records) {
            for (const p of profileResult.data.records) {
              const pr = p as Record<string, unknown>;
              profileMap[pr.Id as string] = pr.Name as string;
            }
          }
        }

        let message = `# Mobile Metadata Cache Status\n\n`;
        message += `**Records found:** ${records.length}\n\n`;
        message += `| Name | Status | Integration | Profile | Error | Last Modified |\n`;
        message += `|------|--------|-------------|---------|-------|---------------|\n`;

        for (const record of records) {
          const rec = record as Record<string, unknown>;
          const name = rec.Name || "-";
          const status = rec.Status || "-";
          const integrationStatus = rec.IntegrationStatus || "-";
          const profileId = rec.ProfileId as string;
          const profileName = profileId ? profileMap[profileId] || profileId : "(parent)";
          const errorMsg = rec.IntegrationErrorMessage
            ? String(rec.IntegrationErrorMessage).substring(0, 50) +
              (String(rec.IntegrationErrorMessage).length > 50 ? "..." : "")
            : "-";
          const lastMod = rec.LastModifiedDate
            ? String(rec.LastModifiedDate).substring(0, 19).replace("T", " ")
            : "-";

          message += `| ${name} | ${status} | ${integrationStatus} | ${profileName} | ${errorMsg} | ${lastMod} |\n`;
        }

        // Summary
        const errorRecords = records.filter(
          (r) =>
            (r as Record<string, unknown>).Status === "Error" ||
            (r as Record<string, unknown>).IntegrationStatus === "Error"
        );
        const inactiveRecords = records.filter(
          (r) => (r as Record<string, unknown>).Status === "Inactive"
        );
        const activeRecords = records.filter(
          (r) =>
            (r as Record<string, unknown>).Status === "Active" ||
            (r as Record<string, unknown>).Status === "Published"
        );
        const problemRecords = [...errorRecords, ...inactiveRecords];

        message += `\n## Summary\n\n`;
        message += `- **Active/Published:** ${activeRecords.length}\n`;
        message += `- **Inactive:** ${inactiveRecords.length}\n`;
        message += `- **Errors:** ${errorRecords.length}\n`;

        if (problemRecords.length > 0) {
          message += `\n## Issues Found\n\n`;
          for (const pr of problemRecords) {
            const rec = pr as Record<string, unknown>;
            const profileId = rec.ProfileId as string;
            const profileName = profileId ? profileMap[profileId] || profileId : "(parent)";
            const status = rec.Status || "Unknown";
            const integrationStatus = rec.IntegrationStatus || "-";
            const errorCode = rec.IntegrationErrorCode ? String(rec.IntegrationErrorCode) : "";
            const errorMsg = rec.IntegrationErrorMessage ? String(rec.IntegrationErrorMessage) : "";
            const errorLog = rec.ErrorLog ? String(rec.ErrorLog) : "";

            message += `### ${rec.Name} — ${status}\n`;
            message += `- **Profile:** ${profileName}\n`;
            message += `- **Status:** ${status}\n`;
            message += `- **Integration Status:** ${integrationStatus}\n`;
            if (errorCode) {
              message += `- **Error Code:** ${errorCode}\n`;
            }
            if (errorMsg) {
              message += `- **Error Message:** ${errorMsg}\n`;
            }
            if (errorLog) {
              message += `- **Error Log:**\n\`\`\`\n${errorLog}\n\`\`\`\n`;
            }
            const combinedError = `${errorCode} ${errorMsg} ${errorLog}`.toUpperCase();
            if (combinedError.includes("EXCEEDED_ID_LIMIT")) {
              message += `- **Diagnosis:** \`EXCEEDED_ID_LIMIT\` during cache generation is a **known large-org limitation**, not a configuration error. The metadata service fetches field-definition labels in a batch that overflows on orgs with many sobjects/fields (FieldDefinition does not support pagination). This is fixed in newer package versions via chunked label fetching. **Action:** upgrade the LSC managed package to the latest version; do not attempt to "fix" DB Schema or field configuration in response to this error.\n`;
            }
            if (!errorCode && !errorMsg && !errorLog && status === "Inactive") {
              message += `- **Note:** Record is inactive with no error details. It may need to be regenerated.\n`;
            }
            message += `\n`;
          }
        }

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Cache Status\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
