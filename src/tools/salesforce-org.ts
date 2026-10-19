import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import {
  isSfCliInstalled,
  installSfCli,
  listOrgs,
  runSoqlQuery,
  describeSObject,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  getLoginCommand,
  generateMobileMetadataCache,
  openOrg,
} from "../salesforce/cli.js";
import {
  checkSetupStatus,
  invalidateSetupStatus,
  primeSetupStatus,
  getSetupInstructions,
  formatOrgList,
  validateOrgConnection,
  setTargetOrg,
  getTargetOrg,
} from "../salesforce/auth.js";

export function register(server: McpServer) {
  server.tool(
    "check_lsc_setup",
    "Check if Salesforce CLI is installed and orgs are authenticated. Run this first to ensure everything is set up correctly.",
    {},
    async () => {
      const status = await checkSetupStatus({ fresh: true });

      let message = "# LSC Plugin Setup Status\n\n";

      // CLI Status
      message += `## Salesforce CLI\n`;
      message += `- **Installed:** ${status.cliInstalled ? "Yes ✓" : "No ✗"}\n`;
      if (status.cliVersion) {
        message += `- **Version:** ${status.cliVersion}\n`;
      }
      message += "\n";

      // Org Status
      message += `## Authenticated Orgs\n`;
      if (status.hasAuthenticatedOrgs) {
        message += formatOrgList(status.orgs);
        message += "\n\n";
        if (getTargetOrg()) {
          message += `**Current Target Org:** ${getTargetOrg()}\n`;
        } else if (status.defaultOrg) {
          message += `**Default Org:** ${status.defaultOrg.alias || status.defaultOrg.username}\n`;
        }
      } else {
        message += "No authenticated orgs found.\n";
      }
      message += "\n";

      // Next Steps
      if (status.nextStep && status.nextStep !== "ready") {
        const instructions = getSetupInstructions(status.nextStep);
        message += `## Next Step: ${instructions.title}\n\n`;
        message += `${instructions.description}\n\n`;
        if (instructions.command) {
          message += `\`\`\`bash\n${instructions.command}\n\`\`\`\n\n`;
        }
        if (instructions.options) {
          message += instructions.options.map((opt) => `- ${opt}`).join("\n");
        }
      } else {
        message += `## Status: Ready ✓\n\nYou can now use LSC tools to query and modify your Salesforce org.\n`;
      }

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Install Salesforce CLI
  server.tool(
    "install_sf_cli",
    "Install the Salesforce CLI via npm. Only run this if the CLI is not already installed.",
    {},
    async () => {
      // Check if already installed
      const isInstalled = await isSfCliInstalled();
      if (isInstalled) {
        return {
          content: [
            {
              type: "text",
              text: "Salesforce CLI is already installed. No action needed.",
            },
          ],
        };
      }

      const result = await installSfCli();

      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Salesforce CLI Installed Successfully ✓\n\n${result.data}\n\nNext step: Authenticate to your org using:\n\`\`\`bash\n${getLoginCommand("my-lsc-org")}\n\`\`\``,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `# Installation Failed\n\n${result.error}\n\n## Manual Installation Options\n\n1. **npm (requires admin/sudo):**\n   \`\`\`bash\n   sudo npm install -g @salesforce/cli\n   \`\`\`\n\n2. **Download installer:**\n   https://developer.salesforce.com/tools/salesforcecli`,
            },
          ],
        };
      }
    }
  );

  // Tool: List Authenticated Orgs
  server.tool("list_sf_orgs", "List all authenticated Salesforce orgs", {}, async () => {
    const isInstalled = await isSfCliInstalled();
    if (!isInstalled) {
      return {
        content: [
          {
            type: "text",
            text: "Salesforce CLI is not installed. Run `check_lsc_setup` for installation instructions.",
          },
        ],
      };
    }

    invalidateSetupStatus();
    const result = await listOrgs();

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to list orgs: ${result.error}`,
          },
        ],
      };
    }

    const allOrgs = [...(result.data?.nonScratchOrgs || []), ...(result.data?.scratchOrgs || [])];

    if (allOrgs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `# No Authenticated Orgs\n\nAuthenticate to an org using:\n\`\`\`bash\n${getLoginCommand("my-lsc-org")}\n\`\`\`\n\nFor sandbox:\n\`\`\`bash\nsf org login web --alias my-sandbox --instance-url https://test.salesforce.com\n\`\`\``,
          },
        ],
      };
    }

    const currentTarget = getTargetOrg();
    let message = `# Authenticated Orgs\n\n${formatOrgList(allOrgs)}\n\n`;

    if (currentTarget) {
      message += `**Current Target:** ${currentTarget}\n\n`;
    }

    message += `Use \`set_target_org\` to select which org to work with.`;

    return {
      content: [{ type: "text", text: message }],
    };
  });

  // Tool: Set Target Org
  server.tool(
    "set_target_org",
    "Set the target Salesforce org for ALL subsequent operations in this session. Once set, the choice is remembered — do NOT ask the user again or call this tool again unless the user explicitly wants to switch orgs.",
    {
      org: z.string().describe("The org alias or username to use as the target for operations"),
    },
    async ({ org }) => {
      // Validate the org exists
      invalidateSetupStatus();
      const result = await listOrgs();

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to verify org: ${result.error}`,
            },
          ],
        };
      }

      const allOrgs = [...(result.data?.nonScratchOrgs || []), ...(result.data?.scratchOrgs || [])];

      const matchedOrg = allOrgs.find((o) => o.alias === org || o.username === org);

      if (!matchedOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Org '${org}' not found.\n\nAvailable orgs:\n${formatOrgList(allOrgs)}`,
            },
          ],
        };
      }

      setTargetOrg(org);
      primeSetupStatus(result.data);

      return {
        content: [
          {
            type: "text",
            text: `Target org set to: **${org}** (${matchedOrg.username})\n\nInstance: ${matchedOrg.instanceUrl}\n\nThis org is now remembered for the rest of this session. All subsequent tools will use it automatically — do NOT ask the user to select an org again.`,
          },
        ],
      };
    }
  );

  // Tool: Open Org in Browser
  server.tool(
    "open_org",
    "Open the target Salesforce org in the default browser. Optionally navigate to a specific page path.",
    {
      path: z
        .string()
        .optional()
        .describe(
          "Optional Salesforce page path to open (e.g., '/lightning/setup/SetupOneHome/home')"
        ),
    },
    async ({ path: pagePath }) => {
      const validation = await validateOrgConnection();

      const effectiveOrg = validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Open Org\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      const result = await openOrg(effectiveOrg, pagePath);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to open org: ${result.error}`,
            },
          ],
        };
      }

      const data = result.data!;
      let message = `Opened org in browser.\n\n**Org ID:** ${data.orgId}\n**Username:** ${data.username}\n**URL:** ${data.url}`;
      if (pagePath) {
        message += `\n**Page:** ${pagePath}`;
      }

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Run SOQL Query
  server.tool(
    "run_soql",
    "Execute a SOQL query against the target Salesforce org",
    {
      query: z.string().describe("The SOQL query to execute"),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to query. Uses current target org if not specified."),
    },
    async ({ query, targetOrg }) => {
      const validation = await validateOrgConnection();

      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Run Query\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      const result = await runSoqlQuery(query, effectiveOrg);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Query Failed\n\n**Error:** ${result.error}\n\n**Query:**\n\`\`\`sql\n${query}\n\`\`\``,
            },
          ],
        };
      }

      const data = result.data!;
      let message = `# Query Results\n\n`;
      message += `**Records returned:** ${data.totalSize}\n\n`;

      if (data.records.length === 0) {
        message += "No records found.";
      } else {
        // Format as markdown table if reasonable number of fields
        const records = data.records;
        const fields = Object.keys(records[0]).filter((f) => f !== "attributes");

        if (fields.length <= 8 && records.length <= 50) {
          // Table format
          message += `| ${fields.join(" | ")} |\n`;
          message += `| ${fields.map(() => "---").join(" | ")} |\n`;
          for (const record of records) {
            const values = fields.map((f) => {
              const val = record[f];
              if (val === null || val === undefined) return "";
              if (typeof val === "object") return JSON.stringify(val);
              return String(val);
            });
            message += `| ${values.join(" | ")} |\n`;
          }
        } else {
          // JSON format for complex results
          message += "```json\n";
          message += JSON.stringify(records, null, 2);
          message += "\n```";
        }
      }

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Describe SObject
  server.tool(
    "describe_sobject",
    "Get metadata about a Salesforce object (fields, types, etc.)",
    {
      objectName: z
        .string()
        .describe("The API name of the object (e.g., Account, Contact, Visit__c)"),
      targetOrg: z.string().optional().describe("Optional: specific org to query"),
    },
    async ({ objectName, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot describe object: ${validation.error}`,
            },
          ],
        };
      }

      const result = await describeSObject(objectName, effectiveOrg);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Describe ${objectName}\n\n${result.error}`,
            },
          ],
        };
      }

      const data = result.data!;
      let message = `# ${data.label} (${data.name})\n\n`;
      message += `## Fields (${data.fields.length})\n\n`;
      message += `| Field | Label | Type | Required | Updateable |\n`;
      message += `| --- | --- | --- | --- | --- |\n`;

      for (const field of data.fields.slice(0, 100)) {
        // Limit to 100 fields for readability
        message += `| ${field.name} | ${field.label} | ${field.type} | ${field.required ? "Yes" : "No"} | ${field.updateable ? "Yes" : "No"} |\n`;
      }

      if (data.fields.length > 100) {
        message += `\n*... and ${data.fields.length - 100} more fields*`;
      }

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Get Record
  server.tool(
    "get_record",
    "Retrieve a specific record by ID from Salesforce",
    {
      objectName: z.string().describe("The API name of the object"),
      recordId: z.string().describe("The 15 or 18 character record ID"),
      fields: z.array(z.string()).describe("List of field API names to retrieve"),
      targetOrg: z.string().optional(),
    },
    async ({ objectName, recordId, fields, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot get record: ${validation.error}`,
            },
          ],
        };
      }

      const result = await getRecord(objectName, recordId, fields, effectiveOrg);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Get Record\n\n${result.error}`,
            },
          ],
        };
      }

      let message = `# ${objectName} Record\n\n`;
      message += `**ID:** ${recordId}\n\n`;
      message += "| Field | Value |\n| --- | --- |\n";

      for (const [key, value] of Object.entries(result.data!)) {
        if (key !== "attributes") {
          message += `| ${key} | ${value ?? "(null)"} |\n`;
        }
      }

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Create Record
  server.tool(
    "create_record",
    "Create a new record in Salesforce",
    {
      objectName: z.string().describe("The API name of the object"),
      values: z
        .record(z.unknown())
        .describe("Field values as key-value pairs (e.g., {Name: 'Test'})"),
      targetOrg: z.string().optional(),
    },
    async ({ objectName, values, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot create record: ${validation.error}`,
            },
          ],
        };
      }

      const result = await createRecord(
        objectName,
        values as Record<string, unknown>,
        effectiveOrg
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Create ${objectName}\n\n${result.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `# Record Created Successfully ✓\n\n**Object:** ${objectName}\n**ID:** ${result.data!.id}\n\nUse \`get_record\` to retrieve the full record.`,
          },
        ],
      };
    }
  );

  // Tool: Update Record
  server.tool(
    "update_record",
    "Update an existing record in Salesforce",
    {
      objectName: z.string().describe("The API name of the object"),
      recordId: z.string().describe("The record ID to update"),
      values: z.record(z.unknown()).describe("Field values to update as key-value pairs"),
      targetOrg: z.string().optional(),
    },
    async ({ objectName, recordId, values, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot update record: ${validation.error}`,
            },
          ],
        };
      }

      const result = await updateRecord(
        objectName,
        recordId,
        values as Record<string, unknown>,
        effectiveOrg
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Update Record\n\n${result.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `# Record Updated Successfully ✓\n\n**Object:** ${objectName}\n**ID:** ${recordId}\n\n**Updated fields:**\n${Object.entries(
              values
            )
              .map(([k, v]) => `- ${k}: ${v}`)
              .join("\n")}`,
          },
        ],
      };
    }
  );

  // Tool: Delete Record
  server.tool(
    "delete_record",
    "Delete a record from Salesforce",
    {
      objectName: z.string().describe("The API name of the object"),
      recordId: z.string().describe("The record ID to delete"),
      targetOrg: z.string().optional(),
    },
    async ({ objectName, recordId, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot delete record: ${validation.error}`,
            },
          ],
        };
      }

      const result = await deleteRecord(objectName, recordId, effectiveOrg);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Delete Record\n\n${result.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `# Record Deleted Successfully ✓\n\n**Object:** ${objectName}\n**ID:** ${recordId}`,
          },
        ],
      };
    }
  );
  server.tool(
    "generate_mobile_metadata_cache",
    "Generate LSC Mobile metadata cache programmatically. IMPORTANT: Always ASK the user which profiles to generate the cache for before calling this tool. Do not guess profile names.",
    {
      profileNames: z
        .array(z.string())
        .describe(
          'Array of profile names to generate cache for. ASK THE USER which profiles to use. Examples: ["Field Sales Representative", "Medical Sales Representative", "Key Account Manager"]'
        ),
      apiVersion: z.string().optional().describe('Salesforce API version (default: "64.0")'),
      prefix: z.string().optional().describe('Namespace prefix (default: "lsc4ce")'),
      targetOrg: z.string().optional().describe("Optional: specific org to use"),
    },
    async ({ profileNames, apiVersion = "65.0", prefix = "lsc4ce", targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot generate metadata cache: ${validation.error}`,
            },
          ],
        };
      }

      let message = "# Mobile Metadata Cache Generation\n\n";

      try {
        // Step 1: Create parent LifeSciMobileMetadataRecord
        message += "## Step 1: Creating parent record...\n\n";

        const parentResult = await createRecord(
          "LifeSciMobileMetadataRecord",
          {
            IntegrationStatus: "New",
            Status: "New",
          },
          effectiveOrg
        );

        if (!parentResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Create Parent Record\n\n${parentResult.error}\n\n**Note:** Ensure the LifeSciMobileMetadataRecord object exists and you have create permissions.`,
              },
            ],
          };
        }

        const parentId = parentResult.data!.id;
        message += `Created parent record: \`${parentId}\`\n\n`;

        // Step 2: Get profile IDs
        message += "## Step 2: Looking up profiles...\n\n";

        const profileQuery = `SELECT Id, Name FROM Profile WHERE Name IN ('${profileNames.join("','")}')`;
        const profileResult = await runSoqlQuery(profileQuery, effectiveOrg);

        if (!profileResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Query Profiles\n\n${profileResult.error}`,
              },
            ],
          };
        }

        const profiles = profileResult.data!.records;
        if (profiles.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# No Profiles Found\n\nNone of the specified profiles exist: ${profileNames.join(", ")}\n\nRun this query to see available profiles:\n\`\`\`sql\nSELECT Id, Name FROM Profile ORDER BY Name\n\`\`\``,
              },
            ],
          };
        }

        message += `Found ${profiles.length} profile(s):\n`;
        for (const profile of profiles) {
          message += `- ${profile.Name}\n`;
        }
        message += "\n";

        // Step 3: Create child records for each profile
        message += "## Step 3: Creating child records...\n\n";

        const childIds: string[] = [];
        for (const profile of profiles) {
          const childResult = await createRecord(
            "LifeSciMobileMetadataRecord",
            {
              ParentMobileMetadataRecId: parentId,
              ProfileId: profile.Id as string,
              IntegrationStatus: "New",
              Status: "New",
            },
            effectiveOrg
          );

          if (!childResult.success) {
            message += `- **Failed** for ${profile.Name}: ${childResult.error}\n`;
          } else {
            childIds.push(childResult.data!.id);
            message += `- Created child for ${profile.Name}: \`${childResult.data!.id}\`\n`;
          }
        }
        message += "\n";

        if (childIds.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `${message}\n# Failed to Create Any Child Records\n\nNo child records were created. Check permissions and field values.`,
              },
            ],
          };
        }

        // Step 4a: Update parent record to ValidationCompleted
        message += "## Step 4: Updating statuses to ValidationCompleted...\n\n";

        const parentUpdateResult = await updateRecord(
          "LifeSciMobileMetadataRecord",
          parentId,
          { Status: "ValidationCompleted" },
          effectiveOrg
        );

        if (!parentUpdateResult.success) {
          message += `- **Failed** to update parent ${parentId}: ${parentUpdateResult.error}\n`;
        } else {
          message += `- Updated parent \`${parentId}\` to ValidationCompleted\n`;
        }

        // Step 4b: Update child records to ValidationCompleted (separate transaction)
        for (const childId of childIds) {
          const childUpdateResult = await updateRecord(
            "LifeSciMobileMetadataRecord",
            childId,
            { Status: "ValidationCompleted" },
            effectiveOrg
          );

          if (!childUpdateResult.success) {
            message += `- **Failed** to update child ${childId}: ${childUpdateResult.error}\n`;
          } else {
            message += `- Updated child \`${childId}\` to ValidationCompleted\n`;
          }
        }
        message += "\n";

        // Step 5: Call the Connect API to generate
        message += "## Step 5: Triggering metadata generation...\n\n";

        const generateResult = await generateMobileMetadataCache(
          parentId,
          apiVersion,
          prefix,
          effectiveOrg
        );

        if (!generateResult.success) {
          message += `**Warning:** API call returned an error: ${generateResult.error}\n\n`;
          message += `This may be normal - the generation runs asynchronously.\n\n`;
        } else {
          message += `Generation triggered successfully!\n\n`;
        }

        // Step 6: Poll until completion or failure
        message += "## Step 6: Waiting for generation to complete...\n\n";

        const maxAttempts = 30; // 30 attempts * 10s = 5 minutes max
        const pollIntervalMs = 10000; // 10 seconds
        let finalStatus = "Unknown";
        let finalIntegrationStatus = "Unknown";
        let errorMessage = "";
        let pollCompleted = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

          const statusQuery = `SELECT Id, Name, Status, IntegrationStatus, IntegrationErrorMessage FROM LifeSciMobileMetadataRecord WHERE Id = '${parentId}'`;
          const statusResult = await runSoqlQuery(statusQuery, effectiveOrg);

          if (!statusResult.success || !statusResult.data?.records?.length) {
            message += `Poll ${attempt}: Could not query status\n`;
            continue;
          }

          const statusRecord = statusResult.data.records[0] as Record<string, unknown>;
          finalStatus = (statusRecord.Status as string) || "Unknown";
          finalIntegrationStatus = (statusRecord.IntegrationStatus as string) || "Unknown";
          errorMessage = (statusRecord.IntegrationErrorMessage as string) || "";

          // Check for terminal states
          if (finalStatus === "Active" || finalStatus === "Published") {
            message += `Poll ${attempt}: Status = **${finalStatus}** - Cache generation completed successfully!\n\n`;
            pollCompleted = true;
            break;
          }

          if (finalStatus === "Error" || finalIntegrationStatus === "Error") {
            message += `Poll ${attempt}: Status = **${finalStatus}**, IntegrationStatus = **${finalIntegrationStatus}**\n\n`;
            message += `## Cache Generation FAILED\n\n`;
            message += `**Error:** ${errorMessage || "No error message provided"}\n\n`;
            pollCompleted = true;
            break;
          }

          // Still in progress
          if (attempt % 3 === 0) {
            message += `Poll ${attempt}: Status = ${finalStatus}, IntegrationStatus = ${finalIntegrationStatus} (still processing...)\n`;
          }
        }

        if (!pollCompleted) {
          message += `\n**Timed out** after ${maxAttempts} polling attempts. Current status: ${finalStatus} / ${finalIntegrationStatus}\n\n`;
          message += `You can check manually with:\n`;
          message += "```sql\n";
          message += `SELECT Id, Name, Status, IntegrationStatus, IntegrationErrorMessage\n`;
          message += `FROM LifeSciMobileMetadataRecord\n`;
          message += `WHERE Id = '${parentId}' OR ParentMobileMetadataRecId = '${parentId}'\n`;
          message += "```\n\n";
        }

        message += `---\n\n**Parent Record ID:** \`${parentId}\`\n`;
        message += `**Child Records:** ${childIds.length}\n`;
        message += `**Final Status:** ${finalStatus}\n`;
        message += `**API Version:** ${apiVersion}\n`;
        message += `**Prefix:** ${prefix}\n`;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Unexpected Error\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
