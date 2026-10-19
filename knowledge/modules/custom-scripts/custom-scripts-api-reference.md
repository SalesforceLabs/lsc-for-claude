# Life Sciences Custom Scripts — API Reference (Release 264 official docs)

Purpose: (a) system-prompt reference for an AI that writes custom scripts; (b) source for editor autocomplete.
Everything under "Documented" is taken from the official Salesforce Help release 264.0.0 pages (and the Life Sciences dev guide). Items marked **[repo-only]** or **[undocumented in 264]** come from existing repo files or are inferred; they are NOT in the official 264 pages. Nothing here is invented: where the docs are silent, this file says so.

Base URL pattern: `https://help.salesforce.com/s/articleView?id=ind.<page>.htm&release=264.0.0&type=5`
Dev guide base: `https://developer.salesforce.com/docs/atlas.en-us.life_sciences_dev_guide.meta/life_sciences_dev_guide/<page>.htm`

---

## 1. Object model

Sources: `lsc_custom_scripts`, `lsc_workflow_create_custom_scripts`, `lsc_workflow_assign_custom_scripts`, `lsc_custom_scripts_format`, `lsc_custom_scripts_example_visit_action_validation_script`, dev guide `sforce_api_objects_lifesciencecustomscript`, `sforce_api_objects_lifescistageobject`.

### 1.1 LifeScienceCustomScript (API version 65.0+)

"Represents a custom script associated with a Life Science stage object within a workflow." Supported calls: create(), delete(), describeLayout(), describeSObjects(), getDeleted(), getUpdated(), query(), retrieve(), search(), undelete(), update(), upsert(). Associated object: `LifeScienceCustomScriptShare` (sharing available).

| API name | Type | Dev-guide properties | Notes |
|---|---|---|---|
| `CodeText` | textarea | **Nillable only** (no Create, no Update, no Filter) | "The JavaScript code associated with a Lightning web component." Per the dev guide it is NOT createable and NOT updateable. It is populated by the platform (Admin Console Refresh). |
| `ComponentName` | string | Create, Filter, Group, Sort, Update | **Required.** Name of the LWC that contains the custom script. |
| `Name` | string | Create, Filter, Group, idLookup, Sort, Update | Name of the record. |
| `ObjectName` | string | Create, Filter, Group, Nillable, Sort, Update | Doc text: "For a Mobile Page Layout Validation script, the name of the object associated with the custom script." |
| `OperationEventType` | picklist (restricted) | Create, Filter, Group, Nillable, Restricted picklist, Sort, Update | Doc text: "For a Mobile Page Layout Validation script, the type of operation that the custom script supports." Values: `OnCreate`, `OnDelete`, `OnUpdate`. |
| `OwnerId` | reference (Group, User; polymorphic) | Create, Defaulted on create, Filter, Group, Sort, Update | Relationship name `Owner`. |
| `SourceSystemIdentifier` | string | Create, Filter, Group, idLookup, Nillable, Sort, Update | External id from source system. |
| `SourceSystemName` | string | Create, Filter, Group, Nillable, Sort, Update | Source system name. |
| `Type` | picklist (restricted) | Create, Filter, Group, Restricted picklist, Sort, Update | **Required.** Picklist API values exactly as documented: `Checklist`, `MobilePageLayoutDataValidation`, `OrderValidation`, `Validation`. |

Critical observation on `Type`: the dev guide lists exactly four values and **does not list `VisitActionValidation`**, although the Admin Console help says to select "Visit Action Validation" as the Type. The Admin Console UI label "Visit Action Validation" does not appear as an API value in the dev guide. Verify the real value in the target org with `describe_sobject LifeScienceCustomScript` (picklist values) before writing records. The repo skill uses `VisitActionValidation` **[repo-only, unverified vs. dev guide]**. `MobilePageLayoutDataValidation` + `ObjectName` + `OperationEventType` is the documented pairing ("Mobile Page Layout Validation script"); the 264 help pages never describe that type or `OrderValidation` in the custom-scripts topic.

The help topic "Add Custom Scripts for Life Sciences" says only: "Custom scripts don't have an Active field." Fields that do not exist: `Active`/`IsActive`. Deactivate a Visit Action Validation script by deleting it in Admin Console.

### 1.2 Stage object: `LifeSciStageObject` (API version 65.0+)

"Represents an object associated with a workflow." Calls: create(), delete(), describeLayout(), describeSObjects(), getDeleted(), getUpdated(), query(), retrieve(), search(), undelete(), update(), upsert(). Share object: `LifeSciStageObjectShare`.

| API name | Type | Properties | Notes |
|---|---|---|---|
| `ChecklistCustomScriptId` | reference -> LifeScienceCustomScript (Lookup; relationship name `ChecklistCustomScript`) | Create, Filter, Group, Nillable, Sort, Update | "The custom script that provides a checklist." |
| `ValidationCustomScriptId` | reference -> LifeScienceCustomScript (Lookup; relationship name `ValidationCustomScript`) | Create, Filter, Group, Nillable, Sort, Update | "The custom script that enforces validation rules." |
| `CurrencyIsoCode` | picklist | Create, Defaulted on create, Filter, Group, Nillable, Restricted picklist, Sort, Update | Multi-currency orgs only; value USD default. |
| `IsControlledByStagePath` | boolean | Create, Defaulted on create, Filter, Group, Sort, Update | Whether object permissions are determined by a stage path. Default false. |
| `Name` | string | Create, Filter, Group, idLookup, Sort, Update | Required. |
| `ObjectName` | string | Create, Filter, Group, Sort, Update | Required. Object associated with the record. |
| `OwnerId` | reference (Group, User) | Create, Defaulted on create, Filter, Group, Sort, Update | |
| `ParentObjRelaFieldName` | string | Create, Filter, Group, Nillable, Sort, Update | API name of the field linking to a parent object. |
| `SourceSystemIdentifier` / `SourceSystemName` | string | Create, Filter, Group, Nillable, Sort, Update | Integration ids. |

Related workflow objects seen in the dev guide: `LifeSciStageAction` (its `Label` field is the value `env.getOption('actionName')` returns for workflow scripts), `LifeSciStageValue`, `LifeSciStageOperation`, `LifeSciStageOperationAction`, `LifeSciStageOperationCondn`.

### 1.3 How scripts are created and activated (documented)

1. Create an LWC (headless). Source: `lsc_custom_scripts_format`.
2. Admin Console (App Launcher) > Workflow Configuration > Custom Scripts > New: set name, enter the LWC component name, select whether script is checklist, workflow validation, or visit action validation, Save. Required permission: **Life Sciences Commercial Admin** permission set. After updating the LWC select **Refresh** "to sync changes to the custom script".
3. Activation depends on type:
   - Workflow validation and checklist scripts become active when assigned to a workflow (stage) object: Admin Console > Workflow Configuration > Stage Objects > row action Edit > **Validation Script** field and **Checklist Script** field > Save. Scripts then "run automatically as long as the object has an active workflow." Stage object records are created automatically after you create and save a workflow path (one per object that has a workflow). Validations and checklists apply to all object types.
   - Visit action validation scripts are active when added to the org (saved in Admin Console). "Create only one visit action validation script per org." Example attribute values: Script Name `visitSampleScript`, component name `visitSampleScript`, Type **Visit Action Validation**.

### 1.4 LWC -> CodeText mapping

What the official docs say (and do not say):
- "You create custom scripts as headless Lightning web components, meaning that the component includes only the JavaScript file and the metadata configuration file." (`lsc_custom_scripts_format`)
- "In the LWC, contain custom script logic in a self-calling function": `(() => { ... })();`
- `CodeText` = "The JavaScript code associated with a Lightning web component." Refresh "syncs changes to the custom script after you update the Lightning web component."
- The docs **never state** exactly which bytes of the bundle are copied into `CodeText` (whole `.js` file vs. an extracted expression), never show the `js-meta.xml` contents, and never state that the LWC needs `export default`. The Jest test pages treat the script file as a bare expression: `new Function('env','record','db',..., 'return ' + scriptContent)` - i.e. the file's content is a single expression `(() => {...})();` that is `return`ed. That implies the `.js` file content is the self-calling function expression itself (no `import`/`export`/`class`), and the whole file content is what is evaluated. Treat that as the contract: the JS file consists only of the IIFE.
- Test-suite file name in docs: `inquiryQuestionsValidation.js` (script under test). Example component name: `visitSampleScript`.

Layout the repo knowledge base describes **[repo-only: `support-engineering-validations-custom-scripts.md`, not official docs]**:

```
force-app/main/default/lwc/myValidationScript/
  myValidationScript.js            <- contains ONLY the (() => { ... })(); expression
  myValidationScript.js-meta.xml   <- LWC metadata ("isExposed=false" per repo note)
```
and package.xml with `LightningComponentBundle` member, version 62.0 (repo note; deployed via Workbench). A conforming meta file (standard LWC, not from the docs):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <isExposed>false</isExposed>
</LightningComponentBundle>
```
The repo skill adds: JSDoc/comment blocks before the IIFE make the script silently fail on web **[repo-only]**.

### 1.5 Refresh behavior

Documented: Refresh is a per-row action on the Custom Scripts page (Admin Console > Workflow Configuration > Custom Scripts); select it after changing and saving the LWC (all types, including Visit Action Validation). The docs do not document an API/Apex equivalent, and the dev guide marks `CodeText` as neither createable nor updateable. So per docs: **CodeText cannot be written via the API; it is written only by Refresh.** (Repo skill states the same; consistent.)

---

## 2. Script format and output contract

Sources: `lsc_custom_scripts_format`, `lsc_custom_scripts`, `lsc_custom_scripts_example_visit_action_validation_script`, `lsc_custom_scripts_best_practices`.

### 2.1 Format

```javascript
(() => {
    // Add custom script logic here.
    ...
})();
```

### 2.2 Output

"Custom scripts return an array of JavaScript objects with two defined properties."

| Property | Type | Details |
|---|---|---|
| `title` | String | Message users see. Can be a custom label name that translates to the user's language. |
| `status` | String | `success`, `warning` or `error`. |

Status semantics (verbatim meaning):
- `success`: shows a success message for checklist scripts. Not displayed for validation scripts.
- `warning`: shows a warning message for checklist scripts. For workflow and visit action validation scripts, if there are warnings but not errors, users see all warnings in one window and can choose to continue.
- `error`: shows an error message for checklist scripts. Shows an error window for validation scripts.

Documented example output:
```javascript
return [
    { title: "Success Message", status: "success" },
    { title: "Success_Message_Custom_Label", status: "success" },
    { title: "Warning Message", status: "warning" },
    { title: "Warning_Message_Custom_Label", status: "warning" },
    { title: "Error Message", status: "error" },
    { title: "Error_Message_Custom_Label", status: "error" }
];
```

Array elements may be Promises (async validations): the best-practices script returns `[inquiryQuestionsValidation()]` where the function is `async`; the Jest example does `await Promise.all(promiseArray)`. On the mobile app the VAV example returns the object array directly (see 2.4).

### 2.3 Custom labels

- With arguments: `env.formatCustomLabel('XIsRestrictedForY', '{0} is restricted for {1}', ['Immunexis', accountName])` - supports `{0}` `{1}` placeholders. (Note: the `env` page's parameter table says placeholders are `%@`; the format page shows `{0}`. See contradictions.)
- Without arguments: `env.formatCustomLabel('PleaseCorrectErrors', 'Please correct errors', [])`
- Simple label: use label name directly as title: `return { title: 'CustomLabelName', status: 'error' }` - "the system resolves the label automatically."
(The docs' sample text omits commas between arguments; they are required JavaScript.)

### 2.4 Per type

| | Checklist | Validation | Visit Action Validation |
|---|---|---|---|
| Runs when | User clicks the info icon on Record Update actions | User runs any workflow action | User saves, signs or submits a visit. Only Save, Submit, Sign; `Sign` covers digital and paper signatures. Save validation also runs for child (attendee) visits and for saves triggered by e.g. starting a remote session or opening an attendee visit. Does NOT run for Withdraw. |
| Wired by | Stage object **Checklist Script** field (`ChecklistCustomScriptId`) | Stage object **Validation Script** field (`ValidationCustomScriptId`) | Saved in Admin Console, one per org |
| success | green message shown | not displayed | not displayed |
| warning | warning message | all warnings in one window; user may continue | all warnings in one window; user may continue |
| error | error message | error window (blocks) | error window; errors take precedence over warnings, action blocked |
| `env.getOption('actionName')` | LifeSciStageAction Label (button label) | same | `Save`, `Submit` or `Sign` |

Platform: custom scripts "are supported on desktop and both online and offline in the Life Sciences Cloud mobile app." Same VAV script runs on web and mobile; test on both.

Execution differences (VAV page):
- Desktop: `db` actions are asynchronous; the framework awaits a promise. Use `async`/`await`.
- Mobile: at runtime the `async`/`await` keywords are stripped and `db` calls complete synchronously; the script returns results directly in an object array.
- The official VAV example therefore returns `[validateVisit()]` (array containing a Promise) on web and `validateVisit()` (plain result) on mobile, detecting the platform by `contextData["ProviderVisit"] !== undefined` (web).

Mobile app configuration for VAV: custom objects referenced (e.g. visit limit definitions) must be added to the metadata cache configuration: Type **Data**, select **Web-to-Mobile Sync**. If querying `PermissionSetAssignment`, add it to the metadata cache too. Querying Permission Set / PermissionSetAssignment as the current user requires reps to hold the **View Setup and Configuration** permission. Sales reps cannot read Profile / Profile Id on User: use `UserAdditionalInfo.ProfileIdentifier`.

---

## 3. Global variables

Sources: `lsc_custom_scripts_variables`, `..._variable_env`, `..._variable_db`, `..._variable_record`, `..._variable_user`. Always-present globals: `env`, `db`, `record`, `user`.

### 3.1 `env`

| Method | Params | Returns | Description |
|---|---|---|---|
| `getOption(name)` | `name` String | option value | Returns an environment option. Defaults: `fromStatus` (desktop: current value of the workflow path's controlling field; mobile: current value of the field to be updated; set only when a Record Update action runs), `toStatus` (new value of field to update; only on Record Update), `fieldName` (field being updated; only on Record Update), `actionName` (action that triggered the script: for workflow scripts the Label on `LifeSciStageAction` = the action's Button Label, and if it is a custom label name `namespace.LabelName` the script gets the stored name, not the translation; for VAV: `Save`, `Submit`, `Sign`). |
| `setOption(name, value)` | `name` String, `value` Object | not documented | Sets an environment option. |
| `log(msg)` | `msg` String | not documented | Logs to the browser console with prefix `"JS LOG: "`. |
| `formatCustomLabel(key, defaultValue, argumentsList)` | `key` String (label name), `defaultValue` String (used when no label found), `argumentsList` Array of strings | JS object to set as `title` | Translates the custom label to the user's locale and replaces `%@` symbols with the arguments. |

### 3.2 `db`

"All db functions are executed synchronously on the Life Sciences Cloud mobile app and asynchronously on desktop. In order to query correctly, use await syntax." `selectedFields` is "supported only on desktop".

| Method | Params | Returns | Description |
|---|---|---|---|
| `rowById(entity, id, selectedFields)` | entity String; id String; selectedFields Array (desktop only) | record | Retrieves a record by ID. |
| `rowsByEntity(entity, selectedFields)` | entity String; selectedFields Array (desktop only) | records | Retrieves records of an object. |
| `query(entity, whereClause, selectedFields)` | entity String; whereClause String (SOQL WHERE; may be built by ConditionBuilder); selectedFields Array (desktop only) | records | Retrieves records matching a WHERE clause. |
| `bulkQuery(queries)` | array of `{ uniqueRequestKey: String, sObjectName: String, condition: ConditionEnhancedBuilder (built), selectedFields: Array (desktop only) }` | key-value container `[String: [JsDbObject]]` keyed by `uniqueRequestKey` | Runs several queries. |
| `noNs_query(entity, whereClause)` | entity String; whereClause String | records | **Mentioned only in the troubleshoot note**: introduced in Summer '26 to skip prefixing the managed namespace `lsc4se__` to custom objects ending `__c`/`__mdt`; before the Summer '26 mobile app, `db.query` on such objects prepended the namespace and failed. No dedicated reference page in 264. |

Docs examples:
```javascript
await db.query(
    "Inquiry",
    await new ConditionBuilder(
        "Inquiry",
        new FieldCondition("Type", "=", "MedicalInquiry")
    ).build(),
    ["Id", "Name", "Status", "Type"]
)
/** Returns arrays of Inquiry records of from the local database. The full query is:
 * "SELECT Id, Name, Status, Type FROM Inquiry WHERE Type = 'MedicalInquiry'" */
```
```javascript
let result = await db.bulkQuery([
   {
       uniqueRequestKey: "inquiryRequest",
       sObjectName: "Inquiry",
       selectedFields: ["Id", "Name", "Status", "Type"],
       condition: new ConditionEnhancedBuilder(
           "Inquiry",
           new FieldCondition("Type", "=", "MedicalInquiry")
       ).build(),
   },
   {
       uniqueRequestKey: "accountRequest",
       sObjectName: "Account",
       selectedFields: ["Id", "Name"],
       condition: new ConditionEnhancedBuilder(
           "Account",
           new FieldCondition("Name", "=", "sForce")
       ).build(),
   },
]);
// let inquiryRecords = result.inquiryRequest;
// let accountRecords = result.accountRequest;
```
Data scope: records must be readable by the user and (for mobile/offline) synced via active DB Schema/object metadata cache configuration.

### 3.3 `record`

| Method | Params | Returns | Description |
|---|---|---|---|
| `stringValue(key)` | key String (field name) | string | Value of a string field if it exists and is readable. |
| `numValue(key)` | key String | number | Number field value if exists/readable. |
| `boolValue(key)` | key String | boolean | Boolean field value if exists/readable. |
| `dateValue(key)` | key String | date | Date field value if exists/readable. |
| `setValue(key, value)` | key String, value Object | - | Sets a field value on the current record. |
| `recordTypeName()` | - | string | Name of the current record's record type, if any. |
| `getContextData()` | - | JSON string or object | **Not on the official `record` page.** Used by the official VAV example and best practices ("use record.getContextData instead of queries"). Returns the visit's in-memory data (see section 5). |

Used in official examples without a reference entry: `record.stringValue("Id")` / `record.stringValue("uid")` (best-practices `getRecordId`).
**[repo-only]** noNs variants `noNs_stringValue`, `noNs_numValue`, `noNs_boolValue`, `noNs_dateValue`, `noNs_setValue` exist on record/db results; `getRecordType()` per support-engineering notes. Not in 264 reference pages.

### 3.4 `user`

Same shape as `record` minus `recordTypeName`/`getContextData`: `stringValue(key)`, `numValue(key)`, `boolValue(key)`, `dateValue(key)`, `setValue(key, value)`; `key` is "the name of the field on the user object". Readable only if exists and readable.

---

## 4. Classes

Source index: `lsc_custom_scripts_classes`. Pages: `lsc_custom_scripts_class_<name>` (OrCondition page is `lsc_custom_script_class_orcondition`).

Hierarchy: `Condition` (abstract) <- `OperatorCondition` <- `FieldCondition` <- `DateFieldCondition`, `DateTimeFieldCondition`; `OperatorCondition` <- `SetCondition`; `Condition` <- `GroupCondition` <- `AndCondition`, `OrCondition`. Builders: `ConditionBuilder`, `ConditionEnhancedBuilder`. `Query` is a subquery builder.

### Condition (abstract)
"Don't use the Condition class directly." Pass a subclass instance to a builder.
- `getRequiredFields()` - returns an empty object.
- `toSoql()` - returns an empty string.

### ConditionBuilder
Builds a WHERE clause; validates that the current user can access the fields used in conditions (returns an exception if not).
- `constructor(objectType, condition)` - objectType String (object queried); condition Condition.
- `build()` - builds the condition (use `await`); checks field access.
```javascript
await new ConditionBuilder(
   "Account",
   new FieldCondition("Name", "=", "sForce")
).build()
// Returns: "Name = 'sForce'"
```

### ConditionEnhancedBuilder
Same purpose; **use only with `db.bulkQuery`**; does not validate field access.
- `constructor(objectType, condition)`
- `build()` - returns an object with a SOQL string and a map of fields per object.
```javascript
await new ConditionEnhancedBuilder(
   "Account",
   new FieldCondition("Name", "=", "sForce")
).build()
/** Returns: { soqlString: "Name = 'sForce'", fieldNamesByObjectNames: {"Account": ["Name"]} } */
```

### OperatorCondition (extends Condition)
Super class for specific conditions.
- `constructor(field, operator)` - field String; operator String. (The page's parameter table also lists a third row `value` Array or Query - an inconsistency in the docs; the constructor signature is `(field, operator)`.)
- `getRequiredFields(objectType)` - objectType String.
- `toSoql()`

### FieldCondition (extends OperatorCondition)
- `constructor(field, operator, value)` - field String; operator String; value String ("A null value is supported for the = and != operators").
- `toSoql()`
```javascript
await new ConditionBuilder("Inquiry", new FieldCondition("Type", "=", "MedicalInquiry")).build()
// Returns: "Type = 'MedicalInquiry'"
```
(Other examples pass a boolean: `new FieldCondition("IsPrimaryProvider", "=", true)`.)

### DateFieldCondition (extends FieldCondition)
- `constructor(dateField, operator, dateValue)` - dateField String; operator String; dateValue Date.
- `toSoql()`
```javascript
await new ConditionBuilder(
    "HealthcareProvider",
    new DateFieldCondition("InitialStartDate", "=", new Date())
).build()
// Returns: "InitialStartDate = 2024-08-12"
```

### DateTimeFieldCondition (extends FieldCondition)
- `constructor(dateTimeField, operator, dateTimeValue)` - String, String, Date.
- `toSoql()`
```javascript
await new ConditionBuilder(
    "Inquiry",
    new DateTimeFieldCondition("CreatedDate", "=", new Date())
).build()
// Returns: "CreatedDate = 2024-08-12T12:47:55.594Z"
```

### SetCondition (extends OperatorCondition)
Field whose value is in a specified range.
- `constructor(field, operator, values)` - field String; operator String; values Array or Query (array of values, or a Query instance as subquery).
- `getRequiredFields(objectType)`
- `toSoql()`
```javascript
await new ConditionBuilder(
   "Inquiry",
   new SetCondition("Type", "IN", ["MedicalInquiry", "ProductInformation"])
).build()
// Returns: "Type IN ('MedicalInquiry','ProductInformation')"
```

### GroupCondition (extends Condition)
- `constructor(nestingOperator)` - String, `AND` or `OR`.
- `add(condition)` - Condition; returns the group (chainable in examples).
- `getRequiredFields(objectType)`
- `toSoql()`
```javascript
await new ConditionBuilder(
    "HealthcareProvider",
    new GroupCondition("AND")
        .add(new FieldCondition("Status", "=", "Active"))
        .add(new FieldCondition("IsPrimaryProvider", "=", true))
).build()
// Returns: "(Status = 'Active') AND (IsPrimaryProvider = true)"
```

### AndCondition (extends GroupCondition)
- `constructor()` - GroupCondition with AND.  `toSoql()`
```javascript
await new ConditionBuilder(
    "HealthcareProvider",
    new AndCondition()
        .add(new FieldCondition("Status", "=", "Active"))
        .add(new FieldCondition("IsPrimaryProvider", "=", true))
).build()
// Returns: "(Status = 'Active') AND (IsPrimaryProvider = true)"
```

### OrCondition (extends GroupCondition)
- `constructor()` - GroupCondition with OR.  `toSoql()`
```javascript
await new ConditionBuilder(
    "HealthcareProvider",
    new OrCondition()
        .add(new FieldCondition("Status", "=", "Active"))
        .add(new FieldCondition("IsPrimaryProvider", "=", true))
).build()
// Returns: "(Status = 'Active') OR (IsPrimaryProvider = true)"
```

### Query
"Only use the Query class as a subquery of SetCondition. To build a complex WHERE clause, pass SetCondition to ConditionBuilder."
- `constructor()` - empty Query.
- `select(field)` - String; only ONE field; returns Query.
- `from(sObjectType)` - String; returns Query.
- `where(condition)` - Condition; returns Query.
- `getRequiredFields()` - **desktop only; does not work on mobile**.
- `toSoql()`
```javascript
await new ConditionBuilder(
    "Account",
    new SetCondition(
        "Id", "IN",
        new Query().select("AccountId").from("Visit").where(new FieldCondition("Status", "=", "Planned"))
    )
).build();
// Returns: "Id IN (SELECT AccountId FROM Visit WHERE Status = 'Planned')"
```

**Important:** the docs document `GroupCondition`, `OperatorCondition`, `Condition` as classes, but a repo note says `GroupCondition` is not an injected global for scripts **[repo-only: SKILL.md, "confirmed against businessRuleValidator/objectInitialization.js"]**. Official docs' own example uses `new GroupCondition("AND")`. Prefer `AndCondition`/`OrCondition` which the repo confirms are injected. `_noNs` class variants (`ConditionBuilder_noNs`, `FieldCondition_noNs`, etc.) are **[repo-only]**.

---

## 5. Functions

Source: `lsc_custom_scripts_functions` (the 264 page lists only one function; its intro also mentions "namespace management" and "retrieving metadata about available fields", but no such functions have pages in 264).

### enableAccessErrors()
"Enables returning exceptions in the custom script." No parameters, no return documented. Behavior (best practices): if `enableAccessErrors()` is called before a function that retrieves field values, that function throws a JavaScript error for an inaccessible field. If uncaught: desktop - users see only a field access error for checklist and validation scripts; mobile - users see a field access error for checklist scripts, but validation scripts fail.

### Context data (`record.getContextData()`) in VAV (from the official example and best practices)
- Returns an object or JSON string (the example `parseContextData` handles both, including Proxy objects, and returns `{}` on error).
- Web keys: `FieldName.VisitId` (e.g. `ProductDisbursement.VisitId`); mobile keys: plain object names (e.g. `ProductDisbursement`). The example helper `getFieldData(contextData, baseFieldName)` tries both.
- Web has `contextData["ProviderVisit"]` (used to detect web); mobile does not.
- Field-name case can be lowercase on mobile; normalize casing.
- Data for the visit can be only in memory: process contextData; reserve `db.query` for data not modified in the visit (e.g. Account record type).

---

## 6. Best practices, testing, troubleshooting

### 6.1 Best practices (`lsc_custom_scripts_best_practices`)
- Database queries are synchronous on mobile, asynchronous on desktop: enclose each validation in an `async` function.
- Always specify fields in queries (performance); filter in JavaScript rather than making multiple WHERE-clause queries.
- Use try/catch in every validation function, otherwise on JS errors validation rules don't show in the UI.
- Test on both desktop and mobile.
- Custom Settings created in Setup are not downloaded/evaluated on mobile: bypass logic via Custom Settings works on web and fails silently on mobile; Custom Permissions in validation formulas don't trigger on mobile; server-side validation rules on Visit aren't enforced during iPad submission. Enforce all validation and bypass in a client-side Visit Validation Script using only on-device data; use `record.getContextData` for related records; field names can be lowercase on mobile.

Official async example (verbatim):
```javascript
(() => {
    async function inquiryQuestionsValidation() {
        try {
            let inquiryQuestions = await db.query(
                "InquiryQuestion",
                await new ConditionBuilder(
                    "InquiryQuestion",
                    new FieldCondition("InquiryId", "=", getRecordId(record))
                ).build(),
                ["Id", "Name"]
            );

            if (
                inquiryQuestions === null ||
                inquiryQuestions === undefined ||
                inquiryQuestions.length === 0
            ) {
                return {
                    title: "No Inquiry Questions Found",
                    status: "error",
                };
            }

            return {
                title: "Inquiry Questions Added",
                status: "success",
            }

        } catch(error) {
            return {
                title: "Caught Exception During Inquiry Questions Validation",
                status: "error"
            }
        }
    }

    function getRecordId(record) {
        let recordId = record.stringValue("Id");
        return recordId ? recordId : record.stringValue("uid");
    }

    return [inquiryQuestionsValidation()];
})();
```

### 6.2 Testing (`lsc_custom_scripts_test`, `lsc_custom_script_test_example`)
Write Jest tests. Load the script file, wrap with `new Function(<globals...>, 'return ' + content)`, pass mocks of every global/class the script uses (otherwise tests fail), await `Promise.all(returnedArray)`, assert.
```javascript
const scriptContent = fs.readFileSync(path.resolve(__dirname, '../inquiryQuestionsValidation.js'));
const scriptFunction = new Function('env', 'record', 'db', 'ConditionBuilder', 'FieldCondition', `return ${scriptContent.toString()}`);

const mockEnv = { getOption: jest.fn() };
const mockDb = { query: jest.fn() };
const mockRecord = { stringValue: jest.fn() };
const mockConditionBuilder = jest.fn().mockImplementation(() => ({
    build: jest.fn().mockResolvedValue({}),
}));
const mockFieldCondition = jest.fn();

mockDb.query.mockResolvedValue([{ Id: '1', Name: 'Question 1' }]);
const promiseArray = scriptFunction(mockEnv, mockRecord, mockDb, mockConditionBuilder, mockFieldCondition);
const result = await Promise.all(promiseArray);
expect(result).toEqual([{ title: 'Inquiry Questions Added', status: 'success' }]);
```
The full documented suite has three tests (questions exist -> success; `[]` -> `No Inquiry Questions Found` error; `mockRejectedValue(new Error('Error'))` -> `Caught Exception During Inquiry Questions Validation` error).

### 6.3 Troubleshooting (`lsc_custom_scripts_troubleshoot`)
- Use Chrome DevTools. Console tab: `console.log()`, `console.warn()`, `console.error()` output from scripts; filter by Error/Warning/Info. Network tab: inspect requests/responses for async calls (headers, payload, Response tab).
- Note: before Summer '26, `db.query` with a custom object API name ending `__c` or `__mdt` had the managed namespace `lsc4se__` prepended (e.g. `My_Validation_Bypass__mdt` -> `lsc4se__My_Validation_Bypass__mdt`, which failed). Summer '26 added `db.noNs_query(entity, whereClause)`; use it until the mobile app is upgraded to Summer '26.
- `env.log(msg)` logs to the browser console with prefix `JS LOG: `.

---

## 7. Visit Action Validation example scripts

Source: `lsc_custom_scripts_example_visit_action_validation_script` (index), `lsc_custom_scripts_visit_data_example`, `lsc_custom_scripts_visit_limits_example`.

### 7.1 Visit data example: rules

| Rule | Use | Triggers | Error message | On success |
|---|---|---|---|---|
| atLeastOneSampleIsRequired | at least one sample (ProductDisbursement) | always | At least one sample must be added to the visit. | shows number of samples |
| atLeastOneDetailAndSampleAreRequired | sample and detailed product (ProviderVisitProdDetailing) | always | At least one sample and detailed product must be added to the visit. | counts |
| atLeastOneMessageIsRequiredForEachVisitDetail | each detailed product has a message | user has Field Sales Representative profile or channel In-Person | At least one message is required for each detailed product when the channel is 'In-Person' and the user has a 'Field Sales Representative' profile | skips other profiles / non in-person |
| specificSampleDependencyCheck | if a product selected, required others also | when samples exist | If <product1> is added to a visit, <product2> must also be added. | n/a |
| isAtLeastOneHCP | HCO visit needs at least one HCP attendee | Institution accounts only | At least one HCP (Healthcare Professional) must be associated when creating a visit for an HCO (Healthcare Organization). | skips Person Accounts |
| isMoreThanOneHCO | only one HCO attendee per call | always | Only 1 HCO (Healthcare Organization) attendee can be added per visit. | count |

Helpers: `getActionName(env)` (runs only for Submit, Sign, Save), `parseContextData(record)`, `getFieldData(contextData, baseFieldName)`.

Considerations (verbatim intent): data can be only in memory - use contextData; reserve `db.query` for unmodified data (e.g. Account record type); context data differs between mobile and web (`getFieldData`); reps can't read Profile - use `UserAdditionalInfo.ProfileIdentifier`.

### 7.2 Visit limits example (summary; the fetched page repeats overlapping chunks so it is not reproduced verbatim)

Three rules: `perRepVisitLimit` (default eligible actions Submit, Sign; error "This visit will exceed the <region> per-rep limit (no remaining)", warning "This visit will reach the <region> per-rep limit (last visit allowed)"), `perProductVisitLimit` (regional product variants roll up to a shared parent limit; same message pattern with product), `attendeeVisitLimits` (applies both to each child attendee visit; on Submit an attendee with no products inherits parent's products; messages prefixed with child visit label). Helpers: `rowField(row, apiName)` (API casing first, then lowercase on mobile), `formatLabelTranslation(key, defaultValue, args)` (resolves custom label with `{0}` substitution; on web returns a structured label object the framework unpacks; on mobile a pre-translated string; falls back to JS substitution), `labelResult(result, visitLabel)`. Script constants: `namespaceNeededForCustomObject = false`, `NAMESPACE = 'lsc4ce__'`, `ns(name)` helper (web: bare name; mobile: prefix when flag true); platform detection `isMobilePlatform` = `ctx['ProviderVisit'] === undefined`; defaults `DEFAULT_ALLOWED_ACTIONS = ['Submit','Sign']`, `DEFAULT_ACTIVE = true`; `actionsThatCloneParentProductDetailsToChildren = ['Submit']`. Read-only (never writes). Fetch the page `lsc_custom_scripts_visit_limits_example` directly for the full code.

### 7.3 Visit data example script (verbatim from `lsc_custom_scripts_visit_data_example`)

```javascript
(() => {

   // Platform detection flag - will be set in entry point
   let hasWebField = false;

   /**
    * Gets the action name from environment
    * @param {Object} env - JsEnv object for environment options
    * @returns {string} The action name or empty string
    */
   function getActionName(env) {
       try {
           if (env && typeof env.getOption === 'function') {
               return env.getOption('actionName') || '';
           }
           return '';
       } catch (error) {
           return '';
       }
   }

   // AccountDAO - Data Access Object for account-related operations
   var accountDao = (function () {
       var instance;
       var currentRecord;
       var isPersonAccount;
       var isInstitution;
       var childCallAccounts;
       var accountCache = new Map(); // Simple cache for account data

       // Helper functions for accountDao - moved inside closure to access currentRecord
       async function checkForPersonAccount() {
           let accountId = currentRecord.stringValue("AccountId");

           // If not found, try extracting directly from context data
           if (!accountId) {
               try {
                   const contextData = parseContextData(currentRecord);

                   // Try different possible locations for AccountId
                   accountId = contextData.ProviderVisit?.AccountId ||
                               contextData.Visit?.AccountId ||
                              contextData.AccountId ||
                              contextData.Account?.Id ||
                              contextData.Account;
               } catch (e) {
                   // Error accessing context data, continue with null accountId
                   accountId = null;
               }
           }

           if (!accountId) {
               return false; // Default to not person account if no account ID
           }

           try {
               let account = await selectAccountById(accountId);
               let result = account && account.length > 0 ? account[0].boolValue("IsPersonAccount") : false;
               return result;
           } catch (error) {
               return false; // Default to false on error
           }
       }

       async function checkForInstitution() {
           let accountId = currentRecord.stringValue("AccountId");
           // If not found, try extracting directly from context data
           if (!accountId) {
               try {
                   const contextData = parseContextData(currentRecord);

                   // Try different possible locations for AccountId
                   accountId = contextData.ProviderVisit?.AccountId ||
                             contextData.Visit?.AccountId||
                              contextData.AccountId ||
                              contextData.Account?.Id ||
                              contextData.Account;
               } catch (e) {
                   // Error accessing context data, continue with null accountId
               }
           }

           if (!accountId) {
               return false; // Default to not institution if no account ID
           }

           try {
               let account = await selectAccountById(accountId);
               let isPersonAccount = account && account.length > 0 ? account[0].boolValue("IsPersonAccount") : false;

               // If it's not a Person Account, then it's a Business Account (HCO)
               let result = !isPersonAccount;
               return result;
           } catch (error) {
               return false; // Default to false on error
           }
       }

       async function selectChildCallAccountsById() {
           // Extract attendee account IDs directly from the JSON data
           // The attendee data is in the Visit.ParentVisitId array in the JSON

           // Get the data from the current record context
           let contextData;
           try {
               contextData = parseContextData(currentRecord);
           } catch (error) {
               return [];
           }

           // Extract attendee account IDs from Visit.ParentVisitId array
           const attendeeVisits = contextData?.["Visit.ParentVisitId"] || contextData?.["ChildVisit"];

           if (!Array.isArray(attendeeVisits) || attendeeVisits.length === 0) {
               return [];
           }

           // Extract AccountIds from the attendee visits
           const attendeeAccountIds = attendeeVisits
               .map(visit => visit.AccountId || visit.accountid)  // Try PascalCase first, then lowercase
               .filter(accountId => accountId);

           if (attendeeAccountIds.length === 0) {
               return [];
           }

           // Query the Account records for these IDs
           let result = await db.query(
               "Account",
               await new ConditionBuilder(
                   "Account",
                   new SetCondition("Id", "IN", attendeeAccountIds)
               ).build(),
               ["Id", "Name", "IsPersonAccount"]
           );

           return result || [];
       }

       function getRecordId(record) {
           return record ? record.stringValue("Id") : null;
       }

       async function selectAccountById(accountId) {
           // Check cache first
           if (accountCache.has(accountId)) {
               return accountCache.get(accountId);
           }

           // If not in cache, query database
           let accounts = await db.query(
               "Account",
               await new ConditionBuilder(
                   "Account",
                   new FieldCondition("Id", "=", accountId)
               ).build(),
               ["Id", "Name", "IsPersonAccount"]
           );

           // Cache the result
           accountCache.set(accountId, accounts);

           return accounts;
       }

       var initialize = async function(record) {
           currentRecord = record;
           // Clear cache for new record context
           accountCache.clear();
           isPersonAccount = await checkForPersonAccount();
           isInstitution = await checkForInstitution();
           childCallAccounts = await selectChildCallAccountsById();
       };

       var getIsPersonAccount = function () {
           return isPersonAccount;
       };

       var getIsInstitution = function () {
           return isInstitution;
       };

       var getChildCallAccounts = function () {
           return childCallAccounts;
       };

       var createInstance = function () {
           return {
               initialize: initialize,
               getIsPersonAccount: getIsPersonAccount,
               getChildCallAccounts: getChildCallAccounts,
               getIsInstitution: getIsInstitution,
           };
       };

       return {
           getInstance: function () {
               return instance || (instance = createInstance());
           },
       };
   })();

   // Main function that businessRuleValidator calls
   async function validateVisit() {
       try {
           if (!record) {
               return [{
                   title: "Error in validation",
                   status: "error",
                   error: "No record provided"
               }];
           }

           // Use the properly provided business rule parameters from outer scope
           const validationResults = await runValidation();

           // Platform-specific handling: Web uses Promise.all(), Mobile doesn't
           let resolvedResults;
           if (hasWebField) {
               // Web platform - use Promise.all() to resolve all promises
               resolvedResults = await Promise.all(validationResults);
           } else {
               // Mobile platform - use validationResults directly
               resolvedResults = validationResults;
           }

           // Ensure we always return an array
           const finalResults = Array.isArray(resolvedResults) ? resolvedResults : [resolvedResults];
           return finalResults;
       } catch (error) {
           return [{
               title: "Error in validation",
               status: "error",
               error: error.message
           }];
       }
   }

   // Function to run the validation with data from outer scope
   async function runValidation() {

       // Initialize accountDao with the proper record object (JsDbObject)
       await accountDao.getInstance().initialize(record);

       // Always validate in this version
       const isValidationRequired = true;

       // Only run validations if needed
       let validationResults = [];
       if (isValidationRequired) {
           // Array of validation functions to run
           // Add new validation functions to this array
           const validationFunctions = [
               atLeastOneSampleIsRequired,
               atLeastOneDetailAndSampleAreRequired,
               atLeastOneMessageIsRequiredForEachVisitDetail,
               specificSampleDependencyCheck,
               isAtLeastOneHCP,
               isMoreThanOneHCO,
               // Add new validation functions here one at a time
               // Example: validateSampleType,
               // Example: validateComplianceAgreement,
           ];

           // Run all validation functions (handling both sync and async)

           validationResults = validationFunctions.map((validationFn, index) => {
               try {
                   // Call validation functions - they access record, user, db, env from outer scope
                   const result = validationFn();
               // If the result is a Promise, return it as is for Promise.all
               if (result && typeof result.then === 'function') {
                   return result.then(asyncResult => {
                       return asyncResult;
                   }).catch(error => {
                       return {
                           title: `Error in ${validationFn.name}: ${error.message}`,
                           status: "error",
                           error: error.message
                       };
                   });
               }
               return result;
           } catch (error) {
               return {
                   title: `Error in ${validationFn.name}: ${error.message}`,
                   status: "error",
                   error: error.message
               };
           }
           });

           } else {
               // Default return when validation is not required
               validationResults = [{
                   title: "Validation not required",
                   status: "success"
               }];
           }
       return validationResults;
   }

   // Helper function to get context data safely
   function parseContextData(record) {
       try {
           if (!record || typeof record.getContextData !== 'function') {
               return {};
           }

           const contextData = record.getContextData();

           // Handle different return types from getContextData()
           if (typeof contextData === 'string') {
               // If it's a JSON string, parse it
               return JSON.parse(contextData);
           } else if (typeof contextData === 'object' && contextData !== null) {
               // If it's already an object (including Proxy), use it directly
               return contextData;
           } else {
               return {};
           }
       } catch (error) {
           return {};
       }
   }

   /**
    * Helper function to get field data with web/mobile fallback
    * Web uses nested field paths (e.g., "ObjectName.VisitId")
    * Mobile uses simple field names (e.g., "ObjectName")
    *
    * @param {Object} contextData - The context data object
    * @param {string} baseFieldName - The base field name (e.g., "ProductDisbursement")
    * @returns {*} The field data from web or mobile field, or undefined
    */
   function getFieldData(contextData, baseFieldName) {
       const webField = `${baseFieldName}.VisitId`;
       const mobileField = baseFieldName;
       return contextData?.[webField] || contextData?.[mobileField];
   }

   // Validation rule: at least one sample is required
   function atLeastOneSampleIsRequired() {
       let hasSamples = false;
       let sampleCount = 0;

       try {
           // Get context data from the record object (from outer scope)
           const contextData = parseContextData(record);
           // Use helper to get field data with web/mobile fallback
           const sampleData = getFieldData(contextData, "ProductDisbursement") || null;

           // Handle Proxy arrays properly
           if (sampleData) {
               try {
                   // Try to get length property (works for both arrays and Proxy arrays)
                   sampleCount = sampleData.length || 0;
                   hasSamples = sampleCount > 0;

               } catch (lengthError) {
                   // Handle Proxy length access error
                   // Fallback: check if object has any enumerable properties
                   try {
                       const keys = Object.keys(sampleData);
                       hasSamples = keys.length > 0;
                       sampleCount = keys.length;
                   } catch (keysError) {
                       // Error getting keys - graceful fallback
                       hasSamples = false;
                       sampleCount = 0;
                   }
               }
           }
       } catch (e) {
           // Handle validation error gracefully
           hasSamples = false;
           sampleCount = 0;
       }

       return {
           title: hasSamples ?
               `Found ${sampleCount} sample(s)` :
               "At least one sample must be added to the visit.",
           status: hasSamples ? "success" : "error"
       };
   }

   // Validation rule: at least one detail and sample are required
   function atLeastOneDetailAndSampleAreRequired() {
       try {
           const contextData = parseContextData(record);

           // Use helper to get field data with web/mobile fallback
           const productDisbursementData = getFieldData(contextData, "ProductDisbursement");
           const providerVisitProdDetailingData = getFieldData(contextData, "ProviderVisitProdDetailing");

           // Handle Proxy arrays properly for both fields
           let sampleCount = 0;
           let detailCount = 0;
           let hasProductDisbursement = false;
           let hasProviderVisitProdDetailing = false;

           // Check product disbursement
           if (productDisbursementData) {
               try {
                   sampleCount = productDisbursementData.length || 0;
                   hasProductDisbursement = sampleCount > 0;
               } catch (e) {
                   // Error accessing length property
                   const keys = Object.keys(productDisbursementData || {});
                   sampleCount = keys.length;
                   hasProductDisbursement = sampleCount > 0;
               }
           }

           // Check provider visit prod detailing
           if (providerVisitProdDetailingData) {
               try {
                   detailCount = providerVisitProdDetailingData.length || 0;
                   hasProviderVisitProdDetailing = detailCount > 0;
               } catch (e) {
                   // Error accessing length property - try Object.keys fallback
                   const keys = Object.keys(providerVisitProdDetailingData);
                   detailCount = keys.length;
                   hasProviderVisitProdDetailing = detailCount > 0;
               }
           }

           if (hasProductDisbursement && hasProviderVisitProdDetailing) {
               return {
                   title: `Found ${sampleCount} sample(s) and ${detailCount} detailed product(s)`,
                   status: "success"
               };
           }

           return {
               title: "At least one sample and detailed product must be added to the visit.",
               status: "error"
           };
       } catch (e) {
           return {
               title: "At least one sample and detailed product must be added to the visit.",
               status: "error",
               error: e.message
           };
       }
   }

   // Validation rule: at least one message is required for each visit detail
   async function atLeastOneMessageIsRequiredForEachVisitDetail() {
       try {
           let userId;

           // Try to get user Id from user (from outer scope)
           if (user) {
               try {
                   userId = user.stringValue('Id');
               } catch (error) {
                   // Try alternative access methods
                   userId = user.Id || user["Id"];
                   if (!userId) {
                       // Error accessing userId, continue with fallback
                   }
               }
           }

           if (!userId) {
               return {
                   title: 'Profile validation skipped - no userId available',
                   status: "success",
               };
           }

           // As rep user don't have access to User.ProfileId and Profile table
           // we can only check by ProfileIdentifier in UserAdditionalInfo
           //Please replace the Profile_Id with the id of the profile you want to apply this validation
           let targetProfileId = 'Profile_Id';
           let userAdditionalInfoResults;
           let isFieldSalesRep = false;

           try {
               userAdditionalInfoResults = await db.query(
                   "UserAdditionalInfo",
                   await new ConditionBuilder(
                       "UserAdditionalInfo",
                       new FieldCondition("UserId", "=", userId)
                   ).build(),
                   ["Id", "ProfileIdentifier"]
               );

               if (userAdditionalInfoResults && userAdditionalInfoResults.length > 0) {
                   const profileId = userAdditionalInfoResults[0].stringValue('ProfileIdentifier');
                   isFieldSalesRep = profileId === targetProfileId;
               } else {
                   return {
                       title: 'Profile validation skipped - profile not found',
                       status: "success",
                   };
               }

           } catch (error) {
               return {
                   title: 'Profile validation skipped - unable to query profile',
                   status: "success",
               };
           }

           if (!isFieldSalesRep) {
               return {
                   title: `Profile validation skipped - user is not Field Sales Representative`,
                   status: "success",
               };
           }

           // Get visit context data from the record object
           const visitData = parseContextData(record);

           // Check if channel is "In-Person"
           const visitChannel = visitData?.Visit?.channel || visitData?.ProviderVisit?.Channel || '';

           if (visitChannel !== "In-Person") {
               return {
                   title: `Message validation skipped - visit channel is "${visitChannel}", not "In-Person"`,
                   status: "success",
               };
           }

           // Check if we have visit details to validate
           // Use helper to get field data with web/mobile fallback
           const visitDetails = getFieldData(visitData, "ProviderVisitProdDetailing");

           if (!Array.isArray(visitDetails) || visitDetails.length === 0) {
               return {
                   title: 'Message validation passed - no visit details to validate',
                   status: "success"
               };
           }

           // Validate each visit detail has at least one message
           let detailsWithoutMessages = [];

           visitDetails.forEach((detail, index) => {
               // Use helper to get field data with web/mobile fallback
               const messages = getFieldData(detail, "ProviderVisitDtlProductMsg");
               const hasMessages = Array.isArray(messages) && messages.length > 0;

               if (!hasMessages) {
                   const detailInfo = {
                       index: index + 1,
                       productId: detail?.productid || 'Unknown Product',
                       uid: detail?.uid || 'Unknown Detail'
                   };
                   detailsWithoutMessages.push(detailInfo);
               }
           });

           // Set validation result
           if (detailsWithoutMessages.length > 0) {
               return {
                   title: "At least one message is required for each detailed product when the channel is 'In-Person' and the user has a 'Field Sales Representative' profile.",
                   status: "error"
               };
           } else {
               return {
                   title: `All ${visitDetails.length} detailed products have messages - Field Sales Rep In-Person validation passed`,
                   status: "success"
               };
           }

       } catch (error) {
           return {
               title: "At least one message is required for each detailed product when the channel is 'In-Person' and the user has a 'Field Sales Representative' profile.",
               status: "error",
               error: error.message
           };
       }
   }

   /**
    * The rule 'specificSampleDependencyCheck' blocks the user from submitting a visit.
    * Validation: If sample "Immunexis 10mg" is selected,
    * then "ADRAVIL Sample Pack 5mg" must also be selected.
    * @returns result { title: string, status: "success" | "error" };
    */
   async function specificSampleDependencyCheck() {

       try {
           // Get visit context data from record (from outer scope)
           let visitData = parseContextData(record);

           // Check if we have samples to validate
           // Use helper to get field data with web/mobile fallback
           let samples = getFieldData(visitData, "ProductDisbursement");

           // Handle Proxy arrays properly
           let samplesCount = 0;
           let isValidSamples = false;

           if (samples) {
               try {
                   samplesCount = samples.length || 0;
                   isValidSamples = samplesCount > 0;
               } catch (e) {
                   // Error accessing samples length
                   const keys = Object.keys(samples || {});
                   samplesCount = keys.length;
                   isValidSamples = samplesCount > 0;
               }
           }

           if (!isValidSamples) {
               return {
                   title: 'Sample dependency validation passed - no samples to validate',
                   status: "success"
               };
           }

           // Get all product item IDs from samples
           let productItemIds = [];
           try {
               if (samples && typeof samples === 'object') {
                   // Handle both array and Proxy array
                   for (let i = 0; i < samplesCount; i++) {
                       try {
                           const sample = samples[i];

                           if (sample) {
                               const productItemId = sample.ProductItemId || sample.productitemid
                               productItemIds.push(productItemId);
                           }
                       } catch (sampleError) {
                           // Error accessing sample
                       }
                   }
               }
           } catch (mappingError) {
               // Error mapping product item IDs
           }

           if (productItemIds.length === 0) {
               return {
                   title: 'Sample dependency validation passed - no product item IDs found',
                   status: "success"
               };
           }

           // Query ProductItem to get Product2Id
           let productItems = await db.query(
                  "ProductItem",
                  await new ConditionBuilder(
                    "ProductItem",
                    new SetCondition("Id", "IN", productItemIds)
                  ).build(),
                  ["Id", "Product2Id"]
                );

           // Extract Product2Ids and create a map of productItemId to Product2Id
           let product2Ids = [];
           let productItemToProduct2Map = new Map();

           if (productItems && Array.isArray(productItems)) {
               productItems.forEach(item => {
                   const productItemId = item.stringValue("Id");
                   const product2Id = item.stringValue("Product2Id");

                   if (product2Id) {
                       product2Ids.push(product2Id);
                       productItemToProduct2Map.set(productItemId, product2Id);
                   }
               });
           }

           // Query Product2 to get product names
           let product2Items = await db.query(
                  "Product2",
                  await new ConditionBuilder(
                    "Product2",
                    new SetCondition("Id", "IN", product2Ids)
                  ).build(),
                  ["Id", "Name"]
                );

           // Create a map of Product2Id to Name
           let product2NameMap = new Map();
           if (product2Items && Array.isArray(product2Items)) {
               product2Items.forEach(item => {
                   const id = item.stringValue("Id");
                   const name = item.stringValue("Name");
                   product2NameMap.set(id, name);
               });
           }

           // Create a map of productItemId to ProductName (via Product2)
           let itemToProductNameMap = new Map();
           productItemToProduct2Map.forEach((product2Id, productItemId) => {
               const productName = product2NameMap.get(product2Id);
               if (productName) {
                   itemToProductNameMap.set(productItemId, productName);
               }
           });

           // Get all sample names for the current visit
           let sampleNames = [];
           try {
               if (samples && typeof samples === 'object') {
                   // Handle both array and Proxy array for sample names
                   for (let i = 0; i < samplesCount; i++) {
                       try {
                           const sample = samples[i];
                           if (sample) {
                               const productItemId = sample.ProductItemId || sample.productitemid;
                               const productName = itemToProductNameMap.get(productItemId) || '';
                               if (productName) {
                                   sampleNames.push(productName);
                               }
                           }
                       } catch (sampleError) {
                           // Error accessing sample for name mapping
                       }
                   }
               }
           } catch (nameMappingError) {
               // Error mapping sample names
           }

           // Check if Immunexis 10mg is present
           const targetSample = "Immunexis 10mg";
           const requiredSample = "ADRAVIL Sample Pack 5mg";
           let hasImmunexis = sampleNames.includes(targetSample);

           if (hasImmunexis) {
               // If Immunexis is present, check if ADRAVIL is also present
               let hasAdravil = sampleNames.includes(requiredSample);

               if (!hasAdravil) {
                   return {
                       title: "If Immunexis 10mg is added to a visit, ADRAVIL Sample Pack 5mg must also be added. However, ADRAVIL Sample Pack 5mg can be added without Immunexis 10mg.",
                       status: "error"
                   };
               } else {
                   return {
                       title: "Sample dependency validation passed - both Immunexis 10mg and ADRAVIL Sample Pack 5mg present",
                       status: "success"
                   };
               }
           } else {
               return {
                   title: "Sample dependency validation passed - no Immunexis 10mg found",
                   status: "success"
               };
           }

     } catch (error) {
           // Error in specificSampleDependencyCheck
           // In case of database error, we might want to pass validation or handle differently
           // For now, we'll pass the validation to avoid blocking the user due to technical issues
           return {
               title: "Sample dependency validation passed - technical error occurred",
               status: "success"
           };
       }
   }

   /**
    * The rule 'isAtLeastOneHCP' blocks the user from submitting a call.
    * Validation: Require at least one HCP (Person Account) for a HCO (Institution Account) call on Submit.
    * @returns result { title: string, status: "success" | "error" };
    */
   async function isAtLeastOneHCP() {
       try {

           // Log current account details from record (from outer scope)
           const currentAccountId = record.stringValue("AccountId");

           // Use accountDao to check if current account is a Person Account
           let isPersonAccount = await accountDao.getInstance().getIsPersonAccount();
           let isInstitution = await accountDao.getInstance().getIsInstitution();

           if (isPersonAccount) {
               // This is already a Person Account (HCP), so requirement is met
               return {
                   title: "HCP validation passed - current account is a Person Account (HCP)",
                   status: "success"
               };
           }

           // Only apply HCP validation to Institution accounts
           if (!isInstitution) {
               return {
                   title: "HCP validation skipped - account is not an Institution Account",
                   status: "success"
               };
           }

           // This is an Institution Account, check for HCP attendees
           let childCallAccounts = await accountDao.getInstance().getChildCallAccounts();

           let isRequirementValid = false;
           let hcpAttendees = [];
           let nonHcpAttendees = [];

           if (Array.isArray(childCallAccounts) && childCallAccounts.length > 0) {
               // Check if any attendee is a Person Account (HCP)
               for (let i = 0; i < childCallAccounts.length; i++) {
                   let attendee = childCallAccounts[i];
                   let attendeeIsPersonAccount = attendee.boolValue("IsPersonAccount");
                   let attendeeName = attendee.stringValue("Name") || attendee.stringValue("Id");

                   if (attendeeIsPersonAccount) {
                       isRequirementValid = true;
                       hcpAttendees.push(attendeeName);
                   } else {
                       nonHcpAttendees.push(attendeeName);
                   }
               }
           }

           // Add more descriptive message based on the scenario
           if (!isRequirementValid) {
               return {
                   title: "At least one HCP (Healthcare Professional) must be associated when creating a visit for an HCO (Healthcare Organization).",
                   status: "error"
               };
           } else {
               return {
                   title: `HCP validation passed - Institution Account with ${hcpAttendees.length} HCP attendee(s): ${hcpAttendees.join(', ')}`,
                   status: "success"
               };
           }

     } catch (error) {
           // Error in isAtLeastOneHCP
           // In case of error, fail the validation to be safe
           return {
               title: "HCP validation failed - error occurred during validation",
               status: "error",
               error: error.message
           };
       }
   }

   /**
    * The rule 'isMoreThanOneHCO' blocks user from submitting a call.
    * Validation: Restrict to one HCO (Institution Account) attendee per Call.
    * @returns result { title: string, status: "success" | "error" };
    * Note: Expected only 1 HCO attendee per call)
    */
   async function isMoreThanOneHCO() {
           try {

               let counter = 0;
               let isPersonAccount = await accountDao.getInstance().getIsPersonAccount();
               let accsRelatedToChildCall = await accountDao.getInstance().getChildCallAccounts();

               let hcoAccounts = [];
               let hcpAccounts = [];

               if (isPersonAccount || accsRelatedToChildCall.length) {
                   for (let i = 0; i < accsRelatedToChildCall.length; i++) {
                       let relatedAcc = accsRelatedToChildCall[i];
                       let attendeeIsPersonAccount = relatedAcc.boolValue("IsPersonAccount");
                       let attendeeName = relatedAcc.stringValue("Name") || relatedAcc.stringValue("Id");

                       if (!attendeeIsPersonAccount) {
                           counter++;
                           hcoAccounts.push(attendeeName);
                       } else {
                           hcpAccounts.push(attendeeName);
                       }
                   }
               } else {
                   counter++;
               }

               const isValid = counter <= 1;

               if (!isValid) {
                   return {
                       title: "Only 1 HCO (Healthcare Organization) attendee can be added per visit.",
                       status: "error"
                   };
               } else {
                   return {
                       title: `HCO count validation passed - found ${counter} HCO account(s)`,
                       status: "success"
                   };
               }

       } catch (error) {
               // Error in isMoreThanOneHCO
               return {
                   title: "HCO count validation failed - error occurred during validation",
                   status: "error",
                   error: error.message
               };
           }
       }

   // Entry point: Check if proper parameters are provided
   if (record && user && env && db) {
       // Check action name - only run validation for specific actions
       const actionName = getActionName(env);
       const allowedActions = ['Submit', 'Sign', 'Save'];

       if (!allowedActions.includes(actionName)) {
           // Skip validation for other actions
           return [{
               title: `Validation skipped - action is "${actionName}"`,
               status: 'success'
           }];
       }

       // Platform detection: Check which field structure exists to determine wrapping behavior
       const contextData = parseContextData(record);

       // Web uses nested field paths (e.g., "ProviderVisit")
       // Mobile uses simple field names (e.g., "Visit")
       hasWebField = contextData?.["ProviderVisit"] !== undefined;

       // Wrap in array if using web platform, don't wrap for mobile
       const wrapAsArray = hasWebField;

       // Apply wrapping based on platform
       if (wrapAsArray) {
           // Web solution - wrap in array
           return [validateVisit()];
       } else {
           // Mobile solution - no wrapping
           return validateVisit();
       }
   }

   // If no parameters provided yet, return validation function wrapped in array
   return [validateVisit];
 })();
```

---

## 8. Machine-friendly completions

```json
[
 {
  "label": "env",
  "kind": "variable",
  "signature": "env",
  "doc": "Environment options, logging and custom-label formatting."
 },
 {
  "label": "db",
  "kind": "variable",
  "signature": "db",
  "doc": "Local/org database access; synchronous on mobile, asynchronous on desktop."
 },
 {
  "label": "record",
  "kind": "variable",
  "signature": "record",
  "doc": "The current record (field accessors, record type, context data)."
 },
 {
  "label": "user",
  "kind": "variable",
  "signature": "user",
  "doc": "The current user (field accessors)."
 },
 {
  "label": "getOption",
  "kind": "method",
  "parent": "env",
  "signature": "getOption(name)",
  "doc": "Returns an environment option: fromStatus, toStatus, fieldName, actionName."
 },
 {
  "label": "setOption",
  "kind": "method",
  "parent": "env",
  "signature": "setOption(name, value)",
  "doc": "Sets an environment option."
 },
 {
  "label": "log",
  "kind": "method",
  "parent": "env",
  "signature": "log(msg)",
  "doc": "Logs msg to the console with the prefix 'JS LOG: '."
 },
 {
  "label": "formatCustomLabel",
  "kind": "method",
  "parent": "env",
  "signature": "formatCustomLabel(key, defaultValue, argumentsList)",
  "doc": "Translates a custom label to the user's locale, substituting arguments; returns the value to use as title."
 },
 {
  "label": "rowById",
  "kind": "method",
  "parent": "db",
  "signature": "rowById(entity, id, selectedFields)",
  "doc": "Retrieves a record by Id. selectedFields (Array) is desktop only."
 },
 {
  "label": "rowsByEntity",
  "kind": "method",
  "parent": "db",
  "signature": "rowsByEntity(entity, selectedFields)",
  "doc": "Retrieves the records of an object. selectedFields is desktop only."
 },
 {
  "label": "query",
  "kind": "method",
  "parent": "db",
  "signature": "query(entity, whereClause, selectedFields)",
  "doc": "Retrieves records matching a SOQL WHERE clause (use ConditionBuilder.build()). selectedFields is desktop only."
 },
 {
  "label": "bulkQuery",
  "kind": "method",
  "parent": "db",
  "signature": "bulkQuery(queries)",
  "doc": "Runs several queries ({uniqueRequestKey, sObjectName, condition: ConditionEnhancedBuilder.build(), selectedFields}); returns results keyed by uniqueRequestKey."
 },
 {
  "label": "noNs_query",
  "kind": "method",
  "parent": "db",
  "signature": "noNs_query(entity, whereClause)",
  "doc": "Query without managed-namespace prefixing of __c/__mdt objects (Summer '26; only in the troubleshoot note)."
 },
 {
  "label": "stringValue",
  "kind": "method",
  "parent": "record",
  "signature": "stringValue(key)",
  "doc": "String field value if it exists and is readable."
 },
 {
  "label": "numValue",
  "kind": "method",
  "parent": "record",
  "signature": "numValue(key)",
  "doc": "Number field value if it exists and is readable."
 },
 {
  "label": "boolValue",
  "kind": "method",
  "parent": "record",
  "signature": "boolValue(key)",
  "doc": "Boolean field value if it exists and is readable."
 },
 {
  "label": "dateValue",
  "kind": "method",
  "parent": "record",
  "signature": "dateValue(key)",
  "doc": "Date field value if it exists and is readable."
 },
 {
  "label": "setValue",
  "kind": "method",
  "parent": "record",
  "signature": "setValue(key, value)",
  "doc": "Sets a field value on the current record."
 },
 {
  "label": "recordTypeName",
  "kind": "method",
  "parent": "record",
  "signature": "recordTypeName()",
  "doc": "Name of the record's record type, if any."
 },
 {
  "label": "getContextData",
  "kind": "method",
  "parent": "record",
  "signature": "getContextData()",
  "doc": "Visit context data (related in-memory records); used by official VAV example, not on the record reference page."
 },
 {
  "label": "stringValue",
  "kind": "method",
  "parent": "user",
  "signature": "stringValue(key)",
  "doc": "String field value of the user if readable."
 },
 {
  "label": "numValue",
  "kind": "method",
  "parent": "user",
  "signature": "numValue(key)",
  "doc": "Number field value of the user if readable."
 },
 {
  "label": "boolValue",
  "kind": "method",
  "parent": "user",
  "signature": "boolValue(key)",
  "doc": "Boolean field value of the user if readable."
 },
 {
  "label": "dateValue",
  "kind": "method",
  "parent": "user",
  "signature": "dateValue(key)",
  "doc": "Date field value of the user if readable."
 },
 {
  "label": "setValue",
  "kind": "method",
  "parent": "user",
  "signature": "setValue(key, value)",
  "doc": "Sets a field value on the user."
 },
 {
  "label": "Condition",
  "kind": "class",
  "signature": "new Condition()",
  "doc": "Abstract base class; do not use directly."
 },
 {
  "label": "ConditionBuilder",
  "kind": "class",
  "signature": "new ConditionBuilder(objectType, condition)",
  "doc": "Builds a WHERE clause, validating the user's field access. build() returns the clause (await it)."
 },
 {
  "label": "ConditionEnhancedBuilder",
  "kind": "class",
  "signature": "new ConditionEnhancedBuilder(objectType, condition)",
  "doc": "For db.bulkQuery only. build() returns {soqlString, fieldNamesByObjectNames}."
 },
 {
  "label": "OperatorCondition",
  "kind": "class",
  "signature": "new OperatorCondition(field, operator)",
  "doc": "Super class for field/set conditions."
 },
 {
  "label": "FieldCondition",
  "kind": "class",
  "signature": "new FieldCondition(field, operator, value)",
  "doc": "field operator value; null supported for = and !=."
 },
 {
  "label": "DateFieldCondition",
  "kind": "class",
  "signature": "new DateFieldCondition(dateField, operator, dateValue)",
  "doc": "Date comparison."
 },
 {
  "label": "DateTimeFieldCondition",
  "kind": "class",
  "signature": "new DateTimeFieldCondition(dateTimeField, operator, dateTimeValue)",
  "doc": "DateTime comparison."
 },
 {
  "label": "SetCondition",
  "kind": "class",
  "signature": "new SetCondition(field, operator, values)",
  "doc": "values: Array or Query subquery; e.g. IN."
 },
 {
  "label": "GroupCondition",
  "kind": "class",
  "signature": "new GroupCondition(nestingOperator)",
  "doc": "Group of conditions joined by AND or OR; add(condition)."
 },
 {
  "label": "AndCondition",
  "kind": "class",
  "signature": "new AndCondition()",
  "doc": "GroupCondition joined by AND."
 },
 {
  "label": "OrCondition",
  "kind": "class",
  "signature": "new OrCondition()",
  "doc": "GroupCondition joined by OR."
 },
 {
  "label": "Query",
  "kind": "class",
  "signature": "new Query()",
  "doc": "Subquery builder for SetCondition: select(field).from(sObjectType).where(condition)."
 },
 {
  "label": "build",
  "kind": "method",
  "parent": "ConditionBuilder",
  "signature": "build()",
  "doc": "Builds the condition."
 },
 {
  "label": "build",
  "kind": "method",
  "parent": "ConditionEnhancedBuilder",
  "signature": "build()",
  "doc": "Builds the condition."
 },
 {
  "label": "add",
  "kind": "method",
  "parent": "GroupCondition",
  "signature": "add(condition)",
  "doc": "Adds a condition to the group; returns the group."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "Condition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "OperatorCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "FieldCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "DateFieldCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "DateTimeFieldCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "SetCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "GroupCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "AndCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "OrCondition",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "toSoql",
  "kind": "method",
  "parent": "Query",
  "signature": "toSoql()",
  "doc": "Returns the SOQL fragment."
 },
 {
  "label": "getRequiredFields",
  "kind": "method",
  "parent": "Condition",
  "signature": "getRequiredFields(objectType)",
  "doc": "Fields the condition needs."
 },
 {
  "label": "getRequiredFields",
  "kind": "method",
  "parent": "OperatorCondition",
  "signature": "getRequiredFields(objectType)",
  "doc": "Fields the condition needs."
 },
 {
  "label": "getRequiredFields",
  "kind": "method",
  "parent": "SetCondition",
  "signature": "getRequiredFields(objectType)",
  "doc": "Fields the condition needs."
 },
 {
  "label": "getRequiredFields",
  "kind": "method",
  "parent": "GroupCondition",
  "signature": "getRequiredFields(objectType)",
  "doc": "Fields the condition needs."
 },
 {
  "label": "getRequiredFields",
  "kind": "method",
  "parent": "Query",
  "signature": "getRequiredFields()",
  "doc": "Desktop only; does not work on mobile."
 },
 {
  "label": "select",
  "kind": "method",
  "parent": "Query",
  "signature": "select(field)",
  "doc": "Sets the single selected field; returns Query."
 },
 {
  "label": "from",
  "kind": "method",
  "parent": "Query",
  "signature": "from(sObjectType)",
  "doc": "Sets the object; returns Query."
 },
 {
  "label": "where",
  "kind": "method",
  "parent": "Query",
  "signature": "where(condition)",
  "doc": "Sets the condition; returns Query."
 },
 {
  "label": "enableAccessErrors",
  "kind": "function",
  "signature": "enableAccessErrors()",
  "doc": "Makes field-access failures throw exceptions in the script."
 }
]
```

---

## 9. Contradictions and gaps vs. the repo skill (`skills/lsc-custom-scripts/SKILL.md`) and `knowledge/modules/custom-scripts/*.md`

1. **Type picklist value.** Dev guide lists `Checklist`, `MobilePageLayoutDataValidation`, `OrderValidation`, `Validation` - no `VisitActionValidation`. Skill says Type `VisitActionValidation` for VAV. Unverified: describe the field in the org before writing records. Studio's create/validation must not hard-code the value without checking the picklist.
2. **ObjectName / OperationEventType for VAV.** Skill: VAV requires `ObjectName = ProviderVisit` and `OperationEventType = OnUpdate`, otherwise it silently does not run. Official docs say none of this: Admin Console Type "Visit Action Validation" is all that is documented, and the dev guide ties `ObjectName`/`OperationEventType` to a "Mobile Page Layout Validation script" (Type `MobilePageLayoutDataValidation`). Possibly the skill is conflating two script kinds, or documenting what the Admin Console writes behind the scenes. Keep as org-verified rather than doc-verified.
3. **Which VAV runs.** Skill: if several VAV scripts exist the first by ID/creation date runs. Docs: "create only one visit action validation script per org" - no statement about which one runs.
4. **VAV trigger actions.** Skill table says "Sign or Submit". Docs: Save, Submit and Sign (Sign = digital and paper); also child visits and saves triggered by e.g. remote session start; not Withdraw. Support-engineering notes also say "Sign / Submit". Update.
5. **"Active".** Skill/notes imply stage assignment only; docs add: no Active field exists; VAV is active as soon as saved; deactivate by deleting.
6. **Stage wiring.** Support notes say "validation script custom script ID" column on a "Life Science Stage" record. Real object is `LifeSciStageObject` with `ValidationCustomScriptId` and `ChecklistCustomScriptId` (lookups to LifeScienceCustomScript); Admin Console label: Stage Objects > Edit > Validation Script / Checklist Script.
7. **CodeText.** Skill says read-only via API, Refresh only - confirmed by dev guide (no Create/Update). Support notes call the field `Code`; the API name is `CodeText`.
8. **Output statuses.** Skill table: checklist success = green check, validation success = not displayed, warning = dialog continuable, error blocks - consistent with docs. Docs add: for warning-only results users see all warnings in one window; errors take precedence over warnings.
9. **Injected classes.** Skill lists `_noNs` class variants and says `GroupCondition` is NOT injected; official docs document `GroupCondition`, `Condition`, `OperatorCondition` and use `new GroupCondition("AND")`. Docs do not document `_noNs` classes, `enableAccessErrors` as a "class" (it is a function), `getRecordType()`, `noNs_stringValue`, `noNs_rowById`, or `recordTypeName` beyond the record page. Prefer documented API; treat `_noNs`/`noNs_*` as org-verified runtime behavior. Docs mention only `db.noNs_query` (Summer '26+) and the old `lsc4se__` auto-prefix, whereas the support notes say `LSC4C__` prefix and the VAV example uses `lsc4ce__`: three different namespace strings across sources.
10. **Skill's `record` globals table** lists `getContextData()` as a `record` method - not on the official `record` page but used by the official VAV example; fine.
11. **Skill gotcha: `env.log()` goes to device logs on iPad.** Docs say only "browser console with the prefix JS LOG:". Docs recommend console.log/warn/error in Chrome DevTools for troubleshooting.
12. **Skill: guard `if (record && user && env && db)`** - matches the official VAV example's entry point; the official example also returns `[validateVisit]` (function not invoked) otherwise.
13. **Skill: "No comment blocks before the IIFE" / "large scripts crash"** - not in official docs (the official VAV example itself puts JSDoc comments inside the IIFE, never before it, consistent). Official placeholder `%@` vs `{0}` in `formatCustomLabel`: env page says `%@`, format page and limits example use `{0}`.
14. **Official-docs internal inconsistencies:** `OperatorCondition` constructor table lists a third `value` parameter although signature is `(field, operator)`; `FieldCondition.value` typed String but examples pass booleans; `formatCustomLabel` sample text omits commas; functions page promises namespace/field-metadata functions but documents only `enableAccessErrors`.
15. **LWC bundle contents.** No official page shows `js-meta.xml` content or confirms what exactly is copied into CodeText (see 1.4). The repo support notes (Workbench zip, `isExposed=false`, package.xml version 62.0) are training-session material, not official docs.
16. **Sharing/permissions.** Skill: LifeScienceCustomScript sharing defaults Private; docs only state the object has a `LifeScienceCustomScriptShare` and that admins need Life Sciences Commercial Admin. Support notes: user without read access to the script record -> script silently skipped. Not in official docs.

## 10. Verified in an org (demo org peter-lsc-260-trial, API 66)

Empirical findings that settle some of the contradictions above. They come from running against a real org, not from the official pages.

- `LifeScienceCustomScript.CodeText` is textarea(131072), NOT createable or updateable. `Name`, `ComponentName` (required), `Type` (required picklist), `OperationEventType`, `ObjectName`, `SourceSystemName` and `SourceSystemIdentifier` are createable and updateable.
- **Type picklist in the org: `Checklist`, `Validation`, `VisitActionValidation`.** This differs from the dev guide's four values (`MobilePageLayoutDataValidation` and `OrderValidation` are absent here). `VisitActionValidation` is real; the repo skill is right on that point and the dev guide is incomplete or version-specific. Always describe the field in the target org.
- `OperationEventType` values: `OnCreate`, `OnUpdate`, `OnDelete`.
- A headless LWC whose `.js` is only the IIFE `(() => { ... return [...]; })();`, plus a `js-meta.xml` with `isExposed=false`, deploys fine.
- Inserting a `LifeScienceCustomScript` record with `ComponentName` set fills `CodeText` from the LWC `.js`, trimmed.
- Redeploying the LWC does NOT change `CodeText`. Updating the record (even setting `ComponentName` to the same value) refreshes `CodeText` from the deployed LWC, the same as Admin Console Refresh. So Refresh is available through the API as a no-op update of the record.
- Stage object `LifeSciStageObject`: `ObjectName`, `ParentObjRelaFieldName`, `IsControlledByStagePath`, `ValidationCustomScriptId`, `ChecklistCustomScriptId` (lookups to `LifeScienceCustomScript`, updateable). Related: `LifeSciStagePath`, `LifeSciStageValue`, `LifeSciStageAction`, `LifeSciStageOperation`.

Effect on section 9: item 1 is resolved (`VisitActionValidation` is a valid Type value in the org). Items 2 and 3 (ObjectName/OperationEventType for VAV, which VAV runs) remain unverified by the docs. Item 7 is confirmed (CodeText not writable; refreshed from the LWC on record insert/update).
