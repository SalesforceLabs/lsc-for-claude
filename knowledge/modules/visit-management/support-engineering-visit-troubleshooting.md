# Visit Management Troubleshooting — Support Engineering Training

**Session:** LSC4CE Value Chain Training — Jun 2, 2026
**Audience:** Support engineers
**Source:** Engineering training series (deck + Gemini transcript)
**Presenter:** Jim Morrow

## Overview

Visit Management facilitates compliant, effective engagement for Sales Reps, MSLs, and KAMs. Most "the setting isn't working!" support escalations come from **granular User/Profile-level metadata records overriding the org-level setting** — not from product bugs. This file consolidates the troubleshooting playbook around the three areas where escalations cluster: visit settings, samples/inventory, and product display.

> **The single most common pattern:** Reported issue → query `LifeSciMetadataRecord` for User/Profile overrides → delete the unintentional record → behavior restores. Always check before escalating.

## The #1 Diagnosis: Granular Settings Override

Settings are stored at **Org**, **Profile**, or **User** level. A more granular setting overrides a less granular one (User > Profile > Org). The Admin Console UI can't reliably show whether a setting record is unsaved or all-false — they look identical.

### Diagnose by querying metadata directly

```
LifeSciMetadataCategory   — the main category (e.g., 'ProviderVisitSettings')
LifeSciMetadataRecord     — individual setting records at Org / Profile / User
                            (Profile ID or User ID is appended after underscore in Name;
                             IsOrgLevel = true marks the org-level record)
LifeSciMetadataFieldValue — the actual field values (e.g., ValidateSampleLimits)
```

### Fix
Delete any **unintentional User or Profile-level** `LifeSciMetadataRecord` to restore org-level (default) behavior.

> **Process discipline:** Reproduce the issue in another org BEFORE escalating. Check granular overrides first. Verify all prerequisites and triggers are configured.

## Sample Limits — Compliance Validation

Sample limits validate **per-account, per-product** caps for legal compliance and are country-specific (some templates ship OOB).

### Validation timing
- Runs **only on Signature or Submit** of a Visit — NOT on save.

### Data flow
```
ProviderSampleLimit (links Product + Account, holds Rules JSON with time period + remaining qty)
  └── PrvdVstSmplLmtTransaction (created on Signature/Submit, stores Template, Visit, Product, Qty)
        └── Trigger on PrvdVstSmplLmtTransaction → updates ProviderSampleLimit.RemainingQuantity
```

### Two limit types
| Type | Behavior |
|---|---|
| **SKU (Individual)** | Limit applies to a single product for the Account. Shown in popover via ellipsis next to product. |
| **Shared** | All products assigned to the template contribute to one pool. Shown in info icon at top of Samples / DTP left sidebar section. |

### The most common bug: "Cannot submit — provider sample limit doesn't exist"
**Cause:** Product is assigned to a template, but **no `ProviderSampleLimit` record exists** for this specific Account.
**Fix:** Either create the `ProviderSampleLimit` for that account-product pair, or remove the product from the template.

Use that only when the ellipsis is already visible. If the sample-limit menu is missing, `ValidateSampleLimits` is off on the user's profile record. See [support-engineering-visit-sample-limits-profile.md](./support-engineering-visit-sample-limits-profile.md).

## Sample Inventory Validation

Distinct from sample limits — inventory validation checks the **rep's personal lot stock** to enforce sample accountability.

### What it validates
1. The rep has enough physical inventory (lot-level remaining quantity)
2. The disbursement doesn't exceed `MaxDisbursementLimitQty` configured via `TerritoryProdtQtyAllocation`

### Default
`ValidateSampleInventory = false` (no validation; rep can disburse any quantity).

### Mode
| `SampleInventoryValidationMode` | Behavior |
|---|---|
| `Error` | Blocks save entirely if quantity exceeds inventory |
| Anything else | Warning popup; rep can confirm to proceed; violation is recorded |

### Inventory data model
```
Product (Product2 + LifeSciMarketableProduct)
  ├── ProductItem (junction: how much of Product X is at Location Y)
  │     └── ProductBatchItem (most granular: quantity of Batch X at Location Y for Product Z)
  ├── ProductionBatch (specific lot — number, expiration)
  │     └── ProductBatchItem
  └── Location (warehouse / rep's bag, linked to user)
```

> **Trigger to know:** On Signature/Submit, an internal trigger on `ProductDisbursement` updates `ProductBatchItem.RemainingQuantity`.

## Product Display in Sidebar

### "No products appear under Samples"
Run through this checklist in order:

1. **LifeSciMarketableProduct** records must exist
2. Products **aligned to user's active territory** via `ProductTerritoryAvailability` (and not territory-excluded)
3. Brand AND child products must be aligned to the user's territory
4. There must be child product(s) of **Type = Drop**
5. `ProductItem` records must exist with a `Location` associated to the User
6. That Location must have:
   - `IsInventory = true`
   - **Location Type = Samples Management setting's "User Inventory Location Type"** (Admin Console → Sample Inventory Management → Org-Wide Settings)

### "Samples/DTP/Marketing Items sidebar sections are inactive"
Two scenarios:

1. **HCO account, default settings.** HCOs cannot receive samples/DTP/marketing items unless **`HcoTypesForSamplesAndItems`** is configured. Add the HCO RecordType developer name(s) separated by semicolons in the admin console setting.
2. **Attendee/Child Visit address mismatch.** The Attendee Account on a child visit must share the **same address** as the Location selected on the Parent Visit; otherwise samples are disabled.

## Product Allocations (Direct-to-Physician)

`TerritoryProdtQtyAllocation` records define max quantity available per territory per time period for a product. Used primarily for **DTP** but also drives `MaxDisbursementLimitQty` for samples.

### Configuration requirements
- **Unique, non-overlapping** time periods per product
- Set `Type = Ship` for DTP allocations
- Set `Type = Drop` if using to drive sample max-per-visit

### Trigger
`CalculateTPQADebitedQuantityHandler` on `ProviderVisitRqstSample` handles the reduction of `RemainingQuantity` on `TerritoryProdtQtyAllocation` after Visit submit.

> **Important:** Product allocations are NOT displayed in the UI. Diagnosis is metadata-only.

### "Allocations missing / not being respected"
1. Is the **`TimePeriod` record active and in date range**?
2. Is `Type` set correctly (Ship vs. Drop)?
3. Are there overlapping time periods (invalid configuration)?

## General Configuration Hygiene

### "Field not appearing on layout"
**Fix:** Run the **metadata cache** after ANY layout change for Visit-related fields. This is the single most common reason added fields don't show up.

### "Late Visit submits on Web with no delay reason"
iPad already requires the reason. `VisitDelayReasonHandler` only clears a reason when the date moves back inside the threshold. If the org is still on Life Sciences package 262.x, the fix is package **264**. See [support-engineering-visit-submit-delay-reason.md](./support-engineering-visit-submit-delay-reason.md).

### "Presentation Forum / click stream / disbursement missing on web after iPad submit"
Query the Device Sync Transaction before any lock-handler theory. If the child rows are present, there is no data loss. A transaction that failed on a customer validation rule for Presentation Click Stream Entry never commits those web records. See [support-engineering-visit-sync-not-data-loss.md](./support-engineering-visit-sync-not-data-loss.md).

### "Additional Information breaks attendee add or the attendee screen"
`ProviderVisit.AdditionalInformation` is system-managed JSON, not a comment field. Remove it from the Visit Engagement layout. Do not move it onto ProviderVisit (it is already there) and do not refresh the cache. See [support-engineering-visit-additional-information.md](./support-engineering-visit-additional-information.md).

### "Institution visits pass validation"
The customer's Visit Action Validation script inverts the institution check, so an institution always passes. Compare a person account and an institution on the same action, then read the script. A Save path that never runs the script is a second cause. See [support-engineering-visit-script-institution-guard.md](./support-engineering-visit-script-institution-guard.md).

### "Sample-limit menu (ellipsis) is missing"
`ValidateSampleLimits` is off on the profile-level Visit setting. The org value can still be true. Do not start with a missing `ProviderSampleLimit` row. See [support-engineering-visit-sample-limits-profile.md](./support-engineering-visit-sample-limits-profile.md).

### "Add Product order does not follow the territory"
The picker order matches `LifeSciMarketableProduct.SortOrder`. `ProductTerrDtlAvailability` only decided which products appear. Territory `SortOrder` has to come first. See [support-engineering-visit-add-product-sort.md](./support-engineering-visit-add-product-sort.md).

### "Visit deleted on iPad is still on the server"
Edit and Delete were shown on a completed, read-only, or out-of-territory Visit. The device row is gone after sync and the server row is still there. The delete upload was rejected and the iPad kept the local delete. Do not change sharing or `VisitLockHandler`. See [support-engineering-visit-ipad-delete-not-applied.md](./support-engineering-visit-ipad-delete-not-applied.md).

### "Dynamic actions do not run on mobile"
`ApplicationSettings_OrgLevel` is inactive, so it is not synced and the app defaults `EnableDynamicActions` to false. Activate the record. See [support-engineering-visit-dynamic-actions-inactive.md](./support-engineering-visit-dynamic-actions-inactive.md).

### "Add Another and the side menu stay open after signature on iPad"
The Product Item dropdown applies the signature rule. `SamplesPlugin.canInsertForGroup` and `ProductMenuBloc` do not. Not a web defect. See [support-engineering-visit-signed-add-another.md](./support-engineering-visit-signed-add-another.md).

### "A lookup label ends in ID on Visit Engagement"
A `ProviderVisitProdDetailing` field on the layout forces a parent pick, so the lookup shows its raw label with an ID suffix. Remove the field. Not a label regression. See [support-engineering-visit-lookup-id-suffix.md](./support-engineering-visit-lookup-id-suffix.md).

### "Desktop shows NextVisitObjectiveLabel on package 264"
en_US dropped that key from the LSC translations document because another key has the same text. Package 264 does not fall back to REST, so the raw key is shown. See [support-engineering-visit-next-objective-label.md](./support-engineering-visit-next-objective-label.md).

### "Web Samples and DTP do not render after selecting a product"
The org locale is English (Ireland, Euro) in the old JDK format, `en_IE_EURO`. Switch to the ICU locale. iPad still renders both panels. See [support-engineering-visit-sample-dtp-locale.md](./support-engineering-visit-sample-dtp-locale.md).

### "Visit quick action is missing or will not open on iPad"
iPad reads the FlexiPage Highlights Panel for the Visit record type. The `SalesforceTesting` packaged page does not include `Cancel_visit`. Add the action or assign another page. See [support-engineering-visit-highlights-action.md](./support-engineering-visit-highlights-action.md).

### "iPad crashes when editing a Presentation Forum"
On package 262 the edit handler passes the forum id, not the parent Visit id, to `editCoordinator`, and `fatalError` crashes the app. Package 264 passes `ForumReferenceId`. See [support-engineering-visit-forum-edit-crash.md](./support-engineering-visit-forum-edit-crash.md).

### "Provider Visit Information merged fields are empty"
`ProviderVisitProductDtlId` is on the Provider Visit page layout. Remove it. The merged fields populate again. See [support-engineering-visit-information-dtl-field.md](./support-engineering-visit-information-dtl-field.md).

### "Visit Engagement still shows the old Samples label"
Rename Tabs and Labels already has the new name. Standard Label Translations were last refreshed before that rename. Re-generate the document. See [support-engineering-visit-renamed-label.md](./support-engineering-visit-renamed-label.md).

### "iPad Provider Visit New or Edit has no section header"
`BaseLayoutViewModel` flattens every section into one with an empty label and `editHeading` false, and `refresh()` sets `headerEnabled` false. The layout label is still set and web shows it. Working as designed. See [support-engineering-visit-ipad-section-header.md](./support-engineering-visit-ipad-section-header.md).

### "Web HCO picker returns no organizations"
`AccountPickerService` paginates `HealthcareProvider` `LIMIT 20` by `Account.Name` before `IsPersonAccount = false`. A page of person accounts is dropped, so the picker returns 0 HCOs. Not a metadata override. See [support-engineering-visit-hco-picker-page.md](./support-engineering-visit-hco-picker-page.md).

### "ProductDisbursement delete fails while the visit is submitting"
The customer's unmanaged trigger `ProductDisbursementDeleteLock` rejects the delete in that same transaction. The managed submit lock is ruled out. The customer adds a same-transaction exemption. See [support-engineering-visit-disbursement-delete-lock.md](./support-engineering-visit-disbursement-delete-lock.md).

### "Complete this field: Item" on a sample that already has an item
`checkAvailableQuantities` guards the `ProductionBatch` ID string and not the resolved entity. A missing bulk-load entry dereferences null, and the UI shows the Item field error. Not a package 262 regression. Guard the entity. See [support-engineering-visit-sample-batch-null.md](./support-engineering-visit-sample-batch-null.md).

### "iPad and web disagree on a visit conflict"
`VisitConflictValidationPlugin.findConflictingVisit` queries only the existing visit's `PlannedVisitStartTime`. The end time is never read, so the window is the new start plus or minus N days. Web checks both start and end. See [support-engineering-visit-conflict-end-time.md](./support-engineering-visit-conflict-end-time.md).

### "Custom fields on product detailing are blank after save"
`LogACallSaveHelper` upserts a cached `ProviderVisitProdDetailing` that was not re-queried after the Visit flow, so fields outside its DTO are blanked. Put the values back with a before-save flow on `ProviderVisitProdDetailing`. See [support-engineering-visit-detailing-stale-cache.md](./support-engineering-visit-detailing-stale-cache.md).

### "iPad says the visit is outside best time"
`CallMyBestTimeValidator` parses raw `FromTime` and `ToTime` (`08:00:00.000Z`) with a 12-hour format, so `TimePeriod` is always nil and it throws `outsideMyBestTime` for every account. A null `TerritoryId` is not the cause. See [support-engineering-visit-best-time-parse.md](./support-engineering-visit-best-time-parse.md).

### "A read-only Visit field is editable on create"
`refreshFieldReadOnlyStatus` clears the page-layout or field-level security lock during creation. Not Set Audit Fields. Fixed in package **264.5**. Status then shows every picklist value. Life Sciences uses Planned and Completed. See [support-engineering-visit-status-readonly.md](./support-engineering-visit-status-readonly.md).

### Record types on Visit
**Always add to both `Visit` AND `ProviderVisit` objects** — they must mirror each other for the merged layout to resolve correctly.

### Next Visit Objectives — section name MUST match exactly
| Purpose | Required section name |
|---|---|
| Capture this visit's next-visit objectives | `Next Visit Objectives` |
| Display objectives captured at the previous visit | `Pre Provider Visit Notes` |

Any other name = section won't render.

### Visit Place
`ContactPointAddress` records must be **active** to appear in the Place picker.

### Editing an Attendee/Child Visit
Always opens the **parent visit** — by design, not a bug.

## Geolocation

| Aspect | Detail |
|---|---|
| **Captured at** | Visit Submit or Signature |
| **Platform** | Mobile only |
| **Max distance check** | Compares rep location to visit address; configurable max distance |
| **Behavior** | Can be Warning or Error mode |

## Visit Settings Reference (most-asked)

| Setting | What it controls |
|---|---|
| `RequireBatchNumber` | Makes lot number required when adding sample |
| `ValidateSampleInventory` | Lot-level inventory validation |
| `ValidateSampleLimits` | Account-level compliance caps |
| `ValidateTerritoryQtyAllocation` | Per-territory product allocation check (mainly DTP) |
| `HcoTypesForSamplesAndItems` | Semicolon-separated HCO record types allowed to receive samples/items |
| `DiscussOffLabelProducts` | Allow off-label brand/indication combinations during detailing |
| `FutureVisitLimit` (days) | How far ahead a rep can schedule a visit |
| `VisitConflictValidationPeriod` | Window for double-booking detection; warn or block |
| `VisitDuration` (min) | Default planned duration |
| `UnblockSubmittedVisits` | Allow post-submission edits |
| `SkipVisitPreview` | Bypass preview screen on planner |

## Troubleshooting Quick Reference

### "Setting reported as not working"
1. Check Org-level → Profile-level → User-level `LifeSciMetadataRecord` for the setting category
2. Delete any unintentional Profile/User records
3. Reproduce in a fresh org if behavior is still wrong

### "Cannot submit — sample limit error"
1. Verify `ProviderSampleLimit` exists for the Account-Product combination
2. Verify `Rules` JSON time period covers today
3. Check `RemainingQuantity` is > 0

### "Field not appearing"
1. Run metadata cache
2. Confirm field is on the **right object's layout** (custom fields on Visit don't render on the merged screen — they must be on ProviderVisit)
3. Confirm FLS for the user's profile

### "Cannot disburse samples (sidebar disabled)"
1. HCO + `HcoTypesForSamplesAndItems` not configured → add HCO RT
2. Child visit attendee address ≠ parent visit Location → fix addresses

### "Products missing from sidebar"
Run the 6-step Product Display checklist above

### "Visit allocation not enforced"
1. `TerritoryProdtQtyAllocation` time period active?
2. `Type` (Ship/Drop) correct?
3. Allocations exist for the user's territory + product?

## Reference

- **Companion file:** `support-engineering-visit-configuration.md` in this module — the same Jun 2, 2026 session deck broken out as a configuration reference
- **Companion file:** `support-engineering-visit-engagement-side-menu.md` in this module — Apr 3, 2026 session on sidebar internals and merged-layout behavior
- **Source deck:** Visit Engagement Configuration and Common Issues, Spring '26 — slide ID `1ldTORbO3srrpx_hC96jcZCWMPrbILLiqLYYiKJMlUNU`
- **Source transcript:** Gemini, Jun 2, 2026 session — doc ID `1xflVjnDV1Iy43IXI4rZ__YYqRwTPX-QR`
- **Related — Mobile metadata:** see `mobile-metadata-cache/support-engineering-mobile-sync.md` for cache invalidation on layout changes
