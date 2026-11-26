import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runToolingQuery,
  cachedToolingQuery,
  createToolingRecord,
  updateToolingRecord,
  deleteToolingRecord,
} from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import {
  queryFieldValues,
  queryAssignments,
  extractFieldValue,
  getValueColumn,
  normalizeDbSchemaName,
  resolveProfileId,
} from "./helpers.js";

export function register(server: McpServer) {
  server.tool(
    "list_db_schema",
    "List all DB Schema records (mobile object sync configuration). Shows SObject, Type, Active status, SOQL filter, sync direction, and profile assignments. Use this instead of list_admin_settings for DbSchema.",
    {
      filter: z
        .string()
        .optional()
        .describe(
          "Optional: filter by record name or SObject name (case-insensitive partial match)"
        ),
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ filter, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot list DB Schema records: ${validation.error}` }],
        };
      }

      try {
        // Get DbSchema category ID
        const catQuery = `SELECT Id FROM LifeSciConfigCategory WHERE Category = 'DbSchema' LIMIT 1`;
        const catResult = await cachedToolingQuery(catQuery, effectiveOrg);

        if (!catResult.success || !catResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# DB Schema Not Found\n\nNo DbSchema category found. Ensure LSC is installed in the org.`,
              },
            ],
          };
        }

        const categoryId = catResult.data.records[0].Id as string;

        // Get all config records
        const recordsQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${categoryId}' ORDER BY MasterLabel`;
        const recordsResult = await runToolingQuery(recordsQuery, effectiveOrg);

        if (!recordsResult.success) {
          return {
            content: [
              { type: "text", text: `# Failed to Query DB Schema\n\n${recordsResult.error}` },
            ],
          };
        }

        const records = recordsResult.data?.records || [];
        if (records.length === 0) {
          return {
            content: [{ type: "text", text: `# DB Schema Records\n\nNo DB Schema records found.` }],
          };
        }

        // Batch-fetch all field values
        const recordIds = records.map((r) => (r as Record<string, unknown>).Id as string);
        const { fieldValuesByRecord, queryError: fvError } = await queryFieldValues(
          recordIds,
          effectiveOrg,
          true
        );

        if (fvError) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Query Field Values\n\nRecords found: ${records.length}, but field values query failed:\n\n${fvError}\n\nThis may indicate that the Tooling API column names differ from expected. Use \`list_admin_settings({ category: "DbSchema" })\` as a fallback.`,
              },
            ],
          };
        }

        // Build table rows
        type DbSchemaRow = {
          name: string;
          sobject: string;
          type: string;
          active: boolean;
          filter: string;
          oneWaySync: boolean;
          attachments: string;
        };

        const rows: DbSchemaRow[] = [];

        for (const record of records) {
          const r = record as Record<string, unknown>;
          const fieldValues = fieldValuesByRecord.get(r.Id as string) || [];

          const getField = (name: string): unknown => {
            const fv = fieldValues.find((f) => f.FieldName === name);
            return fv ? extractFieldValue(fv) : null;
          };

          const row: DbSchemaRow = {
            name: r.DeveloperName as string,
            sobject: (getField("SObject") as string) || "",
            type: (getField("Type") as string) || "",
            active: r.IsActive as boolean,
            filter: (getField("WhereSoql") as string) || "",
            oneWaySync: (getField("OneWaySync") as boolean) || false,
            attachments: (getField("AttachmentsSupport") as string) || "",
          };

          // Apply filter if provided
          if (filter) {
            const lowerFilter = filter.toLowerCase();
            if (
              !row.name.toLowerCase().includes(lowerFilter) &&
              !row.sobject.toLowerCase().includes(lowerFilter)
            ) {
              continue;
            }
          }

          rows.push(row);
        }

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# DB Schema Records\n\nNo records match filter "${filter}". Total records in org: ${records.length}.`,
              },
            ],
          };
        }

        // Format table
        let message = `# DB Schema Records\n\n`;
        message += `| Name | SObject | Type | Active | SOQL Filter | OneWaySync | Attachments |\n`;
        message += `|------|---------|------|--------|-------------|------------|-------------|\n`;

        let activeCount = 0;
        let dataCount = 0;
        let configCount = 0;

        for (const row of rows) {
          if (row.active) activeCount++;
          if (row.type === "DATA") dataCount++;
          if (row.type === "CONFIGURATION") configCount++;

          const filterDisplay = row.filter
            ? row.filter.length > 40
              ? row.filter.substring(0, 37) + "..."
              : row.filter
            : "";
          message += `| ${row.name} | ${row.sobject} | ${row.type} | ${row.active ? "Yes" : "No"} | ${filterDisplay} | ${row.oneWaySync ? "Yes" : "No"} | ${row.attachments} |\n`;
        }

        message += `\n**Total:** ${rows.length} record(s) — ${activeCount} active, ${rows.length - activeCount} inactive — ${dataCount} DATA, ${configCount} CONFIGURATION\n`;
        message += `\nUse \`get_db_schema\` to see full details for a specific record.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to List DB Schema\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Get DB Schema Record Detail
  server.tool(
    "get_db_schema",
    "Get full details of a specific DB Schema record including all field values and profile assignments. Accepts short name (e.g., 'Visit') or full name ('DbSchema_Visit').",
    {
      name: z.string().describe("The DB Schema record name — accepts 'Visit' or 'DbSchema_Visit'"),
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ name, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot get DB Schema record: ${validation.error}` }],
        };
      }

      try {
        const fullName = normalizeDbSchemaName(name);

        // Get the record
        const recordQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel FROM LifeSciConfigRecord WHERE DeveloperName = '${fullName}' LIMIT 1`;
        const recordResult = await runToolingQuery(recordQuery, effectiveOrg);

        if (!recordResult.success || !recordResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# DB Schema Record Not Found\n\nNo record named "${fullName}". Use \`list_db_schema\` to see all available records.`,
              },
            ],
          };
        }

        const record = recordResult.data.records[0] as Record<string, unknown>;
        const recordId = record.Id as string;

        // Get field values
        const { fieldValuesByRecord: fvMap, queryError: fvError } = await queryFieldValues(
          [recordId],
          effectiveOrg
        );
        const fieldValues = fvMap.get(recordId) || [];

        // Get profile assignments
        const assignmentMap = await queryAssignments([recordId], effectiveOrg);

        let message = `# ${record.MasterLabel} (\`${record.DeveloperName}\`)\n\n`;
        message += `- **Record ID:** ${recordId}\n`;
        message += `- **Active:** ${record.IsActive ? "Yes" : "No"}\n`;
        message += `- **Org-Level:** ${record.IsOrgLevel ? "Yes" : "No"}\n`;

        // Field values
        if (fvError) {
          message += `\n## Field Values\n\nQuery failed: ${fvError}\n`;
        } else if (fieldValues.length > 0) {
          message += `\n## Field Values\n\n`;
          message += `| Field | Value | Data Type | ID |\n`;
          message += `|-------|-------|-----------|----|\n`;

          for (const f of fieldValues) {
            const value = extractFieldValue(f);
            const displayValue = value !== null && value !== undefined ? String(value) : "(empty)";
            message += `| ${f.FieldName} | ${displayValue} | ${f.DataType} | ${f.Id} |\n`;
          }
        } else {
          message += `\n## Field Values\n\nNo field values found.\n`;
        }

        // Profile assignments
        const assignments = assignmentMap.get(recordId) || [];
        if (assignments.length > 0) {
          message += `\n## Profile Assignments\n\n`;
          for (const a of assignments) {
            message += `- ${a.name} (${a.level})\n`;
          }
        } else {
          message += `\n## Profile Assignments\n\nNo profile assignments found.\n`;
        }

        message += `\nUse \`update_db_schema\` to modify this record or \`toggle_db_schema\` to enable/disable it.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Get DB Schema Record\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Create DB Schema Record
  server.tool(
    "create_db_schema",
    "Create a new DB Schema record for mobile object sync. Creates the LifeSciConfigRecord and all standard LifeSciConfigFieldValue records with correct data types. Names it DbSchema_{objectName} automatically.",
    {
      objectName: z
        .string()
        .describe("Salesforce object API name (e.g., 'Product2', 'CustomObject__c')"),
      type: z
        .enum(["DATA", "CONFIGURATION"])
        .optional()
        .default("DATA")
        .describe(
          "Record type: DATA (synced objects) or CONFIGURATION (metadata-like records). Default: DATA"
        ),
      whereSoql: z
        .string()
        .optional()
        .describe(
          "Optional SOQL WHERE clause filter. Must be wrapped in parentheses, e.g., '(IsActive = true)'"
        ),
      oneWaySync: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, data flows web→mobile only (read-only on mobile). Default: false"),
      attachmentsSupport: z
        .enum(["CACHE", "BACKGROUND", ""])
        .optional()
        .default("")
        .describe(
          "How attachments are handled: CACHE (during sync), BACKGROUND (after sync), or empty (none). Default: none"
        ),
      profiles: z
        .array(z.string())
        .optional()
        .describe(
          "Optional: profile names to assign (e.g., ['Field Sales Representative', 'System Administrator'])"
        ),
      permissionSets: z
        .array(z.string())
        .optional()
        .describe(
          "Optional: permission set API names (NOT labels) that gate this object's sync (e.g., ['LSC_Field_Sales']). Stored as a semicolon-delimited list in the PermissionSets field. The mobile app syncs the object for users who hold any listed permission set, in addition to the assigned profiles."
        ),
      isActive: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether the record is active (default: true)"),
      targetOrg: z.string().optional().describe("Optional: specific org to create in"),
    },
    async ({
      objectName,
      type,
      whereSoql,
      oneWaySync,
      attachmentsSupport,
      profiles,
      permissionSets,
      isActive,
      targetOrg,
    }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot create DB Schema record: ${validation.error}` }],
        };
      }

      try {
        const devName = `DbSchema_${objectName}`;
        const label = `DbSchema ${objectName}`;

        // Get DbSchema category ID
        const catQuery = `SELECT Id FROM LifeSciConfigCategory WHERE Category = 'DbSchema' LIMIT 1`;
        const catResult = await cachedToolingQuery(catQuery, effectiveOrg);

        if (!catResult.success || !catResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# DbSchema Category Not Found\n\nNo DbSchema category found. Ensure LSC is installed.`,
              },
            ],
          };
        }

        const categoryId = catResult.data.records[0].Id as string;

        // Check if it already exists
        const existCheck = `SELECT Id FROM LifeSciConfigRecord WHERE DeveloperName = '${devName}' LIMIT 1`;
        const existResult = await runToolingQuery(existCheck, effectiveOrg);
        if (existResult.success && existResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# DB Schema Record Already Exists\n\n\`${devName}\` already exists (ID: ${(existResult.data.records[0] as Record<string, unknown>).Id}). Use \`update_db_schema\` to modify it or \`get_db_schema\` to see its details.`,
              },
            ],
          };
        }

        // Create the LifeSciConfigRecord as INACTIVE first.
        // The Tooling API validates that required field values exist when IsActive=true,
        // but those are child records that can only be created after the parent.
        const shouldActivate = isActive ?? true;
        const recordResult = await createToolingRecord(
          "LifeSciConfigRecord",
          {
            DeveloperName: devName,
            MasterLabel: label,
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
                text: `# Failed to Create DB Schema Record\n\n${recordResult.error}`,
              },
            ],
          };
        }

        const recordId = recordResult.data!.id;

        // Create all standard field values with correct data types
        const fieldDefs: Array<{ name: string; dataType: string; value: unknown }> = [
          { name: "SObject", dataType: "OBJECT", value: objectName },
          { name: "Type", dataType: "PICKLIST", value: type || "DATA" },
          { name: "WhereSoql", dataType: "LONGTEXT", value: whereSoql || "" },
          { name: "DeltaDateField", dataType: "FIELD", value: "LastModifiedDate" },
          { name: "OneWaySync", dataType: "BOOLEAN", value: oneWaySync ?? false },
          { name: "AttachmentsSupport", dataType: "PICKLIST", value: attachmentsSupport || "" },
          { name: "Status", dataType: "PICKLIST", value: "VALID" },
          { name: "MandatoryFields", dataType: "LONGTEXT", value: "" },
          {
            name: "PermissionSets",
            dataType: "LONGTEXT",
            value: permissionSets && permissionSets.length ? permissionSets.join("; ") : "",
          },
        ];

        const fieldErrors: string[] = [];
        for (const field of fieldDefs) {
          const createData: Record<string, unknown> = {
            FieldName: field.name,
            LifeSciConfigRecordId: recordId,
            DataType: field.dataType,
          };
          const valueCol = getValueColumn(field.dataType);
          createData[valueCol] = field.value;

          const fieldResult = await createToolingRecord(
            "LifeSciConfigFieldValue",
            createData,
            effectiveOrg
          );
          if (!fieldResult.success) {
            fieldErrors.push(`${field.name}: ${fieldResult.error}`);
          }
        }

        // Create profile assignments if specified
        const profileErrors: string[] = [];
        if (profiles && profiles.length > 0) {
          for (const profile of profiles) {
            // Resolve profile name to ID
            const profileId = await resolveProfileId(profile, effectiveOrg);
            if (!profileId) {
              profileErrors.push(`${profile}: Profile not found`);
              continue;
            }

            const assignResult = await createToolingRecord(
              "LifeSciConfigAssignment",
              {
                LifeSciConfigRecordId: recordId,
                AssignedToId: profileId,
                AssignmentLevel: "Profile",
              },
              effectiveOrg
            );
            if (!assignResult.success) {
              profileErrors.push(`${profile}: ${assignResult.error}`);
            }
          }
        }

        // Activate the record now that field values and assignments exist
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
            "Activation skipped — fix field value errors first, then use update_db_schema to activate"
          );
        }

        let message = `# DB Schema Record Created\n\n`;
        message += `- **Name:** ${devName}\n`;
        message += `- **SObject:** ${objectName}\n`;
        message += `- **Type:** ${type || "DATA"}\n`;
        message += `- **Active:** ${shouldActivate && fieldErrors.length === 0}\n`;
        message += `- **Record ID:** ${recordId}\n`;
        message += `- **OneWaySync:** ${oneWaySync ?? false}\n`;
        if (whereSoql) message += `- **SOQL Filter:** ${whereSoql}\n`;
        if (attachmentsSupport) message += `- **Attachments:** ${attachmentsSupport}\n`;
        if (permissionSets && permissionSets.length)
          message += `- **PermissionSets:** ${permissionSets.join("; ")}\n`;

        const totalFields = fieldDefs.length;
        const successFields = totalFields - fieldErrors.length;
        message += `- **Fields Created:** ${successFields}/${totalFields}\n`;

        if (profiles && profiles.length > 0) {
          const successProfiles = profiles.length - profileErrors.length;
          message += `- **Profiles Assigned:** ${successProfiles}/${profiles.length}\n`;
        }

        if (fieldErrors.length > 0) {
          message += `\n## Field Creation Warnings\n\n`;
          for (const err of fieldErrors) {
            message += `- ${err}\n`;
          }
        }

        if (profileErrors.length > 0) {
          message += `\n## Profile Assignment Warnings\n\n`;
          for (const err of profileErrors) {
            message += `- ${err}\n`;
          }
        }

        message += `\n## Next Steps\n\n`;
        message += `**Regenerate the mobile metadata cache** for changes to take effect on the iPad app.\n`;
        message += `Use \`generate_mobile_metadata_cache\` with the relevant profile names.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Create DB Schema Record\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Update DB Schema Record
  server.tool(
    "update_db_schema",
    "Update an existing DB Schema record. Looks up the record by name and updates only specified fields using correct data type mappings. Also assigns or removes profiles (addProfiles / removeProfiles): a rep whose profile isn't on the record doesn't get the object, which shows on the iPad as 'SObject <name> not found'. Accepts short name (e.g., 'Visit') or full name ('DbSchema_Visit').",
    {
      name: z.string().describe("The DB Schema record name — accepts 'Visit' or 'DbSchema_Visit'"),
      whereSoql: z
        .string()
        .optional()
        .describe("New SOQL WHERE clause filter. Must be wrapped in parentheses."),
      oneWaySync: z
        .boolean()
        .optional()
        .describe("Set web→mobile only sync (true) or bidirectional (false)"),
      isActive: z.boolean().optional().describe("Enable (true) or disable (false) the record"),
      attachmentsSupport: z
        .enum(["CACHE", "BACKGROUND", ""])
        .optional()
        .describe("How attachments are handled"),
      mandatoryFields: z.string().optional().describe("Comma-separated list of mandatory fields"),
      deltaDateField: z
        .string()
        .optional()
        .describe("Field used for delta sync (e.g., 'LastModifiedDate')"),
      permissionSets: z
        .array(z.string())
        .optional()
        .describe(
          "Permission set API names (NOT labels) that gate this object's sync. Stored as a semicolon-delimited list in the PermissionSets field. Pass an empty array to clear. This adds to the record's profile assignments, it doesn't replace them: to make a profile sync the object, use addProfiles."
        ),
      addProfiles: z
        .array(z.string())
        .optional()
        .describe(
          "Profile names (exact, e.g. 'LS PH Field Sales Representative') to assign to this record, so those profiles' iPads download the object. Use this when a rep gets 'SObject <name> not found': the record's profile list is what decides who syncs the table."
        ),
      removeProfiles: z
        .array(z.string())
        .optional()
        .describe("Profile names to take off this record (stops the object syncing for them)"),
      targetOrg: z.string().optional().describe("Optional: specific org to update"),
    },
    async ({
      name,
      whereSoql,
      oneWaySync,
      isActive,
      attachmentsSupport,
      mandatoryFields,
      deltaDateField,
      permissionSets,
      addProfiles,
      removeProfiles,
      targetOrg,
    }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot update DB Schema record: ${validation.error}` }],
        };
      }

      try {
        const fullName = normalizeDbSchemaName(name);

        // Find the record
        const recordQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive FROM LifeSciConfigRecord WHERE DeveloperName = '${fullName}' LIMIT 1`;
        const recordResult = await runToolingQuery(recordQuery, effectiveOrg);

        if (!recordResult.success || !recordResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# DB Schema Record Not Found\n\nNo record named "${fullName}". Use \`list_db_schema\` to see all available records.`,
              },
            ],
          };
        }

        const record = recordResult.data.records[0] as Record<string, unknown>;
        const recordId = record.Id as string;
        const changes: string[] = [];

        // Update IsActive on parent record if specified
        if (isActive !== undefined) {
          const updateResult = await updateToolingRecord(
            "LifeSciConfigRecord",
            recordId,
            { IsActive: isActive },
            effectiveOrg
          );
          if (updateResult.success) {
            changes.push(`IsActive: ${record.IsActive} → ${isActive}`);
          } else {
            changes.push(`IsActive: FAILED — ${updateResult.error}`);
          }
        }

        // Get existing field values
        const { fieldValuesByRecord: fvMap, queryError: fvError } = await queryFieldValues(
          [recordId],
          effectiveOrg
        );

        if (fvError) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Query Field Values\n\nCould not read existing field values for ${fullName}:\n\n${fvError}\n\nCannot safely update without knowing current values.`,
              },
            ],
          };
        }

        const existingFVs = new Map<string, Record<string, unknown>>();
        const fvRecords = fvMap.get(recordId) || [];
        for (const f of fvRecords) {
          existingFVs.set(f.FieldName as string, f);
        }

        // Build updates
        const fieldUpdates: Array<{ fieldName: string; value: unknown; dataType: string }> = [];
        if (whereSoql !== undefined)
          fieldUpdates.push({ fieldName: "WhereSoql", value: whereSoql, dataType: "LONGTEXT" });
        if (oneWaySync !== undefined)
          fieldUpdates.push({ fieldName: "OneWaySync", value: oneWaySync, dataType: "BOOLEAN" });
        if (attachmentsSupport !== undefined)
          fieldUpdates.push({
            fieldName: "AttachmentsSupport",
            value: attachmentsSupport,
            dataType: "PICKLIST",
          });
        if (mandatoryFields !== undefined)
          fieldUpdates.push({
            fieldName: "MandatoryFields",
            value: mandatoryFields,
            dataType: "LONGTEXT",
          });
        if (deltaDateField !== undefined)
          fieldUpdates.push({
            fieldName: "DeltaDateField",
            value: deltaDateField,
            dataType: "FIELD",
          });
        if (permissionSets !== undefined)
          fieldUpdates.push({
            fieldName: "PermissionSets",
            value: permissionSets.join("; "),
            dataType: "LONGTEXT",
          });

        for (const update of fieldUpdates) {
          const existing = existingFVs.get(update.fieldName);

          if (existing) {
            const dataType = existing.DataType as string;
            const valueCol = getValueColumn(dataType);
            const oldValue = extractFieldValue(existing);

            const updateResult = await updateToolingRecord(
              "LifeSciConfigFieldValue",
              existing.Id as string,
              { [valueCol]: update.value },
              effectiveOrg
            );

            if (updateResult.success) {
              changes.push(`${update.fieldName}: ${oldValue ?? "(empty)"} → ${update.value}`);
            } else {
              changes.push(`${update.fieldName}: FAILED — ${updateResult.error}`);
            }
          } else {
            // Create new field value
            const valueCol = getValueColumn(update.dataType);
            const createData: Record<string, unknown> = {
              FieldName: update.fieldName,
              LifeSciConfigRecordId: recordId,
              DataType: update.dataType,
              [valueCol]: update.value,
            };

            const createResult = await createToolingRecord(
              "LifeSciConfigFieldValue",
              createData,
              effectiveOrg
            );
            if (createResult.success) {
              changes.push(`${update.fieldName}: (new) = ${update.value}`);
            } else {
              changes.push(`${update.fieldName}: FAILED to create — ${createResult.error}`);
            }
          }
        }

        if (addProfiles?.length || removeProfiles?.length) {
          const current = (await queryAssignments([recordId], effectiveOrg)).get(recordId) ?? [];
          for (const profile of addProfiles ?? []) {
            const profileId = await resolveProfileId(profile, effectiveOrg);
            if (!profileId) {
              changes.push(`Profile ${profile}: FAILED — Profile not found`);
            } else if (current.some((a) => a.id === profileId)) {
              changes.push(`Profile ${profile}: already assigned`);
            } else {
              const res = await createToolingRecord(
                "LifeSciConfigAssignment",
                {
                  LifeSciConfigRecordId: recordId,
                  AssignedToId: profileId,
                  AssignmentLevel: "Profile",
                },
                effectiveOrg
              );
              changes.push(
                res.success
                  ? `Profile ${profile}: assigned`
                  : `Profile ${profile}: FAILED — ${res.error}`
              );
            }
          }
          for (const profile of removeProfiles ?? []) {
            const profileId = await resolveProfileId(profile, effectiveOrg);
            const held = profileId
              ? await runToolingQuery(
                  `SELECT Id FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId = '${recordId}' AND AssignedToId = '${profileId}' AND AssignmentLevel = 'Profile'`,
                  effectiveOrg
                )
              : null;
            const rows = (held?.data?.records ?? []) as Array<Record<string, unknown>>;
            if (!profileId) {
              changes.push(`Profile ${profile}: FAILED — Profile not found`);
            } else if (!held?.success) {
              changes.push(`Profile ${profile}: FAILED — ${held?.error}`);
            } else if (!rows.length) {
              changes.push(`Profile ${profile}: not assigned`);
            } else {
              let failed = "";
              for (const row of rows) {
                const res = await deleteToolingRecord(
                  "LifeSciConfigAssignment",
                  String(row.Id),
                  effectiveOrg
                );
                if (!res.success) failed = res.error ?? "unknown error";
              }
              changes.push(
                failed ? `Profile ${profile}: FAILED — ${failed}` : `Profile ${profile}: removed`
              );
            }
          }
        }

        if (changes.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Nothing to Update\n\nNo changes specified. Provide at least one field to update (whereSoql, oneWaySync, isActive, attachmentsSupport, mandatoryFields, deltaDateField, permissionSets, addProfiles, removeProfiles).`,
              },
            ],
          };
        }

        const hasFailures = changes.some((c) => c.includes("FAILED"));
        const title = hasFailures
          ? "DB Schema Update — Errors Occurred"
          : "DB Schema Record Updated";
        let message = `# ${title}\n\n`;
        message += `**Record:** ${fullName} (${recordId})\n\n`;
        message += `## Changes\n\n`;
        for (const change of changes) {
          message += `- ${change}\n`;
        }

        message += `\n## Next Steps\n\n`;
        message += `**Regenerate the mobile metadata cache** for changes to take effect on the iPad app.\n`;
        message += `Use \`generate_mobile_metadata_cache\` with the relevant profile names.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Update DB Schema Record\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Toggle DB Schema Record
  server.tool(
    "toggle_db_schema",
    "Enable or disable a DB Schema record (sets IsActive). Simple shortcut for the most common operation. Accepts short name (e.g., 'Visit') or full name ('DbSchema_Visit').",
    {
      name: z.string().describe("The DB Schema record name — accepts 'Visit' or 'DbSchema_Visit'"),
      active: z.boolean().describe("Set to true to enable, false to disable"),
      targetOrg: z.string().optional().describe("Optional: specific org to update"),
    },
    async ({ name, active, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot toggle DB Schema record: ${validation.error}` }],
        };
      }

      try {
        const fullName = normalizeDbSchemaName(name);

        // Find the record
        const recordQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive FROM LifeSciConfigRecord WHERE DeveloperName = '${fullName}' LIMIT 1`;
        const recordResult = await runToolingQuery(recordQuery, effectiveOrg);

        if (!recordResult.success || !recordResult.data?.records?.length) {
          return {
            content: [
              {
                type: "text",
                text: `# DB Schema Record Not Found\n\nNo record named "${fullName}". Use \`list_db_schema\` to see all available records.`,
              },
            ],
          };
        }

        const record = recordResult.data.records[0] as Record<string, unknown>;
        const recordId = record.Id as string;
        const wasActive = record.IsActive as boolean;

        if (wasActive === active) {
          return {
            content: [
              {
                type: "text",
                text: `# No Change Needed\n\n\`${fullName}\` is already ${active ? "active" : "inactive"}.`,
              },
            ],
          };
        }

        const updateResult = await updateToolingRecord(
          "LifeSciConfigRecord",
          recordId,
          { IsActive: active },
          effectiveOrg
        );

        if (!updateResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Toggle DB Schema Record\n\n${updateResult.error}`,
              },
            ],
          };
        }

        let message = `# DB Schema Record ${active ? "Enabled" : "Disabled"}\n\n`;
        message += `**Record:** ${fullName}\n`;
        message += `**Status:** ${wasActive ? "Active" : "Inactive"} → ${active ? "Active" : "Inactive"}\n`;
        if (!active) {
          message += `\n## ⚠️ Destructive to Local Mobile Data\n\n`;
          message += `Disabling a DB Schema record is **not** just a visibility toggle. On each device's next sync, the mobile app runs \`DELETE FROM <table>\` for any object that is no longer in the metadata — so **all locally cached records for \`${record.MasterLabel ?? fullName}\` on the iPad are wiped**. Any unsynced offline edits to that object are lost. Re-enabling later re-syncs from the server, but local-only/unsynced data does not come back. Only disable when you intend to remove the object from mobile entirely.\n`;
        }
        message += `\n## Next Steps\n\n`;
        message += `**Regenerate the mobile metadata cache** for changes to take effect on the iPad app.\n`;
        message += `Use \`generate_mobile_metadata_cache\` with the relevant profile names.`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Toggle DB Schema Record\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ============================================================================
  // NAVIGATION TAB TOOLS
  // ============================================================================
}
