# Add Product picker ignores territory sort

**What you see:** On web Visit Engagement, **Add Product** lists the right products for the rep's territory, in the wrong order. The order follows `LifeSciMarketableProduct.SortOrder`. It does not follow `ProductTerrDtlAvailability.SortOrder`.

`ProductTerrDtlAvailability` decides which products are eligible. A null `SortOrder` on that row does not remove the product. It also does not mean the picker has no sort. The picker is using the global product sort instead of the territory sort.

## How to pin it

Write down the Add Product order. Then compare it to both fields for those same products.

```sql
SELECT ProductId, Product.Name, SortOrder
FROM ProductTerrDtlAvailability
WHERE TerritoryId = '<territoryId>'
AND IsActive = true
AND ProductId IN (<product ids from the picker>)
ORDER BY SortOrder NULLS LAST
```

```sql
SELECT Id, Name, SortOrder
FROM LifeSciMarketableProduct
WHERE Id IN (<same product ids>)
ORDER BY SortOrder NULLS LAST
```

The cause is pinned when the picker sequence matches `LifeSciMarketableProduct.SortOrder` and does not match `ProductTerrDtlAvailability.SortOrder`.

That rules out the other readings:

- A name sort would follow `Name`, not the product `SortOrder` numbers.
- A missing `ORDER BY` would not reproduce the global `SortOrder` sequence.
- Territory rows are present. They were used to include the products. They were not used to order them.

## Correct order

The Visit product sidebar already sorts this way. Add Product has to use the same order:

1. Products with a non-null `ProductTerrDtlAvailability.SortOrder` for that territory, ascending.
2. Then products whose territory `SortOrder` is null, by `LifeSciMarketableProduct.SortOrder`.

## Required answer

The reply must include all of:

- Cause: Add Product sorts by `LifeSciMarketableProduct.SortOrder`. `ProductTerrDtlAvailability` only filters eligibility.
- Evidence: the picker order matches the product `SortOrder` query and not the territory `SortOrder` query.
- Correct order: `ProductTerrDtlAvailability.SortOrder` first, then `LifeSciMarketableProduct.SortOrder` where the territory sort is null.

## Do not

- Do not leave "missing ORDER BY", "sorted by name", and "working as designed" as open alternatives once the two queries disagree with the picker.
- Do not treat a null `ProductTerrDtlAvailability.SortOrder` as the reason a product is missing. Null territory sort only sends that product to the global-sort group.
- Do not change product eligibility, PTAs, or the alignment batch to fix order.
