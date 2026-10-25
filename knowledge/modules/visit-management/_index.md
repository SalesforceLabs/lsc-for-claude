# Visit Management

## Documentation Files

- [258-lsc4ce-visit-mgmt-admin-console-transcript](./258-lsc4ce-visit-mgmt-admin-console-transcript.md)
- [258-lsc4ce-visit-mgmt-release-enablement-demo-script](./258-lsc4ce-visit-mgmt-release-enablement-demo-script.md)
- [258-lsc4ce-visit-mgmt-visit-page-layout-configuration-transcript](./258-lsc4ce-visit-mgmt-visit-page-layout-configuration-transcript.md)
- [258-lsc4ce-visit-mgmt-web-release-enablement-demo-transcript](./258-lsc4ce-visit-mgmt-web-release-enablement-demo-transcript.md)
- [258-lsc4ce-visit-mgmt-test-cases](./258-lsc4ce-visit-mgmt-test-cases.md)

## Spring '26 (Release 260) Enhancements

- [release-260-actionable-list-view](./release-260-actionable-list-view.md)
- [release-260-service-console](./release-260-service-console.md)
- [release-260-signature-page-snapshot](./release-260-signature-page-snapshot.md)
- [release-260-same-address-attendees](./release-260-same-address-attendees.md)
- [release-260-intelligent-content-in-web-visit](./release-260-intelligent-content-in-web-visit.md)

## Support Engineering Training (LSC4CE Value Chain)

Deep-dive support engineering content from the Engineering → Support training series.

### Key Concepts

- **Granular settings override** — User > Profile > Org via `LifeSciMetadataCategory` / `LifeSciMetadataRecord` / `LifeSciMetadataFieldValue`. #1 source of "setting not working" escalations.
- **Merged layout** — Visit Engagement screen pulls from BOTH `Visit` and `ProviderVisit`. Custom fields MUST go on `ProviderVisit` — only specific standard fields are extracted from `Visit`.
- **`ProviderVisitProductDetailing`** is the parent of all sample/marketing-item/DTP/discussion/message child records.
- **Sample Limits vs Sample Inventory** — Limits = account-level compliance (`ProviderSampleLimit`); Inventory = rep's personal lot stock (`ProductBatchItem.RemainingQuantity`). Different validation, different failure modes.
- **Custom related lists** — max 2; lookup field name MUST end in `Visit__c`; 3rd silently ignored.

- [support-engineering-visit-troubleshooting](./support-engineering-visit-troubleshooting.md) — Jun 2, 2026 session (Jim Morrow). Granular settings override diagnosis, sample limits validation, sample inventory validation, product display 6-step checklist, geolocation, full settings reference, troubleshooting quick-reference patterns.
- [support-engineering-visit-status-readonly](./support-engineering-visit-status-readonly.md) — On create, `refreshFieldReadOnlyStatus` clears a page-layout or field-level security read-only lock, so Status shows every picklist value. Not Set Audit Fields. Fixed in package 264.5. Life Sciences uses Planned and Completed.
- [support-engineering-visit-best-time-parse](./support-engineering-visit-best-time-parse.md) — `CallMyBestTimeValidator` parses raw `FromTime` / `ToTime` with a 12-hour format, so `TimePeriod` is always nil and it throws `outsideMyBestTime` for every account. Not a null `TerritoryId`.
- [support-engineering-visit-detailing-stale-cache](./support-engineering-visit-detailing-stale-cache.md) — `LogACallSaveHelper` upserts a cached `ProviderVisitProdDetailing` that was not re-queried after the Visit flow, so fields outside its DTO are blanked. Fix is a before-save flow on `ProviderVisitProdDetailing`.
- [support-engineering-visit-conflict-end-time](./support-engineering-visit-conflict-end-time.md) — `findConflictingVisit` queries only the existing visit's start. The end time is never read, so the window is start plus or minus N days. Web checks both start and end. Fix is a two-sided end-time condition.
- [support-engineering-visit-sample-batch-null](./support-engineering-visit-sample-batch-null.md) — **Complete this field: Item** on a sample that already has an item. `checkAvailableQuantities` guards the `ProductionBatch` ID string, not the bulk-loaded entity, so a missing entry dereferences null. Not a package 262 regression. Guard the entity.
- [support-engineering-visit-disbursement-delete-lock](./support-engineering-visit-disbursement-delete-lock.md) — A `ProductDisbursement` delete in the same transaction as visit submit is rejected by the customer's unmanaged trigger `ProductDisbursementDeleteLock`. The managed submit lock is ruled out. The customer adds a same-transaction exemption.
- [support-engineering-visit-hco-picker-page](./support-engineering-visit-hco-picker-page.md) — Web HCO picker returns 0 organizations because `AccountPickerService` takes `HealthcareProvider` `LIMIT 20` by name before `IsPersonAccount = false`. A page of person accounts is dropped. Not a metadata override.
- [support-engineering-visit-ipad-section-header](./support-engineering-visit-ipad-section-header.md) — iPad Provider Visit New and Edit show no section header. `BaseLayoutViewModel` flattens every section into one with an empty label and `editHeading` false, and `refresh()` sets `headerEnabled` false. Working as designed. A documentation bug.
- [support-engineering-visit-renamed-label](./support-engineering-visit-renamed-label.md) — Visit Engagement still shows the old Samples label because Standard Label Translations were last refreshed before Rename Tabs and Labels. Re-generate the document. Not a component that bypasses the rename.
- [support-engineering-visit-information-dtl-field](./support-engineering-visit-information-dtl-field.md) — Provider Visit Information merged fields are empty because `ProviderVisitProductDtlId` is on the Provider Visit layout. Remove that field.
- [support-engineering-visit-forum-edit-crash](./support-engineering-visit-forum-edit-crash.md) — On package 262, editing a Presentation Forum passes the forum id to `editCoordinator` instead of the parent Visit id, and `fatalError` crashes the app. Package 264 passes `ForumReferenceId`.
- [support-engineering-visit-highlights-action](./support-engineering-visit-highlights-action.md) — iPad builds Visit actions from the FlexiPage Highlights Panel. The `SalesforceTesting` record type's packaged page lacks `Cancel_visit`. Add the action or assign another page.
- [support-engineering-visit-sample-dtp-locale](./support-engineering-visit-sample-dtp-locale.md) — Web Samples and Direct to Practitioner do not render after a product is selected because the org locale is the old JDK value `en_IE_EURO`. Switch to the ICU locale. iPad still renders them.
- [support-engineering-visit-next-objective-label](./support-engineering-visit-next-objective-label.md) — Desktop on package 264 shows the raw key `NextVisitObjectiveLabel`. en_US dropped it from the LSC translations document in a dedupe-by-text collision, and 264 no longer falls back to REST.
- [support-engineering-visit-lookup-id-suffix](./support-engineering-visit-lookup-id-suffix.md) — A lookup on Visit Engagement shows a raw label ending in ID because a `ProviderVisitProdDetailing` field on the layout forces a parent pick. Remove the field. Not a label regression.
- [support-engineering-visit-signed-add-another](./support-engineering-visit-signed-add-another.md) — After signature on iPad, Add Another (`SamplesPlugin.canInsertForGroup`) and the side menu (`ProductMenuBloc`) ignore the signature rule the Product Item dropdown applies. Not a web defect.
- [support-engineering-visit-dynamic-actions-inactive](./support-engineering-visit-dynamic-actions-inactive.md) — Mobile dynamic actions stay off because `ApplicationSettings_OrgLevel` is inactive and is not synced. The app defaults `EnableDynamicActions` to false. Activate the record. Not Dynamic Forms on Mobile.
- [support-engineering-visit-submit-delay-reason](./support-engineering-visit-submit-delay-reason.md) — Web late-visit submit stays enabled with an empty delay reason; iPad blocks it. Known defect on package 262, fixed in package 264. `VisitDelayReasonHandler` is not the submit guard.
- [support-engineering-visit-additional-information](./support-engineering-visit-additional-information.md) — `AdditionalInformation` is system JSON. Putting it on the Visit Engagement layout is not supported. Do not move it onto ProviderVisit or refresh the cache.
- [support-engineering-visit-sync-not-data-loss](./support-engineering-visit-sync-not-data-loss.md) — iPad Visit children missing on web are not a presentation-lock race when they are present on the Device Sync Transaction. A failed transaction from a customer validation rule leaves the web records empty.
- [support-engineering-visit-ipad-delete-not-applied](./support-engineering-visit-ipad-delete-not-applied.md) — iPad shows Edit and Delete on a completed, read-only, or out-of-territory Visit. The local delete sticks after the server rejects it, so the Visit is gone on the device and still on the server. Not a sharing or `VisitLockHandler` change.
- [support-engineering-visit-add-product-sort](./support-engineering-visit-add-product-sort.md) — Add Product uses `ProductTerrDtlAvailability` only to decide which products appear, then sorts by `LifeSciMarketableProduct.SortOrder`. Territory `SortOrder` has to come first, matching the product sidebar.
- [support-engineering-visit-sample-limits-profile](./support-engineering-visit-sample-limits-profile.md) — Sample-limit ellipsis and enforcement are missing because `ValidateSampleLimits` is off on the profile Visit setting. A missing `ProviderSampleLimit` row is a later check.
- [support-engineering-visit-script-institution-guard](./support-engineering-visit-script-institution-guard.md) — A Visit Action Validation script passes every institution because its institution check is inverted. A Save path that does not run the script is a second cause, not a substitute. The customer corrects the script.
- [support-engineering-visit-configuration](./support-engineering-visit-configuration.md) — Jun 2, 2026 session (deck companion). Admin Console panels (General/Geolocation/Product Detailing/Samples/Signature), data storage metadata pattern, sample-limits + inventory + allocation configuration models, configuration anti-patterns table.
- [support-engineering-visit-engagement-side-menu](./support-engineering-visit-engagement-side-menu.md) — Apr 3, 2026 session (Srikant Chonnad). Merged layout (Visit + ProviderVisit), sidebar sections table, product loading 5-rule logic + restrictions/override, attendee loading (5+5=10), Intelligent Content targeting, custom related list rules, 7 troubleshooting patterns.

## Winter '27 (Release 264) Enhancements

- [release-264-visit-agent-voice-logging](./release-264-visit-agent-voice-logging.md) — Visit Agent voice-based visit logging on iPad: setup (Access Custom Agent permission set), fields populated, limitations.
- [release-264-validate-visits-on-save-warnings](./release-264-validate-visits-on-save-warnings.md) — Visit Action Validation scripts now run on Save and can return non-blocking `warning` status.
- [release-264-dependent-picklists](./release-264-dependent-picklists.md) — Field dependencies on Provider Visit, Provider Visit Product Discussion and custom objects in Visit Engagement.
- [release-264-group-visit-attendee-capture](./release-264-group-visit-attendee-capture.md) — Attendee name navigation and "Capture only samples and marketing items per attendee" setting for group visits.
