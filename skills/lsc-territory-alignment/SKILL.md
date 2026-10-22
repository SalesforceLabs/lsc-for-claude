---
name: lsc-territory-alignment
description: Guides Life Sciences Cloud (LSC) Territory Alignment configuration and administration. Use when user asks about territory setup, account-to-territory assignments, zip code alignment, brick code alignment, affiliation alignment rules, territory batch jobs, ObjectTerritory2Association, TerrProvAffilAssignRule, or ProviderAcctTerritoryInfo objects.
---

## How to Answer Territory Alignment Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Territory concepts, alignment types, best practices | `get_lsc_module_docs({ module: "territory-alignment" })` |
| Specific topic (geo rules, affiliation rules, batch jobs, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| Current org territory configuration | `check_territory_config()` |
| Admin Console territory settings | `list_admin_settings({ category: "Territory" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Object fields and relationships | `describe_sobject({ sobject: "Territory2" })` or `describe_sobject({ sobject: "ObjectTerritory2Association" })` |
| Territory data in the org | `run_soql({ query: "SELECT ... FROM Territory2 ..." })` |

---

## Configuration Mode

When the user asks about configuring or enabling Territory Alignment features, **ask them which mode they prefer**:

1. **Show me the documentation** — call `get_lsc_module_docs({ module: "territory-alignment" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
check_territory_config()
list_trigger_handlers()
list_admin_settings({ category: "Territory" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
toggle_trigger_handler({ handlerName: "TerritoryAlignmentHandler", active: true })
update_admin_setting({ recordId: "...", fields: { ... } })
create_admin_setting({ category: "Territory", developerName: "...", label: "..." })
```

#### Step 5: Verify
Re-run `check_territory_config()` to confirm everything is configured correctly.

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `ObjectTerritory2Association` | `AccountTerritory__c`, `TerritoryAssignment__c` |
| `Territory2` | — |
| `Territory2Type` | — |
| `Territory2Model` | — |
| `ProviderAcctTerritoryInfo` | `TerritoryInfo__c`, `AccountTerritoryInfo__c` |
| `TerrProvAffilAssignRule` | `AffiliationAlignmentRule__c` |
| `TerrGeoAssignmentRule` | `ZipTerritory__c`, `GeoAlignment__c` |
| `ProviderAffiliation` | `ProviderAffiliation__c` |
| `ContactPointAddress` | `ContactPointAddress__c` |

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings` / `check_territory_config`
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app

### Affiliation Alignment Rules Setup
When the user asks about creating affiliation alignment rules, follow this procedural workflow:
1. Verify affiliation role picklist values match between `TerrProvAffilAssignRule.AffiliationRole` and `ProviderAffiliation.Role`
2. If mismatched, guide user to Setup > Object Manager > TerrProvAffilAssignRule > Fields > AffiliationRole to add missing values
3. Create rules in Admin Console > Territories > Affiliation Rules
4. Rules apply to the selected territory **and all child territories** by default (can be unchecked)
5. After creating rules, run the parent alignment jobs (Account/Zip/Brick) — affiliation alignment runs automatically after those complete

### Activate the Territory Model Before Enabling Sharing Handlers
Territory-scoped sharing depends on an **active** territory model. The sharing-handler setup checks `Territory2Model.State == 'Active'` and aborts with an explicit error if the model is still in `Planning` or `Inactive`. Always activate the model first, then enable the sharing handlers.
```sql
SELECT Id, DeveloperName, State FROM Territory2Model
```
If sharing isn't propagating to territory users, confirm the model's `State` is `Active` before investigating rules or `LSC4CEAutoShare`.
