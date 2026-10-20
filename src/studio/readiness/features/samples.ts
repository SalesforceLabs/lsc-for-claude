/** Sample Management readiness: its validation rules plus Studio's own checks. */

import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, loadHandlers, once, syncResult } from "./_visit-shared.js";

/** Handlers that move stock and keep batches in step with disbursements — off means inventory goes wrong. */
const CORE_HANDLERS = [
  "ProductDisbursementInventoryOpCreation",
  "ProductBatchItemUpdateByLotHandler",
  "ProductBatchItemOwnershipHandler",
  "InventoryOperationSyncTxnHandler",
  "ReceivedProductAllocationHandler",
];

/** Locking, sharing and limit bookkeeping around the core flow. */
const SUPPORTING_HANDLERS = [
  "LocationUserDupHandler",
  "LocationUserSharingHandler",
  "SampleLimitTransactionHandler",
  "NewAccountSampleLimitInitHandler",
  "NewAccountSampleLimitInitHandlerforHCO",
  "ProductDisbursementSubmitLockHandler",
  "InventoryOperationLockHandler",
  "ProductTransferValidationHandler",
  "ProductTransferLockHandler",
  "ProductRequestLockHandler",
  "ProductRequestLineItemLockHandler",
  "InventoryCntPBIValidationHandler",
  "InventoryCountAssessmentLockHandler",
  "InventoryCountPBILockHandler",
];

/** What a rep's device needs to show inventory and record a drop. */
const INVENTORY_OBJECTS = ["ProductItem", "ProductBatchItem", "ProductionBatch", "ProductDisbursement", "Location", "LifeSciMarketableProduct"];
const LIMIT_OBJECTS = ["ProviderSampleLimit", "ProviderSampleLimitTemplate", "ProviderSmplLmtTmplAssignment"];

const USER_LOCATION = `LocationType = 'User Inventory'`;
/** A location with at least one inventory line that has quantity on hand. */
const STOCKED_LOCATION = `Id IN (SELECT LocationId FROM ProductItem WHERE QuantityOnHand > 0)`;

const readiness: ReadinessModule = {
  ruleFiles: ["sample-management-config.yaml"],
  checks: async (org) => {
    const handlers = once(() => loadHandlers(org));
    const schema = once(() => loadDbSchema(org));
    const userLocations = once(() => count(`SELECT COUNT() FROM Location WHERE ${USER_LOCATION}`, org));

    return Promise.all([
      runCheck(
        {
          id: "samples.access.locations-have-a-rep",
          stage: "access",
          title: "Every stocked User Inventory location belongs to a rep",
          severity: "warning",
          why: "A rep sees and spends stock only from the location where they are the Primary User. Stock in a location with no Primary User can't be given out by anyone.",
          steps: ["Open the Location", "Set Primary User to the rep who carries this stock, or transfer the stock to a rep's location"],
          uiPath: "Locations tab",
        },
        async () => {
          const total = await userLocations();
          if (!total) return { pass: true, skip: true, detail: "No User Inventory locations yet." };
          const where = `${USER_LOCATION} AND PrimaryUserId = null AND ${STOCKED_LOCATION}`;
          const rows = await query(`SELECT Id, Name FROM Location WHERE ${where} LIMIT 5`, org);
          const n = rows.length < 5 ? rows.length : await count(`SELECT COUNT() FROM Location WHERE ${where}`, org);
          return {
            pass: n === 0,
            detail: n
              ? `${n} of ${total} User Inventory locations hold stock but have no Primary User.`
              : `No User Inventory location holds stock without a Primary User.`,
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.access.empty-locations-unassigned",
          stage: "access",
          title: "Empty User Inventory locations have a rep",
          severity: "info",
          why: "A User Inventory location with no Primary User and no stock does no harm, but it's either waiting for a rep or left over.",
          steps: ["Set Primary User to the rep it was made for, or delete the location"],
          uiPath: "Locations tab",
        },
        async () => {
          const total = await userLocations();
          if (!total) return { pass: true, skip: true, detail: "No User Inventory locations yet." };
          const where = `${USER_LOCATION} AND PrimaryUserId = null AND Id NOT IN (SELECT LocationId FROM ProductItem WHERE QuantityOnHand > 0)`;
          const rows = await query(`SELECT Id, Name FROM Location WHERE ${where} LIMIT 5`, org);
          const n = rows.length < 5 ? rows.length : await count(`SELECT COUNT() FROM Location WHERE ${where}`, org);
          return {
            pass: n === 0,
            detail: n ? `${n} of ${total} User Inventory locations have no Primary User and no stock.` : "Every empty User Inventory location has a Primary User.",
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.access.locations-owned-by-active-users",
          stage: "access",
          title: "No stock sits with deactivated users",
          severity: "info",
          why: "When a rep leaves, their User Inventory location keeps its stock. It needs to be reconciled and transferred, or it stays on the books and counts against compliance.",
          steps: ["Transfer the remaining stock to the new owner or a warehouse", "Then retire the location"],
          uiPath: "Locations tab",
        },
        async () => {
          const rows = await query(
            `SELECT Id, Name, PrimaryUser.Name FROM Location WHERE ${USER_LOCATION} AND PrimaryUserId != null AND PrimaryUser.IsActive = false LIMIT 5`,
            org
          );
          const n = rows.length < 5 ? rows.length : await count(`SELECT COUNT() FROM Location WHERE ${USER_LOCATION} AND PrimaryUserId != null AND PrimaryUser.IsActive = false`, org);
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "location")} belong to deactivated users.` : "Every location's Primary User is active.",
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.rep-stock",
          stage: "data",
          title: "Reps hold sample stock",
          severity: "warning",
          why: "If no rep location has stock, sample drops fail on the iPad for lack of inventory — the usual cause is an initial load that created ProductItems but never received any quantity.",
          steps: ["Create an InventoryOperation (Transfer In) for each rep, or load ProductItem and ProductBatchItem quantities", "Make sure the batch items are active and unexpired"],
          uiPath: "Inventory Operations tab",
        },
        async () => {
          if (!(await userLocations())) return { pass: true, skip: true, detail: "No User Inventory locations yet." };
          const stocked = await count(`SELECT COUNT() FROM ProductItem WHERE Location.${USER_LOCATION} AND QuantityOnHand > 0`, org);
          return { pass: stocked > 0, detail: stocked ? `${plural(stocked, "rep inventory line")} with stock.` : "No rep location has any quantity on hand." };
        }
      ),
      runCheck(
        {
          id: "samples.data.no-negative-stock",
          stage: "data",
          title: "No inventory line is below zero",
          severity: "error",
          why: "Negative quantity on hand or in a batch means disbursements were recorded against stock that was never received, so the books don't reconcile and audits flag the rep.",
          steps: ["Find the lines with the examples below", "Receive the missing stock with a Transfer In or correct it through an Inventory Count"],
          uiPath: "Product Items tab",
        },
        async () => {
          const [items, batches] = await Promise.all([
            count(`SELECT COUNT() FROM ProductItem WHERE QuantityOnHand < 0`, org),
            count(`SELECT COUNT() FROM ProductBatchItem WHERE RemainingQuantity < 0`, org),
          ]);
          const rows = items ? await query(`SELECT ProductItemNumber FROM ProductItem WHERE QuantityOnHand < 0 LIMIT 5`, org) : [];
          return {
            pass: items + batches === 0,
            detail: items + batches ? `${plural(items, "product item")} and ${plural(batches, "batch item")} below zero.` : "No negative quantities.",
            examples: rows.map((r) => String(r.ProductItemNumber)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.no-expired-stock",
          stage: "data",
          title: "No expired lots still hold stock",
          severity: "warning",
          why: "Expired samples can't be given out. If they stay on a rep's inventory, they get picked in drops or sit uncounted until an audit finds them.",
          steps: ["Reps return or destroy the expired lot", "Reduce the batch item's remaining quantity with an Inventory Operation, then deactivate the batch"],
          uiPath: "Product Batch Items tab",
        },
        async () => {
          const where = `IsActive = true AND ExpirationDate < TODAY AND RemainingQuantity > 0`;
          const rows = await query(`SELECT Id, Name, ExpirationDate, RemainingQuantity FROM ProductBatchItem WHERE ${where} ORDER BY ExpirationDate LIMIT 5`, org);
          const n = rows.length < 5 ? rows.length : await count(`SELECT COUNT() FROM ProductBatchItem WHERE ${where}`, org);
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "batch item")} past expiry with stock left.` : "No active batch item is past its expiry date with stock.",
            examples: rows.map((r) => `${r.Name} (expired ${r.ExpirationDate})`),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.batches-active-where-stocked",
          stage: "data",
          title: "Stock sits only in active production batches",
          severity: "warning",
          why: "A batch item with stock whose production batch is deactivated can't be picked for a drop, so the quantity is stranded.",
          steps: ["Reactivate the production batch if the lot is still good", "Otherwise transfer the stock out and deactivate the batch item"],
          uiPath: "Production Batches tab",
        },
        async () => {
          const where = `IsActive = true AND IsProductionBatchActive = false AND RemainingQuantity > 0`;
          const n = await count(`SELECT COUNT() FROM ProductBatchItem WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name, ProductionBatch.Name FROM ProductBatchItem WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "batch item")} hold stock under an inactive batch.` : "All stocked batch items belong to active batches.",
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.inventory-products-marketable",
          stage: "data",
          title: "Every product in rep inventory has a marketable product",
          severity: "warning",
          why: "Sample drops, limits and the product picker work from Marketable Products. Stock in a rep's location for a Product2 with no marketable product can't be selected on the iPad.",
          steps: ["Create a Marketable Product for the Product2, or move the stock to the right product"],
          uiPath: "Marketable Products tab",
        },
        async () => {
          // The iPad reads stock only from the rep's own location (Primary User = the rep), so warehouse, site
          // and van stock with no marketable product never reaches the product picker.
          if (!(await userLocations())) return { pass: true, skip: true, detail: "No User Inventory locations yet." };
          const where = `Location.${USER_LOCATION} AND Location.PrimaryUserId != null AND Product2Id NOT IN (SELECT ProductId FROM LifeSciMarketableProduct WHERE ProductId != null)`;
          const n = await count(`SELECT COUNT() FROM ProductItem WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Product2.Name, Location.Name FROM ProductItem WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n
              ? `${plural(n, "inventory line")} in reps' User Inventory locations for products with no marketable product.`
              : "Every inventory line in reps' User Inventory locations has a marketable product.",
            examples: rows.map((r) => String((r.Product2 as { Name?: string } | null)?.Name ?? r.Product2)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.disbursements-resolved",
          stage: "data",
          title: "No disbursement is waiting on a resolution",
          severity: "warning",
          why: "A disbursement flagged as needing resolution broke a rule (limit, license or stock). Until someone resolves it the rep's inventory and the limit usage stay out of step.",
          steps: ["Open the disbursement and follow its violation message", "Resolve or correct it, then re-submit"],
          uiPath: "Product Disbursements tab",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM ProductDisbursement`, org);
          if (!total) return { pass: true, skip: true, detail: "No sample disbursements recorded yet." };
          const rows = await query(`SELECT Name, ViolationMessage FROM ProductDisbursement WHERE IsResolutionRequired = true LIMIT 5`, org);
          const n = rows.length < 5 ? rows.length : await count(`SELECT COUNT() FROM ProductDisbursement WHERE IsResolutionRequired = true`, org);
          return {
            pass: n === 0,
            detail: n ? `${n} of ${total} disbursements need resolution.` : `None of ${total} disbursements need resolution.`,
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.limits-on-active-products",
          stage: "data",
          title: "Sample limits point at active products",
          severity: "info",
          why: "Limits on a deactivated marketable product never fire, and clutter the sync with rows reps can't use.",
          steps: ["Delete the limits for retired products, or reactivate the product"],
          uiPath: "Admin Console > Sample Limits",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM ProviderSampleLimit`, org);
          if (!total) return { pass: true, skip: true, detail: "No sample limits — optional." };
          const n = await count(`SELECT COUNT() FROM ProviderSampleLimit WHERE ProductId IN (SELECT Id FROM LifeSciMarketableProduct WHERE IsActive = false)`, org);
          return { pass: n === 0, detail: n ? `${n} of ${total} limits are on inactive products.` : `All ${total} limits are on active products.` };
        }
      ),
      runCheck(
        {
          id: "samples.config.core-handlers",
          stage: "config",
          title: "Inventory-moving trigger handlers are switched on",
          severity: "error",
          why: "These handlers create the inventory operation for each drop, decrement batches by lot, and assign batch ownership. With them off, drops save but stock never moves.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), CORE_HANDLERS)
      ),
      runCheck(
        {
          id: "samples.config.supporting-handlers",
          stage: "config",
          title: "Sample locking, sharing and limit handlers are switched on",
          severity: "warning",
          why: "They stop edits to submitted transfers and counts, share each rep's location with their managers, and keep sample limit usage current.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), SUPPORTING_HANDLERS)
      ),
      runCheck(
        {
          id: "samples.mobile.inventory-db-schema",
          stage: "mobile",
          title: "Inventory and sample products sync to the iPad",
          severity: "error",
          why: "Reps see stock, lots and the product picker from the device's offline copy. An object missing from DB Schema is an empty list on the iPad.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed, assigned to the reps' profiles", "Publish to the iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema(), INVENTORY_OBJECTS)
      ),
      runCheck(
        {
          id: "samples.mobile.limits-db-schema",
          stage: "mobile",
          title: "Sample limits sync to the iPad",
          severity: "warning",
          why: "Limits are checked on the device while the rep is offline. If the limit, template or assignment objects aren't synced, the drop isn't blocked or warned on the iPad and only fails later on sync.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed", "Publish to the iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => {
          if (!(await count(`SELECT COUNT() FROM ProviderSampleLimit`, org))) return { pass: true, skip: true, detail: "No sample limits — optional." };
          return syncResult(org, await schema(), LIMIT_OBJECTS);
        }
      ),
    ]);
  },
};

export default readiness;
