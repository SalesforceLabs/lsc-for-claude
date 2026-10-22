---
name: lsc-mobile-validation
description: Validates Life Sciences Cloud (LSC) Mobile app configuration to prevent issues. Use when user is preparing for mobile deployment, troubleshooting mobile sync issues, or asking about DB Schema / mobile cache configuration.
---

For mobile validation rules and guidance, call `search_lsc_knowledge({ query: "mobile validation configuration" })` to get sourced documentation.


# LSC Mobile Configuration Validator

You help validate LSC mobile app configuration to prevent sync and functionality issues.

## Automated Validation

**IMPORTANT:** When validating mobile configuration, use the `audit_mobile_config` tool to run automated checks. This tool validates against known common issues and provides specific resolution steps.

### Quick Validation Groups

| Scenario | Command |
|----------|---------|
| User can't log in | `audit_mobile_config({ group: 'mobile-login-check' })` |
| Before go-live | `audit_mobile_config({ group: 'pre-deployment' })` |
| Sync not working | `audit_mobile_config({ group: 'sync-troubleshooting' })` |
| Full health check | `audit_mobile_config({ group: 'full-mobile-audit' })` |

### Check Trigger Handlers & Admin Console Settings

If validation reveals missing features or misconfiguration:
- `list_trigger_handlers()` — Check if required trigger handlers are enabled
- `toggle_trigger_handler({ handlerName: "...", active: true })` — Enable/disable a handler
- `list_admin_settings({ category: "..." })` — View Admin Console settings for a category
- `update_admin_setting({ recordId: "...", fields: { IsActive: true } })` — Update a setting

### Diagnosing Specific Errors

If the user reports a specific error message, use `diagnose_lsc_issue`. It finds matching known causes and validation rules and checks the org for them:

```
diagnose_lsc_issue({ symptom: 'Device sync transaction record was not found' })
```

---

## Mobile Cache Status

**USE THE `check_mobile_cache_status` TOOL** to check cache status. Do NOT write SOQL queries manually.

```
check_mobile_cache_status()
```

**Objects that DO NOT EXIST (never query these):**
- `MobileMetadataCache__c`, `MobileApplicationDetail`, `lsc4ce__MobileMetadataCache__c` - NONE OF THESE EXIST

The correct object is `LifeSciMobileMetadataRecord` but the tool handles this for you.

### Key Fields (for reference)

| Field | Description |
|-------|-------------|
| `Name` | Name of the DB Schema record |
| `ProfileId` | Profile this schema is assigned to |
| `Status` | Active, Inactive, New, Published, Processing, etc. |
| `IntegrationStatus` | Error, New, Ok, Pending |
| `IntegrationErrorCode` | Error code if sync failed |
| `IntegrationErrorMessage` | Error details if sync failed |

## Admin Console Location

**Admin Console > Mobile > Object Metadata Cache Configuration**

This is where admins create and manage DB Schema records through the UI.

> **Tip:** For managing individual DbSchema records (create, update, delete, SOQL filters), see the `lsc-db-schema` skill.

## Required DB Schema Records by Feature

Each LSC feature requires specific DB Schema records to be active for mobile:

### Field Email
- Email template records
- Email fragment records
- Consent/subscription records

### Next Best Action (NBA)
- NBA configuration records
- Action records

### Next Best Customer (NBC)
- NBC settings records
- Provider/Account related records

### Lists & Filters
- Actionable list records

### App Alerts/Notifications
- Alert configuration records

### Visit Management
- Visit records
- Product discussion records
- Sample records (if sampling enabled)

### Sample Management
- Sample limit records
- Sample inventory records
- Sample transaction records

## Validation Workflow

When validating mobile configuration:

1. **Check setup status:**
   ```
   Use check_lsc_setup to verify org connection
   ```

2. **Query all mobile metadata records:**
   ```sql
   SELECT Id, Name, Status, IntegrationStatus, IntegrationErrorCode, IntegrationErrorMessage
   FROM LifeSciMobileMetadataRecord
   ORDER BY Name
   ```

3. **Identify issues:**
   - Records with `IntegrationStatus = 'Error'`
   - Records with `Status != 'Active'` and `Status != 'Published'`
   - Missing records for enabled features

4. **Check profile assignments:**
   ```sql
   SELECT Id, Name, Profile.Name, Status
   FROM LifeSciMobileMetadataRecord
   WHERE ProfileId != null
   ```

5. **Report findings:**
   - List all configured schemas
   - Flag any errors or inactive records
   - Identify potentially missing schemas based on enabled features

## Common Mobile Issues

### Data Not Appearing on Mobile
**Query to run:**
```sql
SELECT Id, Name, Status, IntegrationStatus
FROM LifeSciMobileMetadataRecord
WHERE Name LIKE '%<feature>%'
```
**Fix**: Ensure Status is Active/Published and IntegrationStatus is Ok

### Mobile Sync Failures
**Query to run:**
```sql
SELECT Id, Name, IntegrationErrorCode, IntegrationErrorMessage
FROM LifeSciMobileMetadataRecord
WHERE IntegrationStatus = 'Error'
```
**Fix**: Review error messages and correct configuration

### Feature Not Working for Specific Profile
**Query to run:**
```sql
SELECT Id, Name, Profile.Name, Status
FROM LifeSciMobileMetadataRecord
WHERE Profile.Name = '<profile_name>'
```
**Fix**: Ensure required schemas are assigned to the profile

## Mobile Sync Objects

For deeper sync troubleshooting, also query:

| Object | Purpose |
|--------|---------|
| `DeviceSyncSummary` | Summary of synced data per device |
| `DeviceSyncTransaction` | Individual sync transactions |
| `DeviceSyncTransactionLog` | Sync logs with details |
| `DeviceSyncTransactionRecord` | Individual synced records |

**Example - Recent sync errors:**
```sql
SELECT Id, Name, Status, ErrorDescription
FROM BatchJob
WHERE Status = 'Failed' OR Status = 'CompletedWithFailures'
ORDER BY StartTime DESC
LIMIT 10
```

