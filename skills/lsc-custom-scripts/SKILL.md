---
name: lsc-custom-scripts
description: Guides Life Sciences Cloud (LSC) Custom Script configuration for validation, checklists, and Visit Action Validation. Use when user asks about custom scripts, visit validation scripts, CodeText, LifeScienceCustomScript, IIFE patterns, Locker Service proxy issues, headless LWC validation components, or a visit script that passes institution accounts.
---

## How to Answer Custom Script Questions

**Always call MCP tools to get sourced documentation first.** Then supplement with the domain knowledge in this skill.

| User asks about... | Call this tool |
|---------------------|---------------|
| Custom script concepts, setup, documentation | `search_lsc_knowledge({ query: "custom scripts validation" })` |
| Current org custom script records | `run_soql({ query: "SELECT Id, Name, ComponentName, Type, ObjectName, OperationEventType FROM LifeScienceCustomScript ORDER BY Type, Name" })` |
| Workflow configuration / stage objects | `search_lsc_knowledge({ query: "workflow configuration stage objects" })` |
| Admin Console custom script settings | `list_admin_settings({ category: "CustomScript" })` |
| Object fields and relationships | `describe_sobject({ sobject: "LifeScienceCustomScript" })` |
| Mobile cache status | `check_mobile_cache_status()` |
| Visit configuration (related) | `check_visit_config()` |
| Visit validation passes for institutions, or does not run on Save | `search_lsc_knowledge({ query: "Visit Action Validation institution guard Save" })` then follow **Institution script guard** below. |

Always preserve the citation block (lines starting with > 📖, > 🔗, > 📂) from the tool response verbatim in your answer.

## Institution script guard

Load `knowledge/modules/visit-management/support-engineering-visit-script-institution-guard.md`. Finish only when the reply states every fact under **Required answer**. The primary cause is an inverted institution check in the customer's script. A Save path that does not run the script is a second cause, and only when neither account type runs it on Save.

---

## Choosing a Validation Mechanism

Before building a custom script, help the user choose the right mechanism:

| Mechanism | When to use | Online (Web) | Offline (iPad) |
|-----------|------------|--------------|----------------|
| **Validation Rule** | Simple, single-object, field-level checks expressible with standard formulas | Yes | Yes |
| **Custom Script (Visit Action Validation)** | Complex validations spanning multiple objects (samples, details, attendees, messages) | Yes | Yes |
| **Apex Trigger** | Last resort — validation requires data not available on mobile | Yes | No |

**Guidance:** Start with validation rules whenever possible. Move to Custom Script Visit Action Validation when the logic spans multiple objects or needs conditional checks that validation rules can't express. Use Apex triggers only when the required data isn't synced to the mobile app.

---

## Custom Script Types

| Type | When it runs | How it's assigned |
|------|-------------|-------------------|
| **Validation** | Any workflow action (Record Update) | Assigned to Stage Objects |
| **Checklist** | User clicks info icon on Record Update actions | Assigned to Stage Objects |
| **Visit Action Validation** | User clicks Sign or Submit on a visit | Runs automatically (only one script runs — first by ID/creation date) |

### Critical: Only One Visit Action Validation Runs

**Only one Visit Action Validation script runs per org.** If multiple scripts of this type exist, only the first one executes (based on ID or creation date). All validation rules must be combined in a single script returning multiple results in the array.

For Validation and Checklist scripts, different scripts can be assigned to different Stage Objects.

---

## Required Record Fields for LifeScienceCustomScript

| Field | Validation/Checklist | Visit Action Validation |
|-------|---------------------|------------------------|
| Name | Required | Required |
| ComponentName | LWC component name | LWC component name |
| Type | `Validation` or `Checklist` | `VisitActionValidation` |
| ObjectName | Not required | **`ProviderVisit`** (required!) |
| OperationEventType | Not required | **`OnUpdate`** (required!) |

**Without `ObjectName` and `OperationEventType`, Visit Action Validation scripts silently don't execute.**

---

## How Custom Scripts Work

Custom scripts are headless LWC components deployed to the org. The platform stores the JavaScript in the `CodeText` field of `LifeScienceCustomScript` records and executes it from there — **not** from the deployed LWC directly.

**After deploying an updated LWC, the user must click Refresh in Admin Console > Workflow Configuration > Custom Scripts to sync the code to the CodeText field.**

- `CodeText` is the runtime source of truth
- `CodeText` is read-only via API — it can only be updated through the Refresh button

---

## Two Runtimes: Web vs. iPad (Locker Service vs. JavaScriptCore)

The same `CodeText` script runs in two completely different JavaScript engines depending on platform:

| | Web (Lightning) | iPad (LSC Mobile) |
|---|---|---|
| Engine | Browser + **Locker Service** (WKWebView-style sandbox) | Native **JavaScriptCore** (`JSContext`) — no Locker Service |
| Globals (`record`, `user`, `db`, `env`) | Locker Service secure proxies | Native Swift objects bridged via JSExport |
| Return values | Wrapped in Locker Service **Proxy** objects | Bridged native objects (not Locker proxies) |
| Where `env.log()` / `console.log` goes | Browser devtools console | **Device logs** (Console.app / Xcode device console) — NOT a browser console |

**Why this matters:**
- The `unwrapProxy(results)` requirement (gotcha #2) exists to strip **Locker Service** proxies on web. On iPad there is no Locker Service, but `JSON.parse(JSON.stringify(results))` is still the correct way to return plain data across the JavaScriptCore bridge — keep it for both platforms.
- When debugging, look in the **browser console on web** and in **device logs on iPad**. A script that "works on web but not on iPad" usually differs because of the engine/bridge, not the logic — check the runtime before rewriting the validation.

---

## Confirmed Working IIFE Pattern (Visit Action Validation)

All Visit Action Validation scripts must follow this pattern. **Do not deviate.**

```javascript
(() => {
    function parseContextData(record) {
        try {
            if (!record || typeof record.getContextData !== 'function') return {};
            var contextData = record.getContextData();
            if (typeof contextData === 'string') return JSON.parse(contextData);
            if (typeof contextData === 'object' && contextData !== null) return contextData;
            return {};
        } catch (e) { return {}; }
    }

    function getFieldData(contextData, baseFieldName) {
        return contextData[baseFieldName + '.VisitId'] || contextData[baseFieldName];
    }

    function unwrapProxy(results) {
        return JSON.parse(JSON.stringify(results));
    }

    async function myValidation(contextData) {
        try {
            // Validation logic here
            // Return { title: "message", status: "success" | "warning" | "error" }
        } catch (e) {
            return { title: 'Validation error: ' + e.message, status: 'error' };
        }
    }

    async function validateVisit() {
        try {
            var contextData = parseContextData(record);
            var hasWebField = contextData['ProviderVisit'] !== undefined;
            var result = await myValidation(contextData);
            var results = [result];
            if (hasWebField) { var resolved = await Promise.all(results); return unwrapProxy(resolved); }
            return unwrapProxy(results);
        } catch (error) {
            return [{ title: 'Validation error: ' + error.message, status: 'error' }];
        }
    }

    if (record && user && env && db) {
        var contextData = parseContextData(record);
        var hasWebField = contextData['ProviderVisit'] !== undefined;
        if (hasWebField) return [validateVisit()];
        else return validateVisit();
    }
})();
```

### Validation Script Pattern (for Workflow)

Workflow Validation and Checklist scripts use a simpler pattern — no platform detection needed:

```javascript
(() => {
    async function validateSomething() {
        try {
            // Validation logic using record, db, env globals
            return { title: "Validation passed", status: "success" };
        } catch (error) {
            return { title: "Error: " + error.message, status: "error" };
        }
    }

    return [validateSomething()];
})();
```

---

## Context Data Structure (Visit Action Validation)

`record.getContextData()` returns a JSON object with the visit and all related child records.

### Top-Level Keys (Web)

On **web**, child records are keyed by `ObjectName.VisitId`. On **mobile**, they use just the object name.

```javascript
{
    "ProviderVisit": { ... },                              // The visit record
    "PresentationForum.ForumReferenceId": [ ... ],         // CLM presentations
    "ProviderVisitProdDetailing.VisitId": [ ... ],         // Detailed products
    "ProductDisbursement.VisitId": [ ... ],                // Samples left
    "ProviderVisitRqstSample.VisitId": [ ... ],            // Sample requests
    "ProviderVisitMarketingItem.VisitId": [ ... ],         // Marketing items
    "Visit.ParentVisitId": [ ... ],                        // Attendee child visits
    "version": "...",                                       // Data version
    "sObjectType": "..."                                    // Object type
}
```

### Data Available Without db.query (Sync)

These objects are in the context payload and can be read directly:
- `ProviderVisit` — visit header fields (Id, AccountId, Channel, Status, Description, etc.)
- `ProviderVisitProdDetailing.VisitId` — detailed products (with `AdditionalInformation` JSON)
- `ProductDisbursement.VisitId` — samples (with `AdditionalInformation` JSON)
- `ProviderVisitRqstSample.VisitId` — sample requests
- `ProviderVisitMarketingItem.VisitId` — marketing items
- `PresentationForum.ForumReferenceId` — CLM presentations
- `Visit.ParentVisitId` — attendee child visits

**Nested (NOT top-level):**
- `ProviderVisitDtlProductMsg` — nested on each `ProviderVisitProdDetailing` record as `detailRecord['ProviderVisitDtlProductMsg.VisitId']`
- `ProviderVisitProdDiscussion` — nested on each detail record similarly

### Data Requiring db.query (Async)

These are NOT in the context and require `await db.query(...)`:
- `Account` (IsPersonAccount, Specialty, etc.)
- `Product2` (Brand, Name, custom fields)
- `ProductItem` (ExpirationDate, Product2Id)
- `Profile` (Name — query by name, not hardcoded ID)
- `UserAdditionalInfo` (ProfileIdentifier)
- `ObjectTerritory2Association` / `UserTerritory2Association`
- `IndividualConsent` or custom consent objects

### AdditionalInformation JSON (on ProductDisbursement)

```json
{
    "Product2": { "Name": "Immunexis 10mg" },
    "ProductionBatch": {
        "Name": "IMX-BG6678",
        "ExpirationDate": "2030-01-30T00:00:00.000Z"
    }
}
```

### AdditionalInformation JSON (on ProviderVisitProdDetailing)

```json
{
    "LifeScienceMarketableProduct": { "Name": "Immunexis" },
    "Indication": { "Name": null },
    "Brand": { "Name": null },
    "TherapeuticArea": { "Name": null }
}
```

### Field Name Casing (Web vs Mobile)

Web and mobile may use different casing:

| Web | Mobile |
|-----|--------|
| `ProductItemId` | `productitemid` |
| `AccountId` | `accountid` |
| `QuantityDisbursed` | `quantitydisbursed` |
| `Channel` | `channel` |

Always check both: `record.ProductItemId || record.productitemid`

### Accessing Custom Fields from db.query Results

**`stringValue()` does NOT work for custom fields (`__c`) on either platform.** Standard fields and custom fields require different access methods:

| Method | Standard Fields | Custom Fields (Web) | Custom Fields (iPad) |
|--------|----------------|--------------------|--------------------|
| `stringValue('Field')` | Works | Does NOT work | Does NOT work |
| `.sObject.Field__c` | Works | **Works** | No `sObject` on mobile |
| `noNs_stringValue('Field__c')` | Works | Not needed | **Works** |

**Cross-platform helper (always use this for custom fields):**

```javascript
function getCustomField(queryResult, fieldName) {
    if (!queryResult) return null;
    // Web: use sObject property
    if (queryResult.sObject && queryResult.sObject[fieldName] !== undefined) {
        return queryResult.sObject[fieldName];
    }
    // iPad: use noNs_stringValue
    if (typeof queryResult.noNs_stringValue === 'function') {
        var val = queryResult.noNs_stringValue(fieldName);
        if (val !== undefined) return val;
    }
    return null;
}
```

**Important details:**
- Custom fields with **null values are silently dropped** from `sObject` on web — they return `undefined`, not `null`
- On iPad, custom fields must be in the **DB Schema** (mobile metadata cache). If a field isn't in the cache, it won't sync to the device. Regenerate cache and re-login after adding fields.
- The `db.query` result object is completely different between platforms:
  - **Web**: has `sObject`, `accessibleFields`, `sObjectName`, `namespaceUtils` properties
  - **iPad**: opaque object with only methods: `enableAccessErrors`, `stringValue`, `numValue`, `boolValue`, `dateValue`, `setValue`, `noNs_stringValue`, `noNs_numValue`, `noNs_boolValue`, `noNs_dateValue`, `noNs_setValue`, `recordTypeName`, `save`

### Getting AccountId on Mobile

On web, `AccountId` is available in `contextData.ProviderVisit.AccountId`. On mobile, `ProviderVisit` doesn't exist in the context. Use the `record` global as a fallback:

```javascript
var visit = contextData.ProviderVisit || {};
var accountId = visit.AccountId || visit.accountid;
if (!accountId) {
    try { accountId = record.stringValue('AccountId'); } catch (e) {}
}
```

---

## Available Globals

| Global | Description | Key Methods |
|--------|-------------|-------------|
| `record` | Current record | `stringValue(field)`, `boolValue(field)`, `getContextData()` |
| `user` | Current user | `stringValue(field)` |
| `db` | Database access | `query(entity, conditions, fields)` |
| `env` | Environment | `getOption(key)`, `log(message)` |

## Available Classes

Injected globals (confirmed against `businessRuleValidator/objectInitialization.js`):

`ConditionBuilder`, `ConditionBuilder_noNs`, `ConditionEnhancedBuilder`, `ConditionEnhancedBuilder_noNs`, `Query`, `SetCondition`, `SetCondition_noNs`, `FieldCondition`, `FieldCondition_noNs`, `DateFieldCondition`, `DateFieldCondition_noNs`, `DateTimeFieldCondition`, `DateTimeFieldCondition_noNs`, `AndCondition`, `OrCondition`, `enableAccessErrors`

- Every builder/condition class has a `_noNs` variant for accessing custom (`__c`) fields without the managed-package namespace prefix — use the `_noNs` form when working with custom fields (mirrors the `noNs_stringValue` pattern for `db.query` results).
- `Query` is the query builder; `enableAccessErrors` surfaces field-access errors instead of silently returning null.
- **`GroupCondition` is NOT injected** — it is an internal base class, not available to scripts. Do not reference it.

## Output Format

```javascript
{ title: string, status: string }  // "success", "warning", or "error"
```

| Status | Checklist | Validation |
|--------|-----------|------------|
| `success` | Green check | Not displayed |
| `warning` | Yellow alert | Shows warning dialog, user can continue |
| `error` | Red X | Blocks action, shows error dialog |

---

## Critical Gotchas

When helping users write or debug custom scripts, **always warn about these**:

1. **No comment blocks before the IIFE.** JSDoc or multi-line comment blocks (`/** ... */`) before `(() => {` cause Locker Service to silently fail — the platform shows a generic error with zero console output. Put comments inside the IIFE only.

2. **Proxy wrapping breaks results.** On **web**, return values get wrapped in Locker Service Proxy objects and `translateValidationResults` cannot read them. **Always call `unwrapProxy(results)`** (`JSON.parse(JSON.stringify(results))`) before returning. Without this, the platform silently allows the visit through. (iPad runs in native JavaScriptCore with no Locker Service — but `unwrapProxy` is still required to return plain data across the bridge. See "Two Runtimes" above.)

3. **Large scripts crash silently.** If a script is too large, Locker Service fails to evaluate it. Keep scripts small and focused.

4. **CodeText is the runtime source.** The platform executes from `CodeText`, not the deployed LWC. Always click Refresh after deploying.

5. **ObjectName and OperationEventType required.** Without `ObjectName = 'ProviderVisit'` and `OperationEventType = 'OnUpdate'` on the LifeScienceCustomScript record, Visit Action Validation scripts silently don't execute.

6. **Only one Visit Action Validation runs.** First by ID/creation date. Combine all rules in one script.

7. **Product messages are nested.** `ProviderVisitDtlProductMsg` is NOT a top-level context key. Access via `detailRecord['ProviderVisitDtlProductMsg.VisitId']`.

8. **Use `env.log()` for debugging.** Add `env.log('scriptName - message')` calls to trace execution. Output goes to the **browser console on web** and to **device logs on iPad** (JavaScriptCore has no browser console). This is the only way to debug custom scripts.

9. **Guard globals.** Always wrap execution in `if (record && user && env && db)`.

10. **Sharing defaults to Private.** Rep users need record-level access to `LifeScienceCustomScript` records. Change OWD to Public Read Only if reps can't see scripts.

11. **Query Profile by name, not ID.** Profile IDs differ between orgs. Query `Profile` where `Name = 'Field Sales Representative'` and use the returned ID.

12. **The quantity field is `QuantityDisbursed`, not `Quantity`.** On mobile, field names may be lowercase.

13. **Custom fields (`__c`) require special access.** `stringValue()` does NOT work for custom fields on either platform. On web, use `.sObject.Field__c`. On iPad, use `noNs_stringValue('Field__c')`. Always use the `getCustomField()` helper for cross-platform code. See the "Accessing Custom Fields" section above.

14. **Null custom fields are silently dropped on web.** `db.query` omits custom fields with null values from the `sObject` — accessing them returns `undefined`, which looks identical to "field not supported". Always test with non-null values.

15. **iPad custom fields require DB Schema configuration.** Custom fields must be in the mobile metadata cache (Admin Console > Mobile > Object Metadata Cache Configuration). Regenerate cache and re-login after adding fields. Without this, `noNs_stringValue` returns `undefined`.

16. **Mobile `db.query` results have no `sObject` property.** The result object on iPad is completely opaque — no enumerable properties, `JSON.stringify` returns `{}`. Use the method-based API (`noNs_stringValue`, `numValue`, `boolValue`, etc.) instead.

17. **AccountId not in contextData on mobile.** On web, `contextData.ProviderVisit.AccountId` works. On mobile, `ProviderVisit` doesn't exist in the context. Fall back to `record.stringValue('AccountId')`.

---

## Configuration Mode

When the user asks about configuring custom scripts, **ask them which mode they prefer**:

1. **Show me the documentation** — call `search_lsc_knowledge({ query: "custom scripts" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State

```
run_soql({ query: "SELECT Id, Name, ComponentName, Type, ObjectName, OperationEventType, CreatedDate FROM LifeScienceCustomScript ORDER BY Type, CreatedDate" })
```

Report:
- How many scripts exist, by type
- For Visit Action Validation: which one will actually run (first by CreatedDate)
- Whether ObjectName and OperationEventType are set correctly

#### Step 2: Check for Multiple Visit Action Validation Scripts

If more than one Visit Action Validation script exists, **warn immediately** — only the first one (by ID/creation date) runs. The others are silently ignored.

#### Step 3: Verify Required Fields

For each Visit Action Validation script, verify:
- `ObjectName` = `ProviderVisit`
- `OperationEventType` = `OnUpdate`

**If either is missing, the script will silently not execute.**

#### Step 4: Check Sharing Settings

```
run_soql({ query: "SELECT Id, Name FROM LifeScienceCustomScript LIMIT 1" })
```

Remind user that `LifeScienceCustomScript` defaults to Private sharing. If field reps can't see validation results, OWD needs to be changed to Public Read Only.

#### Step 5: Remind About Refresh

After any LWC deployment, the user **must** click Refresh in Admin Console > Workflow Configuration > Custom Scripts to sync code to CodeText.

#### Step 6: Help Write or Debug Scripts

If the user wants to create a new validation script:
1. Ask what they want to validate
2. Help decide sync vs async (does the data need `db.query`?)
3. Generate the script using the confirmed IIFE pattern above
4. Include `env.log()` calls for debugging
5. Remind them about all gotchas (no JSDoc before IIFE, unwrapProxy, etc.)

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `LifeScienceCustomScript` | `CustomScript__c`, `LifeSciCustomScript` |
| `ProviderVisit` | `ProviderVisit__c`, `Visit__c` |
| `ProviderVisitProdDetailing` | `ProviderVisitProductDetailing__c` |
| `ProductDisbursement` | `SampleDrop__c` |
| `ProductItem` | `InventoryItem__c` |
| `Product2` | `SampleProduct__c` |
| `Profile` | (query by Name, not hardcoded ID) |

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings`
- **DO NOT** use `run_soql` for mobile cache — use `check_mobile_cache_status()`
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app
- **DO NOT** suggest updating `CodeText` via API — it is read-only and can only be synced via the Refresh button

### Example Scripts Repository

Reference examples are available at `https://github.com/lsc-ideas/lsc-custom-scripts-examples`. Point users here for working code examples covering common pharma validation patterns.

### Admin Console Navigation

| Task | Path |
|------|------|
| Custom Scripts | Admin Console > Workflow Configuration > Custom Scripts |
| Refresh CodeText | Admin Console > Workflow Configuration > Custom Scripts > Refresh (per row) |
| Stage Objects (assign scripts) | Admin Console > Workflow Configuration > Stage Objects > Edit |
| Workflow Paths | Admin Console > Workflow Configuration > Workflow Paths |
| Sharing Settings | Setup > Sharing Settings > LifeScienceCustomScript |
