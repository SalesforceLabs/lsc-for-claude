# Prepare an Org for a Field Rep's First Visit with an AI Coding Agent - Winter '27 (264)

Platform: Admin setup via Claude Code or Agentforce Vibes. Added week of September 21, 2026.

## What It Does

Takes a package-ready Life Sciences Cloud org from initial configuration to a field rep's first visit using a headless workflow:

1. Configures territories and users.
2. Deploys the required metadata.
3. Creates minimal test data.
4. Validates that a rep can own a visit and complete a provider visit report with a product and its related objectives and messages.
5. Regenerates the mobile metadata cache for synchronization.

Result: a working Visit foundation on the web, with data prepared to sync to an enrolled iPad.

## How

Skills (Salesforce Skills Library on GitHub):

- `life-sciences-fieldsalesrep-coordinate`
- `life-sciences-prerequisites-validate`
- `life-sciences-territory-configure`

Prerequisites: a provisioned org with the Life Sciences Cloud managed package installed and its installation prerequisites enabled. Users need the Health Cloud Starter and Life Sciences Commercial Admin permission sets. Review and approve the proposed metadata deployment, territory activation and user configuration, then **manually confirm the result in the app on an enrolled iPad after sync**.

## Background: AI Skills (from Winter '27 release notes)

AI Skills are packaged instruction sets that give AI coding clients Salesforce-specific expertise. Install the curated collection from the `forcedotcom/sf-skills` GitHub repo into Claude Code, Codex or another AI coding CLI with `npx skills add forcedotcom/sf-skills`. In Agentforce Vibes, skills are installed, enabled and updated automatically (manage under Toolkit > Skills). For Claude Code there is also the Salesforce Development plugin.

## Visit Management Context (Help)

The workflow targets the same foundation as manual Visit Management setup. Per Help, assign permission sets by role: **Life Sciences Commercial Admin** (settings, page layouts, scripts in Admin Console), **Life Sciences Field Sales Representative** (create visits, disburse samples, capture signatures), **Life Sciences Field Medical**, **Life Sciences Key Account Management**. Then configure Visit Settings (Admin Console > Visit Administration > Visit Settings), activate Visit trigger handlers (Admin Console > Trigger Handler Administration), and generate the metadata cache so changes sync to the iPad app.

## Not Verified

The skill contents (`life-sciences-fieldsalesrep-coordinate`, `life-sciences-prerequisites-validate`, `life-sciences-territory-configure`) could not be read: they did not appear in the public `forcedotcom/sf-skills/skills` directory listing and no Help article describes them. The step list above comes from the release note only.

## Relationship to LSStarterConfig

LSStarterConfig bulk-configures trigger handlers, admin settings and DB Schema ([release-260-lsstarter-config](./release-260-lsstarter-config.md)); this agent workflow is an end-to-end path that also provisions users, territories and test data. The LSC plugin's own `health_check`, `check_visit_config` and `generate_mobile_metadata_cache` tools cover similar verification steps.

## Sources

- https://help.salesforce.com/s/articleView?id=release-notes.rn_skills.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_get_ready.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_configure_visit_settings.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_admin_console.htm&release=264.0.0&type=5 (search excerpt)
- https://github.com/forcedotcom/sf-skills/tree/main/skills (listing checked; no life-sciences-* skills visible)
