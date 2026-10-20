import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";

export function register(server: McpServer) {
  server.tool(
    "check_visit_config",
    "Check LSC Visit Management configuration. Queries visit record types, ProviderVisit record types, trigger handlers, compliance statements, territory info, and Admin Console settings. CORRECT object names: Visit, ProviderVisit, ProviderVisitProdDetailing, ProviderVisitProdDiscussion, ProviderAcctTerritoryInfo, ComplianceStatementDef. WRONG names (DO NOT USE): Visit__c, ProviderVisit__c, VisitSetting__c, VisitConfiguration__mdt, VisitRecordType__c, VisitType__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check Visit Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# Visit Management Configuration Report\n\n";
      const issues: string[] = [];
      const recommendations: string[] = [];

      try {
        // 1. Check Visit record types
        message += "## Visit Record Types\n\n";
        const visitRtQuery = `SELECT Id, Name, DeveloperName, IsActive FROM RecordType WHERE SobjectType = 'Visit' ORDER BY Name`;
        const visitRtResult = await runSoqlQuery(visitRtQuery, effectiveOrg);

        if (visitRtResult.success && visitRtResult.data?.records) {
          const records = visitRtResult.data.records;
          const activeRts = records.filter((r) => (r as Record<string, unknown>).IsActive === true);

          if (records.length === 0) {
            message += "**No Visit record types found.**\n\n";
            issues.push("No Visit record types configured");
            recommendations.push(
              "Create Visit record types in Setup > Object Manager > Visit > Record Types"
            );
          } else {
            message += `| Name | Developer Name | Active |\n`;
            message += `|------|----------------|--------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.Name} | ${rec.DeveloperName} | ${rec.IsActive ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} (${activeRts.length} active)\n\n`;

            if (activeRts.length === 0) {
              issues.push("All Visit record types are inactive");
              recommendations.push("Activate at least one Visit record type");
            }
          }
        } else {
          message += `Error querying Visit record types: ${visitRtResult.error}\n\n`;
        }

        // 2. Check ProviderVisit record types
        message += "## ProviderVisit Record Types\n\n";
        const pvRtQuery = `SELECT Id, Name, DeveloperName, IsActive FROM RecordType WHERE SobjectType = 'ProviderVisit' ORDER BY Name`;
        const pvRtResult = await runSoqlQuery(pvRtQuery, effectiveOrg);

        if (pvRtResult.success && pvRtResult.data?.records) {
          const records = pvRtResult.data.records;
          const activeRts = records.filter((r) => (r as Record<string, unknown>).IsActive === true);

          if (records.length === 0) {
            message += "**No ProviderVisit record types found.**\n\n";
            issues.push("No ProviderVisit record types configured");
            recommendations.push(
              "Create ProviderVisit record types matching each Visit record type"
            );
          } else {
            message += `| Name | Developer Name | Active |\n`;
            message += `|------|----------------|--------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.Name} | ${rec.DeveloperName} | ${rec.IsActive ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} (${activeRts.length} active)\n\n`;

            if (activeRts.length === 0) {
              issues.push("All ProviderVisit record types are inactive");
              recommendations.push("Activate at least one ProviderVisit record type");
            }
          }

          // Check alignment between Visit and ProviderVisit record types
          if (visitRtResult.success && visitRtResult.data?.records) {
            const visitRtNames = new Set(
              visitRtResult.data.records
                .filter((r) => (r as Record<string, unknown>).IsActive === true)
                .map((r) => (r as Record<string, unknown>).DeveloperName as string)
            );
            const pvRtNames = new Set(
              records
                .filter((r) => (r as Record<string, unknown>).IsActive === true)
                .map((r) => (r as Record<string, unknown>).DeveloperName as string)
            );

            const missingInPv = [...visitRtNames].filter((name) => !pvRtNames.has(name));
            const missingInVisit = [...pvRtNames].filter((name) => !visitRtNames.has(name));

            if (missingInPv.length > 0) {
              message += `**Warning:** Visit record types without matching ProviderVisit record types: ${missingInPv.join(", ")}\n\n`;
              issues.push(
                `${missingInPv.length} Visit record type(s) have no matching ProviderVisit record type`
              );
              recommendations.push(
                `Create ProviderVisit record types for: ${missingInPv.join(", ")}`
              );
            }

            if (missingInVisit.length > 0) {
              message += `**Note:** ProviderVisit record types without matching Visit record types: ${missingInVisit.join(", ")}\n\n`;
            }

            if (missingInPv.length === 0 && missingInVisit.length === 0 && visitRtNames.size > 0) {
              message +=
                "**Record type alignment: OK** - Visit and ProviderVisit record types match.\n\n";
            }
          }
        } else {
          message += `Error querying ProviderVisit record types: ${pvRtResult.error}\n\n`;
        }

        // 3. Check ProviderAcctTerritoryInfo
        message += "## Territory Visit Tracking\n\n";
        const territoryQuery = `SELECT COUNT() FROM ProviderAcctTerritoryInfo`;
        const territoryResult = await runSoqlQuery(territoryQuery, effectiveOrg);

        if (territoryResult.success && territoryResult.data) {
          const count = territoryResult.data.totalSize;
          message += `**ProviderAcctTerritoryInfo records:** ${count}\n\n`;

          if (count === 0) {
            message +=
              "No territory visit tracking records found. This is normal if no visits have been completed yet, or if the Visit Rollup Job has not run.\n\n";
          }
        } else {
          message += `Error querying ProviderAcctTerritoryInfo: ${territoryResult.error}\n\n`;
        }

        // 4. Check Compliance Statement Definitions
        message += "## Compliance Statements\n\n";
        const complianceQuery = `SELECT Id, Name, ModuleType, StatementType FROM ComplianceStatementDef WHERE ModuleType = 'Visit'`;
        const complianceResult = await runSoqlQuery(complianceQuery, effectiveOrg);

        if (complianceResult.success && complianceResult.data?.records) {
          const records = complianceResult.data.records;

          if (records.length === 0) {
            message += "**No compliance statements found for Visit module.**\n\n";
            issues.push("No compliance statements configured for Visit module");
            recommendations.push(
              "Create ComplianceStatementDef records with ModuleType = 'Visit' for signature capture"
            );
          } else {
            message += `| Name | Statement Type |\n`;
            message += `|------|----------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.Name} | ${rec.StatementType || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length}\n\n`;
          }
        } else {
          // ComplianceStatementDef may not exist in all orgs
          message += `Could not query compliance statements: ${complianceResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 5. Check Admin Console visit settings via Tooling API
        message += "## Admin Console Visit Settings\n\n";
        const visitSettingsQuery = `SELECT Id, MasterLabel, IsActive FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE Category LIKE '%Visit%') ORDER BY MasterLabel`;
        const visitSettingsResult = await runToolingQuery(visitSettingsQuery, effectiveOrg);

        if (visitSettingsResult.success && visitSettingsResult.data?.records) {
          const records = visitSettingsResult.data.records;

          if (records.length === 0) {
            message += "No visit-related Admin Console settings found.\n\n";
          } else {
            message += `| Setting | Active |\n`;
            message += `|---------|--------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.MasterLabel} | ${rec.IsActive ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} visit setting(s)\n\n`;
          }
        } else {
          message += `Could not query Admin Console settings via Tooling API: ${visitSettingsResult.error}\n\n`;
          message +=
            "This is expected if no visit-specific Admin Console settings have been configured.\n\n";
        }

        // 6. Check mobile cache status
        message += "## Mobile Metadata Cache\n\n";
        const cacheQuery = `SELECT Id, Name, Status, IntegrationStatus, LastModifiedDate FROM LifeSciMobileMetadataRecord WHERE Status IN ('Active', 'Published') ORDER BY LastModifiedDate DESC LIMIT 5`;
        const cacheResult = await runSoqlQuery(cacheQuery, effectiveOrg);

        if (cacheResult.success && cacheResult.data?.records) {
          const records = cacheResult.data.records;

          if (records.length === 0) {
            message += "**No active metadata cache found.**\n\n";
            issues.push("No active mobile metadata cache");
            recommendations.push(
              "Generate mobile metadata cache for profiles that need visit management on mobile"
            );
          } else {
            message += `| Name | Status | Integration | Last Modified |\n`;
            message += `|------|--------|-------------|---------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const lastMod = rec.LastModifiedDate
                ? String(rec.LastModifiedDate).substring(0, 19).replace("T", " ")
                : "-";
              message += `| ${rec.Name || "-"} | ${rec.Status} | ${rec.IntegrationStatus || "-"} | ${lastMod} |\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying metadata cache: ${cacheResult.error}\n\n`;
        }

        // Summary
        message += "---\n\n## Summary\n\n";

        if (issues.length === 0) {
          message += "### Overall Status: READY\n\n";
          message += "No critical issues found in visit management configuration.\n\n";
        } else {
          message += "### Overall Status: NEEDS ATTENTION\n\n";
          message += "### Issues Found\n\n";
          for (let i = 0; i < issues.length; i++) {
            message += `${i + 1}. ${issues[i]}\n`;
          }
          message += "\n";
        }

        if (recommendations.length > 0) {
          message += "### Recommendations\n\n";
          for (let i = 0; i < recommendations.length; i++) {
            message += `${i + 1}. ${recommendations[i]}\n`;
          }
          message += "\n";
        }

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Visit Configuration\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
  server.tool(
    "check_sample_config",
    "Check LSC Sample Management configuration. Queries products, locations, inventory, production batches, sample limits, and related configuration. CORRECT object names: Product2, LifeSciMarketableProduct, Location, ProductionBatch, ProductItem, ProductBatchItem, InventoryOperation, ProductRequest, InventoryCountAssessment, ProductDisbursement, ProviderSampleLimit. WRONG names (DO NOT USE): SampleTransaction__c, SampleInventory__c, SampleLimit__c, SampleProduct__c, SampleLot__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check Sample Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# Sample Management Configuration Report\n\n";
      const issues: string[] = [];
      const recommendations: string[] = [];

      try {
        // 1. Check Product2 records (sample products)
        message += "## Sample Products\n\n";
        const productQuery = `SELECT Id, Name, ProductCode, IsActive, RecordType.Name FROM Product2 WHERE IsActive = true ORDER BY Name LIMIT 50`;
        const productResult = await runSoqlQuery(productQuery, effectiveOrg);

        if (productResult.success && productResult.data?.records) {
          const records = productResult.data.records;

          if (records.length === 0) {
            message += "**No active Product2 records found.**\n\n";
            issues.push("No active sample products configured");
            recommendations.push(
              "Create Product2 records with the record type mapped to LS Sample Product Specification Type"
            );
          } else {
            message += `| Name | Product Code | Record Type |\n`;
            message += `|------|-------------|-------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const rt = rec.RecordType as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${rec.ProductCode || "-"} | ${rt?.Name || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} active product(s)\n\n`;
          }
        } else {
          message += `Error querying products: ${productResult.error}\n\n`;
        }

        // 2. Check LifeSciMarketableProduct records
        message += "## Marketable Products\n\n";
        const mpQuery = `SELECT Id, Name, ProductId, Product.Name FROM LifeSciMarketableProduct ORDER BY Name LIMIT 50`;
        const mpResult = await runSoqlQuery(mpQuery, effectiveOrg);

        if (mpResult.success && mpResult.data?.records) {
          const records = mpResult.data.records;

          if (records.length === 0) {
            message += "**No LifeSciMarketableProduct records found.**\n\n";
            issues.push("No marketable product records configured");
            recommendations.push(
              "Create LifeSciMarketableProduct records for each sample product with distribution method 'Drop' or 'Drop and Ship'"
            );
          } else {
            message += `| Name | Product |\n`;
            message += `|------|---------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const prod = rec.Product as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${prod?.Name || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} marketable product(s)\n\n`;
          }
        } else {
          message += `Error querying marketable products: ${mpResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 3. Check Location records (User Inventory type)
        message += "## Inventory Locations\n\n";
        const locationQuery = `SELECT Id, Name, LocationType, PrimaryUserId, PrimaryUser.Name FROM Location WHERE LocationType = 'User Inventory' LIMIT 50`;
        const locationResult = await runSoqlQuery(locationQuery, effectiveOrg);

        if (locationResult.success && locationResult.data?.records) {
          const records = locationResult.data.records;

          if (records.length === 0) {
            message += "**No User Inventory locations found.**\n\n";
            issues.push("No User Inventory locations configured");
            recommendations.push(
              "Create Location records with LocationType = 'User Inventory' and assign a Primary User to each"
            );
          } else {
            const withUser = records.filter(
              (r) => (r as Record<string, unknown>).PrimaryUserId !== null
            );
            const withoutUser = records.filter(
              (r) => (r as Record<string, unknown>).PrimaryUserId === null
            );

            message += `| Name | Primary User |\n`;
            message += `|------|--------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const user = rec.PrimaryUser as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${user?.Name || "**NOT ASSIGNED**"} |\n`;
            }
            message += `\n**Total:** ${records.length} location(s) (${withUser.length} with Primary User)\n\n`;

            if (withoutUser.length > 0) {
              issues.push(
                `${withoutUser.length} inventory location(s) without a Primary User assigned`
              );
              recommendations.push("Assign a Primary User to all User Inventory locations");
            }
          }
        } else {
          message += `Error querying locations: ${locationResult.error}\n\n`;
        }

        // 4. Check ProductionBatch records (active)
        message += "## Production Batches\n\n";
        const batchQuery = `SELECT Id, Name, UniqueIdentificationNumber, ExpirationDate, IsActive FROM ProductionBatch WHERE IsActive = true ORDER BY ExpirationDate LIMIT 50`;
        const batchResult = await runSoqlQuery(batchQuery, effectiveOrg);

        if (batchResult.success && batchResult.data?.records) {
          const records = batchResult.data.records;

          if (records.length === 0) {
            message += "**No active ProductionBatch records found.**\n\n";
            issues.push("No active production batches");
            recommendations.push(
              "Create ProductionBatch records with unique identification numbers, expiry dates, and UOM = 'Each'"
            );
          } else {
            const now = new Date();
            const expired = records.filter((r) => {
              const exp = (r as Record<string, unknown>).ExpirationDate;
              return exp && new Date(String(exp)) < now;
            });

            message += `| Name | Lot Number | Expiration Date | Status |\n`;
            message += `|------|------------|-----------------|--------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const expDate = rec.ExpirationDate
                ? String(rec.ExpirationDate).substring(0, 10)
                : "-";
              const isExpired = rec.ExpirationDate && new Date(String(rec.ExpirationDate)) < now;
              message += `| ${rec.Name} | ${rec.UniqueIdentificationNumber || "-"} | ${expDate} | ${isExpired ? "**EXPIRED**" : "Active"} |\n`;
            }
            message += `\n**Total:** ${records.length} active batch(es)`;
            if (expired.length > 0) {
              message += ` (${expired.length} expired)`;
            }
            message += "\n\n";

            if (expired.length === records.length) {
              issues.push("All active production batches are expired");
              recommendations.push(
                "Create new ProductionBatch records with future expiration dates"
              );
            } else if (expired.length > 0) {
              recommendations.push(
                `${expired.length} production batch(es) are expired — consider creating replacements`
              );
            }
          }
        } else {
          message += `Error querying production batches: ${batchResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 5. Check ProductItem records (inventory levels)
        message += "## Inventory Levels (ProductItem)\n\n";
        const piQuery = `SELECT Id, Product2Id, Product2.Name, QuantityOnHand, Location.Name FROM ProductItem ORDER BY Product2.Name LIMIT 50`;
        const piResult = await runSoqlQuery(piQuery, effectiveOrg);

        if (piResult.success && piResult.data?.records) {
          const records = piResult.data.records;

          if (records.length === 0) {
            message += "**No ProductItem records found. Inventory not initialized.**\n\n";
            issues.push("No ProductItem records — inventory not initialized");
            recommendations.push(
              "Create ProductItem records (one per location-product pair) and use InventoryOperation (Transfer In) to set quantities"
            );
          } else {
            const zeroQty = records.filter(
              (r) => (r as Record<string, unknown>).QuantityOnHand === 0
            );

            message += `| Product | Location | Qty on Hand |\n`;
            message += `|---------|----------|-------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const prod = rec.Product2 as Record<string, unknown> | null;
              const loc = rec.Location as Record<string, unknown> | null;
              message += `| ${prod?.Name || "-"} | ${loc?.Name || "-"} | ${rec.QuantityOnHand} |\n`;
            }
            message += `\n**Total:** ${records.length} product item(s)`;
            if (zeroQty.length > 0) {
              message += ` (${zeroQty.length} with zero quantity)`;
            }
            message += "\n\n";
          }
        } else {
          message += `Error querying product items: ${piResult.error}\n\n`;
        }

        // 6. Check ProductBatchItem records
        message += "## Batch Allocations (ProductBatchItem)\n\n";
        const pbiQuery = `SELECT COUNT() FROM ProductBatchItem WHERE IsActive = true`;
        const pbiResult = await runSoqlQuery(pbiQuery, effectiveOrg);

        if (pbiResult.success && pbiResult.data) {
          const count = pbiResult.data.totalSize;
          message += `**Active ProductBatchItem records:** ${count}\n\n`;

          if (count === 0) {
            message += "No active batch allocations found. Batch-level tracking will not work.\n\n";
            recommendations.push(
              "Create ProductBatchItem records linking ProductionBatch to ProductItem records"
            );
          }
        } else {
          message += `Error querying batch allocations: ${pbiResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 7. Check ProviderSampleLimit records
        message += "## Sample Limits\n\n";
        const limitQuery = `SELECT Id, AccountId, Account.Name, ProductId, Product.Name FROM ProviderSampleLimit ORDER BY Account.Name LIMIT 50`;
        const limitResult = await runSoqlQuery(limitQuery, effectiveOrg);

        if (limitResult.success && limitResult.data?.records) {
          const records = limitResult.data.records;

          if (records.length === 0) {
            message += "**No ProviderSampleLimit records found.**\n\n";
            message += "Sample limits are optional but recommended for PDMA compliance.\n\n";
          } else {
            message += `| Account | Product |\n`;
            message += `|---------|----------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const acct = rec.Account as Record<string, unknown> | null;
              const prod = rec.Product as Record<string, unknown> | null;
              message += `| ${acct?.Name || "-"} | ${prod?.Name || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} sample limit record(s)\n\n`;
          }
        } else {
          // ProviderSampleLimit may not exist in all orgs
          message += `Could not query sample limits: ${limitResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 8. Check mobile metadata cache
        message += "## Mobile Metadata Cache\n\n";
        const cacheQuery = `SELECT Id, Name, Status, IntegrationStatus, LastModifiedDate FROM LifeSciMobileMetadataRecord WHERE Status IN ('Active', 'Published') ORDER BY LastModifiedDate DESC LIMIT 5`;
        const cacheResult = await runSoqlQuery(cacheQuery, effectiveOrg);

        if (cacheResult.success && cacheResult.data?.records) {
          const records = cacheResult.data.records;

          if (records.length === 0) {
            message += "**No active metadata cache found.**\n\n";
            issues.push("No active mobile metadata cache");
            recommendations.push(
              "Generate mobile metadata cache for profiles that need sample management on mobile"
            );
          } else {
            message += `| Name | Status | Integration | Last Modified |\n`;
            message += `|------|--------|-------------|---------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const lastMod = rec.LastModifiedDate
                ? String(rec.LastModifiedDate).substring(0, 19).replace("T", " ")
                : "-";
              message += `| ${rec.Name || "-"} | ${rec.Status} | ${rec.IntegrationStatus || "-"} | ${lastMod} |\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying metadata cache: ${cacheResult.error}\n\n`;
        }

        // Summary
        message += "---\n\n## Summary\n\n";

        if (issues.length === 0) {
          message += "### Overall Status: READY\n\n";
          message += "No critical issues found in sample management configuration.\n\n";
        } else {
          message += "### Overall Status: NEEDS ATTENTION\n\n";
          message += "### Issues Found\n\n";
          for (let i = 0; i < issues.length; i++) {
            message += `${i + 1}. ${issues[i]}\n`;
          }
          message += "\n";
        }

        if (recommendations.length > 0) {
          message += "### Recommendations\n\n";
          for (let i = 0; i < recommendations.length; i++) {
            message += `${i + 1}. ${recommendations[i]}\n`;
          }
          message += "\n";
        }

        message += "### Data Setup Chain Reminder\n\n";
        message += "Records must be created in this order:\n";
        message += "1. Product2 (with sample record type)\n";
        message += "2. LifeSciMarketableProduct (distribution method: Drop or Drop and Ship)\n";
        message += "3. Location (type: User Inventory, with Primary User)\n";
        message += "4. ProductionBatch (unique ID, expiry date, UOM = Each)\n";
        message += "5. ProductItem (one per location-product pair, QOH = 0)\n";
        message += "6. ProductBatchItem (links batch to location, sets Remaining Quantity)\n";

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Sample Configuration\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
  server.tool(
    "check_account_config",
    "Check LSC Account Management configuration. Queries accounts, healthcare providers, addresses, business licenses, affiliations, territory info, DCR managed fields, and mobile cache. CORRECT object names: Account, HealthcareProvider, ContactPointAddress, BusinessLicense, ProviderAffiliation, ProviderAcctTerritoryInfo, LifeSciDataChgDefMngFld. WRONG names (DO NOT USE): HealthcareProvider__c, ContactPointAddress__c, BusinessLicense__c, ProviderAffiliation__c, AccountAddress__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check Account Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# Account Management Configuration Report\n\n";
      const issues: string[] = [];
      const recommendations: string[] = [];

      try {
        // 1. Check Account records (PersonAccount and Business)
        message += "## Accounts\n\n";
        const accountQuery = `SELECT Id, Name, RecordType.Name, IsPersonAccount FROM Account ORDER BY Name LIMIT 50`;
        const accountResult = await runSoqlQuery(accountQuery, effectiveOrg);

        if (accountResult.success && accountResult.data?.records) {
          const records = accountResult.data.records;

          if (records.length === 0) {
            message += "**No Account records found.**\n\n";
            issues.push("No Account records exist in the org");
            recommendations.push(
              "Create Account records — PersonAccount for HCPs and standard accounts for HCOs"
            );
          } else {
            const personAccounts = records.filter(
              (r) => (r as Record<string, unknown>).IsPersonAccount === true
            );
            const businessAccounts = records.filter(
              (r) => (r as Record<string, unknown>).IsPersonAccount === false
            );

            message += `| Name | Record Type | Person Account |\n`;
            message += `|------|-------------|----------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const rt = rec.RecordType as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${rt?.Name || "-"} | ${rec.IsPersonAccount ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} account(s) (${personAccounts.length} Person, ${businessAccounts.length} Business)\n\n`;

            if (personAccounts.length === 0) {
              issues.push(
                "No PersonAccount records found — most LSC implementations require PersonAccount for HCPs"
              );
              recommendations.push(
                "Enable PersonAccount in Setup > Company Information and create PersonAccount records for HCPs"
              );
            }
          }
        } else {
          message += `Error querying accounts: ${accountResult.error}\n\n`;
        }

        // 2. Check HealthcareProvider records
        message += "## Healthcare Providers\n\n";
        const hcpQuery = `SELECT Id, Name, AccountId, Account.Name, Status, ProfessionalTitle FROM HealthcareProvider ORDER BY Name LIMIT 50`;
        const hcpResult = await runSoqlQuery(hcpQuery, effectiveOrg);

        if (hcpResult.success && hcpResult.data?.records) {
          const records = hcpResult.data.records;

          if (records.length === 0) {
            message += "**No HealthcareProvider records found.**\n\n";
            issues.push(
              "No HealthcareProvider records — provider-specific functionality will not work"
            );
            recommendations.push(
              "Create HealthcareProvider records linked to Account records for each HCP"
            );
          } else {
            message += `| Name | Account | Status | Title |\n`;
            message += `|------|---------|--------|-------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const acct = rec.Account as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${acct?.Name || "-"} | ${rec.Status || "-"} | ${rec.ProfessionalTitle || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} healthcare provider(s)\n\n`;
          }
        } else {
          message += `Error querying healthcare providers: ${hcpResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 3. Check ContactPointAddress records
        message += "## Addresses\n\n";
        const addressQuery = `SELECT Id, Name, ParentId, City, State, PostalCode, Country, IsPrimary FROM ContactPointAddress ORDER BY ParentId LIMIT 50`;
        const addressResult = await runSoqlQuery(addressQuery, effectiveOrg);

        if (addressResult.success && addressResult.data?.records) {
          const records = addressResult.data.records;

          if (records.length === 0) {
            message += "**No ContactPointAddress records found.**\n\n";
            issues.push(
              "No address records — accounts need addresses for visits, territory alignment, and compliance"
            );
            recommendations.push(
              "Create ContactPointAddress records linked to accounts via ParentId with City, State, PostalCode, Country"
            );
          } else {
            const primaryCount = records.filter(
              (r) => (r as Record<string, unknown>).IsPrimary === true
            ).length;

            message += `| City | State | Postal Code | Country | Primary |\n`;
            message += `|------|-------|-------------|---------|----------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.City || "-"} | ${rec.State || "-"} | ${rec.PostalCode || "-"} | ${rec.Country || "-"} | ${rec.IsPrimary ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} address(es) (${primaryCount} primary)\n\n`;

            if (primaryCount === 0) {
              recommendations.push("Mark at least one address per account as IsPrimary = true");
            }
          }
        } else {
          message += `Error querying addresses: ${addressResult.error}\n\n`;
        }

        // 4. Check BusinessLicense records
        message += "## Business Licenses\n\n";
        const licenseQuery = `SELECT Id, Name, AccountId, Account.Name, LicenseNumber, Status, ExpirationDate, ComplianceScope, IsLicenseValidated FROM BusinessLicense ORDER BY Account.Name LIMIT 50`;
        const licenseResult = await runSoqlQuery(licenseQuery, effectiveOrg);

        if (licenseResult.success && licenseResult.data?.records) {
          const records = licenseResult.data.records;

          if (records.length === 0) {
            message += "**No BusinessLicense records found.**\n\n";
            message +=
              "Business licenses are optional but required for sample management compliance.\n\n";
          } else {
            const now = new Date();
            const expired = records.filter((r) => {
              const exp = (r as Record<string, unknown>).ExpirationDate;
              return exp && new Date(String(exp)) < now;
            });
            const validated = records.filter(
              (r) => (r as Record<string, unknown>).IsLicenseValidated === true
            );
            const withScope = records.filter(
              (r) => (r as Record<string, unknown>).ComplianceScope != null
            );

            message += `| Account | License # | Status | Expiration | Scope | Validated |\n`;
            message += `|---------|-----------|--------|------------|-------|-----------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const acct = rec.Account as Record<string, unknown> | null;
              const expDate = rec.ExpirationDate
                ? String(rec.ExpirationDate).substring(0, 10)
                : "-";
              const isExpired = rec.ExpirationDate && new Date(String(rec.ExpirationDate)) < now;
              message += `| ${acct?.Name || "-"} | ${rec.LicenseNumber || "-"} | ${rec.Status || "-"} | ${expDate}${isExpired ? " **EXPIRED**" : ""} | ${rec.ComplianceScope || "-"} | ${rec.IsLicenseValidated ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} license(s) (${validated.length} validated, ${expired.length} expired, ${withScope.length} with ComplianceScope)\n\n`;

            if (validated.length === 0 && records.length > 0) {
              issues.push(
                "No licenses are validated — check IsLicenseValidated formula configuration"
              );
              recommendations.push(
                "Configure IsLicenseValidated formula in Admin Console > License Management"
              );
            }
            if (withScope.length === 0 && records.length > 0) {
              recommendations.push(
                "Set ComplianceScope on BusinessLicense records (Jurisdiction State, Address/DEA, or SDL)"
              );
            }
            if (expired.length > 0) {
              recommendations.push(
                `${expired.length} license(s) are expired — review and update or create replacements`
              );
            }
          }
        } else {
          message += `Error querying business licenses: ${licenseResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 5. Check ProviderAffiliation records
        message += "## Affiliations\n\n";
        const affiliationQuery = `SELECT Id, Name, AccountFromId, AccountFrom.Name, AccountToId, AccountTo.Name, Role FROM ProviderAffiliation ORDER BY AccountFrom.Name LIMIT 50`;
        const affiliationResult = await runSoqlQuery(affiliationQuery, effectiveOrg);

        if (affiliationResult.success && affiliationResult.data?.records) {
          const records = affiliationResult.data.records;

          if (records.length === 0) {
            message += "**No ProviderAffiliation records found.**\n\n";
            message += "Affiliations are optional but common for HCP-HCO relationships.\n\n";
          } else {
            const roles = new Set<string>();
            message += `| From Account | To Account | Role |\n`;
            message += `|-------------|-----------|------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const from = rec.AccountFrom as Record<string, unknown> | null;
              const to = rec.AccountTo as Record<string, unknown> | null;
              const role = String(rec.Role || "-");
              if (rec.Role) roles.add(role);
              message += `| ${from?.Name || "-"} | ${to?.Name || "-"} | ${role} |\n`;
            }
            message += `\n**Total:** ${records.length} affiliation(s)\n`;
            if (roles.size > 0) {
              message += `**Roles:** ${Array.from(roles).join(", ")}\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying affiliations: ${affiliationResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 6. Check ProviderAcctTerritoryInfo records
        message += "## Territory Info\n\n";
        const territoryQuery = `SELECT Id, AccountId, Account.Name, LastProviderVisitDate, YearToDateProviderVisitCount FROM ProviderAcctTerritoryInfo ORDER BY Account.Name LIMIT 50`;
        const territoryResult = await runSoqlQuery(territoryQuery, effectiveOrg);

        if (territoryResult.success && territoryResult.data?.records) {
          const records = territoryResult.data.records;

          if (records.length === 0) {
            message += "**No ProviderAcctTerritoryInfo records found.**\n\n";
            message +=
              "Territory info is populated by territory alignment and visit rollup jobs.\n\n";
          } else {
            message += `| Account | Last Visit | YTD Visits |\n`;
            message += `|---------|-----------|------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const acct = rec.Account as Record<string, unknown> | null;
              const lastVisit = rec.LastProviderVisitDate
                ? String(rec.LastProviderVisitDate).substring(0, 10)
                : "-";
              message += `| ${acct?.Name || "-"} | ${lastVisit} | ${rec.YearToDateProviderVisitCount ?? "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} territory info record(s)\n\n`;
          }
        } else {
          message += `Error querying territory info: ${territoryResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 7. Check LifeSciDataChgDefMngFld records (DCR managed fields)
        message += "## DCR Managed Fields\n\n";
        const dcrQuery = `SELECT Id, Name, ObjectApiName, FieldApiName, ApplyChangeImmediately FROM LifeSciDataChgDefMngFld ORDER BY ObjectApiName LIMIT 50`;
        const dcrResult = await runSoqlQuery(dcrQuery, effectiveOrg);

        if (dcrResult.success && dcrResult.data?.records) {
          const records = dcrResult.data.records;

          if (records.length === 0) {
            message += "**No LifeSciDataChgDefMngFld records found.**\n\n";
            message +=
              "DCR managed fields are optional — only needed if data governance workflows are required.\n\n";
          } else {
            const objects = new Set<string>();
            message += `| Object | Field | Apply Immediately |\n`;
            message += `|--------|-------|-------------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const objName = String(rec.ObjectApiName || "-");
              if (rec.ObjectApiName) objects.add(objName);
              message += `| ${objName} | ${rec.FieldApiName || "-"} | ${rec.ApplyChangeImmediately ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} managed field(s) across ${objects.size} object(s)\n`;
            if (objects.size > 0) {
              message += `**Objects:** ${Array.from(objects).join(", ")}\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying DCR managed fields: ${dcrResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 8. Check mobile metadata cache
        message += "## Mobile Metadata Cache\n\n";
        const cacheQuery = `SELECT Id, Name, Status, IntegrationStatus, LastModifiedDate FROM LifeSciMobileMetadataRecord WHERE Status IN ('Active', 'Published') ORDER BY LastModifiedDate DESC LIMIT 5`;
        const cacheResult = await runSoqlQuery(cacheQuery, effectiveOrg);

        if (cacheResult.success && cacheResult.data?.records) {
          const records = cacheResult.data.records;

          if (records.length === 0) {
            message += "**No active metadata cache found.**\n\n";
            issues.push("No active mobile metadata cache");
            recommendations.push(
              "Generate mobile metadata cache for profiles that need account management on mobile"
            );
          } else {
            message += `| Name | Status | Integration | Last Modified |\n`;
            message += `|------|--------|-------------|---------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const lastMod = rec.LastModifiedDate
                ? String(rec.LastModifiedDate).substring(0, 19).replace("T", " ")
                : "-";
              message += `| ${rec.Name || "-"} | ${rec.Status} | ${rec.IntegrationStatus || "-"} | ${lastMod} |\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying metadata cache: ${cacheResult.error}\n\n`;
        }

        // Summary
        message += "---\n\n## Summary\n\n";

        if (issues.length === 0) {
          message += "### Overall Status: READY\n\n";
          message += "No critical issues found in account management configuration.\n\n";
        } else {
          message += "### Overall Status: NEEDS ATTENTION\n\n";
          message += "### Issues Found\n\n";
          for (let i = 0; i < issues.length; i++) {
            message += `${i + 1}. ${issues[i]}\n`;
          }
          message += "\n";
        }

        if (recommendations.length > 0) {
          message += "### Recommendations\n\n";
          for (let i = 0; i < recommendations.length; i++) {
            message += `${i + 1}. ${recommendations[i]}\n`;
          }
          message += "\n";
        }

        message += "### Trigger Handler Reminder\n\n";
        message += "Ensure these trigger handlers are active:\n";
        message += "1. DCRHandler — Data Change Request workflow\n";
        message += "2. HardAffiliationHandler — Prevents duplicate hard affiliations\n";
        message += "3. AffiliationReciprocalHandler — Creates reverse affiliation records\n";
        message +=
          "4. HealthcareProviderAffiliationHandler — Creates primary affiliation to parent org\n";

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Account Configuration\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
  server.tool(
    "check_activity_plan_config",
    "Check LSC Activity Plan configuration. Queries time periods, activity plans, territory assignments, provider activity goals, goal measures, product goals, territory info, and mobile cache. CORRECT object names: ActivityPlan, ActivityPlanTerritory, TimePeriod, ProviderActivityGoal, ProviderActivityGoalMeasure, PrvdActvtyGoalMeasureProdt, ProviderAcctTerritoryInfo. WRONG names (DO NOT USE): ActivityPlan__c, ProviderActivityGoal__c, AccountGoal__c, TimePeriod__c, GoalMeasure__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check Activity Plan Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# Activity Plan Configuration Report\n\n";
      const issues: string[] = [];
      const recommendations: string[] = [];

      try {
        // 1. Check TimePeriod records
        message += "## Time Periods\n\n";
        const tpQuery = `SELECT Id, Name, StartDate, EndDate FROM TimePeriod ORDER BY StartDate DESC LIMIT 50`;
        const tpResult = await runSoqlQuery(tpQuery, effectiveOrg);

        if (tpResult.success && tpResult.data?.records) {
          const records = tpResult.data.records;

          if (records.length === 0) {
            message += "**No TimePeriod records found.**\n\n";
            issues.push(
              "No TimePeriod records — activity plans cannot be created without time periods"
            );
            recommendations.push(
              "Create TimePeriod records with Name, StartDate, and EndDate (e.g., H1 2026: Jan 1 - Jun 30)"
            );
          } else {
            const now = new Date();
            message += `| Name | Start Date | End Date | Status |\n`;
            message += `|------|-----------|----------|--------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const start = rec.StartDate ? String(rec.StartDate).substring(0, 10) : "-";
              const end = rec.EndDate ? String(rec.EndDate).substring(0, 10) : "-";
              const isCurrent =
                rec.StartDate &&
                rec.EndDate &&
                new Date(String(rec.StartDate)) <= now &&
                new Date(String(rec.EndDate)) >= now;
              message += `| ${rec.Name} | ${start} | ${end} | ${isCurrent ? "**Current**" : "Inactive"} |\n`;
            }
            message += `\n**Total:** ${records.length} time period(s)\n\n`;
          }
        } else {
          message += `Error querying time periods: ${tpResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 2. Check ActivityPlan records
        message += "## Activity Plans\n\n";
        const planQuery = `SELECT Id, Name, Status, IsActive, PlanType, TimePeriodId, TimePeriod.Name FROM ActivityPlan ORDER BY CreatedDate DESC LIMIT 50`;
        const planResult = await runSoqlQuery(planQuery, effectiveOrg);

        if (planResult.success && planResult.data?.records) {
          const records = planResult.data.records;

          if (records.length === 0) {
            message += "**No ActivityPlan records found.**\n\n";
            issues.push("No ActivityPlan records exist");
            recommendations.push(
              "Create ActivityPlan records with PlanType, Status, and TimePeriod reference"
            );
          } else {
            const active = records.filter((r) => (r as Record<string, unknown>).IsActive === true);
            const byType: Record<string, number> = {};

            message += `| Name | Status | Active | Plan Type | Time Period |\n`;
            message += `|------|--------|--------|-----------|-------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const tp = rec.TimePeriod as Record<string, unknown> | null;
              const planType = String(rec.PlanType || "-");
              byType[planType] = (byType[planType] || 0) + 1;
              message += `| ${rec.Name} | ${rec.Status || "-"} | ${rec.IsActive ? "Yes" : "No"} | ${planType} | ${tp?.Name || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} plan(s) (${active.length} active)\n`;
            message += `**By Type:** ${Object.entries(byType)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}\n\n`;

            if (active.length === 0) {
              recommendations.push(
                "No active plans found — run the Validate Activity Plans batch job to activate plans based on time periods"
              );
            }
          }
        } else {
          message += `Error querying activity plans: ${planResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 3. Check ActivityPlanTerritory records
        message += "## Territory Assignments\n\n";
        const aptQuery = `SELECT Id, ActivityPlanId, ActivityPlan.Name, TerritoryId FROM ActivityPlanTerritory ORDER BY CreatedDate DESC LIMIT 50`;
        const aptResult = await runSoqlQuery(aptQuery, effectiveOrg);

        if (aptResult.success && aptResult.data?.records) {
          const records = aptResult.data.records;

          if (records.length === 0) {
            message += "**No ActivityPlanTerritory records found.**\n\n";
            if (
              planResult.success &&
              planResult.data?.records &&
              planResult.data.records.length > 0
            ) {
              issues.push(
                "Activity plans exist but no territory assignments — plans need ActivityPlanTerritory records"
              );
              recommendations.push(
                "Create ActivityPlanTerritory records linking each plan to its target territory"
              );
            }
          } else {
            message += `| Activity Plan | Territory ID |\n`;
            message += `|--------------|-------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const plan = rec.ActivityPlan as Record<string, unknown> | null;
              message += `| ${plan?.Name || "-"} | ${rec.TerritoryId || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} territory assignment(s)\n\n`;
          }
        } else {
          message += `Error querying territory assignments: ${aptResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 4. Check ProviderActivityGoal records
        message += "## Provider Activity Goals\n\n";
        const goalQuery = `SELECT Id, Name, ActivityPlanId, ActivityPlan.Name, AccountId, Account.Name, OverallGoal, ProductLevelGoal, NonProductLevelGoal FROM ProviderActivityGoal ORDER BY Account.Name LIMIT 50`;
        const goalResult = await runSoqlQuery(goalQuery, effectiveOrg);

        if (goalResult.success && goalResult.data?.records) {
          const records = goalResult.data.records;

          if (records.length === 0) {
            message += "**No ProviderActivityGoal records found.**\n\n";
            if (
              planResult.success &&
              planResult.data?.records &&
              planResult.data.records.length > 0
            ) {
              issues.push(
                "Activity plans exist but no account goals — plans need ProviderActivityGoal records per target account"
              );
              recommendations.push(
                "Create ProviderActivityGoal records for each target account with OverallGoal, ProductLevelGoal, NonProductLevelGoal"
              );
            }
          } else {
            message += `| Account | Plan | Overall Goal | Product Goal | Non-Product Goal |\n`;
            message += `|---------|------|-------------|-------------|------------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const acct = rec.Account as Record<string, unknown> | null;
              const plan = rec.ActivityPlan as Record<string, unknown> | null;
              message += `| ${acct?.Name || "-"} | ${plan?.Name || "-"} | ${rec.OverallGoal ?? "-"} | ${rec.ProductLevelGoal ?? "-"} | ${rec.NonProductLevelGoal ?? "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} account goal(s)\n\n`;
          }
        } else {
          message += `Error querying provider activity goals: ${goalResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 5. Check ProviderActivityGoalMeasure records
        message += "## Goal Measures\n\n";
        const measureQuery = `SELECT COUNT() FROM ProviderActivityGoalMeasure`;
        const measureResult = await runSoqlQuery(measureQuery, effectiveOrg);

        if (measureResult.success && measureResult.data) {
          const count = measureResult.data.totalSize;
          message += `**ProviderActivityGoalMeasure records:** ${count}\n\n`;

          if (count === 0) {
            if (
              goalResult.success &&
              goalResult.data?.records &&
              goalResult.data.records.length > 0
            ) {
              recommendations.push(
                "Account goals exist but no goal measures — create ProviderActivityGoalMeasure records to define activity type targets"
              );
            }
          }
        } else {
          message += `Error querying goal measures: ${measureResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 6. Check PrvdActvtyGoalMeasureProdt records
        message += "## Product Goal Measures\n\n";
        const prodMeasureQuery = `SELECT COUNT() FROM PrvdActvtyGoalMeasureProdt`;
        const prodMeasureResult = await runSoqlQuery(prodMeasureQuery, effectiveOrg);

        if (prodMeasureResult.success && prodMeasureResult.data) {
          const count = prodMeasureResult.data.totalSize;
          message += `**PrvdActvtyGoalMeasureProdt records:** ${count}\n\n`;

          if (count === 0) {
            message += "No product goal measures found. Product-level tracking is optional.\n\n";
          }
        } else {
          message += `Error querying product goal measures: ${prodMeasureResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 7. Check ProviderAcctTerritoryInfo records
        message += "## Territory Info\n\n";
        const territoryQuery = `SELECT COUNT() FROM ProviderAcctTerritoryInfo`;
        const territoryResult = await runSoqlQuery(territoryQuery, effectiveOrg);

        if (territoryResult.success && territoryResult.data) {
          const count = territoryResult.data.totalSize;
          message += `**ProviderAcctTerritoryInfo records:** ${count}\n\n`;

          if (count === 0) {
            recommendations.push(
              "No ProviderAcctTerritoryInfo records — run territory alignment to create these records for activity plan tracking"
            );
          }
        } else {
          message += `Error querying territory info: ${territoryResult.error}\n\n`;
        }

        // 8. Check mobile metadata cache
        message += "## Mobile Metadata Cache\n\n";
        const cacheQuery = `SELECT Id, Name, Status, IntegrationStatus, LastModifiedDate FROM LifeSciMobileMetadataRecord WHERE Status IN ('Active', 'Published') ORDER BY LastModifiedDate DESC LIMIT 5`;
        const cacheResult = await runSoqlQuery(cacheQuery, effectiveOrg);

        if (cacheResult.success && cacheResult.data?.records) {
          const records = cacheResult.data.records;

          if (records.length === 0) {
            message += "**No active metadata cache found.**\n\n";
            issues.push("No active mobile metadata cache");
            recommendations.push(
              "Generate mobile metadata cache for profiles that need activity plans on mobile"
            );
          } else {
            message += `| Name | Status | Integration | Last Modified |\n`;
            message += `|------|--------|-------------|---------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const lastMod = rec.LastModifiedDate
                ? String(rec.LastModifiedDate).substring(0, 19).replace("T", " ")
                : "-";
              message += `| ${rec.Name || "-"} | ${rec.Status} | ${rec.IntegrationStatus || "-"} | ${lastMod} |\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying metadata cache: ${cacheResult.error}\n\n`;
        }

        // Summary
        message += "---\n\n## Summary\n\n";

        if (issues.length === 0) {
          message += "### Overall Status: READY\n\n";
          message += "No critical issues found in activity plan configuration.\n\n";
        } else {
          message += "### Overall Status: NEEDS ATTENTION\n\n";
          message += "### Issues Found\n\n";
          for (let i = 0; i < issues.length; i++) {
            message += `${i + 1}. ${issues[i]}\n`;
          }
          message += "\n";
        }

        if (recommendations.length > 0) {
          message += "### Recommendations\n\n";
          for (let i = 0; i < recommendations.length; i++) {
            message += `${i + 1}. ${recommendations[i]}\n`;
          }
          message += "\n";
        }

        message += "### Data Setup Chain Reminder\n\n";
        message += "Records must be created in this order:\n";
        message += "1. TimePeriod (plan duration with start/end dates)\n";
        message += "2. ActivityPlan (master plan with type, status, time period)\n";
        message += "3. ActivityPlanTerritory (link plan to territories)\n";
        message += "4. ProviderActivityGoal (account-level goals per target HCP)\n";
        message += "5. ProviderActivityGoalMeasure (activity type targets per goal)\n";
        message += "6. PrvdActvtyGoalMeasureProdt (optional: product-specific targets)\n";
        message += "\n### Trigger Handler Reminder\n\n";
        message += "Ensure these trigger handlers are active:\n";
        message += "1. ActivityPlanTerritoryValidationHandler\n";
        message += "2. ActivityPlanValidationHandler\n";
        message += "3. ActivityPlanTerritoryModHandler\n";
        message += "4. ActivityPlanTerritorySharingHandler\n";
        message += "5. PAPATerritoryUpdateHandler\n";
        message += "6. PAPAApproveProcessHandler\n";

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Activity Plan Configuration\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
  server.tool(
    "check_territory_config",
    "Check LSC Territory Alignment configuration. Queries Territory2 model, ObjectTerritory2Association (explicit assignments), TerrGeoAssignmentRule (zip/brick rules), TerrProvAffilAssignRule (affiliation rules), and ProviderAcctTerritoryInfo records. CORRECT object names: Territory2, ObjectTerritory2Association, TerrGeoAssignmentRule, TerrProvAffilAssignRule, ProviderAcctTerritoryInfo. WRONG names (DO NOT USE): AccountTerritory__c, TerritoryAssignment__c, TerritoryInfo__c, AffiliationAlignmentRule__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check Territory Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# Territory Alignment Configuration Report\n\n";
      const issues: string[] = [];
      const recommendations: string[] = [];

      try {
        // 1. Check Territory2 Model
        message += "## Territory Model\n\n";
        const modelQuery = `SELECT Id, Name, State FROM Territory2Model ORDER BY Name LIMIT 10`;
        const modelResult = await runSoqlQuery(modelQuery, effectiveOrg);

        if (modelResult.success && modelResult.data?.records) {
          const records = modelResult.data.records;
          if (records.length === 0) {
            message += "**No Territory2Model found.**\n\n";
            issues.push(
              "No Territory Model exists — Enterprise Territory Management must be enabled and a model created"
            );
            recommendations.push(
              "Enable Territory Management in Setup and create a Territory Model"
            );
          } else {
            const activeModel = records.find(
              (r) => (r as Record<string, unknown>).State === "Active"
            );
            message += `| Name | State |\n|------|-------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.Name} | ${rec.State} |\n`;
            }
            message += "\n";
            if (!activeModel) {
              issues.push(
                "No Territory Model is in Active state — territory alignment will not function"
              );
              recommendations.push("Activate a Territory Model in Setup > Territory Models");
            }
          }
        } else {
          message += `Error querying Territory Models: ${modelResult.error}\n\n`;
          message += "Enterprise Territory Management may not be enabled in this org.\n\n";
        }

        // 2. Check Territory2 records
        message += "## Territories\n\n";
        const territoryQuery = `SELECT Id, Name, Territory2TypeId, Territory2Type.Name, ParentTerritory2Id FROM Territory2 ORDER BY Name LIMIT 50`;
        const territoryResult = await runSoqlQuery(territoryQuery, effectiveOrg);

        if (territoryResult.success && territoryResult.data?.records) {
          const records = territoryResult.data.records;
          if (records.length === 0) {
            message += "**No Territory2 records found.**\n\n";
            issues.push(
              "No territories exist — territory hierarchy must be built before alignment"
            );
            recommendations.push("Create Territory2 records to build the territory hierarchy");
          } else {
            const types = new Set<string>();
            message += `| Name | Type | Has Parent |\n|------|------|------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const t2type = rec.Territory2Type as Record<string, unknown> | null;
              if (t2type?.Name) types.add(String(t2type.Name));
              message += `| ${rec.Name} | ${t2type?.Name || "-"} | ${rec.ParentTerritory2Id ? "Yes" : "No (root)"} |\n`;
            }
            message += `\n**Total:** ${records.length} territory(ies)\n`;
            if (types.size > 0) {
              message += `**Types:** ${Array.from(types).join(", ")}\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying territories: ${territoryResult.error}\n\n`;
        }

        // 3. Check ObjectTerritory2Association (explicit assignments)
        message += "## Explicit Account-to-Territory Assignments (ObjectTerritory2Association)\n\n";
        const assocQuery = `SELECT Id, ObjectId, Territory2Id, Territory2.Name, AssociationCause FROM ObjectTerritory2Association WHERE SobjectType = 'Account' ORDER BY Territory2.Name LIMIT 50`;
        const assocResult = await runSoqlQuery(assocQuery, effectiveOrg);

        if (assocResult.success && assocResult.data?.records) {
          const records = assocResult.data.records;
          if (records.length === 0) {
            message += "**No ObjectTerritory2Association records found for Account.**\n\n";
            message +=
              "Explicit assignments are the input for the Align Account to Territory batch job.\n\n";
            recommendations.push(
              "Create ObjectTerritory2Association records to explicitly assign accounts to territories, or set up geo alignment rules"
            );
          } else {
            const territories = new Set<string>();
            message += `| Account ID | Territory | Association Type |\n|-----------|-----------|------------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const t2 = rec.Territory2 as Record<string, unknown> | null;
              if (t2?.Name) territories.add(String(t2.Name));
              message += `| ${rec.ObjectId} | ${t2?.Name || rec.Territory2Id} | ${rec.AssociationCause || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} explicit assignment(s) across ${territories.size} territory(ies)\n\n`;
          }
        } else {
          message += `Error querying account-territory associations: ${assocResult.error}\n\n`;
        }

        // 4. Check TerrGeoAssignmentRule
        message += "## Geo Assignment Rules (Zip/Brick)\n\n";
        const geoQuery = `SELECT Id, Name, Territory2Id, Territory2.Name, UsageType, GeoCode, EffectiveStartDate, EffectiveEndDate FROM TerrGeoAssignmentRule ORDER BY UsageType, Territory2.Name LIMIT 50`;
        const geoResult = await runSoqlQuery(geoQuery, effectiveOrg);

        if (geoResult.success && geoResult.data?.records) {
          const records = geoResult.data.records;
          if (records.length === 0) {
            message += "**No TerrGeoAssignmentRule records found.**\n\n";
            message +=
              "Geo rules are optional — only needed if using zip-to-territory or brick-to-territory alignment.\n\n";
          } else {
            // Geo rules have no active flag; a rule applies between its effective dates.
            const today = new Date().toISOString().slice(0, 10);
            const inEffect = (r: Record<string, unknown>) =>
              (!r.EffectiveStartDate || String(r.EffectiveStartDate) <= today) &&
              (!r.EffectiveEndDate || String(r.EffectiveEndDate) >= today);
            const activeCount = records.filter((r) => inEffect(r as Record<string, unknown>)).length;
            const zipCount = records.filter(
              (r) => (r as Record<string, unknown>).UsageType === "ZipToTerritory"
            ).length;
            const brickCount = records.filter(
              (r) => (r as Record<string, unknown>).UsageType === "BrickToTerritory"
            ).length;

            message += `| Name | Territory | Geo Code | Usage Type | In Effect |\n|------|-----------|----------|-----------|-----------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const t2 = rec.Territory2 as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${t2?.Name || "-"} | ${rec.GeoCode || "-"} | ${rec.UsageType || "-"} | ${inEffect(rec) ? "Yes" : "No"} |\n`;
            }
            message += `\n**Total:** ${records.length} geo rule(s) (${zipCount} zip, ${brickCount} brick, ${activeCount} in effect today)\n\n`;

            if (activeCount < records.length) {
              recommendations.push(
                `${records.length - activeCount} geo rule(s) are outside their effective dates — extend the dates if they should still align accounts`
              );
            }
          }
        } else {
          message += `Error querying geo assignment rules: ${geoResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 5. Check TerrProvAffilAssignRule
        message += "## Affiliation Alignment Rules\n\n";
        const affRuleQuery = `SELECT Id, Name, Territory2Id, Territory2.Name, AccountType, AffiliationRole FROM TerrProvAffilAssignRule ORDER BY Territory2.Name LIMIT 50`;
        const affRuleResult = await runSoqlQuery(affRuleQuery, effectiveOrg);

        if (affRuleResult.success && affRuleResult.data?.records) {
          const records = affRuleResult.data.records;
          if (records.length === 0) {
            message += "**No TerrProvAffilAssignRule records found.**\n\n";
            message +=
              "Affiliation rules are optional — only needed if aligning affiliated accounts (HCPs at HCOs) based on provider affiliations.\n\n";
          } else {
            const roles = new Set<string>();

            message += `| Territory | Account Type | Affiliation Role |\n|-----------|-------------|-----------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const t2 = rec.Territory2 as Record<string, unknown> | null;
              if (rec.AffiliationRole) roles.add(String(rec.AffiliationRole));
              message += `| ${t2?.Name || "-"} | ${rec.AccountType || "-"} | ${rec.AffiliationRole || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} affiliation rule(s)\n`;
            if (roles.size > 0) {
              message += `**Roles used:** ${Array.from(roles).join(", ")}\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying affiliation alignment rules: ${affRuleResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // 6. Check ProviderAcctTerritoryInfo
        message += "## Provider Account Territory Info (ProviderAcctTerritoryInfo)\n\n";
        const patiQuery = `SELECT Id, AccountId, Account.Name, Territory2Id, Territory2.Name, LastProviderVisitDate, YearToDateProviderVisitCount FROM ProviderAcctTerritoryInfo ORDER BY Account.Name LIMIT 50`;
        const patiResult = await runSoqlQuery(patiQuery, effectiveOrg);

        if (patiResult.success && patiResult.data?.records) {
          const records = patiResult.data.records;
          if (records.length === 0) {
            message += "**No ProviderAcctTerritoryInfo records found.**\n\n";
            issues.push(
              "No ProviderAcctTerritoryInfo records — the Align Account to Territory batch job has not been run or no assignments exist"
            );
            recommendations.push(
              "Run the 'Align Account to Territory' batch job from Admin Console > Territory Management Jobs"
            );
          } else {
            const territories = new Set<string>();
            message += `| Account | Territory | Last Visit | YTD Visits |\n|---------|-----------|-----------|------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const acct = rec.Account as Record<string, unknown> | null;
              const t2 = rec.Territory2 as Record<string, unknown> | null;
              if (t2?.Name) territories.add(String(t2.Name));
              const lastVisit = rec.LastProviderVisitDate
                ? String(rec.LastProviderVisitDate).substring(0, 10)
                : "-";
              message += `| ${acct?.Name || rec.AccountId} | ${t2?.Name || "-"} | ${lastVisit} | ${rec.YearToDateProviderVisitCount ?? "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} territory info record(s) across ${territories.size} territory(ies)\n\n`;
          }
        } else {
          message += `Error querying ProviderAcctTerritoryInfo: ${patiResult.error}\n\n`;
          message += "This object may not be available in the org.\n\n";
        }

        // Summary
        message += "---\n\n## Summary\n\n";

        if (issues.length === 0) {
          message += "### Overall Status: CONFIGURED\n\n";
          message += "No critical issues found in territory alignment configuration.\n\n";
        } else {
          message += "### Overall Status: NEEDS ATTENTION\n\n";
          message += "### Issues Found\n\n";
          for (let i = 0; i < issues.length; i++) {
            message += `${i + 1}. ${issues[i]}\n`;
          }
          message += "\n";
        }

        if (recommendations.length > 0) {
          message += "### Recommendations\n\n";
          for (let i = 0; i < recommendations.length; i++) {
            message += `${i + 1}. ${recommendations[i]}\n`;
          }
          message += "\n";
        }

        message += "### Batch Jobs Reminder\n\n";
        message +=
          "Run these jobs from Admin Console > Territory Management Jobs when assignments or rules change:\n";
        message +=
          "1. **Align Account to Territory** — processes ObjectTerritory2Association records\n";
        message += "2. **Align Zip to Territory** — processes zip-to-territory geo rules\n";
        message += "3. **Align Brick to Territory** — processes brick-to-territory geo rules\n";
        message +=
          "4. **Affiliation Alignment** — runs automatically after the above three jobs if affiliation rules exist\n";

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Territory Configuration\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
  server.tool(
    "check_user_config",
    "Check LSC User Management configuration. Queries PackageLicense capacity, PermissionSetLicense (PSL) capacity, permission set assignments, user profiles, role hierarchy, and user-territory associations. CORRECT object names: User, Profile, UserRole, PermissionSet, PermissionSetAssignment, PermissionSetLicense, PermissionSetLicenseAssign, UserTerritory2Association, PackageLicense. WRONG names (DO NOT USE): User__c, UserProfile__c, PermissionSetAssignment__c, PSLAssignment__c, UserTerritory__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        const instructions = validation.setupInstructions;
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Check User Configuration\n\n${validation.error}\n\n## ${instructions?.title}\n\n${instructions?.description}\n\n${instructions?.command ? `\`\`\`bash\n${instructions.command}\n\`\`\`` : ""}`,
            },
          ],
        };
      }

      let message = "# User Management Configuration Report\n\n";
      const issues: string[] = [];
      const recommendations: string[] = [];

      try {
        // 1. Check Package Licenses
        message += "## Package Licenses\n\n";
        const pkgQuery = `SELECT NamespacePrefix, AllowedLicenses, UsedLicenses, Status FROM PackageLicense WHERE NamespacePrefix IN ('lsc4ce', 'HealthCloudGA', 'industrywavedemo') ORDER BY NamespacePrefix`;
        const pkgResult = await runSoqlQuery(pkgQuery, effectiveOrg);

        if (pkgResult.success && pkgResult.data?.records) {
          const records = pkgResult.data.records;
          if (records.length === 0) {
            message += "**No LSC-related package licenses found.**\n\n";
            issues.push("No LSC package licenses detected — LSC packages may not be installed");
          } else {
            message += `| Namespace | Allowed | Used | Available | Status |\n|-----------|---------|------|-----------|--------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const allowed = Number(rec.AllowedLicenses) || 0;
              const used = Number(rec.UsedLicenses) || 0;
              const available = allowed - used;
              message += `| ${rec.NamespacePrefix} | ${allowed} | ${used} | ${available} | ${rec.Status} |\n`;
              if (available === 0 && allowed > 0) {
                issues.push(
                  `Package license '${rec.NamespacePrefix}' has 0 available licenses — no new users can be provisioned`
                );
              } else if (available > 0 && available <= Math.ceil(allowed * 0.1)) {
                recommendations.push(
                  `Package license '${rec.NamespacePrefix}' is at ${Math.round((used / allowed) * 100)}% capacity (${available} remaining)`
                );
              }
            }
            message += "\n";
          }
        } else {
          message += `Error querying package licenses: ${pkgResult.error}\n\n`;
        }

        // 2. Check Permission Set Licenses
        message += "## Permission Set Licenses (PSLs)\n\n";
        const pslQuery = `SELECT DeveloperName, MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE DeveloperName LIKE '%LifeScience%' OR DeveloperName LIKE '%HealthCloud%' OR DeveloperName LIKE '%IndustrySales%' OR DeveloperName LIKE '%CLM%' OR DeveloperName LIKE '%SampleManagement%' ORDER BY DeveloperName`;
        const pslResult = await runSoqlQuery(pslQuery, effectiveOrg);

        if (pslResult.success && pslResult.data?.records) {
          const records = pslResult.data.records;
          if (records.length === 0) {
            message += "**No LSC-related PSLs found.**\n\n";
            issues.push(
              "No LSC Permission Set Licenses found — LSC packages may not be installed or licensed"
            );
          } else {
            message += `| PSL | Total | Used | Available |\n|-----|-------|------|-----------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const total = Number(rec.TotalLicenses) || 0;
              const used = Number(rec.UsedLicenses) || 0;
              const available = total - used;
              message += `| ${rec.MasterLabel} | ${total} | ${used} | ${available} |\n`;
              if (available === 0 && total > 0) {
                issues.push(
                  `PSL '${rec.MasterLabel}' has 0 available — cannot assign to new users`
                );
              } else if (available > 0 && available < 5) {
                recommendations.push(
                  `PSL '${rec.MasterLabel}' has only ${available} license(s) remaining`
                );
              }
            }
            message += "\n";
          }
        } else {
          message += `Error querying PSLs: ${pslResult.error}\n\n`;
        }

        // 3. Check LSC Permission Sets
        message += "## LSC Permission Sets\n\n";
        const psQuery = `SELECT Id, Name, Label, NamespacePrefix FROM PermissionSet WHERE (NamespacePrefix IN ('lsc4ce', 'HealthCloudGA') OR Label LIKE '%Life Science%' OR Label LIKE '%Sample%' OR Label LIKE '%CLM%') AND IsOwnedByProfile = false ORDER BY Label`;
        const psResult = await runSoqlQuery(psQuery, effectiveOrg);

        if (psResult.success && psResult.data?.records) {
          const records = psResult.data.records;
          if (records.length === 0) {
            message += "**No LSC permission sets found.**\n\n";
          } else {
            // Get assignment counts
            const psIds = records.map((r) => `'${(r as Record<string, unknown>).Id}'`).join(",");
            const assignCountQuery = `SELECT PermissionSetId, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSetId IN (${psIds}) GROUP BY PermissionSetId`;
            const assignCountResult = await runSoqlQuery(assignCountQuery, effectiveOrg);
            const assignCounts = new Map<string, number>();
            if (assignCountResult.success && assignCountResult.data?.records) {
              for (const rec of assignCountResult.data.records) {
                const r = rec as Record<string, unknown>;
                assignCounts.set(String(r.PermissionSetId), Number(r.cnt) || 0);
              }
            }

            message += `| Label | Namespace | Assignments |\n|-------|-----------|-------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const count = assignCounts.get(String(rec.Id)) || 0;
              message += `| ${rec.Label} | ${rec.NamespacePrefix || "-"} | ${count} |\n`;
            }
            message += "\n";
          }
        } else {
          message += `Error querying permission sets: ${psResult.error}\n\n`;
        }

        // 4. Check Active Users by Profile
        message += "## Active Users by Profile\n\n";
        // Alias Profile.Name explicitly: aggregate (GROUP BY) queries return
        // relationship fields as a flat aliased column, NOT as a nested object.
        const profileQuery = `SELECT Profile.Name profileName, COUNT(Id) userCount FROM User WHERE IsActive = true GROUP BY Profile.Name ORDER BY COUNT(Id) DESC`;
        const profileResult = await runSoqlQuery(profileQuery, effectiveOrg);

        if (profileResult.success && profileResult.data?.records) {
          const records = profileResult.data.records;
          message += `| Profile | Active Users |\n|---------|--------------|\n`;
          for (const record of records) {
            const rec = record as Record<string, unknown>;
            const profileName = rec.profileName as string | null;
            message += `| ${profileName || "Unknown"} | ${rec.userCount} |\n`;
          }
          message += "\n";
        } else {
          message += `Error querying user profiles: ${profileResult.error}\n\n`;
        }

        // 5. Check Role Hierarchy
        message += "## Role Hierarchy\n\n";
        const roleQuery = `SELECT Id, Name, DeveloperName, ParentRoleId FROM UserRole ORDER BY Name LIMIT 100`;
        const roleResult = await runSoqlQuery(roleQuery, effectiveOrg);

        if (roleResult.success && roleResult.data?.records) {
          const records = roleResult.data.records;
          if (records.length === 0) {
            message += "**No UserRole records found.**\n\n";
            issues.push(
              "No role hierarchy exists — data visibility will not work correctly for managers"
            );
            recommendations.push(
              "Create a role hierarchy in Setup > Roles matching the territory structure"
            );
          } else {
            const rootCount = records.filter(
              (r) => !(r as Record<string, unknown>).ParentRoleId
            ).length;
            message += `| Role | Has Parent |\n|------|------------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              message += `| ${rec.Name} | ${rec.ParentRoleId ? "Yes" : "No (root)"} |\n`;
            }
            message += `\n**Total:** ${records.length} role(s), ${rootCount} root role(s)\n\n`;
          }
        } else {
          message += `Error querying roles: ${roleResult.error}\n\n`;
        }

        // 6. Check User-Territory Associations
        message += "## User-Territory Associations\n\n";
        const utaQuery = `SELECT UserId, User.Name, User.Username, Territory2Id, Territory2.Name, RoleInTerritory2 FROM UserTerritory2Association ORDER BY Territory2.Name, User.Name LIMIT 100`;
        const utaResult = await runSoqlQuery(utaQuery, effectiveOrg);

        if (utaResult.success && utaResult.data?.records) {
          const records = utaResult.data.records;
          if (records.length === 0) {
            message += "**No UserTerritory2Association records found.**\n\n";
            issues.push("No users are assigned to territories — users will not see account data");
            recommendations.push(
              "Assign users to territories in Setup > Territory Models > [Model] > [Territory] > Assigned Users"
            );
          } else {
            const territories = new Set<string>();
            const users = new Set<string>();
            message += `| User | Territory | Role |\n|------|-----------|------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const user = rec.User as Record<string, unknown> | null;
              const t2 = rec.Territory2 as Record<string, unknown> | null;
              if (t2?.Name) territories.add(String(t2.Name));
              if (rec.UserId) users.add(String(rec.UserId));
              message += `| ${user?.Name || rec.UserId} | ${t2?.Name || "-"} | ${rec.RoleInTerritory2 || "-"} |\n`;
            }
            message += `\n**Total:** ${records.length} association(s), ${users.size} user(s) across ${territories.size} territory(ies)\n\n`;
          }
        } else {
          message += `Error querying user-territory associations: ${utaResult.error}\n\n`;
          message += "Enterprise Territory Management may not be enabled.\n\n";
        }

        // 7. Check for LSC users without territory assignments
        message += "## Users Without Territory Assignments\n\n";
        const noTerritoryQuery = `SELECT Id, Name, Username, Profile.Name FROM User WHERE IsActive = true AND Id NOT IN (SELECT UserId FROM UserTerritory2Association) AND (Profile.Name LIKE '%Life Science%' OR Profile.Name LIKE '%LSC%') ORDER BY Name LIMIT 50`;
        const noTerritoryResult = await runSoqlQuery(noTerritoryQuery, effectiveOrg);

        if (noTerritoryResult.success && noTerritoryResult.data?.records) {
          const records = noTerritoryResult.data.records;
          if (records.length === 0) {
            message += "All LSC-profiled users have territory assignments.\n\n";
          } else {
            message += `| Name | Username | Profile |\n|------|----------|---------|\n`;
            for (const record of records) {
              const rec = record as Record<string, unknown>;
              const profile = rec.Profile as Record<string, unknown> | null;
              message += `| ${rec.Name} | ${rec.Username} | ${profile?.Name || "-"} |\n`;
            }
            message += `\n**${records.length} LSC user(s) without territory assignments.**\n\n`;
            issues.push(
              `${records.length} active LSC user(s) have no territory assignment — they cannot see account data`
            );
            recommendations.push("Assign these users to territories in Setup > Territory Models");
          }
        } else {
          // Non-fatal — the subquery may fail if Territory Management isn't enabled
          message += "Could not check (Territory Management may not be enabled).\n\n";
        }

        // Summary
        message += "---\n\n## Summary\n\n";

        if (issues.length === 0) {
          message += "### Overall Status: CONFIGURED\n\n";
          message += "No critical issues found in user management configuration.\n\n";
        } else {
          message += "### Overall Status: NEEDS ATTENTION\n\n";
          message += "### Issues Found\n\n";
          for (let i = 0; i < issues.length; i++) {
            message += `${i + 1}. ${issues[i]}\n`;
          }
          message += "\n";
        }

        if (recommendations.length > 0) {
          message += "### Recommendations\n\n";
          for (let i = 0; i < recommendations.length; i++) {
            message += `${i + 1}. ${recommendations[i]}\n`;
          }
          message += "\n";
        }

        message += "### User Provisioning Reminder\n\n";
        message += "When adding new LSC users, follow this order:\n";
        message += "1. **Create User** — Set profile, role, and active status\n";
        message +=
          "2. **Assign PSLs** — Required before permission sets (Setup > Users > [User] > PSL Assignments)\n";
        message += "3. **Assign Permission Sets** — Use `assign_permission_set` tool or Setup UI\n";
        message +=
          "4. **Assign to Territory** — Setup > Territory Models > [Territory] > Assigned Users\n";
        message += "5. **Run alignment batch job** — Admin Console > Territory Management Jobs\n";

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check User Configuration\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
