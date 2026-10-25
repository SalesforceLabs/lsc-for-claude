---
name: lsc-agentforce
description: Guides Agentforce for Life Sciences Cloud (LSC) configuration (Winter '26 feature). Use when user asks about Field Sales Agent, agent topics, agent actions, daily briefing, HCP summarization, next best action predictions, visit logging via voice, Einstein Studio integration, or Agentforce customization. For Agentforce Welcome Center utterances/prompts on the mobile home page, use the lsc-home-page-configuration skill instead.
---

## IMPORTANT: Agentforce Welcome Center

**The Agentforce Welcome Center component (utterances/prompts on the mobile home page) is configured in Lightning App Builder as part of home page setup.** If the user asks about editing, adding, or configuring Welcome Center utterances or prompts, use the **lsc-home-page-configuration** skill — it covers the Agentforce Welcome Center component configuration. Do NOT tell the user there's no programmatic way to manage it or redirect them to the UI without guidance.

---

## How to Answer Agentforce Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Agentforce concepts, setup, best practices | `get_lsc_module_docs({ module: "agentforce" })` |
| Specific Agentforce topic (topics, actions, Einstein Studio, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| Agentforce custom Lightning type (CLT) card blank or a raw field list on mobile (iPad/iPhone) | `search_lsc_knowledge({ query: "custom Lightning type mobile blank lightningMobileGenAi" })` |
| Admin Console Agentforce settings | `list_admin_settings({ category: "Agentforce" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Agent bot definitions | `run_soql({ query: "SELECT Id, DeveloperName, MasterLabel, IsActive FROM BotDefinition WHERE DeveloperName LIKE '%LifeSciences%'" })` |
| Agent topics | `run_soql({ query: "SELECT Id, Label, DeveloperName FROM mlDomain WHERE DeveloperName LIKE '%LifeSciences%'" })` |
| Agent actions | `run_soql({ query: "SELECT Id, Name, Type, NamespacePrefix FROM GenAiFunction WHERE NamespacePrefix = 'lsc4ce'" })` |
| Mobile cache status | `check_mobile_cache_status()` |

Always include the citation line from the tool response in your answer.

---

## Configuration Mode

When the user asks about configuring or enabling Agentforce, **ask them which mode they prefer**:

1. **Show me the documentation** — call `get_lsc_module_docs({ module: "agentforce" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
list_trigger_handlers()
list_admin_settings({ category: "Agentforce" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
toggle_trigger_handler({ handlerName: "...", active: true })
update_admin_setting({ recordId: "...", fields: { ... } })
```

#### Step 5: Verify
Re-run checks from Step 1 to confirm everything is configured correctly.

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `BotDefinition` | `Agent__c`, `Agent__mdt`, `AgentForce__c`, `AgentForceConfig__mdt` |
| `BotVersion` | — |
| `mlDomain` | `AgentTopic__c`, `Topic__c`, `Topic__mdt` |
| `GenAiFunction` | `AgentAction__c`, `Action__c`, `Action__mdt` |
| `GenAiPlugin` | — |
| `ConversationEntry` | — |
| `AIApplication` | — |

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings`
- **DO NOT** use `run_soql` for mobile cache — use `check_mobile_cache_status()`
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app
- **Predictive models** are configured in Einstein Studio and Data Cloud, NOT queryable via standard SOQL
- **Mobile Agentforce** is planned for late 2026 GA — current functionality is web-only
