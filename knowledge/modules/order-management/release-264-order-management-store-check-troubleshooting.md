# Order Management and Store Check Setup Troubleshooting - Winter '27 (264)

Symptom-first index for setup problems with Store Check and Order Management (quoted orders) on the Life Sciences Cloud iPad and web. Each row gives the exact error text where there is one, the cause, the fix, and the step of the [Store Check and Order Management Setup Steel Thread v6](./release-264-store-check-order-management-steel-thread-v6.md) that configures it; open that step in the thread for the full procedure. The thread's failure playbook and known limitations tables cover each row in more detail. Findings come from end-to-end runs on new orgs at API 67.0–68.0. Also see the [setup runbook](./release-264-order-management-setup-runbook.md) (products missing on Add Products, PTA/PTDA) and [admin setup](./release-264-quoted-orders-admin-setup.md).

## First checks (most setup issues are one of these)

1. **The fix was made after the last metadata cache generation.** Any layout, FlexiPage, FLS, pricing or Admin Console change needs a new cache (a new parent record, never a re-generate of an `Active` one), then sync **and** close and reopen the app. Syncing alone is not enough (10.8).
2. **Currencies differ.** The quote takes the rep's `User.DefaultCurrencyIsoCode`, not the store Account's. If the rep, store and price book currencies are not equal, Select Price Book and Add Products show nothing.
3. **The four pricing selectors don't agree**: (1) Revenue Settings `QocalPricingProcedure` (7.17); (2) the profile-scoped `OrderProductViewsSettings.PricingProcedure`, which wins for the rep (8.10); (3) the org-level `OrderProductViewsSettings_OrgLevel.PricingProcedure` fallback (8.10b); (4) `QuoteSettings_OrgLevel`, which binds the Quote record type to `lsc4ce_pricing_mobile_tpt` (8.14). Any one missing gives no error, just empty `contextDefinition.json`/`decisionTable.json`/`expressionSet.json` in the cache or the wrong procedure.
4. **A DbSchema pair is half profile-scoped.** `Pricebook2`/`PricebookEntry` and `Quote`/`QuoteLineItem` must be deployed and assigned to the rep profile together.
5. **Field-level security on `Quote.Status`.** In these runs Submit was missing and new quotes saved with no Status while the rep's FLS had Status read-only; Edit in FLS with Status read-only on the layout worked. Salesforce Help is not consistent here: "Restrict the Quote Status Field for Field Reps" uses the layout, while "Get Your Org Ready for Quote and Pricing Users" lists Quote Status as a field reps can't edit.
6. **It is a known limitation, not configuration.** Check the [known limitations](#known-limitations-not-fixable-by-configuration) before changing the org.

## Package install and org settings

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| `Accounts Missing Organization Feature: Account.RecordType` / `Missing Organization Feature: B2C` / `Missing Organization Feature: StateCountryPicklist` | Business Account record type, Person Accounts or State/Country picklists missing | Enable them, then retry the install once | 1.4–1.8, 2.4 |
| `FieldSet(InventoryCountAssessment.AdHocInvHeaderFieldSet): no CustomObject named InventoryCountAssessment found` | Org preference `InventoryCountEnabled` off | Turn it on; confirm `InventoryCountAssessment` describes; retry | 1.14, 2.4 |
| `FieldSet(InventoryOperation.AdjustmentHeaderFields): no CustomObject named InventoryOperation found` | `PrdInventoryOperationsPref` off | Turn it on; retry | 1.16, 2.4 |
| `no CustomField named ProductDisbursement.ProductionBatchNumber found` + `The object type you specified GoalAssignment is invalid.` | `InventoryBatchManagement` and `CarePlansPreference` off | Turn both on; retry | 1.15, 1.17, 2.4 |
| `AFCWrapperControllerTest: Dependent class is invalid ... lsc4ce.TestUtils : Variable does not exist: Survey` | `SurveySettings.enableSurvey` off | Turn on Surveys; retry | 1.18, 2.4 |
| Install error naming `Layout(AccountPlan-…)` / `QuickAction(AccountPlan.ImportStakeholder)` | Account Plans off | Deploy `AccountPlan.settings` `enableAccountPlan=true`; retry | 1.18a, 2.3, 2.4 |
| `Package Not Found` | A version alias resolved to an older release | Install with the exact `04t…` version ID | 2.3 |
| `INVALID_CROSS_REFERENCE_KEY: Account.Business_Account is active but unavailable to the authenticated System Administrator profile.` / `Business Account record type is not valid for the executing user.` | An active record type is not visible to the acting profile automatically | Deploy and assign a permission set with only `recordTypeVisibilities` for the record type, to the admin and the rep | 1.6, 9.1, 9.8 |
| `no RecordType named Account.PersonAccount found` | The Metadata API names it `PersonAccount.PersonAccount` | Use `<recordType>PersonAccount.PersonAccount</recordType>` | 1.8a |
| Multi-Currency checkbox reverts to unchecked on reload | The Security Contact field was empty at activation (releases that have the field) | Save the Security Contact first, then activate in a separate save | 1.9, 1.11 |
| `LifeScienceDocument` never becomes describable after `enableLSC4CEDocumentManagement=true` | Needs `OrgPermissions.IndustriesLSOCE`, which has no customer grant route | None. Quote documents (`QuoteDocument`) are separate and not affected | 0.4, 1.2 |
| Store Check "Turn On" clicked but `enableStoreCheck` still `false` | The first click only opens a modal | Click the modal's Turn On; verify by retrieving `Industries.settings` | 3.1 |
| 7.18 Save As New Flow fails: `discoverProductsContext (Variable) - "apexClass" is invalid. Provide the API name of an Apex class that includes an Apex data type supported in flows.` | Flow Builder offers the `ProductConfig` types only when Product Configurator is on, and it is off. Product Discovery being on does not help | Close Flow Builder without saving; retrieve `Settings:ProductConfigurator`, deploy `enableProductConfigurator` = `true`, reload and redo the Save As. Never delete or retype the variable to force the save | 7.17c, 7.18 |

## Permissions and licences

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| Run stops: a permission set licence has no free seat | The 10 PSLs are provisioned by the Salesforce account team, not a Setup toggle: `CorePricingRunTime`, `DocumentBuilderUserPsl`, `ProductDiscoveryUserPsl`, `RevenueLifecycleManagementUserPsl`, `IndustriesLSC4CEPsl`, `HealthCloudStarter`, `IndustriesVisitPsl`, `ActionPlansPsl`, `ContextServiceRuntimePsl`, `ProductCatalogManagementViewerPsl` | Request the missing licence | 0.9b |
| The Order Management feature card shows a lock, "Purchase required" or "Contact Sales" instead of Set Up / Get Started | The Order Management licences are not provisioned on the org | Don't retry the click. Re-run the licence check, list the missing licences and route the customer to their Salesforce account team; continue once it passes | 0.9b, 6.1 |
| `FIELD_INTEGRITY_EXCEPTION` "trivial share level Read, for organization with default level Read" when sharing catalog or territory availability rows with the rep | That object's org-wide default is already `Read` or higher, so a Manual Read share can't exist and isn't needed | Read `InternalSharingModel` first; share only the objects at `Private` | 7.8 |
| `DUPLICATE_VALUE` (PSL subrequest) + `PROCESSING_HALTED`, whole Composite rolled back | A PSL and the permission set that depends on it in one Composite call | Assign PSLs in one call, confirm, then permission sets in a second call | 1.0, 2.1 |
| `DUPLICATE_VALUE` on `PermissionSetLicenseAssign` | Assigning a licensed permission set auto-creates the PSL assignment | Assign only the permission set; never POST the PSL assignment | 7.16, 8.12 |
| Quote permission set `RevLifecycleManagementQuotePricesTaxes` not found | It exists only after the Order Management Turn On | Assign it after Turn On (11 sets first, the 12th later) | 4.5, 4.9a |
| `Read on AppUsageAssignment requires Read on at least one of these objects: Order, Quote, Asset, Contract` / `Permission Read Quote depends on permission(s): Read Opportunity` | Object-permission dependencies are enforced inside one permission set payload | Don't grant AUA/Opportunity/Quote on the custom set; take them from the standard bundle | 4.1 |
| `UNKNOWN_EXCEPTION: Unexpected Error when retrieving 'Account' Layout Information: Layout contains no sections!` | The custom profile has no Account `layoutAssignments` | Assign the default and `Business_Account` record types to the standard Account layout | 4.2, 8.4 |
| `INVALID_FIELD: No such column 'DeveloperName'` on `LifeSciConfigCategory` (mobile bootstrap) | The rep lacks the `ViewDeveloperName` user permission | Grant it on the rep permission set before the first mobile login | 4.1, 11.3 |
| Toast `sObject type 'AdminConsoleMenuItem__mdt' is not supported...` for non-admins | Custom metadata access is only on the System Administrator profile | Cosmetic; don't broaden access | Gap journal |
| Permission set deploy removed object/field/tab permissions or reset the label | Metadata API deploys of permission sets, profiles and apps are full replaces | Always retrieve the full file, merge, deploy the whole file, compare counts | Deploy safety (preamble) |

## Pricing (procedure, recipe, price books, tiers)

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| `Ensure that the lookup table in the ListPrice step is valid and try again.` (same for `VolumeDiscount` step) | No pricing recipe with a `ListPrice` (or `VolumeDiscount`/`VolumeTierDiscount`) mapping for the procedure's usage subtype | Create the recipe and mappings before the procedure | 6.9, 7.12a, 7.13 |
| `Enter a valid rank to enable <procedure>.` | `ExpressionSetVersion.Rank` is null or 0 | PATCH `Rank: 1`, then activate | 7.15 |
| `Before creating this custom price, create a standard price…` / silent `PricebookEntry` rejection / UI "We hit a snag" | No active Standard price book entry for the product, currency and selling model | Create Standard entries first, then custom | 7.6 |
| `couldn't find the resource <X>` in simulation or step binding | Wrong field name (ContextTag vs attribute title vs mapping name) | Use the `ContextTag` name | 7.13, 7.14 |
| Simulation uses stale tier or price data | Decision tables are cached snapshots | Run `refreshDecisionTable` and poll `RefreshStatus` | 7.12, 7.20 |
| iPad: `LSCPricingEngine.SDKError` — `Unhandled pricing procedure steps: RoundingValuesCurrencyOutputRounding` | The offline engine doesn't support the rounding step | Remove `CurrencyOutputRounding`/`RoundingValues` from any version used on mobile | 7.13 |
| iPad charges list price at tiered quantities, web gives the tier price | `EffectiveFrom` empty on `PriceAdjustmentSchedule`/`PriceAdjustmentTier` (the iPad engine skips them; an empty `EffectiveTo` alone isn't confirmed to break it, and the shipped `Standard …` schedules have one) | Set both dates on your own schedules, then tiers (never patch the `Standard …` ones), refresh decision tables, regenerate, sync | 7.10a, 10.8, 13.0a |
| Tiers silently use the cumulative path | The tier step is bound to an aggregated quantity | Bind Range/Slab steps to the line quantity | 7.13 |
| `The adjustment type for this line item must be set to Override.` | Known Revenue Cloud pricing defect | Report; don't change the tier model | 7.14 |
| iPad cart has no Order Discount (Add) | Header Adjustments off (`RevenueManagementSettings.enableRevenueAdjustment=false`) | Turn it on, regenerate, sync | 7.17b, 13.12a |
| `DUPLICATE_VALUE` on a context definition default-mapping PATCH | An Expression Set is attached | Map before attaching, or detach, deactivate, patch, reactivate, reattach | 6.7 |
| A rerun would activate this thread's recipe while another `LifeSciencesCommercial` recipe is active | The customer has their own recipe of this subtype | Ask first; never edit or deactivate theirs | 6.9, 7.15 |
| `404 NOT_FOUND` on `/connect/revenue-cloud/setup/execute-custom-logic` | UI-tier-only endpoint | Use `/connect/context-definitions` | 6.6 |
| `We couldn't refresh the prices ... You cannot ask for this if the context hasn't been established.` | Intermittent `ComponentContext` platform defect during Reprice All | Retry once; nothing is corrupted | 8.32 |

## Quote configuration (web)

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| New Quote has no Quote-specific fields or sections | A blank org ships no Quote record types | Deploy the record type and profile visibility | 8.1 |
| `Cannot use field:Pricebook2Id in a layout` | Not layoutable on Quote | Leave it off; set the price book via Add Products | 8.2 |
| Highlights panel and stage path missing on the record page (iPad) | `recordHomeSimpleViewTemplate` has no mobile renderer | Use `recordHomeSingleColTemplateDesktop` | 8.7 |
| Browse Catalogs or quick actions have no UI control | No `force:highlightsPanel` in the page header | Add it as the first header component | 8.8 |
| Tab is on the app but missing from the nav | Tab visibility is a separate layer | Add `tabSettings` on the permission set (`tabVisibilities` on a profile) | 8.6 |
| `Cannot modify managed object: entity=TabSetMember ... MANAGED_INSTALLED - tab` | Editing the managed app's own `<tabs>` | Use `CustomApplication.subscriberTabs` | 9.5, 9.10 |
| Stage path shows 2 of 5 stages | `Quote.Status` value set lacks `Submitted` and `Request for Unlock` | Deploy the `StandardValueSet` with the missing values, then order the stages | 8.16 |
| Submit never changes the stage server-side | `StagePathPermissionsHandler` is inactive by default | Activate it (Tooling PATCH `IsActive=true` on `LifeScienceTriggerHandler`, or Admin Console) | 8.17, 14.2 |
| `The prices aren't up to date or the validation isn't complete.` | `Quote.CalculationStatus` stale | Reprice All before Submit | 8.13 |
| Submit missing from the Actions menu | `Quote.Status` read-only in the rep's FLS (see First checks #5) | Try Edit in FLS with the layout field read-only, regenerate the cache | 8.13, 14.1 |
| Quote routes to the wrong Sales Transaction Type | The hook picks the STT by procedure with `LIMIT 1` | Keep one STT per pricing procedure | 8.11 |
| Add Products opens with Price Book = None and the search lists nothing | The rep profile has no `Pricebook2` layout assignment | Add `Pricebook2-Price Book Layout` to the rep profile | 8.3, 8.31 |
| Raw `@@@SFDC…@@@` section headers on the Quote page | Token labels in the Quote FlexiPage | Redeploy with plain-text labels, regenerate, sync | 8.9, 13.14, 14.4 |
| iPad Create New Quote shows Status as an editable picklist | `Record.Status` `uiBehavior` = `none` on the FlexiPage Details section | Set it to `readonly`, regenerate, sync | 8.9, 13.3 |
| `Free-Form canvas mode doesn't support End elements.` | A cloned flow inherited Free-Form canvas | Set `CanvasMode=AUTO_LAYOUT_CANVAS` and `BuilderType=LightningFlowBuilder` | 8.24 |
| `INSUFFICIENT_ACCESS` / `Unsupported action type: CREATE_SERVICE_DOCUMENT` | The deploying admin lacks Document Builder | Assign `DocumentBuilderUserPsl` + `DocumentBuilderUser` to the admin | 8.25 |
| Flow stays Draft after deploy | `enableFlowDeployAsActiveEnabled=false` | Activate via Tooling `FlowDefinition` `activeVersionNumber` (newest version) | 7.18, 8.27 |
| `DigitalSignature.SignatureType` has no value | It's a `StandardValueSet` | Deploy the value set with one default value | 8.22 |
| `'QuoteDocumentSettings' is not a valid value for the enum 'LifeSciConfigCategoryType'` / `no LifeSciConfigCategory named … found` | The category doesn't exist yet; record-only deploys fail | Save once in the Admin Console (or deploy category with the record) | 8.29 |
| `LifeSciConfigRecord` dropped from the deploy, no error | Member name must be the record's `DeveloperName`; source format can drop it | Use a Metadata API ZIP; compare component counts | 8.10, 10.1 |
| Generate PDF stage action shows "Unknown component" on web | That stage action (`runtime_sales_quotes:createPDF`) works on iPad only; this is about the stage action, not PDFs on web | On web, generate PDFs with the Document Builder quick action on the Quote page (Help: Create a Quote Document Template); on iPad, use the stage action | 8.18, 14.11 |
| Admin Console Product Views has no Last Order, or `ProductsFromPreviousOrder` rejected | Org permission `LSDraftOrderPilot` (also check `LSStoreCheckPilot`, Core CPQ) not provisioned | Ask the account team; meanwhile use `StoreAssortment` only | 8.10 |
| Admin Console → Workflow Paths: a path opens with another path's stages and operations, or editing a stage, operation or action fails | The path's stage rows have an empty `SourceSystemIdentifier`; the editor finds and links records by that key | Don't save in the editor. Backfill the keys on the stage graph, read them back, reopen the path | 8.18, 8.21, 9.11 |
| Request for Unlock or Rejected quote shows no View Line Items action; the rep can't open a locked quote's lines | The two `LifeSciStageOperationAction` links (`ContextAction_Quote_RequestForUnlock_ViewLineItems`, `ContextAction_Quote_Rejected_ViewLineItems`) are missing. Seen on an org where the rest of the graph existed | Re-run 8.21: it checks each of the seven link keys on its own and creates only the missing ones; regenerate the cache and sync | 8.21 |
| A second disclaimer for the same module, type and country | `ComplianceStatementDef.Name` is an auto-number and `StatementText` can't be filtered, so a lookup on either finds nothing | Look up by module, type, jurisdiction and country and compare the text; ask before creating another | 8.28 |

## Store Check and Visit configuration

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| `We couldn't load the workflow path for this record. Ask your Salesforce admin for help.` | No `LifeSciStage*` rows for the Visit's record type | Build the Visit stage graph | 9.11 |
| Begin Visit spinner never resolves on web | `ls_storecheck:visitWorkflowAction` doesn't work on web | Begin Visit on the iPad | 9.11 |
| New/Edit Visit opens the standard form, not Store Check / Log a Visit | A legacy Visit New/Edit override, or a record type without its routing row | Remove the override; deploy the missing routing row | 9.1, 9.6–9.7, 9.2, 9.6, 9.7 |
| Admin's Visits → New opens the Master form; Save: `You don't have permission to create Visit records at this stage of the workflow` | Visit record types visible to the rep profile only | Work as the rep, or make the record types visible to the admin (9.8b) and give the admin the DbSchema assignments (10.1c) | 9.8b, 10.1c |
| **Begin Store Check** fails on the iPad; the template query returns `more than one row returned by a subquery` | The action plan template has more than one `ActionPlanTemplateVersion` (even soft-deleted) | Unassign it; create a new template with a new `UniqueName`; assign and share it | 9.20 |
| Indicator shows the wrong control, or `DataType` can't be updated | `AssessmentIndicatorDefinition.DataType` is create-only | Delete children (`AssessmentTaskIndDefinition`, `AssessmentIndDefinedValue`, `RetailStoreKpi`) and recreate. Never after Store Check data exists | 9.14–9.16 |
| Quoted Order tab on the Store Check visit missing, empty, or no New | Visit layout lacks the `Quotes` related list, cache predates it, wrong FlexiPage relationship, or `Quote.VisitId` FLS | Check in order: layout `<relatedList>Quotes</relatedList>`, regenerate + sync + relaunch, FlexiPage relationship `Visit`, `VisitId` FLS and layout Edit | 9.5, 9.9, 13.2 |
| Web Log a Visit: `Translation Language Settings for the required languages or the initial metadata cache are missing` / `the metadata is out of date…` | The rep has no cache, or the cache lacks `ProviderVisit` | Generate the cache with `DbSchema_ProviderVisit` assigned | 10.1b, 9.23, 10.1d, 10.7a |
| After the cache has `ProviderVisit`, web Log a Visit still shows `Translation Language Settings for the required languages or the initial metadata cache are missing` | The cache has no translation file: Translation Workbench is off or no translation language is active (common on fresh orgs) | Turn on Translation Workbench, add an active language, then generate a new cache and sync | 10.1d, 9.23, 10.1b, 10.7a |
| Store accounts open the HCP page: `No access to the following entities: healthcareprovider` | No Store Account record page for the rep | Deploy the Store Account page, regenerate | Gap journal (9.24–9.25) |
| iPad photo save: `table Image has no column named offlinelastmodifieddate` (then `contentdocumentlink`); sync `MALFORMED_QUERY` | Missing photo DbSchemas, or a plain `ContentDocumentLink` schema | Rep access to `Image` plus the four photo DbSchemas with filters | Gap journal (9.26, 10.1a) |
| Place lookup doesn't offer "`<store>` - Billing Address", or Save fails on Place | Billing `ContactPointAddress` missing or not readable, or `DbSchema_ContactPointAddress` not in the cache | Check rep visibility; check the cache. Don't create a second Place | 12.3 |

Store Check data must exist in this order: stores (Account), products, Assortment (Usage Type Store Check), Assortment Products, Store Assortments, Assessment Task Definitions, Assessment Indicator Definitions (+ defined values), Retail Store KPIs, Action Plan Template (Assessment Execution, target Visit, **published**), template assignment. See [Store Check pilot](./release-260-store-check-pilot.md).

## Mobile metadata cache

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| HTTP 400, parent `isn't ValidationCompleted` | Regenerating an `Active` parent | Create a new parent record; never reuse | 10.3–10.4 |
| Parent not `Active` after ~20 min | Platform delay | Mark it Inactive; one new parent only | 10.5 |
| Pricing files in the ZIP are `{}` | The four pricing selectors don't agree | See [First checks](#first-checks-most-setup-issues-are-one-of-these) item 3 | 10.7, 7.17, 8.10 |
| Blank Select Price Book on the iPad, no error | `DbSchema_*` pair only half profile-scoped | Deploy both halves | 10.1–10.2, 13.6 |
| Cache has two fewer DbSchema entries than deployed | The two `LifeSciConfigRecord` schemas are not included | Expected; don't regenerate | 10.7 |
| HTTP 404 on `/connect/life-sciences/commercial/configurations` | The endpoint is for mobile/UI callers | Check the downloaded ZIP instead | 10.7 |
| Unexpected `ContentDocumentLink` after checking the cache | `metadata/actions/download` has a side effect | Read `ContentVersion.VersionData` instead | 10.6 |

## iPad runtime (after setup)

| Symptom / exact error | Cause | Fix | Thread step |
|---|---|---|---|
| `Workflow_XIsLockedAndCannotBeCreated` on New Quote Save | iOS client never seeds `Status` (client defect) | Create the quote on web with the Visit, continue on the iPad; report to Support | 13.3–13.4, 15.1 |
| New quote saves with no Status | `Quote.Status` read-only in the rep's FLS (see First checks #5) | Try Edit in FLS with the layout field read-only, regenerate, retry once | 13.3 |
| No price books or products; quote in the wrong currency | Quote currency comes from the rep, not the store | Align rep, store and price book currencies; create a new quote | 4.8, 5.8 |
| Products missing on Add Products | No `ProductTerrDtlAvailability` with Purpose = Quote | See [setup runbook](./release-264-order-management-setup-runbook.md#products-missing-on-the-ipad-add-products-screen-quoted-orders) | — |
| `Review submission failed. Please try again.` / `You can't update Quote ... at this stage of the workflow` | Submit tapped twice; the server is exactly-once | Never re-tap Submit; read `Quote.Status` first | 14.7–14.8 |
| Status went to Submitted with no signature | The stage-path Submit was used | Use a fresh Draft and the cart Review path | 14.7–14.8 |
| PDF stuck "In Progress" after the one Generate PDF tap; `ContentVersionDocumentId` null. (In Progress after Submit Order and before the tap is normal: the iPad Generate PDF tap produces the PDF, 14.11) | First: rep lacks Create on `QuoteDocumentCreationEvent`. Also: Session Security Level High Assurance, or "Query Non Vetoed Files" on | Grant Read + Create on `QuoteDocumentCreationEvent` (8.24a); set session level Standard; turn off Query Non Vetoed Files. Don't regenerate, re-publish or delete the document without consent | 14.10, 14.12 |
| Request for Unlock sets Status but no approval reaches the manager | The rep has no `ManagerId`, or the approval flow is inactive | Set the manager; activate the flow | 4.8, 8.21 |
| Request for Unlock: `REQUIRED_FIELD_MISSING` on `TerritoryId` | The approver has no active territory | Assign the approver to a territory | 14.13–14.15 |
| Approve fails with `UNKNOWN_EXCEPTION`; quote stays In Review | Notification step runs as the Automated Process user | Set the notification user to a named admin (8.21a) | 8.21a, 14.13–14.15 |
| Last Order card absent | The source quote never reached Submitted | Check its `Status`; submit one | 15.2 |
| `SyncError.AttemptToStartInOffline` on the first visit upload | Client reachability false negative | Don't re-tap; let sync reconcile, then check `Visit.Status` | 12.5–12.6 |
| The rep's first sync fails with "Error while trying to access Salesforce" (`UNKNOWN_EXCEPTION`); a retry fails the same way | An action plan template the rep can read has more than one `ActionPlanTemplateVersion`, often one that came with the org and is shared to all internal users. Deleting or purging the extra version doesn't help | Check before the first login (11.1a). Ask before changing sharing; hide the template from the rep (move it out of the shared-from group of the owner sharing rule) | 11.1a, 11.2 |
| More than one `DigitalSignature`, `QuoteDocument` or `DocumentRecipient` for one quote | Submit or Generate PDF ran twice (a retried tap, or a resend after a timeout) | Report the counts and Ids; touch nothing; the customer decides which document to keep | 14.10, 14.7–14.11 |
| Billing/Shipping address shows "-" | Display gap | Confirm FLS and values on the server | 13.4, 14.3 |
| Visit blank on the device's quote | `VisitId` not Edit on the layout or FLS | Fix 8.2 and 8.13, regenerate, sync | 13.9 |
| Waterfall blank for lines priced on web | iPad shows server-priced lines without rows | Reprice on the iPad | — |

## Known limitations (not fixable by configuration)

Treat these as expected and don't change the org for them: Last Order prefill drops manual discounts; RSVP service absent; Store Check Verified checkbox not saved after Save & Close; raw token in the packaged Store Check heading (`ls_storecheck:lsStoreCheckVisit`); app build vs package version skew; cache DbSchema count two short; no camera on the simulator; Document Management entities; no `ProductTerritoryAvailability` rows on the device; Create Quote From Visit not in the iPad visit menu (use the Quoted Order tab → New); extra stages or Mark Status as Complete on the path; indicator definitions editable by the rep; `UserDevice` Pending Approval after first login; untouched boolean indicators write no `AssessmentIndValue`; Generate PDF "Unknown component" on web; Delete offered on an in-progress Store Check visit (don't tap it). The PDF stuck In Progress and the quote stuck in Request for Unlock count as limitations only after their fixes (8.24a, 8.21a) are in place.
