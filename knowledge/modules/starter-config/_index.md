# Starter Configuration (LSStarterConfig)

**LSStarterConfig** is an open-source Salesforce Labs repository that bootstraps an LSC4CE org with pre-built configurations — DB Schemas, application & feature settings, a sample profile, and trigger handler activations. It exists to short-circuit the manual config bootstrap that every new LSC4CE org otherwise requires.

- **Repo:** https://github.com/SalesforceLabs/LSStarterConfig
- **Audience:** LSC4CE (Customer Engagement) orgs — not Pharma
- **Status:** Open-source, GA

## Three Deployment Methods

1. **Workbench** — metadata only (DB Schemas + System Admin settings)
2. **CLI scripts** (recommended) — full bootstrap including data, sample profile, trigger handlers
3. **Heroku App** (internal-only, USA794/USA796 prod + all sandboxes) — wraps the CLI in a web UI

## Spring '26 (Release 260) Enhancements

- [LSStarterConfig — Spring '26 Setup Guide](./release-260-lsstarter-config.md) — deployment methods, single-zip change, prerequisites, paid-org policy

## Support Engineering Training (LSC4CE Value Chain)

- [LSStarterConfig — Support Engineering Training](./support-engineering-lsstarter-config.md) — live walkthrough, Heroku constraints, troubleshooting patterns, duplicate handling logic

## Winter '27 (Release 264) Enhancements

- [release-264-first-visit-ai-agent](./release-264-first-visit-ai-agent.md) — AI coding agent workflow from package-ready org to a field rep's first visit (territories, users, metadata, test data, cache).
