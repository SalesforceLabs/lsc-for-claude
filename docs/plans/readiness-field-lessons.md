# Plan: field lessons in Studio Readiness

**Status:** proposed, 2026-10-17. Builds on the Readiness work in
`src/studio/readiness/` (YAML rules + per-feature TS checks, staged
enabled → access → data → config → mobile).

**Source:** read-only Slack research across LSC CE escalations, Sev1 channels,
hypercare and #ask-lsc-engineering (≈15 customers, ≈60 issues). The
customer-attributed notes are kept **outside this repo**. Everything in this repo
— checks, `why` text, catalog — stays **de-identified**: describe the pattern and
the fix, never the customer (same rule as
`knowledge/troubleshooting/implementation-anti-patterns.md`).

## 1. What the field says

Ranked by how often it showed up × how bad it was. "Org-checkable" = Studio can
find it from config/data before go-live.

| # | Pattern | Seen | Typical outcome | Org-checkable? |
|---|---|---|---|---|
| F1 | **Sync scope too wide** — DB Schema without a territory-scoped WhereSoql on OTA/PATI/Account/CPA (one org: ~800k OTA rows per rep); heavy dynamic record pages | many | Slow/failed first sync, app freezes | Yes — partly covered today |
| F2 | **Sync filter or cache out of step with permissions** — WhereSoql subselect on an object a muting permission set hides for the profile; cache not regenerated after the fix; mobile app hidden on profile / default app changed | several Sev1 | iPad login loop, "mobile web unavailable" | Yes |
| F3 | **Duplicate records from mobile retries** — Mobile Timeout Period well below 60 min plus a sync-queue race | Sev1 | Duplicate Visits, disbursements, signatures; reps blocked | Setting yes; duplicates post-go-live |
| F4 | **Widening visibility on core objects** — Visit made Public / View All so reps see each other's visits; ProductDisbursement shares that path | Sev1 | Inventory counts blocked (other reps' unreconciled drops) | Yes |
| F5 | **Migration that bypasses or mis-sequences platform automation** — inventory history loaded without disbursements/count references; inventory triggers on during the load; affiliation loads colliding with the reverse-affiliation trigger | several | Corrupt reconciliation; duplicate ExternalIds | Data shape yes |
| F6 | **Territory alignment prerequisites unmet** — inactive accounts, no primary provider, CPA without postal code / excluded, postal code not in a ZipToTerritory rule; OTA with the wrong AssociationCause; stale PATI after address deactivation; PATI marked offline everywhere | many | Accounts don't reach reps; wrong offline set | Yes |
| F7 | **Platform limits and AI metering** — integration volume vs daily API limit; OOTB autolaunched prompt-template flows (Account Summary) burning Flex Credits; no unmetered-AI PSL | Sev1 | API exhaustion within hours; surprise spend | Mostly yes |
| F8 | **Server automation expected to run offline** — record-triggered flows / Apex enforcing rules the iPad needs; validation rules on objects written asynchronously at Visit submit; flows running as users lacking permissions | several | Silent data loss; rules bypassed offline | Yes (inventory + warn) |
| F9 | **Config shells never finished** — workflow/stage paths with no actions; DCR record types without "New Record Approval Required" (no parent DCR) | Sev1 | Can't create HCP/HCO; DCR chain broken | Yes |
| F10 | **Org state** — org provisioned before 258 GA (FLS drift); wrong template; co-installed clouds (Consumer Goods) untested with LSC triggers; client version × Admin Console flag incompatibilities (e.g. Related Record Retrieve on 260.8) | several | Random errors, blocked installs, sync failures | Yes |
| F11 | **Testing not done the way reps work** — desktop not iPad, demo not prod volume, happy path only, oldest supported iPad never tried, target locale not checked, Agentforce not tried across visits | everywhere | Defects found in production | Partly — via Studio Testing results |
| F12 | **Program / fit-gap** — requirements vs roadmap (cross-object validation, Outlook→Visit, territory planning, regulatory visit-time hiding), partner skill, compressed SIT/UAT | everywhere | Slipped / failed go-lives | No — attestation only |

Coverage today: F1 partly (`mobile-sync.config.unfiltered-high-volume` targets
Task/Event/Email/Attachment/Case, not territory objects; `filters-valid`
checks syntax only); cache freshness and DB Schema assignment are covered.
Nothing covers F2–F10 yet.

## 2. Engine changes (small, do first)

1. **`lesson` on a check.** Add `lesson?: { id: string; title: string }` to
   `ReadinessCheck` (`src/studio/types.ts` + renderer copy) and `field_lesson:`
   to `_schema.yaml` / `rules-loader.ts`. `id` points at a catalog anchor
   (e.g. `AP-4` → §4 of the anti-pattern catalog). The Readiness view shows a
   small **"Seen in the field"** chip on those checks and sorts failing lessons
   first within a stage (`sortForAttention`). This is the visible payoff: an
   admin can tell a field-proven failure from a best practice.
2. **`when` on a check.** `when?: "pre" | "post"` (default both). Post-go-live
   monitors (duplicates, API burn) render under a **"Live org"** toggle so a
   pre-go-live run isn't cluttered with zero-row checks.
3. **New org-wide feature `go-live`** ("Go-live risks") in `features.ts` +
   `readiness/modules.ts` for checks that belong to no module: sharing/OWD, API
   headroom, flows on synced objects, AI metering, org state. Its collector
   can be thin (a summary surface); the value is its readiness.
4. **Expensive checks behind "Run deep checks".** Per-user sync volume (reuses
   `findHeaviestUsers` + `profile_sync_volume`) and FLS-vs-profile checks are
   too slow for every open. `runCheck` gets `deep?: true`; the view shows them
   as *skipped — run deep checks* until asked.

Unknown stays unknown: if a setting or object can't be read, the check is
`unknown`, never `fail` (existing rule).

## 3. Check backlog

IDs follow `<feature>.<stage>.<slug>`. ⚠ = verify the object/field/setting name
in a real org before writing the query.

### P0 — Sev1 causes, cheap to detect

| Check | Lesson | Sev | Detection |
|---|---|---|---|
| `mobile-sync.config.mobile-timeout` | F3 | error | Admin Console mobile setting "Mobile Timeout Period" ⚠ < 60 min → fail. Fix: `update_admin_setting` one-click |
| `mobile-sync.config.filters-readable` | F2 | error | For each active DB Schema record × assigned profile: parse `FROM <obj>` in WhereSoql subselects plus the SObject; fail if the profile (profile PS + assigned perm sets − muting PS in groups) lacks Read via `ObjectPermissions`. `deep` when > 20 records |
| `mobile-sync.access.app-visible` | F2 | error | Field profiles still see the LSC mobile/Sales Cloud Mobile app (`AppMenuItem` / profile app visibility ⚠) |
| `go-live.access.core-objects-private` | F4 | error | `EntityDefinition.InternalSharingModel` = Private for Visit, ProductDisbursement, ProductTransfer, InventoryCountAssessment |
| `go-live.access.no-view-all-on-core` | F4 | error | `ObjectPermissions` with `PermissionsViewAllRecords`/`ModifyAllRecords` on those objects for perm sets assigned to field users; examples = perm set names |
| `samples.data.disbursements-reconcilable` | F5 | error | Disbursements per rep not yet counted/received older than the current count period ⚠ field names; flags history loaded without count references |
| `territory-users.data.zip-alignment-ready` | F6 | warning | Counts of in-scope accounts failing each prerequisite: inactive; no `HealthcareProvider.IsPrimaryProvider`; CPA without PostalCode or `IsTerrAssignmentExcluded`; PostalCode with no `ZipToTerritory` geo rule. Detail lists each count |
| `visit.data.duplicate-visits` *(post)* | F3 | error | `GROUP BY OwnerId, AccountId, PlannedVisitStartTime HAVING COUNT(Id) > 1` last 30 days |
| `samples.data.duplicate-disbursements` *(post)* | F3 | error | Same shape on ProductDisbursement by visit + product |

### P1 — common, more work

| Check | Lesson | Sev | Detection |
|---|---|---|---|
| `mobile-sync.data.territory-objects-filtered` | F1 | error | Extend `unfiltered-high-volume` to OTA, PATI, Account, ContactPointAddress, Contact; message suggests `{USER.TERRITORYID}` filters |
| `mobile-sync.data.per-user-volume` *(deep)* | F1 | warning | Heaviest 3 users per field profile; warn > 100k records total or any table > 50k (thresholds overridable from the perf NFR profile) |
| `actions-home.mobile.record-page-weight` | F1 | warning | Dynamic components + visibility rules per record Lightning page, from the published cache Studio already reads (`published.ts`) |
| `territory-users.data.pati-integrity` | F6 | warning | PATI `IsAvailableOffline=true` ratio ⚠; inactive PATI on aligned accounts; aligned accounts with no PATI |
| `territory-users.data.ota-cause` | F6 | info | OTA `AssociationCause` mix; flag loaded OTA that aren't `Territory2Manual` |
| `accounts.data.one-preferred-address` | F6 | warning | Accounts with > 1 or 0 preferred CPA among several (extend `preferred-address`) |
| `go-live.config.automation-on-synced-objects` | F8 | warning | Active record-triggered flows + Apex triggers on objects in DB Schema → "won't run offline; move rules the iPad needs into a custom script". Info list, warn on before-save flows that set fields |
| `visit.config.validation-on-async-objects` | F8 | warning | Active validation rules on objects written at Visit submit (engagement / Visual Aid / presentation-forum objects ⚠) |
| `go-live.config.ai-metering` | F7 | warning | Account Summary on in `LifeSciencesCommercialSetup` ⚠ and field users lack the unmetered-AI PSL; active autolaunched flows calling prompt templates |
| `go-live.data.api-headroom` *(post)* | F7 | warning | `/limits` DailyApiRequests used > 70% → warn, > 90% → error |
| `accounts.config.affiliation-loads` | F5 | warning | Reverse-affiliation handler state + duplicate `ExternalId` on ProviderAffiliation |
| `accounts.config.dcr-parent-approval` | F9 | warning | DCR-enabled record types without "New Record Approval Required" ⚠ |
| `go-live.config.workflow-paths-complete` | F9 | error | Workflow/stage paths with no actions or missing a record type ⚠ object names |
| `go-live.enabled.org-state` | F10 | warning | `Organization.CreatedDate` before 258 GA; installed packages that co-exist badly (Consumer Goods); trigger-handler framework answers |
| `go-live.access.integration-users` | F5/F10 | info | Integration users with/without "Skip Life Sciences Trigger Handlers" — show which, don't judge |
| `territory-users.access.no-admin-on-ipad` | F10 | info | Users syncing on System Administrator (no cache config) |

### P2 — evidence from Studio Testing and attestations

| Check | Lesson | Notes |
|---|---|---|
| `go-live.mobile.first-sync-tested` | F11 | Pass if each field profile has a First sync result (`perf_sims`) in the last 14 days on this instance. Renderer-side check — the store is in the Electron SQLite |
| `go-live.mobile.perf-plan-run` | F11 | Latest Performance run per org passes the NFR plan |
| `mobile-sync.config.client-flag-compat` | F10 | Small table of known (client version, Admin Console flag) breakages, starting with Related Record Retrieve. Info; needs an owner to keep current |
| `intelligent-content.data.content-size` | F1 | Presentation bytes per territory vs device budget |
| Attestations | F11/F12 | Manual items with status `attested` (new), stored per org: UAT on full copy on prod's release; oldest supported iPad tried; target locale picklists reviewed; Agentforce tried on iPad across two visits; fit-gap signed off. Only if the checks above land well |

## 4. Knowledge updates

Update `knowledge/troubleshooting/implementation-anti-patterns.md`, keeping it
de-identified, and give each section a stable anchor for `lesson.id`:

- §3 Mobile Sync: WhereSoql subselects on objects the profile can't read
  (login loop), regenerate the cache after every fix, mobile app hidden or
  default app changed on the profile, recommended Mobile Timeout of 60 minutes.
- §5 Territory: the zip-alignment prerequisites, OTA AssociationCause, stale
  PATI after address deactivation.
- §6 Migration: load inventory history *through* the disbursement/count model
  and sequence triggers deliberately; dry-run affiliation loads against the
  reverse-affiliation trigger.
- New §: **Platform limits & AI metering** (API sizing, prompt-template flows,
  unmetered-AI licensing).
- New §: **Server automation and the offline iPad** (flows/triggers don't run
  offline; async writes at Visit submit can fail silently against validation
  rules).
- New §: **Org state** (pre-GA orgs, templates, co-installed clouds,
  client-version × flag matrix).
- Update the Pre-Go-Live checklist to match, with each item linking to its
  Studio check id.

Mirror the YAML rules for anything expressible as a single query (OWD,
ObjectPermissions, timeout setting) so `audit_mobile_config` and
`lsc-implementation-review` pick them up too. TS checks only where a check needs
joins, parsing or fixes.

## 5. Order of work

1. Engine changes 2.1–2.4 + tests in `readiness-runner.test.ts`.
2. P0 checks, one file at a time, each with a mocked-query unit test in
   `test/unit/studio/readiness/` like the existing ones.
3. Catalog §4 updates + the YAML mirrors.
4. P1 checks.
5. P2, then decide on attestations.

Before P0 ships, run the checks against at least one LSC org to settle the ⚠
names and make sure nothing reads as a failure when it's really unknown.

## 6. Coordination

Readiness is being built in another session right now (the files are still
uncommitted). Hand this plan to that session rather than editing
`src/studio/readiness/*` in parallel. Steps 2.1 and 2.3 touch shared types and
`features.ts` and should land in one change.
