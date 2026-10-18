# Order Management Pricing - Winter '27 (264)

Pricing stack for Quoted Orders: one Salesforce Go switch plus a pricing recipe, pricing procedure, and decision tables, configured once on the **Life Sciences Commercial** subtype so the same procedure runs identically online and offline on the iPad. Persona: Alex (Pricing Admin). Prerequisites: [release-264-quoted-orders-admin-setup](./release-264-quoted-orders-admin-setup.md). Rep view: [release-264-quoted-orders-rep-flow](./release-264-quoted-orders-rep-flow.md).

## What's New
List prices, volume (range) and tier (slab) discounts, manual line discounts, manual free goods with attributable discount, header discounts, dynamic matrix discounts, and a price waterfall with calculation explainability.

## Building blocks
| Block | Role |
|---|---|
| Context Definition | What the engine can see; extends the Sales Transaction context with order, line, product, and custom attributes |
| Pricing Recipe | Whitelist on the LSC Commercial subtype: which decision tables and elements a procedure may use, online + offline |
| Decision Tables | Lookup data (price book entries, volume, tier, matrices) |
| Pricing Procedure | Ordered expression set that reads context, calls tables via elements, outputs the net-price waterfall |

## Setup sequence
1. **Salesforce Go** one-click enablement (see admin setup) and permission sets.
2. **Extend the Sales Transaction context**: start from the out-of-the-box Sales Transaction context (from Revenue Cloud licenses), use Extend/inherit to create an LSC Order Management version (example name LSc_OM_SalesTxnContext), then activate. Sales Transaction maps to Quote; Sales Transaction Item maps to Quote Line Item. LSC OM uses only Quote + Quote Line Item (not contract-based pricing, asset lifecycle, or quote-to-order). Custom attributes get a `_c` suffix, no spaces in the name; map each to a Quote Line Item field (reuse or create) and grant FLS before mapping/activating.
3. **Pricing recipe**: create via Salesforce Pricing setup or the Go step; choose the **Life Sciences Commercial** subtype, NOT Revenue Cloud; mark as default. In 264, offline supports exactly three out-of-the-box decision tables, each mapped to an element: Price Book Entries V2 -> List Price; Volume Discount Entries -> Volume Discount; Tiered Adjustment Entries -> Tier Discount.
4. **Price books**: exactly one Standard price book (mandatory, default list prices); optional custom books (region/territory/segment) with valid From-To dates, activated. Cost books are not supported.
5. **Selling model and list prices**: for each active product define the selling model as One-Time Selling (consumer-health products are one-time); create a Price Book Entry per product (currency, price book, list price, Active). A product can be in several books.
6. **Pricing procedure**: Salesforce Go -> Create Pricing Procedure -> New. Usage Type = Pricing; Usage Subtype = Life Sciences Commercial (not Revenue Cloud); select the LSC sales transaction context; Save creates an expression set version. Add Pricing Setting (mandatory first; map Line Item, Currency ISO Code, Net Unit Price, Item Net Total Price, Price Waterfall), then List Price (lookup Price Book Entries V2; inputs Product, Price Book, Product Selling Model, quantity; output List Price). Give a valid rank, save, activate.
7. Register the procedure in Admin Console Orders and Pricing Settings (Transaction Configuration).

## Procedure elements (Life Sciences Commercial subtype, work online and offline)
Pricing Setting; List Price; Volume Discount; Tier Discount; List Group; List Operation (listed as List Container in one slide); Assignment; Manual Discount; Price Adjustment Matrix; Formula Based Pricing; Discount Distribution Service. (The decks say 11 elements; the closing summary says "12-element procedure".)

Typical chain: Pricing Setting -> List Price -> Volume Discount -> Tier Discount -> (Price Adjustment Matrix) -> Manual Discount (percent, amount) -> List Group (free goods formula) -> Discount Distribution Service (last).

## Volume and Tier discounts
- Price Adjustment Schedule: **Adjustment Method = Range** (Volume) or **Slab** (Tier); also Schedule Type, price book, Currency ISO Code, Active. Example schedule names: Price Adjustment Volume Range, Price Adjustment Tier Slab.
- Price Adjustment Tier: one row per product (no org-wide "all products" row): Product, Product Selling Model, Tier Type (Percentage, Amount, or Override), Lower/Upper Bound, Tier Value, Currency.
- Steps: (1) create the two schedules, leave Active unchecked while loading tiers; (2) add tier rows, then reactivate; (3) Setup -> Decision Tables -> Volume Discount Entries or Tiered Adjustment Entries -> **Refresh** (Object = Price Adjustment Tier; check Last Refreshed Date and Status = Active). Refresh after any tier change; until then the procedure uses previously synced values. (4) Add Volume Discount and Tier Discount elements after List Price with the matching lookup table; inputs include schedule-id constant, bounds mapped to Line Item Quantity, Product, Selling Model, Effective From/To, Currency; Tier Discount also maps Quantity and Input Unit Price (List Price).
- **Range (Volume)**: whole quantity re-rated at the single band the total lands in; has a cliff effect. Example: list 20.00, bands 100-299 10%, 300-499 15%, 500+ 20%; 300 units = 17.00/unit = 5,100 vs 299 units = 5,382.
- **Slab (Tier)**: graduated, each band at its own rate and summed. Example: list 9.00, 100-199 5%, 200-299 10%; 250 units = 2,159.10 (avg 8.64/unit).

## Manual (line) discounts
- One per line, Percentage or Amount, stacks on the automated best price (not an alternative pricing method). QuoteLineItem fields: Adjustment Type (ManualPercentDiscount / ManualAmountDiscount), Partner Discount Percent, Item Discount Amount, Partner Unit Price. Percent: Net = List x (1 - %); Amount: Net = List - Amount.
- Surface fields: Lightning App Builder -> Quote/Order record page -> Sales Transaction Line Editor -> Display Columns; add Adjustment Type, Discount Percent, Discount Amount.
- Add two Manual Discount elements after Tier Discount: inputs Adjustment Type, Adjustment Value (Item Discount Amount/Percent), Quantity = Line Item Quantity, Input Unit Price = Net Unit Price; outputs Net Unit Price, Subtotal (ItemNetTotalPrice). "Generate Context Tags" autofills mappings.
- iPad: Discount -> Add -> Amount or Percentage; same QuoteLineItem fields, same procedure.

## Manual free goods
- Rep enters free units in the standard **Additional Free Item Quantity** field. A Formula element computes attributable discount % = ROUND(freeQty / (freeQty + lineQty), 2), stored on a custom percent field (FreeGoodsDiscount__c in the example) for reporting. It does **not** reduce Net Unit Price.
- Setup: (1) add the fields to the Transaction Line Editor Display Columns; (2) Context Definition -> Context Tags on SalesTransactionItem: ManualFreeGoods__c (input) and FreeGoodsDiscount__c (output); (3) Context Mapping SalesTransactionItem -> QuoteLineItem: ManualFreeGoods__c -> AdditionalFreeItemQty, FreeGoodsDiscount__c -> FreeGoodsDiscount__c; save; (4) List Group after the Manual Discount elements with a List Operation condition ManualFreeGoods__c Is Not Null, then the Formula element.
- Example: qty 300, free 30 -> 9%. 60-unit line: 6 free -> 9%, 12 free -> 17%.
- Recommended (not built in): a validation blocking save above an admin cap (e.g. free <= 10% of qty).

## Header discounts (Discount Distribution Service, DDS)
- One header discount spread across lines. DDS must be the **last** element, may be used only once, and cannot coexist with a Derived Pricing element in the same procedure (use a Procedure Plan Definition to orchestrate two procedures instead).
- Choices: Discount Type (Amount / Percentage / Override; Override discounts the delta to a target total), Distribution Type (Net Unit Price / Item Net Total Price), Distribution Logic (Equal / Proportionate) = 12 combinations. Config fields: HeaderDiscountType, HeaderDiscountValue, HeaderDistributionType, HeaderDistributionLogic, MinimumNetUnitPrice.
- Equal splits evenly regardless of line value; Proportionate weights by each line's List x Qty (not post-discount net).
- Minimum Net Unit Price floor engages only when Distribution Type = Net Unit Price (line never drops below Product2.Minimum_Price); unapplied amount accumulates in Total Remainder Amount ("Store remainder amount"). Item Net Total Price applies no floor.
- Setup: enable Header Adjustment in Revenue Settings (adds Manage Header Adjustment to the Transaction Line Editor); add DDS last with "Get Participating Products" lookup table, 10 input variables and 5 outputs; feed header values either by mapping DDS inputs directly or with a preceding Assignment (TotalPriceOverride__std -> HeaderAdjustmentValue__std, HeaderPriceOverride -> HeaderAdjustmentType__std).
- Example (lines 1,000 and 3,000, header 400 Amount): Equal = 200 each (8.00 and 9.33/unit); Proportionate = 25%/75% so both land at 9.00. With 8% percentage header: Equal 8.40 / 9.47, Proportionate 9.20 both.

## Dynamic discounting (Price Adjustment Matrix, PAM)
- Custom decision table for discounts on your own attributes (brand, customer tier, category). Evaluated per SKU/line; it does **not** pool quantity across multiple products of the same brand/category in the cart.
- Steps: (1) Lookup Table wizard: Application Usage = Pricing, Type = Advanced, source object a custom entity mirroring Price Adjustment Tier (example Brand Volume Tier with Brand, Lower/Upper bound, Tier Type, Tier Value); conditions Brand equals, Lower >=, Upper <=; results TierType, TierValue; activate. (2) Pricing Recipe -> Price Adjustment Matrix tab -> Modify -> add the table. (3) Add PAM element to the procedure (placement drives mapping; after Volume/Tier it stacks on them; right after List Price the input is List Price). (4) Extend the context with the attribute (e.g. ProductBrand__c on Sales Transaction Item, map to the custom Product field), Save & Publish. (5) Map inputs (Brand, bounds -> Line Item Quantity, Input Unit Price -> Net Unit Price), set Adjustment Type / Adjustment Value constant default values to the source field API names. If a recipe warning "Lookup table associated with an inactive pricing recipe" appears, Sync the recipe (optionally Mark as Default).
- Remember to cache the custom entity for mobile (see admin setup).

## Price waterfall
- Order of evaluation shown: List Price -> MIN(Volume, Tier) -> MAX(Brand, Category, Customer Tier) -> AVERAGE of the two groups = Automated Best Price -> manual and header discounts stack on top -> Net.
- Shown step by step (List, Volume, Manual, Header down to Net Unit Price) online and offline, with Calculation Details per line.
- Offline retention is controlled in Orders and Pricing Settings (open/closed quote statuses and retention days).

## Limitations / Gotchas
- Not supported offline: contract-based pricing, attribute-based discounts (other than via PAM decision table as described), bundle products.
- Use the Life Sciences Commercial subtype for both recipe and procedure, not Revenue Cloud, or it will not run offline.
- Refresh decision tables after every tier change.

## Verified Against Official Help
- Pricing procedure: create **one** procedure with **Life Sciences Commercial** as Usage Subtype; it serves web and iPad, all LS quoted orders route to it, and the default procedure cannot be deleted. Help states only **on-save pricing** is supported.
- Pricing recipe: the default recipe is an org-level pointer; changing it applies to new quotes only and does not reprice existing quotes. Sales Transaction Type's procedure overrides the Admin Console selection.
- Price Waterfall turns on automatically via Salesforce Go. Turning off: whole waterfall removes cached data on next sync and hides the popover for all; **Price Waterfall Persistence** off (waterfall stays on) allows online viewing but no offline viewing; per-user off hides it for that user only.
- Pricing runs from cached data on iPad; regenerate metadata cache after price book or procedure changes.
- Pricing Elements are covered in a separate Help article not fetched (element list above remains deck-sourced).
- **Connect API (Dev guide):** POST `/connect/core-pricing/waterfalls/retrieve` (API v67.0+), body WaterfallDownloadInputRepresentation with `lineItems[]` of `lineItemId` + `executionId`; response WaterfallDownloadOutputRepresentation; optional query parameter `waterfallView=lsc-summary` runs a server-side optimization removing elements that don't affect net unit price (proration, formula pricing, zero-value adjustments, hidden elements); omitted returns the complete waterfall from PricingWaterfallLog.
- **Invocable actions (264 release note):** `getQualifiedProducts` (PricebookEntry IDs a user may use for an account and territories); `setLsQuoteDocumentDefaults` (default attributes on document recipients for a quote document based on its Lightning flexipage layout); `shareQuoteBasedOnAccount` (syncs Quote sharing to Account sharing by upserting QuoteShare from AccountShare); `evaluateAccess` (checks a user permission for the running user); also `cloneActvtyPlanTerritories`.

## Sources
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_pricing_procedures.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_price_waterfall.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_basics.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_order_management_automate_order_calculations.htm&release=264.0.0&type=5
- https://developer.salesforce.com/docs/atlas.en-us.life_sciences_dev_guide.meta/life_sciences_dev_guide/connect_resources_waterfall_download.htm (search excerpt)
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lifesciences_connect_apis.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=release-notes.rn_invocable_actions.htm&release=264.0.0&type=5 (search excerpt)
