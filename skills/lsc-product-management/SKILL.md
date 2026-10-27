---
name: lsc-product-management
description: Guides Life Sciences Cloud (LSC) Product Management configuration. Use when user asks about product hierarchy, LifeSciMarketableProduct, product territory alignment, product messages, product objectives, product restrictions, product account restrictions, territory product priorities, ProductGuidance, TerritoryProdtQtyAllocation, Admin Console > Product Hierarchy, or product guidance that appears from a presentation but not when the product is added directly.
---

## How to Answer Product Management Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Product concepts, hierarchy, best practices | `get_lsc_module_docs({ module: "product-management" })` |
| Specific product topic (restrictions, priorities, messages, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| Product guidance appears from a presentation and is hidden when the product is added directly | `search_lsc_knowledge({ query: "presentation ProductGuidance EffectiveEndDate IsActive" })` then follow **Presentation guidance dates** below. Compare both paths before asking for a component name. |
| Admin Console product settings | `list_admin_settings({ category: "ProductManagement" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Object fields and relationships | `describe_sobject({ sobject: "LifeSciMarketableProduct" })` |
| Product data in the org | `run_soql({ query: "SELECT ... FROM LifeSciMarketableProduct ..." })` |
| Mobile cache status | `check_mobile_cache_status()` |
| Validation / audit | `audit_mobile_config({ group: "product-config-check" })` |

---

## Configuration Mode

When the user asks about configuring Product Management features, **ask them which mode they prefer**:

1. **Show me the documentation** — call `get_lsc_module_docs({ module: "product-management" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
list_trigger_handlers()
list_admin_settings({ category: "ProductManagement" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
toggle_trigger_handler({ handlerName: "ProductManagementTriggerHandler", active: true })
update_admin_setting({ recordId: "...", fields: { ... } })
```

#### Step 5: Verify
Re-run the checks from Step 1 to confirm everything is configured correctly.

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `Product2` | `Product__c` |
| `LifeSciMarketableProduct` | `MarketableProduct__c`, `ProductHierarchy__c` |
| `ProductGuidance` | `ProductMessage__c`, `ProductObjective__c` |
| `LifeSciTerritoryProductPriority` | `ProductPriority__c`, `TerritoryProduct__c` |
| `LifeSciProductAcctRstrc` | `ProductRestriction__c`, `ProductAlignment__c` |
| `TerritoryProdtQtyAllocation` | — |
| `ProductTerritoryAvailability` | `ProductAlignment__c` |
| `ProductTerrDtlAvailability` | — (read-only, created by alignment batch job only) |
| `ProductSpecificationType` | — |

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings`
- **DO NOT** use `run_soql` for mobile cache — use `check_mobile_cache_status()`
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app

### Product Territory Alignment Pipeline

`ProductTerritoryAvailability` (PTA) records link marketable products to territories. However, the platform actually reads from `ProductTerrDtlAvailability` (PTDA) — a read-only object that can **only** be created by the alignment batch job:

```
ProductTerritoryAvailability (PTA)     ← scriptable via Apex/API
        ↓ alignment batch job          ← Admin Console > Product (tile) > Product Alignment Jobs
ProductTerrDtlAvailability (PTDA)      ← read-only, cannot insert directly
```

**Key facts:**
- PTDAs are the master product pool for both Product Details and Samples panels
- After creating PTAs, the alignment batch job MUST run to generate PTDAs
- The batch job is NOT callable from anonymous Apex — it must be triggered from the Admin Console UI
- Brand-level and sample-level marketable products each need their own PTAs
- **PTAs must use `Territory and Subordinates Inclusion` at a parent territory** (e.g., `GB-COUNTRY`). Using `Territory Inclusion` at a leaf territory does NOT create PTDAs — the batch only generates PTDAs when expanding from parent to child.
- `SortOrder` on PTDA defaults to null — this does NOT block product display. A null value also does not explain Add Product order. That picker sorts by `LifeSciMarketableProduct.SortOrder` and uses PTDA only to decide which products appear. Territory `SortOrder` has to come first. See `knowledge/modules/visit-management/support-engineering-visit-add-product-sort.md`.

### Brand vs Product Marketable Product Types

- `Type = 'Brand'` — appears in **Product Details** during visits. Requires `ProductId = null`.
- `Type = 'Product'` — appears in **Samples** panel. Requires `ProductId` pointing to a Product2 record, plus `ParentBrandProductId` pointing to a Brand marketable product, plus `DistributionMethod` set.
- In multi-country setups, country sub-brands (e.g., "Immunexis GB") need `Type = 'Brand'` for Product Details.

## Presentation guidance dates

Load `knowledge/modules/product-management/support-engineering-presentation-guidance-dates.md`. Query `ProductGuidance` and the `PresentationPageProduct` that points at it. The reply must name `PresentationItemService.isActiveProductGuidance` and its DAO: they filter `IsActive` only and omit `EffectiveStartDate` and `EffectiveEndDate`. The direct product path applies those dates. Cite one guidance that is outside its window, present from the presentation, and absent when the product is added directly. An empty code search is not a reason to stop.
