import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import {
  runSoqlQuery,
  uploadContentVersion,
  createBulkPresentation,
  apiRequest,
  createRecord,
  dataPath,
} from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import {
  checkLibreOfficeInstalled,
  checkGhostscriptInstalled,
  checkPandocInstalled,
  detectFormat,
  preparePresentation,
} from "../presentation-converter.js";
import type { ConversionEngine } from "../presentation-converter.js";

export function register(server: McpServer) {
  server.tool(
    "upload_presentation",
    "Upload a presentation to LSC Intelligent Content. Supports three formats: (1) .pptx — converts to HTML5 per-slide ZIPs using LibreOffice (default, preserves layout with SVG/images) or Pandoc reveal.js (semantic HTML with transitions), (2) .pdf — uploads directly (Salesforce handles page splitting), (3) .zip file(s) or directory of ZIPs — validates HTML structure and uploads each as a page. Creates the presentation via the Bulk Presentation Connect API.",
    {
      filePath: z
        .union([z.string(), z.array(z.string())])
        .describe(
          "Path(s) to file(s): single .pptx, single .pdf, .zip file(s), or a directory containing .zip files"
        ),
      presentationName: z.string().describe("Display name for the presentation in LSC"),
      presentationId: z.string().optional().describe("External system ID (e.g., Veeva Vault ID)"),
      activationDate: z
        .string()
        .optional()
        .describe("ISO 8601 activation date (e.g., '2025-03-01')"),
      deactivationDate: z.string().optional().describe("ISO 8601 deactivation date"),
      playerGesture: z
        .enum(["TAPTOP", "TAPBOTTOM", "SWIPEUP", "SWIPEDOWN"])
        .optional()
        .describe("Gesture to open the menu player"),
      enableDoubleTapZoom: z.boolean().optional().describe("Enable double-tap zoom in player"),
      enablePinchZoom: z.boolean().optional().describe("Enable pinch-to-zoom in player"),
      topics: z
        .array(z.string())
        .optional()
        .describe("Array of Topic IDs for Content Library categorization"),
      sendByEmail: z.boolean().optional().describe("Allow reps to email this presentation"),
      conversionEngine: z
        .enum(["libreoffice", "pandoc"])
        .optional()
        .default("libreoffice")
        .describe(
          "PPTX conversion engine: 'libreoffice' (default) produces SVG-based HTML5 with pixel-perfect visual fidelity (fonts, colors, backgrounds); 'pandoc' produces semantic HTML5 (loses visual styling). Only applies to .pptx files."
        ),
      targetOrg: z.string().optional().describe("Optional: specific org to upload to"),
    },
    async ({
      filePath,
      presentationName,
      presentationId,
      activationDate,
      deactivationDate,
      playerGesture,
      enableDoubleTapZoom,
      enablePinchZoom,
      topics,
      sendByEmail,
      conversionEngine,
      targetOrg,
    }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [{ type: "text", text: `Cannot upload presentation: ${validation.error}` }],
        };
      }

      // Step 1: Normalize filePath to array and detect format
      const filePaths = Array.isArray(filePath) ? filePath : [filePath];

      let formatResult;
      try {
        formatResult = detectFormat(filePaths);
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Format Detection Failed\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }

      const { format, paths: resolvedPaths } = formatResult;

      // Step 2: Dependency checks
      const engine: ConversionEngine = conversionEngine || "libreoffice";

      if (format === "pptx") {
        // LibreOffice is always needed (for SVG export and thumbnail generation)
        const loInstalled = await checkLibreOfficeInstalled();
        if (!loInstalled) {
          return {
            content: [
              {
                type: "text",
                text: `# LibreOffice Required\n\nLibreOffice is needed to convert PPTX files to HTML5 slides with SVG.\n\n**Install it with:**\n\`\`\`bash\nbrew install --cask libreoffice\n\`\`\`\n\nAfter installation, run this tool again.`,
              },
            ],
          };
        }

        // Pandoc only needed when that engine is selected
        if (engine === "pandoc") {
          const pandocInstalled = await checkPandocInstalled();
          if (!pandocInstalled) {
            return {
              content: [
                {
                  type: "text",
                  text: `# Pandoc Required\n\nPandoc is needed for the HTML5 semantic conversion engine.\n\n**Install it with:**\n\`\`\`bash\nbrew install pandoc\n\`\`\`\n\nAlternatively, use the default LibreOffice SVG engine by omitting the \`conversionEngine\` parameter.`,
                },
              ],
            };
          }
        }
      }

      // Step 3: Prepare pages (format-specific pipeline)
      let message = `# Uploading Presentation: ${presentationName}\n\n`;
      message += `**Format:** ${format.toUpperCase()}\n`;
      message += `**Source:** ${resolvedPaths.length === 1 ? resolvedPaths[0] : `${resolvedPaths.length} files`}\n\n`;

      // Ghostscript warning for PDF (non-blocking — falls back to original PDF)
      if (format === "pdf") {
        const gsInstalled = await checkGhostscriptInstalled();
        if (!gsInstalled) {
          message += `> **Note:** Ghostscript not found. PDF will be uploaded without rasterization.\n`;
          message += `> The LSC iPad player requires image-based PDFs. If the presentation doesn't render\n`;
          message += `> on iPad, install Ghostscript: \`brew install ghostscript\`\n\n`;
        }
      }

      const formatLabels: Record<string, string> = {
        pptx: `Converting PPTX to HTML5 slides (${engine} engine)`,
        pdf: "Rasterizing PDF for iPad compatibility",
        "html-zip": "Validating HTML ZIP files",
      };
      message += `## Step 1: ${formatLabels[format]}...\n\n`;
      if (format === "pptx") {
        message += `**Engine:** ${engine === "pandoc" ? "Pandoc reveal.js" : "LibreOffice Impress HTML Export"}\n\n`;
      }

      const prepResult = await preparePresentation(resolvedPaths, format, presentationName, engine);

      if (!prepResult.success) {
        let failMsg = message + `**Preparation failed:** ${prepResult.error}`;
        if (prepResult.diagnostics) {
          failMsg += `\n\n### Conversion Diagnostics\n\`\`\`\n${prepResult.diagnostics}\n\`\`\``;
        }
        return {
          content: [{ type: "text", text: failMsg }],
        };
      }

      message += `Prepared ${prepResult.pages.length} page(s) for upload.\n\n`;

      if (prepResult.diagnostics) {
        message += `<details><summary>Conversion diagnostics</summary>\n\n\`\`\`\n${prepResult.diagnostics}\n\`\`\`\n\n</details>\n\n`;
      }

      // Step 4: Upload each page as ContentVersion
      message += `## Step 2: Uploading to Salesforce...\n\n`;

      const uploadedPages: Array<{
        pageNumber: number;
        contentDocumentId: string;
        name: string;
      }> = [];
      const uploadErrors: string[] = [];

      for (const page of prepResult.pages) {
        const title =
          prepResult.pages.length === 1
            ? `${presentationName}.${page.contentType === "application/pdf" ? "pdf" : "zip"}`
            : `${presentationName} - ${page.name}.${page.contentType === "application/pdf" ? "pdf" : "zip"}`;

        const uploadResult = await uploadContentVersion(
          page.filePath,
          title,
          effectiveOrg,
          page.contentType
        );

        if (uploadResult.success && uploadResult.data) {
          uploadedPages.push({
            pageNumber: page.pageNumber,
            contentDocumentId: uploadResult.data.contentDocumentId,
            name: page.name,
          });
          message += `- Page ${page.pageNumber} (${page.name}): uploaded (ContentVersion: ${uploadResult.data.id})\n`;
        } else {
          uploadErrors.push(`Page ${page.pageNumber}: ${uploadResult.error}`);
          message += `- Page ${page.pageNumber} (${page.name}): **FAILED** — ${uploadResult.error}\n`;
        }
      }

      message += "\n";

      if (uploadErrors.length > 0 && uploadedPages.length === 0) {
        message += `## Upload Failed\n\nAll page uploads failed. Check org authentication and file permissions.\n`;
        return { content: [{ type: "text", text: message }] };
      }

      if (uploadErrors.length > 0) {
        message += `**Warning:** ${uploadErrors.length} page(s) failed to upload. The presentation will be created with ${uploadedPages.length} page(s).\n\n`;
      }

      // Step 5: Create presentation via Bulk Presentation Connect API
      message += `## Step 3: Creating presentation record...\n\n`;

      // Map format to Bulk Presentation API contentType
      const contentTypeMap: Record<
        string,
        "PRESENTATION_ZIP" | "PRESENTATION_PDF" | "PRESENTATION_PAGE"
      > = {
        pptx: "PRESENTATION_ZIP",
        pdf: "PRESENTATION_PDF",
        "html-zip": "PRESENTATION_ZIP",
      };

      const bulkResult = await createBulkPresentation(
        {
          contentType: contentTypeMap[format],
          name: presentationName,
          presentationId,
          activationDate,
          deactivationDate,
          playerGesture,
          enableDoubleTapZoom,
          enablePinchZoom,
          topics,
          sendByEmail,
          pages: uploadedPages.map((p) => ({
            contentDocumentId: p.contentDocumentId,
            name: p.name,
            pageOrder: p.pageNumber,
          })),
        },
        effectiveOrg
      );

      if (!bulkResult.success) {
        message += `**Presentation creation failed:** ${bulkResult.error}\n\n`;
        if (bulkResult.rawOutput) {
          message += `**Raw API response:**\n\`\`\`json\n${bulkResult.rawOutput}\n\`\`\`\n\n`;
        }
        message += `The ${uploadedPages.length} file(s) were uploaded successfully as ContentVersion records. You can create the presentation manually in Admin Console > Intelligent Content > Presentations.\n`;
        return { content: [{ type: "text", text: message }] };
      }

      const presData = bulkResult.data as Record<string, unknown> | undefined;
      const jobId = presData?.jobId || "unknown";
      const isSuccess = presData?.isSuccess;

      if (isSuccess === false) {
        const apiMessage = presData?.message || "Unknown error";
        const errors = (presData?.errors as string[]) || [];
        message += `**Presentation creation failed:** ${apiMessage}\n`;
        if (errors.length > 0) {
          message += `\n**Errors:**\n`;
          for (const err of errors) {
            message += `- ${err}\n`;
          }
        }
        message += `\nThe ${uploadedPages.length} file(s) were uploaded successfully as ContentVersion records. You can create the presentation manually in Admin Console > Intelligent Content > Presentations.\n`;
        return { content: [{ type: "text", text: message }] };
      }

      message += `Presentation job submitted successfully!\n\n`;
      message += `| Field | Value |\n`;
      message += `|-------|-------|\n`;
      message += `| Job ID | ${jobId} |\n`;
      message += `| Name | ${presentationName} |\n`;
      message += `| Format | ${format.toUpperCase()} |\n`;
      message += `| Content Type | ${contentTypeMap[format]} |\n`;
      message += `| Pages | ${uploadedPages.length} |\n`;
      if (presentationId) message += `| External ID | ${presentationId} |\n`;
      if (activationDate) message += `| Activation Date | ${activationDate} |\n`;
      if (deactivationDate) message += `| Deactivation Date | ${deactivationDate} |\n`;
      message += "\n";

      message += `## Next Steps\n\n`;
      message += `1. **Distribute to territories:** Use \`distribute_presentation\` with the presentation ID above, or go to Admin Console > Intelligent Content > Presentations > Distribution\n`;
      message += `2. **Activate:** The presentation is created as inactive. Set \`Status\` to \`Active\` using \`update_record\` when ready for reps. (Note: the field is \`Status\`, NOT \`IsActive\`.)\n`;
      message += `3. **Assign products/messages:** Edit the presentation to assign products to pages.\n`;
      message += `4. **Regenerate mobile cache:** Use \`generate_mobile_metadata_cache\` for affected profiles.\n`;

      // Clean up temp files (only needed for PPTX which creates a temp dir)
      if (prepResult.outputDir) {
        try {
          const fs = await import("fs");
          fs.rmSync(prepResult.outputDir, { recursive: true, force: true });
        } catch {
          // Temp cleanup failure is not critical
        }
      }

      return { content: [{ type: "text", text: message }] };
    }
  );

  // Tool: Distribute Presentation to Territories
  server.tool(
    "distribute_presentation",
    "Distribute a presentation to territories. Creates PresentationShare records with territory Group IDs. When includeChildren is true (default), uses TerritoryAndSubordinates groups so child territories automatically get access.",
    {
      presentationId: z
        .string()
        .optional()
        .describe("Presentation record ID (18-char). Provide this OR presentationName."),
      presentationName: z
        .string()
        .optional()
        .describe("Presentation name to look up. Provide this OR presentationId."),
      territoryIds: z
        .array(z.string())
        .describe(
          "Territory2 IDs to distribute to. Children are included automatically when includeChildren is true."
        ),
      includeChildren: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "When true (default), shares with TerritoryAndSubordinates group so all child territories get access. When false, shares with the exact Territory group only."
        ),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to use. Uses current target org if not specified."),
    },
    async ({ presentationId, presentationName, territoryIds, includeChildren, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Distribute Presentation\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      // Validate inputs
      if (!presentationId && !presentationName) {
        return {
          content: [
            {
              type: "text",
              text: "# Error\n\nProvide either `presentationId` or `presentationName`.",
            },
          ],
        };
      }

      if (!territoryIds || territoryIds.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "# Error\n\nProvide at least one territory ID in `territoryIds`.",
            },
          ],
        };
      }

      let message = `# Distribute Presentation to Territories\n\n`;

      // Step 1: Resolve presentation ID
      let resolvedPresentationId = presentationId;
      let resolvedPresentationName = presentationName || "";

      if (!resolvedPresentationId && presentationName) {
        const nameEscaped = presentationName.replace(/'/g, "\\'");
        const lookupResult = await runSoqlQuery(
          `SELECT Id, Name FROM Presentation WHERE Name = '${nameEscaped}' LIMIT 1`,
          effectiveOrg
        );

        if (!lookupResult.success || !lookupResult.data || lookupResult.data.records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Presentation Not Found\n\nNo presentation found with name "${presentationName}".\n\nUse \`run_soql\` to search: \`SELECT Id, Name FROM Presentation ORDER BY Name\``,
              },
            ],
          };
        }

        resolvedPresentationId = lookupResult.data.records[0].Id as string;
        resolvedPresentationName = lookupResult.data.records[0].Name as string;
        message += `Resolved presentation: **${resolvedPresentationName}** (${resolvedPresentationId})\n\n`;
      }

      // Step 2: Look up territory Group IDs for the requested territories
      // When includeChildren=true, use TerritoryAndSubordinates groups (cascades to children)
      // When includeChildren=false, use Territory groups (exact territory only)
      const groupType = includeChildren ? "TerritoryAndSubordinates" : "Territory";

      const territoryIdList = territoryIds.map((tid) => `'${tid}'`).join(",");

      const groupResult = await runSoqlQuery(
        `SELECT Id, RelatedId, DeveloperName, Type FROM Group WHERE Type = '${groupType}' AND RelatedId IN (${territoryIdList})`,
        effectiveOrg
      );

      if (!groupResult.success || !groupResult.data) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Look Up Territory Groups\n\n**Error:** ${groupResult.error}\n\nEnsure the territory IDs are valid Territory2 record IDs.`,
            },
          ],
        };
      }

      const groups = groupResult.data.records as Array<{
        Id: string;
        RelatedId: string;
        DeveloperName: string;
        Type: string;
      }>;

      // Also look up territory names for display
      const terrNameResult = await runSoqlQuery(
        `SELECT Id, Name FROM Territory2 WHERE Id IN (${territoryIdList})`,
        effectiveOrg
      );
      const nameMap = new Map<string, string>();
      if (terrNameResult.success && terrNameResult.data) {
        for (const rec of terrNameResult.data.records) {
          nameMap.set(rec.Id as string, rec.Name as string);
        }
      }

      // Map territory IDs to group IDs
      const territoryToGroup = new Map<string, string>();
      for (const g of groups) {
        territoryToGroup.set(g.RelatedId, g.Id);
      }

      const unknownIds = territoryIds.filter((tid) => !territoryToGroup.has(tid));

      if (unknownIds.length > 0) {
        message += `**Warning:** No ${groupType} group found for ${unknownIds.length} territory ID(s): ${unknownIds.map((tid) => nameMap.get(tid) || tid).join(", ")}\n\n`;
      }

      if (territoryToGroup.size === 0) {
        return {
          content: [
            {
              type: "text",
              text: `${message}# No Valid Territory Groups\n\nNo ${groupType} groups found for any of the provided territory IDs.`,
            },
          ],
        };
      }

      message += `Found **${territoryToGroup.size}** territory group(s) (type: ${groupType}).\n\n`;

      // Step 3: Check existing PresentationShare records to skip duplicates
      const existingShareResult = await runSoqlQuery(
        `SELECT UserOrGroupId FROM PresentationShare WHERE ParentId = '${resolvedPresentationId}' AND RowCause IN ('Manual', 'LSC4CEAutoShare')`,
        effectiveOrg
      );

      const existingGroupIds = new Set<string>();
      if (existingShareResult.success && existingShareResult.data) {
        for (const rec of existingShareResult.data.records) {
          existingGroupIds.add(rec.UserOrGroupId as string);
        }
      }

      const toCreate: Array<{ territoryId: string; groupId: string }> = [];
      for (const [terrId, groupId] of territoryToGroup) {
        if (!existingGroupIds.has(groupId)) {
          toCreate.push({ territoryId: terrId, groupId });
        }
      }
      const skipped = territoryToGroup.size - toCreate.length;

      if (skipped > 0) {
        message += `Skipping **${skipped}** territory/territories already distributed.\n\n`;
      }

      if (toCreate.length === 0) {
        message += `## Already Distributed\n\nAll ${territoryToGroup.size} territories already have share records. No changes made.\n`;
        return { content: [{ type: "text", text: message }] };
      }

      // Step 4: Query PresentationPage IDs for page-level sharing
      const pageResult = await runSoqlQuery(
        `SELECT Id FROM PresentationPage WHERE Id IN (SELECT PresentationPageId FROM PresentationLinkedPage WHERE PresentationId = '${resolvedPresentationId}')`,
        effectiveOrg
      );

      const pageIds: string[] = [];
      if (pageResult.success && pageResult.data) {
        for (const rec of pageResult.data.records) {
          pageIds.push(rec.Id as string);
        }
      }

      // Step 5: Create PresentationShare + PresentationPageShare records
      message += `## Creating ${toCreate.length} Distribution Record(s)...\n\n`;
      if (pageIds.length > 0) {
        message += `Found **${pageIds.length}** page(s) — will also create page-level sharing.\n\n`;
      }

      let created = 0;
      let pageSharesCreated = 0;
      const errors: string[] = [];

      for (const entry of toCreate) {
        // Create Presentation-level share
        const result = await apiRequest(
          await dataPath(effectiveOrg, "/sobjects/PresentationShare"),
          "POST",
          {
            ParentId: resolvedPresentationId,
            UserOrGroupId: entry.groupId,
            AccessLevel: "Edit",
            RowCause: "LSC4CEAutoShare",
          },
          effectiveOrg
        );

        if (result.success) {
          created++;
        } else {
          errors.push(
            `PresentationShare ${nameMap.get(entry.territoryId) || entry.territoryId}: ${result.error}`
          );
        }

        // Create page-level shares for each PresentationPage
        for (const pageId of pageIds) {
          const pageShareResult = await apiRequest(
            await dataPath(effectiveOrg, "/sobjects/PresentationPageShare"),
            "POST",
            {
              ParentId: pageId,
              UserOrGroupId: entry.groupId,
              AccessLevel: "Edit",
              RowCause: "LSC4CEAutoShare",
            },
            effectiveOrg
          );

          if (pageShareResult.success) {
            pageSharesCreated++;
          } else {
            errors.push(
              `PresentationPageShare (page ${pageId}) ${nameMap.get(entry.territoryId) || entry.territoryId}: ${pageShareResult.error}`
            );
          }
        }
      }

      // Summary
      message += `## Summary\n\n`;
      message += `| Metric | Count |\n`;
      message += `|--------|-------|\n`;
      message += `| Presentation shares created | ${created} |\n`;
      message += `| Page shares created | ${pageSharesCreated} |\n`;
      message += `| Skipped (already distributed) | ${skipped} |\n`;
      message += `| Errors | ${errors.length} |\n`;
      message += `| Total territories | ${territoryToGroup.size} |\n`;
      message += "\n";

      if (errors.length > 0) {
        message += `### Errors\n\n`;
        for (const err of errors) {
          message += `- ${err}\n`;
        }
        message += "\n";
      }

      if (created > 0) {
        message += `## Next Steps\n\n`;
        message += `1. **Activate** the presentation if not already active.\n`;
        message += `2. **Regenerate mobile cache** for affected profiles: \`generate_mobile_metadata_cache\`\n`;
      }

      return { content: [{ type: "text", text: message }] };
    }
  );

  // ----------------------------------------------------------------------------
  // Tool: assign_presentation_content
  // Assign topics to a presentation and/or products to its pages
  // ----------------------------------------------------------------------------
  server.tool(
    "assign_presentation_content",
    "Assign topics to a presentation and/or products to its pages. Creates TopicAssignment and PresentationPageProduct records. Skips duplicates automatically.",
    {
      presentationId: z
        .string()
        .optional()
        .describe("Presentation record ID (18-char). Provide this OR presentationName."),
      presentationName: z
        .string()
        .optional()
        .describe("Presentation name to look up. Provide this OR presentationId."),
      topicIds: z
        .array(z.string())
        .optional()
        .describe("Array of Topic record IDs to assign to the presentation."),
      topicNames: z
        .array(z.string())
        .optional()
        .describe("Array of Topic names to look up and assign to the presentation."),
      products: z
        .array(
          z.object({
            pageNumber: z
              .number()
              .optional()
              .describe("Page number (PageNumber field) to assign the product to."),
            pageName: z
              .string()
              .optional()
              .describe("Page name to look up and assign the product to."),
            pageId: z
              .string()
              .optional()
              .describe("PresentationPage record ID to assign the product to."),
            productId: z
              .string()
              .describe("Product2 or LifeSciMarketableProduct record ID to assign."),
            productGuidanceId: z
              .string()
              .optional()
              .describe("Optional ProductGuidance record ID."),
          })
        )
        .optional()
        .describe(
          "Array of per-page product assignments. Each entry must specify one of pageNumber, pageName, or pageId."
        ),
      productIdForAllPages: z
        .string()
        .optional()
        .describe("Shortcut: assign this single product ID to every page in the presentation."),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to use. Uses current target org if not specified."),
    },
    async ({
      presentationId,
      presentationName,
      topicIds,
      topicNames,
      products,
      productIdForAllPages,
      targetOrg,
    }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Assign Presentation Content\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      // Validate inputs
      if (!presentationId && !presentationName) {
        return {
          content: [
            {
              type: "text",
              text: "# Error\n\nProvide either `presentationId` or `presentationName`.",
            },
          ],
        };
      }

      const hasTopics = (topicIds && topicIds.length > 0) || (topicNames && topicNames.length > 0);
      const hasProducts = (products && products.length > 0) || productIdForAllPages;

      if (!hasTopics && !hasProducts) {
        return {
          content: [
            {
              type: "text",
              text: "# Error\n\nProvide at least one of: `topicIds`, `topicNames`, `products`, or `productIdForAllPages`.",
            },
          ],
        };
      }

      let message = `# Assign Presentation Content\n\n`;

      // Step 1: Resolve presentation ID
      let resolvedPresentationId = presentationId;
      let resolvedPresentationName = presentationName || "";

      if (!resolvedPresentationId && presentationName) {
        const nameEscaped = presentationName.replace(/'/g, "\\'");
        const lookupResult = await runSoqlQuery(
          `SELECT Id, Name FROM Presentation WHERE Name = '${nameEscaped}' LIMIT 1`,
          effectiveOrg
        );

        if (!lookupResult.success || !lookupResult.data || lookupResult.data.records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Presentation Not Found\n\nNo presentation found with name "${presentationName}".\n\nUse \`run_soql\` to search: \`SELECT Id, Name FROM Presentation ORDER BY Name\``,
              },
            ],
          };
        }

        resolvedPresentationId = lookupResult.data.records[0].Id as string;
        resolvedPresentationName = lookupResult.data.records[0].Name as string;
        message += `Resolved presentation: **${resolvedPresentationName}** (${resolvedPresentationId})\n\n`;
      }

      // Step 2: Query pages (needed for products and auto-product-from-topic)
      let pages: Array<{ Id: string; Name: string; PageNumber: number }> = [];

      if (hasProducts || hasTopics) {
        const pagesResult = await runSoqlQuery(
          `SELECT Id, Name, PageNumber FROM PresentationPage WHERE Id IN (SELECT PresentationPageId FROM PresentationLinkedPage WHERE PresentationId = '${resolvedPresentationId}') ORDER BY PageNumber`,
          effectiveOrg
        );

        if (!pagesResult.success || !pagesResult.data) {
          return {
            content: [
              {
                type: "text",
                text: `# Failed to Query Pages\n\n**Error:** ${pagesResult.error}\n\nVerify the presentation has pages linked via PresentationLinkedPage.`,
              },
            ],
          };
        }

        pages = pagesResult.data.records as Array<{
          Id: string;
          Name: string;
          PageNumber: number;
        }>;

        if (pages.length === 0 && hasProducts) {
          return {
            content: [
              {
                type: "text",
                text: `# No Pages Found\n\nPresentation "${resolvedPresentationName || resolvedPresentationId}" has no linked pages. Upload pages first using \`upload_presentation\`.`,
              },
            ],
          };
        }

        if (pages.length > 0) {
          message += `Found **${pages.length}** page(s) in the presentation.\n\n`;
        }
      }

      // Track overall results
      let topicsAssigned = 0;
      let topicsSkipped = 0;
      let productsAssigned = 0;
      let productsSkipped = 0;
      const errors: string[] = [];

      // Step 3: Assign topics
      if (hasTopics) {
        message += `## Topics\n\n`;

        // Resolve all topic IDs
        const allTopicIds: Array<{ id: string; name: string }> = [];

        // Add directly-provided topic IDs
        if (topicIds && topicIds.length > 0) {
          for (const tid of topicIds) {
            allTopicIds.push({ id: tid, name: tid });
          }
        }

        // Look up topic names
        if (topicNames && topicNames.length > 0) {
          const escapedNames = topicNames.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(",");
          const topicLookup = await runSoqlQuery(
            `SELECT Id, Name FROM Topic WHERE Name IN (${escapedNames}) AND NetworkId = null`,
            effectiveOrg
          );

          if (topicLookup.success && topicLookup.data) {
            const foundNames = new Set<string>();
            for (const rec of topicLookup.data.records) {
              allTopicIds.push({
                id: rec.Id as string,
                name: rec.Name as string,
              });
              foundNames.add((rec.Name as string).toLowerCase());
            }

            // Report any names not found
            for (const name of topicNames) {
              if (!foundNames.has(name.toLowerCase())) {
                errors.push(`Topic not found: "${name}"`);
              }
            }
          } else {
            errors.push(`Failed to look up topic names: ${topicLookup.error || "Unknown error"}`);
          }
        }

        if (allTopicIds.length > 0) {
          // Check existing topic assignments
          const existingTopicsResult = await runSoqlQuery(
            `SELECT TopicId FROM TopicAssignment WHERE EntityId = '${resolvedPresentationId}'`,
            effectiveOrg
          );

          const existingTopicIds = new Set<string>();
          if (existingTopicsResult.success && existingTopicsResult.data) {
            for (const rec of existingTopicsResult.data.records) {
              existingTopicIds.add(rec.TopicId as string);
            }
          }

          // Create TopicAssignment records for new topics
          for (const topic of allTopicIds) {
            if (existingTopicIds.has(topic.id)) {
              topicsSkipped++;
              continue;
            }

            const result = await createRecord(
              "TopicAssignment",
              {
                TopicId: topic.id,
                EntityId: resolvedPresentationId,
              },
              effectiveOrg
            );

            if (result.success) {
              topicsAssigned++;
              existingTopicIds.add(topic.id); // prevent duplicates within batch
            } else {
              errors.push(`Topic ${topic.name}: ${result.error}`);
            }
          }

          message += `- Assigned: ${topicsAssigned}\n`;
          message += `- Skipped (already assigned): ${topicsSkipped}\n\n`;
        }
      }

      // Step 3b: Auto-assign matching LifeSciMarketableProduct for each topic name
      // When topics are assigned by name, look up LifeSciMarketableProduct records
      // with the same name and assign them to all pages automatically.
      if (topicNames && topicNames.length > 0 && pages.length > 0 && !productIdForAllPages) {
        const escapedProductNames = topicNames.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(",");
        const productLookup = await runSoqlQuery(
          `SELECT Id, Name FROM LifeSciMarketableProduct WHERE Name IN (${escapedProductNames})`,
          effectiveOrg
        );

        if (productLookup.success && productLookup.data && productLookup.data.records.length > 0) {
          message += `## Auto-Detected Products\n\n`;

          // Check existing product assignments for all pages
          const pageIds = pages.map((p) => `'${p.Id}'`).join(",");
          const existingAutoAssignments = new Set<string>();
          const existingCheck = await runSoqlQuery(
            `SELECT PresentationPageId, ProductId FROM PresentationPageProduct WHERE PresentationPageId IN (${pageIds})`,
            effectiveOrg
          );
          if (existingCheck.success && existingCheck.data) {
            for (const rec of existingCheck.data.records) {
              existingAutoAssignments.add(`${rec.PresentationPageId}:${rec.ProductId}`);
            }
          }

          for (const prodRec of productLookup.data.records) {
            const prodId = prodRec.Id as string;
            const prodName = prodRec.Name as string;
            let assigned = 0;
            let skipped = 0;

            for (const p of pages) {
              const key = `${p.Id}:${prodId}`;
              if (existingAutoAssignments.has(key)) {
                skipped++;
                productsSkipped++;
                continue;
              }

              const result = await createRecord(
                "PresentationPageProduct",
                {
                  PresentationPageId: p.Id,
                  ProductId: prodId,
                },
                effectiveOrg
              );

              if (result.success) {
                assigned++;
                productsAssigned++;
                existingAutoAssignments.add(key);
              } else {
                errors.push(`Auto-product "${prodName}" → page "${p.Name}": ${result.error}`);
              }
            }

            message += `- **${prodName}** (${prodId}): assigned to ${assigned} page(s), skipped ${skipped}\n`;
          }

          message += `\n`;
        }
      }

      // Step 4: Assign products to pages
      if (hasProducts) {
        message += `## Products\n\n`;

        // Build page lookup maps
        const pageByNumber = new Map<number, { Id: string; Name: string }>();
        const pageByName = new Map<string, { Id: string; Name: string }>();
        const pageById = new Map<string, { Id: string; Name: string }>();

        for (const p of pages) {
          pageByNumber.set(p.PageNumber, { Id: p.Id, Name: p.Name });
          pageByName.set(p.Name.toLowerCase(), { Id: p.Id, Name: p.Name });
          pageById.set(p.Id, { Id: p.Id, Name: p.Name });
        }

        // Check existing product assignments for all pages
        const pageIds = pages.map((p) => `'${p.Id}'`).join(",");
        const existingProductsResult = await runSoqlQuery(
          `SELECT PresentationPageId, ProductId FROM PresentationPageProduct WHERE PresentationPageId IN (${pageIds})`,
          effectiveOrg
        );

        // Build set of existing page+product combos
        const existingAssignments = new Set<string>();
        if (existingProductsResult.success && existingProductsResult.data) {
          for (const rec of existingProductsResult.data.records) {
            existingAssignments.add(`${rec.PresentationPageId}:${rec.ProductId}`);
          }
        }

        // Build the list of assignments to create
        interface ProductAssignment {
          pageId: string;
          pageName: string;
          productId: string;
          productGuidanceId?: string;
        }
        const assignments: ProductAssignment[] = [];

        if (productIdForAllPages) {
          // Assign to every page
          for (const p of pages) {
            assignments.push({
              pageId: p.Id,
              pageName: p.Name,
              productId: productIdForAllPages,
            });
          }
        }

        if (products && products.length > 0) {
          for (const entry of products) {
            let resolvedPage: { Id: string; Name: string } | undefined;

            if (entry.pageId) {
              resolvedPage = pageById.get(entry.pageId);
              if (!resolvedPage) {
                errors.push(`Page ID "${entry.pageId}" not found in this presentation.`);
                continue;
              }
            } else if (entry.pageNumber !== undefined) {
              resolvedPage = pageByNumber.get(entry.pageNumber);
              if (!resolvedPage) {
                errors.push(
                  `Page number ${entry.pageNumber} not found. Available: ${[...pageByNumber.keys()].sort((a, b) => a - b).join(", ")}`
                );
                continue;
              }
            } else if (entry.pageName) {
              resolvedPage = pageByName.get(entry.pageName.toLowerCase());
              if (!resolvedPage) {
                errors.push(
                  `Page name "${entry.pageName}" not found. Available: ${pages.map((p) => p.Name).join(", ")}`
                );
                continue;
              }
            } else {
              errors.push(
                `Product entry missing page identifier (pageNumber, pageName, or pageId).`
              );
              continue;
            }

            assignments.push({
              pageId: resolvedPage.Id,
              pageName: resolvedPage.Name,
              productId: entry.productId,
              productGuidanceId: entry.productGuidanceId,
            });
          }
        }

        // Create PresentationPageProduct records
        for (const assignment of assignments) {
          const key = `${assignment.pageId}:${assignment.productId}`;
          if (existingAssignments.has(key)) {
            productsSkipped++;
            continue;
          }

          const values: Record<string, unknown> = {
            PresentationPageId: assignment.pageId,
            ProductId: assignment.productId,
          };
          if (assignment.productGuidanceId) {
            values.ProductGuidanceId = assignment.productGuidanceId;
          }

          const result = await createRecord("PresentationPageProduct", values, effectiveOrg);

          if (result.success) {
            productsAssigned++;
            existingAssignments.add(key); // prevent duplicates within batch
          } else {
            errors.push(
              `Page "${assignment.pageName}" + Product ${assignment.productId}: ${result.error}`
            );
          }
        }

        message += `- Assigned: ${productsAssigned}\n`;
        message += `- Skipped (already assigned): ${productsSkipped}\n\n`;
      }

      // Summary
      message += `## Summary\n\n`;
      message += `| Metric | Count |\n`;
      message += `|--------|-------|\n`;
      if (hasTopics) {
        message += `| Topics assigned | ${topicsAssigned} |\n`;
        message += `| Topics skipped | ${topicsSkipped} |\n`;
      }
      if (hasProducts) {
        message += `| Products assigned | ${productsAssigned} |\n`;
        message += `| Products skipped | ${productsSkipped} |\n`;
      }
      message += `| Errors | ${errors.length} |\n`;
      message += "\n";

      if (errors.length > 0) {
        message += `### Errors\n\n`;
        for (const err of errors) {
          message += `- ${err}\n`;
        }
        message += "\n";
      }

      if (topicsAssigned > 0 || productsAssigned > 0) {
        message += `## Next Steps\n\n`;
        message += `1. **Verify** assignments in Admin Console > Intelligent Content > Presentations\n`;
        message += `2. **Regenerate mobile cache** if needed: \`generate_mobile_metadata_cache\`\n`;
      }

      return { content: [{ type: "text", text: message }] };
    }
  );
}
