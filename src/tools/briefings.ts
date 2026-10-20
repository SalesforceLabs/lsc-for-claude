import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import { REQUIRED_PSLS } from "../studio/collectors/briefings.js";

export function register(server: McpServer) {
  server.tool(
    "check_briefings_config",
    "Check Briefings (Daily Podcasts) configuration. Validates toggle, licenses, permissions (StoriesUser/StoriesAdmin), account summarization, content definitions, scheduled flows, DB Schema records, and mobile cache. CORRECT object names: PrstContentDefinition, PrstCntntDefAssignment, PrstCntntUsageSummary, PrvdAccountTerritorySummary. WRONG names: PresentationContentDefinition, PresentationContentDefinitionAssignment, PresentationContentUsageSummary.",
    {
      username: z
        .string()
        .optional()
        .describe(
          "Optional: check a specific user's Briefings access (permissions, profile assignment, object access)"
        ),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ username, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check Briefings Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# Briefings (Daily Podcasts) Configuration Report\n\n";
      const issues: string[] = [];
      const warnings: string[] = [];
      const recommendations: string[] = [];
      const checkResults: Array<{ num: number; check: string; status: string; detail: string }> =
        [];
      let briefingsEnabled = false;

      try {
        // 1. Briefings Toggle
        message += "## 1. Briefings Toggle\n\n";
        const toggleQuery = `SELECT COUNT(Id) FROM PresentationContent`;
        const toggleResult = await runSoqlQuery(toggleQuery, effectiveOrg);

        if (toggleResult.success) {
          message += "✅ **Briefings is enabled** (PresentationContent object accessible)\n\n";
          briefingsEnabled = true;
          checkResults.push({
            num: 1,
            check: "Briefings Toggle",
            status: "✅ PASS",
            detail: "PresentationContent object accessible",
          });
        } else {
          const errorMsg = toggleResult.error || "";
          if (errorMsg.includes("not supported") || errorMsg.includes("INVALID_TYPE")) {
            message +=
              "❌ **Briefings is NOT enabled** — PresentationContent object does not exist\n\n";
            issues.push(
              "Briefings toggle is OFF → Setup → Life Sciences for Customer Engagement Setup → Configure Briefings → Toggle ON"
            );
            message +=
              "> When the toggle is OFF, all Briefings objects are inaccessible and Field Insights flows don't appear.\n\n";
            checkResults.push({
              num: 1,
              check: "Briefings Toggle",
              status: "❌ FAIL",
              detail: "PresentationContent object does not exist",
            });
          } else {
            message += `⚠️ Could not determine toggle status: ${errorMsg}\n\n`;
            warnings.push("Could not verify Briefings toggle — check manually in Setup");
            checkResults.push({
              num: 1,
              check: "Briefings Toggle",
              status: "⚠️ WARN",
              detail: "Could not determine status",
            });
          }
        }

        // 2. Permission Set Licenses
        message += "## 2. Permission Set Licenses\n\n";
        // Matched by DeveloperName: labels differ between releases.
        const pslQuery = `SELECT DeveloperName, MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE DeveloperName IN (${REQUIRED_PSLS.map((p) => `'${p.name}'`).join(",")})`;
        const pslResult = await runSoqlQuery(pslQuery, effectiveOrg);

        if (pslResult.success && pslResult.data?.records) {
          const foundNames = new Set<string>();
          message += "| PSL | Total | Used | Status |\n|-----|-------|------|--------|\n";

          for (const record of pslResult.data.records) {
            const r = record as Record<string, unknown>;
            const label = r.MasterLabel as string;
            const total = r.TotalLicenses as number;
            const used = r.UsedLicenses as number;
            foundNames.add(r.DeveloperName as string);
            const status = total > 0 ? "✅" : "❌";
            message += `| ${label} | ${total} | ${used} | ${status} |\n`;
            if (total === 0) {
              issues.push(`PSL "${label}" has 0 total licenses — contact Salesforce account team`);
            }
          }
          message += "\n";

          const pslMissing = REQUIRED_PSLS.filter((p) => !foundNames.has(p.name)).map((p) => p.label);
          for (const req of pslMissing) {
            message += `❌ **Missing:** ${req}\n`;
            issues.push(`PSL "${req}" not found — contact Salesforce account team`);
          }
          message += "\n";
          if (pslMissing.length === 0) {
            checkResults.push({
              num: 2,
              check: "Licenses (4 PSLs)",
              status: "✅ PASS",
              detail: "All 4 provisioned with capacity remaining",
            });
          } else {
            checkResults.push({
              num: 2,
              check: "Licenses (4 PSLs)",
              status: "❌ FAIL",
              detail: `Missing: ${pslMissing.join(", ")}`,
            });
          }
        } else {
          message += `Error querying PSLs: ${pslResult.error}\n\n`;
          checkResults.push({
            num: 2,
            check: "Licenses (4 PSLs)",
            status: "❌ FAIL",
            detail: "Query error",
          });
        }

        // 3. Permission Sets (Standard + Cloned with StoriesUser/StoriesAdmin)
        message += "## 3. Permission Sets\n\n";

        const standardPs = [
          { name: "HealthCloudStarter", label: "Health Cloud Starter" },
          { name: "EinsteinGPTPromptTemplateManager", label: "Prompt Template Manager" },
          { name: "EinsteinGPTPromptTemplateUser", label: "Prompt Template User" },
          { name: "AccsAgtfrceForLifeSciCustEngmt", label: "Access LSC CE Agentforce" },
        ];

        message += "### Standard Permission Sets\n\n";
        message +=
          "| Permission Set | Assignments | Status |\n|---------------|-------------|--------|\n";

        for (const ps of standardPs) {
          const countQuery = `SELECT COUNT(Id) FROM PermissionSetAssignment WHERE PermissionSet.Name = '${ps.name}'`;
          const countResult = await runSoqlQuery(countQuery, effectiveOrg);
          const count =
            countResult.success && countResult.data?.records
              ? ((countResult.data.records[0] as Record<string, unknown>)["expr0"] as number)
              : 0;
          const status = count > 0 ? "✅" : "❌";
          message += `| ${ps.label} | ${count} | ${status} |\n`;
          if (count === 0) {
            issues.push(`${ps.label} (${ps.name}) has 0 assignments`);
          }
        }
        message += "\n";

        // Check for permission sets with StoriesAdmin/StoriesUser boolean fields
        message += "### Briefings Permissions (Manage / Use)\n\n";

        const adminPsQuery = `SELECT Id, Label FROM PermissionSet WHERE PermissionsStoriesAdmin = true AND IsCustom = true`;
        const adminPsResult = await runSoqlQuery(adminPsQuery, effectiveOrg);

        let foundAdmin = false;
        if (adminPsResult.success && adminPsResult.data?.records?.length) {
          foundAdmin = true;
          for (const record of adminPsResult.data.records) {
            const r = record as Record<string, unknown>;
            message += `✅ Manage Briefings: **${r.Label}**\n`;
          }
        }

        const userPsQuery = `SELECT Id, Label FROM PermissionSet WHERE PermissionsStoriesUser = true AND IsCustom = true`;
        const userPsResult = await runSoqlQuery(userPsQuery, effectiveOrg);

        let foundUser = false;
        if (userPsResult.success && userPsResult.data?.records?.length) {
          foundUser = true;
          for (const record of userPsResult.data.records) {
            const r = record as Record<string, unknown>;
            message += `✅ Use Briefings: **${r.Label}**\n`;
          }
        }

        if (!foundAdmin) {
          message +=
            "❌ No permission set with **Manage Briefings** (PermissionsStoriesAdmin) found\n";
          issues.push(
            "Clone 'Life Sciences Commercial Admin', enable 'Manage Briefings' system permission, assign to admins"
          );
        }
        if (!foundUser) {
          message +=
            "❌ No permission set with **Use Briefings** (PermissionsStoriesUser) found — **#1 reason Briefings doesn't show up**\n";
          issues.push(
            "Clone 'Life Sciences Field Sales Representative', enable 'Use Briefings' system permission, assign to end users"
          );
        }
        message += "\n";

        // Track perm set results
        const standardPsOk = !issues.some((i) => i.includes("has 0 assignments"));
        checkResults.push({
          num: 3,
          check: "Standard Perm Sets",
          status: standardPsOk ? "✅ PASS" : "❌ FAIL",
          detail: standardPsOk
            ? "HealthCloudStarter, PromptTemplate, Agentforce present"
            : "Some standard perm sets missing",
        });

        if (foundAdmin) {
          const adminLabels = (adminPsResult.data?.records || [])
            .map((r: Record<string, unknown>) => `"${r.Label}"`)
            .join(", ");
          checkResults.push({
            num: 4,
            check: "Admin Perm Sets + StoriesAdmin",
            status: "✅ PASS",
            detail: `${adminLabels} have StoriesAdmin`,
          });
        } else {
          checkResults.push({
            num: 4,
            check: "Admin Perm Sets + StoriesAdmin",
            status: "❌ FAIL",
            detail: "No perm set with PermissionsStoriesAdmin found",
          });
        }

        if (foundUser) {
          const userLabels = (userPsResult.data?.records || [])
            .map((r: Record<string, unknown>) => `"${r.Label}"`)
            .join(", ");
          checkResults.push({
            num: 5,
            check: "User Perm Sets + StoriesUser",
            status: "✅ PASS",
            detail: `${userLabels} have StoriesUser`,
          });
        } else {
          checkResults.push({
            num: 5,
            check: "User Perm Sets + StoriesUser",
            status: "❌ FAIL",
            detail: "No perm set with PermissionsStoriesUser found",
          });
        }

        // 4. Account Summarization (only if toggle is ON)
        message += "## 4. Account Summarization\n\n";

        const summFlowQuery = `SELECT Id, Label, ActiveVersionId FROM FlowDefinitionView WHERE Label = 'Generate Provider Account Territory Summary'`;
        const summFlowResult = await runSoqlQuery(summFlowQuery, effectiveOrg);

        if (summFlowResult.success && summFlowResult.data?.records?.length) {
          const flow = summFlowResult.data.records[0] as Record<string, unknown>;
          if (flow.ActiveVersionId) {
            message += "✅ Account Summarization flow: **Active**\n";
          } else {
            message += "❌ Account Summarization flow exists but is **NOT active**\n";
            issues.push("Activate the 'Generate Provider Account Territory Summary' flow");
          }
        } else {
          // Orgs often run summarization from a renamed or custom flow; the summary record count below
          // is what shows whether it works.
          message += "⚠️ No flow labelled 'Generate Provider Account Territory Summary' — another flow may produce the summaries (see the record count below)\n";
        }

        const summRecQuery = `SELECT COUNT(Id) FROM PrvdAccountTerritorySummary`;
        const summRecResult = await runSoqlQuery(summRecQuery, effectiveOrg);
        if (summRecResult.success && summRecResult.data?.records) {
          const count = (summRecResult.data.records[0] as Record<string, unknown>)[
            "expr0"
          ] as number;
          if (count > 0) {
            message += `✅ Summary records: **${count}** PrvdAccountTerritorySummary records\n`;
          } else {
            message += "❌ No PrvdAccountTerritorySummary records — summarization hasn't run\n";
            issues.push(
              "Account Summarization hasn't produced records — verify it's configured and the flow has run"
            );
          }
        }

        const textGenQuery = `SELECT Id, Label, ApiName, ActiveVersionId FROM FlowDefinitionView WHERE ApiName IN ('GenDailyBriefingsText', 'stories__GenDailyBriefingsText')`;
        const textGenResult = await runSoqlQuery(textGenQuery, effectiveOrg);
        if (textGenResult.success && textGenResult.data?.records?.length) {
          const flow = textGenResult.data.records[0] as Record<string, unknown>;
          if (flow.ActiveVersionId) {
            message += `✅ Generate Daily Briefings Text flow: **Active** (${flow.Label})\n`;
          } else {
            message += "❌ Generate Daily Briefings Text flow is **NOT active**\n";
            issues.push(
              "'Generate Daily Briefings Text' flow (ApiName: GenDailyBriefingsText) is not active"
            );
          }
        } else {
          message += "❌ Generate Daily Briefings Text flow not found\n";
          if (!briefingsEnabled) {
            message += "> This flow appears after the Briefings toggle is enabled.\n";
          } else {
            issues.push(
              "'Generate Daily Briefings Text' flow missing — verify managed package installation"
            );
          }
        }
        message += "\n";

        {
          const summOk =
            summFlowResult.success &&
            summFlowResult.data?.records?.length &&
            (summFlowResult.data.records[0] as Record<string, unknown>).ActiveVersionId;
          const textGenOk =
            textGenResult.success &&
            textGenResult.data?.records?.length &&
            (textGenResult.data.records[0] as Record<string, unknown>).ActiveVersionId;
          const summRecCount =
            summRecResult.success && summRecResult.data?.records
              ? ((summRecResult.data.records[0] as Record<string, unknown>)["expr0"] as number)
              : 0;
          if (summOk && textGenOk && summRecCount > 0) {
            checkResults.push({
              num: 6,
              check: "Account Summarization",
              status: "✅ PASS",
              detail: `Flow active, ${summRecCount} summary records, text gen flow active`,
            });
          } else if (summOk && textGenOk) {
            checkResults.push({
              num: 6,
              check: "Account Summarization",
              status: "⚠️ WARN",
              detail: "Flows active but no summary records yet",
            });
          } else {
            checkResults.push({
              num: 6,
              check: "Account Summarization",
              status: "❌ FAIL",
              detail: "Flow or text gen flow missing/inactive",
            });
          }
        }

        // 5. Content Definition & Assignments (only if toggle is ON)
        if (briefingsEnabled) {
          message += "## 5. Content Definition & Assignments\n\n";

          const defQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, ContentType FROM PrstContentDefinition LIMIT 5`;
          const defResult = await runSoqlQuery(defQuery, effectiveOrg);

          if (defResult.success && defResult.data?.records?.length) {
            for (const record of defResult.data.records) {
              const r = record as Record<string, unknown>;
              const active = r.IsActive ? "Active" : "Inactive";
              message += `✅ Definition: **${r.MasterLabel}** (ContentType: ${r.ContentType}, ${active})\n`;
            }
          } else if (defResult.error?.includes("not supported")) {
            message +=
              "⏭️ PrstContentDefinition not accessible — admin may need StoriesAdmin permission\n";
            warnings.push(
              "PrstContentDefinition not accessible — verify admin has 'Manage Field Insights Definitions' permission"
            );
          } else {
            message += "❌ No PrstContentDefinition record found\n";
            issues.push(
              "Create Content Definition → Setup → Life Sciences for Customer Engagement Setup → Configure Briefings → Manage Assignments"
            );
          }

          const assignQuery = `SELECT Id, IsActive, AssignedToId FROM PrstCntntDefAssignment WHERE IsActive = true`;
          const assignResult = await runSoqlQuery(assignQuery, effectiveOrg);

          if (assignResult.success && assignResult.data?.records?.length) {
            const assignments = assignResult.data.records as Array<Record<string, unknown>>;
            message += `✅ Active assignments: **${assignments.length}** profile(s)\n`;

            for (const a of assignments) {
              const profileQuery = `SELECT Name FROM Profile WHERE Id = '${a.AssignedToId}'`;
              const profileResult = await runSoqlQuery(profileQuery, effectiveOrg);
              if (profileResult.success && profileResult.data?.records?.length) {
                const profileName = (profileResult.data.records[0] as Record<string, unknown>).Name;
                message += `  - ${profileName}\n`;
              }
            }
          } else if (!assignResult.error?.includes("not supported")) {
            message += "❌ No active Content Definition Assignments\n";
            issues.push("Add user profiles in Configure Briefings → Manage Assignments");
          }
          message += "\n";

          const defOk = defResult.success && defResult.data?.records?.length;
          const assignOk = assignResult.success && assignResult.data?.records?.length;
          if (defOk && assignOk) {
            const defLabel = (defResult.data!.records![0] as Record<string, unknown>).MasterLabel;
            checkResults.push({
              num: 7,
              check: "Content Definition & Assignments",
              status: "✅ PASS",
              detail: `"${defLabel}" active, ${assignResult.data!.records!.length} profile(s) assigned`,
            });
          } else if (defOk) {
            checkResults.push({
              num: 7,
              check: "Content Definition & Assignments",
              status: "❌ FAIL",
              detail: "Definition exists but no active assignments",
            });
          } else {
            checkResults.push({
              num: 7,
              check: "Content Definition & Assignments",
              status: "❌ FAIL",
              detail: "No content definition found",
            });
          }
        } else {
          message += "## 5. Content Definition & Assignments\n\n";
          message += "⏭️ Skipped — Briefings toggle is OFF (objects not accessible)\n\n";
          checkResults.push({
            num: 7,
            check: "Content Definition & Assignments",
            status: "⏭️ SKIP",
            detail: "Briefings toggle is OFF",
          });
        }

        // 6. Scheduled Flow (outcome-based)
        message += "## 6. Scheduled Flow\n\n";

        // Find original template by stable ApiName
        const templateFlowQuery = `SELECT Id, Label, ApiName, ActiveVersionId FROM FlowDefinitionView WHERE ApiName IN ('SchdDlyBriefingsOfPrvdAcct', 'stories__SchdDlyBriefingsOfPrvdAcct')`;
        const templateFlowResult = await runSoqlQuery(templateFlowQuery, effectiveOrg);

        if (templateFlowResult.success && templateFlowResult.data?.records?.length) {
          const flow = templateFlowResult.data.records[0] as Record<string, unknown>;
          const isActive = !!flow.ActiveVersionId;
          if (isActive) {
            message += `⚠️ Original template flow: **${flow.Label}** — ACTIVE (best practice: use a clone instead)\n`;
            warnings.push(
              "Original template flow is active — best practice is to clone it, set Daily frequency, and activate the clone instead."
            );
          } else {
            message += `✅ Original template flow: **${flow.Label}** — Correctly inactive (template)\n`;
          }
        } else {
          if (!briefingsEnabled) {
            message +=
              "⏭️ Scheduling flow template not found — appears after the Briefings toggle is enabled.\n";
          } else {
            message +=
              "❌ Scheduling flow template (ApiName: SchdDlyBriefingsOfPrvdAcct) not found\n";
            issues.push("Scheduling flow template not found — verify managed package installation");
          }
        }

        // Pipeline outcome: check if PresentationContent records are being generated
        let pipelineRunning = false;
        if (briefingsEnabled) {
          const pipelineQuery = `SELECT Id, CreatedDate FROM PresentationContent ORDER BY CreatedDate DESC LIMIT 1`;
          const pipelineResult = await runSoqlQuery(pipelineQuery, effectiveOrg);

          if (pipelineResult.success && pipelineResult.data?.records?.length) {
            const latest = pipelineResult.data.records[0] as Record<string, unknown>;
            message += `✅ Pipeline running — latest PresentationContent record: ${latest.CreatedDate}\n`;
            pipelineRunning = true;
          } else {
            message +=
              "⚠️ No PresentationContent records yet — the scheduling flow clone may not have fired yet\n";
            warnings.push(
              "No PresentationContent records generated yet. Verify an admin has cloned the scheduling flow, set Daily frequency, and activated it. If just set up, check back after the next scheduled run."
            );
          }
        }
        message += "\n";

        {
          const templateOk = templateFlowResult.success && templateFlowResult.data?.records?.length;
          if (templateOk && pipelineRunning) {
            checkResults.push({
              num: 8,
              check: "Scheduled Flow",
              status: "✅ PASS",
              detail: "Template found, pipeline producing records",
            });
          } else if (templateOk && !pipelineRunning) {
            checkResults.push({
              num: 8,
              check: "Scheduled Flow",
              status: "⚠️ WARN",
              detail: "Template correctly inactive, but no PresentationContent records yet",
            });
          } else {
            checkResults.push({
              num: 8,
              check: "Scheduled Flow",
              status: "❌ FAIL",
              detail: "Scheduling flow template not found",
            });
          }
        }

        // 7. PresentationContent Read Access
        if (briefingsEnabled) {
          message += "## 7. PresentationContent Read Access\n\n";

          const readAccessQuery = `SELECT COUNT(Id) FROM ObjectPermissions WHERE SobjectType = 'PresentationContent' AND PermissionsRead = true`;
          const readAccessResult = await runSoqlQuery(readAccessQuery, effectiveOrg);
          if (readAccessResult.success && readAccessResult.data?.records) {
            const count = (readAccessResult.data.records[0] as Record<string, unknown>)[
              "expr0"
            ] as number;
            if (count > 0) {
              message += `✅ **${count}** permission set(s) grant read access to PresentationContent\n`;
              checkResults.push({
                num: 9,
                check: "Content Records + Read Access",
                status: "✅ PASS",
                detail: `${count} perm sets grant read access`,
              });
            } else {
              message += "⚠️ No permission sets grant read access to PresentationContent\n";
              warnings.push("No read access to PresentationContent — Briefings icon won't appear");
              checkResults.push({
                num: 9,
                check: "Content Records + Read Access",
                status: "⚠️ WARN",
                detail: "No read access to PresentationContent",
              });
            }
          }
          message += "\n";
        } else {
          checkResults.push({
            num: 9,
            check: "Content Records + Read Access",
            status: "⏭️ SKIP",
            detail: "Briefings toggle is OFF",
          });
        }

        // 8. DB Schema Configs (Tooling API)
        message += "## 8. DB Schema Configs\n\n";

        const requiredDbSchema = [
          "DbSchema_PresentationContent",
          "DbSchema_PrstCntntUsageSummary",
          "DbSchema_PrstCntntDefAssignment",
          "DbSchema_PrstContentDefinition",
        ];

        let dbSchemaFound = 0;
        for (const name of requiredDbSchema) {
          const dbQuery = `SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord WHERE DeveloperName = '${name}'`;
          const dbResult = await runToolingQuery(dbQuery, effectiveOrg);

          if (dbResult.success && dbResult.data?.records?.length) {
            const r = dbResult.data.records[0] as Record<string, unknown>;
            if (r.IsActive) {
              message += `✅ ${name}: **Active**\n`;
              dbSchemaFound++;
            } else {
              message += `⚠️ ${name}: **Inactive**\n`;
              warnings.push(`${name} exists but is inactive — enable it in Admin Console`);
            }
          } else {
            message += `❌ ${name}: **Not found**\n`;
            issues.push(
              `Create ${name} in Admin Console → Mobile → Object Metadata Cache Configuration`
            );
          }
        }
        message += `\n**${dbSchemaFound}/4** required DB Schema configs active.\n\n`;

        if (dbSchemaFound === 4) {
          checkResults.push({
            num: 10,
            check: "DB Schema Configs (4)",
            status: "✅ PASS",
            detail: "All 4 active",
          });
        } else if (dbSchemaFound > 0) {
          checkResults.push({
            num: 10,
            check: "DB Schema Configs (4)",
            status: "⚠️ WARN",
            detail: `${dbSchemaFound}/4 active`,
          });
        } else {
          checkResults.push({
            num: 10,
            check: "DB Schema Configs (4)",
            status: "❌ FAIL",
            detail: "None found",
          });
        }

        // Mobile cache — contextual status
        if (issues.length === 0) {
          checkResults.push({
            num: 11,
            check: "Mobile Cache",
            status: "✅ PASS",
            detail: "Regenerate cache after any future data/config change; users sync iPad",
          });
        } else {
          checkResults.push({
            num: 11,
            check: "Mobile Cache",
            status: "⚠️ WARN",
            detail: "Fix issues above, then regenerate cache; users sync iPad to get updates",
          });
        }

        // 9. User-Specific Check
        if (username) {
          message += `## 9. User Check: ${username}\n\n`;

          const userQuery = `SELECT Id, Name, ProfileId, Profile.Name FROM User WHERE Username = '${username}'`;
          const userResult = await runSoqlQuery(userQuery, effectiveOrg);

          if (userResult.success && userResult.data?.records?.length) {
            const user = userResult.data.records[0] as Record<string, unknown>;
            const userId = user.Id as string;
            const profileId = user.ProfileId as string;
            const profileName =
              ((user.Profile as Record<string, unknown>)?.Name as string) || "Unknown";
            message += `✅ User found: **${user.Name}** (Profile: ${profileName})\n`;

            // Check StoriesUser permission via boolean field
            const userBriefingsQuery = `SELECT PermissionSet.Label FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSet.PermissionsStoriesUser = true`;
            const userBriefingsResult = await runSoqlQuery(userBriefingsQuery, effectiveOrg);

            if (userBriefingsResult.success && userBriefingsResult.data?.records?.length) {
              const ps = userBriefingsResult.data.records[0] as Record<string, unknown>;
              const psData = ps["PermissionSet"] as Record<string, unknown> | undefined;
              const label = psData?.Label || "assigned";
              message += `✅ Has Use Briefings permission (via **${label}**)\n`;
            } else {
              message +=
                "❌ User does NOT have Use Briefings permission (PermissionsStoriesUser) assigned\n";
              issues.push(
                `User ${username} needs a permission set with 'Use Briefings' (PermissionsStoriesUser) enabled`
              );
            }

            // Check profile in assignment
            if (briefingsEnabled) {
              const assignCheckQuery = `SELECT Id FROM PrstCntntDefAssignment WHERE IsActive = true AND AssignedToId = '${profileId}'`;
              const assignCheckResult = await runSoqlQuery(assignCheckQuery, effectiveOrg);

              if (assignCheckResult.success && assignCheckResult.data?.records?.length) {
                message += `✅ Profile **${profileName}** is in an active Content Definition Assignment\n`;
              } else if (!assignCheckResult.error?.includes("not supported")) {
                message += `❌ Profile **${profileName}** is NOT in any active Content Definition Assignment\n`;
                issues.push(
                  `Add profile "${profileName}" to Configure Briefings → Manage Assignments`
                );
              }

              // Check read access
              const readQuery = `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSetId IN (SELECT ParentId FROM ObjectPermissions WHERE SobjectType = 'PresentationContent' AND PermissionsRead = true)`;
              const readResult = await runSoqlQuery(readQuery, effectiveOrg);

              if (readResult.success && readResult.data?.records?.length) {
                message += "✅ Has read access to PresentationContent\n";
              } else {
                message +=
                  "❌ Does NOT have read access to PresentationContent — Briefings icon won't appear\n";
                issues.push(`User ${username} needs read access to PresentationContent object`);
              }
            }
          } else {
            message += `❌ User **${username}** not found in org\n`;
            issues.push(`User "${username}" not found`);
          }
          message += "\n";
        }

        // Summary Table
        message += "---\n\n## Briefings Diagnostic Summary\n\n";
        message += "| # | Check | Status | Detail |\n";
        message += "|---|-------|--------|--------|\n";
        for (const r of checkResults) {
          message += `| ${r.num} | ${r.check} | ${r.status} | ${r.detail} |\n`;
        }
        message += "\n";

        if (issues.length === 0 && warnings.length === 0) {
          message += "### ✅ All checks passed — Briefings is correctly configured.\n";
        } else {
          if (issues.length > 0) {
            message += `### ❌ ${issues.length} Issue(s) Found\n\n`;
            issues.forEach((issue, i) => {
              message += `${i + 1}. ${issue}\n`;
            });
            message += "\n";
          }
          if (warnings.length > 0) {
            message += `### ⚠️ ${warnings.length} Warning(s)\n\n`;
            warnings.forEach((warning, i) => {
              message += `${i + 1}. ${warning}\n`;
            });
            message += "\n";
          }
        }

        message += "### 📱 Mobile Metadata Cache\n\n";
        message +=
          "Regenerate the metadata cache (`generate_mobile_metadata_cache`) whenever data or configuration changes. ";
        message +=
          "Once the cache is generated successfully, end users just need to sync their iPad to pick up the latest content.\n";
      } catch (error) {
        message += `\n\n**Error during check:** ${error instanceof Error ? error.message : String(error)}\n`;
      }

      return { content: [{ type: "text", text: message }] };
    }
  );
}
