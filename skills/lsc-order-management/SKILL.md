---
name: lsc-order-management
description: Guides Order Management (quoted orders) and Store Check setup and troubleshooting for web and iPad. Use when user asks about quotes, quoted orders, quote line items, price books, price book entries, pricing procedures, pricing recipes, decision tables, volume or tiered discounts, price adjustment schedules or tiers, header or order discounts, free goods, price waterfall, offline pricing, Sales Transaction Type, ProductTerritoryAvailability, products missing on Add Products, Product Views (Last Order, Store Assortment), quote locking, Submit, Request for Unlock, quote approval, quote PDF or document template, signature, Store Check, assortments, assessment tasks or indicators, Retail Store KPIs, store check photos, or making or cloning a quotable product.
---

## How to Answer Order Management / Store Check Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Setup, pricing, locking, rep flow, Store Check | `search_lsc_knowledge({ query: "<topic> order management" })`, then `get_lsc_module_docs({ module: "order-management" })` for the full docs |
| Official wording (Help) | `get_lsc_help_doc` / the `lsc-docs-researcher` agent |
| Check an org's setup | `check_om_config()` (read-only; lists what it can't check and why) |
| An error or symptom | `diagnose_lsc_issue({ symptom: "<error text>" })` (known causes `om-*`, `sc-*`) |
| DB Schema for quotes, price books, photos | `list_db_schema`, `get_db_schema` |
| Quotes and Pricing settings, Product Views | `list_admin_settings` (category for Orders Management) |
| StagePathPermissionsHandler | `list_trigger_handlers` |
| Products, availability, price books, tiers, quotes, stages | `run_soql` on `Product2`, `ProductTerritoryAvailability`, `ProductTerrDtlAvailability`, `PricebookEntry`, `PriceAdjustmentTier`, `Quote`, `LifeSciStageOperation` (standard objects) |
| Mobile cache | `generate_mobile_metadata_cache({ profileName })` — **one profile per call** |

Admin Console data, DB Schema and actions use their dedicated tools, never `run_soql`.

## Model in one picture

`Quote` (Account, Price Book, currency from the rep's user record, `Status` drives the stage path) → `QuoteLineItem` → `PricebookEntry` (Standard entry first, then custom, same currency and selling model). Price = pricing procedure (Life Sciences Commercial subtype) → recipe → decision tables (Price Book Entries V2 → List Price, Volume Discount Entries, Tiered Adjustment Entries) → `PriceAdjustmentSchedule` / `PriceAdjustmentTier`. Product visible to a rep = `ProductTerritoryAvailability` (Purpose **Quote**; Store Check uses its own Purpose) → generated `ProductTerrDtlAvailability` for the rep's territory, plus catalog membership and a price in the quote's currency.

## Setup order (what worked)

1. Licences: LSC plus the Revenue Lifecycle Management add-on (missing permission set licences come from the account team, not a toggle). Turn on Order Management from the Salesforce Go card.
2. Permission sets — admin: Context Service Admin and Runtime, Life Sciences Commercial Admin, Life Sciences Core, Product Catalog Management Designer and Viewer, Salesforce Pricing Admin. Rep: Health Cloud Starter, Life Sciences Core, Life Sciences Field Sales Representative, Product Catalog Management Viewer, Document Builder User, Price and Tax Calculation for Quoting, Salesforce Pricing Runtime User.
3. Data: Product2, selling model, catalog and category, Standard then custom price book entries, tiers, Quote availability per territory.
4. One pricing procedure and recipe of the Life Sciences Commercial subtype; activate (Rank 1); refresh the decision tables.
5. Admin Console Quotes and Pricing settings (org or profile): pricing procedure, Product Views, last order status.
6. Quote Status values (Draft, Submitted, Request for Unlock, In Review, Rejected), stage path, StagePathPermissionsHandler active, lock and approval flows.
7. Quote document template in Document Builder.
8. DB Schema pairs (Quote + QuoteLineItem, Pricebook2 + PricebookEntry) assigned to the rep profile together; generate the cache; sync and reopen the app.

## Rules to state up front

- **Which procedure prices a quote:** the quote's Sales Transaction Type procedure when it names one, else the rep's profile Quotes and Pricing setting, else the org-level one. The iPad can only run an active Life Sciences Commercial procedure. When explaining a price, walk this chain, then list price → volume/tier → line discount → header discount, and say what differs offline.
- **Offline (iPad) differences:** pricing runs on save in the offline engine; no contract pricing or bundles; no rounding step. The price adjustment matrix **is** supported offline, but its rows with Effective From/To never match there. Header discounts need Header Adjustments on in Revenue Settings.
- **Availability:** a `ProductTerritoryAvailability` row with Purpose **Quote** and an alignment type (Territory Inclusion, Territory Exclusion, Territory and Subordinates Inclusion) becomes a `ProductTerrDtlAvailability` row for the territory in one of two documented ways — **always name both, and never call either one the only way**: insert it with Status **Queued** and the platform processes it (Help's per-row path), or insert it with Status **Draft** and run **Publish Draft Product Territory Alignments** from the Admin Console (bulk). Never insert or set it Active by API; such rows never get detail rows and can't go back to Draft. No detail row, no product. A detail row alone isn't enough: the product also needs catalog membership (`ProductCategoryProduct`) and a `PricebookEntry` in the quote's currency and price book. Store Check availability (Purpose Visit) doesn't make a product quotable.
- **Territory Exclusion is a valid setup, not a mistake.** An Exclusion row blocks the product in that territory on purpose; the mobile cache filters on `AlignmentType = 'Territory Exclusion'` and the iPad hides those products. When a product is missing because of an Exclusion row, say that the row blocks it and ask whether the block is intended. Never propose converting it to Inclusion, or deleting and re-inserting it, unless the user says the block is wrong. Exclusion rows never get detail rows, so any query or cleanup for "stuck" rows (no `ProductTerrDtlAvailability`) must filter `AlignmentType != 'Territory Exclusion'`; without it a cleanup deletes deliberate blocks.
- **Store Check targets are per assortment, not per store.** `RetailStoreKpi` targets link to an assortment product (`CustomContextId` = `AssortmentProduct.Id`), so every store on that assortment gets the same target. To vary targets by store, create separate assortments per store tier (e.g. Tier 1, 2, 3), each with its own targets, and assign stores to them. Action plan template assignments also link to an assortment or store assortment, so stores on one assortment share one template. Never say targets can be set per store.
- **Tiers:** find them with `PriceAdjustmentTier WHERE Product2Id`, need an Effective From, and need the decision tables refreshed.
- **What must sync:** the DB Schema list in the admin setup doc (section 7 and the mobile cache objects line) is the documented set. Decision tables, expression sets and context definitions reach the iPad inside the cache itself (`decisionTable.json`, `expressionSet.json`, `contextDefinition.json`), so an inactive or missing DB Schema record for an object not on that list (e.g. `DecisionLogic`, `SalesTransactionType`) is not a gap: never tell the admin to add or activate one unless a source lists it. Only a custom Price Adjustment Matrix source entity needs its own record.
- **Cache:** regenerate after any product, price book, procedure, tier, layout or Admin Console change. A territory-only availability change needs just a sync; a new or cloned product needs a new cache.
- **Making or cloning a quotable product:** follow the 8-item quotable checklist in the setup runbook and name all eight — product, category, selling model option, Standard then custom entries, Quote availability, **sharing** (Private objects need a share for the reps; check the org-wide default first), **tiers**, **cache**. For preview requests, list every record and write nothing.
- **Locking:** a stage is locked only when CanCreate, CanEdit and CanDelete are all false **and** StagePathPermissionsHandler is active. Submitted locks the quote; Request for Unlock goes to the owner's manager through a record-triggered flow (approve → Draft, editable again; reject → Rejected, locked). Unlock requests work offline. Approval steps that update the quote must run as a named admin, not the Automated Process user. Help builds it as a Record-Triggered Flow Approval Process on Quote with entry condition `ISCHANGED({!$Record.Status})||ISNEW()` and the approver formula `{!$Record.Owner:User.Manager.Username}`. To scope it (e.g. one country), add a condition to that entry formula — say this is an extension, not a Help step.
- **Quote PDFs:** Help: build a Document Builder template on Quote (Default Quote Template, Life Sciences Flexi Signature component), then create a **quick action on the Quote page** that generates the PDF with it. Revenue Cloud's own PDF quick action doesn't generate PDFs for LSC quoted orders. Separately, the iPad has a **Generate PDF** stage action; on web that one stage action shows "Unknown component" — that note is about the stage action only, not about PDFs on web. Over 750 line items PDF generation fails.
- **Where a rep starts a quote (iPad):** any of Account related list, Visit record, the Visit's Quoted Orders tab, Visit related list, Quoted Order. Most often from a visit after a store check.
- **Store Check photos:** any assessment task type, not only Planogram Check; each photo must be linked to at least one indicator. Rep profile needs access to Image; Image and Content Document sync with write access; the Image DB Schema attachment download method must be **Background** (Cache: the photo syncs but doesn't show).
- **Say limits as narrowly as the source does.** A note that one action or component fails on one platform doesn't mean the feature is "web only", "iPad only" or "the only way". If no source says "only", don't say it.
- **Currency:** a new quote takes the rep's currency; if rep, store and price book differ, price books and products come up empty.

## Troubleshooting flow

**Budget:** stop querying after about 8 org queries (`run_soql`, `describe_sobject`, `get_record`, config checks) — count them — and answer. Give the likeliest cause from what you found, the next check or fix, which points you couldn't verify, and offer to dig further. Don't re-run a query with small variations; when a query fails or comes back empty, say so and move on rather than retrying it.

**Field names:** use the fields below. For any object or field not listed, call `describe_sobject` once before querying it. When a query fails with a field or object error, fix it from the describe, never by guessing another name.

| Object | Fields to use | Not fields (don't query) |
|---|---|---|
| `ProductTerritoryAvailability` | `ProductId`, `RelatedProduct2Id`, `TerritoryId`, `AlignmentType`, `Purpose`, `UsageType`, `Status`, `IsDisqualified` (`Name` is an auto-number, not an Id) | `Product2Id`, `Territory2Id` |
| `ProductTerrDtlAvailability` | `ProdtTerritoryAvailabilityId`, `ProductId`, `RelatedProduct2Id`, `TerritoryId`, `RelatedTerritoryId`, `IsActive`, `IsQualified`, `Purpose`, `UsageType` | |
| `PriceAdjustmentTier` | `PriceAdjustmentScheduleId`, `Product2Id`, `LowerBound`, `UpperBound`, `TierType`, `TierValue`, `EffectiveFrom`, `EffectiveTo`, `ProductSellingModelId`, `AdjustmentType` | `MinimumQuantity`, `Status` |
| `PriceAdjustmentSchedule` | `IsActive`, `ScheduleType`, `AdjustmentMethod`, `EffectiveFrom`, `EffectiveTo`, `Pricebook2Id` | |
| `ExpressionSet` / `ExpressionSetVersion` | `ApiName`, `UsageType`, `UsageSubtype` / `ExpressionSetId`, `VersionNumber`, `Rank`, `IsActive`, `StartDateTime`, `EndDateTime` | `Status`, `PricingProcedureId` |
| `ProductSellingModelOption` | `ProductSellingModelId`, `Product2Id`, `IsDefault` | |
| `ProductCategoryProduct` | `ProductCategoryId`, `ProductId`, `CatalogId`, `IsPrimaryCategory` | |
| `FlowDefinitionView` | `ApiName`, `Label`, `ProcessType`, `TriggerType`, `IsActive`, `ActiveVersionId`, `TriggerObjectOrEventLabel`, `RecordTriggerType` (no `OR` in WHERE: "Disjunctions not supported") | `DeveloperName`, `Status` |
| `LifeSciStageObject` | `Name`, `ObjectName` (`'Quote'`), `IsControlledByStagePath`, `ValidationCustomScriptId` | |
| `LifeSciStagePath` | `Name`, `LifeSciStageObjectId`, `FieldApiName`, `StageObjectRecordTypeId`, `Status` | `DeveloperName`, `MasterLabel` |
| `LifeSciStageOperation` | `LifeSciStageValueId`, `LifeSciStageObjectId`, `CompoundRelationshipName`, `CanCreate`, `CanEdit`, `CanDelete`, `Type` | |
| `UserTerritory2Association` | `UserId`, `Territory2Id`, `IsActive`, `RoleInTerritory2` | `Name` |
| `ActionPlanTemplate` / `…Version` | `ActionPlanType`, `TargetEntityType`, `UniqueName`, `Status` / `ActionPlanTemplateId`, `Version`, `Status` | `Type` |
| `ActionPlanTemplateAssignment` | `ActionPlanTemplateVersionId`, `AssociatedObjectId` (an Assortment or StoreAssortment) | `ActionPlanTemplateId` |
| `Assortment` / `AssortmentProduct` / `StoreAssortment` | `UsageType`, `Type`, `StartDate`, `EndDate` / `AssortmentId`, `ProductId`, `IsRequired` / `AssortmentId`, `AccountId`, `RetailStoreId`, `StartDate`, `EndDate` | `Assortment.IsActive` |
| `RetailStoreKpi` | `AssessmentIndDefinitionId`, `ProductId`, `CustomContextId` (the AssortmentProduct), `RetailStoreGroupId`, `StartDate`, `EndDate` | |

Not queryable with SOQL: `RevenueManagementSettings`, `FlexiPage`, `OrdersAndPricingSettings` (read Quotes and Pricing settings with `list_admin_settings`), `LifeScienceTriggerHandler` (use `list_trigger_handlers`), `AccountTeamMember` (only exists when Account Teams is turned on; LSC reps get accounts from territories — `ObjectTerritory2Association` has `ObjectId`, not `AccountId`). `Quote.Owner.ManagerId` fails (Owner is polymorphic); read `User.ManagerId` for the owner instead.

`describe_sobject` takes `fields` (e.g. `["Status", "SalesTransactionTypeId"]`) and returns their picklist values and lookup targets, including fields past the first 100. Never use `run_apex` just to read a field, a picklist or a record: describe or query instead. Don't offer `run_apex` for a single-record write either: deleting, creating or updating one record is `delete_record`, `create_record` or `update_record` (each still needs the user's approval). When you write out a fix, name the record and the tool; never write it as Apex or DML (`DELETE [SELECT …]`, `insert new …`). When `run_soql` rejects a field, its error lists the object's real fields — pick from that list.

**Before theorising from org data:** read the Help troubleshooting table (`release-264-order-management-help-troubleshooting.md`, via `search_lsc_knowledge`). When the symptom matches a row, lead with Help's cause and fix, then check the org for it.

**Reading permission data:**
- `QuoteLineItem` and `OpportunityLineItem` get their access from the parent (`Quote`, `Opportunity`); they have no `ObjectPermissions` rows of their own. Zero rows for them is normal, never a cause, and never a reason to grant object access.
- A permission query tells you what a permission set grants, not what a rep holds; check the rep's assignments before concluding.

**Calling something a cause:** say "the cause" only when a source (Help, the KB, a known cause) names it or the org shows it directly. Otherwise say "possible cause" and name the check that would confirm it. Never invent why web and iPad differ.

**Wording:** don't quote internal labels from the KB (work item or feature numbers such as `W-`, `FP-`, `K25`) in answers; describe the behaviour instead.

1. Run `diagnose_lsc_issue` with the exact error or symptom; with an org connected, run `check_om_config`.
2. Check the cache predates nothing: was the fix made after the last cache? Regenerate, sync, reopen the app.
3. Products missing: currency, Quote availability with detail rows for the rep's territory, catalog, price book entry.
4. Store Check shows no products (or the wrong ones): the action plan template to assortment (or store assortment) assignment sets each task's products; Product Territory Availability, Product Territory Detail Availability (`Purpose = 'Visit'`) and, if used, Life Sciences Product Account Restriction must all sync (DB Schema assigned to the rep) — if they don't, the list is empty; assortments with Usage Type Store Check; then the cache. Also check `sc-*` known causes (e.g. a template with several versions).
5. Price wrong on iPad only: procedure chain, subtype, offline differences above, decision table refresh.
6. Quote won't submit, lock or unlock: Status values and FLS, handler, stage flags, manager, approval flow run-as.
7. Check the known limitations in the Store Check troubleshooting doc before changing the org.
