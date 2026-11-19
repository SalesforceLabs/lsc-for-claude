import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { queryFieldValues, queryAssignments, extractFieldValue } from "./helpers.js";

export function register(server: McpServer) {
  server.tool(
    "diff_orgs",
    "Compare LSC configuration between two Salesforce orgs. Produces a detailed per-record report comparing trigger handlers, admin settings, DB Schema records, and actions (with profile assignments) to identify configuration drift. Both orgs must be authenticated via SF CLI.",
    {
      sourceOrg: z.string().describe("Alias or username of the first (source) org"),
      targetOrg: z.string().describe("Alias or username of the second (target) org"),
      scope: z
        .enum(["all", "admin-settings", "db-schema", "trigger-handlers", "actions"])
        .optional()
        .describe("What to compare. Defaults to 'all'."),
    },
    async ({ sourceOrg, targetOrg, scope }) => {
      const effectiveScope = scope || "all";

      // Validate both orgs are not the same
      if (sourceOrg === targetOrg) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Diff Orgs\n\nSource and target org are the same (\`${sourceOrg}\`). Please provide two different orgs.`,
            },
          ],
        };
      }

      // Validate both orgs are accessible by running a lightweight query on each
      const sourceCheck = await runSoqlQuery("SELECT Id FROM Organization LIMIT 1", sourceOrg);
      if (!sourceCheck.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Diff Orgs\n\nFailed to connect to source org \`${sourceOrg}\`:\n${sourceCheck.error}\n\nEnsure the org is authenticated via \`sf org login web --alias ${sourceOrg}\`.`,
            },
          ],
        };
      }
      const targetCheck = await runSoqlQuery("SELECT Id FROM Organization LIMIT 1", targetOrg);
      if (!targetCheck.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Diff Orgs\n\nFailed to connect to target org \`${targetOrg}\`:\n${targetCheck.error}\n\nEnsure the org is authenticated via \`sf org login web --alias ${targetOrg}\`.`,
            },
          ],
        };
      }

      // Helper: format a value for display (no truncation)
      const fmtVal = (v: unknown): string =>
        v !== null && v !== undefined && String(v) !== "" ? String(v) : "(empty)";

      // Helper: format field values as a list of "FieldName: value"
      const formatFieldValues = (fvs: Array<Record<string, unknown>>): Map<string, string> => {
        const map = new Map<string, string>();
        for (const f of fvs) {
          map.set(f.FieldName as string, fmtVal(extractFieldValue(f)));
        }
        return map;
      };

      // Helper: format profile assignments as sorted comma-separated string
      const formatAssignments = (
        assignments: Array<{ id: string; name: string; level: string }> | undefined
      ): string => {
        if (!assignments || assignments.length === 0) return "(none)";
        return assignments
          .map((a) => a.name)
          .sort()
          .join(", ");
      };

      try {
        const summary: Array<{
          category: string;
          matches: number;
          differences: number;
          onlyInSource: number;
          onlyInTarget: number;
        }> = [];
        let detailSections = "";
        let onlyInSourceSection = "";
        let onlyInTargetSection = "";

        // ---- Trigger Handlers ----
        if (effectiveScope === "all" || effectiveScope === "trigger-handlers") {
          const thQuery =
            "SELECT Id, DeveloperName, MasterLabel, IsActive, Description FROM LifeScienceTriggerHandler ORDER BY DeveloperName";
          const [srcResult, tgtResult] = await Promise.all([
            runToolingQuery(thQuery, sourceOrg),
            runToolingQuery(thQuery, targetOrg),
          ]);

          if (!srcResult.success || !tgtResult.success) {
            const errOrg = !srcResult.success ? sourceOrg : targetOrg;
            const errMsg = !srcResult.success ? srcResult.error : tgtResult.error;
            detailSections += `### Trigger Handlers\n\n⚠️ Could not query \`${errOrg}\`: ${errMsg}\n\n`;
          } else {
            const srcHandlers = new Map<string, Record<string, unknown>>();
            const tgtHandlers = new Map<string, Record<string, unknown>>();

            for (const r of srcResult.data?.records || []) {
              const rec = r as Record<string, unknown>;
              srcHandlers.set(rec.DeveloperName as string, rec);
            }
            for (const r of tgtResult.data?.records || []) {
              const rec = r as Record<string, unknown>;
              tgtHandlers.set(rec.DeveloperName as string, rec);
            }

            let matches = 0;
            let differences = 0;
            let onlySource = 0;
            let onlyTarget = 0;
            let diffDetail = "";
            let srcOnlyDetail = "";
            let tgtOnlyDetail = "";

            const allKeys = new Set([...srcHandlers.keys(), ...tgtHandlers.keys()]);
            for (const key of [...allKeys].sort()) {
              const src = srcHandlers.get(key);
              const tgt = tgtHandlers.get(key);

              if (src && tgt) {
                if (src.IsActive !== tgt.IsActive) {
                  differences++;
                  diffDetail += `#### \`${key}\` (${src.MasterLabel || key})\n\n`;
                  diffDetail += `| Field | ${sourceOrg} | ${targetOrg} |\n`;
                  diffDetail += `|-------|-------------|-------------|\n`;
                  diffDetail += `| IsActive | ${src.IsActive ? "✅ Active" : "❌ Inactive"} | ${tgt.IsActive ? "✅ Active" : "❌ Inactive"} |\n`;
                  if (src.Description || tgt.Description) {
                    diffDetail += `| Description | ${fmtVal(src.Description)} | ${fmtVal(tgt.Description)} |\n`;
                  }
                  diffDetail += `\n`;
                } else {
                  matches++;
                }
              } else if (src && !tgt) {
                onlySource++;
                srcOnlyDetail += `- **\`${key}\`** (${src.MasterLabel || key}) — ${src.IsActive ? "✅ Active" : "❌ Inactive"}`;
                if (src.Description) srcOnlyDetail += ` — ${src.Description}`;
                srcOnlyDetail += `\n`;
              } else if (!src && tgt) {
                onlyTarget++;
                tgtOnlyDetail += `- **\`${key}\`** (${tgt.MasterLabel || key}) — ${tgt.IsActive ? "✅ Active" : "❌ Inactive"}`;
                if (tgt.Description) tgtOnlyDetail += ` — ${tgt.Description}`;
                tgtOnlyDetail += `\n`;
              }
            }

            summary.push({
              category: "Trigger Handlers",
              matches,
              differences,
              onlyInSource: onlySource,
              onlyInTarget: onlyTarget,
            });

            if (diffDetail) {
              detailSections += `### Trigger Handlers\n\n${diffDetail}`;
            }
            if (srcOnlyDetail) {
              onlyInSourceSection += `### Trigger Handlers\n\n${srcOnlyDetail}\n`;
            }
            if (tgtOnlyDetail) {
              onlyInTargetSection += `### Trigger Handlers\n\n${tgtOnlyDetail}\n`;
            }
          }
        }

        // ---- Admin Settings / DB Schema / Actions ----
        const toolingScopes: Array<{ scope: string; label: string }> = [];
        if (effectiveScope === "all") {
          toolingScopes.push(
            { scope: "db-schema", label: "DB Schema" },
            { scope: "actions", label: "Actions" },
            { scope: "admin-settings", label: "Admin Settings" }
          );
        } else if (effectiveScope !== "trigger-handlers") {
          toolingScopes.push({
            scope: effectiveScope,
            label:
              effectiveScope === "db-schema"
                ? "DB Schema"
                : effectiveScope === "actions"
                  ? "Actions"
                  : "Admin Settings",
          });
        }

        for (const ts of toolingScopes) {
          // Get categories from both orgs
          const catQuery =
            "SELECT Id, Category, MasterLabel FROM LifeSciConfigCategory ORDER BY Category";
          const [srcCatResult, tgtCatResult] = await Promise.all([
            runToolingQuery(catQuery, sourceOrg),
            runToolingQuery(catQuery, targetOrg),
          ]);

          if (!srcCatResult.success || !tgtCatResult.success) {
            const errOrg = !srcCatResult.success ? sourceOrg : targetOrg;
            const errMsg = !srcCatResult.success ? srcCatResult.error : tgtCatResult.error;
            detailSections += `### ${ts.label}\n\n⚠️ Could not query categories from \`${errOrg}\`: ${errMsg}\n\n`;
            continue;
          }

          const srcCategories = (srcCatResult.data?.records || []) as Array<
            Record<string, unknown>
          >;
          const tgtCategories = (tgtCatResult.data?.records || []) as Array<
            Record<string, unknown>
          >;

          // Filter categories based on scope
          const filterCategory = (
            cats: Array<Record<string, unknown>>
          ): Array<Record<string, unknown>> => {
            if (ts.scope === "db-schema") {
              return cats.filter((c) => c.Category === "DbSchema");
            } else if (ts.scope === "actions") {
              return cats.filter(
                (c) => c.Category === "QuickAction" || c.Category === "CustomAction"
              );
            } else if (ts.scope === "admin-settings") {
              return cats.filter(
                (c) =>
                  c.Category !== "DbSchema" &&
                  c.Category !== "QuickAction" &&
                  c.Category !== "CustomAction"
              );
            }
            return cats;
          };

          const filteredSrcCats = filterCategory(srcCategories);
          const filteredTgtCats = filterCategory(tgtCategories);

          const srcCatMap = new Map<string, string>();
          const tgtCatMap = new Map<string, string>();
          for (const c of filteredSrcCats) srcCatMap.set(c.Category as string, c.Id as string);
          for (const c of filteredTgtCats) tgtCatMap.set(c.Category as string, c.Id as string);

          const allCategoryNames = new Set([...srcCatMap.keys(), ...tgtCatMap.keys()]);

          let totalMatches = 0;
          let totalDiffs = 0;
          let totalOnlySource = 0;
          let totalOnlyTarget = 0;
          let diffDetail = "";
          let srcOnlyDetail = "";
          let tgtOnlyDetail = "";

          for (const catName of [...allCategoryNames].sort()) {
            const srcCatId = srcCatMap.get(catName);
            const tgtCatId = tgtCatMap.get(catName);

            // Category only in one org
            if (srcCatId && !tgtCatId) {
              srcOnlyDetail += `- **Category \`${catName}\`** — entire category missing from ${targetOrg}\n`;
              continue;
            }
            if (!srcCatId && tgtCatId) {
              tgtOnlyDetail += `- **Category \`${catName}\`** — entire category missing from ${sourceOrg}\n`;
              continue;
            }
            if (!srcCatId || !tgtCatId) continue;

            // Query records for this category in both orgs
            const recQuery = (catId: string) =>
              `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${catId}' ORDER BY DeveloperName`;

            const [srcRecResult, tgtRecResult] = await Promise.all([
              runToolingQuery(recQuery(srcCatId), sourceOrg),
              runToolingQuery(recQuery(tgtCatId), targetOrg),
            ]);

            const srcRecords = (
              srcRecResult.success ? srcRecResult.data?.records || [] : []
            ) as Array<Record<string, unknown>>;
            const tgtRecords = (
              tgtRecResult.success ? tgtRecResult.data?.records || [] : []
            ) as Array<Record<string, unknown>>;

            const srcRecMap = new Map<string, Record<string, unknown>>();
            const tgtRecMap = new Map<string, Record<string, unknown>>();
            for (const r of srcRecords) srcRecMap.set(r.DeveloperName as string, r);
            for (const r of tgtRecords) tgtRecMap.set(r.DeveloperName as string, r);

            // Batch-fetch field values and profile assignments for both orgs
            const srcIds = srcRecords.map((r) => r.Id as string);
            const tgtIds = tgtRecords.map((r) => r.Id as string);

            const [srcFvResult, tgtFvResult, srcAssignments, tgtAssignments] = await Promise.all([
              srcIds.length > 0
                ? queryFieldValues(srcIds, sourceOrg, true)
                : Promise.resolve({
                    fieldValuesByRecord: new Map<string, Array<Record<string, unknown>>>(),
                  }),
              tgtIds.length > 0
                ? queryFieldValues(tgtIds, targetOrg, true)
                : Promise.resolve({
                    fieldValuesByRecord: new Map<string, Array<Record<string, unknown>>>(),
                  }),
              srcIds.length > 0
                ? queryAssignments(srcIds, sourceOrg)
                : Promise.resolve(
                    new Map<string, Array<{ id: string; name: string; level: string }>>()
                  ),
              tgtIds.length > 0
                ? queryAssignments(tgtIds, targetOrg)
                : Promise.resolve(
                    new Map<string, Array<{ id: string; name: string; level: string }>>()
                  ),
            ]);

            const allRecKeys = new Set([...srcRecMap.keys(), ...tgtRecMap.keys()]);
            const categoryLabel = ts.scope === "db-schema" ? "DB Schema" : catName;

            for (const recKey of [...allRecKeys].sort()) {
              const srcRec = srcRecMap.get(recKey);
              const tgtRec = tgtRecMap.get(recKey);

              // ---- Record only in source: show full detail ----
              if (srcRec && !tgtRec) {
                totalOnlySource++;
                const srcFvs = srcFvResult.fieldValuesByRecord.get(srcRec.Id as string) || [];
                const srcAssign = srcAssignments.get(srcRec.Id as string);
                srcOnlyDetail += `#### \`${recKey}\` (${categoryLabel}: ${srcRec.MasterLabel || recKey})\n\n`;
                srcOnlyDetail += `- **Active:** ${srcRec.IsActive ? "Yes" : "No"}\n`;
                srcOnlyDetail += `- **Org-Level:** ${srcRec.IsOrgLevel ? "Yes" : "No"}\n`;
                if (srcAssign && srcAssign.length > 0) {
                  srcOnlyDetail += `- **Profiles:** ${formatAssignments(srcAssign)}\n`;
                }
                if (srcFvs.length > 0) {
                  srcOnlyDetail += `- **Fields:**\n`;
                  for (const f of srcFvs) {
                    srcOnlyDetail += `  - \`${f.FieldName}\`: ${fmtVal(extractFieldValue(f))}\n`;
                  }
                }
                srcOnlyDetail += `\n`;
                continue;
              }
              // ---- Record only in target: show full detail ----
              if (!srcRec && tgtRec) {
                totalOnlyTarget++;
                const tgtFvs = tgtFvResult.fieldValuesByRecord.get(tgtRec.Id as string) || [];
                const tgtAssign = tgtAssignments.get(tgtRec.Id as string);
                tgtOnlyDetail += `#### \`${recKey}\` (${categoryLabel}: ${tgtRec.MasterLabel || recKey})\n\n`;
                tgtOnlyDetail += `- **Active:** ${tgtRec.IsActive ? "Yes" : "No"}\n`;
                tgtOnlyDetail += `- **Org-Level:** ${tgtRec.IsOrgLevel ? "Yes" : "No"}\n`;
                if (tgtAssign && tgtAssign.length > 0) {
                  tgtOnlyDetail += `- **Profiles:** ${formatAssignments(tgtAssign)}\n`;
                }
                if (tgtFvs.length > 0) {
                  tgtOnlyDetail += `- **Fields:**\n`;
                  for (const f of tgtFvs) {
                    tgtOnlyDetail += `  - \`${f.FieldName}\`: ${fmtVal(extractFieldValue(f))}\n`;
                  }
                }
                tgtOnlyDetail += `\n`;
                continue;
              }
              if (!srcRec || !tgtRec) continue;

              // ---- Record in both: compare field-by-field ----
              const diffFields: Array<{ field: string; srcVal: string; tgtVal: string }> = [];

              // Compare IsActive
              if (srcRec.IsActive !== tgtRec.IsActive) {
                diffFields.push({
                  field: "IsActive",
                  srcVal: srcRec.IsActive ? "✅ Yes" : "❌ No",
                  tgtVal: tgtRec.IsActive ? "✅ Yes" : "❌ No",
                });
              }

              // Compare IsOrgLevel
              if (srcRec.IsOrgLevel !== tgtRec.IsOrgLevel) {
                diffFields.push({
                  field: "IsOrgLevel",
                  srcVal: srcRec.IsOrgLevel ? "Yes" : "No",
                  tgtVal: tgtRec.IsOrgLevel ? "Yes" : "No",
                });
              }

              // Compare field values
              const srcFvs = srcFvResult.fieldValuesByRecord.get(srcRec.Id as string) || [];
              const tgtFvs = tgtFvResult.fieldValuesByRecord.get(tgtRec.Id as string) || [];
              const srcFvMap = formatFieldValues(srcFvs);
              const tgtFvMap = formatFieldValues(tgtFvs);

              const allFieldNames = new Set([...srcFvMap.keys(), ...tgtFvMap.keys()]);
              for (const fn of [...allFieldNames].sort()) {
                const srcStr = srcFvMap.get(fn) || "(empty)";
                const tgtStr = tgtFvMap.get(fn) || "(empty)";
                if (srcStr !== tgtStr) {
                  diffFields.push({ field: fn, srcVal: srcStr, tgtVal: tgtStr });
                }
              }

              // Compare profile assignments
              const srcAssign = srcAssignments.get(srcRec.Id as string);
              const tgtAssign = tgtAssignments.get(tgtRec.Id as string);
              const srcAssignStr = formatAssignments(srcAssign);
              const tgtAssignStr = formatAssignments(tgtAssign);
              if (srcAssignStr !== tgtAssignStr) {
                diffFields.push({
                  field: "Profile Assignments",
                  srcVal: srcAssignStr,
                  tgtVal: tgtAssignStr,
                });
              }

              if (diffFields.length > 0) {
                totalDiffs++;
                diffDetail += `#### \`${recKey}\` (${categoryLabel}: ${srcRec.MasterLabel || recKey})\n\n`;
                diffDetail += `| Field | ${sourceOrg} | ${targetOrg} |\n`;
                diffDetail += `|-------|-------------|-------------|\n`;
                for (const d of diffFields) {
                  // For long values (like SOQL filters), use a code block row
                  if (d.srcVal.length > 80 || d.tgtVal.length > 80) {
                    diffDetail += `| ${d.field} | *(see below)* | *(see below)* |\n`;
                    diffDetail += `\n**${d.field}** in \`${sourceOrg}\`:\n\`\`\`\n${d.srcVal}\n\`\`\`\n`;
                    diffDetail += `**${d.field}** in \`${targetOrg}\`:\n\`\`\`\n${d.tgtVal}\n\`\`\`\n\n`;
                  } else {
                    diffDetail += `| ${d.field} | ${d.srcVal} | ${d.tgtVal} |\n`;
                  }
                }
                diffDetail += `\n`;
              } else {
                totalMatches++;
              }
            }
          }

          summary.push({
            category: ts.label,
            matches: totalMatches,
            differences: totalDiffs,
            onlyInSource: totalOnlySource,
            onlyInTarget: totalOnlyTarget,
          });

          if (diffDetail) {
            detailSections += `### ${ts.label}\n\n${diffDetail}`;
          }
          if (srcOnlyDetail) {
            onlyInSourceSection += `### ${ts.label}\n\n${srcOnlyDetail}`;
          }
          if (tgtOnlyDetail) {
            onlyInTargetSection += `### ${ts.label}\n\n${tgtOnlyDetail}`;
          }
        }

        // ---- Build final report ----
        let message = `# Org Diff: ${sourceOrg} ↔ ${targetOrg}\n\n`;
        message += `**Scope:** ${effectiveScope}\n\n`;

        const totalDifferences = summary.reduce(
          (sum, s) => sum + s.differences + s.onlyInSource + s.onlyInTarget,
          0
        );
        if (totalDifferences === 0) {
          message += `**✅ No differences found** across all checked categories.\n\n`;
        } else {
          message += `**⚠️ ${totalDifferences} difference(s) found.**\n\n`;
        }

        message += `## Summary\n\n`;
        message += `| Category | Matches | Differences | Only in ${sourceOrg} | Only in ${targetOrg} |\n`;
        message += `|----------|---------|-------------|----------------------|----------------------|\n`;
        for (const s of summary) {
          message += `| ${s.category} | ${s.matches} | ${s.differences} | ${s.onlyInSource} | ${s.onlyInTarget} |\n`;
        }
        message += "\n";

        if (detailSections) {
          message += `## Differences (Field-by-Field)\n\n`;
          message += detailSections;
        }

        if (onlyInSourceSection) {
          message += `## Only in ${sourceOrg}\n\n`;
          message += onlyInSourceSection;
        }

        if (onlyInTargetSection) {
          message += `## Only in ${targetOrg}\n\n`;
          message += onlyInTargetSection;
        }

        if (totalDifferences > 0) {
          message += `## Recommended Actions\n\n`;
          message += `Review each difference above and decide which org has the correct configuration. To align:\n\n`;
          message += `- **Trigger Handlers:** \`toggle_trigger_handler({ handlerName: "...", active: true/false, targetOrg: "..." })\`\n`;
          message += `- **Admin Settings:** \`update_admin_setting({ recordName: "...", fields: {...}, targetOrg: "..." })\`\n`;
          message += `- **DB Schema:** \`update_db_schema({ recordName: "...", fields: {...}, targetOrg: "..." })\`\n`;
          message += `- **Actions:** \`update_lsc_action({ id: "...", fields: {...}, targetOrg: "..." })\`\n`;
          message += `- **Missing records:** Use the corresponding \`create_*\` tool to add the record to the org where it's missing\n\n`;
          message += `Re-run \`diff_orgs\` after making changes to verify alignment.\n`;
        }

        return { content: [{ type: "text", text: message }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Org Diff Failed\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
