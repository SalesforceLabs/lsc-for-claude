# "Complete this field: Item" on a sample that already has an item

**What you see:** Saving a sample on iPad shows **Complete this field: Item**. The sample line already has a product item. The message is a red herring. It is how a null dereference is shown, not a missing required field.

`checkAvailableQuantities` guards the `ProductionBatch` ID string. It does not guard the `ProductionBatch` entity resolved from the bulk load. A non-empty ID that is missing from that load leaves `productionBatchObject` null, and the next read crashes. This is a pre-existing latent bug. It is not a package 262 access-rights regression.

## How to pin it

1. Confirm the sample line already has `ProductItemId`. If Item is actually empty, this is a required-field case and this leaf does not apply.
2. Read the batch on that line:

```sql
SELECT Id, ProductItemId, ProductionBatchId, QuantityDisbursed
FROM ProductDisbursement
WHERE Id = '<sample id>'
```

`ProductionBatchId` is set.

3. Check whether that ID was in the bulk load for the quantity check. Query the batch:

```sql
SELECT Id, Name
FROM ProductionBatch
WHERE Id = '<ProductionBatchId>'
```

The ID string is non-empty, so the guard in `checkAvailableQuantities` passes. The resolved entity is still null when that ID is absent from the map the bulk load built.

4. Stop. The crash is the unguarded use of that missing entity. The Item field error is the surface. The same failure exists on builds other than 262.
5. The fix is to guard the resolved `ProductionBatch` entity before reading it. Do not backport an access-rights change.

## Required answer

The reply must include all of:

- Cause: `checkAvailableQuantities` guards the `ProductionBatch` ID string and not the resolved entity. A missing bulk-load entry leaves `productionBatchObject` null and is dereferenced. This is a pre-existing latent bug, not a package 262 regression.
- Evidence: the sample already has `ProductItemId`, `ProductionBatchId` is non-empty, and that ID is not in the bulk-loaded batch map. The UI still says **Complete this field: Item**.
- Fix: guard the resolved entity.

## Do not

- Do not treat **Complete this field: Item** as a missing Item once `ProductItemId` is set.
- Do not call this a package 262 access-rights or double-pop regression.
- Do not stop after naming the null `productionBatchObject` without saying the guard checks the ID string and the bulk-load lookup is what returns null.
