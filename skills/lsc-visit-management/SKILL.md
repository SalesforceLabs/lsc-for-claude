---
name: lsc-visit-management
description: Guides Life Sciences Cloud (LSC) Visit Management configuration and troubleshooting for web and mobile apps. Use when user asks about visit setup, visit engagement page, visit record types, product detailing, visit signatures, Admin Console visit settings, ProviderVisit objects, Visit Status editable on create and showing every picklist value despite a read-only layout, a late Visit that submits on web without a delay reason, Additional Information on the Visit Engagement layout, iPad Visit children missing on web after submit (Presentation Forum, click stream, disbursement), an Intelligent Content session that is not recorded when launched from a Visit, a Visit that disappears on iPad after delete while it is still on the server, an Add Product list that does not follow territory sort order, a missing sample-limit menu on the visit, a Visit Action Validation script that passes institution accounts, an iPad best-time error on a visit that is inside the account's best-time window, mobile dynamic actions that do not run, product guidance that appears from a presentation and is hidden when the product is added directly, custom fields on product detailing that are blank after the visit saves, an iPad visit conflict that disagrees with web, **Complete this field: Item** on a sample that already has an item, a ProductDisbursement delete rejected in the same transaction as visit submit, a web HCO picker that returns no organizations, an iPad Provider Visit New or Edit screen with no section header, a renamed Samples label that Visit Engagement does not show, empty merged fields in Provider Visit Information, an iPad crash when editing a Presentation Forum on package 262, a Visit quick action that is missing or will not open on iPad, web Samples and Direct to Practitioner that do not render after a product is selected, desktop on package 264 showing the raw key NextVisitObjectiveLabel, a Visit Engagement lookup whose label ends in ID, or iPad Add Another and the side menu staying available after signature.
---

## How to Answer Visit Management Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Visit concepts, lifecycle, best practices, test cases | `get_lsc_module_docs({ module: "visit-management" })` |
| A Visit field is read-only on the layout or by field-level security but editable on create, Status shows every value, or Set Audit Fields was suggested | `search_lsc_knowledge({ query: "Visit read-only lock cleared on create package 264.5" })` then follow **Status editable on create** below. Do **not** start with Set Audit Fields. |
| Late Visit submits on web with an empty Submit Delay Reason, and iPad blocks it | `search_lsc_knowledge({ query: "submit delay reason package 264" })` then follow **Web submit delay reason** below. |
| Additional Information (`AdditionalInformation`) on Visit Engagement, attendee add fails, or the attendee screen is read-only | `search_lsc_knowledge({ query: "AdditionalInformation Visit Engagement not supported JSON" })` then follow **Additional Information** below. Do **not** move the field onto ProviderVisit. |
| Intelligent Content launched from a Visit is not recorded, and the player did open | `search_lsc_knowledge({ query: "Pause tracking when player launches Visit" })` then follow **Pause tracking on launch** below. Do **not** start with metadata cache or a missing bundle. |
| iPad Visit children missing on web (Presentation Forum, click stream, disbursement) after a submit that should have included them | `search_lsc_knowledge({ query: "Device Sync Transaction Presentation Click Stream no data loss" })` then follow **Sync is not data loss** below. Query the Device Sync Transaction before any lock-handler theory. |
| Visit deleted on iPad is still on the server, or Edit/Delete showed on a completed, read-only, or out-of-territory Visit | `search_lsc_knowledge({ query: "iPad delete Visit still on server rejected sync" })` then follow **iPad delete not applied** below. Do **not** start with sharing, a restriction rule, or `VisitLockHandler`. |
| Add Product lists the right products in the wrong order | `search_lsc_knowledge({ query: "Add Product ProductTerrDtlAvailability SortOrder LifeSciMarketableProduct" })` then follow **Add Product sort** below. Compare both sort queries to the picker. Do **not** stop on a list of sort hypotheses. |
| Sample-limit ellipsis or enforcement is missing on the visit | `search_lsc_knowledge({ query: "ValidateSampleLimits profile ellipsis ProviderSampleLimit" })` then follow **Sample limits profile setting** below. Read the profile record before any `ProviderSampleLimit` query. |
| A visit validation passes for institutions, or does not run on Save | `search_lsc_knowledge({ query: "Visit Action Validation institution guard Save" })` then follow **Institution script guard** below. Compare a person account and an institution before calling Save unsupported. |
| iPad says the visit is outside best time | `search_lsc_knowledge({ query: "CallMyBestTimeValidator TimePeriod outsideMyBestTime" })` then follow **Best time on iPad** below. Compare the visit to an existing window before populating Territory or adding best-time rows. |
| Dynamic actions do not run on the mobile app | `search_lsc_knowledge({ query: "ApplicationSettings_OrgLevel inactive EnableDynamicActions" })` then follow **Dynamic actions inactive** below. Read **Active** on that record before any profile or Dynamic Forms check. |
| Product guidance appears from a presentation and is hidden when the product is added directly | `search_lsc_knowledge({ query: "presentation ProductGuidance EffectiveEndDate IsActive" })` then follow **Presentation guidance dates** below. Compare both paths. Do not stop on an empty code search. |
| Custom fields on product detailing are blank after the visit saves | `search_lsc_knowledge({ query: "LogACallSaveHelper ProviderVisitProdDetailing stale cache before save" })` then follow **Detailing stale cache** below. Compare the Visit flow write to the later detailing upsert. Do not stop at an unscoped package-field write. |
| iPad and web disagree on a visit conflict | `search_lsc_knowledge({ query: "findConflictingVisit startDateField end time" })` then follow **Visit conflict end time** below. Compare both visits' start and end to the N-day window. Do not stop at a start-versus-end guess. |
| iPad says Complete this field: Item on a sample that already has an item | `search_lsc_knowledge({ query: "checkAvailableQuantities productionBatchObject bulk load" })` then follow **Sample batch null** below. Confirm the item is set before treating the message as a required field. |
| ProductDisbursement delete is rejected in the same transaction as visit submit | `search_lsc_knowledge({ query: "ProductDisbursementDeleteLock unmanaged trigger same transaction" })` then follow **Disbursement delete lock** below. Query `ApexTrigger` before blaming the managed submit lock. An iPad Visit that is gone on the device and still on the server is **iPad delete not applied**, not this row. |
| Web HCO picker returns no organizations | `search_lsc_knowledge({ query: "AccountPickerService HealthcareProvider LIMIT 20 IsPersonAccount" })` then follow **HCO picker page** below. Query the first 20 primary providers by name before any metadata override. |
| iPad Provider Visit New or Edit has no section header | `search_lsc_knowledge({ query: "BaseLayoutViewModel headerEnabled editHeading Provider Visit" })` then follow **iPad section header** below. Confirm the fields are on screen and the layout label is set before changing the layout. |
| Visit Engagement still shows the old Samples label after Rename Tabs and Labels | `search_lsc_knowledge({ query: "Standard Label Translations StdObjectsTranslations Last Refreshed" })` then follow **Renamed label** below. Compare the document date to the rename before calling it a component bypass. |
| Provider Visit Information merged fields are empty | `search_lsc_knowledge({ query: "ProviderVisitProductDtlId Provider Visit Information layout" })` then follow **Information detail field** below. Find that field on the Provider Visit layout before a general rendering check. |
| iPad crashes when editing a Presentation Forum | `search_lsc_knowledge({ query: "PresentationForum editCoordinator ForumReferenceId package 262" })` then follow **Forum edit crash** below. Compare the forum id to `ForumReferenceId` and the package version before asking for a crash log. |
| A Visit quick action is missing on iPad, or the button shows and the layout will not open | `search_lsc_knowledge({ query: "FlexiPage Highlights Panel Cancel_visit SalesforceTesting" })` then follow **Highlights Panel action** below. Open the page assigned to the record type before a GoTo or metadata-cache check. |
| Web Samples and Direct to Practitioner do not render after a product is selected, and iPad does | `search_lsc_knowledge({ query: "en_IE_EURO ICU locale Samples DTP" })` then follow **Sample DTP locale** below. Read `Organization.DefaultLocaleSidKey` before any page-layout check. |
| Desktop on package 264 shows the raw key NextVisitObjectiveLabel | `search_lsc_knowledge({ query: "NextVisitObjectiveLabel en_US translations dedupe REST" })` then follow **Next visit objective label** below. Find the key and the other key with the same English text before calling it a missing package label or a locale. |
| Visit Engagement shows a lookup label that ends in ID | `search_lsc_knowledge({ query: "ProviderVisitProdDetailing layout parent lookup ID suffix" })` then follow **Lookup ID suffix** below. Find the detailing field on the layout before treating it as a label regression. |
| After signature, iPad Add Another or the side menu still adds a sample the Product Item dropdown hides | `search_lsc_knowledge({ query: "SamplesPlugin canInsertForGroup ProductMenuBloc signature" })` then follow **Signed Add Another** below. Compare the dropdown to Add Another on iPad before filing a web defect. |
| Specific visit topic (signatures, geolocation, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| Current org visit configuration | `check_visit_config()` |
| Admin Console visit settings | `list_admin_settings({ category: "Visit" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Object fields and relationships | `describe_sobject({ sobject: "Visit" })` or `describe_sobject({ sobject: "ProviderVisit" })` |
| Mobile cache status | `check_mobile_cache_status()` |
| Visit data in the org | `run_soql({ query: "SELECT ... FROM Visit ..." })` |
| Validation / audit | `audit_mobile_config({ group: "visit-config-check" })` |

Always preserve the citation block (lines starting with > 📖, > 🔗, > 📂) from the tool response verbatim in your answer.

For each troubleshooting section below, load the named document and finish only when the reply states every fact under **Required answer**. Naming a field, or leaving more than one cause open, is not a finished answer.

---

## Status editable on create

Load `support-engineering-visit-status-readonly.md`. During Visit creation `refreshFieldReadOnlyStatus` clears a page-layout or field-level security read-only lock. The reply must say that is a product defect fixed in package **264.5**, and that Set Audit Fields is not the cause. For Status, Life Sciences uses Planned and Completed. The extra values show only because the control was editable. Do not change permissions, the layout, or the metadata cache on a package before 264.5.

## Web submit delay reason

Load `support-engineering-visit-submit-delay-reason.md`. `VisitDelayReasonHandler` is not the submit guard. Package **262** still allows an empty reason on web; package **264** requires it. If the org is on 262.x, the answer is an upgrade, not a new defect.

## Additional Information

Load `support-engineering-visit-additional-information.md`. `ProviderVisit.AdditionalInformation` is system-managed JSON. Remove it from the Visit Engagement layout. Do not move it onto ProviderVisit and do not refresh the metadata cache.

## Pause tracking on launch

Load `knowledge/modules/intelligent-content/support-engineering-pause-tracking-on-launch.md`. If the player opened from the Visit and the session was never recorded, read **Pause tracking when player launches** with `list_admin_settings({ category: "IntelligentContent" })` before any metadata-cache check. When that setting is on, tracking is paused at launch until the rep taps play.

## Presentation guidance dates

Load `knowledge/modules/product-management/support-engineering-presentation-guidance-dates.md`. Query `ProductGuidance` and `PresentationPageProduct`. The reply must name `PresentationItemService.isActiveProductGuidance` and its DAO: they filter `IsActive` only and omit `EffectiveStartDate` and `EffectiveEndDate`. The direct product path applies those dates. Cite one row that is outside its window, present from the presentation, and absent on the direct path.

## Dynamic actions inactive

Load `support-engineering-visit-dynamic-actions-inactive.md`. Call `list_admin_settings({ category: "ApplicationSettings" })` and read **Active** on `ApplicationSettings_OrgLevel`. The reply must say an inactive record is not synced, so the app defaults `EnableDynamicActions` to false, and the fix is to activate the record. Do not cite a `User.Profile.Name` limit or Dynamic Forms on Mobile.

## Signed Add Another

Load `support-engineering-visit-signed-add-another.md`. Sign the visit on iPad and compare the Product Item dropdown with Add Another and the side menu. The reply must say `SamplesPlugin.canInsertForGroup` and `ProductMenuBloc` ignore the signature rule the dropdown applies. This is an iPad defect. Do not file it as a web defect.

## Lookup ID suffix

Load `support-engineering-visit-lookup-id-suffix.md`. Open the layout for the section. The reply must say a `ProviderVisitProdDetailing` field on the layout forces picking a parent, so the lookup shows its raw label with an ID suffix. Remove the field. This is not a label regression. Empty Provider Visit Information merged fields are **Information detail field**, not this section.

## Next visit objective label

Load `support-engineering-visit-next-objective-label.md`. Open the en_US LSC translations document. The reply must say `NextVisitObjectiveLabel` was dropped by a dedupe-by-text collision, and package 264 no longer falls back to REST, so desktop shows the raw key. Cite the missing key and the other key that kept the same English text. Do not call this a missing package label or an org locale.

## Sample DTP locale

Load `support-engineering-visit-sample-dtp-locale.md`. Query `Organization.DefaultLocaleSidKey`. The reply must say the org locale is English (Ireland, Euro) in the old JDK format, `en_IE_EURO`, which breaks web locale parsing and blocks Samples and Direct to Practitioner after a product is selected. iPad still renders them. Switch the org to the ICU locale. Do not add a related list to the Provider Visit layout.

## Highlights Panel action

Load `support-engineering-visit-highlights-action.md`. Open the Lightning page assigned to the Visit record type. The reply must say iPad builds actions from that page's Highlights Panel, the `SalesforceTesting` packaged page does not include `Cancel_visit`, and the fix is to add the action or assign a page that has it. Do not start with a GoTo target or a metadata cache.

## Forum edit crash

Load `support-engineering-visit-forum-edit-crash.md`. Query `PresentationForum` for `Id` and `ForumReferenceId`, and read the package version. The reply must say package 262 passes the forum id, not the parent Visit id, to `editCoordinator`, so `fatalError` crashes the app. Package 264 passes `ForumReferenceId`. Upgrade. Do not ask for a crash log once the version and the two ids are known.

## Information detail field

Load `support-engineering-visit-information-dtl-field.md`. Open the Provider Visit page layout. The reply must say `ProviderVisitProductDtlId` is on that layout, so the Provider Visit Information merged fields are empty, and the fix is to remove the field. Do not stop at a layout or rendering hypothesis.

## Renamed label

Load `support-engineering-visit-renamed-label.md`. Read Last Refreshed Date on Admin Console > Standard Label Translations, or `LastModifiedDate` on Document `StdObjectsTranslations`. The reply must say that date is before the Rename Tabs and Labels change, so Visit Engagement still shows the old label. The fix is to re-generate the standard label translations. Do not say a managed-package component bypasses the rename.

## iPad section header

Load `support-engineering-visit-ipad-section-header.md`. The reply must say `BaseLayoutViewModel` flattens every Provider Visit page-layout section into one list and rebuilds a section with an empty label and `editHeading` false, and `refresh()` sets `headerEnabled` to false. The layout label is set and web shows it. This is working as designed, a documentation bug. Do not change the layout to restore the header. Do not use this section when the section's fields are missing.

## HCO picker page

Load `support-engineering-visit-hco-picker-page.md`. Query `HealthcareProvider` with `IsPrimaryProvider = true`, ordered by `Account.Name`, `LIMIT 20`. The reply must say `AccountPickerService` paginates before `Account.IsPersonAccount = false`, so a page of person accounts is dropped and the web HCO picker returns 0 organizations. Cite that page and an HCO that exists past it. Do not call this a Profile or User `LifeSciMetadata` override.

## Disbursement delete lock

Load `support-engineering-visit-disbursement-delete-lock.md`. Query `ApexTrigger` on `ProductDisbursement` with the Tooling API. The reply must say the customer's unmanaged trigger `ProductDisbursementDeleteLock` rejects the delete in the same transaction as visit submit, and the managed-package lock is ruled out. The fix is a same-transaction exemption in the customer's trigger. Do not ask for a package change. Do not use this section for an iPad Visit that is gone on the device and still on the server.

## Sample batch null

Load `support-engineering-visit-sample-batch-null.md`. Query `ProductDisbursement` for `ProductItemId` and `ProductionBatchId`. The reply must say `checkAvailableQuantities` guards the `ProductionBatch` ID string and not the resolved entity, so a missing bulk-load entry leaves `productionBatchObject` null. **Complete this field: Item** is that crash, not a missing Item. This is a pre-existing latent bug, not a package 262 regression. The fix is to guard the entity.

## Visit conflict end time

Load `support-engineering-visit-conflict-end-time.md`. Query both visits' `PlannedVisitStartTime` and `PlannedVisitEndTime`, and read `VisitConflictValidationPeriod`. The reply must say `VisitConflictValidationPlugin.findConflictingVisit` queries only the existing visit's `startDateField`, never reads the end time, and the window is the new start plus or minus N days. Web checks both start and end. The fix is a two-sided end-time condition. Cite one pair where iPad and web disagree.

## Detailing stale cache

Load `support-engineering-visit-detailing-stale-cache.md`. Query `ProviderVisitProdDetailing` after save. The reply must say `LogACallSaveHelper` upserts a locally cached detailing row that was not re-queried after the Visit flow, so fields outside its DTO are blanked by that second DML. The fix is a before-save flow on `ProviderVisitProdDetailing`. Do not call this an unscoped write of package fields.

## Best time on iPad

Load `support-engineering-visit-best-time-parse.md`. Query `ContactPointBestContactTime`. The reply must say `CallMyBestTimeValidator` parses raw `FromTime` and `ToTime` with a 12-hour display format, so `TimePeriod` is always nil and it throws `outsideMyBestTime` for every account. The fix is a raw-format parse. Do not populate `TerritoryId`, and do not add best-time rows, once an in-window visit is rejected.

## Institution script guard

Load `support-engineering-visit-script-institution-guard.md`. Compare one institution visit and one person-account visit on the same action, then read the Visit Action Validation script. The reply must say the institution check is inverted, so institutions always pass, and that a Save path which does not run the script is a second cause only. The customer corrects the script. Do not close this as Save being excluded by design.

## Sample limits profile setting

Load `support-engineering-visit-sample-limits-profile.md`. Call `list_admin_settings({ category: "Visit" })` and read `ValidateSampleLimits` on the profile record for this user, not only the org record. The reply must say the profile setting is off and that a missing `ProviderSampleLimit` row does not explain the missing ellipsis. Confirm the profile value with the customer before changing it.

## Add Product sort

Load `support-engineering-visit-add-product-sort.md`. Query `ProductTerrDtlAvailability.SortOrder` and `LifeSciMarketableProduct.SortOrder` for the products in the picker. The reply must say the picker follows the product sort, territory availability only filters eligibility, and the correct order is territory `SortOrder` first. Do not leave name-sort, missing `ORDER BY`, or "working as designed" open once those two sequences disagree.

## iPad delete not applied

Load `support-engineering-visit-ipad-delete-not-applied.md`. Confirm the Visit Id still exists on the server, Edit and Delete were shown on iPad for a completed, read-only, or out-of-territory Visit, and the Device Sync Transaction rejected the delete. The device kept the local delete and does not restore the Visit. Sharing or `VisitLockHandler` can explain the server rejection only. Do not change them so the delete succeeds.

## Sync is not data loss

Load `support-engineering-visit-sync-not-data-loss.md`. Query `DeviceSyncTransaction` and `DeviceSyncTransactionRecord` before any presentation-lock theory. Child rows on the sync transaction mean the client submitted them. If the transaction failed on a customer validation rule, the web records stay empty until that rule is inactivated or changed. No package change.

---

## Configuration Mode

When the user asks about configuring or enabling a Visit Management feature, **ask them which mode they prefer**:

1. **Show me the documentation** — call `get_lsc_module_docs({ module: "visit-management" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
check_visit_config()
list_trigger_handlers()
list_admin_settings({ category: "Visit" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
toggle_trigger_handler({ handlerName: "VisitTriggerHandler", active: true })
update_admin_setting({ recordId: "...", fields: { ... } })
```

#### Step 5: Verify
Re-run `check_visit_config()` to confirm everything is configured correctly.

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `Visit` | `Visit__c`, `VisitSetting__c` |
| `ProviderVisit` | `ProviderVisit__c` |
| `ProviderVisitProdDetailing` | `ProviderVisitProductDetailing__c` |
| `ProviderVisitProdDiscussion` | `ProviderVisitProductDiscussion__c` |
| `ProviderAcctTerritoryInfo` | — |
| `ComplianceStatementDef` | — |

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings` / `check_visit_config`
- **DO NOT** use `run_soql` for mobile cache — use `check_mobile_cache_status()`
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app

### Adding Custom Objects to Visit Engagement Sidebar
When the user asks about this:
1. Call `describe_sobject({ sobject: "Visit" })` to get `childRelationships`
2. Filter to eligible custom objects (exclude OOB sidebar objects and standard platform objects)
3. Call `add_visit_engagement_sidebar_item` with no `layoutName` to list available layouts
4. Present eligible objects and ask which to add
5. Ask which layout to modify
6. Call `add_visit_engagement_sidebar_item` with the chosen objectName and layoutName
7. Recommend regenerating mobile metadata cache

**OOB sidebar objects (already present — do NOT offer these):**
ProviderVisitProdDetailing, ProviderVisitProdDiscussion, ProviderVisitMarketingItem, ProductDisbursement, ProviderVisitDtlProductMsg, Attendee, Visitor

**Maximum 10 related lists** (8 OOB + 2 custom).
