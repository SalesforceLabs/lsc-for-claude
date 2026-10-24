# Order Management Setup Runbook and Troubleshooting - Winter '27 (264)

Practitioner-verified field notes from setting up Order Management in a 264 (package v264.x) org, API 67.0. Org-specific IDs, usernames, and record Ids are intentionally omitted. See [admin setup](./release-264-quoted-orders-admin-setup.md) and [pricing](./release-264-pricing.md) for the feature detail.

## Repeat Runbook (new org)
1. **Confirm licensing**: Life Sciences Cloud for Customer Engagement plus Revenue Cloud Advanced PSLs (check with list_permission_sets); retrieve Settings:Quote, Settings:Order, Settings:RevenueManagement. Signal that Revenue Cloud Advanced is not enabled: `enableCoreCPQ=false` on Settings:RevenueManagement.
2. **Run the Salesforce Go "Customer Engagement - Order Management" checklist (UI only)**. It should create the "Price and Tax Calculation for Quoting" permission set and the pricing procedure/recipe. Checklist items: Revenue Cloud, Context Service, Salesforce Pricing, Price Waterfall, Transaction Pricing, Quote Capture, Standard Price Book, Quote record page activation, Sales Transaction Type.
3. **Admin permission sets**: Context Service Admin + Runtime, Life Sciences Commercial Admin, Life Sciences Core, Product Catalog Management Designer + Viewer, Salesforce Pricing Admin.
4. **Rep permission sets**: Price and Tax Calculation for Quoting, Product Catalog Management Viewer, Document Builder User, Salesforce Pricing Run Time User, Life Sciences Field Sales Representative.
5. **Data**: Quote-enabled Account record type + territories; Product2 + Product Selling Model; Product Catalog / Assortments; Product Territory Availability with Purpose = Quote (create as Draft, then publish with the Admin Console batch job; see [Products Missing on the iPad "Add Products" Screen](#products-missing-on-the-ipad-add-products-screen-quoted-orders)); **Standard price book entries first, then the custom LS price book entries**; Price Adjustment Tiers.
6. **Admin Console**: Orders and Pricing Settings (pricing procedure, waterfall statuses, product views); activate flows; build the Quote Document Template; check FLS.
7. **Generate the mobile metadata cache**, sync the iPad, and run Visit > Quoted Orders as the rep.

## What is UI/Go only (not scriptable via the API/tools used)
Salesforce Go checklist; pricing recipe, pricing procedure, and extended context definition; Quote Document Template (Document Builder, Life Sciences Digital Signature, Compliance Statement Definition); Admin Console Orders and Pricing Settings (no matching category appeared in list_admin_settings in the test org, which had 46 categories; create_admin_setting was not attempted); flow activation (Browse Product Catalog, Discover Products, LSC Validate Mandatory Quote Fields).

## Verified Behaviors and Gotchas
- Objects present in a 264 org: Quote, QuoteLineItem, QuoteDocument, Assortment, PriceAdjustmentSchedule/Tier, ProductCatalog, ProductSellingModel, ProductTerritoryAvailability, ComplianceStatementDef, DigitalSignature.
- Existing Product Territory Availability rows seen defaulted to Purpose = Visit; none with Purpose = Quote, so quote availability must be created.
- Pre-existing Revenue Cloud sample data (B2B/D2C catalogs, selling models, price adjustment schedules) may be present and is not LSC data; do not assume it serves Life Sciences products.
- The "Price and Tax Calculation for Quoting" permission set may not exist (no PS, PSL, or group) until Revenue Cloud / Salesforce Go enablement creates it; the rep cannot be assigned it before then.
- `list_trigger_handlers` errored ("sObject type 'LifeScienceTriggerHandler' is not supported") in this org; the deck has no trigger-handler step for Order Management, so it is not needed.
- Retrieving Settings:ContextService / Pricing / ProductCatalog returns "Settings type ... is unknown"; these are not metadata settings types (harmless).
- `sf` retrieves can take about 2.5 minutes; run them in the background.

## Errors and Fixes
| Symptom | Fix |
|---|---|
| assign_permission_set with API-style name `lsc4ce__LifeSciencesCore` returns "Permission Set Not Found" | Use the label: "Life Sciences Core" |
| SOQL on PermissionSetGroup `Name`: "No such column 'Name'" | Use MasterLabel or DeveloperName |
| SOQL on Quote `PricebookId`: "No such column" | Use `Pricebook2Id` |
| SOQL `SELECT DISTINCT`: "only aggregate expressions use field aliasing" | Use GROUP BY |
| create_record / bulk_create_records parameter errors | create_record takes objectName + values; bulk_create_records takes sobjectType + records |

## Products Missing on the iPad "Add Products" Screen (Quoted Orders)

**Why products are missing:** the Add Products screen lists products from `ProductTerrDtlAvailability` (PTDA) rows with `Purpose = 'Quote'` for the rep's territory. PTDA is read-only; only the Admin Console batch job creates it, from **Draft** `ProductTerritoryAvailability` (PTA) rows. The job skips PTA rows that were set to Active by API, and rows with `Purpose = 'Visit'`.

**Prerequisites** (in place in the 264 test org; not individually confirmed to be strictly required):
- The rep's profile has DbSchema entries for Product2, ProductTerritoryAvailability, ProductTerrDtlAvailability, and the pricing and quote objects.
- The rep belongs to the territory, and the products are active Product2 records.

**Steps**
1. **Diagnose.** Run both queries and look for `Purpose = 'Quote'` rows for the rep's territory.
   - `SELECT Territory.Name, Purpose, Status, COUNT(Id) FROM ProductTerritoryAvailability GROUP BY Territory.Name, Purpose, Status`
   - `SELECT Territory.Name, Purpose, IsActive, COUNT(Id) FROM ProductTerrDtlAvailability GROUP BY Territory.Name, Purpose, IsActive`

   If the PTDA query shows no Quote rows for the territory, continue.
2. **Clear wrong PTA rows.** If Quote PTA rows already exist for the territory but were set Active by API, delete them. Status can't go back to Draft, and inactive rows still block re-inserting the same product and territory (as do rows of other alignment types). Delete with Apex: `delete [SELECT Id FROM ProductTerritoryAvailability WHERE Territory.Name = '<territory>' AND Purpose = 'Quote'];`
3. **Insert Draft PTA rows, one per product. Do not set them Active.**
   - `ProductId` = the Product2 Id
   - `TerritoryId` = the Territory2 Id
   - `Purpose` = Quote
   - `AlignmentType` = Territory Inclusion
   - `UsageType` = LifeSciences
   - `Status` = Draft
4. **Run the batch job (UI only).** Admin Console > Product > Product Alignment Jobs > **Run the Publish Draft Product Territory Alignments Batch Job**. It can't be triggered from Apex or the API, so a person must run it.
5. **Verify.** The PTA rows should now be Active, and the PTDA query from step 1 should show Quote rows with `IsActive = true`, one per product.
6. **Resync the iPad** with the rep's territory selected, then open the quote's Add Products screen. No mobile metadata cache regeneration was needed in 264, because PTA and PTDA are data, not metadata.

## Pricebook Data Loading Order
Create the custom Pricebook2 (active), then insert PricebookEntry rows in the Standard Price Book first, then in the custom price book for the same products. A product must have a Standard Price Book entry before it can have a custom-book entry. Verify with a SOQL count on the custom book.

## Not Yet Validated in the Field Notes
Quote-enabled Account record type/layout, Visit Record Type Routing, FLS by profile, Product Catalog for LSC, Assortment/Store Assortment, Price Adjustment Tiers for LS products, mobile cache regeneration, Store Check setup, and end-to-end rep validation were left undone (they need design decisions or UI).

## Verified Against Official Help
- Help confirms the Salesforce Go path and the toggle contents (Revenue Cloud, Quotes, Document Builder, Advanced Approvals, Context Service, Salesforce Pricing, Price Waterfall, Transaction Pricing, Quote Capture, Standard Price Book), then deploy the Quote record page. Requires the Revenue Lifecycle Management add-on license, which aligns with the runbook's "Revenue Cloud not enabled" signal.
- Help rep permission sets also include Health Cloud Starter and Life Sciences Core (assign by label, consistent with the error table above).
- Admin Console path in Help: Admin Console > Orders Management > Quotes and Pricing settings tab.
- Regenerate the mobile metadata cache after any price book or pricing procedure change.
- Setup entry points, Store Check: Help "Set Up Store Check" (turn on in Salesforce Go > Agentforce Life Sciences > Store Check; seven-step Configure Store Check; Action Plan Type = LS Store Check; assortment UsageType = Store Check; publishing an action plan template locks it).

## Sources
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_om_basics.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_get_org_ready_users.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_store_check_setup.htm&release=264.0.0&type=5
