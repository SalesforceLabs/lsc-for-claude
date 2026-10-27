---
name: lsc-quick-actions-configuration
description: Guides Life Sciences Cloud (LSC) Quick Actions and Custom Actions configuration for web and mobile apps. Use when user asks about quick actions, custom actions, floating action button, Admin Console action administration, or a Visit quick action that is missing or will not open on iPad.
---

## How to Answer Quick Actions Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Action concepts, types, best practices | `search_lsc_knowledge({ query: "quick actions custom actions" })` |
| Specific action topic (deep links, Agentforce, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| A Visit quick action is missing on iPad, or the button shows and the layout will not open | `search_lsc_knowledge({ query: "FlexiPage Highlights Panel Cancel_visit SalesforceTesting" })` then follow **Visit Highlights Panel action** below. Open the page assigned to the record type before a GoTo or metadata-cache check. |
| Current org actions | `list_lsc_actions({ actionType: "both" })` |
| Admin Console action settings | `list_admin_settings({ category: "QuickActions" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Mobile cache status | `check_mobile_cache_status()` |
| Validation / audit | `audit_mobile_config({ group: "quick-actions-check" })` |

---

## Configuration Mode

When the user asks about configuring Quick Actions or Custom Actions, **ask them which mode they prefer**:

1. **Show me the documentation** — call `search_lsc_knowledge({ query: "quick actions custom actions configuration" })` and present relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
list_lsc_actions()
list_trigger_handlers()
list_admin_settings({ category: "QuickActions" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found or action to create, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
create_quick_action({ ... })
create_custom_action({ ... })
toggle_trigger_handler({ handlerName: "...", active: true })
```

#### Step 5: Verify
Re-run `list_lsc_actions()` to confirm actions were created correctly.

---

## Tool Usage Rules

### CRITICAL: Actions are Tooling API Objects

Quick Actions and Custom Actions are stored in `LifeSciConfigRecord` — a **Tooling API only** object.

| Tool | Works? |
|------|--------|
| `list_lsc_actions` | **YES** |
| `create_quick_action` | **YES** |
| `create_custom_action` | **YES** |
| `update_lsc_action` | **YES** |
| `delete_lsc_action` | **YES** |
| `run_soql` | **NO** — will fail |
| `delete_record` | **NO** — will fail |
| `create_record` | **NO** — will fail |

**NEVER use `run_soql`, `delete_record`, or `create_record` for actions.**

---

## Quick Actions vs Custom Actions — Field Differences

**CRITICAL: Quick Actions and Custom Actions use different fields.** Do not mix them up.

| Field | Quick Action | Custom Action |
|-------|-------------|---------------|
| `ActionName` | **Required** (e.g., `Email`, `NewVisit`) | Not used |
| `Location` | **Required** (e.g., `HomePage`, `Search`) | Not used |
| `ActionType` | Not used | **Required** (`App`, `URL`, `Utterance`) |
| `ActionTarget` | Not used | **Required** (URL or deep link) |
| `EntityType` | Not used | **Required** (e.g., `StagePath`, `HomePage`) |
| `TargetType` | Not used | **Required** (`External` or `Internal`) |
| `TargetParameters` | Not used | Optional (merge fields like `q=$record.Name`) |

**Shared fields** (used by both types):
- `DeveloperName` — unique API name
- `MasterLabel` — display label
- `IsActive` — whether the action is active
- `SortOrder` — display order (integer, lower = first)
- `Profiles` — semicolon-separated profile names for access control
- `PermissionSets` — semicolon-separated permission set API names (with namespace prefixes)
- `RecordTypes` — semicolon-separated record type developer names to filter by
- `SObject` — the related object (e.g., `Account`, `Visit`)
- `IsMobileOnly` — boolean, restricts action to mobile app only
- `HideViewInBrowserAction` — boolean

### Naming Conventions

Follow this pattern for DeveloperName:
- **Quick Actions:** `QuickAction_<Location><ActionName>` — e.g., `QuickAction_HomeEmail`, `QuickAction_SearchVisit`, `QuickAction_NbcVisit`
- **Custom Actions:** `CustomAction_<Description>` — e.g., `CustomAction_SearchGoogle`, `CustomAction_NewVisit`

---

## Which Action Type Do I Need?

**IMPORTANT: Always check the OOB Quick Action list first before creating a Custom Action with deep links. If an OOB action exists, prefer it — it's simpler and more reliable.**

| User wants to... | Action Type | Tool |
|------------------|-------------|------|
| Send an email | Quick Action (OOB) | `create_quick_action` with `actionName: "Email"` |
| Schedule a visit | Quick Action (OOB) | `create_quick_action` with `actionName: "NewVisit"` |
| Log a call | Quick Action (OOB) | `create_quick_action` with `actionName: "LogCall"` |
| Create a task | Quick Action (OOB) | `create_quick_action` with `actionName: "NewTask"` |
| Create an event | Quick Action (OOB) | `create_quick_action` with `actionName: "NewEvent"` |
| Show content/presentation | Quick Action (OOB) | `create_quick_action` with `actionName: "IntelligentContent"` |
| View online content | Quick Action (OOB) | `create_quick_action` with `actionName: "ViewOnline"` |
| Capture consent | Quick Action (OOB) | `create_quick_action` with `actionName: "Consent"` |
| View consent records | Quick Action (OOB) | `create_quick_action` with `actionName: "ViewConsent"` |
| Create a medical insight | Quick Action (OOB) | `create_quick_action` with `actionName: "CreateMedicalInsight"` |
| Create an inquiry | Quick Action (OOB) | `create_quick_action` with `actionName: "Inquiry"` |
| Launch a survey | Quick Action (OOB) | `create_quick_action` with `actionName: "Survey"` |
| Start a remote session | Quick Action (OOB) | `create_quick_action` with `actionName: "StartRemoteSession"` |
| Activity plan adjustment | Quick Action (OOB) | `create_quick_action` with `actionName: "ActivityPlanAdjustmentRequest"` |
| Web email (Search location) | Quick Action (OOB) | `create_quick_action` with `actionName: "WebEmail"` |
| Next Best Customer widget | Quick Action (OOB) | `create_quick_action` with `actionName: "NextBestCustomer"` |
| Navigate within LSC app (deep link) | Custom Action | `create_custom_action` with `actionType: "App"`, `targetType: "External"` |
| Open a URL/website | Custom Action | `create_custom_action` with `actionType: "URL"` |
| Run a Flow | Custom Action | `create_custom_action` with `actionType: "App"` |
| Launch a Lightning component | Custom Action | `create_custom_action` with `actionType: "App"` |
| Talk to Agentforce | Custom Action | `create_custom_action` with `actionType: "Utterance"` |

---

## Valid Location Values (Quick Actions)

`HomePage`, `Search`, `NextBestCustomer`, `Visit`, `Presentation`, `VisitSearch`

| Location | Where it appears | Context |
|----------|-----------------|---------|
| `HomePage` | Home page floating action button (FAB) | Global actions, max 5 |
| `Search` | Account/provider detail page actions | Account-context actions, set `SObject: "Account"` |
| `NextBestCustomer` | NBC widget action menu | Account-context actions within NBC |
| `Visit` | Visit engagement page actions | Visit-context actions, set `SObject: "Account"` |
| `Presentation` | Presentation/CLM screen actions | Content-context actions |
| `VisitSearch` | Visit search screen actions | Search-context actions |

## Valid EntityType Values (Custom Actions)

`StagePath`, `HomePage`

| EntityType | Where it appears | Context |
|------------|-----------------|---------|
| `StagePath` | Account detail page stage path area | Account-context custom actions |
| `HomePage` | Home page | Global custom actions |

---

## Valid ActionName Values (OOB Quick Actions)

**Before creating a Custom Action with deep links, always check this list first. If an OOB Quick Action exists for the use case, prefer it.**

| ActionName | Description |
|------------|-------------|
| `ActivityPlanAdjustmentRequest` | Create an activity plan adjustment request |
| `Consent` | Capture consent |
| `CreateMedicalInsight` | Create a medical insight |
| `Email` | Send email |
| `Inquiry` | Create an inquiry |
| `IntelligentContent` | Show content/presentation (CLM) |
| `LogCall` | Log a call |
| `NewEvent` | Create an event |
| `NewTask` | Create a task |
| `NewVisit` | Schedule a new visit |
| `NextBestCustomer` | Next Best Customer widget |
| `StartRemoteSession` | Start a remote session / remote visit |
| `Survey` | Launch a survey |
| `ViewConsent` | View consent records |
| `ViewOnline` | View online content |
| `WebEmail` | Web email (for Search location) |

---

## Working Examples from Reference Org (260-pm)

### HomePage Actions

**QuickAction_Visit — New Visit on Home Page (Sort Order 1)**
```
create_quick_action({
  developerName: "QuickAction_Visit",
  masterLabel: "QuickAction_HomeVisit",
  actionName: "NewVisit",
  location: "HomePage",
  sortOrder: 1,
  isMobileOnly: false,
  profiles: "District Manager;Field Sales Representative;Field Medical;Key Account Manager",
  permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager",
  recordTypes: "Health_Care_Provider",
  sObject: "Visit"
})
```

**QuickAction_HomeEmail — Email on Home Page (Sort Order 2)**
```
create_quick_action({
  developerName: "QuickAction_HomeEmail",
  masterLabel: "QuickAction_HomeEmail",
  actionName: "Email",
  location: "HomePage",
  sortOrder: 2,
  isMobileOnly: false,
  profiles: "District Manager;Field Sales Representative;Field Medical;Key Account Manager"
})
```

### Search (Account/Provider) Actions

**QuickAction_SearchVisit — New Visit on Account Page (Sort Order 1)**
```
create_quick_action({
  developerName: "QuickAction_SearchVisit",
  masterLabel: "QuickAction_SearchVisit",
  actionName: "NewVisit",
  location: "Search",
  sortOrder: 1,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "Field Sales Representative;Key Account Manager;Customer Facing Colleague",
  permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager"
})
```

**QuickAction_SearchEmail — Email on Account Page (Sort Order 2)**
```
create_quick_action({
  developerName: "QuickAction_SearchEmail",
  masterLabel: "QuickAction_SearchEmail",
  actionName: "Email",
  location: "Search",
  sortOrder: 2,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "System Administrator;District Manager;Field Sales Representative;Customer Facing Colleague;Key Account Manager",
  permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager"
})
```

**QuickAction_SearchIntelligentContent — Intelligent Content on Account Page (Sort Order 3)**
```
create_quick_action({
  developerName: "QuickAction_SearchIntelligentContent",
  masterLabel: "QuickAction_SearchIntelligentContent",
  actionName: "IntelligentContent",
  location: "Search",
  sortOrder: 3,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "Field Sales Representative;District Manager;Key Account Manager;Customer Facing Colleague;System Administrator",
  permissionSets: "force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager;lsc4ce__LifeSciencesCore"
})
```

**QuickAction_SearchConsent — View Consent on Account Page (Sort Order 4)**
```
create_quick_action({
  developerName: "QuickAction_SearchConsent",
  masterLabel: "QuickAction_SearchConsent",
  actionName: "ViewConsent",
  location: "Search",
  sortOrder: 4,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "Customer Facing Colleague;Field Sales Representative;Key Account Manager;District Manager;System Administrator",
  permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesFieldMedical;force__LifeSciencesKeyAccountManager"
})
```

**QuickAction_SearchWebEmail — Web Email on Account Page (Sort Order 5)**
```
create_quick_action({
  developerName: "QuickAction_SearchWebEmail",
  masterLabel: "QuickAction_SearchWebEmail",
  actionName: "WebEmail",
  location: "Search",
  sortOrder: 5,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "System Administrator;Key Account Manager;Field Sales Representative;District Manager;Customer Facing Colleague",
  permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager"
})
```

**QuickAction_NBC — Next Best Customer on Account Page (Sort Order 6)**
```
create_quick_action({
  developerName: "QuickAction_NBC",
  masterLabel: "QuickAction_NBC",
  actionName: "NextBestCustomer",
  location: "Search",
  sortOrder: 6,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "Field Medical;Field Sales Representative;Key Account Manager",
  permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesCommercialAdmin;force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager"
})
```

### NextBestCustomer (NBC Widget) Actions

**QuickAction_NbcVisit — New Visit in NBC (Sort Order 1, Mobile Only)**
```
create_quick_action({
  developerName: "QuickAction_NbcVisit",
  masterLabel: "QuickAction_NbcVisit",
  actionName: "NewVisit",
  location: "NextBestCustomer",
  sortOrder: 1,
  isMobileOnly: true,
  profiles: "Customer Facing Colleague;Field Sales Representative"
})
```

**QuickAction_NbcEmail — Email in NBC (Sort Order 2)**
```
create_quick_action({
  developerName: "QuickAction_NbcEmail",
  masterLabel: "QuickAction_NbcEmail",
  actionName: "Email",
  location: "NextBestCustomer",
  sortOrder: 2,
  isMobileOnly: false,
  profiles: "Field Sales Representative;Customer Facing Colleague"
})
```

**QuickAction_NbcIntelligentContent — Content in NBC (Sort Order 3, Mobile Only)**
```
create_quick_action({
  developerName: "QuickAction_NbcIntelligentContent",
  masterLabel: "QuickAction_NbcIntelligentContent",
  actionName: "IntelligentContent",
  location: "NextBestCustomer",
  sortOrder: 3,
  isMobileOnly: true,
  profiles: "Customer Facing Colleague;Field Sales Representative"
})
```

**QuickAction_NbcViewOnline — View Online in NBC (Sort Order 4, Mobile Only)**
```
create_quick_action({
  developerName: "QuickAction_NbcViewOnline",
  masterLabel: "QuickAction_NbcViewOnline",
  actionName: "ViewOnline",
  location: "NextBestCustomer",
  sortOrder: 4,
  isMobileOnly: true,
  profiles: "Customer Facing Colleague;Field Sales Representative"
})
```

### Visit Actions

**QuickAction_Survey — Survey on Visit Page (Sort Order 1)**
```
create_quick_action({
  developerName: "QuickAction_Survey",
  masterLabel: "QuickAction_Survey",
  actionName: "Survey",
  location: "Visit",
  sortOrder: 1,
  isMobileOnly: false,
  sObject: "Account",
  profiles: "System Administrator;Field Sales Representative;Field Medical;Key Account Manager",
  recordTypes: "PersonAccount;Business;Business_Account;Health_Care_Organization;Health_Care_Provider"
})
```

### Custom Actions

**CustomAction_SearchGoogle — Google Search on Account Stage Path**
```
create_custom_action({
  developerName: "CustomAction_SearchGoogle",
  masterLabel: "CustomAction_SearchGoogle",
  entityType: "StagePath",
  actionType: "URL",
  actionTarget: "https://www.google.com/search",
  targetType: "External",
  targetParameters: "q=$record.Name",
  hideViewInBrowserAction: false
})
```

---

## CRITICAL: Deep Link Navigation on Mobile

For `lsc://` deep links, you **must** use:
- **Action Type = `App`** (NOT URL) — triggers iOS URL scheme handling
- **Target Type = `External`** (NOT Internal) — hands URL to iOS, which routes back into LSC app
- **Action Target = `lsc://deeplink/lightning/...`**

**Why NOT URL type?** The URL action type opens a browser (embedded or external). The `lsc://` scheme is not a web URL — it's an iOS URL scheme. Only the App type correctly triggers iOS URL scheme resolution.

**Why External, not Internal?** `Internal` opens an embedded in-app browser that cannot handle `lsc://` schemes. `External` delegates to iOS, which recognizes the `lsc://` scheme and routes the navigation back into the LSC app.

### Custom Action Examples with Deep Links

**Navigate to new Visit from Home page:**
```
create_custom_action({
  developerName: "CustomAction_NewVisit",
  masterLabel: "New Visit",
  entityType: "HomePage",
  actionType: "App",
  actionTarget: "lsc://deeplink/lightning/o/Visit/new",
  targetType: "External",
  profiles: "Field Sales Representative"
})
```

**Navigate to Visit list from Home page:**
```
create_custom_action({
  developerName: "CustomAction_VisitList",
  masterLabel: "Visit List",
  entityType: "HomePage",
  actionType: "App",
  actionTarget: "lsc://deeplink/lightning/o/Visit/list",
  targetType: "External",
  profiles: "Field Sales Representative"
})
```

### Common Deep Link Formats

| Use Case | Action Target |
|----------|---------------|
| Create a new Visit | `lsc://deeplink/lightning/o/Visit/new` |
| Create Visit for account | `lsc://deeplink/lightning/o/Visit/new?accountid={id}` |
| Create Visit for product | `lsc://deeplink/lightning/o/Visit/new?product-id={id}` |
| Visit list | `lsc://deeplink/lightning/o/Visit/list` |
| View a Visit (modal) | `lsc://deeplink/lightning/r/Visit/{id}/view?modal=1` |
| Edit a Visit | `lsc://deeplink/lightning/r/Visit/{id}/edit` |
| View a record | `lsc://deeplink/lightning/r/{sObject}/{id}/view` |
| Create a record | `lsc://deeplink/lightning/o/{sObject}/new` |
| Create record with fields | `lsc://deeplink/lightning/o/{sObject}/new?{field}={value}` |
| Object list | `lsc://deeplink/lightning/o/{sObject}/list` |
| Navigate to Home | `lsc://deeplink/lightning/page/Home` |
| Account filter page | `lsc://deeplink/lightning/n/lsc4ce__AccountFilter` |
| Initiate action on account | `lsc://deeplink/lightning/r/{sObject}/{id}/action/{actionName}` |
| Start email with template | `lsc://deeplink/lightning/cmp/lsc4ce:WebEmail?lifesciemailtemplate-id={id}&account-id={id}` |

### Custom Action URL with Merge Field Parameters

For URL-type custom actions that need dynamic values from the current record, use `TargetParameters` with merge field syntax:

```
create_custom_action({
  developerName: "CustomAction_SearchGoogle",
  masterLabel: "CustomAction_SearchGoogle",
  entityType: "StagePath",
  actionType: "URL",
  actionTarget: "https://www.google.com/search",
  targetType: "External",
  targetParameters: "q=$record.Name"
})
```

The `$record.Name` merge field is replaced at runtime with the current record's Name field value. The parameter is appended as a query string to the `actionTarget` URL.

---

## Troubleshooting

### Deep Link Custom Actions

**"Action cannot be performed" or action does nothing on tap:**
- Verify Action Type = `App` (not URL)
- Verify Target Type = `External` (not Internal)
- Verify Action Target starts with `lsc://deeplink/lightning/`
- Regenerate metadata cache and sync the device

**Action disappears from Home page after changes:**
- Verify `IsActive = true`
- Verify Entity Type = `HomePage` (for custom actions) or Location = `HomePage` (for quick actions)
- Verify profile assignments are intact
- Check total Home page actions don't exceed 5 (quick + custom combined)
- Regenerate metadata cache

### Mobile Constraint
Only **5 quick actions** can display on the mobile Home Page floating action button.

### After Creating/Modifying Actions
Ask the user which profiles need the metadata cache regenerated, then call `generate_mobile_metadata_cache`. Do NOT guess profiles.

---

## Access Control: Profiles vs Permission Sets

Actions support two levels of access control, both using semicolon-separated strings:

**Profiles** — controls which user profiles see the action:
```
profiles: "District Manager;Field Sales Representative;Field Medical;Key Account Manager"
```

**Permission Sets** — additional permission set filtering (use full API names with namespace prefixes):
```
permissionSets: "lsc4ce__LifeSciencesCore;force__LifeSciencesFieldMedical;force__LifeSciencesFieldSalesRepresentative;force__LifeSciencesKeyAccountManager"
```

Common permission set API names:
| Permission Set | API Name |
|----------------|----------|
| Life Sciences Core | `lsc4ce__LifeSciencesCore` |
| Field Sales Representative | `force__LifeSciencesFieldSalesRepresentative` |
| Field Medical | `force__LifeSciencesFieldMedical` |
| Key Account Manager | `force__LifeSciencesKeyAccountManager` |
| Commercial Admin | `force__LifeSciencesCommercialAdmin` |

---

## Visit Highlights Panel action

Load `knowledge/modules/visit-management/support-engineering-visit-highlights-action.md`. Finish only when the reply states every fact under **Required answer**. iPad builds Visit actions from the FlexiPage Highlights Panel for the record type. The `SalesforceTesting` packaged page does not include `Cancel_visit`. Add the action to that panel, or assign a page that already has it. Do not start with a blank GoTo target or a metadata cache.

## Record Type Filtering

Use the `RecordTypes` field to restrict which account record types an action applies to. Value is semicolon-separated record type developer names:

```
recordTypes: "PersonAccount;Business;Business_Account;Health_Care_Organization;Health_Care_Provider"
```

This is commonly used for:
- **HomePage NewVisit** — restrict to `Health_Care_Provider` only
- **Visit Survey** — allow all record types: `PersonAccount;Business;Business_Account;Health_Care_Organization;Health_Care_Provider`
