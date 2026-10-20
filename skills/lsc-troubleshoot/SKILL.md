---
name: lsc-troubleshoot
description: Diagnoses and resolves Life Sciences Cloud (LSC) issues. Use when user reports errors, unexpected behavior, or needs help debugging LSC configurations, FlexCards, OmniScripts, or Salesforce org issues.
---

# LSC Troubleshooting Expert

You are an expert at diagnosing and resolving LSC issues.

## Troubleshooting Approach

1. **Gather information**:
   - What module/feature is affected?
   - What is the expected vs actual behavior?
   - When did it start happening?
   - Any recent changes to configuration?

2. **Start with `diagnose_lsc_issue`**, passing the exact error text or the
   user's description of the symptom (paste the whole error, including object
   and field names). It matches the symptom against known causes found in real
   cases, mostly misconfigurations, and the validation rules. When an org is
   connected, it runs their checks and reports which causes are in the org,
   with the records to fix. Lead with what it found. A cause marked "This is how
   LSC works" is behaviour to explain, not a bug to fix. Investigate by hand
   only what it couldn't check.

3. **Use LSC tools to investigate further**:
   - `search_lsc_knowledge` to find relevant documentation
   - `get_lsc_module_docs` for module-specific guidance
   - `get_lsc_admin_setup` for configuration requirements
   - `get_lsc_troubleshooting({ topic: "implementation-anti-patterns" })` for
     design/config anti-patterns — **check this first for post-go-live incidents
     (Sev-1, API-limit "death loops", duplicate visits, inventory-count
     failures): these are config/design issues far more often than product
     bugs.** For a broad design review, use the `lsc-implementation-review` skill.

4. **If connected to an org**, look further with:
   - `describe_sobject` to verify object/field setup (always verify API names first)
   - `run_soql` to check data and configurations
   - `get_record` to inspect specific records
   - `list_trigger_handlers` to check if required trigger handlers are enabled
   - `list_admin_settings` to check Admin Console configuration
   - `toggle_trigger_handler` to enable/disable trigger handlers as needed

## Querying LifeSciConfigRecord (Admin Console Configuration)

LSC Admin Console settings are stored in `LifeSciConfigRecord` and `LifeSciConfigCategory` objects. These are **Tooling API-only objects** and cannot be queried via standard SOQL.

**Important:**
- Standard SOQL queries against `LifeSciConfigRecord` will fail with `INVALID_TYPE`
- `describe_sobject` will fail with `NOT_FOUND`
- You MUST use the Tooling API (API v65 or above) to query these objects

**How to query via SF CLI:**
```bash
sf data query --use-tooling-api --query "SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel, Type FROM LifeSciConfigRecord" --api-version 65.0
```

**Key fields on LifeSciConfigRecord:**
- `DeveloperName` — Uses `{Category}_{Suffix}` naming convention (e.g., `CalendarEvent_PlannedEvent`)
- `LifeSciConfigCategoryId` — Reference to the parent `LifeSciConfigCategory`
- `Type` — e.g., "CONFIGURATION"
- `IsOrgLevel` / `IsActive` — Status flags
- There is NO `Value` or `Metadata` field — the record acts as a metadata definition; actual config values are managed internally by the Admin Console

**LifeSciConfigCategory** defines groupings:
- `Category` picklist — e.g., "CalendarEvent", "PlannerAdministration", "DbSchema", "QuickAction"
- `Type` picklist — "List" (flat enumeration) or "Hierarchical" (org-level with profile overrides)

**Useful diagnostic queries (Tooling API):**
```sql
-- List all config categories
SELECT Id, DeveloperName, Category, Type FROM LifeSciConfigCategory

-- List all config records for a specific category
SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel
FROM LifeSciConfigRecord
WHERE DeveloperName LIKE 'CalendarEvent_%'

-- List Planner Administration settings
SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel
FROM LifeSciConfigRecord
WHERE DeveloperName LIKE 'PlannerAdministration_%'
```

4. **When the fix involves configuration changes**, offer to apply them:
   - "I found the issue: [handler/setting] is disabled/misconfigured. Want me to fix it?"
   - If yes: use `toggle_trigger_handler`, `update_admin_setting`, or `create_admin_setting` to make the change
   - Always confirm with the user before applying each change
   - After applying the fix, verify it resolved the issue by re-checking the configuration

## Common Issue Categories

### OmniStudio Issues (Web Only)
- **OmniStudio components (FlexCards, OmniScripts, DataRaptors) are NOT available in the LSC Mobile app (iPad).** Only suggest OmniStudio troubleshooting for web-based issues.
- FlexCard not displaying: Check DataRaptor, permissions, cache
- OmniScript errors: Validate step configuration, integration procedures
- Performance issues: Check DataRaptor queries, caching settings

### Sample Management
- **Samples panel "No items found" (most common):** The #1 cause is missing `ProductTerrDtlAvailability` (PTDA) records for sample-level marketable products. Diagnosis steps:
  1. Check PTDAs exist for the rep's territory:
     ```sql
     SELECT ProductId, Product.Name, SortOrder
     FROM ProductTerrDtlAvailability
     WHERE TerritoryId = '<territory-id>'
     ```
     Must include both Brand-level AND sample-level marketable products.
  2. If PTDAs are missing: check that `ProductTerritoryAvailability` (PTA) records exist for sample-level marketable products **at a parent territory** (e.g., `GB-COUNTRY`) with `AlignmentType = 'Territory and Subordinates Inclusion'`. Using `Territory Inclusion` at a leaf territory does NOT create PTDAs. Then run the alignment batch job from **Admin Console > Product (tile) > Product Alignment Jobs**.
  3. Check sample-level marketable products have: `Type = 'Product'`, `DistributionMethod` set (Drop/Ship/DropAndShip), `ParentBrandProductId` pointing to the Brand, `ProductSpecificationType = 'LSSampleProduct'`.
  4. Check rep has `ProductItem` records in their User Inventory `Location`.
  5. Check `TerritoryProdtQtyAllocation` records exist with current `TimePeriod` and `OwnerId = rep` (Private sharing).
- **SortOrder on PTDA is NOT required** — null SortOrder does not block samples. This is a known red herring.
- Sample Limits not calculating: Verify sample limit templates, date ranges
- Inventory sync issues: Check sample transaction records, reconciliation jobs
- Compliance warnings: Verify signature capture, recipient validation
- Template not applying: Check Admin Console > Sample Limits > Jobs

### Visit Management
- Visit not saving: Check required fields, validation rules, trigger handlers
- **Products not appearing in Product Details:** Check the PTDA → Marketable Product chain:
  1. PTDAs must exist for Brand-level marketable products in the rep's territory
  2. Marketable products must have `Type = 'Brand'` (not `'Product'`) — `Type = 'Product'` is filtered out by Query #6
  3. `Type = 'Brand'` requires `ProductId = null` (platform enforces this)
  4. If PTAs exist but PTDAs don't, run the alignment batch job from **Admin Console > Product (tile) > Product Alignment Jobs**
- Geolocation issues: Check address data, mobile permissions, geolocation settings
- Record type not available: Check Visit Record Type Mappings in Admin Console

### Account Management
- Provider Card not loading: Check ARC configuration, DataRaptor setup, permissions
- Addresses not syncing: Check address configuration, integration
- Affiliations missing: Check affiliation records, parent/child setup

### Event Management (Field Events)
- **"We couldn't add the participant to the event either because the participant type and role aren't mapped for this event type or because the mapping record isn't active" on the Non-Profiled Attendees / Write-Ins cards, and the card has no Update/+Add button at all:** almost never a genuinely missing/inactive `EventMgmtPtcpTypeRoleMap` row (that's a red herring — it's usually already active). The real cause is that the mapping row points to an `EventMgmtParticipantRole` with `Role = Attendee` instead of a dedicated role typed `Role = NonProfiledAttendee` / `WriteInAttendee` — orgs often never create one, because `StandardRole` (a separate, restricted picklist) has no matching value for these two categories. Fix: create a role record per category with `StandardRole = 'Other'` (the only valid fallback), then repoint every NonProfiledAttendee/WriteInAttendee `EventMgmtPtcpTypeRoleMap` row (across all `MngEventType`s, not just one) to the new role. Full diagnose/fix steps: `knowledge/modules/field-events-management/troubleshooting.md`.

### Calendar / Planner
- **`Error in $A.getCallback() [Cannot read properties of undefined (reading 'ObjectType')]`**: This Aura error occurs when the Planner component cannot find expected calendar event type configuration. Investigate with Tooling API queries (see "Querying LifeSciConfigRecord" section above):
  1. Check that `CalendarEvent_*` config records exist and are active:
     ```sql
     SELECT Id, DeveloperName, MasterLabel, IsActive
     FROM LifeSciConfigRecord
     WHERE DeveloperName LIKE 'CalendarEvent_%'
     ```
  2. Check that `PlannerAdministration_*` config records exist:
     ```sql
     SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel
     FROM LifeSciConfigRecord
     WHERE DeveloperName LIKE 'PlannerAdministration_%'
     ```
  3. Verify the `DbSchema_CalendarEvent` and `DbSchema_PlannerAdministration` records exist:
     ```sql
     SELECT Id, DeveloperName, MasterLabel
     FROM LifeSciConfigRecord
     WHERE DeveloperName IN ('DbSchema_CalendarEvent', 'DbSchema_PlannerAdministration')
     ```
  4. If records are missing, re-run the Calendar/Planner setup in Admin Console to regenerate them
  5. This error commonly occurs after an LSC upgrade where post-upgrade configuration steps were missed
- Calendar events not rendering: Check CalendarEvent config records are active via Tooling API
- Planner settings not applying per profile: Check `PlannerAdministration_*` hierarchical config records — `_OrgLevel` is the default, profile-specific overrides use `_<ProfileName>` suffix

### Business License / Mobile License Icon

The LSC mobile app shows license status in two places:
- **Account list** — Aggregate icon per account. Red if ANY part of the chain is missing.
- **Visit Engagement page** — Per-type badges ("State", "DEA"). Each badge is independent.

**The Visit page only checks BusinessLicense validity. The account list icon checks the full chain below.**

#### IsLicenseValidated Formula

`BusinessLicense.IsLicenseValidated` is a platform-managed formula (`getCalculatedFormula()` returns null). Requirements:

| Field | Requirement |
|---|---|
| `LicenseNumber` | Not blank |
| `PeriodEnd` | Greater than `NOW()` |
| **`PeriodStart`** | **Must be set (not null) — undocumented, #1 hidden cause of false** |
| `ComplianceScope` | Must be set (`JurisdictionState`, `Address`, or `StateDistributorLicense`) |
| `ContactPointAddress.IsActive` | Must be `true` when ComplianceScope is `Address` or `StateDistributorLicense` |
| `ContactId` | Set to `PersonContactId` for PersonAccount (HCP) licenses |
| `Account.IsActive` | Must be `true` — **defaults to `false` on new accounts** |

**Diagnostic query:**
```sql
SELECT Id, Name, AccountId, Account.Name, IsLicenseValidated, LicenseNumber,
       PeriodStart, PeriodEnd, ComplianceScope, JurisdictionState,
       ContactPointAddressId, ContactId
FROM BusinessLicense
WHERE AccountId = '<account-id>'
```

#### Visit Page Badges Red

1. Check `IsLicenseValidated` — is it `true`?
2. If `false`: check `PeriodStart` — is it set? (Most common hidden cause)
3. If `false` and ComplianceScope is `Address`: check linked CPA's `IsActive`
4. If State badge is red but `IsLicenseValidated = true`: check `JurisdictionState` — must match the CPA's state code

#### Account List Icon Red (but Visit Page Is Green)

The account list green icon requires the **full chain**:

1. **`ProviderAcctTerritoryInfo.IsActive = true`** — defaults to `false`, **#1 cause of red account list icon**
2. **`ProviderAcctTerritoryInfo.IsAvailableOffline = true`** — required for mobile sync
3. **`ProviderAcctTerritoryInfo.Territory2Id`** must point to the **leaf territory** (not a parent)
4. **`ProviderAcctTerritoryInfo`** must have `LSC4CEAutoShare` sharing rule for the territory group (manually created records don't get this automatically)
5. **`ProviderAcctTerritoryInfo.IsTargetedAccount = true`**, `SourceType = 'Manual'`, `PreferredAddressId` set to the account's CPA
6. **`PrvdAccountTerritorySummary`** records — one per user in the territory, `OwnerId = UserId`
7. **`ObjectTerritory2Association`** linking account to territory
8. **Valid `BusinessLicense`** with `IsLicenseValidated = true`
9. **`ContactPointAddress.IsActive = true`**, `AddressType = 'Billing'`, `UsageType = 'Work'`
10. **`Account.IsActive = true`**
11. **`HealthcareProvider`** record shared with territory users

**Diagnostic queries for the full chain:**
```sql
-- Check ProviderAcctTerritoryInfo
SELECT Id, AccountId, Account.Name, Territory2Id, Territory2.Name,
       IsActive, IsAvailableOffline, IsTargetedAccount, SourceType, PreferredAddressId
FROM ProviderAcctTerritoryInfo
WHERE AccountId = '<account-id>'

-- Check PATI sharing (LSC4CEAutoShare)
SELECT Id, ParentId, UserOrGroupId, AccessLevel, RowCause
FROM ProviderAcctTerritoryInfoShare
WHERE ParentId = '<pati-id>'

-- Check CPA fields
SELECT Id, ParentId, IsActive, AddressType, UsageType, StateCode
FROM ContactPointAddress
WHERE ParentId = '<account-id>'

-- Check account is active
SELECT Id, Name, IsActive FROM Account WHERE Id = '<account-id>'
```

#### Account Not Appearing on Mobile at All

1. Check `ProviderAcctTerritoryInfo.IsAvailableOffline = true`
2. Check `ProviderAcctTerritoryInfo.Territory2Id` points to the correct **leaf** territory (the dbschema filter matches `Territory2.Name = '{USER.TERRITORY}'` which resolves to the rep's assigned leaf)
3. Check `LSC4CEAutoShare` exists on the `ProviderAcctTerritoryInfo` record
4. Check `PrvdAccountTerritorySummary` records exist (one per user in the territory)

#### Creating Valid Demo Licenses

A single State license per account is sufficient for the green icon:
```apex
BusinessLicense bl = new BusinessLicense();
bl.Name = 'State License - Account Name';
bl.LicenseNumber = 'ST-001';
bl.AccountId = accountId;
bl.Status = 'Verified';
bl.IsActive = true;
bl.ComplianceScope = 'JurisdictionState';
bl.JurisdictionState = 'CA';  // Must match the CPA's state code
bl.PeriodStart = Datetime.newInstance(Date.newInstance(2025, 1, 1), Time.newInstance(0, 0, 0, 0));
bl.PeriodEnd = Datetime.newInstance(Date.newInstance(2029, 1, 1), Time.newInstance(0, 0, 0, 0));
bl.IssueDate = Date.newInstance(2025, 1, 1);
```

**Batching:** Managed-package triggers on BusinessLicense consume ~32 SOQL queries per DML. Keep inserts to batches of ~15 records.

### Territory Alignment
- Accounts not assigned: Check alignment rules, territory hierarchy
- User not seeing accounts: Verify Territory2 membership, sharing rules
- Territory jobs failing: Check Admin Console > Territories > Jobs
- **Territory-scoped sharing not working / sharing-handler setup aborts:** The territory model must be **activated first**. Sharing handler setup checks `Territory2Model.State == 'Active'` and aborts with an explicit error if the model is in `Planning`/`Inactive` state. Activate the territory model before enabling sharing handlers.
  ```sql
  SELECT Id, DeveloperName, State FROM Territory2Model
  ```

### Mobile Sync / DB Schema
- **Object's data disappeared from the iPad after a config change:** Check whether its DB Schema record was **deactivated or removed**. Disabling a DB Schema record is destructive — on the next sync the app runs `DELETE FROM <table>` for objects no longer in the metadata, wiping all locally cached records (and any unsynced offline edits) for that object. Re-enabling re-syncs server data, but local-only data is gone. Use `list_db_schema` / `get_db_schema` to confirm the record's state.
- **Data Change Requests or offline edits silently fail for an object:** Check `OneWaySync` on its DB Schema record. `OneWaySync = true` (web→mobile only) means the object gets no offline-tracking columns and is treated as unsyncable for edits — DCR and offline modifications will silently fail. Set `OneWaySync = false` if the object needs offline edit/DCR support.

### Configuration & Deployment Gotchas
- **A trigger handler you deployed doesn't show up in `list_trigger_handlers`:** New/custom trigger handler records may not be registered until the handler-sync routine runs. Execute `TriggerService.syncTriggerHandlerRecords();` via `run_apex`, then re-list.
- **Automation firing mid-deploy / config deploys in an inconsistent state:** Deploy LifeSciConfig + trigger-handler-dependent metadata in two passes — **deploy inactive first, then activate** — so triggers/automation don't fire against partially-deployed config. (This is the pattern LSC's own setup scripts use.) See `lsc-config-migration` for the full sequence.

### Mobile Related List Renders Blank (force:relatedListSingleContainer)

**Symptom:** On the LSC iPad app, a related-list tab on a record page renders **completely blank** — no "(N)" card header, no **New** button, no rows — even though the child records exist and synced. Classic tell: the SAME list renders its empty "(0)" card + New button fine when the parent has **0** children, but blanks the entire container the moment there is **≥1** child. It also often reproduces on one record but not another of the same object.

**Component involved:** the related list is rendered by the FlexiPage component `force:relatedListSingleContainer`, configured with these `componentInstanceProperties`:
- `relatedListApiName` — e.g. `AccountPlanRelationship_AccountPlan` (`<Child>_<ParentLookup>`)
- `parentFieldApiName` — e.g. `AccountPlan.Id`
- `relatedListComponentOverride` = **`NONE`** ← this is the key
- `rowsToDisplay`, `showActionBar`

When `relatedListComponentOverride = NONE`, the component does **not** define its own columns. It **inherits the column set from the related-list definition on the parent record's RECORD-TYPE page layout**. If that record type's layout has **no related list** for the child object, there are no columns to draw, and the app blanks the whole container instead of degrading gracefully.

**Why it reproduces on one record and not another:** Different **record types** resolve to different **page layouts**. A record whose record type maps to a layout that *includes* the child related list renders fine; a record with **no record type (Master)** — or a record type whose layout omits that related list — blanks. Same child object, same device, same cache. So the differentiator is the parent record's **RecordType → page layout**, not the child object or row count.

#### Diagnose
1. Compare two parent records — one that renders, one that blanks — and get their record types:
   ```sql
   SELECT Id, Name, RecordType.DeveloperName FROM AccountPlan WHERE Id IN ('<good>','<blank>')
   ```
2. Get the layout Ids for the object, then inspect each record type's page layout for the related-list field set via the Tooling API:
   ```bash
   # Get layout Ids
   sf data query --use-tooling-api -q "SELECT Id, Name FROM Layout WHERE TableEnumOrId='AccountPlan'" --json
   # Inspect a layout's related lists
   sf data query --use-tooling-api -q "SELECT Metadata FROM Layout WHERE Id='<layoutId>'" --json
   # In result.records[0].Metadata.relatedLists[], look for the child object.
   #   Present (renders):  relatedList=RelatedAccountPlanRelationships fields=[Name, AccountPlan, RelatedAccountPlan]
   #   Missing (blanks):   no entry whose relatedList references the child object
   ```

The layout that **has** the related list = the working record type; the one that **lacks** it = the blank record type. That confirms the root cause.

#### Fix A — add the related list to the deficient page layout (permanent, deployable)
Retrieve the layout, add a `<relatedLists>` block, and deploy (page layouts deploy reliably):
```xml
<relatedLists>
    <fields>Name</fields>
    <fields>AccountPlan</fields>
    <fields>RelatedAccountPlan</fields>
    <relatedList>RelatedAccountPlanRelationships</relatedList>
</relatedLists>
```
- `<relatedList>` is the layout's related-list name (e.g. `RelatedAccountPlanRelationships`), which is **not** the same string as the FlexiPage's `relatedListApiName` (`AccountPlanRelationship_AccountPlan`) — both point to the same child→parent relationship.
- `<fields>` uses **relationship/field names**, not Id fields (`AccountPlan`, not `AccountPlanId`).
- After deploy, regenerate the mobile metadata cache for the affected profile(s) and re-sync the device.

#### Fix B — give the record the working record type (fast data fix)
If the record simply has no/wrong record type, set it to the one whose layout already has the related list:
```apex
AccountPlan p = [SELECT Id FROM AccountPlan WHERE Id='<id>'];
p.RecordTypeId = '<recordTypeId of the working layout>';
update p;
```
No cache regen needed — just re-sync the device so the new record type's layout takes effect.

#### Do NOT chase these dead ends
- **The child object's `searchLayouts`** in `sobjects.json` is *not* the driver — records render fine even when the child object has no `searchLayouts` entry.
- **Deploying `<searchLayouts>` to a STANDARD object via the Metadata API silently fails** — the deploy reports `success: true / changed: true` but re-retrieval shows the block was dropped. Don't rely on it.
- **Verify you're inspecting the LIVE simulator.** Multiple sims can be booted; find the active cache by mtime:
  ```bash
  find ~/Library/Developer/CoreSimulator/Devices/*/data/Containers/Data/Application/*/Documents/.Data \
    -name ui.json -mtime -2 -exec stat -f '%Sm %N' {} \;
  ```

## Resolution Steps

1. Identify the root cause category
2. Check relevant Admin Console settings
3. Use `describe_sobject` to verify object structure
4. Verify data integrity with SOQL queries
5. Review any custom configuration or triggers
6. Test in isolation if possible
7. Document the fix for future reference

