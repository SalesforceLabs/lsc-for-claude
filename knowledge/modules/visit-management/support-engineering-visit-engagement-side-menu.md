# Visit Engagement Side Menu Bar — Support Engineering Training

**Session:** LSC4CE Value Chain Training — Apr 3, 2026
**Audience:** Support engineers
**Source:** Engineering training series (deck + Gemini transcript)
**Presenter:** Srikant Chonnad

## Overview

The Visit Engagement screen is rendered from a **merged layout** that pulls from BOTH the `Visit` and `ProviderVisit` objects — each contributes different parts. The left sidebar is driven entirely by the `Visit` layout's related lists, filtered through an internal allowed list, with FLS applied. Support escalations cluster around three areas: products not appearing, custom related lists silently ignored, and custom fields rendering unpredictably because they're on the wrong object.

> **The cardinal rule:** Put custom fields on **`ProviderVisit`**, not on `Visit`. Custom fields on `Visit` are ignored on the engagement screen — only a hard-coded set of standard fields is extracted from the Visit layout.
>
> **Exception:** `ProviderVisitProductDtlId` does not belong on the Provider Visit layout. With it there, the Provider Visit Information merged fields render empty. Remove the field. See [support-engineering-visit-information-dtl-field.md](./support-engineering-visit-information-dtl-field.md).
>
> **Exception:** `ProviderVisit.AdditionalInformation` is system-managed JSON (account/provider snapshot). Do not put it on the Visit Engagement layout, even though it already lives on ProviderVisit. See [support-engineering-visit-additional-information.md](./support-engineering-visit-additional-information.md).

## The Merged Layout

```
Visit Engagement Screen
   ▲
   │── Primary layout: ProviderVisit (fields + record types come from here)
   │
   └── Visit layout contributes:
        ├── Specific header fields ONLY: AccountId, PlaceId, PlannedVisitStartTime,
        │   PlannedVisitEndTime, Channel, Status, RecordTypeId
        │   (these REPLACE the same fields on the ProviderVisit layout)
        │
        └── ALL related lists (these REPLACE the ProviderVisit layout's related lists
            and become the sidebar)
```

### Custom field behavior — the one thing to remember
| Field location | Appears on engagement screen? |
|---|---|
| Custom field on **ProviderVisit** layout | ✅ Yes |
| Custom field on **Visit** layout | ❌ No (silently ignored) |

> Only the hard-coded standard Visit fields (Account, Place, Start/End Time, Channel, Status, RecordType) are extracted from Visit. Every other field on the Visit layout — including all custom fields — is discarded.

## Sidebar Sections — What Drives Each

| Section | Related list to add on Visit layout | Driving setting(s) |
|---|---|---|
| **Product Detailing** | `ProviderVisitProductDetailing` | — |
| **Product Messaging** (under detailing) | `ProviderVisitProductDetailing` + `ProviderVisitDetailProductMessage` | — |
| **Product Discussion** (under detailing) | `ProviderVisitProductDetailing` + `ProviderVisitProductDiscussion` | `DiscussOffLabelProducts` |
| **Attendees** | Child Visit related list | — |
| **Samples** | `ProductDisbursement` | `RequireBatchNumber`, `ValidateSampleInventory`, `ValidateSampleLimits`, `HcoTypesForSamplesAndItems` |
| **Marketing Items** | `ProviderVisitMarketingItem` | `HcoTypesForSamplesAndItems` |
| **DTP / Requested Samples** | `ProviderVisitRqstSample` | `ValidateTerritoryQtyAllocation`, `ValidateSampleLimits`, `HcoTypesForSamplesAndItems` |
| **Presentations (Intelligent Content)** | `PresentationForum` | `TargetingContext` |
| **Visitor (Employee)** | Visitor related list | `ProfilesAvailableInEmployeeSearch` |
| **Custom Object related lists** | Custom object with lookup field name ending in `Visit__c` | — (max 2) |

## Product Loading Logic (sidebar)

A product appears in the sidebar IF AND ONLY IF:

1. `LifeSciMarketableProduct` record exists
2. **Territory-aligned** via `ProductTerritoryAvailability` with the user's active territory (and NOT territory-excluded)
3. `IsCompetitorProduct != true` (competitor products are filtered out)
4. (For samples) Child product of `Type = Drop` exists
5. (For samples) `ProductItem` exists with a `Location` linked to the User, where `Location.IsInventory = true` and `Location.Type` matches the Samples Management setting

### Hierarchy grouping
Products are grouped in the UI by hierarchy: `parentProduct`, `parentIndication`, `parentTherapeuticArea`.

### Product Restrictions
`LifeSciProductAcctRstrc` defines:
- **Account-level restrictions** (no territory specified) — globally restricted for the account
- **Territory-specific restrictions** — restricted only in a specific territory

Override: if `HealthcareProvider.IsProdtRstrcOverridden = true`, ALL restrictions for that account are bypassed.

When a sidebar product renders, it checks restrictions against ALL of the visit's accounts (primary + attendees) and blocks usage if restricted for any of them.

## Attendee Loading Logic

Attendees come from **two sources** with a combined cap of **10**:

| Source | Records pulled | Cap |
|---|---|---|
| **Address-matched** | Accounts whose `ContactPointAddress` matches the visit's Place/Location | Max 5 |
| **Affiliation** | `ProviderAffiliation` where visit's Account is the AccountId or RelatedAccountId | Max 10 - (count of address-based) |

Address-based accounts are displayed first; affiliations fill the remainder up to 10.

## Sample Disbursement — Field Behavior

Each disbursement row has two key fields:
- `ProductItem` — always required
- `ProductionBatchId` (lot) — required only when `RequireBatchNumber = true`

### Lot dropdown filtering (when `RequireBatchNumber = true`)
Lots are loaded by querying `ProductionBatch` records for the selected product, then filtered:
- **Expired lots excluded** UNLESS `DisplayExpiredLots = true`
- **Zero remaining quantity lots excluded**

### `ValidateSampleInventory` (default: `false`)
| Value | Behavior |
|---|---|
| `false` | Rep can disburse any quantity regardless of remaining lot inventory |
| `true` | Each disbursement checked against `ProductBatchItem.RemainingQuantity` AND `MaxDisbursementLimitQty` from `TerritoryProdtQtyAllocation` |

`SampleInventoryValidationMode`:
- `Error` → blocks save
- Anything else → warning popup; rep can confirm; violation recorded

### `ValidateSampleLimits`
Enforces account-level compliance caps from `ProviderSampleLimitTemplate` + `ProviderSampleLimit`. Counts BOTH physical disbursements AND DTP requests toward the same limit (a sample limit of 5 means 5 total across disbursements + DTPs).

### `HcoTypesForSamplesAndItems`
Default: HCOs cannot receive samples / DTP / marketing items (HCO sections disabled in sidebar). Override by listing HCO record-type developer names, semicolon-separated (e.g., `Pharmacy;Clinic;RetailStore`).

## Intelligent Content (Presentations) Targeting

| `TargetingContext` value | Sidebar behavior |
|---|---|
| `None` | All presentations shown regardless of targeting |
| `Warn` (or `Suggestion`) | Non-targeted presentations show a warning but can be selected |
| `Restrict` | Non-targeted presentations are disabled (cannot be selected) |

Targeted presentation IDs are stored on `ProviderAcctTerritoryInfo.TargetedPresentationInfo` as a **semicolon-delimited list of presentation Source System Identifiers**.

Configure: Admin Console → Intelligent Content → Presentation Settings → Targeted Presentation Settings → Targeting Context.

## Visitor (Employee) Search Filtering

`ProfilesAvailableInEmployeeSearch` (semicolon-separated Profile IDs) controls which users appear in the visitor search modal.

### Search criteria
- Profile ID IN configured list (if set)
- `IsActive = true`
- Excludes current user and their manager (shown separately)
- Filter by search text (name LIKE)

> **Default behavior (setting blank):** ALL active users (minus the current user and their manager) appear in search.

## Custom Related Lists — the rules and the gotchas

### Setup (in order)
1. Create the custom object (e.g., `MedicalInsight__c`)
2. Create a lookup field on it pointing to **Visit**, with the field's API name **ending in `Visit__c`** (e.g., `RelatedVisit__c`, `OurVisit__c` — anything as long as it ends with `Visit__c`)
3. Add desired fields to the custom object
4. Add the custom object as a related list on the **`Visit` page layout** (not `ProviderVisit`) — appears as `MedicalInsight__c.<lookup-field-name>`
5. Grant FLS for the user's profile on the object + fields
6. Record types on the custom object are supported

### Key constraints (these cause silent failures)
- **Max 2 custom related lists.** A 3rd is silently ignored. Order in the layout determines which 2 win.
- **Lookup field name MUST end with `Visit__c`.** Names like `VisitId__c` or `VisitRelated__c` will NOT work.

## Troubleshooting

### "Custom field I added isn't appearing on the engagement screen"
**Cause:** Field is on the `Visit` layout, not the `ProviderVisit` layout.
**Fix:** Move the custom field to `ProviderVisit` layout. Standard `Visit` fields are auto-extracted; custom `Visit` fields are not.

### "3rd custom related list isn't showing"
**Cause:** Max 2 custom related lists supported.
**Fix:** Reorder the layout to put the 2 most important custom related lists at the top.

### "Custom related list isn't loading at all"
**Cause (most common):** Lookup field API name doesn't end in `Visit__c`.
**Fix:** Rename the lookup field (or recreate it). Test cases: `Visit__c` ✓, `RelatedVisit__c` ✓, `VisitId__c` ✗, `OurVisitLookup__c` ✗.

### "Product missing from sidebar despite territory assignment"
1. `LifeSciMarketableProduct` active?
2. `ProductTerritoryAvailability` not territory-excluded?
3. `IsCompetitorProduct != true`?
4. Brand AND child product both territory-aligned?

### "Sample section disabled for an HCO account"
**Cause:** Default behavior — HCOs blocked.
**Fix:** Add HCO record type developer name to `HcoTypesForSamplesAndItems` (semicolon-separated).

### "Sample sidebar disabled on attendee/child visit"
**Cause:** Attendee account doesn't share an address with the parent Visit's Place.
**Fix:** Verify `ContactPointAddress` records for the attendee match the parent Visit's Location.

### "Presentations grayed out for an account"
**Cause:** `TargetingContext = Restrict` and the presentation's Source System Identifier isn't in `ProviderAcctTerritoryInfo.TargetedPresentationInfo` for this account/territory.
**Fix:** Either add the presentation's SSI to the PATI record, or change `TargetingContext` to `None` / `Warn`.

### "Visitor search returns no results"
1. `ProfilesAvailableInEmployeeSearch` configured with profile IDs that DON'T include any active users?
2. All active users on the included profiles are the current user or their manager?

## Reference

- **Source deck:** Visit Engagement Side Menu Bar, Spring '26 — slide ID `1uSipzp-Oq0q-wsFm3sJBe7Xm--YYRAsfsQcaHw3Yj64`
- **Source transcript:** Gemini, Apr 3, 2026 session — doc ID `1mepzXhKIYrOUcGBZfJJyphJS7N_XVLmN`
- **Companion files in this module:** `support-engineering-visit-configuration.md` (admin panels) and `support-engineering-visit-troubleshooting.md` (diagnosis flows)
- **Related — Intelligent Content:** see `intelligent-content/support-engineering-intelligent-content.md` for presentation upload, targeting, and content search
