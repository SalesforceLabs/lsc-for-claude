/** Product Management readiness: its validation rules plus Studio's own checks. */

import { collectCategoryRecords } from "../../../config/collect.js";
import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, loadHandlers, once, syncResult } from "./_visit-shared.js";

const PRODUCT_HANDLERS = [
  "ProductGuidanceDeactivationHandler",
  "ProductTerrDtlAvailabilityHandler",
  "ProductTerritoryAvailabilityExclHandler",
  "ProviderAcctProductInfoHandler",
  "LifeSciMarketableProductMetadataHandler",
];

/** What reps need offline to pick products and see their messages. */
const SYNCED_OBJECTS = ["LifeSciMarketableProduct", "Product2", "ProductGuidance", "ProductTerritoryAvailability", "ProductTerrDtlAvailability", "ProviderAcctProductInfo"];

const readiness: ReadinessModule = {
  ruleFiles: ["product-management-config.yaml"],
  checks: async (org) => {
    const handlers = once(() => loadHandlers(org));
    const schema = once(() => loadDbSchema(org));
    const restrictions = once(() => count(`SELECT COUNT() FROM LifeSciProductAcctRstrc`, org));

    return Promise.all([
      runCheck(
        {
          id: "products.data.guidance-not-expired",
          stage: "data",
          title: "No active message has passed its end date",
          severity: "warning",
          why: "Reps pick from active messages during detailing. One that ended but is still marked active keeps showing, so reps may use an out-of-date claim.",
          steps: ["Deactivate the message or extend its end date", "Keep ProductGuidanceDeactivationHandler on so ended messages are switched off automatically"],
          uiPath: "Product Guidance tab",
        },
        async () => {
          const where = `IsActive = true AND EffectiveEndDate < TODAY`;
          const rows = await query(`SELECT Name, EffectiveEndDate FROM ProductGuidance WHERE ${where} ORDER BY EffectiveEndDate DESC LIMIT 5`, org);
          const n = rows.length < 5 ? rows.length : await count(`SELECT COUNT() FROM ProductGuidance WHERE ${where}`, org);
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "active message")} past the end date.` : "No active message is past its end date.",
            examples: rows.map((r) => `${r.Name} (ended ${String(r.EffectiveEndDate).slice(0, 10)})`),
          };
        }
      ),
      runCheck(
        {
          id: "products.data.guidance-on-active-products",
          stage: "data",
          title: "Active messages belong to active products",
          severity: "info",
          why: "A message on a deactivated product can't be reached from the product picker but still syncs to every device.",
          steps: ["Deactivate the message, or reactivate the product"],
          uiPath: "Product Guidance tab",
        },
        async () => {
          if (!(await count(`SELECT COUNT() FROM ProductGuidance WHERE IsActive = true`, org))) return { pass: true, skip: true, detail: "No active messages." };
          const where = `IsActive = true AND ProductReferenceRecordId IN (SELECT Id FROM LifeSciMarketableProduct WHERE IsActive = false)`;
          const n = await count(`SELECT COUNT() FROM ProductGuidance WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name FROM ProductGuidance WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "active message")} on inactive products.` : "Every active message is on an active product.",
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "products.data.hierarchy-parents-active",
          stage: "data",
          title: "Active products sit under active parents",
          severity: "warning",
          why: "The product tree on the iPad is built from parent links. A product whose parent brand or indication is inactive drops out of the tree, so reps can't reach it.",
          steps: ["Reactivate the parent, or reparent the product"],
          uiPath: "Marketable Products tab",
        },
        async () => {
          const inactive = await query(`SELECT Id FROM LifeSciMarketableProduct WHERE IsActive = false`, org);
          if (!inactive.length) return { pass: true, detail: "No inactive products." };
          const ids = new Set(inactive.map((r) => String(r.Id)));
          const kids = await query(`SELECT Id, Name, ParentProductId FROM LifeSciMarketableProduct WHERE IsActive = true AND ParentProductId != null`, org);
          const bad = kids.filter((k) => ids.has(String(k.ParentProductId)));
          return {
            pass: bad.length === 0,
            detail: bad.length ? `${plural(bad.length, "active product")} under an inactive parent.` : "Every active product has an active parent.",
            examples: bad.slice(0, 5).map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "products.data.restrictions-on-active-products",
          stage: "data",
          title: "Account restrictions point at active products",
          severity: "info",
          why: "A restriction on a retired product does nothing but add rows to the sync.",
          steps: ["Delete the restriction, or reactivate the product"],
          uiPath: "Product Account Restrictions",
        },
        async () => {
          const total = await restrictions();
          if (!total) return { pass: true, skip: true, detail: "No account restrictions — optional." };
          const n = await count(`SELECT COUNT() FROM LifeSciProductAcctRstrc WHERE ProductId IN (SELECT Id FROM LifeSciMarketableProduct WHERE IsActive = false)`, org);
          return { pass: n === 0, detail: n ? `${n} of ${total} restrictions are on inactive products.` : `All ${total} restrictions are on active products.` };
        }
      ),
      runCheck(
        {
          id: "products.config.product-handlers",
          stage: "config",
          title: "Product handlers are switched on",
          severity: "warning",
          why: "They end messages on schedule, keep territory availability consistent with exclusions, and maintain the per-account product info reps see.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), PRODUCT_HANDLERS)
      ),
      runCheck(
        {
          id: "products.config.admin-settings",
          stage: "config",
          title: "Product admin settings exist",
          severity: "info",
          why: "Product tree display options (such as how many products load at once) are read from the Product admin settings record. Without it the app uses defaults.",
          steps: ["Open Admin Console > Product Management and save the settings"],
          uiPath: "Admin Console > Product Management",
          surface: "adminSettings",
        },
        async () => {
          const records = await collectCategoryRecords(org, `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'ProductAdminSettings'`);
          return records.length ? { pass: true, detail: "Product admin settings are saved." } : { pass: false, detail: "No Product admin settings record." };
        }
      ),
      runCheck(
        {
          id: "products.mobile.db-schema",
          stage: "mobile",
          title: "Products and messages sync to the iPad",
          severity: "error",
          why: "Reps choose products and messages offline. An object missing from DB Schema is empty on the iPad.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed, assigned to the reps' profiles", "Publish to the iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema(), (await restrictions()) ? [...SYNCED_OBJECTS, "LifeSciProductAcctRstrc"] : SYNCED_OBJECTS)
      ),
    ]);
  },
};

export default readiness;
