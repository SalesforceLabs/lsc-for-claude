/** Sample Management readiness: its validation rules plus Studio's own checks. */

import { chunkIds } from "../../../tools/helpers.js";
import { count, countGroupedBy, inList, plural, query, queryByIds, type Row } from "../../helpers.js";
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

/*
 * The data checks don't ask "does any row in the org match?" of the inventory tables: when the
 * answer is no, the database has to read every ProductItem or ProductBatchItem to say so, which
 * times out in large orgs. Instead they read a fixed number of locations and look up those
 * locations' inventory by id, or start from the lots (ProductionBatch, a small table) and look
 * up their batch items by id. When the org has fewer locations than the sample size, the sample
 * is all of them.
 */
const SAMPLE_ROWS = 500;
/** Only disbursements created this recently are counted, so the count uses the CreatedDate index. */
const DISBURSEMENT_WINDOW_DAYS = 90;

/** "1 location" / "3 batch items" — `plural` only appends "s". */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

interface LocationSample {
  rows: Row[];
  /** Every location matching the filter was read. */
  complete: boolean;
}

async function sampleLocations(where: string, org: string): Promise<LocationSample> {
  const rows = await query(`SELECT Id, Name, PrimaryUserId FROM Location WHERE ${where} LIMIT ${SAMPLE_ROWS}`, org);
  return { rows, complete: rows.length < SAMPLE_ROWS };
}

/** "all 7 locations" / "the only location". */
const allOf = (n: number, one: string, more: string) => (n === 1 ? `the only ${one}` : `all ${n} ${more}`);

/** The sentence saying which locations were looked at, so a pass is never read as "the whole org is clean". */
function checkedNote(s: LocationSample, one: string, more: string): string {
  return s.complete ? `Checked ${allOf(s.rows.length, one, more)}.` : `Checked a sample of ${SAMPLE_ROWS} ${more}, not every one in the org.`;
}

/** Whether any row exists — one row read instead of a count over the whole table. */
async function exists(object: string, org: string): Promise<boolean> {
  return (await query(`SELECT Id FROM ${object} LIMIT 1`, org)).length > 0;
}

/** Inventory lines per Product2 across the given locations, read by location id. */
async function productsAt(locationIds: string[], org: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const chunks = await Promise.all(
    chunkIds(locationIds).map((chunk) => query(`SELECT Product2Id, COUNT(Id) cnt FROM ProductItem WHERE LocationId IN (${inList(chunk)}) GROUP BY Product2Id`, org))
  );
  for (const r of chunks.flat()) out.set(String(r.Product2Id), (out.get(String(r.Product2Id)) ?? 0) + Number(r.cnt ?? r.expr0 ?? 0));
  return out;
}

/**
 * Batch items of the given lots that match `where`: counts per lot, read by lot id, plus up to five
 * examples. Every matching batch item is counted, not a sample.
 */
async function batchItemsOf(lotIds: string[], where: string, fields: string, org: string): Promise<{ n: number; examples: Row[] }> {
  if (!lotIds.length) return { n: 0, examples: [] };
  const counts = await countGroupedBy("ProductBatchItem", "ProductionBatchId", lotIds, org, where);
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  const hit = [...counts.keys()].slice(0, 200);
  const examples = n ? await query(`SELECT ${fields} FROM ProductBatchItem WHERE ProductionBatchId IN (${inList(hit)}) AND ${where} LIMIT 5`, org) : [];
  return { n, examples };
}

const readiness: ReadinessModule = {
  ruleFiles: ["sample-management-config.yaml"],
  checks: async (org) => {
    const handlers = once(() => loadHandlers(org));
    const schema = once(() => loadDbSchema(org));
    const userLocations = once(() => count(`SELECT COUNT() FROM Location WHERE ${USER_LOCATION}`, org));
    const limits = once(() => exists("ProviderSampleLimit", org));
    // User Inventory locations with no Primary User, and which of them hold stock.
    const unassigned = once(() => sampleLocations(`${USER_LOCATION} AND PrimaryUserId = null`, org));
    const unassignedStock = once(async () => countGroupedBy("ProductItem", "LocationId", (await unassigned()).rows.map((r) => String(r.Id)), org, "QuantityOnHand > 0"));
    const repLocations = once(() => sampleLocations(USER_LOCATION, org));
    // Product items can only be created in inventory locations, so these hold all the stock.
    const inventoryLocations = once(() => sampleLocations("IsInventoryLocation = true", org));
    const inactiveProducts = once(async () => (await query(`SELECT Id FROM LifeSciMarketableProduct WHERE IsActive = false`, org)).map((r) => String(r.Id)));
    const NO_USER_LOCATIONS = { pass: true, skip: true, detail: "No User Inventory locations yet." };

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
          if (!total) return NO_USER_LOCATIONS;
          const s = await unassigned();
          const stock = await unassignedStock();
          const rows = s.rows.filter((r) => stock.has(String(r.Id)));
          const scope = s.complete ? "" : ` Checked a sample of ${SAMPLE_ROWS} User Inventory locations with no Primary User, not every one in the org.`;
          return {
            pass: rows.length === 0,
            detail: rows.length
              ? `${rows.length} of ${total} User Inventory locations hold stock but have no Primary User.${scope}`
              : `No User Inventory location holds stock without a Primary User.${scope}`,
            examples: rows.slice(0, 5).map((r) => String(r.Name)),
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
          if (!total) return NO_USER_LOCATIONS;
          const s = await unassigned();
          const stock = await unassignedStock();
          const rows = s.rows.filter((r) => !stock.has(String(r.Id)));
          const scope = s.complete ? "" : ` Checked a sample of ${SAMPLE_ROWS} User Inventory locations with no Primary User, not every one in the org.`;
          return {
            pass: rows.length === 0,
            detail: rows.length ? `${rows.length} of ${total} User Inventory locations have no Primary User and no stock.${scope}` : `Every empty User Inventory location has a Primary User.${scope}`,
            examples: rows.slice(0, 5).map((r) => String(r.Name)),
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
          if (!(await userLocations())) return NO_USER_LOCATIONS;
          const s = await repLocations();
          const stocked = await countGroupedBy("ProductItem", "LocationId", s.rows.map((r) => String(r.Id)), org, "QuantityOnHand > 0");
          const scope = checkedNote(s, "User Inventory location", "User Inventory locations");
          return {
            pass: stocked.size > 0,
            detail: stocked.size
              ? `${stocked.size} of ${s.rows.length} User Inventory locations hold stock. ${scope}`
              : `None of the User Inventory locations checked has any quantity on hand. ${scope}`,
          };
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
          const s = await inventoryLocations();
          if (!s.rows.length) return { pass: true, skip: true, detail: "No inventory locations yet." };
          const ids = s.rows.map((r) => String(r.Id));
          const [items, batches] = await Promise.all([
            queryByIds("ProductItemNumber", "ProductItem", "LocationId", ids, org, "QuantityOnHand < 0"),
            countGroupedBy("ProductBatchItem", "LocationId", ids, org, "RemainingQuantity < 0"),
          ]);
          const nBatches = [...batches.values()].reduce((a, b) => a + b, 0);
          const scope = checkedNote(s, "inventory location", "inventory locations");
          return {
            pass: items.length + nBatches === 0,
            detail: items.length + nBatches
              ? `${many(items.length, "product item", "product items")} and ${many(nBatches, "batch item", "batch items")} below zero. ${scope}`
              : `No negative quantities. ${scope}`,
            examples: items.slice(0, 5).map((r) => String(r.ProductItemNumber)),
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
          // Start from the expired lots, then count their batch items by lot id.
          const lots = (await query(`SELECT Id FROM ProductionBatch WHERE ExpirationDate < TODAY`, org)).map((r) => String(r.Id));
          const { n, examples } = await batchItemsOf(lots, `IsActive = true AND ExpirationDate < TODAY AND RemainingQuantity > 0`, "Name, ExpirationDate", org);
          return {
            pass: n === 0,
            detail: n ? `${many(n, "batch item", "batch items")} past expiry with stock left.` : "No active batch item is past its expiry date with stock.",
            examples: examples.map((r) => `${r.Name} (expired ${String(r.ExpirationDate).slice(0, 10)})`),
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
          const lots = (await query(`SELECT Id FROM ProductionBatch WHERE IsActive = false`, org)).map((r) => String(r.Id));
          const { n, examples } = await batchItemsOf(lots, `IsActive = true AND IsProductionBatchActive = false AND RemainingQuantity > 0`, "Name", org);
          return {
            pass: n === 0,
            detail: n ? `${many(n, "batch item", "batch items")} hold stock under an inactive batch.` : "All stocked batch items belong to active batches.",
            examples: examples.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.inventory-products-marketable",
          stage: "data",
          title: "Products in rep inventory have a marketable product",
          severity: "warning",
          why: "Sample drops, limits and the product picker work from Marketable Products. Stock in a rep's location for a Product2 with no marketable product can't be selected on the iPad.",
          steps: ["Create a Marketable Product for the Product2, or move the stock to the right product"],
          uiPath: "Marketable Products tab",
        },
        async () => {
          // The iPad reads stock only from the rep's own location (Primary User = the rep), so warehouse, site
          // and van stock with no marketable product never reaches the product picker.
          if (!(await userLocations())) return NO_USER_LOCATIONS;
          const s = await repLocations();
          const owned = s.rows.filter((r) => r.PrimaryUserId).map((r) => String(r.Id));
          if (!owned.length) return { pass: true, skip: true, detail: "No User Inventory location has a Primary User." };
          const lines = await productsAt(owned, org);
          const marketable = new Set((await queryByIds("ProductId", "LifeSciMarketableProduct", "ProductId", [...lines.keys()], org)).map((r) => String(r.ProductId)));
          const missing = [...lines.keys()].filter((id) => !marketable.has(id));
          const n = missing.reduce((a, id) => a + (lines.get(id) ?? 0), 0);
          const names = missing.length ? await queryByIds("Id, Name", "Product2", "Id", missing.slice(0, 5), org) : [];
          const scope = s.complete
            ? `Checked ${allOf(owned.length, "User Inventory location", "User Inventory locations")} with a Primary User.`
            : `Checked the ${many(owned.length, "location", "locations")} with a Primary User among a sample of ${SAMPLE_ROWS} User Inventory locations, not every one in the org.`;
          return {
            pass: n === 0,
            detail: n
              ? `${many(n, "inventory line", "inventory lines")} in reps' User Inventory locations for products with no marketable product. ${scope}`
              : `Every inventory line in reps' User Inventory locations has a marketable product. ${scope}`,
            examples: names.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "samples.data.disbursements-resolved",
          stage: "data",
          title: "No recent disbursement is waiting on a resolution",
          severity: "warning",
          why: "A disbursement flagged as needing resolution broke a rule (limit, license or stock). Until someone resolves it the rep's inventory and the limit usage stay out of step.",
          steps: ["Open the disbursement and follow its violation message", "Resolve or correct it, then re-submit"],
          uiPath: "Product Disbursements tab",
        },
        async () => {
          if (!(await exists("ProductDisbursement", org))) return { pass: true, skip: true, detail: "No sample disbursements recorded yet." };
          const window = `CreatedDate = LAST_N_DAYS:${DISBURSEMENT_WINDOW_DAYS}`;
          const [total, n] = await Promise.all([
            count(`SELECT COUNT() FROM ProductDisbursement WHERE ${window}`, org),
            count(`SELECT COUNT() FROM ProductDisbursement WHERE ${window} AND IsResolutionRequired = true`, org),
          ]);
          if (!total) return { pass: true, skip: true, detail: `No sample disbursements in the last ${DISBURSEMENT_WINDOW_DAYS} days.` };
          const rows = n ? await query(`SELECT Name FROM ProductDisbursement WHERE ${window} AND IsResolutionRequired = true LIMIT 5`, org) : [];
          const scope = `Checked the ${many(total, "disbursement", "disbursements")} from the last ${DISBURSEMENT_WINDOW_DAYS} days.`;
          return {
            pass: n === 0,
            detail: n ? `${n} of ${total} need resolution. ${scope}` : `None needs resolution. ${scope}`,
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
          if (!(await limits())) return { pass: true, skip: true, detail: "No sample limits — optional." };
          // Start from the inactive products (a short list) and count their limits by product id.
          const byProduct = await countGroupedBy("ProviderSampleLimit", "ProductId", await inactiveProducts(), org);
          const n = [...byProduct.values()].reduce((a, b) => a + b, 0);
          return {
            pass: n === 0,
            detail: n
              ? `${many(n, "limit is", "limits are")} on ${many(byProduct.size, "inactive product", "inactive products")}.`
              : "No limit is on an inactive product.",
          };
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
          if (!(await limits())) return { pass: true, skip: true, detail: "No sample limits — optional." };
          return syncResult(org, await schema(), LIMIT_OBJECTS);
        }
      ),
    ]);
  },
};

export default readiness;
