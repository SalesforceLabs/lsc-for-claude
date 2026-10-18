# Set Up KAM Faster with an AI Coding Agent - Winter '27 (264)

Platform: Admin setup via Claude Code or Agentforce Vibes. Added week of September 21, 2026.

## What It Does

Automates the multi-step Key Account Management implementation: prerequisite tasks such as permission set assignments and **stakeholder picklist creation**, importing standardized goals and tasks into account plans and territory business plans, and collecting record data (KAM user, territory, account, product, stakeholders) through natural-language utterances.

## Guardrails

- The agent asks for **explicit approval before any org-wide action**.
- It verifies record data against your org before submitting changes.
- Sessions can be paused and resumed.

## How

Add these skills (Salesforce Skills Library on GitHub) to your AI coding agent and start a conversation:

- `life-sciences-kam-coordinate`
- `life-sciences-prerequisites-validate`
- `life-sciences-territory-configure`

**Who:** users with the Health Cloud Starter, Life Sciences Commercial Admin and Life Sciences Key Account Management permission sets.

## Manual Equivalents (Help: Key Account Management)

What the agent automates mirrors the manual setup:

- **Picklist values** (permission: Life Sciences Commercial Admin): Account Plan Stakeholders > Role Type (e.g. internal/external), Influencer Level (e.g. district/national/international) and Strength (low/medium/high); Status values for Territory Business Plans, account plans, account plan objectives and sprints; Category on Assessment Task (e.g. approve, survey, claim).
- **Territory plan:** App Launcher > Territory Business Plans > New; name, territory, status, **Active**, start/end dates.
- Account plans, participants, stakeholders, objectives, goal assignments for territory plans and the account plan hierarchy are documented under Help "Manage Key Accounts".

## Installing the Skills

Per the Winter '27 AI Skills release note: `npx skills add forcedotcom/sf-skills` for Claude Code/Codex; Agentforce Vibes installs and updates skills automatically.

## Not Verified

The `life-sciences-kam-coordinate` skill (and the shared `life-sciences-prerequisites-validate` / `life-sciences-territory-configure`) could not be read; they were not in the public `forcedotcom/sf-skills` listing and no Help article covers them. Exact prompts, steps and the "Key Account Management for Customer Engagement" article were not found.

## Related

- Manual configuration reference: [support-engineering-account-plan](./support-engineering-account-plan.md) (prerequisites for Import Objective/Stakeholder, Action Plan Template Assignment).
- Companion workflow for first-visit setup: `starter-config/release-264-first-visit-ai-agent.md`.

## Sources

- https://help.salesforce.com/s/articleView?id=release-notes.rn_skills.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_key_account_management_create_custom_picklist_values.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_key_account_management_create_territory_plan.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_customer_engagement_manage_key_accounts.htm&release=264.0.0&type=5
