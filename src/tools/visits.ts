import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runToolingQuery, describeSObject, deployMetadata, listMetadata } from "../salesforce/cli.js";
import {
  MAX_SIDEBAR_RELATED_LISTS,
  countRelatedLists,
  hasRelatedList,
  insertRelatedList,
  layoutDeployPath,
  retrieveLayoutXml,
  writeLayoutXml,
} from "../salesforce/visit-layout.js";
import { validateOrgConnection } from "../salesforce/auth.js";

export function register(server: McpServer) {
  server.tool(
    "add_visit_engagement_sidebar_item",
    "Add a custom object as a related list on a Visit page layout so it appears in the visit engagement sidebar on mobile. Retrieves the layout XML, inserts the related list, and deploys it back. Maximum 10 related lists (8 OOB + 2 custom). If layoutName is omitted, lists available Visit layouts for the user to choose from.",
    {
      objectName: z
        .string()
        .describe(
          "API name of the custom object to add (e.g., MyCustomObject__c). Must have a lookup/master-detail relationship to Visit."
        ),
      layoutName: z
        .string()
        .optional()
        .describe(
          "Specific Visit page layout name (e.g., 'Visit-Visit Layout'). If omitted, lists available Visit layouts."
        ),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to use. Uses current target org if not specified."),
    },
    async ({ objectName, layoutName, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Modify Visit Layout\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      try {
        // If no layoutName provided, list available Visit layouts
        if (!layoutName) {
          const listResult = await listMetadata("Layout", effectiveOrg);

          if (!listResult.success || !listResult.data) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Failed to List Layouts\n\n${listResult.error || "No layout metadata returned."}`,
                },
              ],
            };
          }

          const visitLayouts = listResult.data.filter((l) => l.fullName.startsWith("Visit-"));

          if (visitLayouts.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "# No Visit Page Layouts Found\n\nNo layouts matching `Visit-*` were found in the org. Create a Visit page layout in Setup > Object Manager > Visit > Page Layouts first.",
                },
              ],
            };
          }

          let message = "# Available Visit Page Layouts\n\n";
          message +=
            "Select a layout and call this tool again with the `layoutName` parameter.\n\n";
          for (const layout of visitLayouts) {
            message += `- \`${layout.fullName}\`\n`;
          }
          message += `\n**Object to add:** \`${objectName}\`\n`;

          return {
            content: [{ type: "text", text: message }],
          };
        }

        // Ensure layoutName has the "Visit-" prefix
        const fullLayoutName = layoutName.startsWith("Visit-") ? layoutName : `Visit-${layoutName}`;

        // Look up the child relationship name for objectName on Visit
        const describeResult = await describeSObject("Visit", effectiveOrg);
        if (!describeResult.success || !describeResult.data) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Describe Visit Object\n\n${describeResult.error || "No describe data returned."}`,
              },
            ],
          };
        }

        const childRels = describeResult.data.childRelationships || [];
        const matchingRel = childRels.find(
          (rel) =>
            rel.childSObject.toLowerCase() === objectName.toLowerCase() &&
            rel.relationshipName !== null
        );

        if (!matchingRel) {
          // List available child relationships to help the user
          const availableRels = childRels
            .filter((rel) => rel.relationshipName !== null)
            .map((rel) => `- \`${rel.childSObject}\` (relationship: \`${rel.relationshipName}\`)`)
            .slice(0, 30)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `# No Relationship Found\n\n\`${objectName}\` does not have a named child relationship to the Visit object. The object must have a lookup or master-detail field pointing to Visit.\n\n## Available Child Relationships on Visit\n\n${availableRels}\n\n${childRels.filter((r) => r.relationshipName !== null).length > 30 ? `*... and ${childRels.filter((r) => r.relationshipName !== null).length - 30} more*` : ""}`,
              },
            ],
          };
        }

        const relationshipName = matchingRel.relationshipName!;

        try {
          // Retrieve the layout — retrieveMetadata handles the tmp SFDX project internally
          const layout = await retrieveLayoutXml(fullLayoutName, effectiveOrg);

          if (!layout.ok && layout.reason === "retrieve") {
            return {
              content: [
                {
                  type: "text",
                  text: `# Failed to Retrieve Layout\n\nCould not retrieve \`${fullLayoutName}\`: ${layout.error}\n\nMake sure the layout name is correct. Use this tool without \`layoutName\` to list available layouts.`,
                },
              ],
            };
          }

          if (!layout.ok && layout.reason === "noDir") {
            return {
              content: [
                {
                  type: "text",
                  text: `# Layout Not Found\n\nThe retrieve succeeded but no layout file was found at the expected path. The layout \`${fullLayoutName}\` may not exist in the org.`,
                },
              ],
            };
          }

          if (!layout.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Layout File Not Found\n\nNo .layout-meta.xml files found after retrieve. The layout \`${fullLayoutName}\` may not exist.`,
                },
              ],
            };
          }

          // Check if the object is already present as a related list
          if (hasRelatedList(layout.xml, relationshipName)) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Already Present\n\n\`${objectName}\` (relationship: \`${relationshipName}\`) is already a related list on the \`${fullLayoutName}\` layout. No changes needed.`,
                },
              ],
            };
          }

          // Count existing related lists
          const existingRelatedLists = countRelatedLists(layout.xml);
          if (existingRelatedLists >= MAX_SIDEBAR_RELATED_LISTS) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Related List Limit Reached\n\nThe \`${fullLayoutName}\` layout already has **${existingRelatedLists} related lists** (maximum is 10 for the visit engagement sidebar: 8 OOB + 2 custom).\n\nRemove an existing related list before adding a new one.`,
                },
              ],
            };
          }

          // Insert the new related list block before </Layout>
          writeLayoutXml(layout, insertRelatedList(layout.xml, relationshipName));

          // Deploy the modified layout back
          const deployResult = await deployMetadata(layoutDeployPath(layout), effectiveOrg);

          if (!deployResult.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Deploy Failed\n\nThe layout was modified but deployment failed:\n\n${deployResult.error}\n\nYou may need to check the layout manually in Setup.`,
                },
              ],
            };
          }

          // Check if a DB Schema record exists for the object (needed for mobile sync)
          let dbSchemaNote = "";
          try {
            const dbSchemaQuery = `SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord WHERE DeveloperName = 'DbSchema_${objectName}' LIMIT 1`;
            const dbSchemaResult = await runToolingQuery(dbSchemaQuery, effectiveOrg);
            const dbSchemaRecords = dbSchemaResult.success
              ? dbSchemaResult.data?.records
              : undefined;
            if (dbSchemaRecords && dbSchemaRecords.length > 0) {
              const rec = dbSchemaRecords[0] as Record<string, unknown>;
              if (rec.IsActive) {
                dbSchemaNote = `\n4. **DB Schema** — ✅ A DB Schema record for \`${objectName}\` exists and is active. Data will sync to mobile.`;
              } else {
                dbSchemaNote = `\n\n> **⚠️ DB Schema record exists but is INACTIVE for \`${objectName}\`.** The sidebar item will appear but data won't sync to mobile. Run \`toggle_db_schema\` with DeveloperName \`DbSchema_${objectName}\` to activate it.`;
              }
            } else {
              dbSchemaNote = `\n\n> **⚠️ No DB Schema record found for \`${objectName}\`.** Without a DB Schema record, this object's data won't sync to mobile and the sidebar item will show no data. Run \`create_db_schema\` to create one.`;
            }
          } catch {
            // Non-fatal — don't block success if DB Schema check fails
          }

          return {
            content: [
              {
                type: "text",
                text: `# Successfully Added Related List\n\n**Object:** \`${objectName}\`\n**Relationship:** \`${relationshipName}\`\n**Layout:** \`${fullLayoutName}\`\n**Related lists on layout:** ${existingRelatedLists + 1} of 10\n\n## Next Steps\n\n1. **Regenerate mobile metadata cache** — Run \`generate_mobile_metadata_cache\` for profiles that use this layout\n2. **Verify on mobile** — The new sidebar item should appear after cache regeneration and sync\n3. **Verify in Setup** — Check Setup > Object Manager > Visit > Page Layouts > ${fullLayoutName} to confirm the related list appears${dbSchemaNote}\n\n> **If the related list still doesn't appear on mobile after cache regeneration** and the target object (\`${objectName}\`) has **no record types**, this was a known metadata-service bug where related lists (including the Files related list) were silently dropped from the generated cache for record-type-less objects. It is fixed in newer package versions — check the LSC package version and upgrade rather than re-editing the layout.`,
              },
            ],
          };
        } finally {
          // Temp project dir is session-scoped and managed by ensureTmpSfdxProject()
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Add Sidebar Item\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ============================================================================
  // SAMPLE MANAGEMENT TOOLS
  // ============================================================================
}
