---
name: lsc-db-schema
description: Manages Life Sciences Cloud (LSC) DB Schema records (mobile object metadata cache configuration). Use when user asks about DB Schema, DbSchema, mobile sync objects, SOQL filter conditions on DbSchema, enabling/disabling objects for mobile, object metadata cache settings, or which objects sync to iPad.
---

## How to Answer DB Schema Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| DB Schema concepts, field reference, pre-configured records | `search_lsc_knowledge({ query: "DB Schema mobile object sync" })` |
| Mobile metadata cache configuration | `get_lsc_module_docs({ module: "mobile-metadata-cache" })` |
| List all DB Schema records | `list_db_schema()` |
| Full details for a specific record | `get_db_schema({ name: "Visit" })` |
| Create a new DB Schema record | `create_db_schema({ objectName: "Product2" })` |
| Update a DB Schema record | `update_db_schema({ name: "Visit", whereSoql: "..." })` |
| Assign / unassign a profile | `update_db_schema({ name: "Visit", addProfiles: ["LS Rep"], removeProfiles: [...] })` — a rep only syncs tables assigned to their profile; "SObject X not found" on the iPad usually means the table isn't. Regenerate the cache after |
| Enable/disable a DB Schema record | `toggle_db_schema({ name: "Visit", active: false })` |
| Mobile cache status | `check_mobile_cache_status()` |

---

## Configuration Mode

When the user asks about DB Schema configuration, **ask them which mode they prefer**:

1. **Show me the documentation** — call `search_lsc_knowledge({ query: "DB Schema configuration" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
list_db_schema()
```

#### Step 2: Report Findings
Present the summary table. Include counts: total records, active, inactive, DATA type, CONFIGURATION type.

#### Step 3: Propose Changes
Based on the user's request, propose specific changes and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
Use the appropriate dedicated tool (`create_db_schema`, `update_db_schema`, `toggle_db_schema`).

#### Step 5: Verify and Remind About Cache
1. Re-run `list_db_schema()` to confirm changes
2. **Always remind the user**: "DbSchema changes require regenerating the mobile metadata cache. Which profiles should I generate the cache for?"
3. If user provides profiles: `generate_mobile_metadata_cache({ profileNames: ["ProfileName"] })`

---

## Tool Usage Rules

### CRITICAL: Use Dedicated DbSchema Tools Only

DB Schema records are `LifeSciConfigRecord` / `LifeSciConfigFieldValue` entries accessible ONLY through the Tooling API.

**NEVER use these for DbSchema records:**
- `run_soql`, `get_record`, `describe_sobject`, or ANY standard SOQL/record tool
- The following objects DO NOT EXIST in standard SOQL: `LifeSciConfigRecord`, `LifeSciConfigFieldValue`, `LifeSciConfigCategory`, `DbSchema__c`, `DbSchema__mdt`

**CORRECT field names:** `SObject`, `Type`, `WhereSoql`, `DeltaDateField`, `OneWaySync`, `AttachmentsSupport`, `MandatoryFields`, `PermissionSets`, `EnableDataUploadNotification`, `Status`, `SobjectPlatformEvents`, `Errors`, `Category`.
**WRONG field names (DO NOT USE):** `EntityType`, `SOQLFilterCondition`, `DeltaSyncDateField`, `WebToMobileSync`, `AttachmentDownloadMethod`.

### Field Reference

| Field | Type | Purpose |
|-------|------|---------|
| `SObject` | OBJECT | API name of the object to sync |
| `Type` | PICKLIST | `DATA` (synced records) or `CONFIGURATION` (metadata-like records) |
| `WhereSoql` | LONGTEXT | WHERE-clause filter (see SOQL Filter Rules below) |
| `DeltaDateField` | FIELD | Field used for delta/incremental sync (default `LastModifiedDate`) |
| `OneWaySync` | BOOLEAN | `true` = web→mobile only. **Disables offline edit/DCR** for the object — see Critical Behaviors |
| `AttachmentsSupport` | PICKLIST | `CACHE` (during sync), `BACKGROUND` (after sync), or empty (none) |
| `MandatoryFields` | LONGTEXT | Comma-separated fields that must always sync |
| `PermissionSets` | LONGTEXT | **Semicolon-delimited permission set API names** that gate sync (in addition to profile assignments). The mobile app syncs the object for users holding any listed permission set. Set via the `permissionSets` param on `create_db_schema`/`update_db_schema` |
| `EnableDataUploadNotification` | BOOLEAN | Whether the app surfaces a data-upload notification for this object |
| `Status` | PICKLIST | Validity status of the record (e.g., `VALID`) |
| `SobjectPlatformEvents` | — | Platform-event configuration for the object |
| `Errors` | — | Validation/generation errors recorded against the record |

### Critical Behaviors (warn the user about these)

- **Disabling a DB Schema record is destructive to local iPad data.** `toggle_db_schema({ active: false })` (or removing the record) is not just a visibility toggle — on each device's next sync the app runs `DELETE FROM <table>` for objects no longer in the metadata, **wiping all locally cached records for that object** and any unsynced offline edits. Re-enabling re-syncs from the server, but local-only data does not come back. Only disable when you intend to remove the object from mobile.
- **`OneWaySync = true` disables offline edit / DCR for the object.** One-way (web→mobile) objects get no offline-tracking columns and are treated as unsyncable for edits — so Data Change Requests and any offline modifications to that object will silently fail. Only use `OneWaySync` for read-only or platform-event-style reference data.

### SOQL Filter Rules (WhereSoql)
- Enter **only the WHERE clause** — no `SELECT`, `FROM`, or `WHERE` keyword
- **Encase the entire condition in parentheses** to prevent SQLite errors on mobile
- Use `RecordType.DeveloperName` (not `RecordTypeId`) for record type filtering
- Examples: `(IsActive = true)`, `(RecordType.DeveloperName = 'Detail_Visit')`

### Naming Convention
DbSchema records are named `DbSchema_` followed by the object API name (e.g., `DbSchema_Account`). The dedicated tools accept either "Visit" or "DbSchema_Visit".

### After Any DbSchema Change
**Always** remind the user to regenerate the mobile metadata cache. Ask which profiles, then call `generate_mobile_metadata_cache`.
