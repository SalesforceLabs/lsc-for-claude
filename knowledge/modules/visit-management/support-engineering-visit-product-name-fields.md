# Web and iPad show different names for the same product

**What you see:** The Visit product dropdown (Samples, Direct to Practitioner, or Items) shows one name on web and a different name on iPad. The saved product is the same.

Web does not read the marketable-product name. The web dropdown label is `Product2.Name`. The mobile app label is `LifeSciMarketableProduct.Name`. Both sides save the same `Product2` id. Only the label differs.

Until the two labels use one field, keep `Product2.Name` and `LifeSciMarketableProduct.Name` the same.

## How to pin it

1. Confirm web and iPad list the same product under different names, and that the saved id is the same `Product2` id. On Samples the dropdown value is a `ProductItem` id. Read `ProductItem.Product2Id`. It matches the iPad product.
2. Query both names for that `Product2` id:

```sql
SELECT Id, Name, ProductId, Product.Name
FROM LifeSciMarketableProduct
WHERE ProductId = '<product2-id>'
```

3. Stop when `Product.Name` is the web label and `Name` is the iPad label. Web reads `Product2.Name`. The mobile app reads `LifeSciMarketableProduct.Name`.
4. Workaround: set the two names equal. That makes both dropdowns show the same text. It does not change which field each platform reads.

## Required answer

The reply must include all of:

- Cause: web Apex labels the dropdown with `Product2.Name`. iOS labels it with `LifeSciMarketableProduct.Name`. The LWC does not choose the marketable-product name.
- Evidence: the SOQL row where `Product.Name` matches web and `Name` matches iPad, and both sides saved the same `Product2` id.
- Workaround: give `Product2` and `LifeSciMarketableProduct` the same name. The mobile app is the side that reads `LifeSciMarketableProduct.Name`.

## Do not

- Do not say the web LWC dropdown uses `LifeSciMarketableProduct.Name`.
- Do not swap the fields. Web is `Product2.Name`. iOS is `LifeSciMarketableProduct.Name`.
- Do not treat a different saved id as this case. When the ids differ, this leaf does not apply.
