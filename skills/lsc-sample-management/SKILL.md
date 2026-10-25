---
name: lsc-sample-management
description: Guides Life Sciences Cloud (LSC) Sample Management configuration for inventory, sample limits, and sample limit validation. Use when user asks about sample inventory, sample drops, sample limits, sample limit validation on mobile, the sample-limit ellipsis on a visit, PDMA compliance, inventory operations, production batches, product items, inventory counts, signature requirements, Product2/LifeSciMarketableProduct/ProviderSampleLimit/ProviderSmplLmtTmplAssignment objects, **Complete this field: Item** on a sample that already has an item, a ProductDisbursement delete rejected in the same transaction as visit submit, web Samples and Direct to Practitioner that do not render after a product is selected, or iPad Add Another and the side menu staying available after signature.
---

## Add Another after signature on iPad

When iPad still offers Add Another or a side-menu sample after the visit is signed, and the Product Item dropdown hides that product, load `knowledge/modules/visit-management/support-engineering-visit-signed-add-another.md`. Finish only when the reply states every fact under **Required answer**. `SamplesPlugin.canInsertForGroup` and `ProductMenuBloc` ignore the signature rule. This is not a web defect.

## Web Samples and DTP after a product is selected

When web Visit Engagement does not render Samples or Direct to Practitioner after a product is selected, and iPad does, load `knowledge/modules/visit-management/support-engineering-visit-sample-dtp-locale.md`. Finish only when the reply states every fact under **Required answer**. `Organization.DefaultLocaleSidKey` is `en_IE_EURO`, the old JDK form of English (Ireland, Euro). Switch the org to the ICU locale. Do not add a Product Disbursements related list.

## Disbursement delete in the same transaction as visit submit

When a `ProductDisbursement` delete is rejected while the visit is submitting, load `knowledge/modules/visit-management/support-engineering-visit-disbursement-delete-lock.md`. Finish only when the reply states every fact under **Required answer**. Query `ApexTrigger` on `ProductDisbursement`. The customer's unmanaged trigger `ProductDisbursementDeleteLock` is the cause. The managed submit lock is ruled out. The customer adds a same-transaction exemption. Do not ask for a package change. Do not use this section when the symptom is an iPad Visit missing on the device and still on the server.

## Sample batch null on save

When iPad shows **Complete this field: Item** and the sample already has a product item, load `knowledge/modules/visit-management/support-engineering-visit-sample-batch-null.md`. Finish only when the reply states every fact under **Required answer**. `checkAvailableQuantities` guards the `ProductionBatch` ID string, not the entity from the bulk load. A missing entry dereferences null. This is not a package 262 access-rights regression. Guard the resolved entity.

## Sample-limit menu missing

When the ellipsis next to a sample product is missing, or sample-limit enforcement does not run, load `knowledge/modules/visit-management/support-engineering-visit-sample-limits-profile.md`. Call `list_admin_settings({ category: "Visit" })` and read `ValidateSampleLimits` on the user's profile record. User overrides profile, and profile overrides org. Finish only when the reply states every fact under **Required answer**. A missing `ProviderSampleLimit` row is the cause only after that profile setting is on and the ellipsis is visible.

## Critical Knowledge: How Samples Are Resolved During a Visit

When a rep opens the **Samples** panel during Visit Engagement, the platform runs ~12 SOQL queries. The critical ones are:

### The PTDA Requirement (Most Common Root Cause)

`ProductTerrDtlAvailability` (PTDA) records are the **master product pool** for samples. Without them, samples will never appear. PTDAs are:
- **Read-only** — cannot be inserted via Apex, API, or Data Loader
- **Created only** by the alignment batch job from `ProductTerritoryAvailability` (PTA) records
- The batch job must be triggered from **Admin Console > Product (tile) > Product Alignment Jobs**

### PTA → Batch Job → PTDA Pipeline

```
ProductTerritoryAvailability (PTA)     ← Apex-scriptable
        ↓ alignment batch job          ← Admin Console UI only
ProductTerrDtlAvailability (PTDA)      ← read-only, cannot insert
```

**Brand-level AND sample-level** marketable products each need their own PTAs. Step 4 in the data loading flow only creates PTAs for Brand-level products. Sample-level products need separate PTAs + a batch job run.

### Critical: AlignmentType Must Be "Territory and Subordinates Inclusion"

PTAs must use **`Territory and Subordinates Inclusion`** at a **parent territory** (e.g., `GB-COUNTRY`). The batch job generates PTDAs by expanding parent alignments down to child territories. Using `Territory Inclusion` directly at a leaf territory (e.g., `GB-FSR-001-London`) does **NOT** create PTDA records — this is the most common cause of "samples not appearing after running the batch job."

### Query #9 — The Critical Sample Filter

This is where most "No items found" issues originate:
```sql
SELECT Id FROM LifeSciMarketableProduct
WHERE IsCompetitorProduct != true
  AND Type IN ('Product')
  AND ParentBrandProductId IN (:brandIdsFromQuery6)
  AND DistributionMethod IN ('Drop','DropAndShip')
  AND ProductId IN (:product2IdsFromQuery8)
  AND ProductSpecificationType IN ('LSSampleProduct')
```

ALL conditions must pass:
- `Type = 'Product'` (not Brand) — sample-level marketable products required
- `ParentBrandProductId` must point to a Brand marketable product aligned to the territory
- `DistributionMethod` must be `Drop`, `Ship`, or `DropAndShip`
- `ProductId` must be in the rep's inventory (`ProductItem` records)
- `ProductSpecificationType = 'LSSampleProduct'` (auto-populated from Product2)

---

## Critical Knowledge: Sample Limit Setup

Sample limits control how many sample units a rep can drop per visit or per period for a given HCP account. Getting them to work on mobile requires several data records, correct JSON formats, sharing, and Admin Console settings — all aligned.

### Sample Limit Data Model

```
ProviderSampleLimitTemplate          ← Defines rules (PerVisitLimit, PerPeriodLimit)
    ↓
ProviderSmplLmtTmplAssignment        ← Links template → Brand marketable product (Private OWD!)
    ↓
ProviderSampleLimit                  ← Links template → Account × Brand product (contains Rule JSON)
    ↓
Mobile validation on submit          ← Checks qty against Rule JSON
```

### The #1 Rule: Limits Must Be at Brand Level

`ProviderSampleLimit.ProductId` and `ProviderSmplLmtTmplAssignment.ProductId` must point to **Brand-level** marketable products (Type = 'Brand'), NOT SKU-level (Type = 'Product').

The mobile app resolves limits by walking **up** the product hierarchy from the dropped SKU to find its parent Brand, then queries `ProviderSampleLimit` for that Brand × Account. If the PSL record points to a SKU, the hierarchy walk never finds it, and validation **silently skips**.

**How to verify:** Check `productType` in the `ProviderSampleLimit.Rule` JSON:
- `"Brand"` = correct
- `"LSSampleProduct"` = wrong (SKU-level), validation will not fire

### ProviderSmplLmtTmplAssignment Has Private OWD

This is the most common cause of "validation works on web but not mobile":
- **Web** runs server-side in system context — reads all records regardless of sharing
- **Mobile** syncs to local SQLite in **user context** — if the assignment isn't shared with the rep, it won't sync, and validation silently skips

**Fix:** Create `ProviderSmplLmtTmplAssignmentShare` records for each assignment × rep user, or change OWD to Public Read Only.

### Sample Limit Setup Steps

1. Create a custom `ProviderSampleLimitTemplate` with valid date ranges (do NOT use the default `lsc4ce_GenericTemplate` — its dates are empty and cause null dereference)
2. Create `ProviderSmplLmtTmplAssignment` at **Brand level** with RuleCondition in map format
3. Share assignments with rep users (`ProviderSmplLmtTmplAssignmentShare`)
4. Run "Assign Sample Limit Templates to Accounts" batch job from **Admin Console > Sample Limits (tile) > Sample Limit Jobs** — generates `ProviderSampleLimit` records with correct Rule JSON
5. Verify generated PSL records have `productType: "Brand"` in Rule JSON
6. Enable "Validate sample limits" in Admin Console > Visit Settings
7. Ensure all 3 DbSchema OMCC (`LifeSciConfigRecord`) entries exist and are active:
   - `DbSchema_ProviderSampleLimit`
   - `DbSchema_ProviderSampleLimitTemplate`
   - `DbSchema_ProviderSmplLmtTmplAssignment`

   **How to check:** Query via Tooling API (NOT SOQL — `LifeSciConfigRecord` is not queryable via standard SOQL):
   ```
   SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord
   WHERE DeveloperName IN (
     'DbSchema_ProviderSampleLimit',
     'DbSchema_ProviderSampleLimitTemplate',
     'DbSchema_ProviderSmplLmtTmplAssignment'
   )
   ```

   **How to create missing entries:** Deploy as `LifeSciConfigRecord` metadata XML. Each file must include the full structure: `<fieldValues>` entries (especially `<fieldName>SObject</fieldName>` with `<objectValue>` set to the target object API name), profile `<assignments>`, and `<lifeSciConfigCategory>DbSchema</lifeSciConfigCategory>`.

   **Two-phase deployment required:** Deploy with `<isActive>false</isActive>` first, then redeploy with `<isActive>true</isActive>`. Deploying active in a single step fails with `Enter: [Type, SObject]`.

### Rule JSON Format

The `Rule` field on `ProviderSampleLimit` uses this structure (batch job generates it automatically):

```json
{
  "template": {
    "operations": [
      { "operation": "RULE", "rule": "PerVisitLimit" },
      { "operation": "RULE", "rule": "PerPeriodLimit" },
      { "operation": "AND" }
    ],
    "name": "lsc4ce_GenericTemplate",
    "blockType": "Error",
    "label": "Generic Template"
  },
  "products": {
    "<Brand MktProd Id>": {
      "rules": {
        "PerVisitLimit": {
          "quota": 2,
          "remaining": 2,
          "strategy": "SKU",
          "calculation": "SamplesPerVisit",
          "label": "Maximum Quantity per Visit",
          "starts": "2026-01-01",
          "ends": "2026-12-31",
          "period": { "type": "SampleLimitDateRangePeriod", "params": {} }
        },
        "PerPeriodLimit": {
          "quota": 10,
          "remaining": 10,
          "strategy": "SKU",
          "calculation": "SamplesInPeriod",
          "label": "Maximum Quantity per Period",
          "starts": "2026-01-01",
          "ends": "2026-12-31",
          "period": { "type": "SampleLimitDateRangePeriod", "params": {} }
        }
      },
      "info": {
        "productType": "Brand",
        "excludedChildProducts": [],
        "annualAllocations": {}
      }
    }
  }
}
```

Key fields:
- `template.blockType`: `"Error"` blocks submission; `"Warning"` allows it
- `template.operations`: Boolean logic — `AND` means both rules must pass
- `products.<id>`: Key is the **Brand-level** marketable product ID
- `info.productType`: Must be `"Brand"` — `"LSSampleProduct"` means wrong level
- `info.excludedChildProducts`: Must be present (array of SKU IDs to exclude)
- `strategy: "SKU"`: Quotas tracked per SKU independently, but quota values are the same for all SKUs under the Brand
- `remaining`: Runtime counter decremented as drops are recorded
- `starts`/`ends`: Must cover the current date or validation won't apply

The `RuleCondition` on `ProviderSmplLmtTmplAssignment` uses a **different** map format keyed by rule name:

```json
{
  "PerPeriodLimit": {
    "name": "PerPeriodLimit",
    "label": "Maximum Quantity per Period",
    "strategy": "SKU",
    "quota": 10,
    "calculation": "SamplesInPeriod",
    "period": {
      "type": "SampleLimitDateRangePeriod",
      "params": { "starts": "2026-01-01", "ends": "2026-12-31" }
    }
  },
  "PerVisitLimit": {
    "name": "PerVisitLimit",
    "label": "Maximum Quantity per Visit",
    "strategy": "SKU",
    "quota": 2,
    "calculation": "SamplesPerVisit",
    "period": {
      "type": "SampleLimitDateRangePeriod",
      "params": { "starts": "2026-01-01", "ends": "2026-12-31" }
    }
  }
}
```

**Do NOT use array format** (`[{...}]`) for assignment RuleCondition — it must be the map/object format above.

### Template Name Must Be DeveloperName

`ProviderSampleLimit.PrvdSampleLmtTemplateName` must use the template's **DeveloperName** (e.g., `GB_Sample_Limit_Template`), not the MasterLabel. Wrong name = batch job returns 0 rows and hits null reference.

### SignatureRequirementLevel

Set `LifeSciMarketableProduct.SignatureRequirementLevel` to `Mandatory` on sample SKUs to require signature capture during sample drops. Values: `Mandatory`, `Optional`, `NotRequired`.

### Sample Limit Diagnostic Checklist

When limits don't fire on mobile:
- `ProviderSampleLimit.ProductId` → Brand-level marketable product?
- Rule JSON `productType` = `"Brand"` (not `"LSSampleProduct"`)?
- `ProviderSmplLmtTmplAssignment` shared with rep user?
- "Validate sample limits" enabled in Visit Settings?
- All 3 DbSchema OMCC entries exist and active? (Query via **Tooling API**, not SOQL: `SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord WHERE DeveloperName IN ('DbSchema_ProviderSampleLimit', 'DbSchema_ProviderSampleLimitTemplate', 'DbSchema_ProviderSmplLmtTmplAssignment')`) — if any are missing, the mobile app won't sync the corresponding objects and validation silently skips
- Product hierarchy fully linked (`ParentTherapeuticAreaId` at all levels)?
- Rule JSON date ranges cover today?
- `PrvdSampleLmtTemplateName` uses DeveloperName?
- iPad synced after changes?

---

### SortOrder on PTDA Is NOT Required

`SortOrder` on `ProductTerrDtlAvailability` defaults to null. Query #2 filters by `SortOrder != null`, which often returns 0 rows. This does NOT block samples — the platform uses all PTDAs for the territory (queried by `TerritoryId`) regardless of `SortOrder`.

### Admin Console Navigation

- Product Alignment: **Admin Console > Product (tile) > Product Alignment**
- Alignment Jobs: **Admin Console > Product (tile) > Product Alignment Jobs**
- Sample Limit Jobs: **Admin Console > Sample Limits (tile) > Sample Limit Jobs**
- These are NOT under Salesforce Setup — they are tiles in the Admin Console app.

---

## How to Answer Sample Management Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Sample concepts, data setup chain, best practices | `get_lsc_module_docs({ module: "sample-management" })` |
| Specific topic (sample limits, PDMA, inventory counts, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| Current org sample configuration | `check_sample_config()` |
| Admin Console sample settings | `list_admin_settings({ category: "SampleManagement" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Object fields and relationships | `describe_sobject({ sobject: "ProductItem" })` or `describe_sobject({ sobject: "ProductDisbursement" })` |
| Mobile cache status | `check_mobile_cache_status()` |
| Inventory data in the org | `run_soql({ query: "SELECT ... FROM ProductItem ..." })` |
| Validation / audit | `audit_mobile_config({ group: "sample-config-check" })` |
| Sample drops during visits (test cases) | `search_lsc_knowledge({ query: "sample inventory validation visit" })` |
| Sample limit setup or troubleshooting | `search_lsc_knowledge({ query: "sample limit validation" })` |
| Sample limit not firing on mobile | Check: PSL at Brand level? Assignment shared? Visit Settings enabled? DbSchema active? |

---

## Configuration Mode

When the user asks about configuring or enabling Sample Management features, **ask them which mode they prefer**:

1. **Show me the documentation** — call `get_lsc_module_docs({ module: "sample-management" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
check_sample_config()
list_trigger_handlers()
list_admin_settings({ category: "SampleManagement" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
toggle_trigger_handler({ handlerName: "SampleManagementTriggerHandler", active: true })
update_admin_setting({ recordId: "...", fields: { ... } })
create_admin_setting({ category: "SampleManagement", developerName: "...", label: "..." })
```

#### Step 5: Verify
Re-run `check_sample_config()` to confirm everything is configured correctly.

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `Product2` | `SampleProduct__c` |
| `LifeSciMarketableProduct` | — |
| `Location` | `SampleInventory__c` |
| `ProductionBatch` | `SampleLot__c`, `ProductBatch__c` |
| `ProductItem` | `InventoryItem__c` |
| `ProductBatchItem` | — |
| `InventoryOperation` | `SampleTransaction__c` |
| `ProductRequest` | `SampleRequest__c` |
| `InventoryCountAssessment` | `SampleCount__c`, `InventoryCount__c` |
| `ProductDisbursement` | `SampleDrop__c` |
| `ProviderSampleLimit` | `SampleLimit__c` |
| `ProviderSampleLimitTemplate` | — |
| `ProviderSmplLmtTmplAssignment` | — (Private OWD — must share with rep users) |
| `ProviderSmplLmtTmplAssignmentShare` | — (sharing object for template assignments) |
| `PrvdVstSmplLmtTransaction` | — |
| `PrvdVstSmplLmtDiscrepancy` | — |
| `TerritoryProdtQtyAllocation` | `TerritoryProductQtyAllocation`, `SampleAllocation__c`, `ProductAllocation__c` |
| `ProductTerritoryAvailability` | `ProductAlignment__c` |
| `ProductTerrDtlAvailability` | — (read-only, created by alignment batch job only) |

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings` / `check_sample_config`
- **DO NOT** use `run_soql` for mobile cache — use `check_mobile_cache_status()`
- **DO NOT** try to query `LifeSciConfigRecord` with `run_soql` — it requires the Tooling API
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app
