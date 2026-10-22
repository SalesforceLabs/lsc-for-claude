# Claude for Life Sciences Cloud (LSC)

[![Version](https://img.shields.io/github/package-json/v/SalesforceLabs/lsc-for-claude?label=version)](https://github.com/SalesforceLabs/lsc-for-claude/releases)
[![CI](https://github.com/SalesforceLabs/lsc-for-claude/actions/workflows/ci.yml/badge.svg)](https://github.com/SalesforceLabs/lsc-for-claude/actions/workflows/ci.yml)
[![Build Desktop App](https://github.com/SalesforceLabs/lsc-for-claude/actions/workflows/build-app.yml/badge.svg)](https://github.com/SalesforceLabs/lsc-for-claude/actions/workflows/build-app.yml)
[![Release](https://github.com/SalesforceLabs/lsc-for-claude/actions/workflows/release.yml/badge.svg)](https://github.com/SalesforceLabs/lsc-for-claude/actions/workflows/release.yml)

A [Claude Code](https://claude.ai/code) plugin that brings expert LSC knowledge, Salesforce org tools, and implementation guidance directly into your terminal. The MCP server also works on its own with other AI coding tools such as OpenAI Codex and Cursor; see [Use with Codex and other MCP clients](#use-with-codex-and-other-mcp-clients).

<p align="center">
  <img src="docs/media/export-config-demo.gif" alt="Exporting LSC DB Schema configuration from the terminal and generating a browsable HTML report" width="820">
</p>

<p align="center"><sub><code>/lsc:export-config</code> — snapshot org configuration and generate a browsable HTML report in one step</sub></p>

## What It Does

This plugin gives Claude deep expertise in Salesforce LSC for Customer Engagement (LSC4CE), enabling it to:

- **Guide implementations** across 29 LSC modules with best practices, correct object names, and source citations
- **Run interactive configuration wizards** for visits, samples, accounts, activity plans, territory alignment, users, home page, and quick actions
- **Inspect and manage** your Salesforce LSC org directly — SOQL, CRUD, Tooling API, metadata deploy/retrieve, anonymous Apex
- **Configure Admin Console settings** programmatically — Application Settings, DB Schema, trigger handlers, Quick/Custom Actions, navigation tabs, and more
- **Audit configurations** with 151 validation rules across 19 rule files to catch misconfigurations before they cause issues
- **Troubleshoot issues** using LSC-specific knowledge and automated diagnostics
- **Validate mobile configurations** before deployment — metadata cache, sync settings, DB Schema records
- **Generate mobile metadata cache** programmatically via the Connect API
- **Explain LSC concepts** like ARC, Sample Limits, NBC/NBA/NBM, DCR, Agentforce, and more — with source citations linking to documentation files and Salesforce help URLs
- **Compare orgs** side-by-side to identify configuration drift between environments
- **Export/import configurations** as JSON for org-to-org migration
- **Manage users** — permission sets, PSLs, profiles, role hierarchy, and license capacity

## Quick Start

### Prerequisites

- [Claude Code](https://claude.ai/code) 1.0.33+
- Node.js 18+
- A Salesforce org with LSC (optional, for org tools)

### Installation

**Option 1: Plugin Marketplace (Recommended)**

In Claude Code, run:
```
/plugin marketplace add SalesforceLabs/lsc-for-claude
/plugin install lsc@lsc
```

This installs the plugin directly — no `npm install` or build step needed. The bundled MCP server ships in `mcp-server/index.mjs`.

**Option 2: Local Development (Recommended)**

```bash
git clone https://github.com/SalesforceLabs/lsc-for-claude.git
cd lsc-for-claude
npm install
npm run build
claude --plugin-dir ./lsc-for-claude
```

### First-Time Setup

Run `/lsc:setup-plugin` to check your environment and connect to a Salesforce org:

```
/lsc:setup-plugin
```

The plugin will guide you through:
1. Installing Salesforce CLI (if needed)
2. Authenticating to your LSC org
3. Selecting a target org for queries

### Bundled MCP Servers

The plugin ships two MCP servers, both declared in [`.mcp.json`](.mcp.json):

| Server | Transport | Purpose |
|--------|-----------|---------|
| `lsc` | local (`node dist/index.js`) | The plugin's own 60+ tools — knowledge base, org/Tooling operations, config import/export |
| `salesforce-docs` | remote (HTTP) | Live official Salesforce Help documentation search, used by the `lsc-docs-researcher` agent |

**Enabling the remote docs server:** Because `salesforce-docs` is declared in a project-scoped `.mcp.json`, Claude Code asks you to **approve** it the first time you open the project. If you dismissed that prompt (or started the session before the entry existed), the server stays disabled and the `lsc-docs-researcher` agent will fail to spawn with a "zero tools" error.

To check status or enable it, run:

```
/mcp
```

Select `salesforce-docs` and enable/reconnect it, then restart the session if needed. The server requires no API keys or authentication — if it still won't connect, confirm you're on Claude Code 1.0.33+ (remote MCP support) and that `https://salesforce-docs-76258744c9d7.herokuapp.com/api/mcp` is reachable from your network.

### Use with Codex and other MCP clients

The `lsc` server is a standard [MCP](https://modelcontextprotocol.io/) server over stdio, so any client that can launch a local MCP server can use its tools: OpenAI Codex CLI, Cursor, VS Code agent mode, Windsurf, Cline, Gemini CLI and others. Clone the repo (no build needed; the server is prebuilt in `mcp-server/index.mjs`), install the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli), and log in to your org with `sf org login web`.

**Codex CLI:**

```bash
codex mcp add lsc -- node /path/to/lsc-for-claude/mcp-server/index.mjs
```

Then raise the tool timeout in `~/.codex/config.toml`. Deploys, health checks and performance runs on a large org can take several minutes, longer than Codex's default:

```toml
[mcp_servers.lsc]
command = "node"
args = ["/path/to/lsc-for-claude/mcp-server/index.mjs"]
tool_timeout_sec = 600
```

If your company manages Codex with an approved list of MCP servers, `lsc` won't load until an admin adds it to that list.

**Other clients** take the same command and arguments in their own MCP config, for example Cursor's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "lsc": {
      "command": "node",
      "args": ["/path/to/lsc-for-claude/mcp-server/index.mjs"]
    }
  }
}
```

**What you get outside Claude Code:** every tool, plus the resources and prompts. The server sends its usage rules when the client connects (which tools to use for Admin Console and DB Schema records, correct LSC object names, how to pick an org), and clients that support MCP server instructions pass them to the model. You don't get the `/lsc:` commands, the auto-invoked skills or the agents; those are Claude Code plugin features. The tool descriptions and prompts were written and tested with Claude, so other models may need more direction.

## Desktop App (LSC Assistant)

The plugin ships an optional **LSC Assistant** desktop app — a standalone chat UI (Electron + React) backed by the same knowledge base, skills, and Salesforce org tools as the plugin. Use it when you want a dedicated window with conversation history, a saved-answer library, and inline Mermaid/PDF rendering, outside of Claude Code.

### Launch it

From inside Claude Code:

```
/lsc:launch-app
```

This builds the app from source on first run (installs dependencies, compiles the MCP server + Electron bundles, rebuilds native modules) and then opens the window. It's idempotent — subsequent runs just relaunch. **Prerequisites:** Node.js 18+ and npm. No downloads or code signing are involved.

You can also run it directly:

```bash
bash scripts/launch-electron-app.sh
# or, for development with hot reload:
npm run electron:dev
```

### Prebuilt downloads (macOS)

CI also packages the app as a `.dmg`/`.zip` — download the installers from a
tagged **Release**, or from the **Build Desktop App** workflow run (Actions tab →
run → Artifacts) for any commit.

Release builds are signed with a Developer ID certificate and notarized by
Apple, so they open with no prompt. Builds from the **Build Desktop App**
workflow are unsigned, and macOS Gatekeeper blocks them on first open. To open
one:

- **Right-click the app → Open**, then confirm (only needed the first time), or
- strip the download-quarantine flag:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/LSC Assistant.app"
  ```

The quarantine flag is only applied to files downloaded via a browser — an app
built locally with `/lsc:launch-app` isn't affected.

### Cutting a release

```bash
scripts/bump-version.sh 0.2.3     # bump all three manifests, commit, tag v0.2.3
git push --follow-tags            # the Release workflow builds, signs and notarizes
scripts/publish-release.sh v0.2.3 # then publish it (see below)
```

The SalesforceLabs org has an IP allow list that GitHub's hosted runners aren't
on, so the workflow can't create the GitHub Release itself. It uploads the
signed installers as a run artifact instead, and `publish-release.sh` waits for
the run, downloads them and creates the release from your machine (you need to
be on an allowed network, with `gh` logged in as an account that can write to
the repo).

### First-run onboarding

The first time the app opens, it asks how to connect to Claude:

- **Anthropic API key** — paste an `sk-ant-…` key from [console.anthropic.com](https://console.anthropic.com/settings/keys). Stored locally; only sent to Anthropic.
- **Bedrock / custom gateway** — a base URL for any Anthropic-compatible endpoint (e.g. an Amazon Bedrock proxy or internal LLM gateway) plus an API key/token (sent as `x-api-key`).

If you already have `ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BEDROCK_BASE_URL`, set in your environment, the app auto-detects them and connects without prompting. You can switch providers or Salesforce orgs later from **Settings**.

### Troubleshooting

- **Window never appears / native module error:** the build log is at `$TMPDIR/lsc-assistant.log`. The usual fix is rebuilding the SQLite native module for Electron: `npx @electron/rebuild -f -w better-sqlite3`.
- **Rebuild everything:** `LSC_FORCE_BUILD=1 bash scripts/launch-electron-app.sh`.

## Commands

| Command | Description |
|---------|-------------|
| `/lsc:setup-plugin` | Check plugin status and connect to Salesforce |
| `/lsc:soql-query <soql>` | Run a SOQL query against your org |
| `/lsc:describe <object>` | Describe a Salesforce object's fields |
| `/lsc:help <topic>` | Search the LSC knowledge base by topic |
| `/lsc:docs` | Browse and navigate LSC documentation by category |
| `/lsc:audit [group]` | Audit configuration against validation rules |
| `/lsc:validate-mobile` | Validate mobile app configuration |
| `/lsc:generate-metadata-cache` | Generate mobile metadata cache |
| `/lsc:configure-home-page` | Configure and validate home page |
| `/lsc:configure-quick-actions` | Configure quick and custom actions |
| `/lsc:configure-visits` | Configure and validate visit management |
| `/lsc:configure-samples` | Configure and validate sample management |
| `/lsc:configure-accounts` | Configure and validate account management |
| `/lsc:configure-activity-plan` | Configure and validate activity plans |
| `/lsc:configure-territory` | Configure and validate territory alignment |
| `/lsc:configure-users` | Configure and validate user management |
| `/lsc:open-org` | Open the Salesforce org in the browser |
| `/lsc:diff-orgs` | Compare configuration between two Salesforce orgs |
| `/lsc:health-check` | Run a comprehensive LSC org health check |
| `/lsc:release-notes` | View LSC release notes by Salesforce release |
| `/lsc:export-config` | Export LSC org configuration as JSON |
| `/lsc:import-config` | Import LSC configuration from JSON export |
| `/lsc:status` | Dashboard view of the connected LSC org |
| `/lsc:getting-started` | Interactive onboarding and capability discovery |
| `/lsc:launch-app` | Build and launch the LSC Assistant desktop app |

## Skills (Auto-Invoked)

Claude automatically activates the right skill based on what you're asking about. Skills are thin routing layers (60–200 lines) that direct Claude to call MCP tools for sourced documentation — they don't embed knowledge inline. There are 36 skills covering every major LSC module:

| Skill | Description |
|-------|-------------|
| `lsc-implementation` | Guides module implementations with best practices |
| `lsc-implementation-review` | Reviews a design against field-observed anti-patterns and flags known-bad decisions before go-live |
| `lsc-troubleshoot` | Diagnoses and resolves LSC issues |
| `lsc-mobile-validation` | Validates mobile app configuration (DB Schema, sync settings) |
| `lsc-mobile-app-settings` | Manages mobile Application Settings (browser, password, search, notifications) |
| `lsc-home-page-configuration` | Home page setup including Agentforce Welcome Center utterances |
| `lsc-quick-actions-configuration` | Quick actions and custom actions for web and mobile |
| `lsc-visit-management` | Visit management configuration for web and mobile |
| `lsc-sample-management` | Sample inventory and sample limits configuration |
| `lsc-account-management` | Account management (addresses, affiliations, licenses, DCR, search) |
| `lsc-activity-plan` | Activity plan configuration (goals, weighted plans, measures) |
| `lsc-territory-alignment` | Territory alignment (explicit assignments, geo/affiliation rules) |
| `lsc-key-account-management` | KAM account plans, objectives, action plans, stakeholders |
| `lsc-lists-filters` | Account lists, dynamic filters, static lists, bulk actions |
| `lsc-field-email` | Field email setup — templates, jobs, queue, consent integration |
| `lsc-intelligent-content` | CLM/presentation management — upload, distribution, tracking |
| `lsc-calendar-tot-routine` | Calendar, Time Off Territory, routines, Planner Administration |
| `lsc-surveys` | Survey configuration, sharing, launch points, response tracking |
| `lsc-product-management` | Product hierarchy, territory alignment, messages/objectives |
| `lsc-app-alerts` | App alerts and notifications — creation, targeting, deep links |
| `lsc-next-best` | NBC/NBA/NBM configuration — data model, widgets, Einstein Studio |
| `lsc-consent-management` | Consent capture, communication subscriptions, compliance snapshots |
| `lsc-agentforce` | Agentforce for LSC (Winter '26) — Field Sales Agent, topics, actions |
| `lsc-db-schema` | DB Schema records (mobile object sync, SOQL filters, enable/disable) |
| `lsc-user-management` | User provisioning, permission sets, PSLs, profiles, role hierarchy, licenses |
| `lsc-data-model` | Expert knowledge of the LSC data model |
| `lsc-health-check` | Guides org health assessment and configuration verification |
| `lsc-data-migration` | Guides data loading and migration (Veeva CRM, account hierarchies) |
| `lsc-integration-patterns` | Guides integration patterns (MDM, ERP, IQVIA, email/video providers) |
| `lsc-reporting-analytics` | Guides CRM Analytics, reports, dashboards, and KPI configuration |
| `salesforce-query` | Helps construct and execute SOQL queries |

## Example Usage

### First-time setup

```
/lsc:setup-plugin
```

```
Checking Salesforce CLI... ✓ sf v2.42.6
Checking authenticated orgs... 2 orgs found

Which org would you like to use?
1. my-lsc-sandbox (sandbox) — last used 2 days ago
2. lsc-uat (sandbox)

> 1

Target org set to: my-lsc-sandbox
You're ready to use all LSC tools.
```

---

### Implementation guidance

Ask about any module in plain English — Claude activates the right skill automatically:

```
How do I set up Visit Management with product detailing and mobile signature capture?
```

```
Here's how to configure Visit Management end-to-end:

## 1. Record Types
Create matching record types on both Visit and ProviderVisit:
- Visit: "Detail Visit", "Remote Visit"  ← Setup > Object Manager > Visit > Record Types
- ProviderVisit: same names            ← Setup > Object Manager > ProviderVisit > Record Types

⚠️  Record type names MUST match between Visit and ProviderVisit — mismatches
    prevent the detailing summary from saving.

## 2. Product Detailing
In Admin Console > Visit Settings > Product Detailing:
- Enable: Product Detailing Enabled = true
- Set: Default Detailing Mode = "Standard"

## 3. Signature Capture
Create a ComplianceStatementDef record:
  Module:        Visit
  StatementType: Pre-Call
  IsActive:      true
  Body:          "I confirm this interaction complies with company policy."

## 4. Mobile Metadata Cache
After all settings are saved, regenerate the cache for affected profiles:
  /lsc:generate-metadata-cache
```

---

### Run a configuration wizard

```
/lsc:configure-visits
```

```
## Visit Management Configuration Report

### Overall Status: NEEDS ATTENTION

### Visit Record Types
- Visit record types: 2 (Detail Visit, Remote Visit)
- ProviderVisit record types: 1 (Detail Visit)
- Alignment: ⚠️  MISMATCHED — "Remote Visit" missing from ProviderVisit

### Product Detailing
- ProviderVisitProdDetailing records: 847
- ProviderVisitProdDiscussion records: 312
- Status: ✓ Configured

### Signature Configuration
- ComplianceStatementDefs: 0 (Visit module)
- Status: ⚠️  NOT CONFIGURED — signature page requires at least one active statement

### Mobile Metadata Cache
- Status: ✓ Active
- Last Updated: 2026-02-10 (12 days ago)
- ⚠️  Cache is stale — recommend regeneration

### Issues Found
1. ProviderVisit missing "Remote Visit" record type
2. No compliance statements defined for the Visit module
3. Metadata cache is 12 days old

### Recommendations
1. Create "Remote Visit" record type in ProviderVisit to match Visit
2. Create at least one ComplianceStatementDef with ModuleType = 'Visit'
3. Regenerate mobile metadata cache after fixing above items

Want me to fix any of these now? [Yes / No / Show details]
```

---

### Audit a specific module

```
/lsc:audit visit-config-check
```

```
## LSC Audit: visit-config-check
Org: my-lsc-sandbox | 14 checks

SUMMARY
  Passed:   10
  Warnings:  2
  Failed:    2

─────────────────────────────────────────
FAILED
─────────────────────────────────────────
✗  ProviderVisit record types match Visit
   Expected: Detail Visit, Remote Visit
   Actual:   Detail Visit only
   Fix: Create "Remote Visit" record type in ProviderVisit

✗  ComplianceStatementDef exists for Visit module
   Expected: ≥1 active record
   Actual: 0 records
   Fix: Create a ComplianceStatementDef with ModuleType='Visit'

─────────────────────────────────────────
WARNINGS
─────────────────────────────────────────
⚠  Mobile metadata cache age
   Last generated: 2026-02-10 (12 days ago)
   Recommendation: Regenerate cache after config changes

⚠  Visit trigger handler status
   VisitTriggerHandler: INACTIVE
   Recommendation: Enable in Admin Console > Trigger Handlers
   Want me to enable it now? [Yes / No]

─────────────────────────────────────────
PASSED (10)  ✓ Visit record types exist  ✓ ProviderAcctTerritoryInfo populated ...
```

---

### Run a SOQL query

```
/lsc:soql-query SELECT Id, Name, AccountId, RecordType.Name, Status FROM Visit
WHERE Status = 'Planned' AND CreatedDate = THIS_WEEK LIMIT 20
```

```
Returned 20 records.

ID                  | NAME             | ACCOUNT         | RECORD TYPE   | STATUS
--------------------|------------------|-----------------|---------------|--------
0OC5g000004xyzAB   | Visit 2026-02-22 | Mercy Hospital  | Detail Visit  | Planned
0OC5g000004xyzAC   | Visit 2026-02-21 | St. Luke's      | Remote Visit  | Planned
...
```

---

### Describe an object

```
/lsc:describe ProviderVisit
```

```
## ProviderVisit — Field Reference

TYPE       FIELD NAME                    LABEL                        NOTES
─────────────────────────────────────────────────────────────────────────────
Id         Id                            Record ID
Lookup     VisitId                       Visit                        → Visit
Lookup     AccountId                     Account
Lookup     OwnerId                       Owner
Picklist   Status                        Status                       Planned, In Progress, Complete
Date       ActualStartTime               Actual Start Time
Date       ActualEndTime                 Actual End Time
Text       DetailingNotes                Detailing Notes
Lookup     RecordTypeId                  Record Type
...

34 total fields. Use `/lsc:describe ProviderVisit --all` to include system fields.
```

---

### Manage Admin Console settings

```
Show me all mobile Application Settings
```

```
## Admin Console — Mobile Application Settings (12 settings)

SETTING                              VALUE          LAST MODIFIED
─────────────────────────────────────────────────────────────────
Default Browser                      In-App         2025-11-14
Password Policy                      6 char min     2025-11-14
Dynamic Actions Enabled              true           2026-01-03
Offline Data Retention (days)        30             2025-11-14
Search Results Limit                 50             2025-11-14
Push Notifications Enabled           true           2026-01-03
Notification Badge Count             true           2026-01-03
...

Which setting would you like to update?
```

```
Set Dynamic Actions Enabled to false
```

```
Updated Admin Console setting:
  Category: Mobile > Application Settings
  Field:    Dynamic Actions Enabled
  Old:      true
  New:      false

⚠️  Regenerate the mobile metadata cache for this change to take effect.
    Run: /lsc:generate-metadata-cache
```

---

### Configure DB Schema records

```
Add Product2 to mobile sync. Only sync active products.
```

```
Creating DB Schema record for Product2...

✓  Created: DB Schema — Product2
   Type:         OBJECT
   SObject:      Product2
   WhereSoql:    IsActive = true
   OneWaySync:   true (web → mobile)
   IsActive:     true

Assigned to profiles:
  ✓ Medical Sales Representative
  ✓ Key Account Manager

⚠️  Regenerate the mobile metadata cache for Product2 to appear on iPad.
    Run: /lsc:generate-metadata-cache
```

---

### Manage Quick Actions

```
Create a "Log Call" quick action on the home page for the Field Sales Representative profile
```

```
Creating Quick Action: Log Call...

✓  Created Quick Action
   Name:     LogCall
   Label:    Log Call
   Type:     LogCall
   Page:     Home
   Order:    5
   Profile:  Field Sales Representative
   Active:   true

The action will appear in the iPad quick actions bar after cache regeneration.
Run: /lsc:generate-metadata-cache
```

---

### Upload and distribute a presentation

```
Upload the file /Users/me/Q1_CardioPresentation.pptx and distribute it to the Northeast territory
```

```
Step 1/3 — Uploading presentation...
  Converting PPTX via LibreOffice... done
  Uploading to LSC Intelligent Content (Bulk Presentation API)...
  ✓  Created: ContentDocument 069Bg000003xyzAB
              Presentation: "Q1 Cardio Presentation" (14 slides)

Step 2/3 — Looking up Northeast territory...
  ✓  Found: Territory2 — Northeast (ID: 0MWBg000003xyzCD)

Step 3/3 — Distributing to territory...
  ✓  Created PresentationShare record
     Territory: Northeast (TerritoryAndSubordinates — cascades to sub-territories)

Done. The presentation is now available to all reps in the Northeast territory and below.
```

---

### Generate mobile metadata cache

```
/lsc:generate-metadata-cache Medical Sales Representative
```

```
Generating mobile metadata cache for: Medical Sales Representative
  Creating cache parent record...    ✓
  Triggering Connect API generation... ✓
  Polling status...
    [00:10] Processing...
    [00:30] Processing...
    [01:15] Processing...
    [02:00] Complete ✓

✓  Cache generated successfully
   Profile:        Medical Sales Representative
   Generated at:   2026-02-22 14:37:02 UTC
   Duration:       ~2 minutes

Next steps:
  1. Force close the LSC Mobile app
  2. Reopen and perform a full sync
  3. Verify new objects and settings appear
```

---

### Troubleshoot an error

```
My reps are seeing "Device sync transaction record was not found" when they try to sync
```

```
That error indicates the mobile sync session record is missing or was deleted
before sync completed. Common causes:

1. Stale metadata cache
   The cache may reference objects or fields that no longer exist in the org.
   Fix: Regenerate the metadata cache → /lsc:generate-metadata-cache

2. Trigger handler inactive
   The SyncSessionTriggerHandler may be disabled.
   Checking now...

   ✓  SyncSessionTriggerHandler: ACTIVE — not the cause

3. Concurrent sync sessions
   If a rep force-closes mid-sync, the session record can be orphaned.
   Fix: Have the rep wait 10 minutes and retry a full sync.

4. DB Schema misconfiguration
   A DB Schema record may have an invalid SOQL filter.
   Run: /lsc:audit sync-troubleshooting

Which of these should I investigate further?
```

---

### Explore LSC concepts

```
Explain how Sample Limits work with ARC in LSC
```

```
## Sample Limits + ARC in LSC

### What is ARC?
ARC (Allocation, Requests, Compliance) is LSC's three-tier model for managing
sample distribution:

  Allocation → Request → Compliance check → Disbursement

### How Sample Limits Fit In
ProviderSampleLimit records define how many units of a product a rep can
disburse to a specific provider within a time period:

  ProviderSampleLimit
  ├── AccountId         (the HCP)
  ├── Product2Id        (the marketable product)
  ├── MaxQuantity       (cap per period)
  ├── QuantityDisbursed (running total)
  └── TimePeriodId      (e.g., Q1 2026)

When a rep submits a ProductDisbursement, LSC checks:
  QuantityDisbursed + requested qty ≤ MaxQuantity

If exceeded, the request is blocked on both web and mobile.

### Admin Setup
1. Enable Sample Limits in Admin Console > Sample Settings
2. Create TimePeriod records for each enforcement window
3. Run the Sample Limits batch job to generate ProviderSampleLimit records
4. Assign limits to territories or individual reps

Run /lsc:configure-samples to check your current setup.
```

## Configuration Audit

One of the biggest challenges with LSC is misconfiguration — the setup is complex and easy to get wrong. The plugin includes an **automated audit system** with 151 validation rules across 19 rule files.

### Run an Audit

```
/lsc:audit
```

This produces a report showing:
- What's configured correctly
- What needs to be fixed (with step-by-step resolution)
- Warnings about potential issues

### Validation Groups

Target specific modules or scenarios:

| Group | When to Use |
|-------|-------------|
| `/lsc:audit mobile-login-check` | Users can't log into the mobile app |
| `/lsc:audit pre-deployment` | Before rolling out mobile to users |
| `/lsc:audit sync-troubleshooting` | Mobile sync not working |
| `/lsc:audit full-mobile-audit` | Comprehensive mobile health check |
| `/lsc:audit visit-config-check` | Visit management issues |
| `/lsc:audit sample-config-check` | Sample management issues |
| `/lsc:audit account-config-check` | Account management issues |
| `/lsc:audit activity-plan-config-check` | Activity plan issues |
| `/lsc:audit territory-config-check` | Territory alignment issues |
| `/lsc:audit kam-config-check` | KAM account plan issues |
| `/lsc:audit field-email-config-check` | Field email issues |
| `/lsc:audit intelligent-content-config-check` | Intelligent content / CLM issues |
| `/lsc:audit next-best-config-check` | NBC/NBA/NBM issues |
| `/lsc:audit consent-config-check` | Consent management issues |
| `/lsc:audit home-page-check` | Home page configuration issues |
| `/lsc:audit quick-actions-config-check` | Quick and custom action issues |
| `/lsc:audit surveys-config-check` | Survey configuration issues |
| `/lsc:audit app-alerts-config-check` | App alerts / notification issues |
| `/lsc:audit agentforce-config-check` | Agentforce configuration issues |

Run `/lsc:audit` with no arguments to see all available groups.

### Diagnose Specific Errors

If a user reports a specific error message, Claude can find matching issues:

```
My users are seeing "Device sync transaction record was not found" - what's wrong?
```

Claude will identify the likely causes and run targeted checks.

## MCP Server Tools

The plugin exposes 60+ tools via its MCP server, organized into these categories:

### Knowledge & Documentation (10 tools)
Search and retrieve LSC documentation, module guides, help docs, troubleshooting, and exercises. All responses include source citations with file paths and URLs.

### Salesforce Org (12 tools)
Connect to orgs, run SOQL, describe objects, CRUD operations, deploy/retrieve metadata, generate mobile metadata cache.

### Admin Console & Trigger Handlers (5 tools)
List, update, and create Admin Console settings by category. List and toggle trigger handlers.

### LSC Actions (6 tools)
List, create, update, and delete Quick Actions and Custom Actions via the Tooling API. Check mobile metadata cache status.

### DB Schema (5 tools)
List, get details, create, update, and toggle DB Schema records for mobile object sync configuration.

### Navigation Tabs (2 tools)
List and add mobile navigation tabs configured in Admin Console > Mobile > UI Settings.

### Configuration Checks (6 tools)
Check visit, sample, account, activity plan, territory, and user management configuration.

### User Management (4 tools)
List users, list permission sets with capacity, assign and unassign permission sets.

### Presentations / Intelligent Content (3 tools)
Upload presentations (PPTX, PDF, HTML ZIP), distribute to territories, assign topics and products.

### Health Check & Status (5 tools)
Comprehensive org health check, org status dashboard, export/import configuration as JSON, release notes.

### Developer & Integrator (5 tools)
Execute anonymous Apex, bulk create/update records, deploy/retrieve metadata.

### Validation & Audit (3 tools)
Run automated audits against 151 validation rules, list validation groups, diagnose specific error messages.

### Diff (1 tool)
Compare LSC configuration between two orgs to identify configuration drift.

## Covered Modules

The plugin includes skills, documentation, and validation rules for all major LSC4CE modules:

| Module | Key Topics |
|--------|------------|
| Account Management | Provider Card, Addresses, Affiliations, Ratings, Search/SBC, DCR, Business Licenses |
| Visit Management | Page Layout, Admin Console, Compliance, Web & Mobile |
| Sample Management | Inventory, Sample Limits, Locations, Batches |
| Activity Plan | Account Goals, Weighted Plans, Product-based Plans, Shared Territory Goals |
| Territory Alignment | Territory Models, Geo/Affiliation Rules, Territory Info |
| Key Account Management | KAM Account Plans, Objectives, Action Plans, Stakeholders |
| Next Best (NBC/NBA/NBM) | Next Best Customer, Action, Message scoring |
| Field Email | Templates, Consent, iPad & Web, Fragments |
| Intelligent Content | Presentations, Dynamic Content, Territory Distribution |
| Calendar/TOT/Routine | Calendar, Time Off Territory, Routines, My Team |
| Consent Management | Subscriptions, Channel Types, Digital Signatures |
| Surveys | Survey configuration, questions, invitations |
| Product Management | Products, Marketable Products, Guidance, Hierarchy |
| App Alerts/Notifications | Admin & End User notification setup |
| Lists & Filters | List views, filters, saved lists |
| Agentforce for LSC | Winter '26 AI agent — Field Sales Agent, topics, actions |
| Home Page | Widget configuration, Agentforce Welcome Center utterances |
| Quick Actions | Quick and custom action setup for web and mobile |
| Mobile App Settings | Application Settings — browser, password, search, notifications |
| User Management | Permission sets, PSLs, profiles, role hierarchy, license capacity |
| Mobile Metadata Cache | DB Schema, sync, programmatic cache generation |
| Data Migration | Account hierarchies, territory assignments, Veeva CRM migration |
| Integration Patterns | MDM, ERP, IQVIA, email/video provider integrations |
| Reporting & Analytics | CRM Analytics, reports, dashboards, KPIs |
| Segmentation | Admin configuration |
| Data Cloud / Singularity | TabNext Metrics, NBC Predictive Model |
| LSC Apps | App configuration |

## Architecture

```mermaid
flowchart TB
    subgraph CC["Claude Code"]
        subgraph Plugin["LSC-for-Claude (Plugin)"]
            direction LR
            Skills["<b>36 Skills (routing)</b><br/>• Thin tool delegation<br/>• Object name guardrails<br/>• Config mode workflows"]
            Commands["<b>24 Commands (/lsc:*)</b><br/>• /lsc:setup-plugin<br/>• /lsc:soql-query<br/>• /lsc:audit<br/>• /lsc:configure-*"]
            Agents["<b>3 Agents (Subagents)</b><br/>• lsc-consultant<br/>• lsc-admin<br/>• lsc-developer"]
            MCP["<b>MCP Server (60+ Tools)</b><br/>• Knowledge + citations<br/>• SOQL / CRUD / Tooling<br/>• Admin Console settings<br/>• Config check tools<br/>• Validation (151 rules)"]
            KB["<b>Knowledge Base</b><br/>• 29 modules (86 files)<br/>• live help via MCP<br/>• 2 guides, 2 exercises"]
            Cite["<b>Citation System</b><br/>• 106 citation entries<br/>• File paths + URLs<br/>• Blockquote format"]
        end
    end

    Plugin --> CLI["Salesforce CLI (sf)"]
    CLI --> Org["Your LSC Salesforce Org"]
```

## Citation System

All knowledge tool responses include source citations with links:

```
> 📖 **Source:** PM Enablement — Visit Management
> 🔗 **Link:** https://help.salesforce.com/s/articleView?id=sf.ls_engagement_execution.htm
> 📂 **File:** /path/to/knowledge/modules/visit-management/admin-console-transcript.md
```

- **106 citation entries** covering 86 PM Enablement files, 2 guides, 2 exercises, 1 troubleshooting doc
- Official Salesforce help documentation is served live via the `salesforce-docs` MCP server (not bundled locally)
- All citations include local file paths for quick access
- Citations are returned in blockquote format by MCP tools
- Skills delegate to tools (rather than embedding knowledge inline) to ensure citations always flow through

Use `/lsc:help <topic>` to search the knowledge base and see citations in action.

## Specialized Agents

For complex tasks, the plugin provides specialized agents:

- **lsc-consultant** — Senior implementation consultant for complex projects
- **lsc-admin** — Administrator for day-to-day configuration, troubleshooting, and maintenance
- **lsc-developer** — Developer for OmniStudio components, Apex, integrations, and custom development

## Project Structure

```
LSC-for-Claude/
├── .claude-plugin/           # Plugin manifest
│   └── plugin.json
├── skills/                   # 30 thin routing skills (60-200 lines each)
│   ├── lsc-visit-management/ # Example: routes to check_visit_config, get_lsc_module_docs
│   ├── lsc-account-management/
│   ├── ... (28 more)
│   └── salesforce-query/
├── commands/                 # 24 user-invocable slash commands
│   ├── setup-plugin.md
│   ├── help.md
│   ├── configure-visits.md
│   ├── ... (21 more)
│   └── getting-started.md
├── agents/                   # 3 specialized subagents
│   ├── lsc-consultant.md
│   ├── lsc-admin.md
│   └── lsc-developer.md
├── src/                      # MCP server source (TypeScript)
│   ├── index.ts              # Server entry point
│   ├── knowledge-loader.ts   # Knowledge base loader, search, citation formatting
│   ├── citation-map.ts       # 106 citation entries with URLs and file paths
│   ├── cache.ts              # Caching layer
│   ├── presentation-converter.ts
│   ├── salesforce/            # SF CLI wrapper & org auth
│   ├── tools/                 # 18 tool modules (60+ tools)
│   └── validation/            # YAML rule engine (151 rules)
├── knowledge/                # Processed knowledge base (markdown)
│   ├── modules/              # 29 module directories (86 files)
│   ├── help/                 # (official help served live via salesforce-docs MCP)
│   ├── guides/               # Dev guide, mobile setup guide
│   ├── exercises/            # Hands-on training (2 files)
│   ├── troubleshooting/      # Common issues (4 files)
│   └── validation-rules/     # 19 YAML rule files (151 rules)
├── test/                     # Vitest test suite (595 tests)
│   ├── unit/                 # Unit tests (citations, knowledge-loader, CLI, validation)
│   └── integration/          # Integration tests (real filesystem, skill checks)
├── documentation/            # Source documentation (.docx, .pdf)
├── dist/                     # Compiled JavaScript
├── CLAUDE.md                 # Claude Code instructions (tool guardrails)
├── README.md                 # This file
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # Run tests (595 passing)
npm run lint         # Lint source
```

### Test Suite

The project has comprehensive test coverage across citations, knowledge loading, skills, validation rules, and tool schemas:

```
 Test Files  17 passed | 1 skipped (18)
      Tests  595 passed | 20 skipped (615)
```

Key test files:

| Test | What It Validates |
|------|-------------------|
| `unit/citations.test.ts` | Citation map entries, getCitation dispatch, formatCitation output with file paths |
| `integration/skill-citations.test.ts` | Every skill follows thin routing pattern with tool delegation |
| `integration/citations.integration.test.ts` | Real tool responses contain citation blocks |
| `integration/knowledge-integrity.test.ts` | Knowledge base structure and content integrity |
| `unit/validation/rules-consistency.test.ts` | All 151 validation rules are well-formed |
| `integration/claude-md-consistency.test.ts` | CLAUDE.md matches actual tools, skills, and commands |

### Adding a New Module

1. Add markdown files to `knowledge/modules/<module-slug>/`
2. Add citation entries to `src/citation-map.ts` (both `moduleCitationMap` for the module slug and each file slug)
3. Create a thin skill at `skills/<skill-name>/SKILL.md` following the routing pattern — reference `get_lsc_module_docs` and `search_lsc_knowledge`, not inline knowledge
4. Run `npm test` to verify citation coverage and skill structure

## Resources

- [Salesforce LSC Documentation](https://help.salesforce.com/s/articleView?id=sf.health_life_sciences.htm)
- [OmniStudio Documentation](https://help.salesforce.com/s/articleView?id=sf.omnistudio.htm)
- [Claude Code Plugin Documentation](https://code.claude.com/docs/en/plugins)
- [MCP Specification](https://modelcontextprotocol.io/)

## Acknowledgments

This project was originally created by **Joe Ferraro**, GM of Agentforce for Life Sciences. It exists thanks to his vision for bringing LSC implementation expertise directly into the hands of consultants, developers, and administrators. The community is grateful for that foundation and continues to build on it.

## License

MIT — see [LICENSE.txt](LICENSE.txt).
