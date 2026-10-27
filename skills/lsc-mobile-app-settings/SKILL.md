---
name: lsc-mobile-app-settings
description: Manages Life Sciences Cloud (LSC) Mobile Application Settings in the Admin Console. Use when user asks about mobile app settings, default browser, password type, dashboard refresh, app download URL, background notifications, advanced search, dynamic actions, platform events, survey branching, profile-based app settings, or dynamic actions that do not run on the mobile app.
---

For mobile app settings documentation, call `search_lsc_knowledge({ query: "mobile application settings" })` to get sourced documentation.

When dynamic actions do not run on the mobile app, load `knowledge/modules/visit-management/support-engineering-visit-dynamic-actions-inactive.md` and finish only when the reply states every fact under **Required answer**. Call `list_admin_settings({ category: "ApplicationSettings" })` and read **Active** on `ApplicationSettings_OrgLevel` before `EnableDynamicActions`. An inactive record is not synced, and the app defaults `EnableDynamicActions` to false. Activate the record. Do not treat this as a `User.Profile.Name` limit or as Dynamic Forms on Mobile.


# LSC Mobile Application Settings

You help configure the LSC Mobile Application Settings — the Admin Console settings under **Mobile > Application Settings** that control mobile app behavior (browser, password, search, notifications, etc.).

## CRITICAL: USE ADMIN CONSOLE TOOLS

Application Settings are stored as `LifeSciConfigRecord` / `LifeSciConfigFieldValue` entries under the `ApplicationSettings` category. They are NOT queryable via standard SOQL.

**Use these tools:**
- **List settings:** `list_admin_settings({ category: "ApplicationSettings" })` — shows all org-level application settings
- **Update a setting:** `update_admin_setting({ recordId: "...", fields: { ... } })` — update specific field values
- **Profile-based settings:** `list_admin_settings({ category: "ProfileBasedAppSettings" })` — shows profile-specific overrides

**NEVER use `run_soql`, `get_record`, or `describe_sobject`** for these settings.

---

## CONFIGURATION MODE

When the user asks about configuring Application Settings, **ask them which mode they prefer**:

1. **Show me the documentation** — I'll configure it myself in the Salesforce UI
2. **Walk me through it** — Configure it directly in my org step-by-step

If the user doesn't explicitly choose, **default to guided setup** when they're connected to an org, or documentation mode if no org is connected.

### GUIDED SETUP WORKFLOW

#### Step 1: Check Current State
```
list_admin_settings({ category: "ApplicationSettings" })
```

#### Step 2: Report Findings
Present a clear summary table of all settings and their current values. Map field names to their UI labels using the reference table below.

#### Step 3: Propose Changes
Based on the user's request, propose specific changes:
- "I'll set Default Browser to Chrome. OK?"
- "I'll enable Background Notifications. OK?"
- "I'll set Hourly Dashboard Refresh Limit to 3. OK?"

#### Step 4: Apply Changes (with user confirmation)
```
update_admin_setting({ recordId: "...", fields: { FieldName: "newValue" } })
```

#### Step 5: Verify
Re-run `list_admin_settings({ category: "ApplicationSettings" })` to confirm changes.

---

## Application Settings Field Reference

The `ApplicationSettings_OrgLevel` record is an org-level (`IsOrgLevel: true`) record under the `ApplicationSettings` category. It contains the following field values:

### Picklist Settings

| UI Label | FieldName | DataType | Valid Values | Default |
|----------|-----------|----------|--------------|---------|
| Default Browser | `DefaultBrowser` | PICKLIST | `Safari`, `Chrome`, `InAppBrowser` | `Safari` |
| Password Type | `PasswordType` | PICKLIST | `Numeric`, `Alphanumeric` | `Numeric` |

### Integer Settings

| UI Label | FieldName | DataType | Description | Default |
|----------|-----------|----------|-------------|---------|
| Hourly Dashboard Refresh Limit | `HourlyDashboardRefreshLimit` | INTEGER | Number of times dashboard can refresh per hour | `1` |

### Text/URL Settings

| UI Label | FieldName | DataType | Description |
|----------|-----------|----------|-------------|
| App Download URL | `AppDownloadUrl` | TEXT | Full URL to download the app from the App Store |

### Boolean Toggle Settings

| UI Label | FieldName | DataType | Description |
|----------|-----------|----------|-------------|
| Let users use View Online option | `LetUsersUseViewOnline` | BOOLEAN | Show "View Online" on home screen |
| Let users view reports | `LetUsersViewReports` | BOOLEAN | Allow report viewing in mobile |
| Enable Background Notifications | `EnableBackgroundNotifications` | BOOLEAN | Push notifications when app is backgrounded |
| Enable advanced search | `EnableAdvancedSearch` | BOOLEAN | Enable advanced search functionality |
| Use Advanced Search for lookups | `UseAdvancedSearchForLookups` | BOOLEAN | Use advanced search in lookup fields |
| Use Advanced Search for account lookups | `UseAdvancedSearchForAccountLookups` | BOOLEAN | Use advanced search specifically for account lookups |
| Let users override lookup search fields | `LetUsersOverrideLookupSearchFields` | BOOLEAN | Allow users to customize lookup search fields |
| Enable Dynamic Actions | `EnableDynamicActions` | BOOLEAN | Enable dynamic action framework |
| Let users publish platform events | `LetUsersPublishPlatformEvents` | BOOLEAN | Allow platform event publishing from mobile |
| Hide app upgrade notifications | `HideAppUpgradeNotifications` | BOOLEAN | Suppress app update notifications |
| Show persistent help text | `ShowPersistentHelpText` | BOOLEAN | Always show help text on fields |
| Enable Survey Branching Single Page | `EnableSurveyBranchingSinglePage` | BOOLEAN | Single-page survey branching mode |
| Enable Survey Confirmation | `EnableSurveyConfirmation` | BOOLEAN | Show confirmation after survey submission |

**NOTE:** The exact FieldName values above are based on the official help documentation UI labels. When you first run `list_admin_settings({ category: "ApplicationSettings" })`, verify the actual field names returned by the Tooling API and use those exact names for updates. The names may use slightly different casing or format than shown above.

---

## Profile-Based App Settings

In addition to org-level settings, administrators can configure **profile-specific overrides** under `ProfileBasedAppSettings`.

### To view profile-based settings:
```
list_admin_settings({ category: "ProfileBasedAppSettings" })
```

Profile-based settings allow different profiles to have different values for the same settings (e.g., one profile has advanced search enabled while another doesn't).

### Common profile-based fields:

| UI Label | FieldName | DataType | Description |
|----------|-----------|----------|-------------|
| Login Page Type | `LoginPageType` | PICKLIST | Type of login page to show |
| Default Landing Tab | `DefaultLandingTab` | TEXT | Which tab opens after login |
| Maximum Offline Days | `MaxOfflineDays` | INTEGER | How many days the app works offline |
| Enable Offline Mode | `EnableOfflineMode` | BOOLEAN | Allow offline access |

---

## Common Operations

### View All Application Settings
```
list_admin_settings({ category: "ApplicationSettings" })
```

### Enable Background Notifications
```
update_admin_setting({ recordId: "<id>", fields: { EnableBackgroundNotifications: true } })
```
Get the record ID from `list_admin_settings` first.

### Change Password Type
```
update_admin_setting({ recordId: "<id>", fields: { PasswordType: "Alphanumeric" } })
```

### Enable Advanced Search
```
update_admin_setting({ recordId: "<id>", fields: { EnableAdvancedSearch: true, UseAdvancedSearchForLookups: true, UseAdvancedSearchForAccountLookups: true } })
```

### Set App Download URL
```
update_admin_setting({ recordId: "<id>", fields: { AppDownloadUrl: "https://apps.apple.com/..." } })
```

---

## Configuration Location (UI)

**Admin Console > Mobile > Application Settings**

Required permission: **Life Sciences Commercial Admin** permission set.

---

## Best Practices

1. **Review all settings before go-live** — Run `list_admin_settings({ category: "ApplicationSettings" })` and verify each setting matches your implementation requirements.
2. **Enable Advanced Search** — Most implementations benefit from advanced search. Enable all three search toggles for the best user experience.
3. **Background Notifications** — Enable for visit reminders and time-sensitive alerts. Requires push notification setup in the mobile app.
4. **Password Type** — Use `Alphanumeric` for higher security requirements. `Numeric` is faster for field reps.
5. **Dashboard Refresh Limit** — Keep at 1-3 to avoid excessive API calls. Higher values may impact performance.
6. **Profile-Based Overrides** — Use `ProfileBasedAppSettings` to give different profiles different configurations (e.g., medical reps get different search settings than sales reps).

---

## Cross-References

- **DB Schema / Object Sync:** See `lsc-db-schema` skill
- **Mobile Cache Generation:** See `lsc-mobile-validation` skill
- **Home Page Configuration:** See `lsc-home-page-configuration` skill
- **Quick Actions:** See `lsc-quick-actions-configuration` skill

