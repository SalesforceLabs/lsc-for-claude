# Claude for Life Sciences Cloud (LSC)

A Claude Code plugin providing LSC-specific knowledge, templates, tools, skills, and agents for LSC Customer Engagement implementations.

## Diagram Output — Electron App

When running inside the Electron app and a user asks to see something in "diagram form", "as a diagram", "visualize this", or similar phrasing, **always use Mermaid syntax** (` ```mermaid ` code blocks). The Electron app renders Mermaid diagrams as interactive SVGs with zoom, pan, and fullscreen controls. Do not use ASCII art or plaintext diagrams when Mermaid can represent the content.

## UI Work — Electron App

Any change under `src-renderer/` follows the `roz-ui` project skill (`.claude/skills/roz-ui/SKILL.md`): shared primitives in `src-renderer/components/ui/`, Lucide icons, design tokens, no accent stripes, and all three async states. `test/unit/ui-conventions.test.ts` enforces the mechanical rules. A UI change isn't done until you've looked at it with `node scripts/ui-shots.mjs tour` (after `npm run electron:build`).

## Model Connections — Electron App

The app reaches a model through one saved connection (`src-electron/llm/`): `claude-code` (Salesforce employees — the gateway, `apiKeyHelper`/token and `ANTHROPIC_CUSTOM_HEADERS` read from Claude Code's `~/.claude/settings.json` at connect time; the gateway host is never shipped in the app), `anthropic` (personal key), `anthropic-gateway` (a company gateway serving `/v1/messages`), `openai`, or `openai-compatible` (Azure OpenAI, LiteLLM, Ollama, company gateways serving `/chat/completions`). OpenAI-style connections are best-effort: `openai.ts` converts the engine's Anthropic-shaped history and tools to Chat Completions and back; prompts aren't tuned per model. The app and its assistant are called **Roz** ("Roz for LSC" as the app name; "Ask Roz" labels on every connection — `ASSISTANT_NAME` in `connection.ts`, read through `hooks/useAssistantName.tsx`). Settings picks one of five Roz icons (`ROZ_ICONS` in `src-electron/app-icon.ts`, copied in `src-renderer/app-icon.ts` and kept equal by a test; drawn by `build/icon-src/roz.py`, rendered by `build/icon-src/export.sh`): it swaps the Dock icon (window icon on Windows/Linux) at runtime and the sidebar and welcome logos; the bundle icon Finder shows is always the default, `bold`. Settings' **Appearance** (System / Light / Dark, `theme` in settings.json) sets `nativeTheme.themeSource` (`src-electron/theme.ts`), previewed live and reverted on Cancel; `styles.css` holds a dark palette in `:root` and a light one under `prefers-color-scheme: light`, and Mermaid diagrams re-render in the palette on screen (`src-renderer/mermaid.ts`). Keys and tokens live in the OS keychain (`src-electron/secrets.ts`, safeStorage), never in settings.json and never sent to the renderer; token commands run in the main process; tokens only go over https (http for localhost only — `baseUrlProblem`). All requests use Electron's `net.fetch` for system certificates and proxies. The setup screen tests a connection (list models + one tiny message) before saving it; startup reconnects with the saved connection, else Claude Code's gateway, else `ANTHROPIC_API_KEY`.

## Orgs as Workspaces — Electron App

In the Electron app the selected org is the workspace: the org switcher at the top of the sidebar (`src-renderer/components/OrgSwitcher.tsx`, state in `hooks/useOrgs.tsx`, sf CLI parsing and org kind in `src-electron/orgs.ts`) picks it, and Studio, the session list and the Library follow it. Each session is bound to the org selected when it was created (by connection username, lowercased — several aliases can share one instance) and keeps it; opening a session from another org switches the workspace first, and switching orgs restores the session last viewed there. The composer shows the session's org (a Production pill on production hosts) and offers "Log in again" when that connection has expired or gone. Each connection gets its own MCP server (`src-electron/mcp/pool.ts`), so a session keeps running against its org while you work in another; the switcher marks orgs with running sessions. The model is told the session's org in its system prompt and `set_target_org` is refused in sessions (`src-electron/engine/session-org.ts`); in production it must confirm before writes. Library items record their org when saved and are shown for "This org" or "All orgs"; switching orgs puts the Library back on "This org". Pins are per org (a pinned session is pinned in its own org). The sidebar's **Search sessions** field matches titles and message text (`searchConversations` in `src-electron/engine/history.ts`, `history:search`), scoped "This org" or "All orgs" (reset to "This org" on a switch); in All orgs, sessions bound to another org carry its name, and opening one switches to it. Sessions and items from before this have no org: they show in every org in a collapsed "Not linked to an org · N" section, and a session binds to the current org on its next message. A row's menu offers "Move to [org]", and the section's menu "Move all to [org]" and "Delete N sessions…" (`history:move-to-org` binds only sessions still without an org — bound sessions never move between orgs; `history:delete-many`). Library items with no org of their own take their session's, so they move with it. Settings shows the org read-only. `listSfOrgs` (`src-electron/orgs.ts`) caches `sf org list` for 20s and then serves the last list while refreshing it, so resolving the selected org never waits on the CLI; the org menu's refresh always runs it fresh.

Only LSC admins are offered as workspaces. `src-electron/org-roles.ts` checks each logged-in connection as itself, in the background, three at a time (one query: the standard `LifeSciencesCommercialAdmin` permission set and whether the user holds it; customer clones don't count). The result is `admin`, `user` (an LSC org, not an admin — e.g. a rep added for First sync) or `other` (no LSC). Roles are cached in userData `org-roles.json` for 24 hours and pushed to the renderer (`sfOrg:roles`); the menu's Refresh checks them all again, and a failed check keeps the last answer. The switcher lists admins, plus connections not yet checked or logged out, and folds the rest under a collapsed "Other connections · N" ("Test user" / "No LSC" in their subtitle). These stay selectable; the section opens on its own when a search matches only them. When the selected connection isn't an admin, the switcher's subtitle says so in amber, and the menu explains what won't work and offers "Switch to [admin]" if an admin connection exists on the same org.

## Org Selection — IMPORTANT

In the Electron app a session's org is fixed (see above): never call `set_target_org` there. The rules below apply to Claude Code.

When connecting to a Salesforce org, follow these rules strictly:

1. **If only one org is authenticated**, use it automatically — do not ask the user.
2. **If multiple orgs are authenticated and no target is set**, ask the user **exactly once** which org to use, then call `set_target_org` with their choice.
3. **Once an org is selected (via `set_target_org` or auto-detection), NEVER ask again.** The choice persists for the entire session. All tools automatically use the selected org.
4. **Do not call `check_lsc_setup` or `list_sf_orgs` before every operation.** Only call them if the user explicitly asks about setup or if a tool returns an authentication error.

## Architecture

This is a **Claude Code Plugin** providing an all-in-one LSC solution:

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              LSC-for-Claude (Plugin)                     │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │                                                          │ │
│  │  Skills (Auto-invoked)    │   Commands (User-invoked)   │ │
│  │  ─────────────────────    │   ─────────────────────────  │ │
│  │  • lsc-implementation     │   • /lsc:setup-plugin        │ │
│  │  • lsc-troubleshoot       │   • /lsc:soql-query               │ │
│  │  • salesforce-query       │   • /lsc:describe            │ │
│  │  • lsc-data-model         │   • /lsc:help                │ │
│  │                           │   • /lsc:docs                │ │
│  │                           │                              │ │
│  │  Agents (Subagents)       │   MCP Server (Tools)         │ │
│  │  ─────────────────────    │   ───────────────────────── │ │
│  │  • lsc-consultant         │   • LSC knowledge tools      │ │
│  │  • lsc-admin              │   • Salesforce org tools     │ │
│  │  • lsc-developer          │   • SOQL, CRUD, metadata     │ │
│  │                           │                              │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│                    Salesforce CLI (sf)                       │
│                           │                                  │
│                           ▼                                  │
│                  Your LSC Salesforce Org                     │
└─────────────────────────────────────────────────────────────┘
```

## Plugin Components

### Skills (Claude auto-invokes based on context)
| Skill | Description |
|-------|-------------|
| `lsc-implementation` | Guides module implementations with best practices |
| `lsc-implementation-review` | Reviews an implementation/design against field-observed anti-patterns (sharing model, sample/inventory, mobile sync, over-customization, territory, MDM, Agentforce, UAT/go-live discipline) — proactively flags known-bad decisions before go-live |
| `lsc-troubleshoot` | Diagnoses and resolves LSC issues |
| `lsc-mobile-validation` | Validates mobile app configuration (DB Schema, sync settings) |
| `lsc-home-page-configuration` | Guides home page setup for web and mobile apps |
| `lsc-quick-actions-configuration` | Guides quick actions and custom actions setup for web and mobile |
| `lsc-visit-management` | Guides visit management configuration for web and mobile |
| `lsc-sample-management` | Guides sample inventory and sample limits configuration |
| `lsc-account-management` | Guides account management configuration (addresses, affiliations, licenses, DCR, search) |
| `lsc-activity-plan` | Guides activity plan configuration (account goals, weighted goals, shared goals, batch jobs, measures) |
| `lsc-territory-alignment` | Guides territory alignment configuration (explicit assignments, geo rules, affiliation rules, batch jobs) |
| `lsc-user-management` | Guides user provisioning, permission sets, PSLs, profiles, role hierarchy, and license capacity |
| `lsc-key-account-management` | Guides KAM account plans, goal definitions, action plan templates, stakeholders, and participants |
| `lsc-lists-filters` | Guides account lists, dynamic filters, static lists, advanced filters, and bulk actions configuration |
| `lsc-field-email` | Guides field email setup — templates, jobs, queue, consent integration, and mobile requirements |
| `lsc-intelligent-content` | Guides CLM/presentation management — upload, distribution, tracking, and presentation settings |
| `lsc-calendar-tot-routine` | Guides calendar, Time Off Territory, routines, and Planner Administration configuration |
| `lsc-surveys` | Guides survey configuration and usage — sharing, launch points, and response tracking |
| `lsc-product-management` | Guides product hierarchy, territory alignment, messages/objectives, and account restrictions |
| `lsc-app-alerts` | Guides app alerts and notifications — creation, territory targeting, deep links, and alert types |
| `lsc-next-best` | Guides NBC/NBA/NBM configuration — data model, widgets, Einstein Studio integration |
| `lsc-consent-management` | Guides consent capture, communication subscriptions, channels, and compliance snapshots |
| `lsc-agentforce` | Guides Agentforce for LSC (Winter '26) — Field Sales Agent, topics, actions, and Einstein Studio |
| `lsc-events-management` | Guides Events Management configuration — Managed Events, speaker events, participants, resources, budgets, stage paths |
| `lsc-custom-scripts` | Guides custom script configuration for validation, checklists, and Visit Action Validation (IIFE patterns, CodeText, Locker Service gotchas) |
| `salesforce-query` | Helps construct and execute SOQL queries |
| `lsc-mobile-app-settings` | Manages mobile Application Settings (default browser, password, search, notifications, dynamic actions) |
| `lsc-db-schema` | Manages DB Schema records (mobile object sync configuration, SOQL filters, enable/disable objects) |
| `lsc-briefings` | Guides Briefings (Daily Podcasts) configuration and troubleshooting |
| `lsc-data-model` | Expert knowledge of the LSC data model |
| `lsc-health-check` | Guides org health assessment and configuration verification |
| `lsc-performance-validation` | Validates a customer configuration against performance NFRs/SLAs (predicted mobile sync volume, field sync telemetry, pass/warn/fail assessment) |
| `lsc-data-migration` | Guides data loading and migration (account hierarchies, territory assignments, Veeva CRM migration) |
| `lsc-config-migration` | Guides configuration migration between orgs (export → diff → selective import of admin settings, DB Schema, trigger handlers, actions; create + update-only safe apply) |
| `lsc-demo-data-loading` | Guides loading demo data into LSC orgs (territories, accounts, HCPs, NPIs, contact points, PATI/PATS, business licenses, therapy-area scenarios, localization) |
| `lsc-integration-patterns` | Guides integration patterns (MDM, ERP, IQVIA, email providers, video platforms) |
| `lsc-reporting-analytics` | Guides CRM Analytics, reports, dashboards, and KPI configuration |

### Commands (User-invoked with `/lsc:command`)
| Command | Description |
|---------|-------------|
| `/lsc:setup-plugin` | Check plugin status and connect to Salesforce org |
| `/lsc:soql-query` | Run a SOQL query against your org |
| `/lsc:describe` | Describe a Salesforce object's fields |
| `/lsc:help` | Search the LSC knowledge base by topic |
| `/lsc:docs` | Browse and navigate LSC documentation by category |
| `/lsc:validate-mobile` | Validate mobile app configuration for deployment |
| `/lsc:generate-metadata-cache` | Generate mobile metadata cache programmatically |
| `/lsc:audit` | Audit mobile configuration against best practices |
| `/lsc:configure-home-page` | Interactive wizard to configure and validate home page |
| `/lsc:configure-quick-actions` | Interactive wizard to configure quick and custom actions |
| `/lsc:configure-visits` | Interactive wizard to configure and validate visit management |
| `/lsc:configure-samples` | Interactive wizard to configure and validate sample management |
| `/lsc:configure-accounts` | Interactive wizard to configure and validate account management |
| `/lsc:configure-activity-plan` | Interactive wizard to configure and validate activity plans |
| `/lsc:configure-territory` | Interactive wizard to configure and validate territory alignment |
| `/lsc:configure-users` | Interactive wizard to configure and validate user management |
| `/lsc:configure-custom-scripts` | Interactive wizard to configure and validate custom scripts for validation |
| `/lsc:open-org` | Open the Salesforce org in the browser |
| `/lsc:diff-orgs` | Compare configuration between two Salesforce orgs |
| `/lsc:health-check` | Run a comprehensive LSC org health check |
| `/lsc:perf-assessment` | Assess mobile sync performance against an NFR profile (pass/warn/fail report) |
| `/lsc:release-notes` | View LSC release notes by Salesforce release |
| `/lsc:export-config` | Export LSC org configuration as JSON |
| `/lsc:import-config` | Import LSC configuration from JSON export |
| `/lsc:status` | View a dashboard of the connected LSC org |
| `/lsc:configure-briefings` | Interactive wizard to configure and validate Briefings (Daily Podcasts) |
| `/lsc:diagnose-briefings` | Diagnose why Briefings isn't working — validates toggle, permissions, flows, DB Schema |
| `/lsc:getting-started` | Interactive onboarding — check setup, discover capabilities, get started |
| `/lsc:launch-app` | Build (first run) and launch Roz for LSC, the desktop app (Electron) |

### Agents (Specialized subagents)
| Agent | Description |
|-------|-------------|
| `lsc-consultant` | Senior implementation consultant for complex projects |
| `lsc-admin` | Administrator for day-to-day operations |
| `lsc-developer` | Developer for OmniStudio and custom development |
| `lsc-docs-researcher` | Searches live official Salesforce Help documentation for LSC setup, features, and admin configuration |

## Target Users

- **Consultants**: Implementing LSC for new customers, need guidance on best practices
- **Developers**: Building custom functionality and integrations on LSC
- **Administrators**: Managing operations, troubleshooting, and optimizing implementations

## MCP Server Tools

The plugin includes an MCP server that provides these tools:

### Knowledge & Documentation Tools

| Tool | Description |
|------|-------------|
| `list_lsc_modules` | List all 28 LSC4CE modules with documentation |
| `get_lsc_module_docs` | Get detailed documentation for a specific module |
| `search_lsc_knowledge` | Search across all documentation for topics/terms |
| `explain_lsc_concept` | Get explanation of LSC concepts (ARC, Sample Limits, etc.) |
| `get_lsc_admin_setup` | Get admin configuration guidance for a feature |
| `list_lsc_help_docs` | List all available documentation (help, guides, exercises, troubleshooting) |
| `get_lsc_help_doc` | Get official Salesforce help documentation for a topic |
| `get_lsc_guide` | Get guide documentation (developer guide, mobile setup) |
| `get_lsc_troubleshooting` | Get common issues and troubleshooting documentation |
| `get_lsc_exercise` | Get hands-on exercise documentation |

#### Salesforce Org Tools

| Tool | Description |
|------|-------------|
| `check_lsc_setup` | Check if SF CLI is installed and orgs are authenticated |
| `install_sf_cli` | Install Salesforce CLI via npm (with user consent) |
| `list_sf_orgs` | List all authenticated Salesforce orgs |
| `set_target_org` | Set which org to use for operations |
| `open_org` | Open the target org in the browser, optionally to a specific page path |
| `run_soql` | Execute SOQL queries against the target org |
| `describe_sobject` | Get object metadata (fields, types, etc.) |
| `get_record` | Retrieve a specific record by ID |
| `create_record` | Create a new record |
| `update_record` | Update an existing record |
| `delete_record` | Delete a record |
| `generate_mobile_metadata_cache` | Generate mobile metadata cache for specified profiles |
| `upload_presentation` | Upload a presentation (.pptx, .pdf, or .zip files) to LSC Intelligent Content. Auto-detects format: PPTX converts via LibreOffice, PDF uploads directly, HTML ZIPs are validated and uploaded as pages. All formats use the Bulk Presentation API. |
| `distribute_presentation` | Distribute a presentation to territories. Creates PresentationShare records with territory Group IDs (TerritoryAndSubordinates for cascading). |
| `assign_presentation_content` | Assign topics to a presentation and/or products to its pages. Creates TopicAssignment and PresentationPageProduct records. |
| `diff_orgs` | Compare LSC configuration between two orgs. Compares trigger handlers, admin settings, DB Schema, and actions to identify configuration drift. |

**CRITICAL — Presentation language interpretation:**
- **"associate with X" / "link to X" / "tag with X"** → X is a **Topic** name. Search `Topic` object, then call `assign_presentation_content` with `topicNames`. NEVER search Territory2 for this.
- **"give access to [person]" / "grant access to [person]"** → Look up the person's territory via `UserTerritory2Association`, then call `distribute_presentation` with that territory ID.
- **"distribute to [territory]"** → Call `distribute_presentation` directly with the territory ID.

#### LSC Action Tools

**CRITICAL: These are the ONLY tools that work for LSC actions. NEVER use run_soql, Bash, delete_record, or create_record for actions.**

| Tool | Description |
|------|-------------|
| `list_lsc_actions` | List Quick Actions and Custom Actions via Tooling API (includes IDs, profiles) |
| `create_quick_action` | Create a Quick Action (Email, NewVisit, LogCall, etc.) |
| `create_custom_action` | Create a Custom Action (URL, App, Utterance) |
| `update_lsc_action` | Update an existing Quick/Custom Action (label, fields, profiles, active status) |
| `delete_lsc_action` | Delete a Quick Action or Custom Action by ID or name |
| `check_mobile_cache_status` | Check mobile metadata cache status |

**NEVER use run_soql to query actions or cache status. These objects DO NOT EXIST:**
- `LifeSciCustomAction__mdt`, `CustomAction__c`, `QuickAction__mdt`, `LifeSciConfigType__c`
- `MobileMetadataCache__c`, `MobileApplicationDetail`, `lsc4ce__MobileMetadataCache__c`

**To update an action:** Call `update_lsc_action` with the ID or name and the fields to change.
**To delete an action:** Call `delete_lsc_action` with the ID or name.
**To check cache status:** Call `check_mobile_cache_status`.

#### Admin Console & Trigger Handler Tools

| Tool | Description |
|------|-------------|
| `list_trigger_handlers` | List trigger handlers and their active/inactive status |
| `toggle_trigger_handler` | Enable or disable a specific trigger handler by DeveloperName |
| `list_admin_settings` | List Admin Console settings by category with field values |
| `update_admin_setting` | Update an existing Admin Console setting or field value |
| `create_admin_setting` | Create a new Admin Console setting with field values |

**To enable/disable a feature (e.g., DCR):** Call `list_trigger_handlers` to find the handler, then `toggle_trigger_handler` to enable/disable it.
**To view/modify Admin Console settings:** Call `list_admin_settings` with a category, then `update_admin_setting` to change values.

**NEVER use `run_soql`, `get_record`, or `describe_sobject` for Admin Console settings (including DbSchema records).** These are Tooling API entities (`LifeSciConfigRecord`, `LifeSciConfigFieldValue`, `LifeSciConfigCategory`) — they do NOT exist in standard SOQL. Always use `list_admin_settings`, `update_admin_setting`, and `create_admin_setting` instead. `list_admin_settings` already returns complete record details including all field values — there is no need to call `get_record` for additional information.

#### DbSchema Tools

| Tool | Description |
|------|-------------|
| `list_db_schema` | List all DB Schema records with SObject, Type, Active, SOQL filter, sync direction |
| `get_db_schema` | Get full details of a DB Schema record (field values + profile assignments) |
| `create_db_schema` | Create a new DB Schema record with correct data types (OBJECT, LONGTEXT, FIELD, etc.) |
| `update_db_schema` | Update a DB Schema record's fields (whereSoql, oneWaySync, attachments, etc.) |
| `toggle_db_schema` | Enable or disable a DB Schema record (IsActive toggle) |

**Use these dedicated tools instead of the generic `list_admin_settings`/`update_admin_setting`/`create_admin_setting` for DbSchema records.** The generic tools work but the dedicated tools handle all 7 data types (TEXT, INTEGER, PICKLIST, BOOLEAN, LONGTEXT, OBJECT, FIELD) correctly and provide a better interface.

**NEVER use `run_soql`, `get_record`, or `describe_sobject` for DbSchema records.** These are Tooling API entities (`LifeSciConfigRecord`, `LifeSciConfigFieldValue`) — they do NOT exist in standard SOQL.

**CORRECT field names:** `SObject`, `Type`, `WhereSoql`, `DeltaDateField`, `OneWaySync`, `AttachmentsSupport`, `MandatoryFields`.
**WRONG field names (DO NOT USE):** `EntityType`, `SOQLFilterCondition`, `DeltaSyncDateField`, `WebToMobileSync`, `AttachmentDownloadMethod`.

#### Navigation Tab Tools

| Tool | Description |
|------|-------------|
| `list_navigation_tabs` | List mobile navigation tabs configured in Admin Console > Mobile > UI Settings |
| `add_navigation_tab` | Add a new navigation tab to LSC Mobile with label, tab name, order, and profile assignments |

**Navigation tabs are stored as `LifeSciConfigRecord` records (Tooling API) in the "UISchema" category.** Use these dedicated tools rather than `list_admin_settings`/`create_admin_setting` for tab management.

**After adding a tab:** Verify it appears in **Admin Console > Mobile > UI Settings**, then regenerate the mobile metadata cache for the tab to appear in the iPad app.

#### Visit Management Tools

| Tool | Description |
|------|-------------|
| `check_visit_config` | Check Visit Management configuration (record types, settings, compliance, territory info, mobile cache) |
| `add_visit_engagement_sidebar_item` | Add a custom object as a related list on a Visit page layout so it appears in the visit engagement sidebar on mobile. Retrieves the layout XML, inserts the related list, and deploys it back. |

**CORRECT object names:** `Visit`, `ProviderVisit`, `ProviderVisitProdDetailing`, `ProviderVisitProdDiscussion`, `ProviderAcctTerritoryInfo`, `ComplianceStatementDef`.
**WRONG names (DO NOT USE):** `Visit__c`, `ProviderVisit__c`, `VisitSetting__c`, `VisitConfiguration__mdt`, `VisitRecordType__c`, `VisitType__c`.

#### Sample Management Tools

| Tool | Description |
|------|-------------|
| `check_sample_config` | Check Sample Management configuration (products, inventory, locations, batches, limits, mobile cache) |

**CORRECT object names:** `Product2`, `LifeSciMarketableProduct`, `Location`, `ProductionBatch`, `ProductItem`, `ProductBatchItem`, `InventoryOperation`, `ProductRequest`, `InventoryCountAssessment`, `ProductDisbursement`, `ProviderSampleLimit`.
**WRONG names (DO NOT USE):** `SampleTransaction__c`, `SampleInventory__c`, `SampleLimit__c`, `SampleProduct__c`, `SampleLot__c`.

#### Account Management Tools

| Tool | Description |
|------|-------------|
| `check_account_config` | Check Account Management configuration (accounts, providers, addresses, licenses, affiliations, DCR, mobile cache) |

**CORRECT object names:** `Account`, `HealthcareProvider`, `ContactPointAddress`, `BusinessLicense`, `ProviderAffiliation`, `ProviderAcctTerritoryInfo`, `LifeSciDataChgDefMngFld`, `UserAdditionalInfo`.
**WRONG names (DO NOT USE):** `HealthcareProvider__c`, `ContactPointAddress__c`, `BusinessLicense__c`, `ProviderAffiliation__c`, `AccountAddress__c`.

#### Activity Plan Tools

| Tool | Description |
|------|-------------|
| `check_activity_plan_config` | Check Activity Plan configuration (time periods, plans, territories, goals, measures, product goals, mobile cache) |
| `check_briefings_config` | Check Briefings (Daily Podcasts) configuration (toggle, permissions, flows, content definitions, DB Schema, mobile cache) |

**CORRECT object names:** `ActivityPlan`, `ActivityPlanTerritory`, `TimePeriod`, `ProviderActivityGoal`, `ProviderActivityGoalMeasure`, `PrvdActvtyGoalMeasureProdt`, `ProviderAcctTerritoryInfo`.
**WRONG names (DO NOT USE):** `ActivityPlan__c`, `ProviderActivityGoal__c`, `AccountGoal__c`, `TimePeriod__c`, `GoalMeasure__c`.

#### Territory Alignment Tools

| Tool | Description |
|------|-------------|
| `check_territory_config` | Check Territory Alignment configuration (territory model, territories, explicit assignments, geo rules, affiliation rules, ProviderAcctTerritoryInfo) |

**CORRECT object names:** `Territory2`, `Territory2Model`, `ObjectTerritory2Association`, `TerritoryGeoAssignmentRule`, `TerritoryProviderAffiliationAlignmentRule`, `ProviderAcctTerritoryInfo`.
**WRONG names (DO NOT USE):** `AccountTerritory__c`, `TerritoryAssignment__c`, `TerritoryInfo__c`, `AffiliationAlignmentRule__c`, `ZipTerritory__c`.

#### User Management Tools

| Tool | Description |
|------|-------------|
| `check_user_config` | Check user management configuration (package licenses, PSL capacity, permission set assignments, profiles, roles, territory-user associations) |
| `list_users` | List active users with filters (by profile, permission set, territory, or find users without territories/PSLs) |
| `list_permission_sets` | List LSC permission sets and PSLs with assignment counts and capacity |
| `assign_permission_set` | Assign a permission set to one or more users by label/API name |
| `unassign_permission_set` | Remove a permission set assignment from one or more users |

**CORRECT object names:** `User`, `Profile`, `UserRole`, `PermissionSet`, `PermissionSetAssignment`, `PermissionSetLicense`, `PermissionSetLicenseAssign`, `UserTerritory2Association`, `PackageLicense`.
**WRONG names (DO NOT USE):** `User__c`, `UserProfile__c`, `PermissionSetAssignment__c`, `PSLAssignment__c`, `LicenseAssignment__c`, `UserTerritory__c`, `RoleHierarchy__c`.

#### Validation & Audit Tools

| Tool | Description |
|------|-------------|
| `audit_mobile_config` | Run automated checks against validation rules to identify misconfigurations |
| `list_validation_groups` | List available validation groups (mobile-login-check, pre-deployment, etc.) |
| `diagnose_lsc_issue` | Find validation rules matching a specific error message or symptom |

#### Health Check & Status Tools

| Tool | Description |
|------|-------------|
| `health_check` | Run a comprehensive LSC org health check (trigger handlers, PSLs, territory model, DB Schema, mobile cache) |
| `get_org_status` | Get a single dashboard view of the connected LSC org (packages, features, territory model, user count) |
| `export_config` | Export LSC configuration (Admin Console settings, DB Schema, trigger handlers, actions) as JSON |
| `import_config` | Import LSC configuration from a snapshot into a target org. Diff-driven, create + update-only (safe). Modes: `report` (diff summary, default), `ui` (local browser review/apply UI on 127.0.0.1 with checkboxes + live progress), `apply` (headless apply of a selection). Auto-backs-up the target first; never deletes/deactivates target-only records |
| `get_release_notes` | Get LSC release notes for a specific Salesforce release (Spring '26, Winter '26, etc.) |

#### Performance & Scalability Tools

All read-only against the org; safe in production. NFR profile format: `docs/perf-nfr-profile.example.yaml`.

| Tool | Description |
|------|-------------|
| `profile_sync_volume` | Predict per-user mobile sync volume: resolves the user's DB Schema records, substitutes WhereSoql tags per territory as the iOS app does, runs COUNT() queries; reports records per table, estimated device SOQL requests, and failing filters |
| `analyze_sync_telemetry` | Summarize real-device sync performance from `DeviceSyncSummary` (initial/delta sync p50/p90/p95, metadata download, DB size, failure rate, by network and app version, slowest syncs) |
| `run_perf_assessment` | Evaluate personas in an NFR profile (YAML) against warn/fail thresholds using both tools above; markdown pass/warn/fail report, optional JSON output |
| `simulate_initial_sync` | Simulate the network part of an iOS initial sync for one end user (authenticated in the sf CLI): user-info, metadata archive download + MD5, table list and WHERE tags as the app builds them, then per-table downloads (enhanced or legacy flow); reports records, requests, MB and seconds per table plus metadata time. Network time only; creates no records |

#### Developer & Integrator Tools

| Tool | Description |
|------|-------------|
| `run_apex` | Execute anonymous Apex code against the target org (batch jobs, data fixes, testing) |
| `bulk_create_records` | Create multiple records from a JSON array (seed data loading) |
| `bulk_update_records` | Update multiple records from a JSON array (bulk data fixes) |
| `deploy_metadata` | Deploy metadata from a local source directory to the target org |
| `retrieve_metadata` | Retrieve metadata from the target org to a local directory |

#### LSC Studio Tools (Electron GUI data)

| Tool | Description |
|------|-------------|
| `studio_list_features` | List the features LSC Studio can map — 16 module features (Visit, Samples, Accounts, Activity Plan, KAM, Consent, Intelligent Content, Events, …) plus org-wide Mobile Sync, Territory & Users, Actions & Home Page, and Briefings |
| `studio_feature_map` | Collect every configuration surface for one feature (objects, record types, layouts, custom scripts, validation rules, Apex triggers, flows, trigger handlers, DB Schema, actions, Admin Console settings, compliance) with health findings, as JSON |
| `studio_item_detail` | Fetch a validation rule formula, Apex trigger body, custom script code, a Visit layout's engagement sidebar (current related lists + addable child objects), or a record-triggered flow's outline (entry conditions, path, what it changes) with mobile-sync health checks for one item, as JSON |
| `studio_metadata_doc` | A page layout, compact layout, Lightning page or list view (columns, filters, scope, who it is shared with) as it is in the org now — for a Layout: sections (raw label, which of that label, heading, fields per XML column with behavior), related lists and the profiles assigned it; for a CompactLayout: its fields in order, the object's fields that can be added and the record types assigned it; for a FlexiPage: its regions and facets with each component's identifier and properties, the profiles and apps it's assigned in, and whether it's managed — plus whether the org is production, for lining up and editing the iPad preview, as JSON (never cached) |
| `studio_page_reach` | The profiles a Lightning page is assigned to and the apps it's the default of — read from every app, which can take a minute in big orgs, so `studio_metadata_doc` answers without it after a few seconds (`reachPending`) and the inspector fills it in from this, as JSON |
| `studio_component_catalog` | The components **Insert component…** offers for a Home or record Lightning page in the iPad preview — Recent items, the org's inline LWCs (`lscMobileInline_*`), related lists of synced child objects, and components that need Lightning App Builder (shown greyed), each with default properties, as JSON |
| `studio_component_props` | The properties of a Home or record page component for the properties sheet — a custom LWC's from its `js-meta.xml` `targetConfigs`, standard and LSC components from a curated table — each with type, range, options, default and whether the iPad reads it, as JSON |
| `studio_list_profiles` | List profiles with active user counts for Studio's **View as** lens, as JSON |
| `studio_user_access` | One user's permission set licenses, permission sets, permission set groups, and territories, as JSON (for the inspector's access panel) |
| `studio_ipad_published` | The iPad as last published for one user of a profile (the profile's most typical user unless `userId` is given; their assigned permission sets are merged in like the app does) — tabs, Home page components, record types, layouts, Lightning pages, compact layouts, and list views read from the profile's active metadata cache ZIP and resolved the way LSC Mobile does (tab filters/routing, template region slots, supported components, visibility rules), as JSON |
| `studio_ipad_published_progress` | Which step a running `studio_ipad_published` load for a profile is on (waiting / running / done / failed, with times), or null; no org calls, as JSON |
| `studio_ipad_published_users` | Active users of a profile whose name contains a search term, for the iPad preview's user picker when the profile has more users than it lists, as JSON |
| `studio_access_options` | Permission sets, permission set groups, and territories a user can be given (at most 2,000 of each, with totals when cut; `search` finds the rest by name), as JSON |
| `studio_lwc_bundle` | One inline LWC (`lscMobileInline_*`) and the `c/` components it uses, compiled with lightning-base-components and Studio's stand-ins for LDS and other platform modules into a script for the iPad preview's live frame, plus its offline check, as JSON |
| `studio_lwc_request` | Answer a request from a live-previewed inline LWC — UI API GETs and GraphQL queries only, as the connected user or (`mobileLogin`) as the previewed rep's test-user login; writes and other endpoints refused |
| `studio_preview_fix` | Preview a Studio change against the live org (before/after, who gains/loses access, warnings, or why it's blocked) without writing anything |
| `studio_apply_fix` | Apply a previewed Studio change (assign/remove a PSL, set an Admin Console field, activate/deactivate an action/tab/DB Schema record/trigger handler, change profile assignments, create/delete an action/tab/DB Schema record, give/remove a permission set, group, or territory) and return its undo; refuses if the target org changed |
| `studio_publish_mobile` | "Publish to iPad" — start mobile metadata cache generation for chosen profiles; refuses if the target org changed |
| `studio_publish_status` | Poll a publish job started by `studio_publish_mobile` (running / done / failed) |
| `studio_perf_users` | Active users to pick for a performance test plan (name/username search, profile filter), most territories first, as JSON |
| `studio_perf_parse_plan` | Validate an NFR profile YAML (`run_perf_assessment` format) and return it as a Studio test plan, as JSON |
| `studio_perf_start` | Start a performance assessment of a test plan as a background job (read-only against the org); poll with `studio_perf_status` |
| `studio_perf_status` | Progress (current step, query count) of a performance run, with the full assessment result once done |
| `studio_perf_cancel` | Stop a running performance run — no new queries are issued |
| `studio_connected_org` | The org the MCP server is connected to (its target or default org), as JSON — the GUI files plans and runs under it when Settings names no org |
| `studio_perf_active` | The performance run in progress for the connected org, if any, so the GUI can reattach to it, as JSON |
| `studio_perf_check` | Pre-flight check of a test plan: resolves `select` personas and reports missing/inactive users, empty selections, profile mismatches and territories none of the users is in, as JSON |
| `studio_perf_territories` | Active-model territories across a persona's users (listed and selected), with how many of them are in each, as JSON |
| `studio_perf_report` | Render an assessment result as the `run_perf_assessment` markdown report |
| `studio_sim_start` | Start a first-sync simulation (`simulate_initial_sync`) as a background job, running as a chosen sf CLI connection (admin or end user); read-only; poll with `studio_sim_status` |
| `studio_sim_status` | Progress (step, tables done, records so far) of a first-sync simulation, with the result once finished — also when cancelled, covering what was downloaded |
| `studio_sim_active` | The first-sync simulation in progress, if any, so the GUI can reattach to it, as JSON |
| `studio_sim_cancel` | Stop a running first-sync simulation — in-flight requests are aborted, no new tables start |
| `studio_sim_report` | Render a simulation result as the `simulate_initial_sync` markdown report |
| `studio_readiness` | One feature's readiness: its validation rules plus Studio's own checks, by stage (switched on → access → data → settings → iPad), each pass / fail / couldn't check / skipped with why, steps, and fixes, as JSON |
| `studio_setup_overview` | Org-wide go-live checks for the Setup Overview (PSL capacity, territory model, users without territory, metadata cache missing/failed/old per profile, Admin Console changes not yet published), as JSON |
| `studio_user_trace` | "Check a user": one user's chain for a feature or overall — active, profile, LSC PSL, object access, territory, DB Schema reaching them, actions, metadata cache, last sync — as JSON |
| `studio_drift` | "What changed": save / list / diff / delete local configuration snapshots (`~/.lsc-studio/snapshots/<org>/` or `LSC_STUDIO_DATA_DIR`), plus configuration modified in the last N days, as JSON |
| `studio_sync_overview` | Org-wide mobile sync health from `DeviceSyncSummary` (verdict, daily trend, by app version/network), the reps most at risk with plain-language reasons, and DB Schema settings worth a look, as JSON — no per-user counts |
| `studio_sync_user` | One user's predicted sync volume per territory and table, with the DB Schema record behind each table, why heavy tables are heavy (`explainTable`) and safe suggested changes, plus their own recent syncs, as JSON |
| `studio_sync_impact` | Predicted sync volume before and after pending DB Schema changes (Studio fixes), per affected profile's heaviest user, including filters that would stop running, as JSON — read-only |
| `studio_signoff_report` | Render a plain-language go-live sign-off report from an assessment result, optional first-sync results and a baseline run, with the detailed reports as an appendix |

All but the four write tools are read-only and return raw JSON for the Electron app's **Studio** mode, whose rail has three sections (with the per-feature list last, below Testing): **iPad** — the iPad preview, with an inspector docked beside it for clicked blocks ("Open in Setup" jumps to the feature's board; Actions & Home Page, Mobile Sync and Visit offer a "Preview on iPad" shortcut) — **Setup** — an Overview, Check a user, What changed, and per feature a Readiness view plus a board (one column per lane) + inspector view of its configuration — and **Testing**, the mobile sync pages — **Sync health**, **Check a rep's sync**, **Test plans** and **First sync** (`TestingPages.tsx`, each kept mounted once opened so a running job keeps polling) — and a **Test users** page (`TestUsersView.tsx`: the selected org's test-user logins with their status — signed in, or expired with **Sign in again** — and **Sign in a test user…** / Forget). The Electron app calls them directly over IPC (`studio:call`) and hides `studio_*` tools from the chat model. The four write tools (preview/apply/publish/status) are registered only when `LSC_STUDIO_FIXES=1` (set by the Electron app) and are refused if the chat model calls them, so writes only happen from Studio after the user confirms. In Studio, suggested changes on findings and inspector edits (Active switch, "Who sees this" profile picker — via `item.edit`) are queued in a pending-changes tray (`src-renderer/components/studio/changes.ts`; every step undoable with ⌘Z / ⇧⌘Z or the tray's Undo / Redo buttons — `tray-history.ts`, not in text fields or while reviewing), previewed together in the review dialog, applied in order, and can be undone together; mobile changes then offer **Publish to iPad**. Change logic lives in `src/studio/fixes.ts` (field edits, active switch, profile assignments, PSLs), `src/studio/edits.ts` (custom script code — previewed as a line diff with the same static checks as the map, refused if `CodeText` changed or the org's API won't write it; the validation rule Active switch, a Tooling `ValidationRule` Metadata update; and adding/removing a Visit layout related list for the engagement sidebar, reusing the helpers in `src/salesforce/visit-layout.ts` shared with `add_visit_engagement_sidebar_item`), `src/studio/create.ts` (new Admin Console records from "+ New", "Duplicate…", and "Add to iPad sync" — created inactive, filled in, assigned, then activated, rolled back on failure; undo deletes them), and `src/studio/access.ts` (give/remove permission sets, groups, territories; "Give same access as…"), with shared guards in `src/studio/change-helpers.ts`; publishing in `src/studio/publish.ts`. New records always open a prefilled form first (`src-renderer/components/studio/CreateDialog.tsx`, field specs in `templates.ts`) and are only queued — Studio never invents values for missing settings; it suggests copying another profile's records instead. The **View as** lens re-reads a map from one profile's point of view entirely in the renderer (`src-renderer/components/studio/lens.ts`), using the `audience` (profiles / permission sets) that collectors attach to profile-scoped items — DB Schema, navigation tabs, actions, profile app settings, metadata cache, and per-profile rows. Picking a profile ("Check a profile…" in the header, or "Check X's setup" on per-profile rows marked with `item.checkProfile`) swaps the board for a profile check (`LensChecklist.tsx`, logic in `checklist.ts`), titled by `FeatureMap.checkTitle` (e.g. "iPad readiness"): a ready / not-ready verdict with a progress bar and a "copy setup from [profile]" fastest fix, numbered per-profile checks from `FeatureMap.checklist` (default: every surface in lane order), then an "Applies to everyone" group. Rows offer "Copy N from X" (queues profile-assignment changes) and "Publish to iPad". The picker only appears on features with per-profile setup. Inline LWCs (`lscMobileInline_*`) on record pages run live in the published preview (`LiveInlineLwc.tsx`): `studio_lwc_bundle` compiles the org's bundle and the `c/` components it uses (`src/studio/lwc/compile.ts`, rollup + `@lwc/rollup-plugin` with lightning-base-components; cached per source hash) against stand-ins for the LDS-backed modules and components the base components package doesn't ship (`src/studio/lwc/shims.ts`: uiRecordApi, uiObjectInfoApi, uiLayoutApi, uiRelatedListApi, GraphQL, navigation, toasts, record forms; Apex and other online-only calls fail with a note), and runs it in an `allow-scripts` sandbox frame as tall as the iPad's web view (`mobileHeight`, default 400) with SLDS and its touch overrides (`inline-lwc-frame.ts`). Its data requests come back over postMessage and are answered by `studio_lwc_request` (`src/studio/lwc/request.ts`) as the sf CLI connection, not from the iPad's offline copy — UI API GETs and GraphQL queries only. A component that can't compile or throws before drawing falls back to the card read from its template or a placeholder; `inline-lwc.ts`'s offline check is shown under it either way. The iPad preview (`PublishedIpadPreview.tsx`, data from `studio_ipad_published` / `src/studio/published.ts` — the profile's last downloaded metadata cache, resolved with rules ported from the lifesciences-ios client, cached on disk per ContentVersion) switches between **Published**, **Draft** (published with the tray laid on top) and **Side by side** (both at half size, sharing tab, record and scrolling; only the Draft side is selectable); **Edit** makes its blocks selectable (`EditLayer.tsx`, targets in `edit-targets.ts`, draft overlay `edit-draft.ts`, inspector `BlockInspector.tsx`, wiring `usePreviewEdit.tsx`), each with what it is, why the profile sees it, how to change it, and — for record page layouts in Draft — verbs on a floating toolbar (move up/down, other column, heading on/off, required, read only, remove/restore; Backspace removes) plus **Add field…** on a section and **Add related list…** on a related list, each a search picker (`components/ui/SearchPicker.tsx`) over the `available` fields and `availableRelated` child relationships `studio_metadata_doc` reads from a describe (no system fields or compound parts; custom children named `Child.Field`; `relatedListOptions` is shared with the Visit sidebar candidates). An added field goes at the end of the section's first column, drawn from its describe; an added related list is drawn as an empty card and selected, so the inspector offers **Add to iPad sync** when the profile doesn't sync the child. Layout edits are metadata deploys: `studio_metadata_doc` (`src/studio/metadata/live.ts`) reads the layout as it is in the org, `layout-draft.ts` lines the published sections up with it (`alignLayout`, by each section's `source` or field order — if they don't line up the layout changed since the publish and stays explain-only until Publish to iPad), and every verb re-diffs the edited model against the org's (`diffOps`), so the tray holds one `editMetadata` change per layout (`metadata:Layout:<fullName>`) that is dropped when the edits cancel out. The engagement sidebar's add/remove on the Visit board queues into the same change (`layoutChange` / `queuedLayoutOps` in `changes.ts`). The server applies the ops to the retrieved XML (`src/studio/metadata/layout-ops.ts`, fast-xml-parser tree in `xml.ts`, retrieve/deploy in `doc.ts`) and previews them as an XML line diff with the layout's reach; `test/unit/studio/layout-draft.test.ts` checks the renderer's ops deploy to the layout it drew. In Draft, removed fields, sections and related lists stay as ghosts and added or moved ones are outlined (`LayoutEdits` context, `draftClass` in `IpadRecord.tsx`). On a production org (`FixPreview.production`) the review dialog needs an "I want to change production" tick before **Apply to production**. The inspector's **Make a copy just for [profile]** (shared layouts and Lightning pages; `copyForProfile`, `src/studio/metadata/copy-fix.ts`) clones the document and moves only that profile's layout assignment or app page override to it, deleting the copy if the move fails and on undo; later edits to the document in that profile's draft go into the copy's `ops` (`viewFor` / `commitFrom` in `changes.ts`), never onto the shared document. The record header is edited the same way (`compact-draft.ts`): in Draft its fields move left/right, are removed/restored, or are added with **Add field…** (the same search picker, from the compact layout's `available` fields), giving one `editMetadata` change per compact layout (`metadata:CompactLayout:<fullName>`) applied to the XML by `src/studio/metadata/compact-ops.ts`; it lines up with the org by the snapshot's `compactSources`, reaches every profile through the record types assigned it, warns at 7 or more fields (the rest scroll off), and refuses an 11th; `test/unit/studio/compact-draft.test.ts` checks the renderer's ops deploy to the header it drew. Lightning pages (Home and record pages) follow the same pattern (`flexipage-draft.ts`): in Draft, components move up/down within their region or tab, record tabs move left/right or become the default, and either can be removed or restored (a removed tab takes its body along). **Insert component…** opens the search picker on what `studio_component_catalog` (`src/studio/component-catalog.ts`) offers, plus components removed in Draft from the same region, and places the choice after the selected block. Components that need Lightning App Builder are named in the picker's description rather than offered. The inspector has a properties sheet for a selected component (`PropertiesSheet.tsx`; definitions from `studio_component_props` / `src/studio/component-props.ts`: the bundle's `js-meta.xml` for custom LWCs, a curated table for standard and LSC components, then untyped fields for the page's other simple properties): typed fields (text, number with range, switch, picklist, text area) that show the pending value and the org's, with Reset, a typed check (`component-props.ts`; a tab's `title` also warns over 25 characters, which the iPad cuts) and a "Not used on the iPad" note for properties it ignores. Text and numbers queue when the field is left or Enter is pressed, switches and choices at once, so each edit is one undo step; Draft re-renders where the preview reads the property (`mobileHeight`, rich text, Agentforce welcome chips, related-list rows). Each page gets one `editMetadata` change (`metadata:FlexiPage:<fullName>`), applied to the XML by `src/studio/metadata/flexipage-ops.ts`. Items are addressed by `identifier`, else by index, and the component is checked either way. Published blocks line up with the org by their `source` paths (`alignFlexiPage`). A change reaches the profiles that apps assign the page to, plus everyone who gets it as an app default. Managed pages stay explain-only. `test/unit/studio/flexipage-draft.test.ts` checks the renderer's ops deploy to the page it drew. List views (`listview-draft.ts`) are edited the same way: in Draft their columns move left/right, are removed/restored, dragged, or added with **Add column…** (fields from the object's describe), and the inspector edits the filter scope (Everything or Mine, the only scopes the iPad honours), the filter rows and their logic, giving one `editMetadata` change per view (`metadata:ListView:<Object.Name>`) applied to the XML by `src/studio/metadata/listview-ops.ts`; sort isn't editable (the Metadata API has no sort, and the iPad takes it from the org), managed views are explain-only, views on old-style ids (`ACCOUNT.NAME`) take only custom fields, and the published view lines up with the org's by its `source` columns. The inspector says who sees the view (`sharedTo`), and since the iPad lists views from the org when a rep opens them no publish is needed; `test/unit/studio/listview-draft.test.ts` and `edits-listview.test.ts` check the renderer's ops deploy to the list view it drew. In Draft, blocks also drag to reorder (pointer events, not HTML5 drag and drop; Lightning page components and record tabs too, empty layout columns take fields while dragging, the iPad auto-scrolls at its edges and tab-bar pages flip on a half-second hover): `editAttrs` / `Mark` take a `DragSpec` (a family scoping where it can land, its list, an id grouping compound parts, ghost, horizontal), `EditSurface` draws the lifted block and a purple insertion line and calls `onDrop(target, { list, before })`, and `usePreviewEdit.tsx` maps it to the same changes the verbs queue — `moveTabTo` / `moveActionTo` (`edit-draft.ts`, stepping the up/down verbs), `moveFieldTo` (across columns and sections; `DraftField.col` is the model column) / `moveSectionTo` / `moveRelatedTo` (`layout-draft.ts`) and `moveCompactFieldTo` (`compact-draft.ts`) — a drop back in place queuing nothing; ⌥ arrows run the move verbs; a layout with no related lists shows a placeholder card in Draft for **Add related list…**. A custom action's in-app browser loads the page live in a sandboxed `<webview>` with an in-memory session per identity (`studio-browser:<loginId|cli|public>` partitions — `partitionFor`, copied in `browser-auth.ts` and kept equal by a test; https only, popups refused — guarded in `main.ts`'s `will-attach-webview`). Salesforce pages are signed in as the previewed rep (`viewer.userId`) through their mobile login — the same test-user logins First sync uses, which now record `userId` — via the singleaccess endpoint (`mobileLoginFrontdoor` in `src-electron/mobile-login.ts`, needs the token's `web` scope); with no login for the rep the sheet offers **Log in as [rep]…**, another login on the org, or the sf CLI connection (`sf org open --url-only`), remembered per rep for the session (`chooseAuth`). `src-electron/studio-browser.ts` loads the one-time frontdoor link in the main process, so it never reaches the renderer. Feature definitions live in `src/studio/features.ts`; per-object collectors and health checks in `src/studio/collect.ts`; org-wide features (Mobile Sync, Territory & Users, Actions & Home Page) have custom collectors in `src/studio/collectors/`.

**Setup** opens on an **Overview** (`SetupOverview.tsx`, server `src/studio/overview.ts`): an org verdict, "Do this first" steps, org-wide checks (with **Publish to iPad** for profiles whose cache predates Admin Console changes — `overview-logic.ts`), and a card per feature whose readiness loads three at a time, with a Markdown go-live readiness report export (`overview-helpers.ts`). Each feature opens on its **Readiness** view (`ReadinessView.tsx`, helpers in `readiness.ts`) with **All configuration** (the board) one tab away. Readiness comes from `src/studio/readiness/`: `collectReadiness` runs the feature's YAML rules from `knowledge/validation-rules` (per-rule `stage` / `studio_surface`; `executeCheck`'s `unavailable` makes a rule that can't run "couldn't check", never a failure; prerequisites that don't pass skip) beside the TypeScript checks in `features/<featureId>.ts` (registry `modules.ts`; each built with `runCheck`, ids `<featureId>.<stage>.<slug>`, optional parts `skip`), whose fixes are ordinary `StudioFix`es queued with `FixButtons.tsx`. `studio_readiness` and `studio_setup_overview` are cached per org and cleared after apply and publish. **Check a user** (`UserTraceView.tsx`, `src/studio/user-trace.ts`) traces one rep, optionally for one feature (a feature page's "Check a user…" preselects it), and opens the first broken link. **What changed** (`DriftView.tsx`, `src/studio/drift*.ts`) saves configuration snapshots with `collectConfig`, diffs one against the live org record by record (field before → after, mapped to the Studio feature, last modified by), and lists recent changes when no snapshot is chosen.

**Testing → Sync health** (`SyncOverview.tsx`, `studio_sync_overview` / `src/studio/sync-overview.ts`, pure logic in `src/perf/overview.ts`) needs no setup: an org verdict from field telemetry judged against Studio's rules of thumb (`OVERVIEW_THRESHOLDS` — only the metadata target has a published source, and the UI says so), p95 tiles, a daily trend, "Reps who need attention" ranked by an explainable score (delta/initial p90 vs. the org median, failures, records, DB size; territories add a reason) with **Investigate** and **Test these reps** (opens Test plans with the selection as a new draft plan), and DB Schema records worth a look with **Open in Setup**. It issues one telemetry query plus aggregates for the ranked users only. **Testing → Check a rep's sync** (`SyncInvestigate.tsx`, opened for a rep by Sync health's **Investigate**, `studio_sync_user` / `src/studio/sync-user.ts`) shows one rep's tables heaviest first with hints from `explainTable` (`src/perf/table-hints.ts`: no filter on a big table, attachments on, no delta field, dominant share, failed or not-estimated filters, possible overcount); hints with a safe `suggestion` (a 365-day `LastModifiedDate` filter for Task/Event/EmailMessage only, attachments off, `LastModifiedDate` delta field) queue a `setConfigField` fix in the tray, and **Open in Setup** focuses the record (`DbSchema:<DeveloperName>` on Mobile Sync's `syncedObjects`). The review dialog's **Sync impact** section (`studio_sync_impact` / `src/studio/sync-impact.ts`, `applyChanges` in `src/perf/what-if.ts`) appears when a pending change touches DB Schema and, on request, counts the heaviest user of each affected profile (at most 5) before and after, recounting only the changed tables. Test plans exports the customer's go-live sign-off report (`studio_signoff_report` / `src/studio/signoff-report.ts`, verdict lines in `signoff-verdict.ts`), which uses the previous run as its baseline.

**Testing → Test plans** (`src-renderer/components/studio/PerfView.tsx`) is a GUI over `run_perf_assessment`: test plans are NFR profiles edited in `PlanEditor.tsx` (plan-wide and per-persona warn/fail targets, personas with users picked via `studio_perf_users` or a `select: { profile, count, preferSynced }` that each run resolves to the profile's heaviest active users, those who synced in the telemetry window first when `preferSynced` (`findHeaviestUsers` / `resolvePersonaUsers` in `src/perf/users.ts`), checked before running with `studio_perf_check`, which also warns when none of a persona's users synced in the window (`recentSyncCounts`; user search shows each user's sync count); counts run as the connected admin but are scoped by each persona user's table filters — from the compiled `db.json` / `db_ps.json` in the profile's metadata archive when it can be downloaded (`src/perf/compiled-schema.ts`: the newest Active `LifeSciMobileMetadataRecord` for the profile, minus objects the user can't read per ObjectPermissions; no field-level filtering), or — when the persona user has a mobile login in Studio — from that user's own metadata download (`src/perf/user-schema.ts`, schema source `user-download`, falling back with a note on failure or a user-id mismatch; `studio:perfStartMobile` passes the held logins to `studio_perf_start`'s `mobileLogins`, and the Plan tab shows which personas have one), otherwise from the DB Schema records, with each user's source and any compiled-vs-DB-Schema differences in the report — and org-wide counts on objects with restricted sharing are flagged as upper bounds — `scope` / `sharingModel` / `mayOvercount()` in `src/perf/sync-volume.ts`), imported/exported as the same YAML (`studio_perf_parse_plan`), and saved with their run history per org in the Electron app's SQLite (`src-electron/engine/perf-store.ts`, `perf:*` IPC). Runs outlast the 5-minute `studio:call` timeout, so `studio_perf_start` runs the assessment as an in-memory background job (`src/studio/perf.ts`, progress via `runAssessment`'s `onStep` hook) that the view polls with `studio_perf_status` (step, query count, and `progress` — persona, user and tables counted); `studio_perf_active` returns the org's running job so a reopened view can reattach. `RunReport.tsx` shows per-persona metric verdicts with the change since the previous run, predicted volume per user and territory (failed and not-estimated DB Schema filters always shown), and the field-telemetry distributions, notes when the previous run tested a different plan (`planChanges`), a trend over the last 10 runs from the per-run `summary` column (`perf-history.ts`), and, for users with a First sync result on the same instance (`useRunSims.ts`, from `perf_sims` with no org calls), predicted vs simulated records per table with tables over 10% apart or on one side only flagged, and the simulated network-only timing beside the telemetry (`perf-compare.ts`), with **Ask Claude how to fix**, **Use as baseline** (`applyBaseline` turns measured values plus warn/fail margins into persona targets), and Markdown (`studio_perf_report`) or JSON export. The plan editor is tabbed Personas / Targets / YAML, with per-tab issue counts from `planIssues()`; a plan with only the default metadata target shows a prompt to enter the customer's NFR targets (`hasCustomerTargets`). The org selected in the sidebar is pushed to the MCP server with `set_target_org` on start and on change (`sfOrg:changed` tells the view to reload); with no org selected, plans and runs are filed under the server's connected org (`studio_connected_org`), and rows saved with no org are adopted by it (`adoptUnassigned`). Renderer copies of the metric list and result types live in `perf-plan.ts` / `perf-types.ts` — `test/unit/studio/perf-plan.test.ts` fails if the metric labels or default targets drift from `src/perf/nfr.ts`.

**Testing → First sync** (`src-renderer/components/studio/SimulateView.tsx`) is a GUI over `simulate_initial_sync`: the user runs as a **mobile app login** or an sf CLI connection. Orgs answer the mobile sync endpoints (user-info, metadata download) only for logins made through the LSC mobile app's connected app — sf CLI logins get 404 even for users whose iPads sync — so **Sign in a test user…** (Studio → Testing → Test users, or inline beside the iPad preview, First sync and test plans) opens a Salesforce login window — an ordinary window with a Back / Forward / Reload / host / Cancel toolbar over the page, Escape to close (`src-electron/login-window.ts`) (`src-electron/mobile-login.ts`: the consumer key — `remoteAccessConsumerKey` from the iOS app's `bootconfig.plist`, never checked in — comes from Studio Settings ("LSC mobile app consumer key", saved in userData/settings.json), falling back to the `LSC_MOBILE_CLIENT_ID` env var, read at login time; the login fails with that instruction when neither is set; web-server flow with PKCE and no secret; the `mobilesfdc://` redirect is intercepted; a fresh in-memory partition and `prompt=login` per login). Test-user logins belong to an org (compared by 15-character org Id) and are remembered in the OS keychain (`secrets.ts`, key `mobile-logins`, only logins with a refresh token) until forgotten; each has a `status` — `signedIn`, or `expired` when a refresh is rejected (400/401; network errors and 5xx keep it), with `mobileLogin:check` renewing those not used lately and `mobileLogin:changed` telling the renderer (`useMobileLogins`). Tokens stay in the Electron main process, refreshed before a run when older than 15 minutes; `studio:simStartMobile` passes one to `studio_sim_start`'s `mobileLogin` for that job only (`createTokenSession` in `src/perf/device/session.ts`, which only sends tokens to Salesforce HTTPS hosts — `isSalesforceUrl`), and it is never returned or sent to the renderer (`mobileLogin:list` gives username, org, instance and status only). Wherever Studio acts as a rep, a `TestUserChip` says whose login it uses ("As Carmen", "As your admin login" with **Sign in as Carmen…**, or "login expired"); the iPad preview passes the rep's login down in `RepLoginContext` so live inline LWCs load as them (`studio:lwcRequestAs`), First sync defaults to the org's first signed-in test user with sf CLI connections under "Use an sf CLI connection instead", and `studio:perfStartMobile` passes only the selected org's signed-in logins (at most 25). **Add sf CLI connection…** opens `sf org login web` (`sfOrg:login`) and watches `sf org list` for the new username (`newConnections` in `sim-types.ts`). Options are territory, a time limit, and under Advanced the sync flow, per-table and total record caps, and only/skip object lists. `studio_sim_start` runs the simulation as an in-memory background job (`src/studio/simulate.ts`, one at a time so runs don't skew each other's timings; progress via `simulateInitialSync`'s `onStep` and the replay's `onTable` hooks) that the view polls with `studio_sim_status`; cancelling aborts in-flight requests and keeps the partial result. The **Runs** option (1–5; `options.runs`) repeats the simulation back to back as the same login in one job (`src/studio/sim-runs.ts`): total, metadata, data and per-table seconds are medians across runs, the result's `runs` field carries per-run totals and min–max spread, everything else comes from the run closest to the median, and a note flags counts that differ between runs. The replay schedules tables like the iOS app (`SmartQueue` in `src/perf/device/replay.ts`, mirroring `SmartOperationQueue`): concurrency ramps from 1 to at most 4 (legacy 3) while the running tables' complexity plus the oldest unfinished one's stays within 7 open query locators, complexity being 1 plus the `select`s in the WHERE (`whereComplexity` in `schema.ts`, as `MetadataDatabaseTable`); phases are OT2A, Account, then the rest with DeviceSyncTransactionRecord in the main list, then the finalize steps for postponed content tables, with DSTR's repeated runs summed into one row. The **Network** option (beside Runs; `options.network`) shapes every simulator request through `shapeHttp` in `src/perf/device/session.ts` (`NetworkShaper` in `src/perf/device/network.ts`): one RTT per request plus downlink/uplink token buckets shared by concurrent requests, with 3G / 4G/LTE / 5G / Wi-Fi presets that are approximate (not taken from a published source — `NETWORK_PROFILES`, copied in `sim-types.ts` and kept equal by a test) or Custom; shaping can only slow this machine's link down, and `realLinkNote` flags a real link slower than the profile. The device http layer only sends credentials to relative paths or HTTPS Salesforce hosts, gzips request bodies marked `gzip: true` by the app's rule (Connect URLs, 4 KB or more, when smaller — `prepareRequestBody`), and counts on-the-wire response bytes (`wireBytes`); legacy composite batches are sized dynamically like `DownloadManager` and metadata Range chunks follow the device RAM table (`chunkBytesForRam`). Under Advanced, **delta sync** (`options.delta: { sinceHours }`, enhanced flow only; `src/perf/device/delta.ts`) keeps the downloaded ids per table (`LocalIdStore`, capped at 2M), then replays the record-visibility rounds (light tables 5 per request in sequential rounds, tables over 10,000 ids alone 6 in flight, content tags sliced at 1,500 ids) and the IdSubquery downloads of `toDownload`, as `SyncConnectVisibilityLoader` does; DSTR's delta is not simulated, and because the simulated device holds exactly what it just downloaded, `toDownload` may understate a real device's delta. **Content downloads** (`options.content`; `src/perf/content.ts`, fed by the replay's `onRecords` hook) run after the data and delta sync and are reported apart from the sync totals: background-attachment bodies one GET at a time, and CLM presentations (Active, in their date window, as `CLMDataService` / `CLMDownloadService` pick them) 4 at a time in 10 MiB Range chunks with an MD5 check; bodies are counted and discarded, caps are per kind (default 200 files, 2 GiB), the app's `parentSid` auth and post-view writes are not replicated, and with several runs content runs once, in the last run, while delta seconds are medians across runs. Finished and cancelled results are kept in the `perf_sims` table (`perf:listSims` etc. in `perf-store.ts`) across every org — each row records the instance URL it ran against — and shown with total, metadata and data download time, records, and per-table timings slowest first, with Markdown (`studio_sim_report`) or JSON export. Renderer copies of the result types live in `sim-types.ts`.

### Resources

| Resource | Description |
|----------|-------------|
| `lsc://modules` | List of all modules with documentation counts |
| `lsc://overview` | Overview of LSC4CE capabilities and architecture |

### Prompts

| Prompt | Description |
|--------|-------------|
| `lsc_implementation_checklist` | Generate implementation checklist for a module |
| `lsc_troubleshoot` | Get help troubleshooting an LSC issue |

## LSC4CE Modules (with Documentation)

| Module | Coverage | Key Topics |
|--------|----------|------------|
| **Account Management** | ✅ Full | Provider Card, Addresses, Affiliations, Ratings, Search/SBC, Data Change Requests, Business Licenses, Multi-Object Component |
| **Visit Management** | ✅ Full | Page Layout Config, Admin Console, Web & Mobile demos |
| **Sample Management** | ✅ Full | Inventory, Sample Limits Admin Setup |
| **Activity Plan** | ✅ Full | Account Goals, Weighted Plans, Product-based Plans, Shared Territory Goals, Admin Console |
| **Territory Alignment** | ✅ Admin | Admin configuration and setup |
| **User Management** | ✅ Full | Permission sets, PSLs, profiles, role hierarchy, license capacity, user provisioning |
| **Consent Management** | ✅ Demo | Demo talk track |
| **Lists & Filters** | ✅ Full | Transcript available |
| **Field Email** | ✅ Full | iPad, Web Admin, Web End User |
| **Intelligent Content** | ✅ Full | Content Management Admin, Presentation Settings, Dynamic Content, Mobile End User |
| **Home Page** | ✅ Full | Home Page configuration |
| **Calendar/TOT/Routine** | ✅ Full | Calendar, Time Off Territory, Routines, My Team |
| **Surveys** | ✅ Full | Survey configuration |
| **Product Management** | ✅ Full | Product setup and management |
| **App Alerts/Notifications** | ✅ Full | Admin + End User |
| **Next Best (NBC/NBA/NBM)** | ✅ Full | Next Best Customer, Action, Message |
| **Key Account Management** | ✅ Full | KAM Account Plans (Web & Mobile), E2E Demo |
| **Segmentation** | ✅ Admin | Admin-only configuration |
| **Workflow Management** | ✅ Demo | Generic workflow |
| **Agentforce for LSC** | ✅ Winter'26 | Agentforce enablement |
| **Data Cloud/Singularity** | ✅ Demo | TabNext Metrics, NBC Predictive Model |
| **LSC Apps** | ✅ Demo | App configuration |
| **Briefings (Daily Podcasts)** | ✅ Full | Setup, troubleshooting, mobile config, DB Schema, validation rules |
| **Mobile Metadata Cache** | ✅ Full | Programmatic generation, DB Schema configuration, DB Schema record management |
| **Starter Config** | ✅ Full | LSStarterConfig — bulk-configure trigger handlers, admin settings, DB Schema in one shot (Spring '26) |
| **Custom Scripts** | ✅ Full | Validation + checklist LWC patterns, IIFE/CodeText conventions, Locker Service gotchas, Visit Action Validation |

### Recent Additions (Oct 2026)

**Winter '27 (Release 264) official release notes** — `knowledge/release-notes/winter-27-official.md` (retrievable with `get_release_notes`, slug `winter-27-official`) covers the full Life Sciences section: new/changed objects, invocable actions, Connect API, and every feature by area. Module docs use the `release-264-*` prefix and now span 20+ modules, including new coverage for relevance-based account search, activity plan cloning/mobile review, verbal/paper consent, offline & nested custom LSC apps, the KAM and first-visit AI coding agent skills, the Content Ingestion API, Event Management trigger handlers, and Digital Verification.

### Recent Additions (Jun 2026)

**LSC4CE Value Chain Training (Engineering → Support, 15 sessions, 18 files)** — Deep support-engineering content spanning Feb 2026 → Jun 2026 across 14 modules. Topics: Sync internals, Search Before Create (internal + OneKey), Medical Inquiry multi-entity setup, KAM Account Plan deep dive, Consent Management proof + filtering, Quick & Custom Actions (Spring '26 + evergreen config guide), Validations via Custom Scripts, LSStarterConfig, Territory Alignment Jobs, Activity Plan, Activity Timeline, Visit Management (configuration + troubleshooting + side menu), Intelligent Content, Generic Workflow. Files use the `support-engineering-*` prefix (evergreen) or `release-260-*` (Spring '26-specific). Two new modules introduced: `starter-config/`, `custom-scripts/`.

### Supplementary Module Directories

Additional `knowledge/modules/` directories beyond the table above: `clinical-site-management`, `enablement-coaching`, `field-events-management`, `field-sales-rep-e2e-demo-flow`, `insdoc`, `insights`, `kam-end-to-end-demo`, `medical-inquiries`, `order-management`, `patient-services`, `provider-engagement-compliance`, `remote-engagement`, `sales-chart`, `spm-integration`.

### Technical Components
- **Data Model**: Industry objects (PersonAccount, Address, Affiliation, etc.)
- **OmniStudio**: FlexCards, OmniScripts, DataRaptors, Integration Procedures (**web app only — NOT available in LSC Mobile/iPad**)
- **Business Rules Engine**: Validation, calculations, automation
- **Analytics**: Reports, dashboards, CRM Analytics templates

### CRITICAL: LSC Mobile Constraints
- **OmniStudio components (FlexCards, OmniScripts, DataRaptors) are NOT available anywhere in the LSC Mobile app (iPad).** NEVER suggest OmniStudio as a solution for mobile customization. OmniStudio is only available on the web app.

## Project Structure

```
LSC-for-Claude/
├── .claude-plugin/           # Plugin manifest
│   └── plugin.json           # Plugin metadata (name, version, etc.)
├── skills/                   # Agent Skills (auto-invoked by Claude)
│   ├── lsc-implementation/
│   │   └── SKILL.md
│   ├── lsc-troubleshoot/
│   │   └── SKILL.md
│   ├── lsc-mobile-validation/
│   │   └── SKILL.md          # Mobile/iPad app configuration validation
│   ├── salesforce-query/
│   │   └── SKILL.md
│   └── lsc-data-model/
│       └── SKILL.md
├── commands/                 # User-invocable slash commands
│   ├── setup-plugin.md       # /lsc:setup-plugin
│   ├── soql-query.md         # /lsc:soql-query
│   ├── describe.md           # /lsc:describe
│   ├── help.md               # /lsc:help
│   ├── docs.md               # /lsc:docs
│   ├── validate-mobile.md    # /lsc:validate-mobile
│   ├── generate-metadata-cache.md  # /lsc:generate-metadata-cache
│   ├── audit.md              # /lsc:audit
│   └── open-org.md           # /lsc:open-org
├── agents/                   # Specialized subagents
│   ├── lsc-consultant.md     # Implementation consultant
│   ├── lsc-admin.md          # Administrator
│   └── lsc-developer.md      # Developer
├── .mcp.json                 # MCP server configuration
├── CLAUDE.md                 # This file
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
├── src/                      # MCP server source
│   ├── index.ts              # MCP server entry point
│   ├── knowledge-loader.ts   # Knowledge base loader and search
│   ├── salesforce/           # Salesforce org integration
│   │   ├── index.ts          # Module exports
│   │   ├── cli.ts            # SF CLI wrapper
│   │   └── auth.ts           # Org detection, selection
│   └── validation/           # Configuration validation system
│       ├── index.ts          # Module exports
│       ├── rules-loader.ts   # YAML rule file parser
│       └── rules-executor.ts # Rule execution engine
├── scripts/
│   ├── process-docs.sh       # Convert .docx to markdown (calls process-pdfs.sh)
│   └── process-pdfs.sh       # Convert PDFs to markdown
├── documentation/            # Source documentation
│   ├── pm enablement materials/  # PM enablement (.docx files)
│   ├── official help documentation/  # Salesforce help PDFs (served live via MCP, not bundled)
│   ├── hands-on exercises/   # Training exercises (2 PDFs)
│   ├── life_sciences_dev_guide.pdf  # Developer guide (27MB)
│   ├── SE LSC Mobile Setup and Configuration Guide.pdf  # Mobile setup (7.6MB)
│   └── common_issues.md      # Troubleshooting guide
├── knowledge/                # Processed knowledge base (markdown)
│   ├── modules/              # PM enablement content (29 module directories, incl. data-cloud-data-kit)
│   ├── help/                 # Official help served live via salesforce-docs MCP (not bundled)
│   ├── guides/               # Dev guide, mobile setup guide (2 files)
│   ├── exercises/            # Hands-on training (2 files)
│   ├── troubleshooting/      # Common issues (1 file)
│   └── validation-rules/     # Configuration validation rules
│       ├── _schema.yaml      # Rule format documentation
│       └── mobile-config.yaml # Mobile configuration rules (15 rules)
└── dist/                     # Compiled JavaScript
```

## Installation & Usage

### Prerequisites
- Node.js 18+
- Claude Code 1.0.33 or later
- Salesforce CLI (auto-installed if missing)

### Build the Plugin
```bash
npm install
npm run build
```

### Load as a Plugin

**Option 1: Development mode (recommended for testing)**
```bash
claude --plugin-dir /path/to/LSC-for-Claude
```

**Option 2: Add to a marketplace for distribution**
See [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

### Available Commands

Once loaded, you can use:
- `/lsc:setup-plugin` - Check setup and connect to Salesforce
- `/lsc:soql-query <soql>` - Run a SOQL query
- `/lsc:describe <object>` - Describe a Salesforce object
- `/lsc:help <topic>` - Search LSC documentation by topic
- `/lsc:docs` - Browse LSC documentation by category

### Available Agents

Invoke specialized agents with `/agents`:
- `lsc:lsc-consultant` - Implementation consulting
- `lsc:lsc-admin` - Administration tasks
- `lsc:lsc-developer` - Development tasks

### Salesforce Org Setup

When you first use the plugin:

1. **Check setup status**: Run `/lsc:setup-plugin`
2. **Install SF CLI** (if needed): The plugin offers to install it
3. **Authenticate to your org**: `sf org login web --alias my-lsc-org`
4. **Select target org**: Use `set_target_org` if you have multiple orgs

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Setup Flow                         │
├─────────────────────────────────────────────────────────────┤
│  1. Check if SF CLI exists                                  │
│     ├─ Yes → Check for authenticated orgs                   │
│     └─ No  → Offer to install via npm                       │
│                                                              │
│  2. Check for authenticated orgs                            │
│     ├─ Found → Auto-select or let user choose               │
│     └─ None  → Guide through sf org login web               │
│                                                              │
│  3. Ready to use!                                           │
│     • Use /lsc:* commands                                   │
│     • Query LSC data                                        │
│     • Get implementation guidance                           │
└─────────────────────────────────────────────────────────────┘
```

### Development
```bash
npm run dev      # Run with hot reload
npm run test     # Run tests
npm run lint     # Lint code
```

## Development Guidelines

### Code Style
- TypeScript with strict mode
- ESLint + Prettier for formatting
- Conventional commits for version control

### Adding New Content
1. **New object docs**: Add to `knowledge/objects/{ObjectName}.md`
2. **New patterns**: Add to `knowledge/patterns/{pattern-name}.md`
3. **New tools**: Implement in `src/tools/` and register in `src/index.ts`

### Salesforce calls in large orgs
- **Every sf call goes through one limiter** (`src/salesforce/limiter.ts`, `LSC_SF_CONCURRENCY`, default 6): `execSfCommand` and `apiRequest` hold a slot only around the leaf call, so nested fan-out can't deadlock. Don't spawn `sf` yourself.
- **SOQL and REST GETs try a direct REST path first** (`src/salesforce/direct.ts`): the sf CLI's own login (`sf org auth show-access-token` — `sf org display` now redacts tokens; `readOrgLogin`) over keep-alive `fetch`, paging `nextRecordsUrl`, ~10× faster than spawning `sf`. Tokens only go to the org's https instance URL; anything it can't do (no token, network/proxy/TLS trouble, URLs over 15,000 chars) falls back to the CLI, and a network failure turns it off for that org for the session. `LSC_SF_DIRECT=0` turns it off.
- **Queries never truncate silently.** `runSoqlQuery` reads at most `maxRows` (default 50,000) and sets `truncated` when more matched; Studio's `query()` (`src/studio/helpers.ts`) throws `QueryTruncatedError` then unless `allowTruncated`. Use `COUNT()` / `countGroupedBy` (IN-list chunks, under the 2,000-group aggregate limit) instead of reading rows to count them, and announce any cap with `showingNote`. A query that runs past its timeout reports `timedOut`; readiness turns it into "couldn't check". `LSC_SF_MAX_QUERY_ROWS` lowers the cap for every query, to rehearse a large org's truncation paths on a small one.
- **Sync volume is never "pass" when incomplete**: tables whose count failed, timed out or hit a cap are `lowerBound` / `sourceFailed` / `timed-out`, the metric is `incomplete` (rolls up to warn) and reports say how many tables couldn't be counted.
- **The published iPad's live data says what it couldn't read.** Each native screen has 90 s (`SCREEN_TIMEOUT_MS` in `src/studio/screens/index.ts`), the Reports tab 90 s and the records step 60 s. Screen reads fail soft through `softFail` (`src/studio/screens/context.ts`), which records a `ctx.note` only for scale errors (`isScaleError`: truncation, timeouts, limits, network) — a missing object stays silent. Notes come back as `dataNotes`, shown under the preview, and a load with notes isn't cached. Account-list, NBC and Activity Plans filter members are counted on the server with a semi-join on the Account sync filter (`heldMembers` in `screens/accounts.ts`; filters that already have a semi-join, or objects the org won't take as one, read at most 20,000 membership rows and say the count is a minimum), keeping the first 2,000 member ids by name. The Accounts sidebar reads at most 2,000 own and 2,000 others' lists and counts the first 100; the Calendar's accounts pane holds the first 2,000 by name; the Reports tab reads the first 10,000 reports. `studio_ipad_published` gets 8 minutes over IPC.
- **Short shared reads** (`src/config/read-cache.ts`): Admin Console categories, territories and the flow list are shared for 60 s by concurrent Studio surfaces; any write through `execSfCommand` / `apiRequest` drops them.
- **The app's Studio cache** (`studio-cache.ts`, policy in `studio-cache-policy.ts`) keeps results for 24 h (Sync health and Check a rep's sync for 1 h — `ttlFor`) and at most 400 rows, never keeps results cut short by something transient (timeouts, truncation, network errors — a missing object is the org's answer and is kept), `studio:call` returns `cachedAt` with each result (shown as "Updated 12 min ago" by `ui/UpdatedAgo.tsx` beside Sync health's and Check a rep's sync's Refresh), and identical concurrent `studio:call`s share one load (`in-flight.ts`). Long lists render the first 200 with "Show N more" (`ui/Limited.tsx`).

### Testing
- Unit tests for all tools
- Validate documentation accuracy against Salesforce docs
- Test with real LSC sandbox when possible

## Resources

- [Salesforce LSC Documentation](https://help.salesforce.com/s/articleView?id=sf.health_life_sciences.htm)
- [Official Salesforce CLI MCP](https://github.com/salesforcecli/mcp)
- [MCP Specification](https://modelcontextprotocol.io/)
- [OmniStudio Documentation](https://help.salesforce.com/s/articleView?id=sf.omnistudio.htm)
