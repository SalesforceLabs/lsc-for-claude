---
name: lsc-performance-validation
description: Validates a Life Sciences Cloud (LSC) customer implementation against performance and scalability NFRs/SLAs. Use when the user asks about mobile sync performance, sync volume, how much data a rep will download, slow syncs, initial or delta sync times, device DB size, sync failure rate, DeviceSyncSummary telemetry, load or scalability checks, go-live performance readiness, or checking a configuration against NFRs.
---

# LSC Performance & Scalability Validation

For QA and forward-deployed teams checking a customer configuration against performance NFRs before or after go-live. Every tool is **read-only** against the org and safe to run in production.

## Background docs

Explain *why* a table is heavy with sourced documentation instead of general knowledge:

| Topic | Call |
|-------|------|
| DB Schema filters and which objects sync | `search_lsc_knowledge({ query: "DB Schema mobile object sync SOQL filter" })` |
| Metadata cache | `get_lsc_module_docs({ module: "mobile-metadata-cache" })` |
| Territory alignment (it drives `{ACCOUNT.IDS}` / `{OT2A.OBJ.IDS}`) | `search_lsc_knowledge({ query: "territory alignment account assignment" })` |

## Which tool

| Question | Tool |
|----------|------|
| "How much will this rep sync?" / "Which tables are heavy?" / "Will this filter work on device?" | `profile_sync_volume({ users: [...] })` |
| "How are syncs performing in the field?" / "Are syncs failing?" | `analyze_sync_telemetry({ days: 30, users?, profileName? })` |
| "Does this config meet the customer's NFRs?" | `run_perf_assessment({ profilePath })`, or `/lsc:perf-assessment` |

## Workflow

1. **Get the NFRs.** Ask for the customer's NFR/SLA targets. Never invent thresholds. If there aren't any, run the tools anyway and present the measurements as a baseline, labelled "no threshold". The only built-in default is metadata download p95 (warn 5s / fail 10s, from the lsc-metadata-svc SLO).
2. **Pick personas.** For each role (rep, KAM, MSL, manager), choose the 2–3 *heaviest* real users: largest territory, most accounts, most permission sets. Averages hide the users who will actually hit the limits. `list_users` helps find them. Or give the persona `select: { profile, count }` instead of `users`, and each run tests that profile's `count` (1–10, default 3) heaviest active users — most territories in the active model first; listed `users` are tested first and the selection fills in. Add `preferSynced: true` to pick users who synced in the telemetry window first — field-telemetry metrics come only from the tested users' own `DeviceSyncSummary` rows, so users who haven't synced report **No data**.
3. **Write the profile.** Copy `docs/perf-nfr-profile.example.yaml` and replace every example value.
4. **Run** `run_perf_assessment`. Pass `outputPath` to keep JSON for re-runs and CI comparisons.
5. **Explain the drivers.** For each WARN or FAIL, name the user, territory, and table, and say what to change:
   - Large table → tighten its DB Schema `WhereSoql` (date window, status filter), or remove it from the profile or permission set that doesn't need it (`update_db_schema`).
   - High device request count → the table filters on `{ACCOUNT.IDS}` / `{OT2A.OBJ.IDS}` over a very large territory; review the alignment or filter on a smaller id set.
   - `error` rows → the filter doesn't execute for that user. It will fail on device too, so fix it first.
   - Slow delta sync with normal volume → compare the network and app-version breakdowns before blaming configuration.

## Accuracy caveats (always tell the user)

- The person running a test is usually an admin, but the counts are for the **persona user**. Each user's own DB Schema tables, territories, and `{USER.*}` tags scope the filters, so user- or territory-scoped tables are counted as that user would download them. Tables whose filter isn't scoped to the user are counted org-wide: exact when the object's org-wide default lets everyone read it, and flagged as an **upper bound** when sharing is restricted (`Private`, `ControlledByParent`, …) or unknown. Point out flagged tables when they drive a warn/fail. `countAsOrg` (an alias logged in as the persona user) makes even those exact, but it is rarely worth the setup.
- Predicted volume is for an **initial** sync. Deltas depend on change rate, so use telemetry for those.
- Tables filtered by content tags (`{related.entities}`, `{cont.docs}`, `{attachments}`), `{STI.OBJ.IDS}`, or both `{ACCOUNT.IDS}` and `{OT2A.OBJ.IDS}` are reported as `not-estimated`.
- Telemetry measures real devices, so slow hardware or networks show up in the numbers. Read the by-network breakdown before attributing slowness to configuration.
- This does **not** load-test the org. Concurrency and API load testing need a full-copy sandbox and must follow Salesforce's performance-testing policy. Never run them against production.

## Follow-up

- `get_db_schema` / `update_db_schema` to inspect or tighten a heavy table's filter
- `check_territory_config` when territory size drives the volume
- `check_mobile_cache_status` / `/lsc:generate-metadata-cache` when metadata download is slow because the cache is stale
