# Life Sciences Cloud — Store Check and Order Management Setup Steel Thread

> **Version 6** (2026-10-08). Changes from v5: an optional step 9.8b lets the admin create Visits on web. It makes the three Visit record types visible on the System Administrator profile with Store Check as the default, and is asked at 9.in as `ADMIN_VISIT_ACCESS` (recommended `yes` on a `test` org, `no` on a `customer` org). A matching step 10.1c gives the System Administrator profile the rep's `DbSchema_*` assignments before the 10.3 generation, so web In-Person and Remote (Log a Visit) load for the admin too. Without them the admin's Visits → New opens the Master form with no record-type picker and Save fails (FP-9.10), and In-Person / Remote show the K26 cache message; the rep is not affected. Update (2026-10-12): new step 7.17b turns on Header Adjustments (Revenue Settings, `enableRevenueAdjustment`). Without it the iPad cart footer has no Order Discount (Add), the device equivalent of the web Manage Header Adjustment (FP-7.15); 13.12a checks it. Also (2026-10-12): 8.9 sets `Record.Status` to `readonly` on the Details section, so the iPad Create New Quote form shows Status as read-only Draft instead of an editable picklist (FP-8.35); 13.3 checks it. Also (2026-10-13): new step 8.24a gives the rep Read and Create on `QuoteDocumentCreationEvent`. Without Create the iPad Submit Order cannot publish the event, so the PDF stays In Progress; K1 was this, not a platform gap. K1, G2, FP-14.4, FP-8.29, 14.12 (poll bound now 10 min) and the gap rows are updated. Everything else is unchanged from v5. **Update (2026-11-11), fixes from later runs** (the CLI route is unchanged): the iPad **Generate PDF** tap is what produces the PDF (14.11, one tap); `In Progress` after Submit Order is normal until then, K1 applies only after the tap, and Failed, Queued and Generating statuses are handled. The 14.6 read runs before 14.3, so the signed Submit has no mid-sequence stop. New step 10.1d turns on Translation Workbench with an active language, a second cause of the K26 message on a fresh org. New conditional step 7.17c: when the 7.18 Save As fails with `discoverProductsContext (Variable) - "apexClass" is invalid` (new FP-7.16), the agent retrieves `Settings:ProductConfigurator`, deploys `enableProductConfigurator` = `true` once and redoes the Save As; an org where the Save As succeeds skips it. New step 11.1a checks, before the rep's first login, that no action plan template the rep can read has more than one version; one that does breaks the first sync with `UNKNOWN_EXCEPTION` (new FP-11.4). 4.1 deploys five user permissions; the rep profile takes Chatter from Minimum Access. The 0.9b licence gate is a hard stop (new FP-6.4). 8.18, 8.21 and 9.11 set `SourceSystemIdentifier` on every stage record, so the Admin Console Workflow Paths editor opens and edits the right path (new FP-8.36); reuse finds rows by key, then Name, and backfills empty keys. Rerun safety: 7.8 reads each object's org-wide default and shares only `Private` objects; the 8.21 read-back checks all seven Quote link keys one by one; 8.30 and 10.3 reuse a finished quote and a valid cache; 12.12 and 12.14 detect a second Store Check task set and delete nothing; 12.4, 13.4, 13.9 and 15.0 look up only this run's records; 8.28 (new FP-8.37), 14.10 (new FP-14.6) and 6.9 (new FP-6.9) do not create duplicates. 13.10 sends exact per-line quantities and a discount, so 13.14 checks a tier price and a discounted price. 12.12 counts the cells that No Stock greys out, K2 rule (d) covers quote-level adjustments, and 15.0 can re-submit a quote returned to Draft. The corporate currency is read from `CurrencyType` on a multi-currency org, and the run-files rule lists the rep's email, store addresses, screenshots and hand-off copies.
>
> **Version 5** (2026-10-07). Changes from v4: the six Act 8 asset files are embedded in [Appendix B](#appendix-b--act-8-asset-files) with SHA-256 checksums, and Act 8 extracts them into `<run>/artifacts/a08/`. No separate `assets/` folder is needed. The web verification checks (8.30–8.33a with the 8.9b and 8.16a render checks, 9.9d, the 9.23–9.25 rep render checks and 10.7a) are now always 👤 HUMAN, with exact clicks and a **Report back** list; the person runs them as the rep through Login-As and the agent verifies the results by REST. Playwright is used only for Setup configuration pages. Time estimates are recalibrated to measured times (agent ≈ 8–9 h, human ≈ 2.5–4.5 h), and the Timing table and each Act's estimate now agree. Consent C13 (the 9.20a sharing change) can be answered at 0.11 on a `test` org; it stays a live stop on a `customer` org. Everything else is unchanged from v4.
>
> **Version 4** (2026-10-06). Changes from v3: corrections across all Acts. Highlights: the Pricebook2 layout assignment for the rep (8.3), the rep assignment on `DbSchema_ProviderVisit` for web Log a Visit (10.1b, K26), a licence gate in Act 0 (0.9b), and steps that were tagged unverified and are now proven on a fresh org. One case is still unverified: 10.1b when no `DbSchema_ProviderVisit` record exists. The assets are unchanged from v3.

## Timing

| Act | Name | Agent minutes (active agent work) | Human / device minutes (waiting on or acting for the thread) |
| :-- | :-- | :-- | :-- |
| 0 | Intake & discovery | 15 min | 5–10 min (six questions, seven keys, at 0.11) |
| 1 | Pre-install foundation | 90 min (includes the one-time browser-automation bootstrap and the asynchronous State/Country scan) | 5–10 min (inputs step and consent stops answered `ask`; 20 min if `PLAYWRIGHT_AVAILABLE = no`) |
| 2 | Package install & admin access | 20 min (the install is async, about 10 min) | 2–5 min |
| 3 | Post-install settings | 10 min | — (5 min if `PLAYWRIGHT_AVAILABLE = no`) |
| 4 | Field Rep persona | 20 min | 5–10 min (inputs step and rep decisions) |
| 5 | Territory & store foundation | 15 min + 5 min per extra store | 5–10 min (inputs step and store decisions) |
| 6 | OM bundle, context & pricing | 30 min (includes a ~2 min wait for async side effects) | 0–5 min (live consent stop C7 only; 5 min if `PLAYWRIGHT_AVAILABLE = no`) |
| 7 | Catalog, price books & pricing | 60 min | 5–10 min (inputs step and decisions; +5–10 min if `PLAYWRIGHT_AVAILABLE = no`) |
| 8 | Quote web configuration | 90–120 min | 20–40 min (inputs step, the 8.30–8.33a web checks and live stops; +20 min if `PLAYWRIGHT_AVAILABLE = no`) |
| 9 | Store Check & Visit Decoupling configuration | 70 min | 20–35 min (inputs step, the 9.9d and 9.23–9.25 web checks, the 9.20a sharing change on a `customer` org and, only if 9.1 finds one, the legacy-override approval) |
| 10 | Single mobile metadata generation | 35 min (mostly async) | 5–10 min for the 10.7a web check (5–20 min when 10.0a finds records another profile already uses) |
| 11 | iPad onboarding & first sync | 10 min (verification and waiting on the device) | 15–25 min |
| 12 | Store Check E2E | 5–8 min (reconciliation) | 10–20 min |
| 13 | Draft Quote E2E | 8–12 min (reconciliation) | 30–45 min |
| 14 | Submit, signature, PDF, unlock | 10–15 min (reconciliation) | 10–15 min |
| 15 | Repeat order from Last Order + final acceptance | 6–10 min (about 15 min when 15.0 builds a replacement source quote, which also adds a second C10 Submit: 10–15 more human minutes) | 10–15 min |
| | **Total** | **≈ 8–9 h of agent time (Acts 1, 7, 8 and 9 take most of it)** | **≈ 2.5–4.5 h of human / device time, mostly on the iPad (≈ 3–5 h if `PLAYWRIGHT_AVAILABLE = no`). External waits come on top: a licence request (Act 4) or an unanswered decision can hold the run for hours** |

Durations assume no gated defect fires. They are sequential sums; the run-order options in Appendix A (O1–O3) overlap human and device time with agent work and change no step. Agent minutes exclude idle time; human / device minutes are the time the operator spends acting or waiting. Besides the six Act 0 questions, Acts 1, 2, 4, 5, 7, 8, 9, 11 and 13 each start with an inputs step (about 2–5 min with recommended answers; skipped when the inputs file already has them), included in the human figures. Each Act's actual duration is recorded in the run manifest and reported at its checkpoint.

## Introduction

This steel thread takes a **blank Salesforce org** (no Life Sciences Cloud package) to a working **Store Check** and **Order Management (Quotes)** experience on the Life Sciences Cloud iPad app, for one Field Sales Representative visiting retail stores (for example pharmacies).

By the end the rep runs a Store Check (Availability Audit, Primary and Secondary Display) and captures a quoted order from the Store Assortment, the Last Order or the catalog, with tiered and manual-discount pricing, a compliance disclaimer, signature, Submit and PDF.

A **coding agent** executes the thread with the `sf` CLI and Salesforce APIs; a human is involved only where no API exists or a physical iPad is needed.

## Assumptions and out of scope

**Assumptions**
- The target is a new production or sandbox org; the admin running the agent has System Administrator and can log in with the `sf` CLI.
- The org edition supports Life Sciences Cloud for Customer Engagement: the `IndustriesLSOCE` org permission is available. No supported API exposes this permission, so Act 0 records it as a known constraint (0.4) rather than checking it, and Act 1 reports the Document Management gap it causes.
- The customer has the `lsc4ce` package version ID (04t…) and an iPad (or simulator) with the matching app build. Default device: the simulator when the operator provides one, otherwise a physical iPad. Device handling is in "iPad simulator and physical iPad" under Tools and browser automation.
- Every demo-data value (currencies, stores, products, price books, assortment, tiers, discount policy, disclaimer) comes from the customer in Act 0. The thread never applies a default silently.
- Order of preference for every setup step: an API or Metadata deploy first, always confirmed by a read-back; then browser automation (Playwright) from the exact click path given; a human only when `PLAYWRIGHT_AVAILABLE = no`. **Exception: web verification checks** (8.30–8.33a, the rep and manager render checks of 8.9b and 8.16a, the 9.9d page check, the 9.23–9.25 rep render checks, 10.7a) always go to a person (👤 HUMAN, with the exact clicks and a **Report back** list), whatever `PLAYWRIGHT_AVAILABLE` says; the agent then verifies the results by REST or SOQL. Browser automation is for Setup configuration pages only (on Lightning lookups and grids a person is several times faster than browser automation). The only steps that always need a person are listed under Human-required steps.

**Out of scope**
- HCP / provider visit content (call reporting, samples, detailing). In-Person and Remote Visit record types are only kept on their existing experience by the routing rules.
- Presentation Content on the Visit: the tab renders, but no content is configured.
- Split delivery / Order Delivery runtime (a later release), ERP integration, and order fulfilment after Submitted.
- Approval-process design beyond the single gated unlock/approval route in Act 14.
- Translations beyond the org default language.
- Data migration and bulk loads beyond the demo data collected in Act 0.

## The Acts at a glance

| Act | Name | What it delivers | Irreversible / stop points |
| :-- | :-- | :-- | :-- |
| 0 | Intake & discovery | Six questions (seven keys) at 0.11 incl. consents C1–C11 and C14 and `ORG_KIND`; the rest are asked per Act; read-only org profile; run manifest | C1–C11 and C14 answered |
| 1 | Pre-install foundation | Admin licences and permission sets, then every setting the package installer requires, in the required order | C1 Chatter/base settings, State/Country, Person Accounts, Multi-Currency; C14 org preferences, Account Plans, Enable Sales Territory, Surveys |
| 2 | Package install & admin access | Admin access confirmed; `lsc4ce` installed in one attempt | — |
| 3 | Post-install settings | Store Check, Quotes, Group Membership, record-type routing, mobile-admin permissions | — |
| 4 | Field Rep persona | Field Rep profile, permission sets, licenses, user | C14 AppUsageAssignment Read (4.9a) |
| 5 | Territory & store foundation | Active territory model, rep assignment, stores with addresses (Places) | Territory model activation; C14 manager territory assignment (5.4a) |
| 6 | OM bundle, context & pricing | Order Management features, Quote context mapping, pricing recipe | OM "Turn On" |
| 7 | Catalog, price books & pricing | Catalog, products, price books, tier schedules, the one active pricing procedure, Sales Transaction Type, org-default procedure, product discovery | — |
| 8 | Quote web configuration | Quote record type, layout, FLS, record page, product views (Store Assortment + Last Order), 5-stage lifecycle, documents and disclaimer | Trigger-handler enablement; C14 AppUsageAssignment Read (8.15), override removal (8.9c), value sets and PathAssistant (8.16a), Document Builder licence (8.25) |
| 9 | Store Check & Visit Decoupling configuration | Visit record-type routing, Store Check Visit page and lifecycle, assessment definitions for all three tabs | Removing legacy Visit overrides (if present); C14 muting hardening (9.21, only when on), org-wide list view (9.22a) |
| 10 | Single mobile metadata generation | One validated mobile metadata cache covering both features | — |
| 11 | iPad onboarding & first sync | Rep logged in on iPad with synced data | — |
| 12 | Store Check E2E | Screens SC1–SC14 accepted on iPad | Gated: Verified checkbox, offline first upload |
| 13 | Draft Quote E2E | Screens Q1–Q13 accepted on iPad | Gated: nil Status, workflow lock, reprice error, blank address, i18n tokens; C14 rep currency change (G12) |
| 14 | Submit, signature, PDF, unlock | Screens Q14–Q17 accepted; PDF and unlock exercised once | Gated: double submit, PDF stuck, unlock route |
| 15 | Repeat order from Last Order + final acceptance | Last Order product view proven; two-level completion report | — |

**Definition of done.** Both feature journeys are accepted screen by screen on the iPad, as listed in the [per-screen acceptance checklist](#per-screen-acceptance-checklist). Each one is reported at two levels:

- **Configuration verified:** every postcondition query passes. Reported separately for web and iPad.
- **Customer workflow verified:** the rep completes the journey. Reported separately for web and iPad.

Every gated defect that fired is reported with its signature, and state is preserved.

## How the agent runs this thread

These rules apply to every Act and win over a conflicting step text.

**Speed**
1. **Parallel, read-only discovery.** Run independent describes and queries in parallel, once per Act. Cache describe results in the run manifest and do not re-query them.
2. **Bundled deploys.** Put compatible metadata in one manifest per step and deploy it with `sf project deploy start --manifest <file> --wait 30 --json`. With `rollbackOnError=true` (the default) the Metadata API rolls back the whole bundle on error, so every deploy is atomic. **Do not run a check-only validation before any deploy, in any Act**; deploy for real and read the result back.
3. **Atomic seed data.** Insert seed records with Composite (`allOrNone: true`) or sObject Collections. Never insert record by record.
4. **Bounded polling.** For every async job, poll at a stated interval up to a stated maximum. At the maximum, stop and report `BLOCKED` with the last observed state.
5. **One mobile generation and one sync per accepted configuration baseline.** Build all server configuration for both features first (Acts 1–9), then generate once (Act 10). Regenerate only after a configuration change that the iPad must see, and only with a new parent/child pair.
6. **Ask ahead, prefetch while waiting.** While an Act runs, the agent may send the next Act's `N.in` questions (with recommendations) as one non-blocking message, and may run the next Act's read-only describes during an async wait. Answers are written to the frozen inputs only when the `N.in` step runs (recorded `answered`, with a `decisions` row noting it was asked early); a prefetched describe of anything the current Act changes is re-read at the next Act's start; a key whose recommendation needs a result of the current Act is asked after that result; if `N.in` would now recommend a different value than the one sent early, it re-asks that key.

**Forbidden ceremony.** Do not use any of the following:
- authorization phrases or single-use approval tokens; request or file hashes; an evidence file per command;
- repeated guard re-queries of state you just wrote; asking for approval of each atomic command.

Approval of an Act covers all routine, reversible steps in it.

**State**
- **Folder layout.** Everything the agent writes lives under `<WORK_DIR>/runs/`, where `<WORK_DIR>` is a local folder the customer chooses (pre-filled `WORK_DIR`, else the agent's current working directory; name it at 0.1 and record it in the manifest; it is not asked). Nothing is written next to this document:
  ```
  <WORK_DIR>/runs/
    inputs/run-inputs.json          reusable inputs; edited by the customer only, never by the agent
    run-NN/                         one folder per run; never reused
      run-inputs.frozen.json        copy of the inputs taken at Act 0; the agent writes inputs-step answers into it, and nothing else edits it
      run-manifest.json
      run-learnings.jsonl
      gap-journal.md                Gap journal rows appended during this run (same columns as the Gap journal section); this document is never edited during a run
      act-0-summary.md … act-15-summary.md   one per Act: the checkpoint report
      org-changes.md                every org change made outside a step as written (see Org changes outside the steps)
      artifacts/                    retrieved metadata, deploy packages, query outputs, run-inputs.as-copied.json (untouched audit copy); org-changes/backup/ holds the before-copy of every component changed through org-changes.md
  ```
- **New run or resume.** The run ID is a two-digit counter (`run-NN`), never a timestamp. At the start, the agent looks at the highest-numbered run folder. If its manifest shows a step that isn't finished, ⏸ STOP and ask: resume that run, or start the next number. Otherwise it starts the next number. If the customer names a run number explicitly, use it, provided that folder does not exist. A run folder is never deleted or overwritten.
- **Run files stay local.** They contain org IDs, usernames, the rep's email, store addresses, screenshots and deploy copies; keep `runs/` out of anything shared outside the customer's team. Never keep a Playwright storage state, a frontdoor URL or `sf org open --url-only` output in `runs/`: delete them before the Act ends. Keep the Playwright script and its log only after removing any URL that carries a session.
- **One run manifest:** `run-manifest.json` in the run folder. It holds the inputs, the discovered names and IDs, and the status of every step (`pending / done / reused / gated / failed`) with the resume pointer.

**Determinism.** The same runtime inputs must produce the same configuration, the same decisions and the same reports in every run.
- **Inputs are frozen after Act 0.** The `capturedInputs` block of the run manifest is the only source of runtime values. A later change goes through *(P2)*, is shown as a delta, and is logged as a learning.
- **Versions are pinned.** `<API_VER>` is discovered once (0.2) and used in every call. `<PKG_VERSION_ID>` is detected from the installed package at 0.9 when `lsc4ce` is already installed (source `detected`), otherwise supplied and validated at 2.in; `<IPAD_APP_BUILD>` is read at 11.in; both are then pinned in the manifest. If the org's API version changes during the run (for example, a release upgrade), stop and report.
- **Names are deterministic.** Every artifact name is built from `<PFX>` and the name given in the step. Never add timestamps, counters or random suffixes.
- **Order is fixed.** Acts and steps run in the listed order. Parallel work is limited to read-only discovery and to the run-order options O1–O3 in Appendix A, none of which needs concurrent execution.
- **No judgment calls.** Every branch is decided by one of three things: a runtime input, a query or describe result checked against the rule written in the step, or a ⏸ STOP. If the observed state matches no rule, the agent stops, reports in the P5 format and logs a learning. It never improvises a fix.
- **Describe-driven values.** A describe result is recorded in the manifest once, and the step's rule picks the value. If the expected value is missing, stop and show the described list. Never use the nearest match.
- **Retries are fixed.** An action is retried only where the step or gate says so (for example, G6 retries once). Polls use the stated interval and ceiling.
- **Self-contained.** Every step needs only the `sf` CLI, the Salesforce REST, Tooling and Metadata APIs, a browser for UI steps, and this document; nothing depends on Salesforce-internal tools, source code or contacts. Where only Salesforce can act (an org permission), the step is a ⏸ STOP with the exact request to send to Support or the account team.

**Tools and browser automation**
- **Command mapping.** In any step, `<alias>` means `<ORG_ALIAS>`. REST calls (for example `GET /services/data/` and the org-preference calls) use `sf api request rest <path> --target-org <ORG_ALIAS> [--method PATCH --body @file.json]`. Tooling queries use `sf data query --use-tooling-api`. Read-only anonymous Apex (used to read values the APIs do not expose) uses `sf apex run --target-org <ORG_ALIAS> --file <file>`.
- **Rejected setting change.** If a Settings deploy or org-preference PATCH is rejected (error status, deploy errors, or the read-back differs from the expected value): save the full response in `<run>/artifacts/` and log it in the Gap journal. If the step names a fallback route (for example a Setup UI path), use it once; never retry with changed values. Still rejected → mark that step `BLOCKED` naming the setting and the error, skip every step that depends on it (Appendix A), finish the remaining independent steps of the current Act, then stop at its checkpoint and ask the customer to fix the cause (licence, permission or prerequisite named in the error) or accept the limitation. Deploys: one deploy per step, except where the step itself bundles files into one deploy (1.2, 1.18 with 1.18a, 7.18 flow + settings, 10.1).
- **API first where a step names it (8.10, 8.14, 8.23, 8.34, 9.9d).** Save the rollback copy first (retrieve or Tooling query into `<run>/artifacts/<step>-pre/`), then write, then read back. An API-first route that is rejected or fails its read-back follows the rule above: save the response, log it in the Gap journal, use the step's browser route once, never retry with changed values. Record the API result as a `verification` row either way.
- **Project scaffold for retrieve and deploy.** `sf project retrieve` and `sf project deploy` need an sfdx project. Run every retrieve or deploy from a step folder under `<run>/artifacts/` that contains `sfdx-project.json` (`{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"<API_VER>"}`) and an existing empty `force-app/` folder. Without it the command fails with `The path "force-app", specified in sfdx-project.json, does not exist.`
- **Browser automation for 🖱️ UI steps.** The runtime must be a real Playwright runtime, bootstrapped once (probed at 0.11, or at the first UI step):
  1. Install Playwright locally under `<run>/artifacts/playwright/` and launch the system Chrome channel (`channel: 'chrome'`) headless. If the page closes at the frontdoor redirect (`/secur/contentDoor`) and no Setup page loads, launch Playwright's bundled Chromium instead (`npx playwright install chromium`, no `channel`) with the same URL.
  2. Log in by opening the URL printed by `sf org open --target-org <ORG_ALIAS> --path <the Setup path of the step> --url-only` (pass the target page with `--path`; navigating to it after a plain frontdoor login can leave the Setup iframe unauthenticated). Select the Setup frame by its `salesforce-setup.com` host, excluding the page's main frame (the Lightning Setup shell is on the same host at this release); the Visualforce content frame has an `.apexp` or `/ui/` path. It carries a short-lived session token: use it at once, never write it to the manifest, the learnings log or a summary, and delete any file that holds it before the Act ends. Do not share the `artifacts/` folder.
  3. Accept a browser tool as `PLAYWRIGHT_AVAILABLE = yes` only if it is Playwright or equivalent browser automation that can drive Setup, including reading and clicking inside Setup's cross-origin Visualforce iframes. A CDP-style tool that can navigate, read the accessibility tree, click and type but cannot read inside those iframes does not qualify: record `PLAYWRIGHT_AVAILABLE = no` and use the 👤 HUMAN fallback. The 0.11 probe proves this by opening the State and Country/Territory Picklists overview page (read-only) and reading an element inside its Setup iframe.
  4. Setup wizards render their content in an iframe. Select the frame by URL pattern, then target elements by accessible role and exact name, never by coordinates or label text. Classic Setup URLs can redirect to Lightning home; use the `/lightning/setup/...` path given in the step.
  5. SLDS checkboxes: the label intercepts clicks on the input, so click the label.
  6. Background deployments and async scans: poll at the step's interval and ceiling. Never click the button again after an "in progress" message.
  7. Web-UI quirks (apply in every UI step): the Trigger Handler enable switch does not respond to clicks or keys (use the Tooling PATCH given in 8.17 instead); Admin Console fields commit on blur, so tab out of a field before saving; type-ahead suggestion lists stay open, so pick the option explicitly, then press Escape; edit grids load late, so wait for the grid rows before targeting a cell.
- **iPad simulator and physical iPad.** This is the only home for device guidance; Acts 11 to 15 refer to it instead of repeating it. Use the simulator when the operator provides one; otherwise a physical iPad, where the human performs every tap.
  - **Signature pad.** Draw strokes inside the pad; never start or end a stroke at the screen edge (edge swipes are taken by the system and the stroke is lost). Physical iPad: sign with a finger or Apple Pencil, also inside the pad.
  - **Passcode.** Always entered by the human. The agent never records it, and never taps Reset Passcode or Log out.
  - **Sync.** Run it only from a page that shows the top tab bar: Profile → Begin Sync → Sync. Save any open record before syncing (Save before Sync). The same path applies on a physical iPad. On the simulator the "Begin Sync?" alert may ignore the first tap: tap again once, then wait for the sync to finish.
  - **Relaunch.** After a mobile metadata regeneration, relaunch the app before checking UI changes (Sync alone is not enough). Physical iPad: swipe up from the bottom edge to open the app switcher, swipe the app away, then reopen it from the Home screen. Simulator: close and reopen the app.
  - **Taps stop registering.** Simulator: reboot it, then resume from the manifest pointer. Physical iPad: restart the iPad (press and hold the top button, slide to power off, switch on again), then resume from the manifest pointer.
  - **System alerts.** Simulator: dismiss with physical-style taps (press and release at the button), not accessibility actions. Physical iPad: the human taps the button.
  - **Camera.** The simulator has no camera; camera-dependent steps are recorded as `KNOWN_LIMITATION`. Physical iPad: the human allows camera access when the app asks (if it was denied, enable it for the app in the iPad Settings) and takes the photo; the step is then checked normally, not recorded as a limitation.
  - **Wrong record.** Before tapping anything that acts on a quote, verify the open quote's name matches the one the step created.

**Run learnings log.** The agent keeps `run-learnings.jsonl` in the run folder, one JSON object per line.
- **When to write a row:**
  - after any step that was not a clean `done` or `reused` on the first attempt: a retry, a playbook fix, a gate that fired, a STOP outcome, an unexpected value, an instruction that was missing or wrong, or a step that took more than twice its estimate;
  - one summary row per Act at its checkpoint, written even when there were no learnings (`"type": "act_summary"`);
  - at every step that tests an item in [UNVERIFIED items](#unverified-items): one `verification` row, with `result` = `proven`, `disproven` or `still_open`;
  - at every step with a wait, retry or fallback that passed on its primary path first time: one `worked_as_written` row naming the branch and, for a wait, the observed time.
- **Fields:**
  - `act` and `step`;
  - `type`: `blocker`, `fix_applied`, `gate_fired`, `instruction_gap`, `unexpected_value`, `timing`, `verification`, `worked_as_written` or `act_summary` (no other values);
  - `observed`: the exact error text or value;
  - `cause`, `action_taken` and `result`;
  - `evidence`: the relative path, inside the run folder, of the artifact that proves the row (query output, deploy result, Playwright script and log, screenshot); every row except `act_summary` has one;
  - `org_change`: the `org-changes.md` row number when the row led to an org change outside a step, else `null`;
  - `proposed_change`: the target section of this document and the exact replacement text;
  - `scope`: `general` or `org_specific`;
  - `status`: always `proposed`.
- **Customer-safe at write time:** use the placeholders from the Runtime input schema, never record IDs, usernames, emails, hostnames or timestamps.
- **This log does not change this document during a run.** It is handed over with the Gap journal and `org-changes.md` at the end of Act 15.

**Org changes outside the steps.** Any write to the org that is not a step's action as written goes in `org-changes.md` in the run folder: a fix that differs from the step or its playbook, a diagnostic change, a workaround, and every change made after Act 15 (post-run fixes use the same run folder and the same log; never start a new run folder for them).
- **Before the change:** retrieve the current component or record and save it under `artifacts/org-changes/backup/` (file name starts with the row number). The safety rules still apply: live stop for destructive, OWD or security-relevant changes, and retrieve-and-merge for full-replace deploys.
- **After the change:** read it back, then append one row: `| # | Act/step (or post-run) | Change | Method | Why (learnings row) | Verified (read-back) | Rollback | Thread change (target section and replacement text, or note only) | Status |`. `Status` is `kept` or `rolled back by #n`. Rolled-back rows stay in the log. Write the matching learnings row (`fix_applied`, with `org_change` = the row number).
- **Customer-safe at write time,** as for the learnings log.
- **Hand-over:** at 15.7 and after the last post-run fix, report the row count, the rows still `kept` and the rows whose thread change is not yet applied here.

**Checkpoints and safety**
- **After every Act, stop and report:**
  - the status: `PASSED`, `PASSED_WITH_NOTES`, `BLOCKED`, `FAILED` or `AWAITING_CUSTOMER_VALIDATION`;
  - what changed, what was reused, and the verification results;
  - where the customer can see it (Setup, web or iPad);
  - open items and the actual duration;
  - the learnings recorded in this Act (count, and one line each), and any `org-changes.md` rows added in this Act;
  - the Act's `activeMinutes` and `humanWaitMinutes` from the manifest.

  Then ask: "Act N is complete. Ready to continue to Act N+1: <name>?"
- **Auto-continue.** If `AUTO_CONTINUE = yes` and the Act ends `PASSED`, or `PASSED_WITH_NOTES` where every deviation is a `KNOWN_LIMITATION` outcome (next bullet), the agent writes the report, prints the closing line as a statement ("… continuing to Act N+1: <name>") and continues without waiting. It always waits after Act 0, and after any Act that ends `PASSED_WITH_NOTES` with a deviation that is not a `KNOWN_LIMITATION`, or `BLOCKED`, `FAILED` or `AWAITING_CUSTOMER_VALIDATION`. It also waits at any inputs step (`N.in`) that still has unanswered keys, and continues on its own when every key for that Act is already filled. If `AUTO_CONTINUE = no`, it waits after every Act.
- **Deploy safety (full replaces; every permission-set, profile and app deploy in every Act).** A Metadata API source deploy of a permission set, profile or app (`CustomApplication`) is a **full replace**: a snippet with only the new element removes the set's object, field and tab permissions and resets its label. Snippets in the Acts are never the file to deploy. Never edit a packaged permission set: layer a permission set group with a muting permission set instead. For `<FIELD_REP_PS>`, `<FIELD_REP_PROFILE>` and `CustomApplication:lsc4ce__lifeSciencesCommercial`, always:
  1. Retrieve the full file first as the `.pre` baseline (for the profile, the manifest must also list what the profile references and the thread edits: the `CustomApplication`, every `Layout` of each object whose assignments it carries, and the `RecordType`s, as in 4.2. A manifest with only the profile and record types returns a partial profile with no `layoutAssignments` or `applicationVisibilities`. Example for 9.8: `CustomApplication` `lsc4ce__lifeSciencesCommercial`; `Profile` `<FIELD_REP_PROFILE>`; `RecordType` `Visit.In_Person`, `Visit.Remote`, `Visit.Store_Check`; `Layout` every `Visit-…` layout in the org). Record the counts of object permissions, field permissions, tab settings, record-type visibilities and layout assignments, and the label.
  2. Add only the new element to that full file.
  3. Deploy the whole file.
  4. Retrieve again and compare with `.pre`: every count must equal the old count plus the elements added, and the label must be unchanged. If that retrieve does not return within 2 min, do not retry it: compare the counts by SOQL instead (`ObjectPermissions`, `FieldPermissions`, `PermissionSetTabSetting` and the `PermissionSet` `Permissions*` fields).
  5. Query `PermissionSetAssignment` for `<FIELD_REP_USER>` and `<FIELD_REP_PS>`; re-create it if absent. The rep must never be left without the set.
  6. If any count dropped, redeploy `.pre` plus the new element before doing anything else, and log a `wrong_instruction` learning.
- **Existing customer components (only when 0.9 found `lsc4ce` already installed).** Before a deploy that writes a component that existed before this run (the three above, the `<PFX>` permission sets of 1.6, 3.6 and 7.16, the admin profile of 8.30b and 9.8b, `Layout` `Quote-Quote Layout`, `Layout` `Visit-Store Check Visit Record Page`, `FlexiPage` `LifeScience_Quote_Record`, `Store_Visit` and `lsc4ce_Store_Account_Record`, `CustomObject` `Quote` at 8.23; `LifeSciConfigRecord`s are guarded in 8.10–8.34 and 10.0a), save the retrieved copy as `.pre` and build the deploy file from `.pre` plus only what the step adds or changes. If that file would remove or change anything in `.pre` the step does not name (customer edits), ⏸ STOP in the P5 format with the list; deploy only on the customer's yes. On an org where this thread installed the package, steps run as written.
- **Rep-session rule (one rule for every step that needs a rep or manager web session).** Steps marked "as the rep" or "as `<MANAGER_USER>`" (8.9b, 8.16a, 8.30–8.33, 9.9d, 9.23, 9.24, 10.7a, G4) use Login-As only when `SMOKE_AS_REP = yes` and the Login-As setting is on (C12 covers every user, rep and manager). For the web checks (8.9b, 8.16a, 8.30–8.33a, 9.9d, 9.23–9.25, 10.7a) the **person** does the Login-As (Setup → Users → **Login** next to `<FIELD_REP_USER>`), runs the clicks and reports back; when the Act's checks are reported they end the rep session with the header link *Log out as …* (web only; not the iPad Log out). Otherwise (`SMOKE_AS_REP = no`, C12 declined, or no **Login** link): run the step's admin-side substitute (metadata or query read-back) and record the step `PASSED`, listing the substitution; where the step has no substitute, mark that check 👤 HUMAN (iPad) at the Act 12–14 step that covers it and list it in the checkpoint under "deferred to iPad". `PASSED_WITH_NOTES` is only for `KNOWN_LIMITATION`.
- **Zero-match checks.** `rg` and `grep` exit 1 when nothing matches, and `rg -c` / `grep -c` print `0` and still exit 1: that is expected, and a `0` is a **pass** wherever the pass rule expects 0. Read the printed number, not the exit code; write such checks as `grep -c '<pattern>' <file> || true`. If `rg` is not installed, use `grep` with the same arguments.
- **Status for known limitations.** The documented outcomes are listed in the back matter under "Known limitations" (K1–K29). A step can name a platform behaviour as a known outcome: its expected result says so and its pass rule carries the tag `KNOWN_LIMITATION`. That is not a failure and not a P5 stop.
  - When the observed behaviour matches the documented outcome, the agent marks the step `done` with the tag `KNOWN_LIMITATION`, writes the Gap journal row and a learnings row (`gate_fired` where a G-gate exists, otherwise `unexpected_value`), and lists it in the checkpoint report in the P5 format under "known limitations".
  - Every G-gate attached to the step still applies (for example, preserve state; do not regenerate or delete).
  - An Act whose only deviations from `PASSED` are `KNOWN_LIMITATION` outcomes ends `PASSED_WITH_NOTES` and the agent continues automatically under the Auto-continue rule. With `AUTO_CONTINUE = no` it waits, like after every Act.
  - If the observed behaviour differs from the documented outcome in any way, it is not a known limitation: stop and report in the P5 format.
- **Irreversible-action consent (C1–C14).** Act 0 (step 0.11) shows the [consent list](#irreversible-action-consent-list): each irreversible or org-wide action, its consequence and the precondition it relies on. The customer answers `yes` (pre-consented) or `ask` (stop live) for each item; nothing is ever defaulted to `yes`. C1–C11 and C14 are answered at 0.11. C12 is asked just in time at 8.30a and never blocks. C13 (the sharing change at 9.20a) is answered at 0.11 only when `ORG_KIND = test` (`yes` or `ask`, like the others); when `ORG_KIND = customer` it is always a live stop. **C14 (access grants and hard-to-reverse setup changes)** is one answer at 0.11 for every action the C-table lists under C14; each of those steps starts with a C14 check: `yes` and the step precondition passes → record `pre-consented (C14)` and act; `ask` or the precondition differs → ⏸ live STOP naming the action. If the customer declines at a live STOP, the step is not run, is recorded `declined` and reported `BLOCKED` at the checkpoint, and the steps that depend on it are reported, not forced. At each consent STOP:
  - if the item is `yes` **and** its precondition check passes, the agent records `pre-consented (Cn)` with the check result in the manifest `decisions` and continues without stopping;
  - if the item is `ask`, or the precondition check fails, it stops (⏸) and asks live, showing what differs.
- **Always a live stop (⏸ STOP), never pre-consented:**
  - any destructive change (deleting records or metadata, removing an existing override, FP-9.6);
  - OWD changes (the sharing change at 9.20a, C13), except C13 pre-consented at 0.11 on a `test` org whose precondition passes;
  - any irreversible or org-wide action not on the consent list;
  - an existing artifact that differs from the step's target (see Idempotency);
  - a security-relevant permission change that the step does not already name.
- **Ambiguous results.** After an ambiguous Save, Submit, activation, generation or sync, **never repeat the action**. First reconcile the persisted state with a query. Then either mark the step done or apply the playbook fix.
- **Resume.** On restart, read the manifest. Revalidate only the last incomplete step and its direct prerequisites, then continue.
- **Known defects: configure, then gate.** Build the full configuration and test once. If the documented signature appears:
  - report it as a known platform limitation, using the P5 format (tag `KNOWN_LIMITATION`; the step ends `PASSED_WITH_NOTES`, see *Status for known limitations*);
  - preserve the state and do not delete or retry blindly;
  - record it in the Gap journal and continue with the next independent step.
- **Idempotency.** Every create step first detects an existing artifact by its natural key, which is given in the step. If the artifact exists and matches, reuse it (`reused`). If it exists but differs, stop and show the difference. Otherwise create it.

## UX principles

| # | Principle | What the agent does |
| :-- | :-- | :-- |
| P1 | **Goal confirmation, not assumption** | Restates the goal and the success criteria before Act 1 and before each Act. Never invents demo data or a goal the customer did not state. |
| P2 | **Corrections are cheap** | When the customer corrects an input, updates the manifest and re-plans only the affected steps, then shows the delta before applying it. |
| P3 | **Continuity and idempotency** | Every step is detect → reuse → create. On resume the agent continues from the manifest pointer without redoing finished work, and states what it reused. |
| P4 | **Boundaries and irreversible consent** | Collects informed consent for every irreversible or org-wide action once, at Act 0, item by item, each with its consequence in one sentence; re-checks the precondition before acting and stops live if anything differs or before any destructive change. Offers a read-only dry run (the planned change set) before any Act that writes. |
| P5 | **Recovery in a fixed format** | Every failure or gated defect is reported as: **What happened → Why it matters → Possible causes → What I can do → Partial-success status** (what is done and safe, what is not). |

## Persona and JTBD

| Persona | Context | Job to be done |
| :-- | :-- | :-- |
| **Customer Salesforce admin** (primary operator) | New org; owns the rollout | "Get my org from zero to a Field Rep who can run a store check and take a signed order on the iPad, and tell me exactly what changed and what is still a known limitation." |
| **Field Sales Representative** (end user, iPad) | Visits stores, often with poor connectivity | "Check stock and displays for my priority products, then take a correctly priced, signed order from the store assortment or last order and submit it, without calling the office." |
| **Sales manager** (secondary) | Reviews and unlocks submitted orders | "When a rep asks to unlock a submitted order, review and decide with an audit trail." |

## Runtime input schema

Each value below is asked when it is first needed (or at the start of the previous Act, speed rule 6): Act 0 asks six questions (0.11) plus, only when no matching `sf` login exists, the org alias (0.1a); each later Act that needs inputs starts with an inputs step (`N.in`) that asks only that Act's keys ("Asked at" column). Every question carries a recommended answer and its source; the customer accepts, edits or replaces it. Nothing has a silent default: a value is used only after the customer answered or accepted the recommendation, and the manifest records which (`prefilled`, `answered` or `accepted recommendation`). The customer can pre-fill keys in `<WORK_DIR>/runs/inputs/run-inputs.json`; pre-filled keys are validated and not asked again. Rows named `X_n` become arrays (`STORES`, `CATEGORIES`, `PRODUCTS`, `PRICEBOOKS`); combined rows (`A` / `B`) become separate keys. `PENDING` marks a value still to fill, and `_defaultsToConfirm` lists the keys that hold an offered default. Any string starting with `PENDING`, and the legacy sentinels `DISCOVERED_AT_ACT_0` and `HUMAN_ENTERS_IN_SETUP`, count as `PENDING`. For keys whose valid answer may be empty (`ACTIVE_CCYS`, `PRIORITY_PRODUCTS`, `TARGETS`, `KPI_TYPE_MAP`), the template value is `PENDING`; an empty array or object counts as an answer only when the customer wrote it and the key is not in `_defaultsToConfirm`. Answers are written only to the run's frozen copy, which is the only copy the agent uses. A key may stay `PENDING` until its inputs step, where it must be answered before the Act continues. Three asks happen outside an inputs step: C12 (8.30a, non-blocking), C13 and the sharing change at 9.20a (a live stop on a `customer` org; on a `test` org C13 is answered at 0.11). The "Example" column shows the shape of a value and is never applied; "starter set" recommendations are demo data for a dry run and are shown as such.

| Key | Meaning | Required | Example (illustration only) | Asked at | Recommended answer (source) |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `ORG_ALIAS` / `ORG_URL` | The `sf` alias of the target org, and the Lightning or My Domain URL the customer gives (used to log in and to confirm the alias points at the intended org) | yes | (customer-supplied) | 0.1a | The alias already in `sf org list` whose instance URL matches `<ORG_URL>`; if none, a new short alias is created by the 0.1a login |
| `PKG_VERSION_ID` | `lsc4ce` package version ID (04t…) for the customer's release | yes | (customer-supplied) | 2.in, only when 0.9 found no `lsc4ce` row (else `detected` at 0.9, not asked) | Installed: the installed `SubscriberPackageVersionId` (source `detected`). Not installed: none — the customer supplies the `04t…` ID for their release; 2.in validates it with two Tooling queries |
| `IPAD_APP_BUILD` | Life Sciences Cloud iPad app build to install | yes | (customer-supplied) | 11.in | None — the human reads the build of the app installed on the iPad |
| `PFX` | Prefix for every custom API name this thread creates. Letters and digits followed by exactly one underscore; every name appends to it directly (`<PFX>Order` → `Acme_Order`). Act 0 rejects a value that does not end in one `_` or that contains `__` | yes | `Acme_` | 0.11 | The prefix of the thread's permission sets found at 0.9a (source `detected`; reusing it avoids duplicates); else the org name's first word, letters and digits only, plus `_` (0.3 `Organization.Name`) |
| `CORP_CCY` | Corporate currency (ISO code) | yes | EUR | 0.11 | The org's corporate currency: on a multi-currency org `SELECT IsoCode FROM CurrencyType WHERE IsCorporate = true` (0.7); on a single-currency org the 0.3 `UserInfo.getDefaultCurrency()` read with anonymous Apex, which returns the running admin's currency, not the corporate one, when the two differ; `Organization` has no currency column at API 68.0; the same question confirms the one currency all stores quote in, recommended equal to `CORP_CCY` |
| `ACTIVE_CCYS` | Additional active currencies with conversion rates | yes (may be empty) | — | 0.11 | None (empty), which keeps Multi-Currency to the corporate currency only |
| `ADMIN_USER` | The admin running the agent (discovered and confirmed) | yes | (discovered) | 1.in | The user `sf` is logged in as (0.2 `sf org display`). 1.in also resolves that user's User Id and stores it as `<ID:ADMIN_USER>` in `capturedIds` |
| `FIELD_REP_USER` | Reuse an existing user, or create one (first/last name, email, username, alias, nickname, locale, language, time zone) | yes | (customer-supplied) | 4.in | `create`; the customer gives an email they can read and optionally a first and last name (default First 'Field', Last 'Rep' for a dry run), and the agent proposes the rest: username = email + `.lsc`, alias from initials, locale, language and time zone copied from `<ADMIN_USER>` |
| `FIELD_REP_PROFILE` | Name of the Field Rep profile to create or reuse | default offered | `<PFX>Field_Sales_Representative` | 4.in | `<PFX>Field_Sales_Representative` (offered default) |
| `FIELD_REP_PS` | Name of the Field Rep custom permission set (4.1) | default offered | `<PFX>Field_Rep_Route_Access` | 4.in | `<PFX>Field_Rep_Route_Access` (offered default) |
| `MANAGER_USER` | The rep's manager, who approves unlock requests (existing user) | yes | (customer-supplied) | 4.in | `<ADMIN_USER>` for a dry run; the rep's real manager for a customer run. The manager is also assigned to `<TERRITORY>` at 5.4a (the single setup; 8.21c and 14.2a only re-check it). `MANAGER_PROFILE` is derived from the user record, not asked |
| `TERRITORY_MODEL` / `TERRITORY_TYPE` / `TERRITORY` | Territory model, type and territory the rep and stores belong to | yes | one territory | 5.in | An existing model, type and territory if 0.8 found Territory Management in use; otherwise `<PFX>Territory_Model`, `<PFX>Territory_Type`, `<PFX>Territory_1` |
| `STORE_n` | For each store: name, street, city, state/province, postal code, country, currency (default `CORP_CCY`). The agent derives `sourceKey` = `<PFX>STORE_<n>` (n = position in the list) and freezes it in the manifest at 0.12; it is the idempotency key in 5.6 | ≥ 1 | three pharmacies in one city | 5.in | Starter set: one store, `<PFX>Store_1`, at the org's company address (0.3 `Organization` address fields), in the store currency confirmed at 0.11 |
| `CATALOG` | Product catalog name and code | yes | (customer-supplied) | 7.in | Starter set: `<PFX>Catalog`, code `<PFX>CAT` |
| `CATEGORY_n` | Product categories (Store Check groups products by category) | ≥ 1 | Miscellaneous | 7.in | Starter set: one category, `General` |
| `PRODUCT_n` | For each product: name, code, description, category, unit of measure, image (optional) | ≥ 1 | 23 products | 7.in | Starter set: three products, `<PFX>Product_A`/`_B`/`_C`, codes `<PFX>P001`–`<PFX>P003`, category `General`, unit of measure `Each`, no image |
| `PRICEBOOK_n` | Price books: name, description, currency, and list price per product | ≥ 1 | several price books | 7.in | Starter set: one price book, `<PFX>Price_Book`, in the store currency, list prices 10 / 20 / 30 for the three products |
| `ASSORTMENT` | Store Assortment name and member products | yes | 23 products | 8.in | Starter set: `<PFX>Assortment` with every `PRODUCT_n` |
| `PRIORITY_PRODUCTS` | Products flagged Priority (★) | yes (may be empty) | 2 products | 8.in | Starter set: the first product |
| `TARGETS` | Target value per product per Store Check tab | yes (may be empty) | Stock Count target 50 | 9.in | Starter set: Stock Count target 10 and Facing target 20 for every assortment product |
| `STORE_CHECK_COLUMNS` | Indicator columns per tab, with picklist values | default offered (the default column set) | see Act 9 | 9.in | The default column set defined in Act 9 (offered default). Allowed values: `default` (the Act 9 set) or a customer-supplied set given as indicator rows with picklist values; validate at 9.in and reject any other label (for example a named set the thread does not define) |
| `PRICING_TIERS` | Exactly two tier schedules: one `Range` (volume discount: the whole line quantity gets the rate of the band it falls in) and one `Slab` (tier discount: each band of the quantity gets its own rate). Each entry gives `method`, `productCode` (a `PRODUCTS` code priced in at least one `PRICEBOOKS` entry) and `bands` (lower bound, upper bound, discount %), in ascending order with no gaps. Non-cumulative only (the iPad's offline pricing does not support cumulative tiers). Act 0 rejects any other count, a missing method or a duplicate method | yes (exactly 2) | Range on one product, Slab on another | 7.in | Starter set: `Range` on `<PFX>P001` with bands 1–9 at 5% and 10–999 at 10%; `Slab` on `<PFX>P002` with bands 1–9 at 2% and 10–999 at 8% |
| `MANUAL_DISCOUNT_SCOPE` | Manual line discount allowed on all products or on a listed subset; percentage, amount or both | yes | all products | 7.in | All products, percentage |
| `DISCLAIMER_TEXT` / `DISCLAIMER_COUNTRY` | Compliance disclaimer shown on Review Order, and its country prefix | yes | six numbered clauses | 8.in | Text: no recommendation for a customer run (compliance content is the customer's); for a dry run, `TEST ONLY - not approved disclaimer text`. Country: the store's country as its two-letter code (for example `US`, not `United States`: 8.28 sends it as given, and the describe lists no country values to map a name to) |
| `QUOTE_STAGES` | Quote lifecycle stages | default offered | Draft, Submitted, Request for Unlock, In Review, Rejected | 8.in | The five stages listed (offered default) |
| `LAST_ORDER_STATUS` | Quote status that counts as a "last order" | default offered | Submitted | 8.in | `Submitted` (offered default) |
| `STT_NAME` / `PRICING_PROCEDURE` / `CONTEXT_DEF` | Names of the sales transaction type, pricing procedure and context definition | default offered | `<PFX>Order`, `<PFX>Pricing_Procedure`, `SalesTransactionContextAuto` | 5.in (`CONTEXT_DEF`, used in Act 6); 7.in (the other two) | The offered defaults |
| `PLAYWRIGHT_AVAILABLE` | Whether the agent may drive Setup pages that have no API | yes | yes / no | 0.11 | `yes` if the 0.11 probe succeeds: a real Playwright runtime can be installed locally, launches system Chrome (or Playwright's bundled Chromium) headless, and reaches Setup authenticated through `sf org open --url-only` (see *Tools and browser automation*); otherwise `no` |
| `IRREVERSIBLE_CONSENT` | For each consent item C1–C11 and C14 (0.11), C12 (8.30a) and C13 (0.11 when `ORG_KIND = test`; live at 9.20a when `customer`): `yes` (pre-consented; the agent proceeds when the precondition check passes) or `ask` (live stop). Never defaulted. C13 is always asked live on a `customer` org | yes (every item C1–C11 and C14) | C1–C11, C14 = yes | 0.11 (C12: 8.30a; C13: 0.11 on a `test` org, else 9.20a) | `ask` for every item: the agent stops live at each irreversible step. One answer covers C1–C11 and C14; per-item answers stay available |
| `ORG_KIND` | Whether the target org is a customer org or a disposable test org; decides the Login-As question at 8.30a and the close-out question at 15.7 | yes | `customer` | 0.11 | None: never assumed or defaulted. `customer` (a customer-owned or production-like org) or `test` (a disposable org). Always asked, even if the org looks like a sandbox |
| `MUTE_INDICATOR_EDIT` | Make indicator definitions read-only for the rep with a permission set group and muting set (9.21, K15) | no (optional) | no | 9.21 | `no` (off; K15 accepted). `yes` only when the customer wants it: C14 check at 9.21 *(unverified — fallback: if the muted group does not remove Edit, keep K15 as accepted and record it)* |
| `AUTO_CONTINUE` | Continue to the next Act without waiting when an Act ends `PASSED`, or `PASSED_WITH_NOTES` with only `KNOWN_LIMITATION` deviations | default offered (`yes`) | yes | 0.11 | `yes` (offered default) |
| `RUN_REP_CLI_CHECK` | Run the Field Rep CLI-session check (4.7) | yes | no | 4.in | `no` (4.6 checks the rep's access from the admin side; the step records `PASSED` and lists the substitution) |
| `PRICE_FLOOR` | Price floor value and the products it applies to, or `none` (7.13, step 14 of the procedure) | yes | none | 7.in | `none` |
| `RUN_BROWSE_CATALOGS_CHECK` | Run the Browse Catalogs web check (8.33) | yes | yes | 7.in | `yes` |
| `STORE_OWNER` | Owner of the store Account, Place and territory-link records | default offered (field rep) | field rep | 5.in | The field rep, `<FIELD_REP_USER>` (`accepted recommendation`; not asked separately). Used at 5.6 |
| `NOTIFY_ADMIN_USER` | Named admin user that the background notification steps of the unlock flows run as (`runAsUser=true`, assignee type `User`) | default applied (`<ADMIN_USER>`; not asked) | — | 8.in | `<ADMIN_USER>` (already an active System Administrator), recorded as `accepted recommendation`; another active System Administrator only if the customer names one. If this user is deactivated the approval notifications stop: re-run 8.21a with an active admin. Substituted into the deploy copy of `LSC_Quote_Lock_and_Unlock_Approval_Process.flow-meta.xml` (extracted from Appendix B) at 8.21a, never into the copy embedded in this runbook |
| `SMOKE_AS_REP` | The person runs the web checks (8.9b, 8.16a, 8.30–8.33a, 9.9d, 9.23–9.25, 10.7a) logged in as the rep (Login-As) rather than as the admin | default offered (`yes`) | yes | 8.30a | `yes` if "Administrators Can Log in as Any User" is already on or the admin consents (C12, 8.30a); otherwise `no`: run 6.5b, then the 8.30 smoke as the admin with rep-only checks deferred to the iPad (`PASSED`, substitution listed; Rep-session rule). Never blocks |
| `VISIT_CHANNEL_VALUES` | Visit channels (Visit `Channel`/type values) the rep's visits use, for the from-visit and routing checks (9.in) | default offered | — | 9.in | `In-Person, Remote, Phone, Email, WhatsApp, WeChat, SMS` (offered default; the Visit Channel picklist has no values on a fresh org) |
| `DISCLAIMER_ACCOUNT_SUBSTITUTION` | Substitute account fields into the disclaimer (8.29) | yes | no | 8.in | `no` |
| `QUOTE_FROM_VISIT_SCOPE` | Visit record types that show Create Quote From Visit (8.34): `all` or `Store_Check` | default offered (`Store_Check`) | Store_Check | 8.in | `Store_Check` (offered default) |
| `REP_VISIT_RECORD_TYPES` / `REP_VISIT_DEFAULT_RT` | Visit record types visible to the rep, and the default one (9.8) | default offered (all three; default `Store_Check`) | In_Person, Remote, Store_Check | 9.in | All three, default `Store_Check` (offered default) |
| `ADMIN_VISIT_ACCESS` | The admin can create Visits on web: the three Visit record types visible on the System Administrator profile, `Store_Check` the default (9.8b), and an admin metadata cache for web In-Person / Remote (10.1c) | default offered | yes | 9.in | `yes` on a `test` org (admins often try Visits → New themselves); `no` on a `customer` org (the admin profile is left as it is; admins check Visits through Login-As the rep) |
| `SECONDARY_DISPLAY_TASK_TYPE` | `TaskType` value for the Secondary Display task (9.13) | default offered (`PlanogramCheck`) | PlanogramCheck | 9.in | `PlanogramCheck` (offered default) |
| `RESTOCK_DATE_TARGET` | Set a target for Last Restock Date (9.14, 9.19) | yes | no | 9.in | `no` |
| `KPI_TYPE_MAP` | `KpiType` value per numeric indicator that has a target, beyond Stock Count and Facing (9.19); empty means no target for those | yes (may be empty) | — | 9.in | Empty |
| `QUOTE_ENTRY_PATH` | How the rep starts the Act 13 quote: `from_visit` or `plain_new` (13.2) | default applied (not asked) | from_visit | 13.in | `from_visit` (`accepted recommendation`; not asked): on the Act 12 Visit, Quoted Order tab → **New** opens the quote form with Visit and Account for Quote pre-filled (needs the `Quotes` related list on the Store Check Visit layout, 9.5). `plain_new` (Quotes tab, Visit set by hand) is only the 13.2 fallback when the Quoted Order tab is missing. The Visit link is identical either way. The 13.2 render check runs in both cases, is non-blocking and records the result |
| `TEST_UNLOCK_ROUTE` | Run the gated unlock test (14.13–14.15); the unlock branch is built either way | default offered (`yes`) | yes | 13.in (used in Act 14) | `yes` (offered default) |
| `SECURITY_CONTACT` | The user to save as the org Security Contact in 1.9 (through Playwright). Asked only if Company Information has the field at this release; otherwise recorded as `not applicable` (never left `PENDING`). Never blocking: at API 68.0 the field does not exist, so expect `not applicable` | only if the field exists | — | 1.9 | `<ADMIN_USER>`; if the field is absent, `not applicable` *(default pending approval)* |

**Derived placeholders.** These `<PLACEHOLDER>` tokens are not input keys and are never asked. Each is derived at the step shown, recorded in the manifest (`capturedIds` for Ids) and then reused unchanged.

| Placeholder | How it is derived | First used at |
| :-- | :-- | :-- |
| `<WORK_DIR>` | The local folder the customer chooses for all run files (`<WORK_DIR>/runs/`) | 0.1 |
| `<run>` | The current run folder, `<WORK_DIR>/runs/run-NN/` | 0.1 |
| `<API_VER>` | Highest version returned by `GET /services/data/`, agreeing with `sf org display`; pinned. Written as the bare number (for example `68.0`) in XML `<version>`, `sourceApiVersion`, `<apiVersion>` and comparisons; REST paths add the `v` (`/services/data/v<API_VER>/…`) | 0.2 |
| `<CORP_CCY_DISCOVERED>` | Multi-currency: `CurrencyType` where `IsCorporate = true` (0.7). Single-currency: `UserInfo.getDefaultCurrency()` read with anonymous Apex (0.3 step detail) | 0.3, 0.7 |
| `<MY_DOMAIN_URL>` | The My Domain host taken from the Lightning URL in `<ORG_URL>` | 0.1a |
| `<PFX_LABEL>` | `<PFX>` without its trailing underscore (`Acme_` → `Acme`), labels only | 1.6 |
| `<ID:NAME>` (for example `<ID:ADMIN_USER>`, `<ID:FIELD_REP_USER>`, `<ID:FIELD_REP_PROFILE>`, `<ID:FIELD_REP_PS>`, `<ID:MANAGER_USER>`, `<ID:TERRITORY>`, `<ID:STORE_n>`, `<ID:STT>`) | The Id of the named record, queried by its natural key (username, API name, developer name, `sourceKey`) at the step that first needs it, and stored in `capturedIds`. Lower-case forms (`<ID:product-id>`, `<ID:psm-id>`, `<ID:pricebook-id>`, `<ID:catalog-id>`) are Ids returned by the Act 7 create or query of that record | Each step that first uses it |
| `<ID:PSL:x>` / `<ID:PS:x>` | `SELECT Id FROM PermissionSetLicense WHERE DeveloperName='x'` / `SELECT Id FROM PermissionSet WHERE Name='x'`, with `x` the name given in the step | Each step that first uses it |
| `<N>`, `<Act>`, `<PreferenceName>`, `<X_LABEL>` | Fill-in tokens of a generic phrase in the step text: `<N>` and `<Act>` are the step or Act number, `<PreferenceName>` the org preference named in that step, `<X_LABEL>` the label named in that step | Where written |
| `<STORE_1>` | The first entry of `STORE_n` | 5.6 |
| `<TERRITORY_TYPE_LABEL>`, `<TERRITORY_MODEL_LABEL>`, `<TERRITORY_LABEL>` | The label the customer gave at 5.in; if none, the `TERRITORY_TYPE` / `TERRITORY_MODEL` / `TERRITORY` value with underscores replaced by spaces. Shown at the Act 5 checkpoint | 5.1 |
| `<CATALOG.code>` and other `<INPUT.field>` forms (`<CATALOG.name>`, `<PRODUCT_n.name>`, `<PRODUCT_n.code>`, `<PRODUCT_n.UoM>`, `<PRICEBOOK_n.currency>`, `<STORE_n.currency>`) | A named field of the structured input (`CATALOG`, `PRODUCT_n`, `PRICEBOOK_n`, `STORE_n`) as frozen at 0.12 or answered at its inputs step | 7.1 and later |
| `<LIST_PRICE>` | The list price for that product in `PRICEBOOK_n.listPrices` (`PRICEBOOK_n`'s price for the product being priced) | 7.6 |
| `<TIER_LOWER>`, `<TIER_UPPER>`, `<TIER_PCT>` | The lower bound, upper bound and discount % of one band of the `PRICING_TIERS` entry | 7.10 |
| `<TIER_EFFECTIVE_FROM>` / `<TIER_EFFECTIVE_TO>` | ISO 8601 date-times. From: on or before the run date, default `<current year>-01-01T00:00:00.000Z`. To: default `2099-12-31T00:00:00.000Z`. Both set at 7.10 and recorded in the manifest | 7.10, 7.10a |
| `<START_DATE_ISO>` | Current UTC time at the moment of the call, ISO-8601 (`YYYY-MM-DDThh:mm:ss.000Z`), recorded in the manifest | 6.6 |
| `<PROC_START_ISO>` | Same rule as `<START_DATE_ISO>`, for the pricing-procedure version | 7.13 |
| `<LINE_KEY_n>` (`<LINE_KEY_1>` …) | Any unique 18-character key with the `QuoteLineItem` prefix `0QL` (for example `0QL`, zeros, a 3-digit line number, `GAA`); it need not exist | 7.14 |
| `<TEST_QTY>` | The quantities of the simulation test cases: each band's lower bound of every `PRICING_TIERS` entry, plus the cases listed in 7.14 | 7.14 |
| `<FLOOR_VALUE>` | The floor from `PRICE_FLOOR` (step 14 of the procedure); absent when `PRICE_FLOOR = none` | 7.13, 7.14 |
| `<MANAGER_PROFILE>` | `SELECT Profile.Name FROM User WHERE Id = '<ID:MANAGER_USER>'`; read from the user record, not asked | 8.9b |
| `<QUOTE_CHILD_RELATIONSHIP>` | The Quote child relationship name returned by a describe of Visit (link field `VisitId`), expected `Visit` | 9.9 |
| `<TARGET_VALUE>` | The target for that product and indicator from `TARGETS` (typed by the indicator's data type) | 9.19 |
| `<SOBJECT_API_NAME>` | The API name of the object the DbSchema syncs, fixed by each DbSchema in the step | 10.1 |
| `<WHERE_SOQL>` | The DbSchema sync filter: empty, or the territory filter from the 10.1 `WhereSoql` table | 10.1 |

**Currency note.** Multi-Currency is irreversible, and the corporate currency is the base for every conversion rate.
- **Default case:** `CORP_CCY` equals the org's current corporate currency read at 0.3 and `ACTIVE_CCYS` is empty. **Non-default case:** `CORP_CCY` differs from that currency, or `ACTIVE_CCYS` is not empty. The agent runs the non-default case only after a live ⏸ STOP at 1.10, before 1.11 runs, that shows the planned currency list and rates, and then runs these checks; all four must pass or the step ends `BLOCKED` with the last observed state: (1) `UserInfo.isMultiCurrencyOrganization()` is `true`; (2) `CurrencyType` returns exactly the `CORP_CCY` row (`IsCorporate`) and one row per `ACTIVE_CCYS` code, all `IsActive`, with the stated rates; (3) the corporate row equals `CORP_CCY` before any price book or price exists (the 1.11 `Currency.settings` deploy sets it with `corporateCurrency`, API v68.0+; if the query still differs, change it with 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`) — Setup → Company Information → Currency Setup → Change Corporate Currency); (4) every record created later carries an explicit `CurrencyIsoCode` (next bullet).
- Every currency-bearing record this thread creates gets an explicit `CurrencyIsoCode`: products, price book entries, quotes, sales transaction types and pricing records.
- **Known defect — rep currency must equal store currency.** A Quote has no Opportunity, so it takes its currency from the rep's personal currency (`User.DefaultCurrencyIsoCode`) rather than from the store Account. When the two differ, products and price book entries are not found, on web and iPad. So for every store a rep serves, `STORE_n.currency` = the rep's `DefaultCurrencyIsoCode` = the currency of the price book used. Act 4 (4.8) sets the rep's currency; Act 5 (5.8) checks each store; gate G12 tests it.
- If the customer's stores span more than one currency, one rep cannot quote all of them in this release: ⏸ STOP at Act 0 and report.
- Reps and stores in a non-default currency follow the same rules; the default case is the only one exercised end to end, which is why the non-default case stops at 1.10.

## Start state

| System area | Start state | Checked in |
| :-- | :-- | :-- |
| Org | New org with no `lsc4ce` package (Acts 1–2 install it), or `lsc4ce` already installed at any version (detected at 0.9; 2.2 and 2.3 `reused`; every other step still runs its detect-first check and applies only what is missing) | Act 0 |
| Edition / permissions | `IndustriesLSOCE` org permission available | Act 0 |
| Licences | The 10 permission set licences that 4.4 assigns are provisioned, each with at least one free seat for `<FIELD_REP_USER>`. The Salesforce account team provisions them; no Setup toggle, Turn On or package install creates them. Setup labels: `CorePricingRunTime` "Salesforce Pricing Run Time", `DocumentBuilderUserPsl` "Document Builder User", `ProductDiscoveryUserPsl` "Product Discovery User", `RevenueLifecycleManagementUserPsl` "Revenue Cloud User". The other six cover Life Sciences Commercial, Health Cloud, Visit, Action Plans, Context Service and Product Catalog: `IndustriesLSC4CEPsl`, `HealthCloudStarter`, `IndustriesVisitPsl`, `ActionPlansPsl`, `ContextServiceRuntimePsl`, `ProductCatalogManagementViewerPsl` (read their labels in Setup → Company Information → Permission Set Licenses) | Act 0 (0.9b) |
| Admin | System Administrator, logged in with `sf org login web` | Act 0 |
| Address | State and Country/Territory picklists off (Account describe has no `BillingCountryCode`) | Act 0 |
| Accounts | No Business Account record type; Person Accounts off (Account describe has no `IsPersonAccount`) | Act 0 |
| Currency | Single currency; Multi-Currency off (`CurrencyType` not queryable); Security Contact empty, or the field absent at this release | Act 0 |
| Territory | Enterprise Territory Management off | Act 0 |
| Industries / Revenue Cloud | Store Check, Quotes, Core CPQ (built into the platform; not the Salesforce CPQ managed package), pricing, Document Builder, Account Plans off | Act 0 |
| Product Configurator | `enableProductConfigurator` may be `false`; it cannot be read by API and has no Setup page. It matters only if the 7.18 Save As fails with FP-7.16 | Act 7 (7.17c, conditional) |
| Mobile | No mobile metadata records, no DbSchemas | Act 0 |
| iPad | App build available; not logged in | Act 11 |

## Dependency order

The Acts are ordered so that no step runs before its prerequisite. The chain below summarises the Act dependencies. The step-level table is in [Appendix A — Step dependencies](#appendix-a--step-dependencies).

**Order constraints** (details in each Act's steps)
- Act 1 sets every installer prerequisite before the single install in Act 2; the admin permission ladder comes first.
- Pricing: the Quote context mapping must be the sole default before the procedure is attached; the procedure embeds the tier schedule IDs, so it is authored in Act 7.
- Acts 8-9 server configuration must all exist before Act 10 (the mobile cache is a snapshot). Act 15 needs a submitted quote, so it runs after Act 14.

## Act 0 — Intake & discovery

**Purpose.** Ask the six questions Act 1 depends on (seven keys) — each with a recommended answer and no silent defaults — and run a read-only discovery pass against the target org so Act 1's irreversible steps are planned against real facts. **Estimated duration:** 15 agent minutes + 5–10 human minutes (six questions at 0.11). **Depends on:** nothing — this is the first Act.

### Story

Read-only queries record the org's starting shape (API version, edition/type, record types, currencies, Territory Management, installed packages, every Settings field this thread later touches); later postconditions are measured against it and a resumed run uses it to know what it can skip. Three rules: **no ceremony** (bundled deploys, rollback-on-error, no per-command approvals); **resume** (revalidate only the last incomplete step and its direct prerequisites); **ambiguity** (reconcile a contradicting read-back with a fresh read; never repeat the action).

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Here's our org." 🤖 Agent: asks six questions after looking at the org, each with a recommendation and source; everything else at the start of the Act that needs it *(P1, P2)*. | Act 0 questions (0.11), `sf org display --json`, `Organization` query; per-Act inputs steps | The run pauses at each Act with unanswered inputs, even with `AUTO_CONTINUE = yes`. |
| 🧑‍💼 Admin: "Go ahead." 🤖 Agent: this Act is read-only; before it ends it shows every irreversible change (C1–C14), its meaning and precondition *(P4, P5)*. | Edition/feature discovery, Settings baseline retrieve, RecordType/CurrencyType/Territory2Settings/InstalledSubscriberPackage queries | The org permission that Document Management needs (K9) has no discovery query: carried forward as a documented fact. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 0.1 | Create or select the run folder, then collect runtime inputs | n/a | Apply the State rules: start `<WORK_DIR>/runs/run-NN/` (with `artifacts/`), or ⏸ STOP to choose resume if the latest run is unfinished. Create `run-learnings.jsonl`, `gap-journal.md` and `org-changes.md` (headers = the Gap journal / Org changes columns) and write the manifest skeleton (step detail) with `resumePointer` `0.1`. Copy `runs/inputs/run-inputs.json` (if present) to `run-inputs.frozen.json` (untouched copy: `artifacts/run-inputs.as-copied.json`) and validate every pre-filled key against the [Runtime input schema](#runtime-input-schema); missing keys and values the schema treats as `PENDING` (including template sentinels) become `PENDING`. No questions here (Act 0 questions: 0.11; the rest: each Act's inputs step); the only earlier question is the org alias at 0.1a, and only when no matching `sf` login exists | Run folder has the manifest, learnings log, Gap journal and `org-changes.md`; the frozen copy has every key filled or `PENDING`; invalid pre-filled keys are reported | On resume, the frozen copy already has the answers → reuse without re-asking; else ask once | — |
| 0.1a | Log in to the target org and confirm the alias | n/a | If `ORG_URL` is `PENDING`, ask once: "Which org? Give its Lightning or My Domain URL and a short alias." Then `sf org list --json`: if an entry's instance URL matches `<ORG_URL>`, reuse its alias as `<ORG_ALIAS>`. Otherwise run `sf org login web --instance-url <MY_DOMAIN_URL> --alias <ORG_ALIAS>`; 👤 HUMAN completes the browser login. Tell the human before launching the command: the login window times out after about 2 minutes ("The authentication session timed out"). If it times out, have the human run the same command themselves when ready; do not loop it. Record `<ORG_ALIAS>` in the manifest (`pinned.orgAlias`) | `sf org display --target-org <ORG_ALIAS> --json` returns the expected instance URL; the alias is recorded | Matching alias already logged in → `reused`, no login | — |
| 0.2 | Discover API version | n/a | `sf org display --target-org <ORG_ALIAS> --json` (`result.apiVersion`); cross-checked against `GET /services/data/` (take the highest `version` in the returned array), run as `sf api request rest /services/data/ --target-org <ORG_ALIAS>`. Steps 0.2–0.10 are independent and read-only: run them concurrently, and start the 0.11 probe at the same time | `<API_VER>` set and both sources agree | Read-only — safe to re-run any time | — |
| 0.3 | Discover org edition/type and corporate currency | `Organization`; `UserInfo` (anonymous Apex) | `sf data query --query "SELECT Name, OrganizationType, IsSandbox, InstanceName, LanguageLocaleKey, Street, City, State, PostalCode, Country FROM Organization" --json`. `Organization` has no currency column at API 68.0 (`No such column 'DefaultCurrencyIsoCode' on entity 'Organization'`), so read the currency with read-only anonymous Apex (step detail) | Edition/type recorded in manifest; `<CORP_CCY_DISCOVERED>` (`UserInfo.getDefaultCurrency()`) and `isMultiCurrencyOrganization` recorded | Read-only | — |
| 0.4 | Record the Document Management platform constraint | `OrgPermissions.IndustriesLSOCE` | No supported API/SOQL exposes this permission; carry the documented constraint forward, do not probe. **`KNOWN_LIMITATION` (K9):** Document Management entities (`LifeScienceDocument` and related) are expected not to materialize; seeing that at 1.2 is the documented outcome, not a failure | Constraint recorded in manifest, cross-referenced to Act 1 step 1.2 and the Gap journal | Documentation only, not a live check | FP-1.3 |
| 0.5 | Retrieve existing Settings baseline | `Settings` (members: `Account`, `AccountPlan`, `Address`, `Chatter`, `Currency`, `Industries`, `IndustriesContext`, `IndustriesPricing`, `Language`, `Privacy`, `Quote`, `RevenueManagement`, `Survey`, `Territory2`) | `sf project retrieve start --manifest package.xml --target-org <ORG_ALIAS> --json` from `<run>/artifacts/baseline/` (step detail). If a member is reported unknown or not found (seen at API 68.0: `Settings type: 'IndustriesPricing' is unknown`, `Settings type: 'RevenueManagement' is unknown`), record that member's baseline as `unavailable (<error text>)` and continue; for `AccountPlan` use the 0.10 `AccountPlanEnabled` preference as its baseline. The retrieve still succeeds for the remaining members | Baseline files saved locally; every relevant field's starting value recorded, including `Currency.enableMultiCurrency`, `isMultiCurrencyActivationAllowed` and `AccountPlan.enableAccountPlan`. `Address.settings` has no picklist flag: the picklist baseline is the 0.6 Account describe | Re-retrieve any time (read-only, overwrites the baseline snapshot) | — |
| 0.6 | Query Account record types and read the Account describe | `RecordType`; `Account` describe | `sf data query --query "SELECT Id, DeveloperName, SobjectType, IsActive FROM RecordType WHERE SobjectType='Account'" --json`, then `sf api request rest /services/data/v<API_VER>/sobjects/Account/describe --target-org <ORG_ALIAS>`; cache the describe in the manifest `describes` | Row count/names recorded (expect 0 on a blank org). Describe signals recorded: `BillingCountryCode` present? (absent = State/Country picklists off); `IsPersonAccount` present? (absent = Person Accounts off). `Organization` has no `IsPersonAccountEnabled` or `IsMultiCurrencyOrganization` field at API 68.0 | Read-only | — |
| 0.7 | Query currency baseline | `CurrencyType` | `sf data query --query "SELECT IsoCode, IsCorporate, IsActive, ConversionRate, DecimalPlaces FROM CurrencyType" --json` | On a single-currency org the query fails with `sObject type 'CurrencyType' is not supported`: expected on a blank org — record `currencyBaseline = []`, reason `single-currency org`, `multiCurrency = false` (confirm with `isMultiCurrencyOrganization` from 0.3). If the query succeeds, record all rows (one on a new org; an org with `lsc4ce` already installed may have several; all are baseline, none is changed by this thread) | Read-only | — |
| 0.8 | Query territory baseline | `Territory2Settings` | Read `Territory2.settings` from the 0.5 retrieve (no separate retrieve) | `enableTerritoryManagement2` baseline recorded (expect `false`) | Read-only | — |
| 0.9 | Query installed packages | `InstalledSubscriberPackage` | `sf data query --query "SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber, SubscriberPackageVersionId FROM InstalledSubscriberPackage" --use-tooling-api --json`; filter `NamespacePrefix = 'lsc4ce'` client-side (a `WHERE` on it is rejected) | 0 `lsc4ce` rows → `PKG_STATE = not_installed` (Act 2 installs). Exactly 1 → `PKG_STATE = installed`: record its `SubscriberPackageVersionId` and major.minor.patch.build as `pinned.pkgVersionId` (source `detected`) and a `decisions` row; no version comparison, no stop. More than 1 → ⏸ STOP in the P5 format | Read-only | — |
| 0.9a | Inventory existing configuration | `PermissionSet`, `Territory2Model`, `Pricebook2`, `Quote`, `LifeSciMobileMetadataRecord`, `LifeSciConfigRecord`, `LifeSciConfigAssignment`, `FlowDefinition` | Data API: `SELECT Name FROM PermissionSet WHERE Name LIKE '%\_Business\_Account\_RT\_Access' OR Name LIKE '%\_Mobile\_Metadata\_Admin' OR Name LIKE '%\_STT\_Procedure\_Link'`; `SELECT DeveloperName, State FROM Territory2Model`; `SELECT Name, IsStandard, IsActive FROM Pricebook2`; `SELECT Status, COUNT(Id) FROM Quote GROUP BY Status`; `SELECT Status, COUNT(Id) FROM LifeSciMobileMetadataRecord GROUP BY Status` (Data API only). Tooling: `SELECT DeveloperName, MasterLabel, IsOrgLevel, IsActive FROM LifeSciConfigRecord`; `SELECT LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment`; `SELECT DeveloperName FROM LifeSciConfigCategory`; `SELECT DeveloperName, ActiveVersionId FROM FlowDefinition WHERE DeveloperName LIKE 'LSC_Quote%'` | Results saved in `discovery.existingConfig`; nothing changed. Run the Tooling and `LifeSci…` queries only when `PKG_STATE = installed` (else `[]`, reason `package not installed`); a query failing with `sObject type '…' is not supported` or `INVALID_TYPE` is recorded `[]` with that reason, never a failure (expected on a new org); the Data API `Quote` query fails the same way on an installed org whose Quote settings are still off (`enableQuote=false`): record `[]` with that reason | Read-only | — |
| 0.9b | Licence gate (before any change) | `PermissionSetLicense` | `sf data query --query "SELECT DeveloperName, MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE DeveloperName IN (<the 10 names in Step details 4.4>)" --json` | 10 rows, each with `TotalLicenses − UsedLicenses ≥ 1`. Any name missing or without a free seat → ⏸ STOP before Act 1: list the missing names with their Setup labels (Start state, Licences) and route the customer to their Salesforce account team. Record the result in `discovery`. The permission sets `CorePricingRunTimeUser`, `DocumentBuilderUser` and `ProductDiscoveryUser` arrive with their licences; `RevLifecycleManagementQuotePricesTaxes` and `RevLifecycleManagementCalculatePricesApi` appear only after the Act 6 Turn On | Read-only; re-run after provisioning | — |
| 0.10 | Read org preference baseline | `OrgPreferences` (`InventoryCountEnabled`, `InventoryBatchManagement`, `PrdInventoryOperationsPref`, `CarePlansPreference`, `AccountPlanEnabled`) | `GET /services/data/v<API_VER>/setup/org/preferences/<PreferenceName>` once per name (`sf api request rest`); `<PreferenceName>` is a name from this list | Baseline `isPreferenceEnabled` recorded for each (expect `false` on a blank org) | Read-only | — |
| 0.11 | Ask the Act 0 questions, including irreversible-action consent | n/a | 👤 HUMAN — ask only the keys whose "Asked at" is 0.11 and that are still missing or `PENDING`, each with its recommended answer and source: (1) `PFX` (if 0.9a found thread permission sets, recommend their shared prefix; a different prefix only after showing the existing names); (2) `CORP_CCY` (recommended from the 0.3 Apex result) and the one currency all stores quote in; (3) `ACTIVE_CCYS` (additional currencies only; empty if none); (4) `IRREVERSIBLE_CONSENT` — show the [consent list](#irreversible-action-consent-list) (C1–C14) with each item's consequence and precondition. C1–C4 show this org's Act 0 baseline (C1 from 0.5; C2, C3 from 0.6; C4 from 0.3, 0.7); C5–C11 and C14 show "checked at the step"; an item already in effect at the baseline (C1–C5, C7, C14a–C14c) is shown as "already in effect, not applicable" and needs no answer (C14 lists every access grant and hard-to-reverse setup change by step). C12 (just in time at 8.30a, never blocks) is not asked here. C13 (the 9.20a sharing change) is asked here only once (6) gives `ORG_KIND = test`: `yes` or `ask`, recommended `yes` (a test org; the 9.20a rollback copies undo it); when `ORG_KIND = customer` it is not asked here and stays a live stop at 9.20a. Accept one answer for C1–C11 and C14, or `yes`/`ask` per item; (5) `PLAYWRIGHT_AVAILABLE` and `AUTO_CONTINUE`: recommend `PLAYWRIGHT_AVAILABLE = yes` only if the probe in *Tools and browser automation* succeeds (Node present; Playwright installs; system Chrome launches headless; `sf org open --path /lightning/setup/AddressCleanerOverview/home --url-only` loads Setup; an element inside the Setup iframe is read). (6) `ORG_KIND` = `customer` or `test`: no recommendation and no default; never assume it. If the stores would quote in more than one currency, ⏸ STOP and report (Currency note). Write the answers into the frozen inputs and the manifest `consents` block as `answered` or `accepted recommendation` | Every 0.11 key is filled; every item C1–C11 and C14 (and C13 when `ORG_KIND = test`) has `yes`, `ask` or `not applicable (already in effect)`; `ORG_KIND` is `customer` or `test`; none is blank | On resume, keep recorded answers; the customer may change any item to `ask` before its step runs | — |
| 0.12 | Finalize the run manifest | n/a | Write the 0.2–0.10 (incl. 0.9a) discoveries into `discovery` and `describes`, confirm the 0.11 answers are in `capturedInputs` and `consents`, then set `resumePointer` to `1.in` | Manifest lists Act 0 as `IN_PROGRESS` (terminal at the checkpoint) and Acts 1–15 as `NOT_STARTED`; `resumePointer` = `1.in`; `inputsFile`, `orgAlias` and consents recorded | On resume, keep the existing manifest; never overwrite a run folder | — |
| 0.13 | Write Act 0 summary | n/a | Write `act-0-summary.md` | File exists, matches Checkpoint 0 report below | Overwrite on every run of this Act | — |

#### Step details

**0.1 Intake checklist — illustration only, never a default**

```
ILLUSTRATION ONLY — shows field shape; never reuse as a default.
<CORP_CCY> = EUR   <ACTIVE_CCYS> = []   <PFX> = Acme_
Example of STORE_n: {name: "Pharmacie de la Gare", street: "12 Rue de la République", city: "Lyon", postal: "69002", country: "FR"}
In Acts 12 to 15, `<STORE_n>` means the first store (n = 1) unless the customer names another; `<ID:store>` and `<ID:STORE_n>` are the same Id.
Every other key (ADMIN_USER, FIELD_REP_*, CATALOG, TARGETS, PRICING_TIERS, STT_NAME, IPAD_APP_BUILD, ...) = pending until its Act.
```
- Every `pending` field is tracked in the manifest. When a default is applied without an answer, record its source as `default applied`.
- `<API_VER>` is discovered at 0.2. `<PKG_VERSION_ID>`: detected at 0.9 when `lsc4ce` is installed, not asked; otherwise (starts with 04t, from the Salesforce install link or account team) supplied exactly by the admin before Act 2; no org-side route finds "the latest version".

**0.3 Corporate currency — read-only anonymous Apex**

```apex
System.debug('CORP_CCY=' + UserInfo.getDefaultCurrency() + ' MULTI=' + UserInfo.isMultiCurrencyOrganization());
```
- Save it under `<run>/artifacts/`, run `sf apex run --target-org <ORG_ALIAS> --file <file>` and read both values from the `USER_DEBUG` line. Nothing is written. The same pattern is the read-back in 1.10–1.11.

**0.5 Settings baseline retrieve — sfdx project scaffold and bundled package.xml**

- `<run>/artifacts/baseline/` holds the scaffold (*Tools and browser automation*, "Project scaffold") and this `package.xml`; run the retrieve from there.

```xml
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><!-- one <members> per Settings member listed in step 0.5 --><name>Settings</name></types>
    <version><API_VER></version>
</Package>
```

**0.1 / 0.12 Run manifest skeleton** (written at 0.1 with `resumePointer` `0.1`; finalized and advanced to `1.in` at 0.12)

```json
{
  "runId": "run-NN",
  "inputsFile": "runs/inputs/run-inputs.json (copied to run-inputs.frozen.json)",
  "capturedInputs": { "...": "every key from the Runtime input schema, value or \"PENDING\"" },
  "pinned": { "orgAlias": null, "apiVersion": null, "pkgVersionId": null, "pkgState": null, "pkgVersionSource": null, "ipadAppBuild": null },
  "describes": { "...": "each describe result a step relies on, recorded once" },
  "decisions": [ { "step": "<n.k>", "rule": "<input or query rule>", "outcome": "<value>" } ],
  "learningsLog": "run-learnings.jsonl",
  "orgChangesLog": "org-changes.md",
  "discovery": {
    "apiVersion": null, "orgEdition": null, "orgType": null,
    "settingsBaseline": null, "accountRecordTypes": [], "currencyBaseline": [],
    "territory2Settings": null, "installedPackages": [], "existingConfig": {}, "orgPreferenceBaseline": {}
  },
  "acts": [
    { "act": 0, "status": "IN_PROGRESS", "startedAt": null, "endedAt": null, "activeMinutes": null, "humanWaitMinutes": null, "steps": {} },
    { "act": 1, "status": "NOT_STARTED", "steps": {} }, "... through Act 15"
  ],
  "resumePointer": "0.1",
  "consents": { "C1": "yes | ask", "...": "one entry per item C1–C14; C1–C11 and C14 are written at 0.11, C12 at 8.30a, C13 at 0.11 on a `test` org, else at 9.20a (on a `customer` org always a live stop, never recorded as pre-consented)" },
  "capturedIds": {}
}
```
- `capturedIds` fills with `<ID:…>` values as the thread runs, never secrets or usernames. Any `<ID:x>` placeholder is resolved by a natural-key query at its first use.
- `decisions` gets one entry per branch taken.
- Per-Act timing (same four fields in every `acts[]` entry): set `startedAt` (`date -u +%Y-%m-%dT%H:%M:%SZ`) at the Act's first step and `endedAt` at its checkpoint. Read the clock before each stop that waits on the human and when the reply arrives; add the span to `humanWaitMinutes`. `activeMinutes` = (`endedAt` − `startedAt`) − `humanWaitMinutes`; the checkpoint reports both. Timestamps belong in the manifest only, not in the learnings log or `org-changes.md`.
- On resume: read `resumePointer`, revalidate that step and its direct prerequisites, continue.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| API version | `<API_VER>` resolved and pinned | `run-manifest.json` | Step 0.2 cross-check |
| Org baseline | Edition/type, Settings snapshot (readable members and substitutes), Account RTs, CurrencyType, Territory2Settings, installed packages, org-preference baseline captured | Baseline files + manifest | Steps 0.3–0.10, 0.9a |
| Document Management constraint | Carried forward as a known platform gate (`KNOWN_LIMITATION`, K9) | Manifest + the Gap journal | Step 0.4 |
| Runtime inputs | Every placeholder populated or explicitly `PENDING` | `run-manifest.json.capturedInputs` | Step 0.1 |
| Consents | Items C1–C11 and C14 answered `yes` or `ask`; C12 recorded at 8.30a; C13 at 0.11 on a `test` org, else live at 9.20a | `run-manifest.json.consents` | Step 0.11 |
| Org access | `<ORG_ALIAS>` logged in, instance confirmed | `run-manifest.json` (`pinned.orgAlias`) | Step 0.1a |
| Resume state | Manifest finalized at 0.12, resume pointer `1.in` | `run-manifest.json` | Steps 0.1, 0.12 |

### Checkpoint 0
Report: status (`PASSED` / `PASSED_WITH_NOTES` / `BLOCKED` / `FAILED` / `AWAITING_CUSTOMER_VALIDATION`) — changed (`run-manifest.json`, `act-0-summary.md`); reused (none); verified (0.2–0.10 read-backs; `PKG_STATE` and detected version; 0.9a inventory summary); consents (C1–C11 and C14, `yes` or `ask` each; C12 follows at 8.30a, C13 at 9.20a); open items (`PENDING` inputs by name); actual duration. Update the run manifest (`resumePointer` → `1.in`, Act 0 status → terminal). Then ask: **"Act 0 is complete. Ready to continue to Act 1: Pre-install foundation?"**

## Act 1 — Pre-install foundation

**Purpose.** Enable every org-level feature and setting the package install (Act 2) and later Acts require, before any package is on the org. On an org where 0.9 found `lsc4ce` already installed, every step still runs its detect-first check and applies only what is missing; a setting already in effect is `reused`. **Estimated duration:** 90 agent minutes + 5–10 human minutes (inputs and consents answered `ask`; 20 if `PLAYWRIGHT_AVAILABLE = no`). **Depends on:** Act 0 (API version, Settings baseline, placeholder values).

### Story

Steps 1.4, 1.8 and 1.9 have no proven API, so the agent drives them in the browser (a human follows the same click path only when `PLAYWRIGHT_AVAILABLE = no`). Where Company Information has a Security Contact field, the Multi-Currency checkbox silently fails to persist while it is empty, so 1.9 checks first. An org-active record type is not visible to any profile, so `Business_Account` gets a permission set at once; Person Accounts creates a second record type with the same trap (1.8a). The rest is bundled deploys with no human step.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🤖 Agent: four changes can't be undone or are hard to reverse (base package features, State/Country, Person Accounts, Multi-Currency); it re-checks each precondition and asks if you chose `ask` or anything differs (C1–C4) *(P4)*. | ⏸ consent STOP rows at 1.1, 1.3, 1.7, 1.10 | No supported undo path; reverting is a support engagement. |
| 🧑‍💼 Admin: "Enable the base features." 🤖 Agent: done; Document Management entities also need an org permission that a customer or an admin cannot turn on, so it notes that and moves on *(P5)*. | `Chatter.settings` + `Industries.settings` bundled deploy | The Life Sciences Cloud for Customer Engagement org permission (`IndustriesLSOCE`): no grant path (`KNOWN_LIMITATION`, K9, no stop). |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1.in | Ask this Act's inputs: `ADMIN_USER` (confirm; `SECURITY_CONTACT` is asked later, at 1.9, and only if the field exists) | n/a | 👤 HUMAN — ask each key still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema). Validate, then write to the frozen copy and manifest (`answered`, `accepted recommendation` or `default applied`) | Every key listed is filled; none `PENDING` | Filled keys are not re-asked; none missing → no stop | — |
| 1.0 | Assign admin PSL/PS ladder (runs first, before any setting) | `PermissionSetLicenseAssign` + `PermissionSetAssignment` (`IndustriesLSC4CEPsl` → `LifeSciencesCommercialAdmin` → `HealthCloudStarter` PSL → `HealthCloudStarter` PS) | Resolve the five `<ID:…>` values below into `capturedIds` (queries in step detail), then two Composite calls, never one: call 1 = the two `PermissionSetLicenseAssign` sub-requests (`allOrNone: true`), read both back; call 2 = the two `PermissionSetAssignment` sub-requests. Ids: `<ID:ADMIN_USER>`, `<ID:PSL:IndustriesLSC4CEPsl>`, `<ID:PSL:HealthCloudStarter>`, `<ID:PS:LifeSciencesCommercialAdmin>`, `<ID:PS:HealthCloudStarter>` | `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId=:adminUserId AND PermissionSet.Name IN ('LifeSciencesCommercialAdmin','HealthCloudStarter')` → 2 rows, plus a `PermissionSetLicenseAssign` row per PSL | Query first; any rung already assigned → drop it from its call, keep the rest | FP-4.4 |
| 1.1 | ⏸ STOP — before enabling base package/Industries features | n/a | If all four 1.2 fields already read `true` at the 0.5 baseline: C1 `not applicable (already in effect)`, no stop. Otherwise consent **C1**: if pre-consented and the precondition passes (the 1.2 fields still read as in the 0.5 baseline), record `pre-consented (C1)` and continue; otherwise 👤 HUMAN confirms live: Chatter + base Industries flags are org-wide and not self-service reversible | Consent (`pre-consented (C1)`, live "yes" or `not applicable (already in effect)`) recorded in manifest before 1.2 runs | n/a | — |
| 1.2 | Deploy Chatter + base Industries settings bundle | `Chatter.enableChatter`; `Industries.enableLifeSciencesCustomerEngagementBase`, `enableLSC4CEPackage`, `enableLSC4CEDocumentManagement` | `sf project deploy start --manifest package.xml --wait 30 --json` (one deploy, 2 Settings components, 4 fields; *Deploy files* below) | Re-retrieve `Chatter.settings`/`Industries.settings`; all 4 fields read back `true`. `LifeScienceDocument` still not describable is the expected outcome (REST describe returns `NOT_FOUND` / `The requested resource does not exist`): the step ends `PASSED_WITH_NOTES` with **`KNOWN_LIMITATION`** (K9; step detail), not a failure | Read current value first; already `true` → skip that field, else include in the deploy. On an org with `lsc4ce` installed, a rejected deploy or a field still `false` → ⏸ STOP in the P5 format with the field name; no second deploy | FP-1.3 |
| 1.3 | ⏸ STOP — before State/Country Picklists conversion | n/a | If the Account describe already has `BillingCountryCode` (0.6): C2 `not applicable (already in effect)`, 1.4 `reused`, no stop. Otherwise consent **C2**: if pre-consented and the precondition passes (Account describe has no `BillingCountryCode`, as in the 0.6 baseline; `Address.settings` has no picklist flag), record `pre-consented (C2)` and continue; otherwise 👤 HUMAN confirms live: hard to reverse (disabling is offered in Setup, but the code fields it creates stay in use by later Acts) and affects every Address field org-wide. Also count Account, Contact and Lead rows with a non-null address country or state and record the count (1.4 converts them) | Consent (`pre-consented (C2)`, live "yes" or `not applicable (already in effect)`) recorded before 1.4 runs | n/a | — |
| 1.4 | Convert to State and Country Picklists | n/a (Visualforce wizard, no Metadata/REST equivalent) | 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`) — open `sf org open --target-org <ORG_ALIAS> --path /lightning/setup/AddressCleanerOverview/home --url-only` (Setup → State and Country/Territory Picklists); the wizard runs in a Setup iframe (*Tools and browser automation*). Stages: Scan (asynchronous) → Convert identified data → Convert Countries → Convert States → Confirm and Clean Up → `Finish and Enable Picklists`. On the overview page the first two stages ("Scan for state and country/territory data." and "Convert identified data.") are links, not buttons: locate them by link text. Notes in step detail | Account describe includes `BillingCountryCode` and `BillingStateCode` (Contact: `MailingCountryCode`, `MailingStateCode`); the overview page reads enabled | Account describe first; `BillingCountryCode` already present → skip the wizard | — |
| 1.5 | Create the `Business_Account` record type | `RecordType` (`Account.Business_Account`) | `sf project deploy start --manifest package.xml --wait 30 --json` (its own deploy; 1.6 deploys separately) | `SELECT Id, DeveloperName, IsActive FROM RecordType WHERE SobjectType='Account' AND DeveloperName='Business_Account'` → 1 row, `IsActive=true` | Query first; exists → reuse Id, else deploy | — |
| 1.6 | Deploy + assign Business Account record-type visibility permission set | `PermissionSet` (`<PFX>Business_Account_RT_Access`, label `<PFX_LABEL> Business Account RT Access`) | `sf project deploy start --manifest package.xml --wait 30 --json`, then `PermissionSetAssignment` insert for `<ADMIN_USER>` | `SELECT Id FROM PermissionSetAssignment WHERE PermissionSetId=:psId AND AssigneeId=:adminUserId` → 1 row | Query the set by `Name` and the assignment first. Set absent → deploy. Set present → retrieve it and add only a missing `recordTypeVisibilities` entry to the retrieved file (Deploy safety), never the snippet. Assignment exists → skip insert, else create | FP-1.1 |
| 1.7 | ⏸ STOP — before Person Accounts enablement | n/a | If the Account describe already has `IsPersonAccount`: C3 `not applicable (already in effect)`, 1.8 `reused`, no stop (1.5, 1.6 and 1.8a still run). Otherwise consent **C3**: if pre-consented and the precondition passes (1.5–1.6 done; Account describe has no `IsPersonAccount`, because `Organization.IsPersonAccountEnabled` does not exist at API 68.0), record `pre-consented (C3)` and continue; otherwise 👤 HUMAN confirms live: org-wide, cannot be disabled | Consent (`pre-consented (C3)`, live "yes" or `not applicable (already in effect)`) recorded before 1.8 runs | n/a | — |
| 1.8 | Enable Person Accounts | n/a (Setup page with setup cards, acknowledgement dialog and confirm dialog; no supported API) | 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`) — `/lightning/setup/PersonAccountSettings/home` (Setup → Feature Settings → Sales → Accounts → Person Accounts; the older `/lightning/setup/PersonAccounts/home` returns "Page not found"). Click `View Org Impacts` → tick the acknowledgement checkbox (click its label, not the input) → `Continue` → `Check Readiness` → `Enable Person Accounts` → confirm dialog `Enable`. Cards: step detail | Account describe lists `IsPersonAccount` and `PersonContactId` (the `PersonAccount` record type is created with it) | Account describe first; `IsPersonAccount` already present → skip | — |
| 1.8a | Make the `PersonAccount` record type visible to the admin | `PermissionSet` (`<PFX>Business_Account_RT_Access`, now with two `recordTypeVisibilities`) | Retrieve `<PFX>Business_Account_RT_Access` (`.pre`), add a second `recordTypeVisibilities` entry for `PersonAccount.PersonAccount` (`visible=true`; already assigned to `<ADMIN_USER>`). Do not change default record types | Account describe: the `PersonAccount` record type info reads `available=true` for the admin (`false` right after 1.8). If still `false`, re-describe once after 60 s; then ⏸ STOP in the P5 format | Check the permission set file, not only the admin describe (the admin profile may already grant the type): skip only when `<PFX>Business_Account_RT_Access` already contains the `PersonAccount.PersonAccount` entry (the rep gets this set in Act 4 and needs both types; 5.5 checks the file); else add the entry to the retrieved set (Deploy safety), not the 1.6 snippet | FP-1.1, FP-1.5 |
| 1.9 | Set org Security Contact (only if the field exists) | `Organization.securitycontact` (Company Information UI field, where present) | 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`). Read-only first: Setup → Company Information → Edit, look for a Security Contact field. **Absent** (as at API 68.0): close Edit without saving, record `securityContactField = absent` and `SECURITY_CONTACT = not applicable` in `decisions`, go to 1.10 — not a stop. **Field present**: ask `SECURITY_CONTACT` now (recommended `<ADMIN_USER>`), set it, Save (separate save, before 1.11) | Absent: the decision is recorded. Present: the re-opened Company Information page shows the saved contact. Use the UI read-back only: the Connect API endpoint reports writable on `GET` but `PATCH` returns resource-not-found | Read UI value first; already set → skip; field absent → skip | FP-1.2 |
| 1.10 | ⏸ STOP — before Multi-Currency activation | n/a | If Apex `UserInfo.isMultiCurrencyOrganization()` is already `true` (0.3): C4 `not applicable (already in effect)`, 1.11 `reused`, no stop; the non-default rule below still applies. Otherwise consent **C4**: if pre-consented and the precondition passes (Multi-Currency still off: Apex `UserInfo.isMultiCurrencyOrganization()` is `false`; `CurrencyType` fails with `sObject type 'CurrencyType' is not supported` or returns only the 0.7 row; 1.9 done), record `pre-consented (C4)` and continue; otherwise 👤 HUMAN confirms live: once activated, Multi-Currency cannot be deactivated. **Non-default case** (`CORP_CCY` ≠ `CORP_CCY_DISCOVERED`, or `ACTIVE_CCYS` not empty; Currency note): always a live ⏸ STOP, even when C4 is pre-consented — show the planned currencies and rates before 1.11 | Consent (`pre-consented (C4)`, live "yes" or `not applicable (already in effect)`) recorded before 1.11 runs; non-default: the list and rates confirmed | n/a | — |
| 1.11 | Activate Multi-Currency | `CurrencySettings.enableMultiCurrency` (Metadata API); fallback `Organization.activateMultiCurrency` (Company Information UI checkbox "Activate Multiple Currencies") | If `<API_VER>` ≥ 68.0: one `sf project deploy start` of `Currency.settings` with `enableMultiCurrency=true`, `corporateCurrency=<CORP_CCY>` and a `currency` entry for `<CORP_CCY>` (rate 1.0) and each `<ACTIVE_CCYS>` code (this also covers 1.12). If the deploy is rejected, the postcondition still fails, or `<API_VER>` < 68.0: 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`) — Company Information → Edit → "Activate Multiple Currencies" (a yellow permanent-change warning is expected) → Save. If both routes are rejected, ⏸ STOP in the P5 format with the request to send Salesforce Support to allow activation. 1.9 must already have run | Apex `System.debug(UserInfo.isMultiCurrencyOrganization())` (pattern in 0.3) → `true`; `SELECT IsoCode, IsCorporate, IsActive FROM CurrencyType` returns the corporate row; a fresh reload of Company Information shows the Corporate Currency row. `Organization.IsMultiCurrencyOrganization` does not exist at API 68.0 | Apex check first; already `true` → skip, and never deploy `Currency.settings` (it updates currency rows by ISO code and could reset rates); missing codes go through 1.12 only | FP-1.2 |
| 1.12 | Add active currencies / set corporate currency | `CurrencyType` | Covered by the 1.11 deploy when `<API_VER>` ≥ 68.0; query first. For any code still missing: REST `POST /sobjects/CurrencyType` per `<ACTIVE_CCYS>` code (`IsoCode`, `ConversionRate`, `DecimalPlaces`, `IsActive=true`); if rejected, 🖱️ UI (same rule as 1.11) "Manage Currencies" → "New". If `<CORP_CCY>` ≠ org default: 🖱️ UI "Change Corporate Currency" (never edit the corporate row directly); if Multi-Currency was already active at 0.3, do not change the corporate currency or any existing rate: ⏸ STOP in the P5 format showing both values. **Default case** (Currency note): no action, the 1.11 read-back is the check. **Non-default case:** the stop was taken at 1.10; run the four checks in the Currency note now | `SELECT IsoCode, IsCorporate, IsActive FROM CurrencyType` matches `<CORP_CCY>`/`<ACTIVE_CCYS>` | Query first; row already present and active → skip | — |
| 1.13 | Enable Enterprise Territory Management | `Territory2Settings.enableTerritoryManagement2` | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first (Enable Sales Territory). `sf project deploy start` of `Territory2.settings` with `enableTerritoryManagement2=true` (the deploy enables it at API 68.0; its own deploy, separate from 1.18/1.18a). Only if the read-back stays `false`: 🖱️ UI (same rule as 1.4) — `/ui/setup/territory2/TerritoryManagement2EnablePage`, click by accessible role + exact name | Metadata retrieve `Territory2Settings` → `enableTerritoryManagement2=true` (never trust a deploy or click alone) | Read-back first; already `true` → skip the click | FP-1.4 |
| 1.14–1.17 | Enable the four org preferences in one scripted pass: `InventoryCountEnabled` (1.14), `InventoryBatchManagement` (1.15), `PrdInventoryOperationsPref` (1.16), `CarePlansPreference` (1.17) | `OrgPreference` per name | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first. `PATCH /services/data/v<API_VER>/setup/org/preferences/<PreferenceName>` `{"desiredState":true}` once per name (skeleton in step detail) | Each response `{"isPreferenceEnabled":true}` | `GET` first; already `true` → skip that `PATCH` | — |
| 1.18 | Enable Surveys | `Survey.enableSurvey` | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first (once on, Surveys cannot be turned off). `sf project deploy start --manifest package.xml --wait 30 --json`; same `package.xml` as 1.18a (two Settings components, one deploy), verify each | Metadata retrieve `Survey.settings` → enabled field `true` | Read-back first; already `true` → skip | — |
| 1.18a | Enable Account Plans | `AccountPlan.enableAccountPlan` (Settings component `AccountPlan`, element `AccountPlanSettings`) | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** (Account Plans) before the shared 1.18 deploy; deployed with 1.18 | Metadata retrieve `AccountPlan.settings` → `enableAccountPlan=true`; `AccountPlan` and `AccountPlanParticipant` describe succeed (both `NOT_FOUND` before); `AccountPlanEnabled` preference reads `true` | Read-back first (0.5 baseline, 0.10 preference); already `true` → skip | FP-2.7 |
| 1.19 | Write Act 1 summary | n/a | Write `act-1-summary.md` | File exists, matches Checkpoint 1 report | Overwrite on every run | — |

#### Step details

**Deploy files (every Act 1 deploy).** Run each deploy from a step folder under `<run>/artifacts/` with the sfdx scaffold (*Tools and browser automation*). Files sit under `force-app/main/default/`; `package.xml` names type and members at version `<API_VER>`.

| Steps | Files | `package.xml` types |
| :-- | :-- | :-- |
| 1.2 | `settings/Chatter.settings-meta.xml`, `settings/Industries.settings-meta.xml` | Settings: `Chatter`, `Industries` |
| 1.5 | `objects/Account/recordTypes/Business_Account.recordType-meta.xml` | RecordType: `Account.Business_Account` |
| 1.6, 1.8a | `permissionsets/<PFX>Business_Account_RT_Access.permissionset-meta.xml` | PermissionSet: `<PFX>Business_Account_RT_Access` |
| 1.11 | `settings/Currency.settings-meta.xml` | Settings: `Currency` |
| 1.13, 1.18, 1.18a | `settings/Territory2.settings-meta.xml`, `settings/Survey.settings-meta.xml`, `settings/AccountPlan.settings-meta.xml` | Settings: `Territory2`, `Survey`, `AccountPlan` |

**1.0 Admin PSL/PS ladder — ids and two Composite calls**

Resolve the ids (one row per name; fewer rows means the org lacks that licence or permission set → ⏸ STOP in the P5 format):

```sql
SELECT Id FROM User WHERE Username='<the username sf is logged in as>'                       -- <ID:ADMIN_USER>
SELECT Id, DeveloperName FROM PermissionSetLicense WHERE DeveloperName IN ('IndustriesLSC4CEPsl','HealthCloudStarter')  -- <ID:PSL:…>
SELECT Id, Name FROM PermissionSet WHERE Name IN ('LifeSciencesCommercialAdmin','HealthCloudStarter')                   -- <ID:PS:…>
```

`AssigneeId` takes a User Id, never a username. Send each body to `POST /services/data/v<API_VER>/composite`. A PSL and the permission set that depends on it in one atomic call fail with `DUPLICATE_VALUE` / `PROCESSING_HALTED` and roll back (→ FP-4.4, which also covers this step).

```json
// Call 1 — licences; read both rows back before call 2
{ "allOrNone": true, "compositeRequest": [
  { "method": "POST", "referenceId": "pslAssign1", "url": "/services/data/v<API_VER>/sobjects/PermissionSetLicenseAssign",
    "body": { "PermissionSetLicenseId": "<ID:PSL:IndustriesLSC4CEPsl>", "AssigneeId": "<ID:ADMIN_USER>" } },
  { "method": "POST", "referenceId": "pslAssign2", "url": "/services/data/v<API_VER>/sobjects/PermissionSetLicenseAssign",
    "body": { "PermissionSetLicenseId": "<ID:PSL:HealthCloudStarter>", "AssigneeId": "<ID:ADMIN_USER>" } } ] }
```
```json
// Call 2 — permission sets
{ "allOrNone": true, "compositeRequest": [
  { "method": "POST", "referenceId": "psAssign1", "url": "/services/data/v<API_VER>/sobjects/PermissionSetAssignment",
    "body": { "PermissionSetId": "<ID:PS:LifeSciencesCommercialAdmin>", "AssigneeId": "<ID:ADMIN_USER>" } },
  { "method": "POST", "referenceId": "psAssign2", "url": "/services/data/v<API_VER>/sobjects/PermissionSetAssignment",
    "body": { "PermissionSetId": "<ID:PS:HealthCloudStarter>", "AssigneeId": "<ID:ADMIN_USER>" } } ] }
```
- `LifeSciencesCommercialAdmin` supplies the `UserProductInventoryOperations` user permission the install checks later.

**1.2 Chatter + base Industries settings** (bundled into one deploy, `rollbackOnError=true` default)

```xml
<!-- Chatter.settings-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<ChatterSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableChatter>true</enableChatter>
</ChatterSettings>
```
```xml
<!-- Industries.settings-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<IndustriesSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableLifeSciencesCustomerEngagementBase>true</enableLifeSciencesCustomerEngagementBase>
    <enableLSC4CEPackage>true</enableLSC4CEPackage>
    <enableLSC4CEDocumentManagement>true</enableLSC4CEDocumentManagement>
</IndustriesSettings>
```
- `enableLSC4CEDocumentManagement` turns on the *setting*; the entities (`LifeScienceDocument` and related) also need the Life Sciences Cloud for Customer Engagement org permission (`IndustriesLSOCE`), which has no customer-facing grant path. **`KNOWN_LIMITATION` (K9):** `LifeScienceDocument` staying `INVALID_TYPE` is the documented outcome; record it, `PASSED_WITH_NOTES`, no stop. → FP-1.3

**1.4 State and Country Picklists wizard — page and button notes**
- **Scan is asynchronous.** Poll the scan page every 30 s to a 15-minute ceiling; done when the results list appears; at the ceiling, stop and report `BLOCKED` with the last observed state.
- **Existing addresses.** If 1.3 counted rows with address values, accept the wizard's automatic mappings (free-text names, abbreviations, variant spellings), show the mapping summary in the checkpoint report, and read back a few converted rows to confirm they carry codes. Values the scan leaves unmapped keep the wizard's default; list them in the report and record `PASSED_WITH_NOTES`.
- **Final page.** `Finish and Enable Picklists` is rendered twice. Click the first exact-name match, once. The overview may then show "Changelist may not be deployed while a deployment is already in progress" with Enable disabled: that is the normal background deployment, so never click again. Re-check the Account describe and overview every 60 s to a 10-minute ceiling, then stop and report `BLOCKED` with the last observed state.
- Target each button by accessible role and visible name. If none matches the stage's expected action, list the visible buttons and ⏸ STOP in the P5 format; never click by coordinates.

**1.5–1.6 Business Account record type and visibility permission set**

```xml
<!-- RecordType: Account.Business_Account -->
<?xml version="1.0" encoding="UTF-8"?>
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Business_Account</fullName>
    <active>true</active>
    <label>Business Account</label>
</RecordType>
```
```xml
<!-- PermissionSet: <PFX>Business_Account_RT_Access -->
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label><PFX_LABEL> Business Account RT Access</label>
    <recordTypeVisibilities>
        <recordType>Account.Business_Account</recordType>
        <visible>true</visible>
    </recordTypeVisibilities>
</PermissionSet>
```
- `<PFX_LABEL>` is `<PFX>` without its trailing underscore (`Acme_` → `Acme Business Account RT Access`); the API name keeps it.
- Without it the first use of `Business_Account` fails with `INVALID_CROSS_REFERENCE_KEY: Account.Business_Account is active but unavailable to the authenticated System Administrator profile.` → FP-1.1
- `<FIELD_REP_USER>` (Act 4) needs the same permission set before touching any Business Account record; note this in the manifest.

**1.8 Person Accounts page — cards, actions and 1.8a**
- Four setup cards: Org Impact Acknowledgement (`View Org Impacts`), Create Accounts Record Type, Set Read Permissions, Set Organization-Wide Sharing; the last three read `Complete` once 1.5–1.6 are done. Verify by the Account describe, not the click.
- **1.8a.** Enabling creates the `PersonAccount` record type, active but not available to the admin (`available=false`; Account's default stays Master) — the 1.6 pattern.
Add a second entry to the 1.6 file's `recordTypeVisibilities` and redeploy:
```xml
    <recordTypeVisibilities>
        <recordType>PersonAccount.PersonAccount</recordType>
        <visible>true</visible>
    </recordTypeVisibilities>
```
- Use `PersonAccount.PersonAccount`, not `Account.PersonAccount` (fails with `no RecordType named Account.PersonAccount found`, FP-1.5), although the `RecordType` SOQL shows `SobjectType = 'Account'`.
- `<FIELD_REP_USER>` gets the same permission set in Act 4, covering both record types. → FP-1.1

**1.9 / 1.11 Security Contact and Multi-Currency — two separate saves**

```
Stage 1 (1.9): Company Information → Edit. Field present: pick a user → Save, confirm the reload shows it.
               Field absent: close Edit without saving, record the decision.
Stage 2 (1.11): deploy Currency.settings (below); if UserInfo.isMultiCurrencyOrganization() is still false:
                Company Information → Edit → "Activate Multiple Currencies" → Save. With an empty Security Contact
                field this checkbox silently reverts to unchecked on reload.
```
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CurrencySettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableMultiCurrency>true</enableMultiCurrency>
    <corporateCurrency><CORP_CCY></corporateCurrency>
    <currency>
        <isoCode><CORP_CCY></isoCode>
        <conversionRate>1.0</conversionRate>
        <active>true</active>
    </currency>
    <!-- one more <currency> entry per <ACTIVE_CCYS> code: isoCode, conversionRate, active=true -->
</CurrencySettings>
```
- From API v68.0 the deploy turns Multi-Currency on; `corporateCurrency` is also listed as an active `currency`, and `currency` entries are inserted or updated by ISO code. The Apex check and the `CurrencyType` query are the proof, not the deploy result. → FP-1.2

**1.12 Active currencies / corporate currency — fallback UI path**
- Company Information → Manage Currencies → "Add Active Currency" per `<ACTIVE_CCYS>` entry; for a different `<CORP_CCY>`, the "Change Corporate Currency Setup Assistant". Order: 1.11 deploy, `POST`, this UI path, query.

**1.13 Enterprise Territory Management — deploy, then exact click target**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Territory2Settings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableTerritoryManagement2>true</enableTerritoryManagement2>
</Territory2Settings>
```
- Deploy first. Only if the retrieve still shows `false`, click, then retrieve again (a click is not proof). → FP-1.4
```
page.getByRole('button', { name: 'Enable Sales Territory', exact: true }).click()   // coordinates or label text silently no-op
```

**1.14–1.17 Org preference PATCH skeleton (repeat per name)**

```http
PATCH /services/data/v<API_VER>/setup/org/preferences/<PreferenceName>
Content-Type: application/json

{ "desiredState": true }          → response { "isPreferenceEnabled": true }
```
- A rejected PATCH or a response other than `true`: apply the Rejected setting change rule (Tools and browser automation, [How the agent runs this thread](#how-the-agent-runs-this-thread)); name the preference and send no further PATCH.
- Never use the Setup UI's "Enable All" button (fields cannot be reviewed before they flip).

**1.18 / 1.18a Surveys and Account Plans settings**

```xml
<!-- Survey.settings-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<SurveySettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableSurvey>true</enableSurvey>
</SurveySettings>
```
```xml
<!-- AccountPlan.settings-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<AccountPlanSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableAccountPlan>true</enableAccountPlan>
</AccountPlanSettings>
```
- Without Account Plans the install fails on the Account Plan layout (2.4). Deploy both files in one `package.xml`, then read both describes.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Base package features | Chatter + base Industries flags on | Settings retrieve | 1.2 |
| Address model | State/Country Picklists converted | Account describe (`BillingCountryCode`) | 1.4 |
| Account record types | `Business_Account` and `PersonAccount` visible to `<ADMIN_USER>` | `RecordType` + `PermissionSetAssignment` queries, Account describe | 1.5–1.6, 1.8a |
| Person Accounts | Enabled | Account describe (`IsPersonAccount`) | 1.8 |
| Currency | Security Contact set (or recorded absent); Multi-Currency active; `<CORP_CCY>`/`<ACTIVE_CCYS>` applied (non-default only after the 1.10 live stop) | Apex check + `CurrencyType` query | 1.9, 1.11, 1.12 |
| Territory management | ETM enabled | `Territory2Settings` retrieve | 1.13 |
| Org preferences | 4 preferences enabled | 4× `GET` | 1.14–1.17 |
| Surveys | Enabled | `Survey.settings` retrieve | 1.18 |
| Account Plans | Enabled; objects describable | retrieve + describe | 1.18a |
| Known gap | Document Management entities absent (`IndustriesLSOCE`); `KNOWN_LIMITATION` (K9) | Gap journal | 1.2 |

### Checkpoint 1
Report: status; changed (Settings deploys, record types + permission set, 4 preference PATCHes, `act-1-summary.md`); reused (fields already `true` at baseline); verified (every postcondition above); known limitations (Document Management, `KNOWN_LIMITATION`, K9); open items (non-default currency checks, if required); actual duration. Update the run manifest (`resumePointer` → `2.in`, Act 1 status → terminal). Then ask: **"Act 1 is complete. Ready to continue to Act 2: Package install & admin access?"** At the checkpoint set `resumePointer` to `2.in`.

## Act 2 — Package install & admin access

**Purpose.** Confirm the admin access granted in step 1.0, then install the LSC for Customer Engagement package (when 0.9 found it already installed, 2.2 and 2.3 are `reused` at the detected version; every other check runs). Act 1 set every prerequisite the installer checks, so one attempt is expected; any failure maps to a known signature and fix. **Estimated duration:** 20 agent minutes + 2–5 human minutes (package ID and install consent). **Depends on:** Act 1.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🤖 Agent: checks the licence and permission-set ladder from Act 1 before installing *(P3)*. | Read-only SOQL (2.1) | None. |
| 🧑‍💼 Admin: "Install." 🤖 Agent: expects one attempt; on failure it matches the error to a known missing setting and fixes it before retrying *(P1, P4, P5)*. | `sf package install`, bounded polling, the 2.4 table; FP-2.1 to FP-2.5, FP-2.7; `InstalledSubscriberPackage` query | A NEW error signature is a stop-and-report condition, not a guess-and-retry one. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 2.in | Ask this Act's inputs: `PKG_VERSION_ID` | n/a | If `PKG_STATE = installed` (0.9): do not ask; `PKG_VERSION_ID` = the detected ID (source `detected`); run the first validation query only to record the release name and version (`IsBeta`/`IsDeprecated` recorded, never a stop); a different pre-filled value is ignored and logged as a `decisions` row. Otherwise 👤 HUMAN — ask `PKG_VERSION_ID` if missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema). Validate it with the two Tooling queries in step detail, then write to the frozen copy and manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING`; the ID resolves to a managed, non-beta, non-deprecated version of package namespace `lsc4ce` (installed path: the detected ID and its version are recorded) | Keys already filled are not asked again, but a pre-filled ID is still validated; if none are missing, the step passes with no stop | — |
| 2.1 | Confirm the admin PSL/PS ladder from step 1.0 is still in place | `PermissionSetLicenseAssign` + `PermissionSetAssignment` | Read-only: the 1.0 postcondition query and its PSL check | All four assignments present (two PSLs, two PSs) | Present → `reused`; missing → re-run step 1.0 (two Composite calls) | FP-4.4 |
| 2.2 | ⏸ STOP — before package install | n/a | `PKG_STATE = installed`: C5 `not applicable (already installed)`, no stop. Otherwise consent **C5**: if pre-consented and the precondition passes (2.1 passed; 0 `lsc4ce` rows in the unfiltered `InstalledSubscriberPackage` query of 2.3), record `pre-consented (C5)` and continue; otherwise 👤 HUMAN confirms live: proceed with the install now. A go/no-go, not an irreversible change (a failed attempt changes nothing) | Consent (`pre-consented (C5)`, live "yes" or `not applicable (already in effect)`) recorded before 2.3 runs | n/a | — |
| 2.3 | Install LSC for Customer Engagement package | `04t…` (`<PKG_VERSION_ID>`), namespace `lsc4ce` | `sf package install --package <PKG_VERSION_ID> --security-type AdminsOnly --wait 60 --publish-wait 10 --no-prompt --json`; if it returns `InProgress`, poll `sf package install report --request-id <request id from the install output> --json` every 30 s until `Status` is `SUCCESS` or `ERROR`, maximum 60 min, then `BLOCKED` with the last observed state (the install is async; typically about 10 minutes). | Tooling API: `sf data query --use-tooling-api --query "SELECT SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersionId FROM InstalledSubscriberPackage"` with **no WHERE clause** (`NamespacePrefix can not be filtered in a query call`); filter client-side → exactly 1 `lsc4ce` row, and its `SubscriberPackageVersionId` = `<PKG_VERSION_ID>` | Run the same query first; `lsc4ce` already installed at any version → `reused`: no install, the 0.9 pin stands (the check is its `SubscriberPackageVersionId`), 2.4 not run. Not installed → install | FP-2.1–FP-2.7 |
| 2.4 | Work the install-prerequisite ladder (only when an install attempt returns a prerequisite error) | n/a | Apply the fix matching the error signature (table in step detail), then re-run 2.3 | Each fix's own postcondition (step detail); the re-run of 2.3 succeeds | Each fix is itself idempotent — re-checked before re-applying | FP-2.1–FP-2.5, FP-2.7 |
| 2.5 | Write Act 2 summary | n/a | Write `act-2-summary.md` | File exists, matches Checkpoint 2 report | Overwrite on every run | — |

#### Step details

**2.in Validate `<PKG_VERSION_ID>`** (Tooling API)

```bash
sf data query --use-tooling-api --target-org <ORG_ALIAS> --json \
  --query "SELECT Id, SubscriberPackageId, Name, MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsBeta, IsDeprecated FROM SubscriberPackageVersion WHERE Id='<PKG_VERSION_ID>'"
sf data query --use-tooling-api --target-org <ORG_ALIAS> --json \
  --query "SELECT Id, Name, NamespacePrefix FROM SubscriberPackage WHERE Id='<SubscriberPackageId from the first query>'"
```
- Pass: 1 row each, `IsBeta=false`, `IsDeprecated=false`, `NamespacePrefix='lsc4ce'`. Record the version name and number in the manifest. A failing ID is re-asked, never used.

**2.3 Install**
- On `ERROR` read the request's `Errors` field and go to 2.4; on `SUCCESS` run the 2.3 postcondition query.
- (Only when installing.) Use the exact `<PKG_VERSION_ID>`. A generic "latest" alias can resolve to an older release and returns `Package Not Found`. → FP-2.6
- After an `AdminsOnly` install, `PackageInstallRequest.SecurityType` may read back as `None` (expected). The installer also creates an "Inquiry Queue" queue; leave it.

**2.4 Prerequisite-signature table.** Match the error to a row, apply the fix, verify it, then re-run 2.3 **once**. Rows follow the installer's check order; the Account Plans row can appear at any point.

| Signature (exact text) | Missing prerequisite | Fix (Act 1 step) |
| :-- | :-- | :-- |
| `Accounts Missing Organization Feature: Account.RecordType` / `Missing Organization Feature: B2C` / `Missing Organization Feature: StateCountryPicklist` | Account Business record type; Person Accounts (the installer's "B2C" label means Person Accounts); State/Country picklists | 1.5, then 1.8, and 1.4 (FP-2.1) |
| `FieldSet(InventoryCountAssessment.AdHocInvHeaderFieldSet): no CustomObject named InventoryCountAssessment found` (also `AuditedInvHeaderFieldSet`) | Org preference `InventoryCountEnabled` | 1.14; confirm `InventoryCountAssessment` describes (FP-2.2) |
| `FieldSet(InventoryOperation.AdjustmentHeaderFields): no CustomObject named InventoryOperation found` (also `DisbursementHeaderFieldSet`, `ReturnHeaderFieldSet`) | Org preference `PrdInventoryOperationsPref` (the org and user permissions are already granted by the licence and by `LifeSciencesCommercialAdmin`) | 1.16; confirm `InventoryOperation` describes (FP-2.3) |
| `FieldSet(ProductDisbursement.VisitSignatureFields): In field: ProductionBatchNumber - no CustomField named ProductDisbursement.ProductionBatchNumber found` | Org preference `InventoryBatchManagement` | 1.15 (FP-2.4) |
| `Goal Assignments(GoalAssignment): The object type you specified GoalAssignment is invalid.` | Org preference `CarePlansPreference`. Use the Care Plans branch only; do not enable Benefit Management, CCM, Commerce Goals or Education Cloud as a workaround | 1.17 (FP-2.4) |
| `AFCWrapperControllerTest: Dependent class is invalid and needs recompilation: Class lsc4ce.TestUtils : Variable does not exist: Survey` (also `ATFDaoTest`) | `SurveySettings.enableSurvey` | 1.18; confirm `Survey` describes (FP-2.5) |
| `Layout(AccountPlan-Life Science Account Plan Layout)`: parent entity failed to deploy, with `QuickAction(AccountPlan.ImportStakeholder)` and `QuickAction(AccountPlanParticipant.AssociateStakeholder)` reporting an invalid object name (wording abbreviated) | Account Plans off: `AccountPlanSettings.enableAccountPlan=false`, and `AccountPlan` / `AccountPlanParticipant` describe return `NOT_FOUND` | 1.18a; confirm both describes (FP-2.7) |

- A signature not in this table: stop, report it in the P5 format with the full error text, do not re-run.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Admin provisioning | `<ADMIN_USER>` holds both PSLs and both PSs in the ladder | `PermissionSetAssignment`/`PermissionSetLicenseAssign` queries | Step 2.1 |
| Package install | `lsc4ce` namespace installed (by this thread, or already installed and detected at 0.9; pinned version recorded) | `InstalledSubscriberPackage` query | Step 2.3 |
| Install ladder | All prerequisite errors resolved, no unknown signature encountered | Install log + 2.4 table | Step 2.4 |

### Checkpoint 2
Report: status; changed (installed package only if this thread installed it, `act-2-summary.md`); reused (ladder rungs already assigned; the package when `PKG_STATE = installed`); verified (postcondition queries for 2.1 and 2.3); open items (none expected; note any attempt beyond one per listed signature); actual duration. Update the run manifest (`resumePointer` → `3.1`, Act 2 status → terminal). Then ask: **"Act 2 is complete. Ready to continue to Act 3: Post-install settings?"**

## Act 3 — Post-install settings

**Purpose.** Turn on the package-specific settings and mobile-admin permissions that Store Check, Order Management and the Field Rep persona build on. **Estimated duration:** 10 agent minutes (+5 human minutes if `PLAYWRIGHT_AVAILABLE = no` and a UI fallback is needed). **Depends on:** Act 2 (package installed, admin provisioned).

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🤖 Agent: one settings deploy turns on Store Check and Group Membership; it verifies the setting changed, not just that the deploy returned *(P3)*. | `Industries.settings` deploy and retrieve | — |
| 🤖 Agent: checks whether standard Quotes are already on and skips if so; grants one consolidated permission set for mobile metadata generation *(P1, P3)*. | `Quote.settings`; custom permission set with 4 user permissions for `<ADMIN_USER>` | Act 6 (6.4) also enables Quotes; detect-first avoids redoing it. |
| 🤖 Agent: the RSVP toggle can show "Off" when the service is on, so it checks the records *(P5)*. | `EmailServicesFunction` / `EmailServicesAddress` query | The toggle read-back is unreliable (FP-3.2). |

### Build steps

Deploy files for 3.1-3.6 use `manifest/package.xml` with one `<types>` block each: `Settings` members `Industries` (3.1, 3.5) and `Quote` (3.2); `PermissionSet` member `<PFX>Mobile_Metadata_Admin` (3.6). Deploy command for every step: `sf project deploy start --manifest manifest/package.xml --wait 30 --json`.

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 3.1 | Enable Store Check | `IndustriesSettings.enableStoreCheck` | One `Industries.settings` deploy with `enableStoreCheck=true` and `enableGroupMembershipPref=true` (also covers 3.3). If the read-back stays `false`: 🖱️ UI fallback (unverified — never needed so far; fallback: 👤 HUMAN) via Playwright (👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): Salesforce Go Store Check feature page, click "Turn On" (opens a confirmation modal), then "Turn On" inside the modal (this click persists it) | Metadata retrieve `Industries.settings` → `enableStoreCheck=true` | Read-back first; already `true` → skip the deploy and both clicks | FP-3.1 |
| 3.2 | Enable Standard Quotes | `QuoteSettings.enableQuote` | `Quote.settings` deploy with `enableQuote=true` only. If the read-back stays `false`: 🖱️ UI fallback (unverified — fallback: same tool rules as 3.1, 👤 HUMAN) `/lightning/setup/QuoteSettings/home`: "Enable Quotes" checkbox → Save | Metadata retrieve `Quote.settings` → `enableQuote=true`; record `enableQuotesWithoutOppEnabled` (expected `false` on a new org, `true` where Order Management is already On; either value is recorded, not a failure; 6.5 checks it after the Turn On) | Read-back first; already `true` (a later Act enabled it first) → skip | — |
| 3.3 | Enable Group Membership | `IndustriesSettings.enableGroupMembershipPref` | Covered by the 3.1 deploy. If the read-back stays `false`: 🖱️ UI fallback (unverified — fallback: same tool rules as 3.1, 👤 HUMAN) `/lightning/setup/GroupMembershipSettings/home`: click the switch's **visible label**, not the switch control | Metadata retrieve `Industries.settings` → `enableGroupMembershipPref=true` | Read-back first; already `true` → skip | — |
| 3.4 | Verify Consent Management | `PartyDataModelSettings.enableConsentManagement` | Read-only check | Metadata retrieve `PartyDataModel.settings` (type `Settings`, member `PartyDataModel`) → `enableConsentManagement=true` (package default). If `false`: UI path `/lightning/setup/ConsentManagement/home` (unverified — fallback: same tool rules as 3.1, 👤 HUMAN) | Read-only unless found `false` | — |
| 3.5 | Deploy Record Type Routing preference | `IndustriesSettings.enableLifeSciRecTypeRoutgPref` | Single-field `Industries.settings` deploy | Metadata retrieve `Industries.settings` → `enableLifeSciRecTypeRoutgPref=true` | Read-back first; already `true` → skip | — |
| 3.6 | Deploy + assign mobile-admin permission set | `PermissionSet` (`<PFX>Mobile_Metadata_Admin`): `PermissionsGenerateLifeSciencesMetadata`, `PermissionsManageLifeSciMobileMetadata`, `PermissionsSkipVldBefMetadataGeneration`, `PermissionsViewDeveloperName` | Deploy, then `PermissionSetAssignment` insert for `<ADMIN_USER>` | `SELECT PermissionsGenerateLifeSciencesMetadata, PermissionsManageLifeSciMobileMetadata, PermissionsSkipVldBefMetadataGeneration, PermissionsViewDeveloperName FROM PermissionSet WHERE Name='<PFX>Mobile_Metadata_Admin'` → all four `true`; `SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name='<PFX>Mobile_Metadata_Admin' AND AssigneeId='<ID:ADMIN_USER>'` → 1 row | Query the set by `Name` and the assignment first. Set absent → deploy. Set present → retrieve it, add only the missing permissions (Deploy safety), compare counts with `.pre`. Assignment exists → skip insert, else create | — |
| 3.7 | Verify RSVP email service | `EmailServicesFunction` + `EmailServicesAddress` | Read-only `SELECT Id, FunctionName, IsActive FROM EmailServicesFunction` and `SELECT Id, LocalPart, IsActive FROM EmailServicesAddress`; also check no RSVP Apex class exists. Do NOT rely on the Setup toggle | Both have a row with `IsActive=true` → `PASSED`. Zero rows in both and no RSVP Apex class → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` **(K3)**: the install does not provision RSVP; nothing later in this thread depends on it; list it at Checkpoint 3 and continue (not a stop). A `LifeScienceRSVP` `EmailServicesFunction` row with no `EmailServicesAddress` row (seen on an org where the package was installed before the run) is the same outcome: `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` (K3); record both counts | Read-only; never create it through the API. If the customer wants RSVP, that is a follow-up with their Salesforce account team | FP-3.2 |
| 3.8 | Write Act 3 summary | n/a | Write `act-3-summary.md` | File exists, matches Checkpoint 3 report | Overwrite on every run | — |

#### Step details

**3.1 Settings body** (`force-app/main/default/settings/Industries.settings-meta.xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<IndustriesSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableStoreCheck>true</enableStoreCheck>
    <enableGroupMembershipPref>true</enableGroupMembershipPref>
</IndustriesSettings>
```
- Retrieve after the deploy. For 3.2 deploy `force-app/main/default/settings/Quote.settings-meta.xml` with `<enableQuote>true</enableQuote>` in a `<QuoteSettings>` root the same way. Verify by retrieve, not by a modal closing.

**3.5 Record Type Routing** (`force-app/main/default/settings/Industries.settings-meta.xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<IndustriesSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <enableLifeSciRecTypeRoutgPref>true</enableLifeSciRecTypeRoutgPref>
</IndustriesSettings>
```
- This is only the prerequisite. The rest of the bundle (`Visit.Store_Check` record type, Layout, FlexiPage, CustomApplication override, Profile assignment, `LifeSciConfigCategory`/`LifeSciConfigRecord` rows) is built in Act 9.

**3.6 Mobile-admin permission set** (`force-app/main/default/permissionsets/<PFX>Mobile_Metadata_Admin.permissionset-meta.xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label><PFX_LABEL> Mobile Metadata Admin</label>
    <userPermissions><enabled>true</enabled><name>GenerateLifeSciencesMetadata</name></userPermissions>
    <userPermissions><enabled>true</enabled><name>ManageLifeSciMobileMetadata</name></userPermissions>
    <userPermissions><enabled>true</enabled><name>SkipVldBefMetadataGeneration</name></userPermissions>
    <userPermissions><enabled>true</enabled><name>ViewDeveloperName</name></userPermissions>
</PermissionSet>
```
- `GenerateLifeSciencesMetadata` and `ManageLifeSciMobileMetadata` are already granted to `<ADMIN_USER>` by `LifeSciencesCommercialAdmin` (Act 2); including them keeps this set self-contained. `SkipVldBefMetadataGeneration` and `ViewDeveloperName` are the reason the set exists. `ViewDeveloperName` must be in place before the first mobile metadata bootstrap in Act 10, or a `LifeSciConfigCategory.DeveloperName` query fails with `INVALID_FIELD`.
- `<PFX_LABEL>` is `<PFX>` without its trailing underscore (see the derived-placeholder table); the API name keeps the underscore.
- Postcondition: the four `Permissions*` fields read `true` and the assignment returns 1 row. Use is confirmed in Act 10.

**3.7 RSVP** — RSVP is the inbound email service that records invitees' replies to Life Sciences event or meeting invitations; Store Check and Quotes do not use it. Setup can show the toggle "Off" after a successful enablement; the query result is ground truth (→ FP-3.2). Known outcome: both queries return 0 rows and no RSVP Apex class. Record `PASSED_WITH_NOTES` / `KNOWN_LIMITATION` (K3); not a P5 stop.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Store Check | Enabled | `Industries.settings` retrieve | Step 3.1 |
| Standard Quotes | `enableQuote` true (once, whichever Act did it); `enableQuotesWithoutOppEnabled` false until the Act 6 Turn On (6.4) sets it true (already true if Order Management was On before the run) | `Quote.settings` retrieve | Step 3.2, then 6.5 |
| Group Membership | Enabled | `Industries.settings` retrieve | Step 3.3 |
| Consent Management | Confirmed on (package default) | `PartyDataModel.settings` retrieve | Step 3.4 |
| Record Type Routing prerequisite | Single field on; full bundle in Act 9 | `Industries.settings` retrieve | Step 3.5 |
| Mobile-admin access | `<ADMIN_USER>` holds all 4 mobile-metadata permissions | `PermissionSetAssignment` query | Step 3.6 |
| RSVP email service | Verified via records. Absent = `PASSED_WITH_NOTES` / `KNOWN_LIMITATION` (K3) | `EmailServicesFunction`/`EmailServicesAddress` query | Step 3.7 |

### Checkpoint 3
Report: status; changed (Store Check, Group Membership, Record Type Routing, mobile permission set + assignment, `act-3-summary.md`); reused (Standard Quotes if already enabled, Consent Management if already on); verified (every postcondition above); open items (Record Type Routing bundle in Act 9; RSVP absent as `KNOWN_LIMITATION` K3; `enableQuotesWithoutOppEnabled` re-checked at 6.5); actual duration. Update the run manifest (`resumePointer` → `4.in`, Act 3 status → terminal). Then ask: **"Act 3 is complete. Ready to continue to Act 4: Field Rep persona?"**
## Act 4 — Field Rep persona

**Purpose.** Create the custom Field Rep profile and permission set, provision the Field Rep user, grant the standard Order Management/Store Check runtime bundle, and prove the Field Rep's effective access, without ever broadening access as a side effect of fixing an error. **Estimated duration:** ~20 agent minutes + 5–10 human minutes (inputs step and rep decisions; +5 if `RUN_REP_CLI_CHECK = yes`). **Depends on:** Act 2 (package installed), Act 3 (Store Check and Quotes enabled), Act 1 (`Account.Business_Account` record type, Enterprise Territory Management enabled). **Deferred steps:** 4.9a-4.9c (the Quote permission set and the Sales Transaction Type grant) cannot run here, because the permission set and the object do not exist until the Order Management Turn On (Act 6) and the Act 7 pricing prerequisite. They are defined here and run from 6.5a (after 6.5) and 7.16a (after 7.16).

### Story

The riskiest decision is Quote/App Usage Assignment (AUA) access. `AppUsageAssignment` has no row-level sharing: anyone who can read it reads **every** AUA record. The only standard set that lets the Field Rep create a Quote also grants AUA Read/Create, with no narrower replacement. Quote creation is in scope; the assignment is consent row C14d, so 4.9a runs the C14 check first, and the Checkpoint 4 disclosure states the side effect. The Quote set (`RevLifecycleManagementQuotePricesTaxes`) is created by the Act 6 Turn On, so the exposure starts at 4.9a, not 4.5.

Salesforce silently drops a Permission Set License (PSL) about a second after the only permission set using it is removed. Hence PSLs first, then permission sets, in separate calls, and never a removal as a side effect.

### User Thread

| User Thread | Known Gaps |
| :---- | :---- |
| 🧑‍💼 Admin: "Set up the Field Rep's access." 🤖 Agent: clones `Minimum Access - Salesforce` into `<FIELD_REP_PROFILE>` and builds `<FIELD_REP_PS>` (the Sales Transaction Type grant comes at 4.9b), confirming names first *(P1, P3)*. | None. |
| 🧑‍💼 Admin: "Why read every App Usage Assignment?" 🤖 Agent: AUA has no row-level sharing, so any Quote-creating user gets org-wide AUA Read; granted and disclosed in the Act summary *(P4)*. | Accepted, not mitigated; no narrower standard set exists. |
| 🧑‍💼 Admin: "How do I know the rep sees what I gave them?" 🤖 Agent: reads `UserRecordAccess`/UI API as the admin; with `RUN_REP_CLI_CHECK = yes` it runs a short-lived CLI session as the rep. Removing the sole set that needs a PSL auto-unassigns it, so both lists are read before and after any removal *(P1, P2, P5)*. | The CLI session needs one human OAuth-consent click. No removal is planned here. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 4.in | Ask this Act's inputs: `FIELD_REP_USER`, `FIELD_REP_PROFILE`, `FIELD_REP_PS`, `MANAGER_USER`, `RUN_REP_CLI_CHECK` | n/a | 👤 HUMAN — list each of these keys that is still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Validate, then write to the frozen copy and the manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING` | Keys already filled are not asked again; if none are missing, the step passes with no stop | — |
| 4.1 | Clone Minimum Access into the Field Rep profile + create the Field Rep route-access permission set, in one bundle | `Profile:<FIELD_REP_PROFILE>`, `PermissionSet:<FIELD_REP_PS>` | Metadata API deploy: `sf project deploy start --manifest manifest/package.xml --wait 30 --json` (rollback-on-error; `package.xml` has a `Profile` and a `PermissionSet` type block; 2 components). **Do not include `SalesTransactionType`**: the object does not exist yet and the whole deploy rolls back with `no CustomObject named SalesTransactionType found`. It is granted at 4.9b | **Profile** (read back through the profile-owned `PermissionSet` sObject, the authoritative view; a Metadata API profile retrieve shows only the payload's five and omits platform-seeded defaults, so the two reads disagree by design, typically 5 vs 9): the five payload user permissions (`ActivitiesAccess`, `ApiEnabled`, `LightningConsoleAllowedForUser`, `LightningExperienceUser`, `ViewHelpLink`) are enabled; further enabled permissions are only this org's `Minimum Access - Salesforce` defaults (typically 4: the Chatter user permission, `FlowUFLRequired`, `EmailTemplateManagement`, `EmailAdministration`; varies by org/release); zero object/record-type grants; field, tab and app-visibility rows equal to this org's Minimum Access - Salesforce rows (compare with the same queries on that profile; counts vary widely). Extras or default app rows: `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` **(K16)**, continue. **PS**: exists, `ViewDeveloperName` enabled, zero object-permission rows (the `SalesTransactionType` row arrives at 4.9b) | Query `Profile`/`PermissionSet` by `Name`; both exist with this exact shape → reuse (zero deploy); one exists with another shape and was not created by this run → ⏸ STOP in the P5 format with the diff (adding permissions widens it for every user who has it); on the customer's yes retrieve it and add only the missing elements (Deploy safety), never the full file over it; absent → deploy the full files | FP-4.1 |
| 4.2 | Add app visibility, Account layout assignment, and the Accounts tab to the same profile/PS | `Profile:<FIELD_REP_PROFILE>` (`applicationVisibilities`, `layoutAssignments`), `PermissionSet:<FIELD_REP_PS>` (`tabSettings`) | One bundled deploy (as 4.1), 2 components, 3 deltas. Deploy the **whole** files (the 4.1 content plus the deltas), never the delta snippets: see "Fragments replace" under 4.1 details | `applicationVisibilities` for the Life Sciences Commercial app = visible/non-default; profile `layoutAssignments` for default Account **and** `Account.Business_Account` → the standard Account layout; PS `tabSettings` for the managed Accounts tab = Visible. Read back with a retrieve whose `package.xml` also lists `CustomApplication` `lsc4ce__lifeSciencesCommercial`, `Layout` `Account-Account Layout` and `RecordType` `Account.Business_Account`; a Profile-only retrieve omits these rows | Read back the 3 deltas; all present → reuse; else redeploy the whole files | FP-4.2 |
| 4.3 | Create or reuse the Field Rep user | `User` | REST `POST /sobjects/User`. First confirm the Salesforce license has capacity: `SELECT Name, TotalLicenses, UsedLicenses FROM UserLicense WHERE Name='Salesforce'` (`UsedLicenses` < `TotalLicenses`) | User exists, `IsActive=true`, `ProfileId=<FIELD_REP_PROFILE>`, exactly one profile-owned `PermissionSetAssignment`, zero other assignments | Query `User` by `Username`; present with matching `ProfileId` → reuse; else create | — |
| 4.4 | Assign the standard runtime Permission Set Licenses (10) | `PermissionSetLicenseAssign` ×10 | Composite API, `allOrNone=true`, one request, 10 subrequests | Exactly 10 `PermissionSetLicenseAssign` rows for `<FIELD_REP_USER>`, each license usage +1 | Query by `AssigneeId`; insert only the missing PSL rows | FP-4.4 |
| 4.5 | Assign the standard + custom runtime Permission Sets (11 now; the 12th, the Quote set, follows at 4.9a) | `PermissionSetAssignment` ×11 | Composite API, `allOrNone=true`, one request, 11 subrequests, run only after 4.4's read-back shows all 10 PSLs. `RevLifecycleManagementQuotePricesTaxes` is **not** in this batch (it does not exist until 6.4, so it cannot be looked up or assigned here) | 11 non-profile-owned `PermissionSetAssignment` rows for `<FIELD_REP_USER>` (12 total with the profile-owned one); PSL count still 10; View All Data/Modify All Data/Manage Users/Customize Application all false; STT, AUA and Quote object rows **zero** | Query by `AssigneeId`; insert only the missing PS rows | FP-4.4, FP-4.3, FP-4.5 |
| 4.6 | Verify effective access, read-only (runs now and again at 4.9a and 4.9c) | — | Admin-side SOQL over the rep's assigned permission sets: `SELECT SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType IN ('SalesTransactionType','AppUsageAssignment','Quote') AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '<ID:FIELD_REP_USER>')`; `SELECT PermissionsViewAllData, PermissionsModifyAllData, PermissionsManageUsers, PermissionsCustomizeApplication FROM PermissionSet WHERE Id IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '<ID:FIELD_REP_USER>')`; and the exposure query `SELECT Parent.Name, Parent.IsCustom, SobjectType, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE (PermissionsViewAllRecords = true OR PermissionsModifyAllRecords = true) AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '<ID:FIELD_REP_USER>')`. A check from the rep's own session runs only if `RUN_REP_CLI_CHECK = yes`, after 4.7 | **First run:** STT/AUA/Quote rows zero (expected while 4.9 is deferred); none of the four admin-level permissions true. **After 4.9a-4.9b:** grants match the 4.9c table. **Exposure rule:** View All only on (a) `SalesTransactionType` from `<FIELD_REP_PS>` (after 4.9b) and (b) reference/config objects from Salesforce-managed sets (`Parent.IsCustom = false`; objects such as `CodeSet`, `WorkType`, `Location`, `TimePeriod`, via `HealthCloudStarter`, `IndustriesVisit`, `LifeSciencesFieldSalesRepresentative`; the count varies by release), which is `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` **(K16)**: list it, don't stop. Modify All only where the source is the standard `IndustriesVisit` set on `AssessmentIndicatorDefinition`, `GnrcVstKeyPerformanceInd`, `GenericVisitTask` and `GenericVisitTaskContext` **(K15)**, listed at Checkpoint 4 as `KNOWN_LIMITATION`. Any other Modify All, any other View All (including any from the profile or from a custom set other than (a)) is a FAIL: stop in the P5 format (FP-4.6); change no permission set | Re-run anytime; no state change | FP-4.6 |
| 4.7 | Run only if `RUN_REP_CLI_CHECK = yes` — bootstrap a short-lived Field Rep CLI session for a live-context proof | `PermissionSet:<PFX>Temp_CLI_OAuth_Approval` (`CanApproveUninstalledApps` only) | Deploy (1 component) → assign to `<FIELD_REP_USER>` → `sf org login web --alias <PFX>field_rep --instance-url <MY_DOMAIN_URL>` → 👤 HUMAN signs in as the Field Rep with the rep's own credentials (the agent never sets or sees a password; a user with no credentials yet gets the standard emailed link, which the rep opens) and completes OAuth consent for the CLI connected app (unverified — fallback: skip 4.7 and rely on 4.6) → delete the assignment and the permission set. (unverified — fallback: skip 4.7 and rely on the 4.6 admin-side check, record `PASSED` and list the substitution) | Field Rep CLI alias authenticated (Login History shows `Remote Access 2.0`/CLI success); afterwards `<FIELD_REP_USER>`'s permission-set-assignment count equals the baseline read immediately before this step (do not hard-code it) | `RUN_REP_CLI_CHECK = no` (no CLI on the rep side) → mark `skipped`; 4.6 stands and no temporary set is created. The session should persist after the temporary PS is deleted (unverified — fallback: re-run 4.7 for each later rep-session check) | FP-4.7 |
| 4.8 | Set the rep's manager and personal currency | `User` (`ManagerId`, `DefaultCurrencyIsoCode`) | REST `PATCH /sobjects/User/<ID:FIELD_REP_USER>` `{"ManagerId":"<ID:MANAGER_USER>","DefaultCurrencyIsoCode":"<STORE_n.currency>"}`, where `<STORE_n.currency>` is the one store currency recorded in the manifest at 0.11 item (2) (the per-store rows asked at 5.in must equal it; 5.8 re-checks) | `SELECT ManagerId, DefaultCurrencyIsoCode FROM User WHERE Id = '<ID:FIELD_REP_USER>'` returns `<MANAGER_USER>` and the stores' currency | Both match → `reused`; else PATCH. The manager's territory assignment for Act 14's unlock test is created at 5.4a | FP-4.8 |
| 4.9a | **DEFERRED; runs as 6.5a, immediately after 6.5** (Turn On confirmed). Assign the Quote permission set | `PermissionSetAssignment` → `RevLifecycleManagementQuotePricesTaxes` | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first (org-wide `AppUsageAssignment` Read). REST `POST /sobjects/PermissionSetAssignment` for `<FIELD_REP_USER>`. Its PSL (`RevenueLifecycleManagementUserPsl`) was assigned in 4.4, so no PSL call | Set exists (created by 6.4); 1 new assignment row; PSL count still 10; rep holds Quote CRUD (no View All/Modify All) and AUA Read/Create: the AUA exposure disclosed at Checkpoint 4 begins here. The 4.6 exposure query then also returns one View All row on `LegalEntity` from this standard set; expected, not a finding | Query first; present → skip | FP-4.3 |
| 4.9b | **DEFERRED; runs as 7.16a, immediately after 7.16** (the 7.16 prerequisite permission set is on `<ADMIN_USER>`, so the object is describable). Grant the rep Sales Transaction Type access | `PermissionSet:<FIELD_REP_PS>` (`objectPermissions` → `SalesTransactionType`) | **Retrieve** `<FIELD_REP_PS>`, add the 4.9 block below, deploy the **whole retrieved file**, then compare counts with the pre-deploy retrieve. Precondition: `GET /sobjects/SalesTransactionType/describe` succeeds. If NOT_FOUND: confirm the 7.16 prerequisite set is assigned to `<ADMIN_USER>`, wait 30 s, retry once; still NOT_FOUND → stop `BLOCKED_STT_NOT_DESCRIBABLE` (Act 4 stays `PASSED_WITH_NOTES` with 4.9b/4.9c open); do not loop | PS read-back: `SalesTransactionType` Read + View All, no Create/Edit/Delete/Modify All; `ViewDeveloperName` and the `AccountFilter` tab setting still present (counts = pre-deploy retrieve plus exactly one object row) | Read back the PS; grant present → skip | FP-4.1 |
| 4.9c | Re-run the 4.6 checks and record the final Act 4 state | — | Same queries as 4.6; also `SELECT COUNT() FROM PermissionSetLicenseAssign WHERE AssigneeId = '<ID:FIELD_REP_USER>'` | 10 PSLs; permission-set assignments = 14 including the profile-owned row (12 after 4.5, +1 Quote set at 4.9a, +1 `<PFX>Business_Account_RT_Access` at 5.5); effective access = STT Read + View All, AUA Read/Create, Quote CRUD (no View All/Modify All on AUA or Quote); admin-level permissions all false; the 4.6 exposure rule holds | Re-run anytime; no state change | FP-4.6 |

#### Step details

Lookups used in the bodies (natural keys, run once before 4.4) (the licence half already ran as the 0.9b gate; a name missing now means provisioning changed since Act 0 or 0.9b was passed without all 10: ⏸ STOP and report it, the same hard stop as 0.9b, and never defer it past 4.4; the permission sets `CorePricingRunTimeUser`, `DocumentBuilderUser` and `ProductDiscoveryUser` arrive with their licences, while `RevLifecycleManagementQuotePricesTaxes` and `RevLifecycleManagementCalculatePricesApi` appear only after the Act 6 Turn On, see FP-4.5): `<ID:PSL:x>` = `SELECT Id, DeveloperName FROM PermissionSetLicense WHERE DeveloperName IN (<the 10 names below>)`; `<ID:PS:x>` = `SELECT Id, Name FROM PermissionSet WHERE Name IN (<the 11 names below, with <FIELD_REP_PS> as its value>)`. Each name must return exactly one row; otherwise stop and report the missing name.

**4.1 Profile + permission set** (`package.xml` members: `Profile` `<FIELD_REP_PROFILE>`, `PermissionSet` `<FIELD_REP_PS>`)
```xml
<!-- force-app/main/default/profiles/<FIELD_REP_PROFILE>.profile-meta.xml -->
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
  <custom>true</custom>
  <userLicense>Salesforce</userLicense>
  <userPermissions><enabled>true</enabled><name>ActivitiesAccess</name></userPermissions>
  <userPermissions><enabled>true</enabled><name>ApiEnabled</name></userPermissions>
  <userPermissions><enabled>true</enabled><name>LightningConsoleAllowedForUser</name></userPermissions>
  <userPermissions><enabled>true</enabled><name>LightningExperienceUser</name></userPermissions>
  <userPermissions><enabled>true</enabled><name>ViewHelpLink</name></userPermissions>
</Profile>
```
```xml
<!-- force-app/main/default/permissionsets/<FIELD_REP_PS>.permissionset-meta.xml -->
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <label><FIELD_REP_PS> (Route Access)</label>
  <hasActivationRequired>false</hasActivationRequired>
  <userPermissions><enabled>true</enabled><name>ViewDeveloperName</name></userPermissions>
</PermissionSet>
```
- Deploy exactly these five user permissions whatever this org's Minimum Access holds; do not clone extras. The Chatter user permission is not deployed: the platform copies it from Minimum Access, where it is on by default. Chatter is on by now (1.2), so Minimum Access carries it. The platform seeds a new custom profile with the org's Minimum Access defaults and default app visibilities (typically 9 user permissions, 14 app rows): a known platform outcome, not a deploy error. `ApiEnabled` and `LightningExperienceUser` are the only two this build adds; add nothing else.
- Do **not** add `AppUsageAssignment`, `Opportunity` or `Quote` rows to this set. AUA/Opportunity/Quote access comes entirely from the 4.5 bundle. A custom grant triggers a Metadata-API dependency chain (AUA Read needs Read on Quote, Order, Asset or Contract; Quote Read needs Opportunity Read) that only resolves with View All, which breaks least privilege. → FP-4.1.
- `ViewDeveloperName` is required: on first iPad login the app queries `LifeSciConfigCategory.DeveloperName`; without the permission login fails with `INVALID_FIELD: No such column 'DeveloperName'` even though authentication succeeded, and retrying does not help (→ FP-9.5).
- **Fragments replace, they do not merge.** Deploying a profile or permission set holding only the new element replaces the whole component and silently removes every other grant. For every later edit (4.2, 4.9b, Acts 8 and 9): retrieve the component, add the element, deploy the whole file, compare counts with the pre-deploy retrieve. Profile read-backs must name the components whose settings you check (`CustomApplication`, `Layout`, `RecordType`, as in 4.2).

**4.2 App visibility, Account layout, Accounts tab** (add to the 4.1 files; deploy the whole files)
```xml
<!-- add to the profile -->
<applicationVisibilities>
  <application>lsc4ce__lifeSciencesCommercial</application>
  <default>false</default>
  <visible>true</visible>
</applicationVisibilities>
<layoutAssignments>
  <layout>Account-Account Layout</layout>
</layoutAssignments>
<layoutAssignments>
  <layout>Account-Account Layout</layout>
  <recordType>Account.Business_Account</recordType>
</layoutAssignments>
```
```xml
<!-- add to the permission set -->
<tabSettings>
  <tab>lsc4ce__AccountFilter</tab>
  <visibility>Visible</visibility>
</tabSettings>
```
- Without `applicationVisibilities` the installed app never shows in App Launcher for a custom profile.
- Without both `layoutAssignments` rows, any Account create/edit panel the rep opens (including a Quote "New Account" lookup) fails with `UNKNOWN_EXCEPTION: Unexpected Error when retrieving 'Account' Layout Information: Layout contains no sections!`. Leave profile-level Business Account **visibility** alone: it comes from the permission set built in 1.6 and assigned at 5.5. → FP-4.2.
- `lsc4ce__AccountFilter` is the package's own Accounts tab (not `standard-Account`, which this build does not add). A subscriber cannot edit a managed app's tab list, but a package tab needs only the permission-set `tabSettings` grant. (`subscriberTabs`, for tabs the package did not ship such as `standard-Visit`/`standard-Quote`, is used in Acts 8/9.) `tabVisibilities` is the Profile element; a PermissionSet uses `tabSettings`.
- Deferred to later Acts on this profile/PS: `standard-Quote` tab, Quote record-type visibility, Quote layout, `Quote.SalesTransactionTypeId`/`Quote.Status` FLS (Act 8); `standard-Visit` tab (via `subscriberTabs`), `Visit.Store_Check` record-type visibility and layout (Act 9).

**4.3 Field Rep user**
```json
{
  "FirstName": "<FIELD_REP_USER.firstName>", "LastName": "<FIELD_REP_USER.lastName>",
  "Alias": "<FIELD_REP_USER.alias>", "CommunityNickname": "<FIELD_REP_USER.nickname>",
  "Username": "<FIELD_REP_USER.username>", "Email": "<FIELD_REP_USER.email>",
  "ProfileId": "<ID:FIELD_REP_PROFILE>",
  "LocaleSidKey": "<FIELD_REP_USER.locale>", "LanguageLocaleKey": "<FIELD_REP_USER.language>", "TimeZoneSidKey": "<FIELD_REP_USER.timeZone>",
  "EmailEncodingKey": "UTF-8", "IsActive": true, "ManagerId": null, "UserRoleId": null
}
```
- Every value comes from `<FIELD_REP_USER>` as frozen at 4.in; never default the locale or language. `ManagerId` is set at 4.8; `UserRoleId` stays `null`. Before creating, confirm zero existing matches for `Username` and `CommunityNickname`.

**4.4 PSL assignment** — one Composite call, separate from 4.5. Template subrequest, repeated for each of the 10 names below with `referenceId` `psl1` … `psl10`:
```json
{"allOrNone": true, "compositeRequest": [
  {"method":"POST","url":"/services/data/v<API_VER>/sobjects/PermissionSetLicenseAssign","referenceId":"psl1",
   "body":{"AssigneeId":"<ID:FIELD_REP_USER>","PermissionSetLicenseId":"<ID:PSL:ActionPlansPsl>"}}
]}
```
- The 10 PSL developer names: `ActionPlansPsl`, `ContextServiceRuntimePsl`, `CorePricingRunTime`, `DocumentBuilderUserPsl`, `HealthCloudStarter`, `IndustriesLSC4CEPsl`, `IndustriesVisitPsl`, `ProductCatalogManagementViewerPsl`, `ProductDiscoveryUserPsl`, `RevenueLifecycleManagementUserPsl`.
- Never combine a PSL assignment and the permission set that depends on it in one atomic request: it fails with `DUPLICATE_VALUE` (PSL side) and `PROCESSING_HALTED` (permission-set side) because the platform's own PSL↔set management races the explicit insert. Two sequential calls (PSLs committed and read back, then sets). → FP-4.4.

**4.5 Permission-set assignment** — one Composite call, same template with `PermissionSetAssignment` and `"PermissionSetId":"<ID:PS:ActionPlans>"`, `referenceId` `ps1` … `ps11`:
```json
{"allOrNone": true, "compositeRequest": [
  {"method":"POST","url":"/services/data/v<API_VER>/sobjects/PermissionSetAssignment","referenceId":"ps1",
   "body":{"AssigneeId":"<ID:FIELD_REP_USER>","PermissionSetId":"<ID:PS:ActionPlans>"}}
]}
```
- The 11 permission-set names in this batch: `ActionPlans`, `ContextServiceRuntimePsl` (the set's own developer name matches its PSL's; not a typo), `CorePricingRunTimeUser`, `DocumentBuilderUser`, `HealthCloudStarter`, `IndustriesVisit`, `LifeSciencesCore`, `LifeSciencesFieldSalesRepresentative`, `ProductCatalogManagementViewer`, `ProductDiscoveryUser`, `<FIELD_REP_PS>`. The 12th, `RevLifecycleManagementQuotePricesTaxes`, is assigned at 4.9a.
- PSL each set needs (two need none, hence 12 sets and 10 PSLs): `ActionPlans` → `ActionPlansPsl`; `ContextServiceRuntimePsl` → `ContextServiceRuntimePsl`; `CorePricingRunTimeUser` → `CorePricingRunTime`; `DocumentBuilderUser` → `DocumentBuilderUserPsl`; `HealthCloudStarter` → `HealthCloudStarter`; `IndustriesVisit` → `IndustriesVisitPsl`; `LifeSciencesCore` → none; `LifeSciencesFieldSalesRepresentative` → `IndustriesLSC4CEPsl`; `ProductCatalogManagementViewer` → `ProductCatalogManagementViewerPsl`; `ProductDiscoveryUser` → `ProductDiscoveryUserPsl`; `RevLifecycleManagementQuotePricesTaxes` → `RevenueLifecycleManagementUserPsl`; `<FIELD_REP_PS>` → none.
- `RevLifecycleManagementQuotePricesTaxes` is the one standard set that both grants Quote Create and brings org-wide AUA Read/Create (see Story). Assign it at 4.9a after the C14 check (C14d); the Checkpoint 4 disclosure states the side effect.
- **Never remove a permission set from this user as a side effect of another fix.** If a PSL-licensed set is removed later, read the PSL list straight after: the platform auto-unassigns the sole dependent PSL about a second later. The right postcondition is "N-1 PSLs remain, and the dropped one is the sole dependent of the removed set", not "PSL count unchanged". → FP-4.3.
- Verify: 10 PSL assignments (unchanged), 11 non-profile-owned permission-set assignments (12 total with the profile-owned one), zero View All Data/Modify All Data/Manage Users/Customize Application in the effective stack.

**4.9 Deferred grants.** 4.9a runs as 6.5a; 4.9b and 4.9c run as 7.16a; run them from here and return to the calling step. Before Turn On the Quote set does not exist, and before the Act 7 prerequisite `SalesTransactionType` is not describable (deploying the STT grant then rolls back the whole bundle). The Turn On alone does not make STT describable: `<ADMIN_USER>` must hold the Core CPQ calculate-prices set (7.16).
Added at 4.9b (retrieve the permission set, add this block, deploy the whole file; never this block alone):
```xml
<objectPermissions>
  <object>SalesTransactionType</object>
  <allowRead>true</allowRead>
  <viewAllRecords>true</viewAllRecords>
  <allowCreate>false</allowCreate><allowEdit>false</allowEdit><allowDelete>false</allowDelete><modifyAllRecords>false</modifyAllRecords>
</objectPermissions>
```

**4.7 CLI-session bootstrap** (`RUN_REP_CLI_CHECK = yes` only; `package.xml` member `PermissionSet` `<PFX>Temp_CLI_OAuth_Approval`)
```xml
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <label><PFX_LABEL> Temporary CLI OAuth Approval</label>
  <hasActivationRequired>false</hasActivationRequired>
  <userPermissions><enabled>true</enabled><name>CanApproveUninstalledApps</name></userPermissions>
</PermissionSet>
```
- Only `CanApproveUninstalledApps`. It exists solely so the Field Rep can approve the CLI connected app's OAuth consent once (👤 HUMAN click); delete the assignment and the set right after the login is recorded. Do not use the session for any mutation a later Act does not explicitly authorize.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Profile | `<FIELD_REP_PROFILE>` exists, 5 payload user permissions enabled (plus this org's Minimum Access defaults and platform-default app grants, K16), Life Sciences Commercial app visible, Account layout mapped (default + Business Account) | Setup → Profiles → `<FIELD_REP_PROFILE>` | Metadata read-back |
| Custom permission set | `<FIELD_REP_PS>` exists: `ViewDeveloperName`, Accounts tab Visible; STT Read+View All added at 4.9b | Setup → Permission Sets → `<FIELD_REP_PS>` | Metadata read-back |
| User | `<FIELD_REP_USER>` active; at the end of this Act 12 permission-set assignments (11 + profile-owned), 10 PSL assignments; the Quote set (4.9a) and 5.5's assignment follow (14 at 4.9c) | Setup → Users → `<FIELD_REP_USER>` | SOQL `PermissionSetAssignment`/`PermissionSetLicenseAssign` by `AssigneeId` |
| Effective access | After 4.9a-4.9b: Quote CRUD (no View All/Modify All), AUA Read/Create org-wide (no View All/Modify All), STT Read+View All. Before them, none of the three | Admin-side `ObjectPermissions` queries (`UserRecordAccess`/UI API describe as Field Rep if `RUN_REP_CLI_CHECK = yes`) | Steps 4.6/4.9c/4.7 |

### Checkpoint 4
Report: status, changed/reused/verified counts (profile, PS, user, 10 PSLs, 11 PSs; the 12th follows at 4.9a), where to see each, **disclose explicitly: granting `RevLifecycleManagementQuotePricesTaxes` gives the Field Rep org-wide `AppUsageAssignment` Read, any AUA record in the org regardless of owner, because AUA has no row-level sharing; it is required for Quote creation and is not mitigated; in this build it starts at 4.9a, after the Order Management Turn On**, open items (4.9a after 6.5; 4.9b-4.9c after 7.16; Quote FLS/tab/record-type deferred to Act 8; Visit tab/record-type to Act 9; profile extras and standard-set View All as K16 `KNOWN_LIMITATION`; IndustriesVisit Modify All as K15; the unassigned `<PFX>Temp_CLI_OAuth_Approval` set if 4.7 ran), actual duration; update the run manifest. Then ask: **"Act 4 is complete. Ready to continue to Act 5: Territory & store foundation?"**
## Act 5 — Territory & store foundation

**Purpose.** Stand up one Enterprise Territory Management (ETM) territory, assign the Field Rep to it, and create each store as a Business-Account-record-type Account plus its billing-address "Place" record, wired into the territory via `ObjectTerritory2Association` and `ProviderAcctTerritoryInfo` (PATI). **Estimated duration:** ~15 agent minutes for the territory + first store (+ 5–10 human minutes: inputs step and store decisions), +~5 agent minutes per additional `<STORE_n>`. **Depends on:** Act 1 (ETM enabled, `Account.Business_Account` record type exists), Act 4 (`<FIELD_REP_USER>` exists; `<MANAGER_USER>` frozen at 4.in).

### Story

Activating the territory model is org-wide and not cleanly reversible once associations exist, so it gets a stop (5.2). The admin creating stores also needs `Account.Business_Account` record-type **visibility**, not only an active record type: the small permission set from 1.6, assigned to the Field Rep here (5.5), before any store create. Every store carries its full billing address on the Account itself, because the iPad Store Check subtitle renders the Account's Billing fields.

### User Thread

| User Thread | Known Gaps |
| :---- | :---- |
| 🧑‍💼 Admin: "One territory, the rep assigned to it." 🤖 Agent: checks for an existing `<TERRITORY_MODEL>`/`<TERRITORY>`, else creates type, model and leaf territory in one call; activation is org-wide and not cleanly reversible, so it asks first *(P1, P3, P4)*. | None. |
| 🧑‍💼 Admin: "Create the first store." 🤖 Agent: Account + Place + territory links in one bundle; on `INVALID_CROSS_REFERENCE_KEY` it re-checks 5.5 and retries once (the bundle rolled back) *(P5)*. More stores: the same bundle per `<STORE_n>`, keyed by a stable identifier *(P3)*. | Pre-empted by running 5.5 before 5.6. Large store loads are out of scope. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 5.in | Ask this Act's inputs: `TERRITORY_MODEL` / `TERRITORY_TYPE` / `TERRITORY`, `STORE_n`, `CONTEXT_DEF` (for Act 6); not asked: the store owner defaults to `<FIELD_REP_USER>` | n/a | 👤 HUMAN — list each of these keys that is still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Validate, then write to the frozen copy and the manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING`. Store owner = `<FIELD_REP_USER>` for every store, recorded in the manifest as `STORE_OWNER = field rep` (`accepted recommendation`) | Keys already filled are not asked again; if none are missing, the step passes with no stop | — |
| 5.1 | Create Territory Type + Model + leaf Territory | `Territory2Type`, `Territory2Model`, `Territory2` | Composite API, `allOrNone=true`, 3 subrequests | `Territory2Type` (`DeveloperName=<TERRITORY_TYPE>`) exists; `Territory2Model` (`DeveloperName=<TERRITORY_MODEL>`) exists in `Planning` state; leaf `Territory2` (`DeveloperName=<TERRITORY>`) exists, no parent, `AccountAccessLevel=Read` | Before creating anything, read `Territory2Model`: another model already `Active` → ⏸ STOP in the P5 format naming it and offer two choices: (a) use that model as `<TERRITORY_MODEL>`, create only the type and the leaf territory in it, and skip the activation in 5.3 (C6 is not asked; the customer's model is never deactivated or edited); (b) stop the Act. Create nothing until the customer answers. Then query each by `DeveloperName`; reuse if present and matching, else create (FP-5.4) | — |
| 5.2 | ⏸ STOP — activating a territory model is org-wide and drives Account sharing from this point forward | `Territory2Model` | Consent **C6**: if pre-consented and the precondition passes (5.1 done, model `State=Planning`, no other model `Active`), record `pre-consented (C6)` and continue; otherwise 👤 HUMAN confirms live | Consent recorded before 5.3 runs | n/a | — |
| 5.3 | Activate the territory model | `Territory2Model` | REST `PATCH /sobjects/Territory2Model/<ID:TERRITORY_MODEL>` `{"State":"Activating"}`, then bounded poll (every 5s, max 12 attempts / 60s) on `State` | `Territory2Model.State=Active` | Skip if already `Active`; if `Activating` and stuck past the poll budget, stop `BLOCKED` for reconciliation; do not re-issue the PATCH | FP-5.1 |
| 5.4 | Assign `<FIELD_REP_USER>` to `<TERRITORY>` | `UserTerritory2Association` | REST `POST /sobjects/UserTerritory2Association` | Row exists for `(UserId=<ID:FIELD_REP_USER>, Territory2Id=<ID:TERRITORY>)`, no `RoleInTerritory2` set | Query by both fields; reuse if present, else create | — |
| 5.4a | Assign `<MANAGER_USER>` to `<TERRITORY>` (needed by Act 14's unlock notification flow); tell the customer first (manager-territory disclosure, Checkpoint 5) | `UserTerritory2Association` | After the disclosure: **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** (grants record access). REST `POST /sobjects/UserTerritory2Association` for `<MANAGER_USER>` on `<TERRITORY>`, no role. Reversible (delete the row). Gives the manager Read on the territory's stores; disclose at the checkpoint | Row exists for `(UserId=<ID:MANAGER_USER>, Territory2Id=<ID:TERRITORY>)`. Without it the Act 14 unlock approval errors on a missing territory and the request is withdrawn | Query by both fields; reuse if present (including when `<MANAGER_USER>` = `<ADMIN_USER>` and already assigned), else create | — |
| 5.5 | Grant `Account.Business_Account` record-type visibility to the Field Rep | `PermissionSet:<PFX>Business_Account_RT_Access` (deployed and assigned to the admin in 1.6) | **No deploy** (a one-row deploy strips `PersonAccount` from the admin). REST `POST /sobjects/PermissionSetAssignment` for `<FIELD_REP_USER>`; read back the admin's 1.6 assignment | PS has exactly the two `recordTypeVisibilities` rows left by 1.8a (`Account.Business_Account`, `PersonAccount.PersonAccount`, both visible=true, default=false), 0 object rows, 0 system permissions. Any other row count: stop `BLOCKED_RT_PS_DRIFT` and re-run 1.8a (do not deploy the PS here). Admin: UI API Account describe shows `Business_Account available=true`; `default` must equal its Act 0 value (an existing org's admin profile may already default to it; never change it). Field Rep: a rep describe needs a rep session (only if `RUN_REP_CLI_CHECK = yes`); otherwise verify from the admin side (rep holds the PS assignment; rep profile keeps the Business Account default the platform seeded at 4.1 (often visible+default=true when it is the org's only business record type); record it, do not change it) and record `PASSED` on that evidence | Read back the PS and both assignments; skip whatever already matches | FP-5.2 |
| 5.6 | Per `<STORE_n>`: create the store Account, its billing-address Place, and both territory-linkage records | `Account` (RT `Business_Account`), `ContactPointAddress`, `ObjectTerritory2Association`, `ProviderAcctTerritoryInfo` | Composite API, `allOrNone=true`, 4 subrequests, Composite reference substitution for the Account→Place/territory links. Omit any address key whose `<STORE_n.*>` value is blank (e.g. `state` where the country has none); never send an empty string | Account exists (`RecordTypeId=Business_Account`, Billing fields populated, owned by `<FIELD_REP_USER>`; every non-blank `<STORE_n.*>` address value is on the Account); `ContactPointAddress` named `"<STORE_n.name> - Billing Address"` with `IsPrimary=IsDefault=IsActive=true`; `ObjectTerritory2Association` links Account↔`<TERRITORY>`; `ProviderAcctTerritoryInfo` links Account↔`<TERRITORY>` with `PreferredAddressId`=the Place | Query `Account` by `SourceSystemIdentifier` (not `Name`); found with matching fields → reuse the whole bundle (zero DML); else create all 4 in one call | FP-5.3 |
| 5.7 | Verify store visibility and Store Check subtitle readiness | — | Default (no rep session): admin-side `SELECT RecordId, HasReadAccess, HasEditAccess FROM UserRecordAccess WHERE UserId = '<ID:FIELD_REP_USER>' AND RecordId IN (<Account, ContactPointAddress and ProviderAcctTerritoryInfo ids>)`. SOQL as `<FIELD_REP_USER>` only if `RUN_REP_CLI_CHECK = yes` | **Pass rule:** `HasReadAccess=true` for the Account, Place and PATI row, and the Account's own Billing street, city and country are populated (plus state and postal code wherever `<STORE_n.state>` / `<STORE_n.postal>` are non-blank). Account OWD is Read/Write by default in this build, so no manual share is expected. Because `<FIELD_REP_USER>` owns all three, access comes from ownership and non-owner territory sharing is not tested: record `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` and keep the watch item for Act 9/12. A missing Billing field: PATCH it on the Account (owner unchanged) and re-check. `HasReadAccess=false` on any of the three: stop `BLOCKED_STORE_NOT_VISIBLE`; do not add shares or broaden permissions | Re-run anytime; no state change | — |
| 5.8 | Check rep and store currencies match | `Account.CurrencyIsoCode`, `User.DefaultCurrencyIsoCode` | Read-only SOQL: `SELECT Name, CurrencyIsoCode FROM Account WHERE Id IN (<ID:STORE_n>)` and the 4.8 user query | Every store's currency equals the rep's `DefaultCurrencyIsoCode` | Read-only; on mismatch ⏸ STOP — fix the store or the rep (4.8) before Act 7 | FP-4.8 |

#### Step details

Lookups used below: `<ID:Account.Business_Account>` = `SELECT Id FROM RecordType WHERE SobjectType='Account' AND DeveloperName='Business_Account'`; `<ID:TERRITORY>`, `<ID:TERRITORY_MODEL>` = `SELECT Id FROM Territory2` / `Territory2Model` `WHERE DeveloperName='<TERRITORY>'` / `'<TERRITORY_MODEL>'`; `<ID:STORE_n>` = the Account Id from 5.6. Each must return exactly one row.

**5.1 Territory type/model/territory**
```json
{
  "allOrNone": true,
  "compositeRequest": [
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/Territory2Type","referenceId":"territoryType",
     "body":{"DeveloperName":"<TERRITORY_TYPE>","MasterLabel":"<TERRITORY_TYPE_LABEL>","Priority":1}},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/Territory2Model","referenceId":"territoryModel",
     "body":{"DeveloperName":"<TERRITORY_MODEL>","Name":"<TERRITORY_MODEL_LABEL>","CurrencyIsoCode":"<CORP_CCY>"}},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/Territory2","referenceId":"territory",
     "body":{"DeveloperName":"<TERRITORY>","Name":"<TERRITORY_LABEL>","Territory2TypeId":"@{territoryType.id}","Territory2ModelId":"@{territoryModel.id}","AccountAccessLevel":"Read","OpportunityAccessLevel":"None","CaseAccessLevel":"None","CurrencyIsoCode":"<CORP_CCY>"}}
  ]
}
```
- `<X_LABEL>`: use the label the customer gave for `<X>` in Act 0; else `<X>` with underscores replaced by spaces, shown at the Act 5 checkpoint.
- Send `CurrencyIsoCode` on `Territory2Model`, `Territory2` and `Product2` (7.3) only when the object's describe lists the field; otherwise omit the key. Cache the describe in the manifest with the Act 0 discovery results.
- Flat, single-territory model (no parent, no roles). For a hierarchy later, extend `Territory2` with `ParentTerritory2Id`.

**5.3 Activation**
```http
PATCH /services/data/v<API_VER>/sobjects/Territory2Model/<ID:TERRITORY_MODEL>
{"State": "Activating"}
```
- Poll `GET` the record's `State` every 5 s, up to 12 attempts; if not `Active`, report `BLOCKED` and do not re-PATCH. Gated by the 5.2 STOP, not by a single-use phrase. Once associations exist on an Active model there is no supported path back to `Planning`.

**5.5 Record-type visibility (no deploy)**
- `<PFX>Business_Account_RT_Access` exists from 1.6 with two `recordTypeVisibilities` rows after 1.8a. This step only assigns it. The rep therefore also sees `PersonAccount` as available and non-default (expected). No object, field or system permissions (API Enabled, Modify All Data etc. all `false`). Master stays the admin's default record type.
- Run this **before** 5.6: an active org-level record type is not visible to a profile automatically, including the admin's. Skipping it gives `400 INVALID_CROSS_REFERENCE_KEY — "Business Account record type is not valid for the executing user"` on the first Account insert, and the whole 4-record bundle rolls back (no partial writes; fix and retry once). → FP-5.2.

**5.6 Store bundle (repeat per `<STORE_n>`)**
```json
{
  "allOrNone": true,
  "compositeRequest": [
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/Account","referenceId":"storeAccount",
     "body":{
       "Name":"<STORE_n.name>","SourceSystemIdentifier":"<STORE_n.sourceKey>",
       "RecordTypeId":"<ID:Account.Business_Account>","OwnerId":"<ID:FIELD_REP_USER>","CurrencyIsoCode":"<STORE_n.currency>",
       "BillingStreet":"<STORE_n.street>","BillingCity":"<STORE_n.city>","BillingStateCode":"<STORE_n.state>",
       "BillingCountryCode":"<STORE_n.country>","BillingPostalCode":"<STORE_n.postal>"
     }},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/ContactPointAddress","referenceId":"storeAddress",
     "body":{
       "Name":"<STORE_n.name> - Billing Address","ParentId":"@{storeAccount.id}","OwnerId":"<ID:FIELD_REP_USER>",
       "SourceSystemIdentifier":"<STORE_n.sourceKey>-ADDR",
       "Street":"<STORE_n.street>","City":"<STORE_n.city>","StateCode":"<STORE_n.state>","CountryCode":"<STORE_n.country>","PostalCode":"<STORE_n.postal>",
       "AddressType":"Billing","UsageType":"Work","IsPrimary":true,"IsDefault":true,"IsActive":true,
       "IsValidated":false,"IsTerrAssignmentExcluded":false
     }},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/ObjectTerritory2Association","referenceId":"accountTerritoryAssociation",
     "body":{"ObjectId":"@{storeAccount.id}","Territory2Id":"<ID:TERRITORY>","AssociationCause":"Territory2Manual"}},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/ProviderAcctTerritoryInfo","referenceId":"providerAccountTerritoryInfo",
     "body":{"AccountId":"@{storeAccount.id}","Territory2Id":"<ID:TERRITORY>","OwnerId":"<ID:FIELD_REP_USER>",
       "CurrencyIsoCode":"<STORE_n.currency>","IsTargetedAccount":false,"IsAvailableOffline":true,
       "PreferredAddressId":"@{storeAddress.id}","IsActive":true,"SourceSystemIdentifier":"<STORE_n.sourceKey>-PATI"}}
  ]
}
```
- Billing fields are set on the Account as well as the Place (the Store Check subtitle reads the Account). If a later Act needs Shipping, add `Shipping*` to this same create.
- Place name `"<STORE_n.name> - Billing Address"` is the pattern the Visit `Place` picker displays; keep it identical across stores.
- Owner: `OwnerId=<FIELD_REP_USER>` on Account, Place and PATI for every store (`STORE_OWNER = field rep`, 5.in). Do not mix ownership models. Admin ownership is outside this path: change all stores at once and add explicit shares.
- Blank address value: drop its key from both bodies (`BillingStateCode` and `StateCode`); never send `""`.
- Territory membership alone grants no access on `ObjectTerritory2Association` or `ProviderAcctTerritoryInfo` to a non-owner; here access is from ownership. Acceptance is 5.7.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Territory | `<TERRITORY_TYPE>`/`<TERRITORY_MODEL>` (Active)/`<TERRITORY>` exist; `<FIELD_REP_USER>` and `<MANAGER_USER>` assigned | Setup → Territories | SOQL `Territory2Model.State`, `UserTerritory2Association` |
| Business Account access | `<ADMIN_USER>` and `<FIELD_REP_USER>` have `Account.Business_Account` visible, non-default (the shared set also carries `PersonAccount.PersonAccount`) | Admin: Account describe. Rep: assignment + profile | `recordTypeInfos` (admin); assignment + `recordTypeVisibilities` (rep) |
| Store(s) | Per `<STORE_n>`: one `Account` (Business Account RT, full Billing address), one `ContactPointAddress`, one `ObjectTerritory2Association`, one `ProviderAcctTerritoryInfo` | Account record, related Addresses | SOQL on all 4 objects |
| Store Check subtitle readiness | Account Billing fields populated (not Place-only) | Account detail page | Visual check once Store Check UI is reachable (Act 12) |

### Checkpoint 5
Report: status, changed/reused/verified (territory type/model/territory, user-territory associations (Field Rep, Manager), Business-Account-access permission set + 2 assignments, N stores × 4 records each), where to see each, **disclose that `<MANAGER_USER>` now holds the territory's Account Read access on its stores (reversible)**, open items (Act 4's deferred 4.9a after 6.5 and 4.9b–4.9c after 7.16; non-owner sharing on `ObjectTerritory2Association`/`ProviderAcctTerritoryInfo` not confirmed, a watch item for Act 9/12), actual duration; update the run manifest. Then ask: **"Act 5 is complete. Ready to continue to Act 6: OM bundle, context & pricing?"**
## Act 6 — OM bundle, context & pricing

**Purpose.** Turn on the Order Management feature bundle (Core CPQ, which is built into the platform and is not the Salesforce CPQ managed package; Context Service, Transaction Processor, Draft Order Capture, Standard Price Book activation), extend the shipped Sales Transaction context so Quotes have their own mapping, and build the pricing recipe shell, the one piece of pricing foundation with no catalog dependency. The pricing procedure is built in Act 7.
**Estimated duration:** ~30 agent minutes + 0–5 human minutes (only if C7 was answered `ask`; the 3 clicks run through Playwright). **Depends on:** Act 2 (package install, admin access), Act 3 (post-install settings).

### Story

Quotes then need their own context. The shipped `SalesTransactionContext__stdctx` is extended into `<CONTEXT_DEF>` (default `SalesTransactionContextAuto`), which inherits 14 mappings; `QuoteEntitiesMapping` is the one Quotes use. Extension resets every inherited mapping's default flag to false, and one must be default before activation. Set `QuoteEntitiesMapping` as default at creation (6.7), before any pricing procedure is attached: once an Expression Set is attached the platform blocks mapping edits, and recovery (detach, deactivate, edit, reactivate, reattach) is a five-write, non-atomic sequence kept only in FP-6.3.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Turn on Order Management." 🤖 Agent: a one-time, irreversible switch (Core CPQ, Quotes, Context Service, Pricing, Transaction Processor, Draft Order Capture, Standard Price Book, Quote page); confirms, clicks Get Started and Turn On, then asks once more before the final click *(P4)*. | `lsc-order-management` feature card; fresh accessibility-tree read before the final click | No supported disable path for most of the 11 settings. Nothing proves "nothing happened yet" except absent Setup Audit Trail rows. |
| 🤖 Agent: Turn On finished (11 settings, Standard Price Book active, Quote page deployed); creates the Quote context with Quotes as the default mapping from the start *(P3)*. | Postcondition queries (6.5); Context Service Business REST API (`/connect/context-definitions`) | 7 enabled items have no read-back API (accepted). The UI custom-logic endpoint returns a generic 404 that means "wrong caller". |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 6.1 | Open the Order Management feature card | `lsc-order-management` (Salesforce Go feature) | 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): Setup has no Quick Find entry. Setup Home → the "Achieve Popular Business Goals" card **Customer Engagement- Order Management** → **Set Up** (path `/lightning/setup/page/feature/lsc-order-management/home`). On the feature page click **Get Started** (the page can show Get Started again on reload while the plan is In Progress; read the inner task state from the plan view, not the button). Get Started sets the plan to "In Progress" (an 11-item list at about 9%) and mutates nothing else | Before: page shows "Get Started". After: plan "In Progress" with the 11-item list; zero new Setup Audit Trail rows | Label "Get Started" → click; On every fresh page load the card shows "Get Started" even while In Progress; clicking it again only re-opens the plan (no audit rows). Click it, then read the inner task state from the list it shows: not yet On → 6.2; On → 6.5; inner task "On" → skip to 6.5. A lock, "Purchase required" or "Contact Sales" on the card instead of Set Up / Get Started → FP-6.4 | FP-6.1, FP-6.4 |
| 6.2 | Open the Turn On confirmation | — | 🖱️ UI (same tool rules as 6.1): on the plan page click **Turn On**; opens a dialog, dispatches nothing | Dialog title reads "Turn on Customer Engagement- Order Management?" (no space before the hyphen; compare ignoring whitespace around the hyphen); zero new audit rows. The plan behind it lists 11 UI items (e.g. "Set up Transaction Pricing", "Enable Quote Capture", "Set up Standard Price Book", "Activate Quote Record Page"), not the names in 6.4; record them in the manifest, since 6.5 verifies by effect | Re-run safely; no side effect | FP-6.1 |
| 6.3 | ⏸ STOP — irreversible, org-wide, no supported disable path | — | Consent **C7** (the consent list names the 11 settings of 6.4): if pre-consented and the precondition passes (6.2 title matches ignoring hyphen whitespace, feature not yet On), record `pre-consented (C7)` and continue; Order Management already On → C7 `not applicable (already in effect)`, go to 6.5. If `PKG_STATE = installed` and 0.9a shows Quote rows or an active custom price book, always a live ⏸ STOP showing the counts by status and the price books, even when pre-consented; otherwise (title differs in wording) list the 11 settings and 👤 HUMAN confirms live, then re-read the title immediately before the click and gate the click on that exact title | Consent (or `not applicable (already in effect)`) recorded before 6.4 runs | N/A | — |
| 6.4 | Confirm Turn On (fires the Turn On composite) | 11 settings, named as the feature plan labels them (feature-plan labels, not API names: only `enableSalesforcePricing` (`IndustriesPricing`) and `enableTransactionProcessor` (`RevenueManagement`) are Metadata API settings fields; `enableQuotes` is `Quote.enableQuote` and `enablePriceWaterfall` is `IndustriesPricing.enablePricingWaterfall`; the other seven have no settings field. 6.5 verifies by effect, not by name): `enableRevenueCloud`, `enableQuotes`, `enableDocumentBuilder`, `enableAdvancedApprovals`, `enableContextService`, `enableSalesforcePricing`, `enablePriceWaterfall`, `enableTransactionProcessor`, `enableOrderCapture`, `activateStandardPricebook`, `deployQuoteRecordPage` | 🖱️ UI (same tool rules as 6.1): in the dialog click the inner **Turn On**; the only click in 6.1-6.4 that dispatches anything. Re-read the accessibility tree immediately before the click; never replay a recorded node ID | See 6.5 | Once on, re-running is a no-op; the card no longer offers "Turn On" | FP-6.1 |
| 6.5 | Verify Turn On completed | — | Postcondition queries (6.5 details) | The 11 settings pass their checks and the feature-plan inner task reads On (audit trail: about 11 setup actions plus a Lightning page for the Quote record page and one for each utility bar the org does not already have; on a new org, 13 rows: 11 actions, LifeScience Quote Record and Price Management App Utility Bar); 7 residual items accepted as unverifiable (K28; 6.5 details). `Quote.settings` `enableQuotesWithoutOppEnabled` ends `true` (it was `false` after 3.2; if still `false`, re-deploy `Quote.settings` with `enableQuote=true` and `enableQuotesWithoutOppEnabled=true` as in 3.2, re-read; still `false` → stop `BLOCKED`). Known outcomes, `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`, never a stop: Quotes without Opportunity enabled (expected); no separate price-book audit row; the mobile `TransactionProcessingType` may not yet be readable by the admin (checked at 8.14) | Re-query only; no write | — |
| 6.5a | Run Act 4 step 4.9a now (grant the Quote permission set to the Field Rep), then continue | `PermissionSetAssignment` for `RevLifecycleManagementQuotePricesTaxes` → `<FIELD_REP_USER>` | 4.9a is the single definition; the set exists only after Turn On. Run it, then return to 6.6 | 4.9a passes (Quote CRUD, AUA Read/Create, no View All/Modify All); the 4.6 checks re-run there | Detect existing assignment; reuse | FP-4.3 |
| 6.5b | Give the admin the pricing and catalog permission sets, **only if `SMOKE_AS_REP = no`** (or the admin will price quotes or demo Browse Catalogs). `SMOKE_AS_REP` is asked at 8.30a: default `yes` → record `skipped`; if the answer at 8.30a is `no`, run this before 8.30b | `PermissionSetAssignment` → `<ADMIN_USER>` | REST `POST /sobjects/PermissionSetAssignment`, assignment only (no `PermissionSetLicenseAssign`, FP-4.4). **Pricing:** `CorePricingRunTimeUser`, `ContextServiceRuntimePsl`, `RevLifecycleManagementQuotePricesTaxes` (only if the admin prices quotes; they do not fix the admin "configure the transaction processing type and pricing procedure" error, which 8.10a fixes). **Browse Catalogs:** `ProductDiscoveryUser`, `ProductCatalogManagementViewer` (without them the action is missing for the admin). A rep-only run needs none. **Rejected for a missing licence:** record which set, set `SMOKE_AS_REP = yes`, return to the yes path at 8.30a (ask C12), record `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`; if the customer insists on the admin path, stop `BLOCKED_ADMIN_LICENCE` | `SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId = '<ID:ADMIN_USER>' AND PermissionSet.Name IN ('CorePricingRunTimeUser','ContextServiceRuntimePsl','RevLifecycleManagementQuotePricesTaxes','ProductDiscoveryUser','ProductCatalogManagementViewer')` returns those requested | Query by (AssigneeId, PermissionSetId) → `reused`; else create. `skipped` when `SMOKE_AS_REP = yes` | FP-4.4 |
| 6.6 | Create the extended context definition (inactive) | `ContextDefinition` via `POST /services/data/v<API_VER>/connect/context-definitions` | REST (Context Service Business API) | New definition exists, inactive, `baseReference=SalesTransactionContext__stdctx`, 14 inherited mappings, all `isDefault=false` | Detect by `developerName=<CONTEXT_DEF>`; found and `baseReference`/`contextTtl`/`startDate` match → reuse (the definition-level `startDate` reads `null`: read it from `contextDefinitionVersionList[0].startDate`); else create | FP-6.2 |
| 6.7 | Set `QuoteEntitiesMapping` as the sole default mapping | `ContextMapping` via `PATCH /services/data/v<API_VER>/connect/context-definitions/{id}/context-mappings` | REST, one call carrying only the mapping to flip | GET shows exactly one default mapping, `QuoteEntitiesMapping` | GET first; already `QuoteEntitiesMapping` → skip | FP-6.3 |
| 6.8 | Activate the context definition | — | `PATCH /services/data/v<API_VER>/connect/context-definitions/{id}` `{"isActive": true}` | GET: `contextDefinitionVersionList[].isActive=true` (definition-level `isActive` reads `null`); exactly one `<CONTEXT_DEF>` row org-wide | Check `isActive` first; already true → skip | — |
| 6.9 | Create the pricing recipe shell (inactive) + List Price, Volume Discount and Tier Discount table mappings | `PricingRecipe` (`<PFX>LSCDefaultRecipe`) + 3 × `PricingRecipeTableMapping` | `POST /services/data/v<API_VER>/composite`, `allOrNone=true`, 4 subrequests | Recipe exists, `IsActive=false`, `PricingUsageSubType=LifeSciencesCommercial`, `DefaultPricingProcedureId=null`; exactly three mappings: `ListPrice` → the active Price Book Entry decision table, `VolumeDiscount` → `Price_Adjustment_Tier_Decision_Table`, `VolumeTierDiscount` → `Tiered_Adjustment_Tier_Decision_Table`. If a discount decision table does not exist yet, build the recipe with the mappings possible, record `PASSED_WITH_NOTES`, and add the rest at 7.12a (Act 7 cannot create the procedure without all three) | Detect by `DeveloperName=<PFX>LSCDefaultRecipe`: found → reuse and add any missing mapping; not found → create. A recipe with another `DeveloperName` and `PricingUsageSubType=LifeSciencesCommercial` belongs to the customer: never add mappings to it, never reuse it; if it is active, ⏸ STOP in the P5 format naming it before 7.15 activates this recipe (FP-6.9). The platform's `NGPDefaultRecipe` (other subtype) is left untouched | FP-7.1 (forward reference) |

#### Step details

**6.5 Turn On verification.** Check each item individually; there is no rollup status beyond the feature-plan page.
- Feature-plan inner task "Turn on Customer Engagement- Order Management" = On, 100% (the outer page may still read "In Progress"; later non-bundled steps remain).
- `Pricebook2` (Standard): `IsActive=true`, `LastModifiedDate` later than its pre-Turn-On value.
- A `FlexiPage` for the Quote record page exists and matches the deployed source. Query `SELECT DeveloperName FROM FlexiPage WHERE DeveloperName LIKE 'LifeScience_Quote%'` (Tooling API) and expect at least one row.
- Setup Audit Trail: new rows in the dispatch window (about 11 org setup actions plus 4 Lightning pages: the Quote record page and three utility bars). No separate row for price-book activation is expected; the `Pricebook2` check covers it. → `KNOWN_LIMITATION`.
- Side effects beyond the 11 settings are **asynchronous**. Poll every 30 s for up to 5 minutes (the Document Template usually appears after about 2 minutes) and verify: a draft Document Template for order forms; a default Proration Policy; `ContextDefinition` and `TransactionProcessingType` entity schemas now resolvable. On timeout: `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` naming the missing items; re-check once at 8.14.
- The shipped mobile `TransactionProcessingType` (`lsc4ce_pricing_mobile_tpt`) appears within about 2 minutes, but an admin query can still return 0 rows until the Act 7 pricing permission sets (7.16). Do not block on it; 8.14 reads it back before binding it.
- **Quotes without Opportunity** is switched on by Turn On; that is expected (iPad quotes have no Opportunity). Read `Quote.settings` back: `enableQuotesWithoutOppEnabled` must be `true` (rule in the 6.5 row). Record the final value in the manifest; Act 8 re-confirms it.
- `SalesTransactionType` is not visible to the admin after Turn On; it becomes queryable only after 7.16 assigns `RevLifecycleManagementCalculatePricesApi` (CoreCPQUser). Do not check it here; the Field Rep's grant is 7.16a.
- Accept as unverifiable (no supported read-back API in this release; do not block): direct Transaction Processor preference, direct Draft Order Capture preference, Core CPQ App Usage Type inventory, document-content provisioning queue state, Context Definition packaging queue state, pricing packaging/entitlement refresh internals, Draft Order upgrade-executor internals.

**6.6 Create context definition** (lookup: `<ID:CONTEXT_DEF>` = the `contextDefinitionId` returned by this POST or by the detect GET)
```json
POST /services/data/v<API_VER>/connect/context-definitions
{
  "name": "<CONTEXT_DEF>",
  "developerName": "<CONTEXT_DEF>",
  "startDate": "<START_DATE_ISO>",
  "isActive": false,
  "contextTtl": 10,
  "baseReference": "SalesTransactionContext__stdctx"
}
```
- The GET carries `isActive` as `null` at definition level; read the active state from `contextDefinitionVersionList[].isActive` (here and 6.8).
- `baseReference` auto-clones the full graph (nodes, attributes, mappings); do not build it by hand.
- `contextTtl` is in minutes; keep it at 10. Set `<START_DATE_ISO>` to the current UTC time at the call (`YYYY-MM-DDThh:mm:ss.000Z`) and record it in the manifest so the definition is immediately eligible.

**6.7 Set QuoteEntitiesMapping as sole default**
```json
PATCH /services/data/v<API_VER>/connect/context-definitions/{contextDefinitionId}/context-mappings
{
  "contextMappings": [
    {"contextMappingId": "<ID:QuoteEntitiesMapping-mapping-id>", "isDefault": true}
  ]
}
```
- Resolve `<ID:QuoteEntitiesMapping-mapping-id>` from `GET /connect/context-definitions/{id}` at `contextDefinitionVersionList[0].contextMappings[]` by `name=QuoteEntitiesMapping`; never guess it (`GET .../context-mappings` returns 405).
- The single-row PATCH works only because no Expression Set is attached yet. → FP-6.3 (the `DUPLICATE_VALUE` failure, and the detach/reattach recovery if a procedure is ever attached first). It is recovery, never a planned step.

**6.9 Pricing recipe shell + three table mappings**
```json
POST /services/data/v<API_VER>/composite
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "POST", "url": "/services/data/v<API_VER>/sobjects/PricingRecipe",
      "referenceId": "recipeShell",
      "body": {
        "DeveloperName": "<PFX>LSCDefaultRecipe",
        "MasterLabel": "<PFX>LSC Default Recipe",
        "Language": "en_US",
        "IsActive": false,
        "PricingUsageSubType": "LifeSciencesCommercial",
        "DefaultPricingProcedureId": null
      }
    },
    {
      "method": "POST", "url": "/services/data/v<API_VER>/sobjects/PricingRecipeTableMapping",
      "referenceId": "listPriceMapping",
      "body": {
        "PricingRecipeId": "@{recipeShell.id}",
        "PricingComponentType": "ListPrice",
        "LookupTableId": "<ID:price-book-entry-decision-table-id>",
        "FileBasedDecisionTableName": null
      }
    },
    {
      "method": "POST", "url": "/services/data/v<API_VER>/sobjects/PricingRecipeTableMapping",
      "referenceId": "volumeDiscountMapping",
      "body": {
        "PricingRecipeId": "@{recipeShell.id}",
        "PricingComponentType": "VolumeDiscount",
        "LookupTableId": "<ID:volume-discount-decision-table-id>",
        "FileBasedDecisionTableName": null
      }
    },
    {
      "method": "POST", "url": "/services/data/v<API_VER>/sobjects/PricingRecipeTableMapping",
      "referenceId": "tierDiscountMapping",
      "body": {
        "PricingRecipeId": "@{recipeShell.id}",
        "PricingComponentType": "VolumeTierDiscount",
        "LookupTableId": "<ID:tiered-adjustment-decision-table-id>",
        "FileBasedDecisionTableName": null
      }
    }
  ]
}
```
- **Read back with two queries** (the recipe has no exposed child relationship, so a subquery is rejected): (1) `SELECT Id, IsActive, PricingUsageSubType, DefaultPricingProcedureId FROM PricingRecipe WHERE DeveloperName='<PFX>LSCDefaultRecipe'`; (2) `SELECT PricingComponentType, LookupTableId FROM PricingRecipeTableMapping WHERE PricingRecipeId='<ID:recipe>'`.
- Decision-table IDs: `SELECT Id, DeveloperName FROM DecisionTable WHERE DeveloperName IN ('Price_Book_Entry_Decision_Table_v2','Price_Adjustment_Tier_Decision_Table','Tiered_Adjustment_Tier_Decision_Table')`. These three are platform-shipped and org-wide. The first name may differ by release: if it returns no row, list `SELECT Id, DeveloperName FROM DecisionTable WHERE DeveloperName LIKE 'Price_Book_Entry%'` and use the single active one. The second and third are the two discount tables; 7.12 refreshes all three. `VolumeDiscount` and `VolumeTierDiscount` match the `actionType` of the two discount steps in the 7.13 body.
- Without all three mappings the 7.13 POST fails with `INVALID_INPUT` "Ensure that the lookup table in the VolumeDiscount step is valid". → FP-7.1.
- Do NOT use `POST /connect/core-pricing/recipe/mapping` here: it auto-activates the recipe when it persists a nonempty mapping, removing the "inactive until Act 7" checkpoint.
- Leave `DefaultPricingProcedureId=null`; Act 7 PATCHes it once the procedure exists.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Order Management bundle | Core CPQ, Quotes, Context Service, Salesforce Pricing, Transaction Processor, Draft Order Capture enabled; Standard Price Book active; Quote record FlexiPage deployed; `enableQuotesWithoutOppEnabled=true` | Setup → Order Management feature card; `Pricebook2` record | 6.5 |
| Sales Transaction context | `<CONTEXT_DEF>` active, extends `SalesTransactionContext__stdctx`, `QuoteEntitiesMapping` sole default | Setup → Context Definitions (Custom tab) | 6.8 GET |
| Pricing recipe | `<PFX>LSCDefaultRecipe` exists, inactive, subtype `LifeSciencesCommercial`, three tables mapped, no procedure linked | `PricingRecipe`/`PricingRecipeTableMapping` | 6.9 read-back |
| Pricing procedure | Not built yet; Act 7 | — | Story |

### Checkpoint 6

Report: status `PASSED_WITH_NOTES` (K28: 7 Turn On residuals unverifiable by design; K10 where it applies; procedure deferred; mobile `TransactionProcessingType` possibly not yet readable). Changed: Order Management bundle (11 settings plus the Quotes-without-Opportunity side effect), 1 context definition + 14 mappings + 1 default flip, 1 pricing recipe + 3 table mappings, Quote permission set granted to the Field Rep (6.5a). Reused: none. Where to see it: Setup → Order Management feature card; Setup → Context Definitions; `PricingRecipe` list view. Open items: pricing procedure version, Sales Transaction Type, Revenue Settings selector, decision-table refresh and procedure activation, all carried to Act 7. Actual duration.

**Act 6 is complete. Ready to continue to Act 7: Catalog, price books & pricing?**
## Act 7 — Catalog, price books & pricing

**Purpose.** Build the catalog, categories, products, selling models, price books and territory availability the field rep needs on the iPad; create the volume/tier pricing schedules; author, simulate and activate the one final pricing-procedure version deferred from Act 6; route Quotes to it via a Sales Transaction Type (STT) and an org-default selector; and prove the chain with one accepted simulation.
**Estimated duration:** ~60 agent minutes + 5–10 human minutes (inputs step and decisions; +5–10 if `PLAYWRIGHT_AVAILABLE = no`). **Depends on:** Act 5 (territory & store foundation), Act 6 (Order Management bundle, context definition, pricing recipe shell).

### Story

This Act builds the data the iPad needs plus the pricing logic that prices a Quote line. Order: `ProductCatalog`, categories, products, one shared selling model with an option per product, category membership, Standard Price Book Entries, then one custom `Pricebook2` per `<PRICEBOOK_n>` with a `PricebookEntry` per active currency. `ProductCatalog` and the territory-availability pair are Private, so the rep gets explicit `Share` rows; anything under a product or category inherits (`ControlledByParent`). `Pricebook2` has no `Share` object and `UserRecordAccess.MaxAccessLevel` is unreliable for it: the only trustworthy check is querying it as the field-rep user.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Build the catalog." 🤖 Agent: `<CATALOG>`, categories, `<PRODUCT_n>`, selling models and `<PRICEBOOK_n>` in dependency order *(P1)*. "The rep can't see it": `ProductCatalog` and territory availability are Private, so explicit Share rows are added *(P5)*. | Composite `allOrNone=true` per object family; `Share` writes | `Pricebook2` visibility is queried as `<FIELD_REP_USER>`. Category/product/membership visibility is inherited; do not over-grant. |
| 🧑‍💼 Admin: "Set up discount tiers, then the real pricing logic." 🤖 Agent: tiers are built now (they need products and a price book); one procedure version is simulated before activation, and only one is ever active *(P2, P4)*. | `PriceAdjustmentSchedule`/`PriceAdjustmentTier` via Composite; Expression Set authoring and simulation endpoints; decision-table refresh | A rejected single-pass POST stops with the error (7.13); 7.14 gates activation. Act 10's pricing files stay empty until Act 8's selector and binding are done *(P3)*. |

### Build steps

ID placeholders (`<ID:…>`): each is the Id returned, or read back by natural key, in the step that creates it: `catalog-id` 7.1, `product-id` 7.3, `psm-id` 7.4, `pricebook-id` (the first `<PRICEBOOK_n>`) 7.6, `sched1-id`/`sched2-id` 7.10, the three decision-table ids 7.12, `expression-set-definition-id` (= `pricing-procedure-definition-id`), the `9QA` Id from 7.13, `pricing-procedure-version-id` the `9QM` Id from 7.13, `version-definition-id` 7.14. From earlier Acts: `context-definition-id` and `salestransaction-mapping-id` (6.7/6.8), `TERRITORY` (Act 5), `field-rep-user-id` (= `<ID:FIELD_REP_USER>`, Act 4). `standard` = `SELECT Id FROM Pricebook2 WHERE IsStandard=true`.

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 7.in | Ask this Act's inputs: `CATALOG`, `CATEGORY_n`, `PRODUCT_n`, `PRICEBOOK_n`, `PRICING_TIERS`, `MANUAL_DISCOUNT_SCOPE`, `PRICE_FLOOR`, `STT_NAME`, `PRICING_PROCEDURE`, `RUN_BROWSE_CATALOGS_CHECK` | n/a | 👤 HUMAN — list each of these keys still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Validate, then write to the frozen copy and the manifest (`answered` or `accepted recommendation`). Derived, not asked, recorded as `accepted recommendation`: `TIER_EFFECTIVE_FROM` = `<current year>-01-01T00:00:00.000Z`, `TIER_EFFECTIVE_TO` = `2099-12-31T00:00:00.000Z` (ISO 8601 date-times, used at 7.10 and 7.10a) | Every key listed is filled; none `PENDING` | Keys already filled (pre-filled or answered earlier) are not asked again; if none are missing the step passes with no stop | — |
| 7.1 | Create the product catalog | `ProductCatalog` (`<CATALOG>`) | `POST /services/data/v<API_VER>/sobjects/ProductCatalog` `{"Name":"<CATALOG>","Code":"<CATALOG.code>","CurrencyIsoCode":"<CORP_CCY>"}` (`CurrencyIsoCode` only on a multi-currency org) | Row exists, `Name=<CATALOG>`, `Code=<CATALOG.code>` | Detect by `Name`; reuse if found | — |
| 7.2 | Create categories | `ProductCategory` per `<CATEGORY_n>` | `POST .../composite/sobjects` (Collections, `allOrNone=true`), `CatalogId` set | One row per `<CATEGORY_n>`, correct `CatalogId` | Detect by `Name`+`CatalogId`; reuse existing | — |
| 7.3 | Create products | `Product2` per `<PRODUCT_n>` | Collections, `allOrNone=true`; body in Step details 7.3 | One row per `<PRODUCT_n>`, `IsActive=true`, `CurrencyIsoCode=<CORP_CCY>` if multi-currency org | Detect by `ProductCode`; reuse existing | — |
| 7.4 | Create the selling model + one option per product | `ProductSellingModel` (`<PFX>One_Time`) + `ProductSellingModelOption` per product | The platform allows only one `ProductSellingModel` per selling-model type / pricing term / term unit, so one model per product is impossible. Build **one shared** PSM `{"Name":"<PFX>One_Time","SellingModelType":"OneTime","Status":"Active"}` (no `CurrencyIsoCode`, even on a multi-currency org: it fails `INVALID_FIELD`; `SellingModelType` values are `OneTime`, `TermDefined`, `Evergreen`), then Collections (`allOrNone=true`) with one `ProductSellingModelOption` per product (`Product2Id`, `ProductSellingModelId`). No customer stop | 1 PSM with `SellingModelType=OneTime` + one PSMO per `<PRODUCT_n>` pointing at it. The shared PSM Id is `<ID:psm-id>` in 7.6, 7.7, 7.10 and 7.14 | Detect the PSM by `SellingModelType=OneTime` and `Status=Active` (any name) and reuse it; a `OneTime` model in `Draft` or `Inactive` is not reused (create this thread's own, `Status=Active`); detect PSMO by `Product2Id`+`ProductSellingModelId`; reuse existing | — |
| 7.5 | Assign category membership | `ProductCategoryProduct` | Collections, `allOrNone=true` | One row per product→category pairing | Detect by `ProductId`+`ProductCategoryId`; reuse existing | — |
| 7.6 | Activate Standard Price Book Entry, then create custom price books + entries | `Pricebook2` (Standard, then `<PRICEBOOK_n>`) + `PricebookEntry` per active currency | Confirm `Pricebook2.IsStandard=true,IsActive=true` (Act 6, step 6.5) first. Standard PBE, per product × currency × selling model: none exists → `POST sobjects/PricebookEntry` `{"Pricebook2Id":"<ID:standard>","Product2Id":…,"ProductSellingModelId":…,"UnitPrice":<list price for that product in the first `<PRICEBOOK_n>` with that currency>,"CurrencyIsoCode":…,"IsActive":true}`; exists but inactive → `PATCH sobjects/PricebookEntry/{id} {"IsActive":true}`. Custom (Step details 7.6): Collections, `allOrNone=true` — first one call inserting every `<PRICEBOOK_n>` `Pricebook2`, then the `PricebookEntry` rows (one per `<PRICEBOOK_n>`×product×currency) in calls of at most 200 records. More than one value in `<ACTIVE_CCYS>` is `(unverified — fallback: create one currency's entries first, confirm the Standard and custom entries activate, then the rest)` | Standard PBE active for every `<PRODUCT_n>`; one `Pricebook2` per `<PRICEBOOK_n>`; one active `PricebookEntry` per product per active currency, each with `ProductSellingModelId` (the shared PSM); per price book, active custom entries = products × currencies, else stop `BLOCKED_PBE_CURRENCY` listing the missing combinations. Visibility: query `Pricebook2` as `<FIELD_REP_USER>`. With `RUN_REP_CLI_CHECK = no` (no rep session) the admin-side check is the check: the price book is active, has entries in the Quote currency, and `SELECT InternalSharingModel FROM EntityDefinition WHERE QualifiedApiName='Pricebook2'` returns `ReadSelect` (View/Use); record `PASSED` and list the substitution in the report | Detect Standard PBE by `Product2Id`+`Pricebook2Id=<standard>`+`CurrencyIsoCode`+`ProductSellingModelId` (an entry for the same product and currency with another or no selling model is not this thread's: leave it and create; create if absent, activate if inactive); detect custom `Pricebook2` by `Name`; reuse existing, insert only missing entries, never PATCH an existing `UnitPrice`; on an org where `lsc4ce` was already installed, an inactive existing entry is activated only on the customer's yes (⏸ STOP listing them); an existing entry whose price differs from the input → ⏸ STOP showing both values | FP-7.5 |
| 7.7 | Grant territory availability for Quotes | `ProductTerritoryAvailability` (`Purpose='Quote'`) → platform-generated `ProductTerrDtlAvailability` | `POST sobjects/ProductTerritoryAvailability`, one row per product × `<TERRITORY>`: `{"ProductId":…,"TerritoryId":"<ID:TERRITORY>","AlignmentType":"Territory Inclusion","Purpose":"Quote","UsageType":"LifeSciences","Status":"Queued"}`, plus `"CurrencyIsoCode":"<CORP_CCY>"` only when the describe lists it (same shape as 9.22). Never insert `ProductTerrDtlAvailability`; the platform generates it. The platform processes both asynchronously: 7.10–7.11 do not depend on this step, so run them while it processes | Every PTA row `Status='Active'` and at least one generated detail row per PTA (`SELECT Id FROM ProductTerrDtlAvailability WHERE ProdtTerritoryAvailabilityId IN (<PTA ids>)`; the lookup field is `ProdtTerritoryAvailabilityId`). Poll every 10 s, up to 180 s, on every PTA `Status` and on the detail-row count; on timeout stop `BLOCKED_PTA_NOT_ACTIVE` (7.8 needs the detail rows), do not re-insert | Detect PTA by `ProductId`+`TerritoryId`+`Purpose`; reuse existing | — |
| 7.8 | Share catalog + territory availability with the field rep | `Share` rows on `ProductCatalog`, `ProductTerritoryAvailability` and `ProductTerrDtlAvailability` | **Needs 7.7 passed.** First read each object's org-wide default: `SELECT QualifiedApiName, InternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN ('ProductCatalog','ProductTerritoryAvailability','ProductTerrDtlAvailability')`. Share only the objects whose `InternalSharingModel` is `Private`: `POST sobjects/ProductCatalogShare` / `ProductTerritoryAvailabilityShare` / `ProductTerrDtlAvailabilityShare` (Step details 7.8), `AccessLevel=Read`, `RowCause=Manual`. An object at `Read` or `ReadWrite` needs no share and rejects a Manual Read share (`FIELD_INTEGRITY_EXCEPTION`, "trivial share level Read") | One Share row for `<FIELD_REP_USER>` per record of each `Private` object: `1 + <PTA rows> + <detail rows>` when all three are `Private` (7 for three products with one detail row each); drop the PTA term when its default is `Read` or higher. `<FIELD_REP_USER>` query for the catalog/PTA rows returns them (verified as that user, not as admin). With `RUN_REP_CLI_CHECK = no` the admin-side check is the check: `SELECT RecordId, HasReadAccess FROM UserRecordAccess WHERE UserId='<ID:field-rep-user-id>' AND RecordId IN (<catalog, PTA and detail ids>)` returns `HasReadAccess=true` for every id, plus the price book default checked in 7.6; record `PASSED` and list the substitution in the report. The `UserRecordAccess` check covers every id, including objects that need no share | Detect the default first, then existing Share rows for the user on the `Private` objects only; reuse. Zero shares on an object whose default is `Read` or higher is the expected state, not a gap | — |
| 7.9 | *(not applicable)* `LifeSciProductAcctRstrc` | — | No action. The restriction object is only needed when per-account product eligibility differs from territory-level availability; 7.7 grants it at territory level, which covers every account in `<TERRITORY>` | N/A | N/A | — |
| 7.10 | Create volume/tier pricing schedules (inactive, **with effective dates**) | `PriceAdjustmentSchedule` (`<PFX>EssentialsVolumeSchedule` `ScheduleType=Volume`, `AdjustmentMethod=Range`; `<PFX>DisplayTierSchedule` `ScheduleType=Volume`, `AdjustmentMethod=Slab`) + `PriceAdjustmentTier` children: the `Range` entry of `<PRICING_TIERS>` builds the first schedule, the `Slab` entry the second, one tier per band | `POST /services/data/v<API_VER>/composite`, nested: schedule insert (with `EffectiveFrom`/`EffectiveTo`) then tier inserts (with their own) referencing `@{scheduleRef.id}`; the product and selling model sit on each **tier**, not on the schedule; schedules `IsActive=false`. Body in Step details 7.10 | Exactly two schedules with those names, each with one tier per band of its `<PRICING_TIERS>` entry, all inactive, and **no such schedule or tier with an empty `EffectiveFrom` or `EffectiveTo`** (checked in 7.10a) | Detect schedules by `Name`; detect tiers by schedule + `Product2Id` + `LowerBound`; reuse existing | FP-7.7 |
| 7.10a | Verify / repair effective dates (schedules first, then tiers) | `PriceAdjustmentSchedule`, `PriceAdjustmentTier` | Read-back limited to this build's two schedules (the org also ships `Standard …` schedules with an empty `EffectiveTo`: **never patch those**): `SELECT Id, Name, EffectiveFrom, EffectiveTo FROM PriceAdjustmentSchedule WHERE Name IN ('<PFX>EssentialsVolumeSchedule','<PFX>DisplayTierSchedule')` and `SELECT Id, EffectiveFrom, EffectiveTo FROM PriceAdjustmentTier WHERE PriceAdjustmentSchedule.Name IN (same two names)`. For any row with an empty date: first `PATCH` **every** one of those schedules (Collections, `allOrNone=true`) with `EffectiveFrom=<TIER_EFFECTIVE_FROM>` and `EffectiveTo=<TIER_EFFECTIVE_TO>`, and only then `PATCH` every tier (a tier date cannot be set until its parent schedule has a containing range) | Zero of those schedules and tiers with an empty `EffectiveFrom` or `EffectiveTo`. **Hard gate:** the iPad pricing engine skips tier rows with empty dates (the web engine tolerates them), so a 7.14 simulation can pass while the device charges list price → FP-7.14 | Re-run safely; rows already dated are skipped | FP-7.14 |
| 7.11 | Activate the schedules | — | **Needs 7.10a passed.** `PATCH /services/data/v<API_VER>/composite/sobjects` (Collections, `allOrNone=true`) `{"IsActive":true}` for the two schedules, only after all child tiers are present | Both schedules `IsActive=true` | Detect `IsActive` first; skip if already true | — |
| 7.12 | Refresh decision tables for the new tiers | `refreshDecisionTable` standard invocable | **Needs 7.11 done and 7.10a passed.** `POST /services/data/v<API_VER>/actions/standard/refreshDecisionTable` with one body for all three tables, `{"inputs":[{"DecisionTableApiName":"Price_Book_Entry_Decision_Table_v2"},{"DecisionTableApiName":"Price_Adjustment_Tier_Decision_Table"},{"DecisionTableApiName":"Tiered_Adjustment_Tier_Decision_Table"}]}` (each output `Status` = `Queued`), bounded poll on `RefreshStatus` (interval 5 s, max 12 polls = 60 s) | `RefreshStatus=Completed` for all three decision tables the procedure reads: `Price_Book_Entry_Decision_Table_v2`, `Price_Adjustment_Tier_Decision_Table` (Range) and `Tiered_Adjustment_Tier_Decision_Table` (Slab), each with `LastModifiedDate` later than the POST (a table can already read `Completed` at the first poll; an older date means that status is from an earlier refresh). Record their Ids (`SELECT Id, DeveloperName FROM DecisionTable WHERE DeveloperName IN (…)`) for 7.13 | Re-run is safe (recomputes); always run after any tier/PBE change **and after 7.10a** (the refresh must see the dated tier rows) | FP-7.8 |
| 7.12a | Confirm the recipe maps all three lookup tables | `PricingRecipeTableMapping` on `<PFX>LSCDefaultRecipe` | Read-only query of the recipe's mappings. If `VolumeDiscount` or `VolumeTierDiscount` is missing (6.9 could not make it), `POST sobjects/PricingRecipeTableMapping` for the missing one as in 6.9 | Exactly three mappings: `ListPrice`, `VolumeDiscount`, `VolumeTierDiscount`, each pointing at an active decision table | Detect by `PricingRecipeId`+`PricingComponentType`; add only the missing ones | FP-7.1 |
| 7.13 | Author the pricing-procedure version (inactive) | `ExpressionSetDefinition` (`<PRICING_PROCEDURE>`) + its first `ExpressionSetVersion` | `POST /services/data/v<API_VER>/connect/business-rules/expression-set` with the full body in Step details 7.13 (definition and version 1 in one call). The response `id` (prefix `9QL`, an `ExpressionSet`) is **not** the definition; `versions[0].id` (prefix `9QM`) is the version. Resolve the definition with `SELECT Id FROM ExpressionSetDefinition WHERE DeveloperName='<PRICING_PROCEDURE>'` (prefix `9QA`): this is `<ID:expression-set-definition-id>` in 7.15, 7.16 and 7.17a, and passing the `9QL` Id there fails `FIELD_INTEGRITY_EXCEPTION`. (`ExpressionSetVersion` has no `ExpressionSetDefinitionId` field; query it by `ExpressionSetId`.) If the definition already exists, add the version with `PATCH …/expression-set/<ID:expression-set-definition-id>` and the same `versions` entry `(unverified — fallback: retry with the `ExpressionSet` Id from the response (prefix `9QL`); if both are rejected, stop BLOCKED_PRICING_PROCEDURE with the response)`. If the single POST is rejected, build in stages `(unverified — fallback: stop BLOCKED_PRICING_PROCEDURE with the response)`: POST the definition with a first version holding only `PricingSetting` and `ListPrice`, then add the full graph as the next version with the PATCH, and re-run 7.14. Any other rejection: compare the error with FP-7.1, FP-7.9 and FP-7.10, fix once, then stop `BLOCKED_PRICING_PROCEDURE` with the response | **Needs 7.12 and 7.12a passed.** Definition and version exist, `rank=null`, `enabled=false`; the version GET shows 20 steps and 15 variables (17 and 15 when `PRICE_FLOOR` = `none`), no `CurrencyOutputRounding`/`RoundingValues` step. Record the `9QM` Id in the manifest. `INVALID_INPUT` "Ensure that the lookup table in the ListPrice step is valid" (or the VolumeDiscount step) means a missing recipe mapping or a recipe without `PricingUsageSubType` `LifeSciencesCommercial` (6.9 / 7.12a), not a body error | Detect by `ExpressionSetDefinition.DeveloperName=<PRICING_PROCEDURE>`; if it already exists with an equivalent step graph, reuse; else create | FP-7.1, FP-7.9, FP-7.10 |
| 7.14 | Simulate the new version | — | `PATCH /services/data/v<API_VER>/connect/omnistudio/evaluation-services/version-definitions/<ID:version-definition-id>/simulation?shouldSaveSimulationInput=false`, unwrapped `{input, config, contextInput}` body (Step details 7.14; the URL Id is not the 7.13 version Id). The version GET returns steps under `step.details`, not `steps` | Simulation `NetUnitPrice`/`Subtotal` match the hand-computed expectation for each `<PRICING_TIERS>` boundary and for one Manual Discount case in `<MANUAL_DISCOUNT_SCOPE>`. Hard gate for 7.15: on any mismatch fix the 7.13 version (still inactive) and re-simulate; never activate a version that failed simulation | Re-run safely; no persistence (query param forces no save) | FP-7.4, FP-7.6 (ContextTag naming), FP-7.13 |
| 7.15 | Rank and activate the version; activate the recipe | — | **Set the Rank before activating** (activation without a rank fails, FP-7.2). `PATCH sobjects/ExpressionSetVersion/{id} {"Rank":1}` (on a re-run: the next free rank), then `PATCH /services/data/v<API_VER>/connect/omnistudio/evaluation-services/version-definitions/<ID:version-definition-id>?action=activate` with no body (the same URL Id as 7.14: the version Id with its first three characters replaced by `0k1`; with the `sf` CLI send the empty body as a request file `{"body":{"mode":"raw","raw":""}}`, never `--body ""`: FP-7.3); then `PATCH sobjects/PricingRecipe/{id} {"IsActive":true, "DefaultPricingProcedureId":"<ID:expression-set-definition-id>"}` (the `9QA` Id, see 7.13) | GET shows this version `IsActive=true`, `Rank=1`, the only active version under `<PRICING_PROCEDURE>`; recipe `IsActive=true` with `DefaultPricingProcedureId` set. **When an older version is active (re-run) `(unverified — fallback: stop and report)`:** activate the new version, read it back as active, and only then deactivate the old one (`?action=deactivate`, `{}` body, FP-7.3). Never deactivate first: the org has no active pricing until the new activation succeeds | Detect `IsActive`/`Rank` first; skip the already-true pieces | FP-7.2, FP-7.3 |
| 7.16 | Create the STT and expose its procedure link | `SalesTransactionType` (`<STT_NAME>`); `PermissionSet` `<PFX>STT_Procedure_Link` | In order: **(1)** assign `<ADMIN_USER>` the `RevLifecycleManagementCalculatePricesApi` permission set only (the platform then adds a `RevenueLifecycleManagementUserPsl` licence assignment: check `SELECT PermissionSetLicense.DeveloperName FROM PermissionSetLicenseAssign WHERE AssigneeId = '<ID:ADMIN_USER>'`; `User` has no `CoreCPQUser` column; never POST `PermissionSetLicenseAssign` directly, FP-7.11); `SalesTransactionType` is not visible to the admin until then. **(2)** `SalesTransactionType.PricingProcedureId` and `Description` are field-level-security fields and a fresh org has no `FieldPermissions` row for either, so describe and SOQL hide them (Tooling `FieldDefinition` still lists them). Deploy the narrow permission set in Step details 7.16 (own step folder, `package.xml`) and assign it to `<ADMIN_USER>` only, never the rep. **(3)** Read back `SELECT Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE Parent.Name='<PFX>STT_Procedure_Link'` (two rows, both true), then describe `SalesTransactionType` once: `PricingProcedureId` must be listed and updateable, else ⏸ STOP `STT_LINK_FIELD_HIDDEN` before creating the STT (an unlinked STT makes every Quote save fail at 8.30). **(4)** `POST sobjects/SalesTransactionType` with the body in Step details 7.16 (one POST creates the STT already linked) | `SELECT Id, Name, PricingProcedureId FROM SalesTransactionType` returns exactly one row for `<STT_NAME>` with `PricingProcedureId` = the `9QA` Id of `<PRICING_PROCEDURE>`, and no other STT points at that procedure | Detect by `Name=<STT_NAME>`; reuse existing (an existing STT with an empty link is repaired at 7.17a) | FP-7.11 |
| 7.16a | Run Act 4 steps 4.9b and 4.9c now (grant the Field Rep STT access, then re-run the 4.6 checks), then continue | `<FIELD_REP_PS>` object permission on `SalesTransactionType` | 4.9b and 4.9c are the single definition: the object is describable only after the 7.16 step (1) permission set is on `<ADMIN_USER>`. Run them from Act 4, then return to 7.17 | 4.9c passes: `SalesTransactionType` Read + View All only (the K16 carve-out, allowed from `<FIELD_REP_PS>`); the other 4.6 results unchanged | Detect current object permission; reuse if equal | FP-4.1 |
| 7.17 | Set the org-default pricing procedure | Revenue Settings selector → org value `QOCAL_PRICING_PROCEDURE` | 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`; may share one browser session with 7.18): Setup → Revenue Settings → Set Up Salesforce Pricing → Pricing Procedure → select `<PRICING_PROCEDURE>`. The selector is a button-type combobox in shadow DOM with no accessible name: locate it by position after the description text "Select the default pricing procedure for this org." under the heading "Set Up Salesforce Pricing" and before the next section heading (no "Pricing Procedure" label shows until a value is selected); empty it reads `Select an Option`; the options are the default procedure plus the custom one. **It saves on selection; there is no Save button.** The org-value endpoint is read-only: do not PATCH it | `GET /services/data/v<API_VER>/setup/org/values/QOCAL_PRICING_PROCEDURE` → `stringValue = <PRICING_PROCEDURE>`. The device uses the procedure in the rep profile's order-product-view setting (8.10) when present; this org value is the fallback. Set it anyway and keep it, 8.10 and 8.10b in agreement (FP-10.3) | GET first; already equal → `reused`; empty, or a new org → set; a different non-empty value on any org → ⏸ STOP in the P5 format showing it (org-wide, used by the customer's quoting, and other products set it too); set only on the customer's yes | FP-7.12 |
| 7.17b | Turn on Header Adjustments (Order Discount in the iPad cart footer) | `Settings:RevenueManagement` (`enableRevenueAdjustment`; Setup → Revenue Settings → Header Adjustments) | Metadata API, **retrieve first, deploy once, compare counts after.** Retrieve `Settings:RevenueManagement` and save it as the rollback copy (0.5 holds the baseline); change only `enableRevenueAdjustment` from `false` to `true`; deploy that file. The 6.4 Turn On does not set it: it is the optional guided-setup step "Apply Header Adjustments to Quotes". Without it the iPad cart footer shows Subtotal, Discount and Grand Total but no Order Discount (Add), so the 7.13 header groups get no value from the device. FlexiPage properties, the compact layout, field access and permission sets do not bring it back (FP-7.15). The device reads it only through the generated cache (Act 10) | Re-retrieve: `enableRevenueAdjustment` = `true` and the element count unchanged | Detect: already `true` → `reused` | FP-7.15 |
| 7.17c | (Only when the 7.18 Save As fails with FP-7.16) Turn on Product Configurator so Flow Builder accepts the Browse Catalog template's `ProductConfig` types | `Settings:ProductConfigurator` (`ProductConfiguratorSettings`, `enableProductConfigurator`) | **Conditional:** record `skipped (7.18 Save As succeeded)` unless the 7.18 Save As failed with `discoverProductsContext (Variable) - "apexClass" is invalid`. The template's input variable `discoverProductsContext` is typed `ProductConfig__DiscoverProductsContext`, and on some orgs Flow Builder offers `ProductConfig` types only when Product Configurator is on. The 6.4 Turn On does not set it, and it has no Setup page. Metadata API, **retrieve first, deploy once, compare after:** from a step folder `<run>/artifacts/7.17c/`, `sf project retrieve start --metadata Settings:ProductConfigurator --json` and keep it as the pre-change copy (if the retrieve returns no component, write `settings/ProductConfigurator.settings-meta.xml` = `<ProductConfiguratorSettings xmlns="http://soap.sforce.com/2006/04/metadata"><enableProductConfigurator>false</enableProductConfigurator></ProductConfiguratorSettings>` and record that no copy existed); change only `enableProductConfigurator` to `true`; `sf project deploy start --metadata Settings:ProductConfigurator --wait 10 --json`. 7.18 stays `IN_PROGRESS` | Deploy `Succeeded` with 1 component; a re-retrieve differs from the pre-change copy only in `enableProductConfigurator` = `true`. Effect check: the 7.18 Save As, redone after closing Flow Builder without saving and reloading, succeeds | Run at most once per org; already `true` → `reused`. If the deploy is rejected (no access, setting not found), or the redo still fails the same way, `OrgPermissions.ProductConfigurator` is not provisioned → ⏸ STOP `BLOCKED` in the P5 format; it needs a provisioning request (org ID, instance, signup template), not a Setup change. Never delete or retype the variable to force the save | FP-7.16 |
| 7.17a | Verify the STT link; repair it if empty | `SalesTransactionType.PricingProcedureId` | Run after 7.18. `SELECT Id, PricingProcedureId FROM SalesTransactionType WHERE Name='<STT_NAME>'`. Equal to the `9QA` Id → done. Empty (STT created before 7.16 step (3), or a re-run): do 7.16 steps (2)–(3) now, then `PATCH sobjects/SalesTransactionType/<id>` `{"PricingProcedureId":"<ID:expression-set-definition-id>"}`. Still not updateable with `<PFX>STT_Procedure_Link` assigned → ⏸ STOP `STT_LINK_FIELD_HIDDEN`; never continue unlinked: a Quote save is rejected ("the sales transaction type for this pricing procedure is missing") until the STT is linked, whether or not the Quote's own STT field is filled | `PricingProcedureId` equals the `9QA` Id; exactly one STT per procedure | Detect current value; skip if equal | — |
| 7.18 | Create the Browse Catalog flow copy and point Product Discovery at it | `Flow` `<PFX>Browse_Product_Catalog` (a copy of the packaged template `ls_ordermgmt__BrowseCatalog`) + `ProductDiscovery.settings` | If **Save As New Flow** fails with `discoverProductsContext (Variable) - "apexClass" is invalid`, run 7.17c, then redo the Save As (FP-7.16). Do not delete or retype the variable to force the save: the Quote passes the selected quote line group through `discoverProductsContext.groupId`. **The template cannot be retrieved** (platform template: `FlowDefinitionView` shows `IsTemplate=true`, namespace `ls_ordermgmt`; neither a Metadata retrieve nor Tooling `FlowDefinition` lists it), so the UI copy is the primary path; detect the template with `FlowDefinitionView`. 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): Setup → Flows → open the template (dismiss any feature popover with Escape) → **Save As New Flow** → Flow Label `<PFX> Browse Product Catalog`. Typing the label auto-fills the API name: **clear the API name field, type `<PFX>Browse_Product_Catalog`, and read the value back before saving** (filling without clearing appends and doubles the name). Then **Activate**. **Multi-currency fix (required when Multi-Currency is on):** from a step folder, `sf project retrieve start --metadata Flow:<PFX>Browse_Product_Catalog --metadata Settings:ProductDiscovery --json`; in `force-app/main/default/flows/<PFX>Browse_Product_Catalog.flow-meta.xml` replace every `elementReference` to `quoteCurrencyIsoCode` with `GetQuoteRecord.CurrencyIsoCode` (three references: the `currencyISOCode` input of both `BuildProductDetails` screen actions on `Select_Products`, and the input of the `GetAllProductsUnderCatalog` subflow; the template passes a variable that is never assigned, so otherwise Browse Catalogs lists no products and shows "Currency ISO code is required for organizations with multi-currency enabled"). In `force-app/main/default/settings/ProductDiscovery.settings-meta.xml` change exactly one value, `discoverProductsFlowNameOrgValue`, from `revenue_products__DiscoverProducts` to `<PFX>Browse_Product_Catalog`. **Then** one deploy of both files: `sf project deploy start --source-dir <flow file> --source-dir <settings file> --wait 10 --json`; it creates a new active version and keeps the previous one for rollback. If Tooling `SELECT ActiveVersionId, LatestVersionId FROM FlowDefinition WHERE DeveloperName='<PFX>Browse_Product_Catalog'` shows `ActiveVersionId` null, activate with Tooling `PATCH /tooling/sobjects/FlowDefinition/<Id>` `{"Metadata":{"activeVersionNumber":<N>}}` → FP-8.21 | `ActiveVersionId` is not null; the retrieved `ProductDiscovery.settings` shows `discoverProductsFlowNameOrgValue = <PFX>Browse_Product_Catalog`; on a multi-currency org a retrieve of the active flow has no `quoteCurrencyIsoCode` reference. The deploy strips `sourceTemplate`, the only other expected difference from the template. On failure report in the P5 format before continuing. The flow has no catalog binding (its Select Catalog screen lists every `ProductCatalog`, no default): the rep selects `<CATALOG>` each time (Quote → Browse Catalogs → Select Catalog → click the row → Next). It starts from a Quote record, so it is first exercised at 8.33 | Detect by Flow API name + version; redeploy is idempotent (new version if changed). If this step saved a flow with a doubled API name, ⏸ STOP: list it (name, `Status`, created in this run) and delete that inactive flow only after the customer's yes; then recreate it | FP-8.21, FP-7.16 |
| 7.19 | Confirm the flow is wired up (read-only) | — | Covered by the 7.18 read-back; nothing more to run. No UI check here: the Browse Catalogs action appears on a Quote record page only after 8.8 and the flow needs a Quote, so the on-screen check runs in 8.33. If `RUN_BROWSE_CATALOGS_CHECK = no`, the 7.18 read-back is the only check and the report says so | As 7.18 | Read-only | FP-8.21 |
| 7.20 | Final acceptance: refresh + simulate as a single check | — | Repeat 7.12's refresh, then one more simulation call against the now-fully-wired procedure (recipe active, STT routed, org-default set) | Simulation returns the expected tiered + manual-discount result end-to-end. This proves the pricing logic only: the simulation targets the version directly and has no routing input, so STT / org-default routing is first proven by the first real Quote priced in 8.32. It also cannot see missing tier dates (7.10a is that gate) | Re-run safely | FP-7.8 |

#### Step details

**7.3 Products**
```json
{"Name":"<PRODUCT_n.name>","ProductCode":"<PRODUCT_n.code>","Description":"<PRODUCT_n.description>","IsActive":true,"QuantityUnitOfMeasure":"<PRODUCT_n.UoM>","CurrencyIsoCode":"<CORP_CCY>"}
```
- `QuantityUnitOfMeasure`: read the `Product2` describe first. If the field is listed and `<PRODUCT_n.UoM>` is one of its active picklist values, send it. Otherwise omit the key for that product, record `<PRODUCT_n.UoM>` in the manifest as `not applied` and record `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`; never guess a picklist value.
- `CurrencyIsoCode` is required on `Product2` only when multi-currency is enabled (0.3 `MULTI=true`); omit it otherwise. Products are created in `<CORP_CCY>`; other `<ACTIVE_CCYS>` are covered by their price book entries (7.6).

**7.6 Price books and entries**
```json
{
  "allOrNone": true,
  "compositeRequest": [
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/Pricebook2","referenceId":"pb","body":{"Name":"<PRICEBOOK_n.name>","Description":"<PRICEBOOK_n.description>","IsActive":true,"CurrencyIsoCode":"<PRICEBOOK_n.currency>"}},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/PricebookEntry","referenceId":"pbe1","body":{"Pricebook2Id":"@{pb.id}","Product2Id":"<ID:product-id>","ProductSellingModelId":"<ID:psm-id>","UnitPrice":"<LIST_PRICE>","IsActive":true,"CurrencyIsoCode":"<PRICEBOOK_n.currency>"}}
  ]
}
```
- Standard entries must be active per product (and currency, selling model) *before* any custom `PricebookEntry` references it; otherwise the platform rejects the custom entry (FP-7.5). With more than one currency build one subrequest per currency, Standard first; after the inserts, per price book, the active custom-entry count equals products × currencies of that price book. Record the counts in the manifest; a shortfall stops as in the step row.
- `Pricebook2` has no `Share` object: never attempt `Pricebook2Share`. Confirm visibility by querying `Pricebook2` as `<FIELD_REP_USER>`; `UserRecordAccess.MaxAccessLevel=None` is not a reliable signal here.

**7.8 Shares**
```json
{"ParentId":"<ID:catalog-id>","UserOrGroupId":"<ID:field-rep-user-id>","AccessLevel":"Read","RowCause":"Manual"}
```
- Same shape for `ProductTerritoryAvailabilityShare` (`ParentId` = the PTA row) and `ProductTerrDtlAvailabilityShare` (`ParentId` = the generated detail row); both are needed, as in 9.22.
- `ProductCategory`, `ProductCategoryProduct` and `ProductSellingModel` need no share: the first two are `ControlledByParent`, and the selling model has read-write visibility with no share object.

**7.10 Price adjustment schedules + tiers**
```json
{
  "allOrNone": true,
  "compositeRequest": [
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/PriceAdjustmentSchedule","referenceId":"sched1","body":{"Name":"<PFX>EssentialsVolumeSchedule","ScheduleType":"Volume","AdjustmentMethod":"Range","EffectiveFrom":"<TIER_EFFECTIVE_FROM>","EffectiveTo":"<TIER_EFFECTIVE_TO>","IsActive":false}},
    {"method":"POST","url":"/services/data/v<API_VER>/sobjects/PriceAdjustmentTier","referenceId":"tier1","body":{"PriceAdjustmentScheduleId":"@{sched1.id}","Product2Id":"<ID:product-id>","ProductSellingModelId":"<ID:psm-id>","LowerBound":"<TIER_LOWER>","UpperBound":"<TIER_UPPER>","TierType":"AdjustmentPercentage","TierValue":"<TIER_PCT>","EffectiveFrom":"<TIER_EFFECTIVE_FROM>","EffectiveTo":"<TIER_EFFECTIVE_TO>"}}
  ]
}
```
- **Effective dates are mandatory on every schedule and tier, at creation,** as ISO 8601 date-times (`YYYY-MM-DDThh:mm:ss.000Z`), not plain dates: `<TIER_EFFECTIVE_FROM>` on or before the run date, `<TIER_EFFECTIVE_TO>` = `2099-12-31T00:00:00.000Z` (set at 7.in). Tier dates must sit inside the parent schedule's range. If the dated composite is rejected, create the records without dates (schedules `IsActive=false`), let 7.10a set the schedule dates first and then the tier dates, and refresh at 7.12. The iPad engine skips tier rows with empty dates and the web engine does not, so a passing simulation is not enough → FP-7.14.
- Field names in this API version: schedule `ScheduleType` and `AdjustmentMethod` (no `CalculationMethod`, no product or selling-model field on the schedule); tier `TierType`/`TierValue`, with `Product2Id` and `ProductSellingModelId` on the tier.
- Build the request from `<PRICING_TIERS>`:
  - `sched1` = the `Range` entry (`<PFX>EssentialsVolumeSchedule`); `sched2` = the `Slab` entry (`<PFX>DisplayTierSchedule`, `AdjustmentMethod` `Slab`, same body otherwise). Every tier carries the `Product2Id` of its `productCode` and the shared `ProductSellingModelId`.
  - One `PriceAdjustmentTier` per band in band order (`tier1`…`tierN` on `@{sched1.id}`, then on `@{sched2.id}`), with `<TIER_LOWER>`, `<TIER_UPPER>`, `<TIER_PCT>` from that band.
  - Both schedules and all tiers go in one Composite call with `allOrNone: true`.
- `Volume`/`Range` = non-cumulative step tiers; `Volume`/`Slab` = non-cumulative slab tiers. These are the only two combinations the mobile offline engine supports; never build cumulative or contract tiers for a mobile-facing procedure (FP-7.7).
- Schedules stay `IsActive=false` while tiers are attached, then flip to `true` only once every tier is present (7.11): activating with a partial tier set is the documented failure mode.
- The two schedule Ids become the constants `<PFX>EssentialsVolumeScheduleId` and `<PFX>DisplayTierScheduleId` in 7.13: take them from this step's response, never hardcode.

**7.13 Pricing-procedure version — full topology**

Final step graph: list price, two tier steps (both passing currency), separate percentage and amount line discounts, header adjustments (percentage, amount, total price override) spread over the lines by Discount Distribution, and an optional price floor. Send it as written, placeholders filled only. Expected results are under Reference values.

```json
POST /services/data/v<API_VER>/connect/business-rules/expression-set
{
  "name": "<PRICING_PROCEDURE>",
  "apiName":"<PRICING_PROCEDURE>","usageType":"DefaultPricing","interfaceSourceType":"PricingProcedure","usageSubtype":"LifeSciencesCommercial",
  "contextDefinitions": [
    { "id": "<ID:context-definition-id>", "name": "<CONTEXT_DEF>" }
  ],
  "versions": [
    {
      "name": "<PRICING_PROCEDURE> V1",
      "apiName":"<PRICING_PROCEDURE>_V1","versionNumber":1,"enabled":false,"rank":null,"startDate":"<PROC_START_ISO>","showExplExternally":false,"decimalScale":2,
      "steps": [
        {
          "name": "PricingSetting",
          "description": "Pricing Setting",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "PricingSettings",
          "sequenceNumber": 1,
          "resultIncluded":true,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"LineItemId","type":"Parameter","value":"LineItem","input":true,"output":false},
              {"name":"CurrencyIsoCode","type":"Parameter","value":"CurrencyIsoCode","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"IsPropagationEnabled","type":"Literal","value":"false","input":true,"output":false},
              {"name":"PriceWaterfall","type":"Parameter","value":"price_water_fall","input":false,"output":true},
              {"name":"NetUnitPrice","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"Subtotal","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "ListPrice",
          "description": "List Price",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "ListPrice",
          "sequenceNumber": 2,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"Product2Id","type":"Parameter","value":"Product","input":true,"output":false},
              {"name":"Pricebook2Id","type":"Parameter","value":"PriceBooks","input":true,"output":false},
              {"name":"ProductSellingModelId","type":"Parameter","value":"ProductSellingModel","input":true,"output":false},
              {"name":"Quantity","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"ListPriceField","type":"Parameter","value":"Constant_UnitPrice_Price_Book_Entry_Decision_Table_v2_LP","input":true,"output":false},
              {"name":"LookUpName","type":"Literal","value":"Price Book Entries V2","input":true,"output":false},
              {"name":"LookUpId","type":"Literal","value":"<ID:price-book-entry-decision-table-id>","input":true,"output":false},
              {"name":"LookUpApiName","type":"Literal","value":"Price_Book_Entry_Decision_Table_v2","input":true,"output":false},
              {"name":"IsContractEnabled","type":"Literal","value":"false","input":true,"output":false},
              {"name":"HideWaterfall","type":"Literal","value":"false","input":true,"output":false},
              {"name":"IsOutputResolutionEnabled","type":"Literal","value":"false","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"ListPrice","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"Subtotal","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "EssentialsVolumeDiscount",
          "description": "Essentials Volume Discount",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "VolumeDiscount",
          "sequenceNumber": 3,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"PriceAdjustmentScheduleId","type":"Parameter","value":"<PFX>EssentialsVolumeScheduleId","input":true,"output":false},
              {"name":"LowerBound","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"UpperBound","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"Product2Id","type":"Parameter","value":"Product","input":true,"output":false},
              {"name":"ProductSellingModelId","type":"Parameter","value":"ProductSellingModel","input":true,"output":false},
              {"name":"EffectiveFrom","type":"Parameter","value":"EffectiveFrom","input":true,"output":false},
              {"name":"EffectiveTo","type":"Parameter","value":"EffectiveTo","input":true,"output":false},
              {"name":"CurrencyIsoCode","type":"Parameter","value":"CurrencyIsoCode","input":true,"output":false},
              {"name":"Quantity","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"InputUnitPrice","type":"Parameter","value":"NetUnitPrice","input":true,"output":false},
              {"name":"TierTypeField","type":"Parameter","value":"Constant_TierType_Price_Adjustment_Tier_Decision_Table_VD","input":true,"output":false},
              {"name":"TierValueField","type":"Parameter","value":"Constant_TierValue_Price_Adjustment_Tier_Decision_Table_VD","input":true,"output":false},
              {"name":"LookUpName","type":"Literal","value":"Volume Discount Entries","input":true,"output":false},
              {"name":"LookUpId","type":"Literal","value":"<ID:volume-discount-decision-table-id>","input":true,"output":false},
              {"name":"LookUpApiName","type":"Literal","value":"Price_Adjustment_Tier_Decision_Table","input":true,"output":false},
              {"name":"IsContractEnabled","type":"Literal","value":"false","input":true,"output":false},
              {"name":"HideWaterfall","type":"Literal","value":"false","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"NetUnitPrice","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"Subtotal","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "DisplayTierDiscount",
          "description": "Display Tier Discount",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "VolumeTierDiscount",
          "sequenceNumber": 4,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"PriceAdjustmentScheduleId","type":"Parameter","value":"<PFX>DisplayTierScheduleId","input":true,"output":false},
              {"name":"Product2Id","type":"Parameter","value":"Product","input":true,"output":false},
              {"name":"ProductSellingModelId","type":"Parameter","value":"ProductSellingModel","input":true,"output":false},
              {"name":"EffectiveFrom","type":"Parameter","value":"EffectiveFrom","input":true,"output":false},
              {"name":"EffectiveTo","type":"Parameter","value":"EffectiveTo","input":true,"output":false},
              {"name":"CurrencyIsoCode","type":"Parameter","value":"CurrencyIsoCode","input":true,"output":false},
              {"name":"Quantity","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"InputUnitPrice","type":"Parameter","value":"NetUnitPrice","input":true,"output":false},
              {"name":"TierTypeField","type":"Parameter","value":"Constant_TierType_Tiered_Adjustment_Tier_Decision_Table_TD","input":true,"output":false},
              {"name":"TierValueField","type":"Parameter","value":"Constant_TierValue_Tiered_Adjustment_Tier_Decision_Table_TD","input":true,"output":false},
              {"name":"LowerBoundField","type":"Parameter","value":"Constant_LowerBound_Tiered_Adjustment_Tier_Decision_Table_TD","input":true,"output":false},
              {"name":"UpperBoundField","type":"Parameter","value":"Constant_UpperBound_Tiered_Adjustment_Tier_Decision_Table_TD","input":true,"output":false},
              {"name":"LookUpName","type":"Literal","value":"Tiered Adjustment Entries","input":true,"output":false},
              {"name":"LookUpId","type":"Literal","value":"<ID:tiered-adjustment-decision-table-id>","input":true,"output":false},
              {"name":"LookUpApiName","type":"Literal","value":"Tiered_Adjustment_Tier_Decision_Table","input":true,"output":false},
              {"name":"IsContractEnabled","type":"Literal","value":"false","input":true,"output":false},
              {"name":"HideWaterfall","type":"Literal","value":"false","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"NetUnitPrice","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"Subtotal","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "PercentagebasedManualdiscount",
          "description": "Percentage based Manual discount",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "ManualDiscount",
          "sequenceNumber": 5,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"AdjustmentType","type":"Parameter","value":"AdjustmentTypePercentage","input":true,"output":false},
              {"name":"AdjustmentValue","type":"Parameter","value":"ItemDiscountPercentage","input":true,"output":false},
              {"name":"Quantity","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"InputUnitPrice","type":"Parameter","value":"NetUnitPrice","input":true,"output":false},
              {"name":"HideWaterfall","type":"Literal","value":"false","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"NetUnitPrice","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"Subtotal","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "AmountbasedManualdiscount",
          "description": "Amount based Manual discount",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "ManualDiscount",
          "sequenceNumber": 6,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"AdjustmentType","type":"Parameter","value":"AdjustmentTypeAmount","input":true,"output":false},
              {"name":"AdjustmentValue","type":"Parameter","value":"ItemDiscountAmount","input":true,"output":false},
              {"name":"Quantity","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"InputUnitPrice","type":"Parameter","value":"NetUnitPrice","input":true,"output":false},
              {"name":"HideWaterfall","type":"Literal","value":"false","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"NetUnitPrice","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"Subtotal","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "HeaderPercentageGroup",
          "stepType": "ListGroup",
          "sequenceNumber": 7,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[]
        },
        {
          "name": "HeaderPercentageFilter",
          "stepType": "AdvancedListFilter",
          "sequenceNumber": 1,
          "parentStep": "HeaderPercentageGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "advancedCondition": {
            "conditionLogic":"1 AND 2 AND 3",
            "criteria": [
              { "sequenceNumber": 1, "sourceFieldName": "AppliedDiscount__std", "operator": "IsNotNull" },
              { "sequenceNumber": 2, "sourceFieldName": "AppliedDiscountAmount__std", "operator": "IsNull" },
              { "sequenceNumber": 3, "sourceFieldName": "TotalPriceOverride__std", "operator": "IsNull" }
            ]
          }
        },
        {
          "name": "SetHeaderPercentage",
          "description": "Assignment",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "AssignmentElement",
          "sequenceNumber": 2,
          "parentStep": "HeaderPercentageGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"section-0-input1","type":"Parameter","value":"AppliedDiscount__std","input":true,"output":false},
              {"name":"section-1-input1","type":"Parameter","value":"HeaderPercentage","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"2","input":true,"output":false},
              {"name":"sectionJsonString1","type":"Literal","value":"{\"whereConditions\":[]}","input":true,"output":false},
              {"name":"sectionJsonString2","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Numeric\",\"name\":\"section-0-input1\",\"value\":\"AppliedDiscount__std\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Numeric\",\"name\":\"section-0-output\",\"value\":\"HeaderAdjustmentValue__std\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"sectionJsonString3","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Text\",\"name\":\"section-1-input1\",\"value\":\"HeaderPercentage\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Text\",\"name\":\"section-1-output\",\"value\":\"HeaderAdjustmentType__std\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"section-0-output","type":"Parameter","value":"HeaderAdjustmentValue__std","input":false,"output":true},
              {"name":"section-1-output","type":"Parameter","value":"HeaderAdjustmentType__std","input":false,"output":true}
            ]
          }
        },
        {
          "name": "HeaderAmountGroup",
          "stepType": "ListGroup",
          "sequenceNumber": 8,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[]
        },
        {
          "name": "HeaderAmountFilter",
          "stepType": "AdvancedListFilter",
          "sequenceNumber": 1,
          "parentStep": "HeaderAmountGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "advancedCondition": {
            "conditionLogic":"1 AND 2 AND 3",
            "criteria": [
              { "sequenceNumber": 1, "sourceFieldName": "AppliedDiscount__std", "operator": "IsNull" },
              { "sequenceNumber": 2, "sourceFieldName": "AppliedDiscountAmount__std", "operator": "IsNotNull" },
              { "sequenceNumber": 3, "sourceFieldName": "TotalPriceOverride__std", "operator": "IsNull" }
            ]
          }
        },
        {
          "name": "SetHeaderAmount",
          "description": "Assignment",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "AssignmentElement",
          "sequenceNumber": 2,
          "parentStep": "HeaderAmountGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"section-0-input1","type":"Parameter","value":"AppliedDiscountAmount__std","input":true,"output":false},
              {"name":"section-1-input1","type":"Parameter","value":"HeaderAmount","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"2","input":true,"output":false},
              {"name":"sectionJsonString1","type":"Literal","value":"{\"whereConditions\":[]}","input":true,"output":false},
              {"name":"sectionJsonString2","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Currency\",\"name\":\"section-0-input1\",\"value\":\"AppliedDiscountAmount__std\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Numeric\",\"name\":\"section-0-output\",\"value\":\"HeaderAdjustmentValue__std\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"sectionJsonString3","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Text\",\"name\":\"section-1-input1\",\"value\":\"HeaderAmount\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Text\",\"name\":\"section-1-output\",\"value\":\"HeaderAdjustmentType__std\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"section-0-output","type":"Parameter","value":"HeaderAdjustmentValue__std","input":false,"output":true},
              {"name":"section-1-output","type":"Parameter","value":"HeaderAdjustmentType__std","input":false,"output":true}
            ]
          }
        },
        {
          "name": "HeaderOverrideGroup",
          "stepType": "ListGroup",
          "sequenceNumber": 9,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[]
        },
        {
          "name": "HeaderOverrideFilter",
          "stepType": "AdvancedListFilter",
          "sequenceNumber": 1,
          "parentStep": "HeaderOverrideGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "advancedCondition": {
            "conditionLogic":"1 AND 2 AND 3",
            "criteria": [
              { "sequenceNumber": 1, "sourceFieldName": "AppliedDiscount__std", "operator": "IsNull" },
              { "sequenceNumber": 2, "sourceFieldName": "AppliedDiscountAmount__std", "operator": "IsNull" },
              { "sequenceNumber": 3, "sourceFieldName": "TotalPriceOverride__std", "operator": "IsNotNull" }
            ]
          }
        },
        {
          "name": "SetHeaderOverride",
          "description": "Assignment",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "AssignmentElement",
          "sequenceNumber": 2,
          "parentStep": "HeaderOverrideGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"section-0-input1","type":"Parameter","value":"TotalPriceOverride__std","input":true,"output":false},
              {"name":"section-1-input1","type":"Parameter","value":"HeaderPriceOverride","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"2","input":true,"output":false},
              {"name":"sectionJsonString1","type":"Literal","value":"{\"whereConditions\":[]}","input":true,"output":false},
              {"name":"sectionJsonString2","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Currency\",\"name\":\"section-0-input1\",\"value\":\"TotalPriceOverride__std\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Numeric\",\"name\":\"section-0-output\",\"value\":\"HeaderAdjustmentValue__std\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"sectionJsonString3","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Text\",\"name\":\"section-1-input1\",\"value\":\"HeaderPriceOverride\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Text\",\"name\":\"section-1-output\",\"value\":\"HeaderAdjustmentType__std\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"section-0-output","type":"Parameter","value":"HeaderAdjustmentValue__std","input":false,"output":true},
              {"name":"section-1-output","type":"Parameter","value":"HeaderAdjustmentType__std","input":false,"output":true}
            ]
          }
        },
        {
          "name": "ResetToListForOverride",
          "description": "Price override replaces line discounts: reset net unit price to list price",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "AssignmentElement",
          "sequenceNumber": 3,
          "parentStep": "HeaderOverrideGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"section-0-input1","type":"Parameter","value":"ListPrice","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"1","input":true,"output":false},
              {"name":"sectionJsonString1","type":"Literal","value":"{\"whereConditions\":[]}","input":true,"output":false},
              {"name":"sectionJsonString2","type":"Literal","value":"{\"whereConditions\":[{\"field\":{\"dataType\":\"Currency\",\"name\":\"section-0-input1\",\"value\":\"ListPrice\",\"allowCompatibleDataTypes\":true},\"value\":{\"dataType\":\"Currency\",\"name\":\"section-0-output\",\"value\":\"NetUnitPrice\",\"allowCompatibleDataTypes\":true}}]}","input":true,"output":false},
              {"name":"section-0-output","type":"Parameter","value":"NetUnitPrice","input":false,"output":true}
            ]
          }
        },
        {
          "name": "DiscountDistributionService",
          "description": "Discount Distribution Service",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "DiscountDistributionService",
          "sequenceNumber": 10,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"DiscountType","type":"Parameter","value":"HeaderAdjustmentType__std","input":true,"output":false},
              {"name":"DiscountValue","type":"Parameter","value":"HeaderAdjustmentValue__std","input":true,"output":false},
              {"name":"SpreadLogic","type":"Parameter","value":"AdjustmentDistributionLogic__std","input":true,"output":false},
              {"name":"InputSpreadType","type":"Parameter","value":"DDS_NetUnitPrice","input":true,"output":false},
              {"name":"ListPrice","type":"Parameter","value":"ListPrice","input":true,"output":false},
              {"name":"Quantity","type":"Parameter","value":"LineItemQuantity","input":true,"output":false},
              {"name":"LineItemId","type":"Parameter","value":"LineItem","input":true,"output":false},
              {"name":"InputUnitPrice","type":"Parameter","value":"NetUnitPrice","input":true,"output":false},
              {"name":"HeaderSubtotal","type":"Parameter","value":"Subtotal","input":true,"output":false},
              {"name":"LineFloorPrice","type":"Parameter","value":"MinimumNetUnitPrice","input":true,"output":false},
              {"name":"FloorPricingEnabled","type":"Literal","value":"false","input":true,"output":false},
              {"name":"RemainderAllowed","type":"Literal","value":"false","input":true,"output":false},
              {"name":"SpreadValue","type":"Parameter","value":"HeaderDiscountValue","input":false,"output":true},
              {"name":"SpreadType","type":"Parameter","value":"HeaderDistributionType","input":false,"output":true},
              {"name":"LineItemDiscountType","type":"Parameter","value":"HeaderDiscountType","input":false,"output":true}
            ]
          }
        },
        {
          "name": "PremiumFloorGroup",
          "description": "Premium Floor Group",
          "stepType": "ListGroup",
          "sequenceNumber": 11,
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[]
        },
        {
          "name": "PremiumFloorFilter",
          "stepType": "AdvancedListFilter",
          "sequenceNumber": 1,
          "parentStep": "PremiumFloorGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "advancedCondition": {
            "conditionLogic":"1",
            "criteria": [
              { "sequenceNumber": 1, "sourceFieldName": "ItemProductCode", "valueType": "Literal", "value": "'<PRICE_FLOOR.productCode>'", "operator": "Equals" }
            ]
          }
        },
        {
          "name": "PremiumFloor",
          "description": "Premium Floor",
          "stepType": "BusinessKnowledgeModel",
          "actionType": "FormulaBasedPricing",
          "sequenceNumber": 2,
          "parentStep": "PremiumFloorGroup",
          "resultIncluded":false,"shouldExposeConditionDetails":false,"shouldExposeExecPathMsgOnly":true,"shouldShowExplExternally":false,"hasNestedExplainability":false,"passedMessageTokenMappings":[],"failedMessageTokenMappings":[],"noResultMessageTokenMappings":[],
          "customElement": {
            "parameters": [
              {"name":"formula-section-0-input","type":"Formula","value":"MAX ( NetUnitPrice , <PRICE_FLOOR.value> )","input":true,"output":false},
              {"name":"formula-section-1-input","type":"Formula","value":"MAX ( NetUnitPrice , <PRICE_FLOOR.value> ) * LineItemQuantity","input":true,"output":false},
              {"name":"formulaSectionCount","type":"Literal","value":"2","input":true,"output":false},
              {"name":"HideWaterfall","type":"Literal","value":"false","input":true,"output":false},
              {"name":"sectionCount","type":"Literal","value":"0","input":true,"output":false},
              {"name":"selectedFunction","type":"Literal","value":"Get","input":true,"output":false},
              {"name":"IsRealTime","type":"Literal","value":"false","input":true,"output":false},
              {"name":"formula-section-0-output","type":"Parameter","value":"NetUnitPrice","input":false,"output":true},
              {"name":"formula-section-1-output","type":"Parameter","value":"ItemNetTotalPrice","input":false,"output":true}
            ]
          }
        }
      ],
      "variables": [
              {"name":"AdjustmentTypePercentage","description":"AdjustmentTypePercentage","type":"Constant","dataType":"Text","value":"Percentage","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"<PFX>DisplayTierScheduleId","description":"<PFX>DisplayTierScheduleId","type":"Constant","dataType":"Text","value":"<ID:sched2-id>","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"<PFX>EssentialsVolumeScheduleId","description":"<PFX>EssentialsVolumeScheduleId","type":"Constant","dataType":"Text","value":"<ID:sched1-id>","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_LowerBound_Tiered_Adjustment_Tier_Decision_Table_TD","description":"Constant_LowerBound_Tiered_Adjustment_Tier_Decision_Table_TD","type":"Constant","dataType":"Text","value":"LowerBound","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_TierType_Price_Adjustment_Tier_Decision_Table_VD","description":"Constant_TierType_Price_Adjustment_Tier_Decision_Table_VD","type":"Constant","dataType":"Text","value":"TierType","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_TierType_Tiered_Adjustment_Tier_Decision_Table_TD","description":"Constant_TierType_Tiered_Adjustment_Tier_Decision_Table_TD","type":"Constant","dataType":"Text","value":"TierType","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_TierValue_Price_Adjustment_Tier_Decision_Table_VD","description":"Constant_TierValue_Price_Adjustment_Tier_Decision_Table_VD","type":"Constant","dataType":"Text","value":"TierValue","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_TierValue_Tiered_Adjustment_Tier_Decision_Table_TD","description":"Constant_TierValue_Tiered_Adjustment_Tier_Decision_Table_TD","type":"Constant","dataType":"Text","value":"TierValue","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_UnitPrice_Price_Book_Entry_Decision_Table_v2_LP","description":"Constant_UnitPrice_Price_Book_Entry_Decision_Table_v2_LP","type":"Constant","dataType":"Text","value":"UnitPrice","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"Constant_UpperBound_Tiered_Adjustment_Tier_Decision_Table_TD","description":"Constant_UpperBound_Tiered_Adjustment_Tier_Decision_Table_TD","type":"Constant","dataType":"Text","value":"UpperBound","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"AdjustmentTypeAmount","description":"AdjustmentTypeAmount","type":"Constant","dataType":"Text","value":"Amount","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"DDS_NetUnitPrice","description":"DDS_NetUnitPrice","type":"Constant","dataType":"Text","value":"NetUnitPrice","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"HeaderPercentage","description":"HeaderPercentage","type":"Constant","dataType":"Text","value":"Percentage","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"HeaderAmount","description":"HeaderAmount","type":"Constant","dataType":"Text","value":"Amount","input":false,"output":false,"collection":false,"decimalPlaces":2},
              {"name":"HeaderPriceOverride","description":"HeaderPriceOverride","type":"Constant","dataType":"Text","value":"Override","input":false,"output":false,"collection":false,"decimalPlaces":2}
      ]
    }
  ]
}
```
- **Placeholders:**
  - `<ID:context-definition-id>`: the Act 6 `<CONTEXT_DEF>` Id (6.8 read-back).
  - `<ID:price-book-entry-decision-table-id>`, `<ID:volume-discount-decision-table-id>`, `<ID:tiered-adjustment-decision-table-id>`: the three Ids recorded in 7.12.
  - `<ID:sched1-id>` / `<ID:sched2-id>`: the `sched1` (Range) and `sched2` (Slab) schedule Ids from 7.10.
  - `<PROC_START_ISO>`: current UTC at the call, ISO 8601 (`YYYY-MM-DDThh:mm:ss.000Z`), recorded in the manifest. It must be later than the context definition's `startDate` (6.6); an earlier date is rejected.
  - `<PRICE_FLOOR.value>` / `<PRICE_FLOOR.productCode>`: from `<PRICE_FLOOR>`.
- **`PRICE_FLOOR` = `none`:** delete the last three steps (`PremiumFloorGroup`, `PremiumFloorFilter`, `PremiumFloor`). The result has 17 steps; the 15 variables stay (the floor is an inline literal). The floor runs after the header spread, so it also caps header discounts on the floor product: include the floor product in one header case at 7.14 and expect `MAX(result, floor)`; any other result is a 7.13 defect (do not activate). With more than one floor product, add one `ItemProductCode Equals` criterion per product to `PremiumFloorFilter`, join them with `OR`, and include each in the 7.14 floor case `(unverified — fallback: use one floor product and record the others as not applied)`.
- **`MANUAL_DISCOUNT_SCOPE`:** the graph applies line discounts on every line. For a listed subset, wrap each of the two line-discount steps in a `ListGroup` whose `AdvancedListFilter` has one `ItemProductCode Equals` criterion per listed product joined with `OR`; at 7.14 add one manual-discount case on a listed product (expect the discount) and one on an unlisted product (expect none). Keep both line-discount steps even when only one discount type is allowed; a step with empty input changes nothing `(unverified for a subset — fallback: if the wrapped graph is rejected or a scope case fails, stop BLOCKED_PRICING_PROCEDURE with the response)`.
- **How the graph works:**
  - Every pricing step reads and overwrites `NetUnitPrice`. The `ListPrice` step's output parameter is *named* `ListPrice` but writes to `NetUnitPrice`; never use the shipped `ListPrice → ListPrice` mapping, or `NetUnitPrice` stays null. The line's `ListPrice` tag (used by the override reset and the Proportionate spread) comes from the quote line.
  - Inside each `ListGroup`, child steps restart `sequenceNumber` at 1 and point back with `parentStep`.
  - Both tier steps pass `CurrencyIsoCode`: both decision tables match on currency, so without it a multi-currency org finds no tier.
  - **Line discounts:** `PercentagebasedManualdiscount` applies `ItemDiscountPercentage`, `AmountbasedManualdiscount` applies `ItemDiscountAmount` (per unit, not per line); an empty value changes nothing; a line with both gets the percentage first, then the amount.
  - **Header adjustments:** the three header groups are exclusive (each filter requires its own header field and the other two empty). Each copies the header value and a constant type (`Percentage`, `Amount`, `Override`) into `HeaderAdjustmentValue__std`/`HeaderAdjustmentType__std`; `DiscountDistributionService` spreads it over the lines using `AdjustmentDistributionLogic__std`. With no header adjustment it changes nothing.
  - **Total price override:** `ResetToListForOverride` resets each line's `NetUnitPrice` to list before the spread, so the override replaces the tier and line discounts and the quote lands exactly on the target (computed from the header `Subtotal`, the list-based subtotal on a real quote). Use **Proportionate** for an override: Equal can push a low-priced line below zero. Equal is acceptable for a header amount adjustment.
  - The 15 variables are all `Constant`/`Text`: seven hold decision-table column names, two hold the schedule Ids, five hold adjustment-type values (`AdjustmentTypePercentage`/`AdjustmentTypeAmount`, `HeaderPercentage`/`HeaderAmount`/`HeaderPriceOverride`), and `DDS_NetUnitPrice` names the spread input.
- **Reference values** (a line listed at 10.00 whose quantity falls in a 5 % volume band, so the tier price is 9.50; if the customer's prices differ, recompute with the same step order):
  - Simulation, line discounts: 10 % line discount 9.50 → 8.55; 1.00 amount discount 9.50 → 8.50; both set → 7.55.
  - Simulation, header: header amount 5 with Equal over two lines → −2.50 per line; total price override 80 with Proportionate → the lines sum to exactly 80.00, also with a line percentage and amount discount.
  - Web, Draft quote: Manage Header Adjustment Percentage 10 % → list 10.00 → volume 5 % −0.50 → header 10 % −0.95 → net 8.55, and Calculation Details shows a Header Adjustment row. The same action on a Submitted quote returns "Error updating Quote" (Submitted locks edits): expected. Check the Draft case on the first web quote in Act 8.
- **Never send:** the definition `id`, `resourceInitializationType` (read-only; the GET returns `"Off"` and sending it back fails), or `versions[].id`. Steps and variables have no Ids. `rank: null` is expected at creation; 7.15 sets it.
- **Changing the graph later** (any re-run that finds an active version): never edit the active version. Add a new version with `PATCH …/expression-set/<ID:expression-set-definition-id>` and a `versions` entry with the next `versionNumber` (new version only; an entry with an existing version `id` updates that version). Simulate (7.14), then rank and activate (7.15) before deactivating the old one.
- Do **NOT** add a `CurrencyOutputRounding`/`RoundingValues` step: it activates cleanly on the server, but the iPad rejects it with "Unhandled pricing procedure steps: RoundingValuesCurrencyOutputRounding" the first time a rep saves a quantity change → FP-7.10.
- Use the `ContextTag` name of a field in every binding and in simulation input, never its attribute `Title` or object field name → FP-7.6.
- If you round-trip a step body from a GET into a PATCH, replace HTML-entity quotes (`&quot;`) with `"` first → FP-7.9.

**7.14 Simulation call**

```json
PATCH /services/data/v<API_VER>/connect/omnistudio/evaluation-services/version-definitions/<ID:version-definition-id>/simulation?shouldSaveSimulationInput=false
{
  "input": {"variables": []},
  "config": {
    "versionInfo": {
      "configurationVersionId": "<ID:pricing-procedure-version-id>",
      "effectiveDate": "<PROC_START_ISO>"
    }
  },
  "contextInput": {
    "name": "<CONTEXT_DEF>",
    "value": {
      "SalesTransaction": [{
        "PriceBooks": "<ID:pricebook-id>",
        "CurrencyIsoCode": "<CORP_CCY>",
        "AppliedDiscount__std": null,
        "AppliedDiscountAmount__std": null,
        "TotalPriceOverride__std": null,
        "AdjustmentDistributionLogic__std": null,
        "SalesTransactionItem": [
          {"LineItem": "<LINE_KEY_1>", "Product": "<ID:product-id>", "ProductSellingModel": "<ID:psm-id>", "LineItemQuantity": <TEST_QTY>, "ItemProductCode": "<PRODUCT_n.code>", "ItemDiscountPercentage": null, "ItemDiscountAmount": null}
        ]
      }]
    },
    "contextMappingId": "<ID:salestransaction-mapping-id>"
  }
}
```
- **Two Ids, not one:** `configurationVersionId` = the 7.13 version Id (`9QM…`). `<ID:version-definition-id>` in the URL = the same Id with its first three characters replaced by `0k1`. Confirm with `GET /services/data/v<API_VER>/connect/omnistudio/evaluation-services/version-definitions/<ID:version-definition-id>`: it must return the 7.13 `versionNumber`, `enabled` false and the 7.13 top-level step names (under `step.details`, not `steps`); if not, stop `BLOCKED_SIMULATION_ID` and report the GET response. 7.15 activates through the same URL Id.
- `contextMappingId` = the Id of the `SalesTransaction` mapping of `<CONTEXT_DEF>` (6.7 GET), passed explicitly; the default mapping stays `QuoteEntitiesMapping`.
- One `SalesTransactionItem` per test line. `<LINE_KEY_n>` is any unique 18-character key that starts with `0QL` (the `QuoteLineItem` prefix) and ends with `GAA`, zeros and the 3-digit line number in between; it need not exist. Set each line's discount fields per its case and `null` when unused. Header fields (`AppliedDiscount__std` = header %, `AppliedDiscountAmount__std` = header amount, `TotalPriceOverride__std` = target total, `AdjustmentDistributionLogic__std` = `Proportionate` or `Equal`) sit on the `SalesTransaction` entry; leave them `null` except in header cases. For an override case also send the header `Subtotal` (sum of list price × quantity) and each line's `ListPrice`: a real quote carries both, the simulation does not fill them.
- `input.variables` stays empty: every input comes through `contextInput`. The body is unwrapped (`input`/`config`/`contextInput` top-level, no `simulationInput` wrapper, else `JSON_PARSER_ERROR`); `shouldSaveSimulationInput` is a query-string parameter, never a body field.
- **Response:** final prices are at `simulationResults[0].contextValue.SalesTransaction[0].SalesTransactionItem[].NetUnitPrice` (and `.ItemNetTotalPrice`), matched to lines by `LineItem`; the top-level `output` carries no prices. The per-step trace is `additionalOutputData.pricingWaterfall[]` (one entry per line); each line's `price_water_fall` string has `&quot;` in place of quotes, so HTML-unescape it before parsing. Lines without a discount still show zero-value discount elements: judge by `NetUnitPrice`, not trace shape.
- **Test cases (`<TEST_QTY>`).** For each `<PRICING_TIERS>` entry, simulate its `productCode` once per band at the band's lower bound, plus one product with no tier. Add one manual-discount case on a product inside `<MANUAL_DISCOUNT_SCOPE>`: 10 (%) if percentage is allowed, otherwise 1 unit of `<CORP_CCY>` per unit. When both types are allowed, add one amount-only case and one line with both set (expected: percentage, then amount). Then header cases, each its own call: header 10 % Proportionate; header amount Equal; and a total price override Proportionate with a target below the list subtotal, once with no line discounts and once with a line percentage and a line amount. When `<PRICE_FLOOR>` is set, add one floor-product line priced below the floor and one non-floor line in the same call. Send every other case as one line of a single simulation call. Record every product, quantity, discount and result in the manifest; Acts 13 and 15 reuse them.
- **Expected `NetUnitPrice`** (step order: list price → tier → line percentage → line amount → header adjustment → floor). Range: list price × (1 − band %), the band being the one the whole quantity falls in. Slab: each band's units at list price × (1 − that band's %), summed and divided by the quantity. Line percentage: × (1 − %). Line amount: − amount per unit. Header %: every line × (1 − %). Header amount Equal: split evenly across the lines, then per unit. Override Proportionate: the sum of `ItemNetTotalPrice` equals the target exactly, whatever the line discounts, each line's share in proportion to its list price. Floor (if set): `MAX(result, <FLOOR_VALUE>)`. A mismatch is a 7.13 defect: do not activate.
- There is no true zero-persistence dry run: `shouldSaveSimulationInput=false` suppresses the obvious save, but telemetry or post-hook side effects are not guaranteed absent. Read it as "no intentional persistence".

**7.16 Permission set and Sales Transaction Type**

File `force-app/main/default/permissionsets/<PFX>STT_Procedure_Link.permissionset-meta.xml` (`<PFX_LABEL>` as in the label rule of the Runtime input schema):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label><PFX_LABEL> STT Procedure Link</label>
    <hasActivationRequired>false</hasActivationRequired>
    <fieldPermissions><editable>true</editable><field>SalesTransactionType.Description</field><readable>true</readable></fieldPermissions>
    <fieldPermissions><editable>true</editable><field>SalesTransactionType.PricingProcedureId</field><readable>true</readable></fieldPermissions>
    <objectPermissions><allowCreate>false</allowCreate><allowDelete>false</allowDelete><allowEdit>true</allowEdit><allowRead>true</allowRead><modifyAllRecords>false</modifyAllRecords><object>SalesTransactionType</object><viewAllRecords>false</viewAllRecords></objectPermissions>
</PermissionSet>
```
`package.xml` next to `force-app`: one `PermissionSet` type with member `<PFX>STT_Procedure_Link`, `version` = `<API_VER>` without the `v`. Deploy with `sf project deploy start --manifest package.xml --wait 10 --json`, assign with `POST sobjects/PermissionSetAssignment` `{"AssigneeId":"<ADMIN_USER id>","PermissionSetId":"<ID:STT_Procedure_Link>"}`. Read / Edit only; no Create, Delete, View All or Modify All.
```json
{"Name":"<STT_NAME>","CurrencyIsoCode":"<CORP_CCY>","PricingProcedureId":"<ID:expression-set-definition-id>"}
```
- `CurrencyIsoCode` only on multi-currency orgs; there is no `IsActive` field: never send it. `PricingProcedureId` is the `ExpressionSetDefinition` Id (`9QA`, 7.13) of `<PRICING_PROCEDURE>`.
- The platform auto-creates the matching Permission Set License assignment when `RevLifecycleManagementCalculatePricesApi` is assigned; an explicit `PermissionSetLicenseAssign` POST for the same user and license causes a duplicate-value conflict (FP-7.11).
- With two Sales Transaction Types on one procedure, the one a Quote uses is not predictable. Keep exactly one STT per active procedure.

**7.17 Revenue Settings default procedure**
- One selection only; it saves on selection, so there is no Save step. Clearing the selector **deletes** the org value: never save Revenue Settings without the procedure selected.
- The selector validates that the procedure uses the context definition from 6.6–6.8. If `<PRICING_PROCEDURE>` is not offered, check that 7.15 activated it and that 6.8 is active.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Catalog | `<CATALOG>` with `<CATEGORY_n>` categories, `<PRODUCT_n>` products, selling models/options, category membership all present | `ProductCatalog`/`ProductCategory`/`Product2` list views | 7.1-7.5 postconditions |
| Price books | Standard PBE active per product; `<PRICEBOOK_n>` price books with entries per `<ACTIVE_CCYS>` | `Pricebook2`/`PricebookEntry` records | 7.6 postcondition; field-rep-user query (or admin-side check) for visibility |
| Territory & sharing | PTA/PTDA present for `<TERRITORY>`; catalog and PTA shared with `<FIELD_REP_USER>` | `ProductTerritoryAvailability`; Share list views | 7.7, 7.8 |
| Pricing schedules | Both schedules active with full tier sets, **every schedule and tier dated**, decision tables refreshed after the dates. Act 10 must regenerate the mobile metadata and the device must sync before Act 13 prices on the iPad | `PriceAdjustmentSchedule`/`Tier` records | 7.10-7.12a |
| Pricing procedure | Exactly one `<PRICING_PROCEDURE>` version active, rank 1, no rounding step, recipe active and pointing at it | `ExpressionSetVersion` GET; `PricingRecipe` | 7.13-7.15; 7.14 simulation |
| Routing | `<STT_NAME>` linked to the active procedure through `<PFX>STT_Procedure_Link` (assigned to `<ADMIN_USER>` only); org-default selector set; Field Rep has STT Read + View All | `SalesTransactionType`; Revenue Settings; Permission Sets | 7.16, 7.16a, 7.17, 7.17a |
| Header adjustments | Header Adjustments on (`enableRevenueAdjustment` = `true`) | `Settings:RevenueManagement` retrieve | 7.17b |
| Product Configurator (only if 7.17c ran) | `enableProductConfigurator` = `true` | Deploy `Succeeded` and the `Settings:ProductConfigurator` re-retrieve; the redone 7.18 Save As succeeded | 7.17c |
| Browse Catalog | Flow deployed and Active; Product Discovery points at it (no catalog binding; the rep selects `<CATALOG>` on Select Catalog). On-screen check is 8.33 | `FlowDefinition` + `ProductDiscovery.settings` read-back | 7.18 |
| Acceptance | Final refresh + simulation returns the expected priced result | Simulation response | 7.20 |
| **Open cross-Act dependency** | Mobile pricing files will NOT populate from Act 10's generation step until Act 8 ALSO sets the profile-scoped `OrderProductViewsSettings.PricingProcedure` record | Act 8 / Act 10 | Flagged here, resolved there |

### Checkpoint 7

Report: status `PASSED`, or `PASSED_WITH_NOTES` only with a `KNOWN_LIMITATION` tag (`PRODUCT_n.UoM` not applied). An unlinked STT is never a note: it stops at 7.16 or 7.17a. Admin-side checks used under `RUN_REP_CLI_CHECK = no` and multi-currency price book counts are listed in the report without changing the status; the cross-Act dependency on Act 8's profile-scoped selector is flagged. Known outcome: PSM is one shared OneTime model. Changed: 1 catalog, `<CATEGORY_n>` categories, `<PRODUCT_n>` products + selling models/options, `<PRICEBOOK_n>` price books + entries, territory availability + shares, 2 pricing schedules + dated tiers, 1 pricing-procedure version (20 steps/15 variables; 17/15 with no price floor) + activation, 1 permission set (`<PFX>STT_Procedure_Link`) + 1 Sales Transaction Type, 1 Revenue Settings selector, 1 Product Configurator setting (only if 7.17c ran), 1 Browse Catalog flow deploy. Reused: Act 6's context definition and recipe shell (now linked). Where to see it: `ProductCatalog`/`Pricebook2`/`ExpressionSetVersion`/`SalesTransactionType` list views; Browse Catalog UI. Open items: Act 8's profile-scoped pricing selector; Act 8's Quote Settings → TPT binding. Actual duration: record at run time.

**Act 7 is complete. Ready to continue to Act 8: Quote web configuration?**
## Act 8 — Quote web configuration

**Purpose.** Give the Account route a working web Quote: a dedicated record type, a create layout matching the shipped Create-New-Quote form, a routable/visible Quote tab, pricing/STT/FLS wiring so a field rep can create and price a Quote, a 5-stage lifecycle (Draft → Submitted, plus the gated unlock branch that Act 14 exercises), and Document Builder/PDF/disclaimer config — all verified with a web Draft-Quote smoke test before the mobile Acts build on top of it.
**Estimated duration:** about 90–120 agent minutes (allow more when an API-first route falls back) + 20–40 human minutes (inputs step, the 8.9b, 8.16a and 8.30–8.33a web checks, about 10–20 min, plus consent items answered `ask`; about 20 more human minutes if `PLAYWRIGHT_AVAILABLE = no`, because the Admin Console save in 8.29 and the 8.24 recovery are UI-only, and 8.10, 8.14, 8.34 and 8.23 need a browser or a person only if their API-first route fails).
**Depends on:** Act 2 (package install, admin access), Act 3 (post-install settings), Act 4 (`<FIELD_REP_PROFILE>`/`<FIELD_REP_PS>`; the rep's `ManagerId` = `<MANAGER_USER>` from 4.8), Act 5 (`<TERRITORY>`, reused in 8.21c), Act 6 (Order Management Turn On; `<CONTEXT_DEF>` active), Act 7 (`<PRICING_PROCEDURE>` active, `<STT_NAME>`, `<PFX>STT_Procedure_Link` from 7.16, Revenue Settings default, `<CATALOG>`, `<PRICEBOOK_n>`). `<ASSORTMENT>` and `<PRIORITY_PRODUCTS>` are built in 9.12 and are needed only at runtime on the device.

**Execution order inside this Act (the table keeps its numbers; this is the order to run them).** `8.in` → **8.16** (the Status values must exist before the record type can list them) → 8.1–8.9a + 8.13 (one bundled deploy; 8.13 is part of it and is read back before 8.17) → 8.9b (app alone) → 8.9c (Quote object alone) → 8.10–8.12, 8.14, 8.15 (8.11a must pass before 8.30) → 8.16a → 8.17 → 8.18–8.21 (8.21a–8.21c) → 8.22 → 8.23 → **8.25 before 8.24** (the deploying admin needs Document Builder entitlement or the flow validation fails) → 8.26–8.29 → 8.30a → 8.30b (only if `SMOKE_AS_REP = no`, after 6.5b) → 8.30–8.33 (8.33a with 8.33) → 8.34, then 8.34a after 9.5 (the Store_Check record type exists). A pending human fix at 8.24 does not block 8.30a–8.33a (Appendix A, O2). Nothing is renumbered; new steps are sub-numbers (8.2a, 8.9a, 8.9b, 8.9c, 8.10a, 8.10b, 8.11a, 8.16a, 8.21a, 8.21b, 8.21c, 8.24a, 8.30a, 8.30b, 8.33a, 8.34a).

**Thread assets this Act deploys (embedded in [Appendix B](#appendix-b--act-8-asset-files), which lists each file, its step and the substitution):** six files — `LSC_Quote_Lock_and_Unlock_Approval_Process.flow-meta.xml`, `LSC_Quote_Notifications_for_Lock_and_Unlock.flow-meta.xml`, `LSC_Quote_Set_Status_In_Review.flow-meta.xml`, `Notification_when_Quote_is_locked_and_Unlocked.notiftype-meta.xml`, `lsc4ce_Quote_Document.flexipage-meta.xml` and `Generate_Quote_Flow.flow-meta.xml`. The flows are `Draft`. Only the approval flow carries a placeholder: `<NOTIFY_ADMIN_USER>` in 3 places, replaced in the deploy copy at 8.21a. **Pre-check (before 8.21a and before 8.24):** if `<run>/artifacts/a08/` does not hold all six files, run the Appendix B extraction script (save it from the appendix to `<run>/artifacts/a08-extract.py`, then `python3 <run>/artifacts/a08-extract.py "<thread file>" <run>/artifacts/a08`). It copies each file byte for byte and checks its SHA-256. If it exits with `ASSETS_MISSING`, stop and report — do not retype, repair or hand-write the files. The smaller payloads (lifecycle graph, value sets, overrides) are inline in Step details below.

### Story

Two decisions carry weight. The Act 4 Quote Create exposure (`AppUsageAssignment`) had no consent stop and is first exercised here, so the Act 8 summary restates it (org-wide Create/Read with no row-level isolation: an accepted tradeoff, not a bug). The 5-stage lifecycle (Draft → Submitted → Request for Unlock → In Review → Rejected) is built in two parts: Draft → Submitted first, then the unlock branch and its approval flows behind a stop (C9); the branch is exercised once in Act 14.

Three items are irreversible or human-gated: activating the `StagePathPermissionsHandler` trigger (org-wide; Tooling write, Admin Console toggle as fallback), the unlock-route approval flows (C9), and the Admin Console-only save of `QuoteDocumentSettings` (8.29). Three categories absent from a fresh org (`OrderProductViewsSettings` 8.10, `QuoteSettings` 8.14, `QuickAction` 8.34) are first deployed with their record, with the Admin Console save as fallback. This Act does **not** tap Submit: the stage-path Submit is a plain status update that skips Review Order and signature; the signed path is proven in Act 14.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Set up the web Quote." 🤖 Agent: confirms the bundled-deploy scope first *(P1)*. "The Quote tab is missing": app membership and tab visibility differ, so it adds `tabSettings` and re-verifies *(P5)*. | Bundled deploy (`sf project deploy start --manifest … --wait 30 --json`); `PermissionSet.tabSettings` (8.6) | `Pricebook2Id` cannot go on the layout; it is set post-Save via Browse Catalogs (8.2). Tab visibility is per surface and not inherited. |
| 🧑‍💼 Admin: "Activate the Submit trigger handler; build the full lifecycle." 🤖 Agent: stops first (org-wide, reversible by `IsActive=false`, not in the Setup Audit Trail), builds Draft→Submitted and stops before the unlock-branch data *(P4, C8, C9)*. | Tooling `LifeScienceTriggerHandler`; `LifeSciStage*` graph (data) | The Admin Console switch ignores automated clicks (8.17). Unlock flows deploy from the Appendix B assets (8.21a–8.21c); Approve needs 8.21a or K24. The approver needs a territory assignment. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 8.in | Ask this Act's inputs: `ASSORTMENT`, `PRIORITY_PRODUCTS`, `DISCLAIMER_TEXT` / `DISCLAIMER_COUNTRY`, `DISCLAIMER_ACCOUNT_SUBSTITUTION`, `QUOTE_STAGES`, `LAST_ORDER_STATUS`, `QUOTE_FROM_VISIT_SCOPE` (not asked: `NOTIFY_ADMIN_USER` defaults to `<ADMIN_USER>`, the admin running this thread; `SMOKE_AS_REP` and consent C12 are asked just in time at 8.30a) | n/a | 👤 HUMAN — list each key still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Record `NOTIFY_ADMIN_USER = <ADMIN_USER>` (`accepted recommendation`), the user the approval flow's background steps run as (8.21a). Validate (for `NOTIFY_ADMIN_USER`: `SELECT Id FROM User WHERE Username = '<value>' AND IsActive = true AND Profile.Name = 'System Administrator'` returns 1 row; 0 rows because the user is on a cloned admin profile → accept it only if `SELECT Id FROM Profile WHERE Id = '<its ProfileId>' AND PermissionsModifyAllData = true` returns 1 row (unverified — fallback: name another user on the standard System Administrator profile, else ⏸ STOP)), then write to the frozen copy and the manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING` | Keys already filled are not asked again; if none are missing, the step passes with no stop | — |
| 8.16 | Status values for the lifecycle (value set only) | `StandardValueSet` `QuoteStatus` | Metadata API, **first deploy of the Act, value set only** (the record type does not exist yet; its `Status` picklist is set in the 8.1 deploy): retrieve the set, add `Submitted` and `Request for Unlock` **if missing**, keep the shipped `In Review` and `Rejected` and the generic values `Needs Review`, `Approved`, `Presented`, `Accepted`, `Denied` (a value set cannot drop shipped values; 8.16a inactivates the generic ones), and order the values so the five `QUOTE_STAGES` come first in `QUOTE_STAGES` order (default Draft → Submitted → Request for Unlock → In Review → Rejected). Deploy with explicit file paths, not component names alone (FP-8.31). Fragment in Step details 8.16 | Retrieved `QuoteStatus` lists the five stage values first, in order, with `Draft` as default; `Submitted` and `Request for Unlock` are present. A deploy that reads back the old values → FP-8.31 | Diff StandardValueSet XML → reuse; else redeploy | FP-8.12, FP-8.31 |
| 8.1 | Quote record type | `RecordType` `Quote.Quote_Record_Type` | Metadata API, bundled with 8.2–8.9a and 8.13, **after 8.16**. The record type's `Status` picklist lists exactly the five `QUOTE_STAGES` values (Draft default; fragment in Step details 8.16): a value not listed does not appear for the rep, and listed values all show on the Stage Path (8.16a) | `SELECT Id FROM RecordType WHERE SObjectType='Quote' AND DeveloperName='Quote_Record_Type'` returns 1 row; the retrieved record type lists exactly the five lifecycle values | Query by DeveloperName → reuse; else include in deploy | FP-8.1 |
| 8.2 | Quote create/edit layout | `Layout` `Quote-Quote Layout` | Metadata API, same deploy. Retrieve the shipped layout, edit it, and redeploy it **together with its mini layout** (the shipped mini layout references Opportunity, which the new field list removes; the mini layout fields must stay a subset of the full layout). Field list in Step details 8.2 | Layout retrieve shows `QuoteAccountId`, `Name`, `Status` (Readonly), `RecordTypeId`, `SalesTransactionTypeId` (`<STT_NAME>`), `StartDate`, `ExpirationDate`, `Description`, `VisitId` (Edit), Address Information section; mini layout = `Name`, `ExpirationDate`, `Status`; **no** `Pricebook2Id` | Diff retrieved layout XML → reuse if match; else redeploy | FP-8.2 |
| 8.2a | (Optional, cosmetic) Trim the Quote Line Items related list on the Quote layout | `Layout` `Quote-Quote Layout` (related list `QuoteLineItems`) | Metadata API, same deploy as 8.2 (layout and mini layout stay together). Set the related list columns to Product, Quantity, List Price, Discount, Subtotal, Net Total Price, Net Unit Price (7 columns; the shipped list has 16). **This only changes the Related tab**; the iPad cart and web line grid columns come from `displayFields` (8.9). `Additional Free Item Quantity` cannot be added to this related list (every metadata token is rejected as "Invalid field"); 8.9 delivers that column | Retrieved layout shows the 7 related-list columns | Diff layout XML → reuse; else redeploy | FP-8.2 |
| 8.3 | Field-rep profile: record-type visibility + layout assignment | `Profile` `<FIELD_REP_PROFILE>` | Metadata API, same deploy (`recordTypeVisibilities`, `layoutAssignments` for Quote, and `<layoutAssignments><layout>Pricebook2-Price Book Layout</layout></layoutAssignments>` for Price Book: without it the rep's Add Products price book lookup shows None and typeahead lists nothing, FP-8.34); retrieve-and-merge (Deploy safety rule) | Profile XML shows `Quote.Quote_Record_Type` visible+default and a `Pricebook2-Price Book Layout` layout assignment | Diff profile XML → reuse; else redeploy | FP-8.1 |
| 8.4 | Account layout assignment fix (same profile) — **re-check of 4.2, normally no new change** | `Profile` `<FIELD_REP_PROFILE>` | Metadata API, same deploy (`layoutAssignments` for Account: default + Business Account RT). 4.2 already sets these; keep them unchanged in the bundled profile file so this deploy does not remove them | Creating/opening any Account record type no longer throws "Layout contains no sections!"; the retrieved profile still carries the 4.2 Account `layoutAssignments` (retrieve with the 4.2 manifest rule: Layout and RecordType members listed too) | Diff profile XML → reuse (expected: `reused` from 4.2); else redeploy | FP-8.3 |
| 8.5 | Add Quote tab to the commercial app | `CustomApplication` `lsc4ce__lifeSciencesCommercial` | Metadata API, same deploy (`<subscriberTabs>standard-Quote</subscriberTabs>`; the managed `<tabs>` list cannot be edited) | App metadata lists `standard-Quote` under `subscriberTabs` | Diff app XML → reuse; else redeploy | FP-8.4, FP-9.1 |
| 8.6 | Grant Quote + Account(filtered) tab visibility | `PermissionSet` `<FIELD_REP_PS>` | Metadata API, same deploy (`tabSettings` — the PermissionSet element; `tabVisibilities` belongs to Profile and is rejected here) | With a rep session (`RUN_REP_CLI_CHECK = yes`): `GET /services/data/v<API_VER>/tabs` for the field rep shows `standard-Quote` and `lsc4ce__AccountFilter` as `Visible`. **Substitute when there is no rep session:** `SELECT Parent.Name, Name, Visibility FROM PermissionSetTabSetting WHERE Name IN ('standard-Quote','lsc4ce__AccountFilter') AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '<ID:FIELD_REP_USER>')` returns both tabs with `Visibility = DefaultOn` | Diff permset XML → reuse; else redeploy | FP-8.4 |
| 8.7 | Fix FlexiPage template (unblocks header region) | `FlexiPage` `LifeScience_Quote_Record` | Metadata API, same deploy — change `template` to `flexipage:recordHomeSingleColTemplateDesktop`. Use a standard deploy: check-only validation and quick-deploy fail in an org with no custom Apex (`CannotQuickDeployError`, FP-8.26) | Retrieved FlexiPage shows the new template; web Quote record page still renders. **Deploying the page does not show it to anyone — it is assigned in 8.9b** | Diff FlexiPage XML template element → reuse; else redeploy | FP-8.5, FP-8.26 |
| 8.8 | Add Highlights Panel + Stage Path container to header | `FlexiPage` `LifeScience_Quote_Record` | Metadata API, same deploy — header region: `force:highlightsPanel` first (**no `visibilityRule`**: a rule with only a `booleanFilter` is rejected, "A rule must have at least one filter"), `lsc4ce:LifeSciStagePathContainer` second | Browse Catalogs/layout actions render on the record page once the page is assigned (8.9b); Stage Path renders the lifecycle stages | Diff FlexiPage XML components → reuse; else redeploy | FP-8.6 |
| 8.9 | Build the tabbed body (final state): Quote Line Items tab with the line table `displayFields` and the Quote Summary footer, Details, Related | `FlexiPage` `LifeScience_Quote_Record` | Metadata API, same deploy, **from an sfdx project whose `sourceApiVersion` is ≥ 65** (`displayFields` has `minAPI="65"`; from a 64.0 project the deploy fails "Invalid property [displayFields] in component [runtime_rca:salesTxnLineTable]" even with `--api-version 68.0`). Check first: `grep sourceApiVersion sfdx-project.json`. **Final page** (header 8.8; one `flexipage:tabset`, tabs **Quote Line Items** (active) \| **Details** \| **Related** \| **Approval** (8.9a)): *Quote Line Items* = `runtime_rca:salesTxnLineTable` with the 9 `displayFields` and `enableQuickAdd` / `enableSidepanel` = `true`, plus the `runtime_revenue_foundation:transactionSummary` footer under it. *Details* = **only** the Quote Information and Address Information field sections (the iPad edit form is built from Details; read-only or invisible fields render blank). On Quote Information set `Record.Status` `uiBehavior` to `readonly` (the retrieved page has `none`); change no other field's `uiBehavior`. The iPad create form then shows Status as read-only Draft, the default from 8.16, and Status changes only through the path and the 8.21 flows (FP-8.35). *Related* = the related-list container. One page serves web and iPad (both `Large`). XML in Step details 8.7–8.9. **Labels are plain text**, never a `@@@SFDC…@@@` token | Retrieved FlexiPage shows the 4 tabs in order with Quote Line Items active, the `displayFields` list with the 9 fields in order, both `enable…` properties true, the footer on the first tab and exactly 2 field sections on Details, with `Record.Status` `uiBehavior` = `readonly`. **Label check (retrieve the deployed page from the org, not the local copy):** `grep -c '@@@' <retrieved page> \|\| true` prints 0 (exit 1 on zero matches is expected; a count of 0 is the pass); any match → replace that label with plain text, redeploy, re-retrieve (FP-8.30); it must be 0 before 10.3. Rep on web: line grid and footer render. **Smoke expectation (8.30–8.32 run before 9.24):** the footer Grand Total and the Additional Free Item Quantity column are hidden until the 9.24 FLS; the full 9 columns and Grand Total are checked after 9.24. After Act 10, `ui.json` carries the same page (10.7) | Diff FlexiPage XML → reuse; else redeploy | FP-8.5, FP-8.6, FP-8.30 |
| 8.9a | Add the Approval tab (approval history + Work Guide) to the Quote record page | `FlexiPage` `LifeScience_Quote_Record` | Metadata API, same deploy as 8.7–8.9 — fourth tab (label `Approval`) whose body holds `runtime_approvals:approvalTrace` and `interaction_orchestrator:workGuide` (Work Guide label `Work Guide`), both with visibility rule `{!$Client.formFactor}` = `Large`. **The tab itself carries `{!$Client.formFactor}` EQUAL `Large` AND `{!$User.Profile.Name}` NE `<FIELD_REP_PROFILE>`**: the rep has no read access to approval objects, so the tab would be empty for the rep. Approving needs **both** components on the page. Fragment in Step details 8.9a | Retrieved FlexiPage lists both components on an Approval tab and the tab's visibility rule reads back with both criteria. **The rep sees no Approval tab on web or on the iPad**; the manager or admin sees it on web | Diff FlexiPage XML → reuse; else redeploy | FP-8.6 |
| 8.9b | Assign the Quote record page (activation) | `CustomApplication` `lsc4ce__lifeSciencesCommercial` (`profileActionOverrides`) | Metadata API, **app deployed alone**: retrieve the app first and merge (Deploy safety rule), then add one `profileActionOverrides` entry **for every profile that opens Quotes** — `<FIELD_REP_PROFILE>`, the approver's profile `<MANAGER_PROFILE>` (`SELECT Profile.Name FROM User WHERE Id = '<ID:MANAGER_USER>'`) and, if different, the profile of `<ADMIN_USER>` (System Administrator): `actionName=View`, `content=LifeScience_Quote_Record`, `formFactor=Large`, `pageOrSobjectType=Quote`, `recordType=Quote.Quote_Record_Type`, `type=Flexipage`, `profile=<the profile>`. **Do not add an app-level View override** (`actionOverrides`): the Metadata API accepts it but the platform does not persist it; the per-profile overrides are what take effect. A browser keeps the old page until a hard reload and a device until it syncs a new cache (10.8). Without this step the rep and approver get the system default Quote page (Status path with **Mark Status as Complete**, no Highlights actions, no Stage Path, no Approval tab) | Retrieve the app: one override per profile above with `content=LifeScience_Quote_Record`. Render check (👤 HUMAN, reported in 8.30 as the rep): Highlights actions (Browse Catalogs), Stage Path, Draft actions `Add Line Items` and `Submit` visible, Approval tab **not**. 👤 HUMAN right after 8.30: the person, as `<MANAGER_USER>` (Login-As per the Rep-session rule; if unavailable, at 14.14), opens `<PFX>Web_Quote_1` in the Life Sciences Commercial app and reports whether the Approval tab with the Work Guide is visible; if not, `PASSED_WITH_NOTES` and use the Approval Work Item fallback in Step details 8.21 | Retrieve app → override for that (profile, record type) present → reuse; else merge and redeploy | FP-8.5, FP-8.6 |
| 8.9c | Quote compact layout with Account for Quote (record header) | `CompactLayout` `Quote.<PFX>Quote_Compact`; `CustomObject` `Quote` (`compactLayoutAssignment`) | Metadata API, **retrieve first, deploy once, compare counts after.** (1) Retrieve `CustomObject:Quote`; save it as the rollback copy and write to the manifest its counts of `fields`, `actionOverrides`, `compactLayouts`, `listViews`. (2) Deploy copy = the retrieved file plus one `compactLayouts` entry `<PFX>Quote_Compact` with fields in this order `Name`, `QuoteNumber`, `ExpirationDate`, `IsSyncing`, `OpportunityId`, `QuoteAccountId`, `GrandTotal`, and `compactLayoutAssignment` changed from `SYSTEM` to `<PFX>Quote_Compact`; nothing else edited. (3) **Remove from the deploy copy the two Quote.object elements that fail a retrieve/deploy round trip:** the `IsLargeDeal` field entry (error "Could not resolve standard field's name") and the `CreateRampSchedule` `actionOverrides` with `type=Default` (error "not a standard action"; any number, record how many, N). **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** before removing either; if a retrieve does not contain them, nothing to remove. (4) Standard deploy, no check-only (FP-8.26). Why: iPad quotes set `QuoteAccountId` but not `AccountId` (derived from the Opportunity, not writable), so the default header's Account Name is blank; the iPad header shows the title plus the first 5 fields only | **Re-retrieve and compare with the manifest counts:** `compactLayoutAssignment` = `<PFX>Quote_Compact`; `compactLayouts` +1; `actionOverrides` = before (the N left-out `CreateRampSchedule` Defaults are platform defaults that reappear on retrieve, so the count does not drop and behaviour is unchanged); a diff of the retrieved object file against the rollback copy shows only the new compact layout and `compactLayoutAssignment`; `fields`, `listViews` unchanged (the `IsLargeDeal` help text is unchanged on describe). Any other difference → redeploy the rollback copy minus the same two elements, STOP and report. Quote record page and 8.9b overrides unchanged. On the device, after 10.8 regeneration, sync **and relaunch** (sync alone untested), the header shows Account for Quote with the store name (checked at 13.14). The 10.7 cache carries the assignment in `sobjects.json` (`"compactLayoutAssignment":"<PFX>Quote_Compact"` on `Quote`) and the layout in `ui.json` (proven from a test-org cache) | Retrieve → assignment already `<PFX>Quote_Compact` → reuse | FP-8.26 |
| 8.10 | Product Views + Last Order config | `LifeSciConfigRecord` (category `OrderProductViewsSettings`, profile-scoped) | **API first** (proven on a fresh org; fallback: the Admin Console route below): save a Tooling snapshot of `LifeSciConfigCategory` and of this category's records, field values and assignments in `<run>/artifacts/8.10-pre/`, then one Metadata-API ZIP deploy of the record (Step details 8.10) plus, only when Tooling shows no `OrderProductViewsSettings` category, the `LifeSciConfigCategory` itself (`category` and `DeveloperName` `OrderProductViewsSettings`, label `Quotes and Pricing Settings`, `type` `Hierarchical`), as 9.5 creates its category; then the read-back. Rejected (rolled back, nothing created) or read-back differs (the deployed record now shows in the Admin Console: correct it there; never delete it) → 🖱️ **Admin Console** (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): the category does not exist in a fresh org until the Admin Console saves a record in it, and a record-only ZIP deploy before that fails "no LifeSciConfigCategory named OrderProductViewsSettings found" (also with the namespace prefix). Click path in Step details 8.10. ZIP: package.xml at archive root; file name and member = the record's name `OrderProductViewsSettings_<ID:fieldRepProfile>` = its `masterLabel`, not a retrieved file name. After any 8.10 redeploy re-run 8.10a | Record readable via Tooling `LifeSciConfigRecord` + `LifeSciConfigFieldValue`; `ActiveProductViews` contains `ProductsFromPreviousOrder;StoreAssortment`, `EnablePriorityProductsTab=true`, `PricingProcedure` and `LastOrderStatus` set, waterfall statuses `Draft` / `Submitted`, retention `5`; Admin Console route: re-opening the page shows the same values. Prerequisite: 8.16 done (so `Submitted` is offered under Last Quote Status) and Product Views offers both Last Order and Store Assortment (FP-8.33 if not) | Tooling `SELECT Id, MasterLabel, IsActive FROM LifeSciConfigRecord WHERE MasterLabel = 'OrderProductViewsSettings_<ID:fieldRepProfile>'` → row found: reuse (compare values); 0 rows: also `WHERE MasterLabel LIKE 'OrderProductViewsSettings%' AND IsOrgLevel = false` and keep a row whose `LifeSciConfigAssignment.AssignedToId` is the rep profile; none → create On an org where `lsc4ce` was already installed, an existing record of this name not deployed by this run whose field values or assignees differ from the planned payload (including a value this step would blank) → ⏸ STOP in the P5 format with the diff; deploy over it only on the customer's yes, after saving the retrieved record under `org-changes/backup/` | FP-8.7, FP-8.14, FP-8.22, FP-8.33 |
| 8.10a | Give the System Administrator profile the same `OrderProductViewsSettings` (always run: the 8.30b and G4 admin fallbacks create quotes as `<ADMIN_USER>`) | `LifeSciConfigAssignment` (Tooling API) on the 8.10 `LifeSciConfigRecord`, assigned to the `System Administrator` profile | Tooling `POST /tooling/sobjects/LifeSciConfigAssignment` body `{"LifeSciConfigRecordId":"<ID:8.10 record>","AssignedToId":"<ID:System Administrator profile>","AssignmentLevel":"Profile"}` (first `sf sobject describe -s LifeSciConfigAssignment --use-tooling-api`: `AssignmentLevel` picklist must list `Profile` and `User`, else ⏸ STOP with the list; profile Id from `SELECT Id FROM Profile WHERE Name = 'System Administrator'`). Do **not** add `<assignments><assignedTo>Custom-System Administrator</assignedTo>` to the record XML (`assignedTo` fails for a standard profile). Read-backs use `AssignedToId`, not `AssignedTo`. Without this an admin Quote create fails "configure the transaction processing type and pricing procedure" | Admin New Quote → Save succeeds; the assignment row reads back for the System Administrator profile | Tooling `SELECT Id FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId = '<ID:8.10 record>' AND AssignedToId = '<ID:System Administrator profile>'` → row found: `reused`; else create | FP-8.7, FP-8.22 |
| 8.10b | Create the org-level `OrderProductViewsSettings` record | `LifeSciConfigRecord` `OrderProductViewsSettings_OrgLevel` (org level) | Metadata API ZIP (same format as 8.10), after 8.10 has registered the category. XML in Step details 8.10b | One org-level record, active, `PricingProcedure` = `<PRICING_PROCEDURE>`, both product views, Priority tab on, no assignments; the 8.10 profile record unchanged | Query by `MasterLabel` → `reused`; else create On an org where `lsc4ce` was already installed, an existing record of this name not deployed by this run whose field values or assignees differ from the planned payload (including a value this step would blank) → ⏸ STOP in the P5 format with the diff; deploy over it only on the customer's yes, after saving the retrieved record under `org-changes/backup/` | FP-8.7, FP-8.14, FP-10.3 |
| 8.11 | Confirm the single Sales Transaction Type from 7.16 | `SalesTransactionType` `<STT_NAME>` | Read-only SOQL for the count — do **not** create a second STT here. The link check and repair are 8.11a | Exactly one STT row (`SELECT COUNT() FROM SalesTransactionType`); where `PricingProcedureId` is readable (after 8.11a), it equals the `<PRICING_PROCEDURE>` Id (the LSC Quote hook resolves it with `LIMIT 1` and no ORDER BY) | One row → `reused`; zero → run 7.16; more than one → ⏸ STOP and show the duplicates | FP-8.8 |
| 8.11a | **Make the STT → pricing-procedure link visible (FLS permission set `<PFX>STT_Procedure_Link`) and set it — must pass before 8.30** | `PermissionSet` `<PFX>STT_Procedure_Link`; `SalesTransactionType.PricingProcedureId` | `PricingProcedureId` and `Description` are field-level-security fields: a fresh org has no `FieldPermissions` row for them, so describe and SOQL hide them (Tooling `FieldDefinition` lists them). With no link, every Quote save fails "the sales transaction type for this pricing procedure is missing" (whether or not the Quote's STT field is filled): the LSC save hook resolves the STT by `PricingProcedureId` = the `ExpressionSetDefinition` of `OrderProductViewsSettings.PricingProcedure` (8.10), `LIMIT 1`. **1. Check FLS (Check A below).** Not satisfied → 7.16 was not applied: deploy and assign the 7.16 permission set now (file and package.xml in Step details 7.16; a named step, not a deviation). **2.** Re-describe `SalesTransactionType` once: `PricingProcedureId` must be createable/updateable. **3.** If its value is null, REST `PATCH /sobjects/SalesTransactionType/<ID:STT>` `{"PricingProcedureId":"<ID:pricingProcedure>"}` (the `ExpressionSetDefinition` Id: `SELECT Id FROM ExpressionSetDefinition WHERE DeveloperName='<PRICING_PROCEDURE>'`, as in 7.13; never the `ExpressionSet` Id). Field still absent after step 2 → ⏸ STOP `STT_LINK_FIELD_HIDDEN` (never continue to 8.30 unlinked) | **Check A (FLS):** `SELECT Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = 'SalesTransactionType' AND Parent.Name = '<PFX>STT_Procedure_Link'` returns 2 rows (`SalesTransactionType.PricingProcedureId`, `SalesTransactionType.Description`), all true; and `SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = '<PFX>STT_Procedure_Link' AND AssigneeId = '<ID:ADMIN_USER>'` returns 1 row. **Check B (link):** `SELECT Id, Name, PricingProcedureId FROM SalesTransactionType` → one row, `PricingProcedureId` = the `<PRICING_PROCEDURE>` Id | Check A and B pass → skip | FP-8.8 |
| 8.12 | Grant Core CPQ user access | `PermissionSetAssignment` (CPQ-licensed permission set → `<FIELD_REP_USER>`) | **Already satisfied** by the rep's Quote-prices permission set assigned at 4.9a (it carries Core CPQ User, with one Revenue Lifecycle Management PSL). Check first; otherwise REST `POST /sobjects/PermissionSetAssignment` — assignment only; do **not** also POST the PermissionSetLicenseAssignment | `SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId = '<ID:FIELD_REP_USER>' AND PermissionSet.PermissionsCoreCPQUser = true` returns ≥ 1 row (there is **no** `User.PermissionsCoreCPQUser`); exactly one PSL assignment row | Query the join above → `reused`; else query (AssigneeId, PermissionSetId) → create | FP-8.9 |
| 8.13 | FLS for Quote fields the layout/actions need — **part of the 8.1–8.9a bundled deploy, read back before 8.17** | `PermissionSet` `<FIELD_REP_PS>` | Metadata API, bundled with 8.1–8.9a (`fieldPermissions`; retrieve-and-merge, the deploy replaces the whole set; write the retrieved `fieldPermissions` count to the manifest first): `SalesTransactionTypeId` Edit, `Status` Edit (layout stays Readonly by design), `BillingContactPointAddrId`/`ShippingContactPointAddrId` Edit, `VisitId` Edit (links a Quote to its Store Visit; needed by 8.34 and 9.9). XML in Step details 8.13 | Retrieved permset shows all five Edit=true and `fieldPermissions` count = the manifest count + the number of these five fields that were not already in the retrieved set (compare by field name; fewer → the merge dropped rows: redeploy from the retrieved copy). Not read back by 8.17 → do not activate the handler (its C8 precondition) | Diff permset XML → reuse; else redeploy | FP-8.10, FP-8.17 |
| 8.14 | Bind Quote record type to the mobile pricing TPT | `LifeSciConfigRecord` (category `QuoteSettings`, org-level: `QuoteSettings_OrgLevel`) | **API first** (fallback: the Admin Console route): snapshot as 8.10, then one ZIP deploy of `QuoteSettings_OrgLevel` (body in Step details 8.14; `isOrgLevel` true; `TransactionProcessingType` = `lsc4ce_pricing_mobile_tpt`, `QuoteRecordType` (MULTIPICKLIST, `longTextValue`) = `Quote_Record_Type`, `MaxQuoteLineItemsPerQuote` (INTEGER) with no value, the shape the Admin Console saves) plus, only when absent, the category `QuoteSettings` (label `Quote Settings`, `type` `Hierarchical`). Rejected or read-back differs → 🖱️ **Admin Console** (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`), same category rule as 8.10: Admin Console → Order Management → Quote Settings (org level) → **Quote Record Type** (dual listbox) = `Quote_Record_Type`, Transaction Processing Type = **TPT for LS4CE Mobile** (`lsc4ce_pricing_mobile_tpt`, the shipped one; the picker shows the label, not the developer name) → **move focus off the Transaction Processing Type field** (click a neutral area) → Save. The change commits on blur; a save without it silently does nothing. Before either route (API or UI), read the TPT: `SELECT DeveloperName FROM TransactionProcessingType WHERE DeveloperName = 'lsc4ce_pricing_mobile_tpt'` — expected 1 row (created by the Turn On; readable once 7.16 has run). 0 rows → confirm `<PFX>STT_Procedure_Link` is assigned to `<ADMIN_USER>` and the 6.5 Turn On completed, re-query every 30 s for up to 5 min; still 0 → ⏸ STOP `MOBILE_TPT_NOT_PROVISIONED` (do not clone a TPT). Row exists but the page does not list it → reload the page once | Record shows `QuoteRecordType = Quote_Record_Type` bound to the shipped TPT (not a clone), readable via Tooling `LifeSciConfigRecord`, and the re-opened page shows the saved values. One of the four selectors that must agree before mobile pricing files populate (7.17, 8.10, 8.10b, this binding); any one missing gives empty pricing files with no error (FP-10.3) | Query by masterLabel → reuse; else create On an org where `lsc4ce` was already installed, an existing record of this name not deployed by this run whose field values or assignees differ from the planned payload (including a value this step would blank) → ⏸ STOP in the P5 format with the diff; deploy over it only on the customer's yes, after saving the retrieved record under `org-changes/backup/` | FP-8.7, FP-8.22 |
| 8.15 | Complete field-rep Quote-create effective access | `PermissionSetAssignment` (Quote-Create+Core-CPQ-User+AUA-Create permission set → `<FIELD_REP_USER>`) | REST `POST /sobjects/PermissionSetAssignment`. **Already satisfied by 4.9a**; check first and skip when the assignment exists; otherwise **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first | Effective access shows Quote Create=true; **side effect:** also grants org-wide `AppUsageAssignment` Read with no row-level isolation (covered by C14) | Query by (AssigneeId, PermissionSetId) → reuse; else create | FP-8.11 |
| 8.16a | Restrict and order the Status path so it cannot bypass the lifecycle | `StandardValueSet` `QuoteStatus`; `PathAssistant` (if one exists for Quote); `FlexiPage` `LifeScience_Quote_Record` | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** before (2) and (3) (org-wide value-set change and Path deactivation). Before (2), `SELECT Status, COUNT(Id) FROM Quote GROUP BY Status`: any Quote using one of the five generic values → ⏸ STOP in the P5 format with the counts. After 8.9b and 8.16, by metadata read-back (no rep session exists yet: 8.30a is asked later): (1) the record type lists only the five stages (8.1); (2) redeploy `QuoteStatus` with the generic values `Needs Review`, `Approved`, `Presented`, `Accepted`, `Denied` set `isActive=false`; (3) Setup → Path Settings: if an active Path exists for Quote, deactivate it; (4) the assigned FlexiPage contains no standard path component. Why: with the generic values listed, the rep's path shows every Status, ticks stages never visited and offers **Mark Status as Complete**, which lets a user move `Status` by hand | **`PASSED`** only when all hold: the inactivation deploy succeeded (a retrieve no longer lists the five, since a retrieve omits inactive values; describe shows them inactive); **Mark Status as Complete** is not offered in the retrieved page or Path. The rep's web page showing exactly `Draft, Submitted, Request for Unlock, In Review, Rejected` in that order is reported by the person in 8.30 (👤 HUMAN Report back; Rep-session rule; the iPad the same after a sync); if that check fails, reopen 8.16a. **`PASSED_WITH_NOTES`** when the inactivation deploy is rejected (leave the values active, rely on the record type filter from 8.1, record the rejection text) or when **Mark Status as Complete** is still offered after (1)–(4) (`KNOWN_LIMITATION`: locked stages still refuse edits, so the residual manual hop is Draft-only) | Retrieve and compare; already correct → skip | FP-8.12 |
| 8.17 | ⏸ STOP (consent **C8**; precondition: 8.13 FLS read back and 8.16 values in place, handler inactive) — activate the Submit trigger handler | `LifeScienceTriggerHandler` `StagePathPermissionsHandler` (Object API Name `ALL`) | **Tooling API write (primary, unattended):** query the record Id, `PATCH /services/data/v<API_VER>/tooling/sobjects/LifeScienceTriggerHandler/<ID:handler>` body `{"IsActive":true}`, read back. **Record the before-values first:** write the query's `IsActive` and `LastModifiedDate` to the manifest. Anonymous Apex cannot do it. **Fallback (👤 HUMAN):** 🖱️ Admin Console → Trigger Handler Administration — the Active switch does not respond to Playwright, so the human clicks the row's Active switch once. Click path in Step details 8.17 | Tooling `SELECT Id, IsActive, LastModifiedDate FROM LifeScienceTriggerHandler WHERE DeveloperName = 'StagePathPermissionsHandler'` → one row, `IsActive=true`, `LastModifiedDate` later than the manifest before-value. The Admin Console grid then shows it active. Setup Audit Trail records nothing | Tooling read first; already `IsActive=true` → skip (it can already be active on a fresh org; the C8 STOP is then not reached) | FP-8.13 |
| 8.18 | Author the Draft→Submitted lifecycle graph | `LifeSciStageObject`/`LifeSciStagePath`/`LifeSciStageValue`/`LifeSciStageOperation`/`LifeSciStageAction`/`LifeSciStageOperationAction` (data) | **Required-field check first:** describe the six objects and confirm the body carries every field that is createable, not nillable and not defaulted — `LifeSciStageObject`: `Name`, `ObjectName`; `LifeSciStagePath`: `Name`, `LifeSciStageObjectId`, `FieldApiName`; `LifeSciStageValue`: `Name`, `LifeSciStagePathId`, `FieldValue`; `LifeSciStageOperation`: `Name`, `LifeSciStageValueId`, `Type`, `LifeSciStageObjectId`; `LifeSciStageAction`: `Name`, `LifeSciStageObjectId`, `Type`; `LifeSciStageOperationAction`: `Name`, `LifeSciStageOperationId`, `LifeSciStageActionId`, `DisplayOrder`. A missing field is added to the row, never dropped. **Every row also carries `SourceSystemIdentifier`**, set to its key in Step details 8.18 (*Stage record keys*). The schema marks the field optional, but it is the record's developer name: the Admin Console Workflow Paths editor loads, links, edits and deletes stage records by it. Then Composite `allOrNone=true`, one call, 14 rows (exact rows in Step details 8.18). Actions: Add Line Items, Submit, View Line Items, Generate PDF. No fresh org has lifecycle rows to reuse. Generate PDF uses a core component, not the 8.24 flow, and works on the iPad only (web shows "Unknown component", `KNOWN_LIMITATION` K23). The Submit action is a plain `RecordUpdate` of `Status`: the **unsigned** path; the signed path is the iPad cart Review Order (Act 14). This Act never taps Submit (G1, FP-8.28) | Read-back: stage object `Quote` (`IsControlledByStagePath=true`); one Active path `Quote Lock and Unlock` on `Status`, scoped to `Quote_Record_Type`; values Draft, Submitted; Draft operation open, Submitted locked; Draft actions Add Line Items (1), Submit (2); Submitted actions View Line Items (1), Generate PDF (2); every row's `SourceSystemIdentifier` equals its key (none empty). A Composite error naming a required field → add it per the check and rerun (allOrNone rolled everything back). The render check runs at 8.30–8.32 | Reuse the existing `Quote` stage object (by `ObjectName`). Query the path by `SourceSystemIdentifier` = `Quote_Quote_Record_Type`, then by Name **and** `StageObjectRecordTypeId=<ID:Quote_Record_Type>` → reuse it and backfill any empty key on its graph (*Stage record keys*); a path with that Name on another record type, or with a non-empty key that is not this skill's, is the customer's: leave it untouched and insert this thread's graph; else insert the graph | FP-8.14, FP-8.6, FP-8.28, FP-8.36 |
| 8.19 | Share the lifecycle actions **and the stage object** with the field rep | `LifeSciStageActionShare`, `LifeSciStageObjectShare` | Composite `allOrNone=true`, **five** `Read`/`Manual` rows: Add Line Items, Submit, View Line Items, Generate PDF (`LifeSciStageActionShare`) plus the `Quote` stage object (`LifeSciStageObjectShare`) — the stage object is Private; without its share the rep sees "We couldn't load the workflow path" | Five share rows exist for `<FIELD_REP_USER>` (the Request for Unlock share is created in 8.21, the disclaimer share in 8.28) | Query by (ParentId, UserOrGroupId) → reuse; else insert | FP-8.14 |
| 8.20 | ⏸ STOP — confirm before building the unlock branch (gate **G10**) | — | Consent **C9**: if pre-consented and the precondition passes (8.18 graph present, 8.19 shares present), record `pre-consented (C9)` and continue; otherwise 👤 HUMAN gives an explicit go-ahead live. The consent text states that the unlock route (Request for Unlock → manager approval → Draft or Rejected) is built here and first exercised in Act 14, and that `In Review` is a custom stage with no documented entry transition | Consent recorded before 8.21 proceeds | Gate, don't skip | FP-8.15 |
| 8.21 | Build the unlock branch — stage data: Request for Unlock action and stages, In Review and Rejected stages, and the action's share (gate **G10**) | `LifeSciStageAction` (`Request for Unlock`, Update Record → `Quote.Status = Request for Unlock`), `LifeSciStageValue`/`LifeSciStageOperation`/`LifeSciStageOperationAction` for Request for Unlock, In Review, Rejected; `LifeSciStageActionShare` | Composite `allOrNone=true`, extending the 8.18 path (Submitted operation gets the Request for Unlock action at display order 3) **plus a `Read`/`Manual` share of the new action to `<FIELD_REP_USER>` in the same call** (8.19 ran before the action existed). Same required-field check as 8.18, including `SourceSystemIdentifier` on every new stage row (keys in Step details 8.18, *Stage record keys*). The approval flows are 8.21a–8.21b, not a Flow Builder click path | Mobile and web Stage Path show all 5 stages; 3 new locked `WorkflowPath` operations at Priority 1; View Line Items linked to Request for Unlock and Rejected at order 1; the action is linked to Submitted at order 3 and shared to the rep; every new row's `SourceSystemIdentifier` equals its key. **Link read-back:** `SELECT SourceSystemIdentifier FROM LifeSciStageOperationAction WHERE SourceSystemIdentifier IN ('ContextAction_Quote_Draft_AddLineItems','ContextAction_Quote_Draft_Submit','ContextAction_Quote_Submitted_ViewLineItems','ContextAction_Quote_Submitted_GeneratePDF','ContextAction_Quote_Submitted_RequestForUnlock','ContextAction_Quote_RequestForUnlock_ViewLineItems','ContextAction_Quote_Rejected_ViewLineItems')` returns all 7 keys | Query stage rows by `SourceSystemIdentifier`, then by Name → reuse (backfill an empty key); else create. Check each link key on its own: a present value, operation or action does not mean its links exist, so a missing link is created even when the rest of the graph is reused | FP-8.15, FP-8.36 |
| 8.21a | Deploy the unlock approval flows (as Draft) | `Flow` `LSC_Quote_Lock_and_Unlock_Approval_Process` (ApprovalWorkflow on Quote, after save, entry `ISCHANGED(Status) \|\| ISNEW()`), subflows `LSC_Quote_Notifications_for_Lock_and_Unlock` and `LSC_Quote_Set_Status_In_Review`; `CustomNotificationType` `Notification_when_Quote_is_locked_and_Unlocked` | Metadata API deploy of the extracted `<run>/artifacts/a08/` files (pre-check: all six extracted and checksums match), **status Draft** (the org cannot deploy flows as Active). **No literal usernames in the shipped files:** the approver is the formula `{!approver}` = `{!$Record.Owner:User.Manager.Username}` (the rep's manager, 4.8); every background notification step runs as a named admin: `runAsUser=true`, assignee type `User` = `<NOTIFY_ADMIN_USER>`, substituted in all 3 places into a **deploy copy only** (Step details 8.21). The shipped asset is not well-formed XML until `<NOTIFY_ADMIN_USER>` is substituted: never validate or deploy it as shipped. `Set_Status_In_Review` must wait for the notification step (`entryConditions`: `Send_Notifications.Status` = `Completed`): the subflow sends the unlock-request notification only while `Status` is still `Request for Unlock`. The three flows ship with `<apiVersion>62.0</apiVersion>`, which deploys on any org at API 62.0 or later: deploy them unchanged (do not edit `<apiVersion>`). The run-as setting is what lets the Approve branch return the quote to `Draft` (unverified — fallback: if Approve in 14.13 fails with UNKNOWN_EXCEPTION on the notification step, record `PASSED_WITH_NOTES` with `KNOWN_LIMITATION` K24) | Pre-deploy: the shipped approval flow contains exactly 3 `<NOTIFY_ADMIN_USER>` and no username; the deploy copy has none left and is well-formed (`xmllint --noout <file>` if installed, otherwise the deploy's parse result). Deploy succeeds; three flows and the notification type exist, flows status Draft; the user is disclosed at the checkpoint | Tooling `SELECT Definition.DeveloperName, VersionNumber, Status FROM Flow WHERE Definition.DeveloperName IN ('LSC_Quote_Lock_and_Unlock_Approval_Process','LSC_Quote_Notifications_for_Lock_and_Unlock','LSC_Quote_Set_Status_In_Review')` returns all three and `CustomNotificationType` exists → reuse; else deploy. A flow with one of these names that this run did not create (not in `capturedIds`) and is Active → ⏸ STOP in the P5 format with its name; do not deploy or activate over it (also 8.21b) | FP-8.15, FP-8.32 |
| 8.21b | Activate the unlock flows | `FlowDefinition` | For each flow, Tooling `SELECT Id FROM FlowDefinition WHERE DeveloperName = '<name>'` and `SELECT VersionNumber FROM Flow WHERE Definition.DeveloperName = '<name>' ORDER BY VersionNumber DESC LIMIT 1`, then Tooling `PATCH /tooling/sobjects/FlowDefinition/<Id>` `{"Metadata":{"activeVersionNumber":<VersionNumber>}}` (never a fixed 1) — **subflows first** (`LSC_Quote_Notifications_for_Lock_and_Unlock`, `LSC_Quote_Set_Status_In_Review`), then `LSC_Quote_Lock_and_Unlock_Approval_Process` | All three flows have `ActiveVersionId` = `LatestVersionId` (Tooling `FlowDefinition`); `<FIELD_REP_USER>.ManagerId` = `<MANAGER_USER>` | Query `FlowDefinition.ActiveVersionId` → skip if not null and equal to `LatestVersionId` | FP-8.15, FP-8.21 |
| 8.21c | Re-check the approver's territory assignment (set up once at 5.4a) | `UserTerritory2Association` (`<MANAGER_USER>` → `<TERRITORY>`) | Read-only; do not create it again here. The notification subflow creates a territory alert for the quote owner **and the approver** (`AppAlertTerritory`); without an active assignment for the approver the orchestration errors and the approval request is withdrawn (Act 14). Row missing → run 5.4a now, then continue | Row exists for `(UserId=<MANAGER_USER>, Territory2Id=<TERRITORY>)` under the Active `<TERRITORY_MODEL>` | Query by both fields; present → `reused`; missing → run 5.4a | FP-8.15 |
| 8.22 | Signature type value | `StandardValueSet` `DigitalSignatureType` | Metadata API, **its own deploy, before 8.23** (`DigitalSignature.SignatureType` is a standard field — one value "Default", `default=true`; retrieved value set is empty). In the same package as the 8.23 template it fails "signatureType: Default is not a valid value", because the template is validated against the value set as it was before the deploy. Explicit file paths (FP-8.31) | Picklist has exactly one active value | Diff StandardValueSet XML → reuse; else redeploy | FP-8.16, FP-8.31 |
| 8.23 | Quote Document template and its activation | `FlexiPage` `lsc4ce_Quote_Document` (type `ServiceDocument`, entity `Quote`); `CustomObject` `Quote` `actionOverrides` | Metadata API deploy of `<run>/artifacts/a08/lsc4ce_Quote_Document.flexipage-meta.xml` (parent `runtime_sales_quotes__Quote_sd_L_default`; `ls_ordermgmt:lsFlexiSignature` with a signature identifier and Signature Type = the 8.22 value; no logo image item: a fresh org has no static resource for it). **Activation = Org Default assignment** (stored as a Quote `actionOverride`: `actionName=SERVICEDOCUMENT`, `formFactor=Large`, `type=Flexipage`, `content=lsc4ce_Quote_Document`). **Primary — deploy route** (proven on a fresh org; fallback: the UI route): deploy the FlexiPage first, on its own; then retrieve `CustomObject:Quote` into `<run>/artifacts/8.23-pre/` (the rollback copy) and record its counts of `fields`, `actionOverrides`, `compactLayouts` and `listViews`; on an org where `lsc4ce` was already installed, an existing `SERVICEDOCUMENT` override whose `content` is not `lsc4ce_Quote_Document` → ⏸ STOP in the P5 format showing it; merge the override above, deploy (round-trip exclusions as 8.9c), re-retrieve: the override exists; `actionOverrides` = before + 1 (the excluded `CreateRampSchedule` Defaults reappear on retrieve); every other count is unchanged; a diff against `8.23-pre` shows only the override block. **Fallback — UI route** (deploy rejected or read-back differs; Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): Setup → Document Builder (`/lightning/setup/DocumentBuilderRLM/home`) → row menu Edit (opens App Builder in the same tab) → "Activation..." → Org Default → Assign → the "Set as Org Default" review step → Save → toast "Activation successful." If the UI route fails too, ⏸ STOP `TEMPLATE_ACTIVATION_FAILED` and show the error text | Retrieve shows `type=ServiceDocument`, entity Quote, Flexi Signature with Signature Type set; retrieved Quote object carries the `SERVICEDOCUMENT` override naming the template (only active templates appear in 8.29) | Diff FlexiPage XML and the Quote override → reuse; else redeploy | FP-8.16 |
| 8.25 | Grant the deploying admin Document Builder entitlement — **run before 8.24** | `PermissionSetLicenseAssign` (`DocumentBuilderUserPsl`) + `PermissionSetAssignment` (`DocumentBuilderUser`) → the deploying admin, not just the field rep | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first (licence grant). REST, two calls in order: `POST /sobjects/PermissionSetLicenseAssign`, read it back, then `POST /sobjects/PermissionSetAssignment`. Never in one atomic call (FP-4.4). Disclose the grant at the checkpoint. **`BLOCKED_DOCGEN`:** if `DocumentBuilderUserPsl` is absent from `PermissionSetLicense`, has no free seat, or the POST is rejected for the licence, or the customer declines C14: record the row and the response, do not run 8.24, run 8.26–8.29 only if their own checks pass, and report Act 8 `BLOCKED` with reason `BLOCKED_DOCGEN` (and 14.11–14.12 the same) | Admin's effective access shows both; the 8.24 validation passes (without this grant it fails "CreateQuoteDocument (Action) - We can't find the createServiceDocument action…") | Query by (AssigneeId, PermissionSetId) → reuse; else create | FP-8.19 |
| 8.24 | Document-generation Flow — **run after 8.25** | `Flow` `Generate_Quote_Flow` (the packaged template `ls_ordermgmt__GenerateLsQuoteDoc` is a platform template; it cannot be retrieved or cloned by API) | Metadata API deploy of `<run>/artifacts/a08/Generate_Quote_Flow.flow-meta.xml` (design in Step details 8.24), **as Draft**; in the deploy copy replace the one line `<apiVersion>68.0</apiVersion>` with `<apiVersion><API_VER></apiVersion>` (substituted value, for example `67.0`) only when `<API_VER>` is below 68.0. Start = Platform Event trigger on `QuoteDocumentCreationEvent`, run as the triggering user. **Then read the version Status (Tooling `SELECT Status, VersionNumber FROM Flow WHERE Definition.DeveloperName='Generate_Quote_Flow'`): it must be `Draft`, not `InvalidDraft`** (a deploy can report Succeeded and still create an `InvalidDraft` version; never activate that in 8.27). **`InvalidDraft` recovery (Flow Builder re-pick; 🖱️ Playwright, 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`):** the deploy Info messages flag `$Record.QuoteDocumentId__NotFound` on `GetQuoteDocumentDetails` and `SetQuoteDocumentDefaults` (plus an input type mismatch; Flow Builder shows `$Record.null__NotFound`) although `QuoteDocumentCreationEvent.QuoteDocumentId` exists in describe; an identical redeploy repeats it. In Flow Builder, on each flagged element re-select the field from the resource picker (`$Record` (Triggering QuoteDocumentCreationEvent) → Quote PDF ID): the **Filter Value** of `GetQuoteDocumentDetails` and the **Quote Document Id** input of `SetQuoteDocumentDefaults`; Save once over the Draft version. No operator decision is needed | Flow deploys with 0 errors and Status reads `Draft`. After a recovery, Status reads `Draft` and the recovery is noted (`PASSED_WITH_NOTES`); still `InvalidDraft` → ⏸ STOP with the Info messages. Deploy fails "We can't find the createServiceDocument action" → 8.25 has not run: run it and redeploy | Diff Flow XML → reuse; else redeploy | FP-8.18, FP-8.19, FP-8.29 |
| 8.24a | Let the rep publish the document event (the iPad Submit Order PDF) | `ObjectPermissions` on `<FIELD_REP_PS>` for `QuoteDocumentCreationEvent` | REST `POST /sobjects/ObjectPermissions` (ParentId = the `<FIELD_REP_PS>` Id, `SobjectType=QuoteDocumentCreationEvent`, `PermissionsRead` and `PermissionsCreate` = true). It is a platform event (describe: `createable` true, `updateable`, `deletable`, `queryable` false), so Edit and Delete do not apply; grant only these two. The iPad Submit Order creates the `QuoteDocument` and publishes this event as the rep; without Create the publish fails silently, the 8.24 flow never runs and the document stays In Progress (K1, FP-14.4). Grant it on the permission set by API: do not save the rep profile in Setup → Profiles (that save also makes the default All Tabs app visible to the rep, and Metadata API cannot hide it again). The check is server-side: no regenerate is needed for this grant | `SELECT PermissionsRead, PermissionsCreate FROM ObjectPermissions WHERE ParentId = '<ID:FIELD_REP_PS>' AND SobjectType = 'QuoteDocumentCreationEvent'` → one row, both true. Proven at 14.12: the document reaches `Completed`, created and last modified by the rep | Query first; present → `reused`; else create | K1, FP-14.4 |
| 8.26 | Field-rep signature-field access | `PermissionSet` `<FIELD_REP_PS>_Signature` (new, narrow: `DocumentRecipient.Email` Edit) | Metadata API deploy | FLS shows `DocumentRecipient.Email` Edit=true for `<FIELD_REP_PS>_Signature`; one field permission, no object permissions | `SELECT Id FROM PermissionSet WHERE Name = '<FIELD_REP_PS>_Signature'` plus the FLS read → both match → reuse; else deploy (XML in Step details 8.26) | FP-8.20 |
| 8.27 | Assign signature permission set, then activate the Flow | `PermissionSetAssignment` → `<FIELD_REP_USER>`; then `FlowDefinition` activation | REST assignment **first**, then **re-query the FlowDefinition and its Id** (a Flow Builder save in 8.24 can create a new version Id), then read the newest `VersionNumber` (Tooling `SELECT VersionNumber FROM Flow WHERE Definition.DeveloperName = 'Generate_Quote_Flow' ORDER BY VersionNumber DESC LIMIT 1`) and Tooling `PATCH /tooling/sobjects/FlowDefinition/<Id>` body `{"Metadata":{"activeVersionNumber":<VersionNumber>}}` — org has `enableFlowDeployAsActiveEnabled=false`, so Metadata-API "deploy as Active" is not available | Flow status = Active; assignment predates activation: `SELECT SystemModstamp FROM PermissionSetAssignment WHERE PermissionSet.Name = '<FIELD_REP_PS>_Signature' AND AssigneeId = '<ID:FIELD_REP_USER>'` is earlier than Tooling `SELECT LastModifiedDate FROM FlowDefinition WHERE DeveloperName = 'Generate_Quote_Flow'` (later → the flow was activated first: deactivate is not needed; re-run 8.27 after confirming the assignment, then record a note). A document that later stays "In Progress" is G2 / K1 (FP-8.29, Act 14), not an 8.27 failure | Query assignment → reuse/create; query FlowDefinition `ActiveVersionId` → skip PATCH if it equals `LatestVersionId` | FP-8.20, FP-8.21, FP-8.29 |
| 8.28 | Disclaimer text and its share | `ComplianceStatementDef`, `ComplianceStatementDefShare` | **Describe `ComplianceStatementDef` first.** Required fields (any absent → ⏸ STOP `DISCLAIMER_SCHEMA_MISMATCH`; never drop one): `StatementText`, `ModuleType`, `StatementType`, `UsageType`. Optional fields (drop only those the describe does not list, and record `PASSED_WITH_NOTES` naming them): `JurisdictionType`, `JurisdictionCountries`, `StatementRequirementLevel`, `DisplayOrder`. The object has an auto-number Name and **no** `Text`, `Country` or `IsActive` fields — do not send `Name`. **Value rule:** `ModuleType`, `StatementType`, `UsageType` and `JurisdictionType` must each appear in the describe picklists (`Quote`, `Disclaimer`, `LifeSciences`, `Country`); `JurisdictionCountries` takes the two-letter country code of the store's country (for example `US`) *(unverified for codes other than `US` — fallback: if the POST is rejected on the country value, ⏸ STOP `DISCLAIMER_SCHEMA_MISMATCH` and show the error and the described list; never retry with another value)*. Then Composite `allOrNone=true`: `POST /sobjects/ComplianceStatementDef` (payload in Step details 8.28), then one `ComplianceStatementDefShare` (`AccessLevel='Read'`, `RowCause='Manual'`) for `<FIELD_REP_USER>` referencing it | Record exists with `ModuleType='Quote'`, `StatementType='Disclaimer'`, `StatementText=<DISCLAIMER_TEXT>`; one Read share row for `<FIELD_REP_USER>` | Query by (`ModuleType`, `StatementType`, `StatementText`) → reuse; else create | FP-8.14 |
| 8.29 | Set default Quote Document template (and disclaimer filters) | `LifeSciConfigRecord` (category `QuoteDocumentSettings`) | 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`), Admin Console only: Life Sciences Commercial → Admin Console → Order Management → **Quote Document Settings** (a sub-navigation link inside Order Management; Admin Console search does not find it) → "Apply Settings To" = Profile → `<FIELD_REP_PROFILE>` → Default Quote Document Template → Save. Leave the **Disclaimer Filters** (Disclaimer Account Field, Territory Info Field) unset unless `DISCLAIMER_ACCOUNT_SUBSTITUTION = yes`. **Metadata API deploy of this category fails** (`'QuoteDocumentSettings' is not a valid value for the enum 'LifeSciConfigCategoryType'`) and there is no SOQL/Tooling read path — verify only by re-opening the same page | Re-opened page shows the saved template selected (the list offers only the 8.23 template) | Re-open page; if already set, skip | FP-8.22 |
| 8.30a | ⏸ Decide who runs the web smoke test (asked just in time, non-blocking; consent **C12**) | Org login setting *Administrators Can Log in as Any User* (Setup → Login Access Policies; the API route for it is not recorded — use the Setup page) | 👤 HUMAN — ask once: "`Quote_Record_Type` is visible only to the rep profile unless 8.30b is run, so an admin-created Quote gets the Master record type and skips the rep's layout, Stage Path and actions (and the lifecycle rejects it). May I enable *Administrators Can Log in as Any User* (off in a fresh org) so that you can run the 8.30–8.33a web checks as `<FIELD_REP_USER>` via Login-As? I will send the exact clicks and check your results by REST." Recommended and default: **yes** (`SMOKE_AS_REP = yes`; reversible). `ORG_KIND` (0.11) decides the close-out: `test` → leave it on; `customer` → tell the customer it is an org-wide security setting that 15.7 asks to turn off again (recommended: off). Record `SMOKE_AS_REP` (`answered` or `accepted recommendation`) and the C12 answer in the manifest `consents`. The page is a slow iframe: wait for the frame (up to 60 s), Save once, re-open the page to confirm. If **no**: run 6.5b first (pricing and Browse Catalogs permission sets for the admin), then 8.30b and 8.10a, then run 8.30–8.33 as `<ADMIN_USER>` on `Quote_Record_Type`. If 6.5b is rejected for a missing licence, set `SMOKE_AS_REP = yes` and follow the **yes** path (ask C12; skip 8.30b); only if the customer insists on the admin path does 6.5b stop `BLOCKED_ADMIN_LICENCE`. If 8.30b or 8.10a is declined or fails, run as `<ADMIN_USER>` on the Master record type and record 8.30–8.33 `PASSED`, listing the substitution; the record-type, layout and lifecycle render checks are deferred to the iPad (Rep-session rule). Either way continue; this never stops the run. Disclose the setting at the checkpoint; `ORG_KIND = test`: leave it on unless the customer asks otherwise; `customer`: 15.7 asks | `SMOKE_AS_REP` recorded; if yes, the re-opened page shows the setting on and Setup → Users shows a **Login** link next to `<FIELD_REP_USER>` (the link appears only once the setting is on); the rep's Lightning session opens | Setting already on → skip the enable | FP-8.2, FP-8.25 |
| 8.30b | Make `Quote_Record_Type` visible and default on the admin profile (only if `SMOKE_AS_REP = no` or the admin will create quotes) | `Profile` `System Administrator` (`recordTypeVisibilities`) | Metadata API deploy of the **retrieved** System Administrator profile plus one `recordTypeVisibilities` entry: `Quote.Quote_Record_Type` `visible=true`, `default=true` (Deploy safety rule: compare the profile's counts after). Without it an admin Quote gets the Master record type and the lifecycle rejects it ("You can't create Quote records at this stage of the workflow", FP-8.27). Run 6.5b and 8.10a as well, or the admin cannot price it | Retrieved admin profile (manifest also lists `RecordType` `Quote.Quote_Record_Type`, per the 4.2 rule) shows `Quote.Quote_Record_Type` visible + default; admin New Quote opens on `Quote_Record_Type` | Retrieve profile → entry present → `reused`; else merge and redeploy | FP-8.1, FP-8.2, FP-8.27 |
| 8.30 | 👤 HUMAN (web check, as the rep per 8.30a; the agent sends the values and verifies by REST) — create a Draft Quote **as the rep** (per 8.30a; start with Setup → Users → **Login** next to `<FIELD_REP_USER>`). **Precondition: the 8.11a checks passed** | — | Quotes tab → **New Quote** (the rep's store Account page has no New Quote action and no Quotes related list; the button is labelled `New Quote`): Account entered manually (if the Account type-ahead opens Advanced Search, pick the row and click **Select**), Quote Name `<PFX>Web_Quote_1`, Record Type default (`Quote_Record_Type`), Save. **Report back:** saved yes/no; the Quote name; the exact text of any error or toast. Then, on the saved Quote: the Stage Path names in order (8.16a expects `Draft, Submitted, Request for Unlock, In Review, Rejected`); whether **Browse Catalogs**, **Add Line Items** and **Submit** are shown; whether an Approval tab or **Mark Status as Complete** appears (neither should; 8.9b, 8.16a); a screenshot | Quote exists with `Status=Draft`, `RecordTypeId` = `Quote_Record_Type`, STT auto-filled. Save error "the sales transaction type for this pricing procedure is missing" → the 8.11a link is missing: go back to 8.11a (Check A, then B). Save error "You can't create Quote records at this stage of the workflow" → the Quote is not on `Quote_Record_Type` (8.30a/8.30b); the same text on the iPad is gate G4 (FP-8.27, Act 13). A toast "sObject type 'AdminConsoleMenuItem__mdt' is not supported" for the rep is cosmetic (FP-8.25): ignore and do not broaden access | Always create a new disposable Quote: `SELECT Id FROM Quote WHERE Name = '<PFX>Web_Quote_1'` → reuse only that Draft from an interrupted earlier attempt of this step (never another Draft: the smoke test reprices and adjusts it); else create | FP-8.2, FP-8.25, FP-8.27 |
| 8.31 | 👤 HUMAN (web check, as the rep per 8.30a; the agent sends the values and verifies by REST) — add a line | — | Quote detail → Related tab → Quote Line Items → **Add Products** → in the modal, type the price book name into the Price Book lookup (it lists nothing until you type), pick `<PRICEBOOK_n>` and Save (do not press Escape: it closes the whole modal) → select `<PRODUCT_n>` → wait for the Edit Selected Quote Line Items grid (normally about 10 s; not loaded after about 90 s → close and reopen Add Products once; still not loaded → the fallback below, `PASSED_WITH_NOTES`), set **Quantity = 1** (required inline-edit cell; a larger quantity falls outside the pricing-procedure test data; Save before setting it fails "Item 1 has errors in these fields: Quantity") → Save once. If the suggestion list stays open over the results, click a neutral area first. With 8.9b done the modal may open with `<PRICEBOOK_n>` preselected or go straight to the product list. With the 8.3 `Pricebook2` layout assignment in place the price book is pre-selected: that is the pass signal for the picker. **Only if typing the price book name returns nothing:** confirm 8.9b and 8.10 read back as deployed (re-run 8.9b if not), hard-reload the Quote page, open Add Products once more; still empty → the four read-only diagnostics in Step details 8.31. Non-blocking fallback: run the Browse Catalogs clicks of 8.33 (they set the price book; run them even when `RUN_BROWSE_CATALOGS_CHECK = no`, only the 8.33 checks are then skipped), add the product there, Reprice All (8.32), record `PASSED_WITH_NOTES` with the four results. **Report back:** price book pre-selected yes/no (or found by typing); the product grid loaded yes/no; line saved yes/no; any error text | Exactly one `QuoteLineItem` on the Quote; `Pricebook2Id` now set on the Quote (via the action, not the layout). Picker populated and used → `PASSED`; fallback used → `PASSED_WITH_NOTES` | Query QuoteLineItem count for the Quote → reuse if ≥1; else add | FP-8.2, FP-8.23, FP-8.34 |
| 8.32 | 👤 HUMAN (web check, as the rep per 8.30a; the agent sends the values and verifies by REST) — reprice | — | Lines tab → **Reprice All** once (also after 8.33 adds a line: Browse Catalogs creates lines **unpriced**, "Select Reprice All to get revised prices"). On the intermittent `ComponentContext` failure ("…the context hasn't been established", gate **G6**, FP-8.24) click Reprice All once more (no other recovery; the failed attempt corrupts nothing). Then, on the Draft quote, run **Manage Header Adjustment** = Percentage 10 % once and read the result (Adjustment Distribution Logic is disabled for Percentage; leave it). **Report back:** Reprice All succeeded yes/no (and how many clicks); the line's Net Unit Price after the 10 % adjustment; a screenshot of Net Unit Price → Calculation Details | `CalculationStatus` moves off `NotStarted` (`CompletedWithPricing`); `NetUnitPrice` populated on **every** line; a `NetUnitPrice` that differs from list the way Act 7's simulation says also proves the STT/org-default routing. **Header adjustment:** Percentage 10 % gives net 8.55 for a line listed at 10.00 in the 5 % volume band (the "Web, Draft quote" bullet under Reference values in Step details 7.13; for other prices recompute with the same step order and the 7.14-simulated tier price) and Calculation Details shows a Header Adjustment row. The same action on a Submitted quote returns "Error updating Quote": expected (Submitted locks edits) | Check `CalculationStatus`; if already priced, skip | FP-8.24 |
| 8.33 | 👤 HUMAN (web check, as the rep per 8.30a; the agent sends the values and verifies by REST), run only if `RUN_BROWSE_CATALOGS_CHECK = yes` — validate the Browse Catalog flow from 7.18 | — | On the 8.30 Quote: **Browse Catalogs** (requires 8.8's Highlights Panel fix and the 8.9b assignment) → Select Catalog lists `<CATALOG>` with no row pre-selected → click `<CATALOG>` → Next → **Select Products** (buttons *Change Catalog*, *Preview Selection*) → select one product → **Preview Selection** → **Review Products** (buttons *Previous*, *Create Quote Line Items*) → **Create Quote Line Items**; then **Reprice All** (8.32). **Report back:** a screenshot (or a description) of each screen, which the agent saves to `artifacts/`; whether the Select Catalog screen appeared; any currency error; line created yes/no | The Select Catalog screen appeared (proves `<PFX>Browse_Product_Catalog` ran, not `revenue_products__DiscoverProducts`), no currency error on the products screen (the flow uses the Quote's currency — 7.18); one line added, priced after Reprice All. **Missing Product Discovery signature:** if Browse Catalogs opens the standard Browse Products screen (product cards, *Add Selection to Quote*, *Save Quote*) instead of Select Catalog, and adding fails "We couldn't add the product to Quote because the product doesn't have a price" although the price book entry exists, the 7.18 `ProductDiscovery.settings` change did not land: re-retrieve `Settings:ProductDiscovery`, finish 7.18, then repeat 8.33. "Only eligible products offered" is checked only if some active product lacks Quote territory availability for `<TERRITORY>` (7.7); otherwise `not exercisable` | Re-run is additive; `RUN_BROWSE_CATALOGS_CHECK = no` → `skipped` | FP-8.6 |
| 8.33a | 👤 HUMAN Reprice All (with 8.33), then the agent re-reads the price | `QuoteLineItem` | Right after 8.33 (only if it ran): run **Reprice All** on the Quote (8.32 click path), then REST `SELECT Product2.Name, Quantity, UnitPrice, NetUnitPrice FROM QuoteLineItem WHERE QuoteId = '<ID:quote>'` | `NetUnitPrice` = list price × (1 − the product's quantity-1 tier %) × (1 − the 8.32 header adjustment, 10 %), with the tier read from the `PriceAdjustmentTier` row whose quantity range contains 1 (for example 20.00 × 0.98 × 0.90 = 17.64); do not reuse an Act 7 reference price computed for another quantity. An unpriced line after Reprice All is `FAILED` → FP-8.6; skipped with 8.33 | Re-run is additive | FP-8.6 |
| 8.34 | Create Quote From Visit action (not shown on the iPad in this release; K13) | `LifeSciConfigRecord:Create_Quote_From_Visit` (category `QuickAction`) | **API first** (fallback: the Admin Console route): snapshot as 8.10, then one ZIP deploy of the `Create_Quote_From_Visit` record (Step details 8.34; `isOrgLevel` false, no assignments) plus, only when absent, the category `QuickAction` (label `Quick Action`, `type` `List`). Rejected or read-back differs → 🖱️ **Admin Console** (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`), same category rule as 8.10 (the `QuickAction` category does not exist until the Admin Console saves one; a record-only ZIP deploy fails "no LifeSciConfigCategory named QuickAction found"): Admin Console → Quick and Custom Action Administration → Quick Actions → New → Label `Create Quote From Visit`, Name `Create_Quote_From_Visit`, Action Name `Create Quote`, Location `Visit`, SObject `Visit` (appears only after Location is picked), Sort Order `2`, Mobile Only off, Profiles / Permission Sets / Record Types empty → Save ("Quick Action was saved."). **The Admin Console saves QuickAction records with `isOrgLevel = false` and no assignments** (no `LifeSciConfigAssignment` rows are created); a Profile- or User-level assignment is rejected (9.5a). Record Types stay empty here: `Store_Check` is created in Act 9 (scope applied in 8.34a) | Tooling query returns the record active, `ActionName=CreateQuote`, `SObject=Visit`, `Location=Visit`, `SortOrder=2`, `IsOrgLevel=false`. **Not shown on the iPad in this release** (visit ••• menu lists only Delete; K13). The supported from-visit path is the Quoted Order tab → New (9.5 layout, 9.9). Keep the record; 13.2 records whether it renders | Query by masterLabel → reuse; else create On an org where `lsc4ce` was already installed, an existing record of this name not deployed by this run whose field values or assignees differ from the planned payload (including a value this step would blank) → ⏸ STOP in the P5 format with the diff; deploy over it only on the customer's yes, after saving the retrieved record under `org-changes/backup/` | FP-8.14, FP-8.22 |
| 8.34a | Apply `QUOTE_FROM_VISIT_SCOPE` once the Store_Check record type exists — **run after 9.5** (9.5 creates it; the 9.5 row carries a reminder) | `LifeSciConfigRecord:Create_Quote_From_Visit` (`RecordTypes`) | If `QUOTE_FROM_VISIT_SCOPE = Store_Check`: Metadata deploy (metadata-format ZIP, **member and file name = the record's `DeveloperName` `Create_Quote_From_Visit`**; the `masterLabel` `Create Quote From Visit` is rejected by the API Name rule) of the 8.34 record with `RecordTypes` set to `<longTextValue>Store_Check</longTextValue>` on the `RecordTypes` LONGTEXT field value, and everything else as saved in 8.34 (`isOrgLevel` false, no `<assignments>`; 9.5a). Alternative: re-save the record in the Admin Console with the Store Check record type picked (unverified — fallback: the ZIP route). 8.34 saved no record type. If `= all`: nothing to do. The mobile cache is not regenerated for this | Tooling read-back (`LifeSciConfigFieldValue` where `FieldName = 'RecordTypes'`; the column is `FieldName`, not `Field`) shows `LongTextValue = Store_Check`; no other field changed. Value rejected → leave `RecordTypes` empty, `PASSED_WITH_NOTES`, log an `instruction_gap` learning; try no other formats | Already `Store_Check` → skip | FP-8.14 |

#### Step details
**8.2 Quote layout field list**
```
QuoteAccountId (createable account lookup; AccountId is not createable on Quote),
Name, Status (Readonly on layout; FLS stays Edit, 8.13), RecordTypeId (Quote_Record_Type),
SalesTransactionTypeId (<STT_NAME>), StartDate, ExpirationDate (no "Valid From / Valid To" pair),
Description, VisitId (Edit; without it the Visit field on an iPad quote stays blank),
Address Information section: BillingContactPointAddrId, ShippingContactPointAddrId
Mini layout (same deploy; subset of the above): Name, ExpirationDate, Status
Absent on purpose: Pricebook2Id (not layoutable; set post-Save via Browse Catalogs/Add Products); OpportunityId (remove from the shipped mini layout too)
```
- Keep `Status` **Readonly**: changes go through the lifecycle actions (8.18); an editable Status would let a user skip Submit and approval.
- `Pricebook2Id` on the layout fails the deploy `Cannot use field:Pricebook2Id in a layout`. Removing `OpportunityId` from the full layout while the shipped mini layout lists it fails validation: retrieve, edit and deploy both. → FP-8.2
- The two address lookups are usable once 8.13 grants Edit and may stay blank. Section renders without controls → re-read the 8.13 FLS on `<FIELD_REP_PS>`, redeploy if a field is missing, and record `PASSED_WITH_NOTES` if still empty.

**8.6 Tab visibility fragment**
```xml
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <tabSettings><tab>standard-Quote</tab><visibility>Visible</visibility></tabSettings>
  <tabSettings><tab>lsc4ce__AccountFilter</tab><visibility>Visible</visibility></tabSettings>
</PermissionSet>
```
- A `PermissionSet` uses `tabSettings`; `tabVisibilities` is the Profile element. Read-back through `PermissionSetTabSetting` reports `Visible` as `DefaultOn`. App `<tabs>` membership does not grant visibility; repeat the grant per surface (FP-8.4). Do not add `standard-Account`: the managed Accounts tab is `lsc4ce__AccountFilter`.

**8.7–8.9 FlexiPage header fragment**
```xml
<flexiPageRegions>
  <name>header</name><type>Region</type>
  <itemInstances>
    <componentInstance>
      <componentName>force:highlightsPanel</componentName>
      <componentInstanceProperties><name>collapsed</name><value>false</value></componentInstanceProperties>
      <componentInstanceProperties><name>enableActionsConfiguration</name><value>false</value></componentInstanceProperties>
      <componentInstanceProperties><name>enableActionsInNative</name><value>false</value></componentInstanceProperties>
      <componentInstanceProperties><name>hideChatterActions</name><value>false</value></componentInstanceProperties>
      <componentInstanceProperties><name>numVisibleActions</name><value>3</value></componentInstanceProperties>
    </componentInstance>
    <componentInstance><componentName>lsc4ce:LifeSciStagePathContainer</componentName></componentInstance>
  </itemInstances>
</flexiPageRegions>
<template><name>flexipage:recordHomeSingleColTemplateDesktop</name></template>
```
- `recordHomeSimpleViewTemplate` has no compiled nib on the mobile binary, so the header region (Highlights Panel + Stage Path) silently falls back to a page with no header; the new template does not regress the web page (FP-8.5). The stage-path container is property-free: it renders the lifecycle graph (8.18/8.21).
- Without `force:highlightsPanel`, Browse Catalogs and other actions have no surface (FP-8.6). No `visibilityRule` on it.
- **Final page (8.9):** header = highlights panel + stage path; main region = one `flexipage:tabset`: **Quote Line Items** (active) \| **Details** \| **Related** (`force:relatedListContainer`) \| **Approval** (8.9a). Retrieve the deployed page first and edit it; do not rebuild it from a template. If the retrieve returns no `LifeScience_Quote_Record` page, ⏸ STOP and report in the P5 format; do not author the page from this description.

**8.9 Line table `displayFields` (Quote Line Items tab)**
```xml
<componentInstance>
  <componentName>runtime_rca:salesTxnLineTable</componentName>
  <identifier>runtime_rca_salesTxnLineTable</identifier>
  <componentInstanceProperties>
    <name>displayFields</name>
    <valueList>
      <valueListItems><value>QuoteLineItem.Product2.Name[Product2]</value></valueListItems>
      <valueListItems><value>QuoteLineItem.Quantity</value></valueListItems>
      <valueListItems><value>QuoteLineItem.ListPrice</value></valueListItems>
      <valueListItems><value>QuoteLineItem.DiscountAmount</value></valueListItems>
      <valueListItems><value>QuoteLineItem.Discount</value></valueListItems>
      <valueListItems><value>QuoteLineItem.AdditionalFreeItemQty</value></valueListItems>
      <valueListItems><value>QuoteLineItem.Subtotal</value></valueListItems>
      <valueListItems><value>QuoteLineItem.NetTotalPrice</value></valueListItems>
      <valueListItems><value>QuoteLineItem.NetUnitPrice</value></valueListItems>
    </valueList>
  </componentInstanceProperties>
  <componentInstanceProperties><name>enableQuickAdd</name><value>true</value></componentInstanceProperties>
  <componentInstanceProperties><name>enableSidepanel</name><value>true</value></componentInstanceProperties>
</componentInstance>
<!-- footer, same tab body, after the line table -->
<componentInstance>
  <componentName>runtime_revenue_foundation:transactionSummary</componentName>
  <identifier>runtime_revenue_foundation_transactionSummary</identifier>
</componentInstance>
```
- `displayFields` drives the iPad cart grid and the web line grid; without it both fall back to all related-list columns. The related list cannot hold `AdditionalFreeItemQty`, so 8.2a never fixes the cart. Confirm the valueList nesting and both `enable…` properties read back as written. `enableQuickAdd` and `enableSidepanel` make no visible difference on the iPad; a missing quick-add bar is not a failure.
- **`sourceApiVersion` ≥ 65**, or the deploy fails "Invalid property [displayFields]…" even with `--api-version 68.0`; set it (for example 68.0) in `sfdx-project.json` before the first FlexiPage deploy (FP-8.5).
- **Details = two sections only** (Quote Information, Address Information); remove Totals, Prepared For and System Information, which render blank on the iPad edit form. The footer shows totals.
- **Status read-only on Details.** In the Quote Information section, the `fieldInstance` for `Record.Status` carries `<fieldInstanceProperties><name>uiBehavior</name><value>readonly</value></fieldInstanceProperties>`. With `none` the iPad Create New Quote shows an editable Status picklist (FP-8.35). The Quote Layout's `Readonly` does not apply: the iPad form follows the FlexiPage (`ui.json` carries the `uiBehavior`).
- **Labels plain text.** If a retrieved or shipped page carries `@@@SFDC…@@@` tokens, replace each with its plain label before deploy; the 8.9 row checks the deployed page (FP-8.30).

**8.9a Approval tab (same FlexiPage deploy)**

Profile-name substitution (every `<FIELD_REP_PROFILE>` and `<MANAGER_PROFILE>` in XML in this Act): inside element text write the exact profile name with `&`, `<`, `>` as `&amp;`, `&lt;`, `&gt;`; file names and `package.xml` members use the name exactly as the retrieve writes it (for example a space is written `%20`). Names with only letters, digits, `_` and `-` need neither (unverified for other characters — fallback: rename the profile to such a name at 4.in).

```xml
<!-- Facet region holding both components; a tab (title "Approval") whose body is that facet -->
<flexiPageRegions>
  <itemInstances><componentInstance>
    <componentName>runtime_approvals:approvalTrace</componentName>
    <identifier>runtime_approvals_approvalTrace</identifier>
    <visibilityRule><criteria><leftValue>{!$Client.formFactor}</leftValue><operator>EQUAL</operator><rightValue>Large</rightValue></criteria></visibilityRule>
  </componentInstance></itemInstances>
  <itemInstances><componentInstance>
    <componentName>interaction_orchestrator:workGuide</componentName>
    <identifier>interaction_orchestrator_workGuide</identifier>
    <componentInstanceProperties><name>componentLabel</name><value>Work Guide</value></componentInstanceProperties>
    <componentInstanceProperties><name>isHiddenWhenEmpty</name><value>false</value></componentInstanceProperties>
    <componentInstanceProperties><name>isRunNameDisplayed</name><value>true</value></componentInstanceProperties>
    <visibilityRule><criteria><leftValue>{!$Client.formFactor}</leftValue><operator>EQUAL</operator><rightValue>Large</rightValue></criteria></visibilityRule>
  </componentInstance></itemInstances>
  <name>Facet-approval</name><type>Facet</type>
</flexiPageRegions>
<componentInstance>
  <componentName>flexipage:tab</componentName>
  <identifier>flexipage_tab4</identifier>
  <componentInstanceProperties><name>body</name><value>Facet-approval</value></componentInstanceProperties>
  <componentInstanceProperties><name>title</name><value>Approval</value></componentInstanceProperties>
  <visibilityRule>
    <booleanFilter>1 AND 2</booleanFilter>
    <criteria><leftValue>{!$Client.formFactor}</leftValue><operator>EQUAL</operator><rightValue>Large</rightValue></criteria>
    <criteria><leftValue>{!$User.Profile.Name}</leftValue><operator>NE</operator><rightValue><FIELD_REP_PROFILE></rightValue>
    </criteria>
  </visibilityRule>
</componentInstance>
```
- Approving a flow-based approval needs **both** components: the unlock notification tells the approver to approve or reject "from the Work Guide". Desktop only. Add the `flexipage:tab` item to the existing tabset of the retrieved page. `isStageNameDisplayed` and `prioritizationCriteria` are optional and omitted.

**8.9b Record page assignment (app deployed alone)**
```xml
<!-- merge into the retrieved CustomApplication lsc4ce__lifeSciencesCommercial; one block per profile -->
<profileActionOverrides>
  <actionName>View</actionName><content>LifeScience_Quote_Record</content><formFactor>Large</formFactor>
  <pageOrSobjectType>Quote</pageOrSobjectType><recordType>Quote.Quote_Record_Type</recordType>
  <type>Flexipage</type><profile><FIELD_REP_PROFILE></profile>
</profileActionOverrides>
<!-- repeat with <MANAGER_PROFILE>, and with the System Administrator profile if different -->
```
- Until assigned, the Quote View override stays Default and the rep gets the system page. A partial app file replaces the rest: retrieve, merge, read back. No app-level `actionOverrides` (not persisted).

**8.10 OrderProductViewsSettings record**

**Route order.** API first (8.10 row; proven on a fresh org; fallback: this Admin Console route). **Admin Console route** (proven): the category is registered only after the Admin Console saves a record in it; until then Metadata API, Tooling and wildcard retrieve show no `LifeSciConfigCategory`. Click path (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): `lsc4ce__AdminConsole` tab → Order Management → **Orders and Pricing Settings** → "Apply Settings To" = Profile → `<FIELD_REP_PROFILE>` → set: Active Product Views = **Products From Previous Order** + **Store Assortment**, Priority Products tab on (the checkbox toggles only by clicking its label), Pricing Procedure = `<PRICING_PROCEDURE>`, Last Quote Status = `<LAST_ORDER_STATUS>`, Waterfall Open Quote Statuses = Draft, Waterfall Closed Quote Statuses = Submitted, Waterfall Open Quotes Retention Days = 5 → Save → re-open and confirm → Tooling read-back (`LifeSciConfigRecord`, `LifeSciConfigFieldValue`). Run 8.16 first so the Last Quote Status list offers `Submitted`.

`<ID:fieldRepProfile>` is the profile's 18-character Id: `SELECT Id FROM Profile WHERE Name = '<FIELD_REP_PROFILE>'`. The ZIP below updates an existing record once the category exists and is the field-value reference for the UI route.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <assignments><assignedTo>Custom-<FIELD_REP_PROFILE></assignedTo><assignmentLevel>Profile</assignmentLevel></assignments>
    <fieldValues><dataType>MULTIPICKLIST</dataType><fieldName>ActiveProductViews</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue>ProductsFromPreviousOrder;StoreAssortment</longTextValue></fieldValues>
    <fieldValues><dataType>BOOLEAN</dataType><fieldName>EnablePriorityProductsTab</fieldName><hasBooleanValue>true</hasBooleanValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>PricingProcedure</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue><PRICING_PROCEDURE></picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>LastOrderStatus</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue><LAST_ORDER_STATUS></picklistValue></fieldValues>
    <fieldValues><dataType>MULTIPICKLIST</dataType><fieldName>WaterfallOpenQuoteStatuses</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue>Draft</longTextValue></fieldValues>
    <fieldValues><dataType>MULTIPICKLIST</dataType><fieldName>WaterfallClosedQuoteStatuses</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue>Submitted</longTextValue></fieldValues>
    <fieldValues><dataType>INTEGER</dataType><fieldName>WaterfallOpenQuotesRetentionDays</fieldName><hasBooleanValue>false</hasBooleanValue><integerValue>5</integerValue></fieldValues>
    <isActive>true</isActive>
    <isOrgLevel>false</isOrgLevel>
    <lifeSciConfigCategory>OrderProductViewsSettings</lifeSciConfigCategory>
    <masterLabel>OrderProductViewsSettings_<ID:fieldRepProfile></masterLabel>
</LifeSciConfigRecord>
```
`package.xml` at the ZIP root: `<types><members>OrderProductViewsSettings_<ID:fieldRepProfile></members><name>LifeSciConfigRecord</name></types>`. When Tooling shows no `OrderProductViewsSettings` category, add `<types><members>OrderProductViewsSettings</members><name>LifeSciConfigCategory</name></types>` and this file as `lifeSciConfigCategories/OrderProductViewsSettings.lifeSciConfigCategory` (unlike the 9.5 sample, it needs `<type>`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigCategory xmlns="http://soap.sforce.com/2006/04/metadata">
    <category>OrderProductViewsSettings</category>
    <masterLabel>Quotes and Pricing Settings</masterLabel>
    <type>Hierarchical</type>
</LifeSciConfigCategory>
```
- `assignedTo` = literal `Custom-` + the profile Name. For `BOOLEAN`, `hasBooleanValue` is the value; other types keep it `false` and use `longTextValue`, `picklistValue` or `integerValue`.
- File name and package member are the record name, not the retrieval filename (FP-8.7). Source-format packages can silently drop `LifeSciConfigRecord`: use a prebuilt Metadata-API-format ZIP with `package.xml` at the root (directory mode + `--single-package` conflicts) (FP-8.14).
- **Prerequisite.** Last Order and draft order capture depend on provisioned org permissions (the Draft Order org permission, alongside the Store Check org permission and Core CPQ) that no supported query exposes directly. API precheck, a proxy: `SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = '<ID:FIELD_REP_USER>' AND PermissionSet.PermissionsLSDraftOrderUser = true` returns ≥ 1 (the packaged rep permission set grants it); 0 → FP-8.33. On either route, also check in the Admin Console that the Product Views section offers both Last Order and Store Assortment; if Last Order is missing, follow FP-8.33.
- Only one view offered → keep `StoreAssortment`, `PASSED_WITH_NOTES`, mark the Act 15 Last Order checks `not testable`. The "Products from Last Order" card appears on the device once a Submitted quote exists for the Account; the Last Order view lists products from quotes of the Account in `LastOrderStatus`.
- Blank waterfall fields make the iPad skip the fetch; server-priced lines still show blank Amounts on % adjustment rows (K25).
- Leave `DisclaimerAccountField` and `DisclaimerProviderAcctTerritoryInfoField` unset (8.28, 8.29).

**8.10b Org-level record** (after 8.10 created or found the category; fallback for users without a profile record, FP-10.3)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldValues><dataType>MULTIPICKLIST</dataType><fieldName>ActiveProductViews</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue>ProductsFromPreviousOrder;StoreAssortment</longTextValue></fieldValues>
    <fieldValues><dataType>BOOLEAN</dataType><fieldName>EnablePriorityProductsTab</fieldName><hasBooleanValue>true</hasBooleanValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>PricingProcedure</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue><PRICING_PROCEDURE></picklistValue></fieldValues>
    <isActive>true</isActive>
    <isOrgLevel>true</isOrgLevel>
    <lifeSciConfigCategory>OrderProductViewsSettings</lifeSciConfigCategory>
    <masterLabel>OrderProductViewsSettings_OrgLevel</masterLabel>
</LifeSciConfigRecord>
```
- No `<assignments>`; package member `OrderProductViewsSettings_OrgLevel`. Waterfall and Last Order fields stay blank (the rep profile record wins for the rep). Keep 8.10a for the admin: the org-level record alone does not fix the admin create error. Read-back: Tooling `SELECT Id, IsOrgLevel FROM LifeSciConfigRecord WHERE MasterLabel = 'OrderProductViewsSettings_OrgLevel'` → one row, `IsOrgLevel = true`, zero assignments.

**8.11 Sales Transaction Type check**
```sql
SELECT Id, Name, PricingProcedureId FROM SalesTransactionType WHERE PricingProcedureId = '<ID:pricingProcedure>'
```
- Expect exactly one row. `SalesTransactionType` has no active flag: do not select `IsActive` (the query errors). The STT is created once, in 7.16; a second STT on the same procedure makes Quote routing nondeterministic (FP-8.8).
- `PricingProcedureId` is hidden from describe and SOQL until field-level security exists (8.11a). If the query errors on it, count rows (`SELECT COUNT() FROM SalesTransactionType`) and run 8.11a now. Readable and null → 8.11a step 3.
**8.13 FLS fragment** (inside the retrieved `<FIELD_REP_PS>`; deploy with 8.1–8.9a)
```xml
<fieldPermissions><field>Quote.SalesTransactionTypeId</field><editable>true</editable><readable>true</readable></fieldPermissions>
<fieldPermissions><field>Quote.Status</field><editable>true</editable><readable>true</readable></fieldPermissions>
<fieldPermissions><field>Quote.BillingContactPointAddrId</field><editable>true</editable><readable>true</readable></fieldPermissions>
<fieldPermissions><field>Quote.ShippingContactPointAddrId</field><editable>true</editable><readable>true</readable></fieldPermissions>
<fieldPermissions><field>Quote.VisitId</field><editable>true</editable><readable>true</readable></fieldPermissions>
```
- `Quote.Status` must be Edit although the layout is Readonly: the Submit action's `RecordUpdate` needs FLS edit to render; without it Submit is simply absent (FP-8.10).
- Submit also needs `CalculationStatus` not `NotStarted` (a successful 8.32 reprice); a stale quote shows "The prices aren't up to date or the validation isn't complete." and hides Submit (FP-8.17). Both conditions are required.

**8.14 QuoteSettings_OrgLevel record** (member and file name `QuoteSettings_OrgLevel`; category file as 8.10, with `QuoteSettings` / `Quote Settings` / `Hierarchical`, only when absent)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldValues><dataType>PICKLIST</dataType><fieldName>TransactionProcessingType</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue>lsc4ce_pricing_mobile_tpt</picklistValue></fieldValues>
    <fieldValues><dataType>MULTIPICKLIST</dataType><fieldName>QuoteRecordType</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue>Quote_Record_Type</longTextValue></fieldValues>
    <fieldValues><dataType>INTEGER</dataType><fieldName>MaxQuoteLineItemsPerQuote</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <isActive>true</isActive>
    <isOrgLevel>true</isOrgLevel>
    <lifeSciConfigCategory>QuoteSettings</lifeSciConfigCategory>
    <masterLabel>QuoteSettings_OrgLevel</masterLabel>
</LifeSciConfigRecord>
```
- `TransactionProcessingType` is a `PICKLIST` whose `picklistValue` is the TPT developer name.

**8.16 Status values and record type**
```xml
<!-- StandardValueSet QuoteStatus: the five lifecycle values first, in QUOTE_STAGES order -->
<StandardValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <sorted>false</sorted>
  <standardValue><fullName>Draft</fullName><default>true</default><label>Draft</label></standardValue>
  <standardValue><fullName>Submitted</fullName><default>false</default><label>Submitted</label></standardValue>
  <standardValue><fullName>Request for Unlock</fullName><default>false</default><label>Request for Unlock</label></standardValue>
  <standardValue><fullName>In Review</fullName><default>false</default><label>In Review</label></standardValue>
  <standardValue><fullName>Rejected</fullName><default>false</default><label>Rejected</label></standardValue>
  <!-- keep the shipped generic values after these (Needs Review, Approved, Presented, Accepted, Denied); 8.16a redeploys them isActive=false -->
</StandardValueSet>
```
```xml
<!-- RecordType Quote.Quote_Record_Type, Status: exactly the five (deployed in 8.1) -->
<picklistValues><picklist>Status</picklist>
  <values><fullName>Draft</fullName><default>true</default></values>
  <values><fullName>Submitted</fullName><default>false</default></values>
  <values><fullName>Request for Unlock</fullName><default>false</default></values>
  <values><fullName>In Review</fullName><default>false</default></values>
  <values><fullName>Rejected</fullName><default>false</default></values>
</picklistValues>
```
- The shipped set has `In Review` and `Rejected` but no `Submitted` or `Request for Unlock`: retrieve, add only what is missing, keep every shipped value. Values not listed on the record type do not show (listing all ten renders every generic status). Use `QUOTE_STAGES` from the frozen inputs; if the customer changed it, change both blocks.

**8.17 Trigger handler activation (after consent C8)**
- Steps (also in the row): query, skip if already active, record before-values, PATCH `{"IsActive":true}` on `/services/data/v<API_VER>/tooling/sobjects/LifeScienceTriggerHandler/<ID:handler>`, re-query (`LastModifiedDate` later than before). More or fewer than one row → stop and report.
- Reverse only on the customer's request: the same call with `false`. The change is an org-wide enforcement switch, not in Setup Audit Trail; the Admin Console grid then shows it active (FP-8.13). Anonymous Apex cannot do this ("Type is not visible").
- **Fallback (👤 HUMAN)** if the Tooling write is refused: the Active switch ignores Playwright (cell, graphic, centre click, Space). Human path: `lsc4ce__AdminConsole` → Trigger Handler Administration → Object API Name filter (first option "All Objects"; the handler's own value is `ALL`) → search `StagePathPermissionsHandler` → one row → click the Active switch once. Do not retry without re-reading the state.

**8.18 Quote lifecycle graph (one Composite, `allOrNone=true`, 14 rows)**

Every `Id` is a Composite reference. Each sub-request is `POST /services/data/v<API_VER>/sobjects/<Object>` with `referenceId` in row order `so`, `path`, `vDraft`, `vSub`, `opDraft`, `opSub`, `aAdd`, `aSubmit`, `aView`, `aPdf`, `oa1`–`oa4`, and a reference is written `@{aAdd.id}`. Order: stage object → path → values → operations → actions → operation-action links.

| Row | Object | Fields |
| :-- | :-- | :-- |
| 1 | `LifeSciStageObject` | `Name`=`Quote`, `ObjectName`=`Quote`, `IsControlledByStagePath`=`true`, `SourceSystemIdentifier`=`Quote` |
| 2 | `LifeSciStagePath` | `Name`=`Quote Lock and Unlock`, stage object = row 1, `FieldApiName`=`Status`, `StageObjectRecordTypeId`=`<ID:Quote_Record_Type>`, `ScopeType`=`Default`, `Parameters`=`{}`, `Status`=`Active`, `SourceSystemIdentifier`=`Quote_Quote_Record_Type` |
| 3–4 | `LifeSciStageValue` | `Draft` / `Submitted` (`Name` = `FieldValue`), path = row 2, `SourceSystemIdentifier`=`PathNode_Quote_Draft` / `PathNode_Quote_Submitted` |
| 5 | `LifeSciStageOperation` | `Unlock the Quote when Quote Status is Draft`, value = Draft, stage object = row 1, `Type`=`WorkflowPath`, `Priority`=`1`, `CanCreate`/`CanEdit`/`CanDelete` = `true`, `SourceSystemIdentifier`=`Context_Quote_Draft` |
| 6 | `LifeSciStageOperation` | `Lock the Quote when Quote Status is Submitted`, value = Submitted, `Type`=`WorkflowPath`, `Priority`=`1`, all three `false`, `SourceSystemIdentifier`=`Context_Quote_Submitted` |
| 7 | `LifeSciStageAction` | `AddLineItems` / `Add Line Items`, `Type`=`Component`, `LifeSciStageObjectId` = row 1, `Parameters`=`{"componentConfiguration":{"name":"runtime_rca:salesTxnLineTable","parameters":{"isReadOnly":"false","status":"Submitted"}}}`, `SourceSystemIdentifier`=`Quote_AddLineItems` |
| 8 | `LifeSciStageAction` | `Submit`, `Type`=`RecordUpdate`, `LifeSciStageObjectId` = row 1, `FieldApiName`=`Status`, `FieldValue`=`Submitted`, `Parameters`=`{}`, `SourceSystemIdentifier`=`Quote_Submit` |
| 9 | `LifeSciStageAction` | `ViewLineItems` / `View Line Items`, `Type`=`Component`, `LifeSciStageObjectId` = row 1, `Parameters`=`{"componentConfiguration":{"name":"runtime_rca:salesTxnLineTable","parameters":{"isReadOnly":"true"}}}`, `SourceSystemIdentifier`=`Quote_ViewLineItems` |
| 10 | `LifeSciStageAction` | `GeneratePDF` / `Generate PDF`, `Type`=`Component`, `LifeSciStageObjectId` = row 1, `Parameters`=`{"componentConfiguration":{"name":"runtime_sales_quotes:createPDF"}}`, `SourceSystemIdentifier`=`Quote_GeneratePDF` |
| 11–12 | `LifeSciStageOperationAction` | Draft operation ← Add Line Items (`DisplayOrder` 1), ← Submit (2); `Name` = `Draft - Add Line Items`, `Draft - Submit`; `SourceSystemIdentifier` = `ContextAction_Quote_Draft_AddLineItems`, `ContextAction_Quote_Draft_Submit` |
| 13–14 | `LifeSciStageOperationAction` | Submitted operation ← View Line Items (1), ← Generate PDF (2); `Name` = `Submitted - View Line Items`, `Submitted - Generate PDF`; `SourceSystemIdentifier` = `ContextAction_Quote_Submitted_ViewLineItems`, `ContextAction_Quote_Submitted_GeneratePDF` |

**Stage record keys (8.18, 8.21, 9.11).** Every `LifeSciStageObject`, `LifeSciStagePath`, `LifeSciStageValue`, `LifeSciStageOperation`, `LifeSciStageAction`, `LifeSciStageOperationAction` and `LifeSciStageOperationCondn` row this skill writes carries `SourceSystemIdentifier` = its key. The Admin Console Workflow Paths editor stores each record's developer name in that field and uses it to load a path and to link parents and children when it saves. A row without it opens with another path's stages and operations, and edit, update or delete of its stages, operations or actions fails. Shares have no key.
- **Keys.** The keys follow the editor's prefixes (`PathNode_`, `Context_`, `ContextAction_`) but are stable, without the editor's time suffix, so a rerun finds its own rows. The field holds 255 characters; the path key stays within the 40 the editor uses for paths:

  | Object | Quote (8.18, 8.21) | Visit (9.11) |
  | :-- | :-- | :-- |
  | Stage object | `Quote` | `Visit` |
  | Path | `Quote_Quote_Record_Type` | `Visit_Store_Check` |
  | Values | `PathNode_Quote_Draft`, `PathNode_Quote_Submitted`, `PathNode_Quote_RequestForUnlock`, `PathNode_Quote_InReview`, `PathNode_Quote_Rejected` | `PathNode_Visit_Planned`, `PathNode_Visit_InProgress`, `PathNode_Visit_Completed` |
  | Operations | `Context_Quote_<Value>` (same `<Value>` part as the value key, for example `Context_Quote_RequestForUnlock`) | `Context_Visit_Planned`, `Context_Visit_InProgress`, `Context_Visit_Completed` |
  | Actions | `Quote_AddLineItems`, `Quote_Submit`, `Quote_ViewLineItems`, `Quote_GeneratePDF`, `Quote_RequestForUnlock` | `Visit_BeginVisit`, `Visit_EndVisit` |
  | Operation-action links | `ContextAction_Quote_<Value>_<Action>` (for example `ContextAction_Quote_Submitted_RequestForUnlock`) | `ContextAction_Visit_Planned_BeginVisit`, `ContextAction_Visit_InProgress_EndVisit` |

- **Collision check, before the write.** Per object, `SELECT Id, Name, SourceSystemIdentifier FROM <Object> WHERE SourceSystemIdentifier IN (<this graph's keys>)`. A hit that is not this graph's own row (different path, or a different `Name`) → ⏸ STOP and show it; two rows sharing a key break the editor's save. An existing stage object for the same `ObjectName` is reused, not recreated: drop its subrequest, use its Id wherever the body references it (`@{so.id}` / `@{obj.id}`), set its key only if empty, and keep the key it has otherwise (the graph's other rows don't depend on the object's key).
- **Backfill.** A graph found by `Name` (an earlier run of this skill, or rows created before keys were written) with an empty `SourceSystemIdentifier` → one Composite `allOrNone=true` of `PATCH …/sobjects/<Object>/<Id>` `{"SourceSystemIdentifier":"<key>"}`, matching each row to its key by object and `Name` (links by operation + action). Export the rows to `<run>/artifacts/<step>/pre-keys.json` first and re-query after. A row this skill doesn't define (the customer's own) is left untouched and reported.
- **Read-back.** `SELECT Id, Name, SourceSystemIdentifier FROM <Object> WHERE …` over the graph: no empty key, each equals its table value, and no key appears twice for the same object. Then open Admin Console → Workflow Paths and confirm the path's name opens its own stages (FP-8.36).

- Add Line Items is required (checklist Q7 expects "Add Line Items, Submit" on Draft). The required-field list in the row applies to every row above (`Name` on every object). 8.19 shares rows 7–10 and row 1 (five rows); 8.21 adds the sixth.

**8.21 Unlock branch (gate G10)**
- **Stage data** (same framework as 8.18; Admin Console: Workflow Configuration → Workflow Actions / Paths), one Composite `allOrNone=true`:
  - `LifeSciStageValue` `Request for Unlock`, `In Review`, `Rejected` on the 8.18 path (keys `PathNode_Quote_RequestForUnlock`, `PathNode_Quote_InReview`, `PathNode_Quote_Rejected`).
  - One `LifeSciStageOperation` per new value: `Lock the Quote when Quote Status is <value>`, `Type`=`WorkflowPath`, `Priority`=`1`, Create/Edit/Delete `false` (keys `Context_Quote_RequestForUnlock`, `Context_Quote_InReview`, `Context_Quote_Rejected`). The **Request for Unlock** and **Rejected** operations each get one `LifeSciStageOperationAction` to the existing View Line Items action at `DisplayOrder` 1 (`Name` = `Request for Unlock - View Line Items`, `Rejected - View Line Items`; keys `ContextAction_Quote_RequestForUnlock_ViewLineItems`, `ContextAction_Quote_Rejected_ViewLineItems`), so a rep can still open the line items of a locked quote; this matches Workflow Paths built in the Admin Console. In Review has no actions.
  - Action `Request for Unlock` (`RequestForUnlock`): `RecordUpdate`, `FieldApiName`=`Status`, `FieldValue`=`Request for Unlock`, `Parameters`=`{}`; linked to the **Submitted** operation at `DisplayOrder` 3 (`LifeSciStageOperationAction` needs a `Name`). Keys: action `Quote_RequestForUnlock`, link `ContextAction_Quote_Submitted_RequestForUnlock`.
  - **`LifeSciStageActionShare`** (`Read`/`Manual`) of the new action to `<FIELD_REP_USER>`, in the same call.
  - Approval returns the quote to the existing **Draft** stage; there is no "Approved" status. `In Review` is custom and the packaged approval flow does not set it: 8.21a adds the step. The full path Submitted → Request for Unlock → In Review → Draft is exercised in Act 14.
- **Approval flows: deploy, do not click through Flow Builder** (8.21a, 8.21b); Flow Builder (Setup → Flows → New → Record-Triggered Flow Approval Process) is the manual fallback only.
  - `LSC_Quote_Lock_and_Unlock_Approval_Process` (entry `ISCHANGED({!$Record.Status}) || ISNEW()`; approver `{!$Record.Owner:User.Manager.Username}`; Approve → Draft, Reject → Rejected), `LSC_Quote_Notifications_for_Lock_and_Unlock` (sets the status, sends notification, email and `AppAlertTerritory` alerts to the owner **and the approver**) and `LSC_Quote_Set_Status_In_Review` (sets `Status = In Review`; its `Set_Status_In_Review` step waits for `Send_Notifications.Status` = `Completed`, else the unlock notification silently skips).
  - **Background steps run as a named admin:** the steps that call the notification subflow (`Send_Approved_Notifications`, `Send_Rejected_Notifications`, `Send_Notifications`; the locked-notification step is not run-as) get `runAsUser=true` with one `User` assignee = `<NOTIFY_ADMIN_USER>` (three substitutions, deploy copy only). Without it the steps run as Automated Process and the Quote update can fail. The approval step stays on `{!approver}`.
  - Deploy as Draft, then activate (8.21b), subflows first.
- **Approver prerequisites (all three, or Act 14 fails):** (1) the rep's `ManagerId` = `<MANAGER_USER>` (4.8); (2) `<MANAGER_USER>` holds an active territory assignment (8.21c; without it the orchestration errors and the request is withdrawn); (3) the record page with the Approval tab is assigned to the approver's profile (8.9b; without it the notification points at a page with no Work Guide). **Fallback:** Approval Work Item page (To Do List item → Review → Approve or Reject → Confirm).
- Q6 expects an **Approval** tab: it is 8.9a. Exercised once in 14.13–14.15; if it fails, leave it built, report the literal `Status` reached, `PASSED_WITH_NOTES`. Approve failing on the notification step is K24. → FP-8.15, FP-8.32

**8.22 DigitalSignatureType value set (its own deploy, finished before 8.23)**
```xml
<StandardValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <sorted>false</sorted>
  <standardValue><fullName>Default</fullName><default>true</default><label>Default</label></standardValue>
</StandardValueSet>
```

**8.24 DocGen Flow (`Generate_Quote_Flow`), after 8.25**
Asset `Generate_Quote_Flow.flow-meta.xml` (Appendix B), a clone of the shipped template `ls_ordermgmt__GenerateLsQuoteDoc`: platform-event start on `QuoteDocumentCreationEvent` (run as the triggering user) → `GetQuoteDocumentDetails` (lookup of the `QuoteDocument` by `$Record.QuoteDocumentId`) → `SetQuoteDocumentDefaults` (`setLsQuoteDocumentDefaults`, input `quoteDocumentId` = `$Record.QuoteDocumentId`) → `CreateQuoteDocument` (`createServiceDocument`) → End, with a fault path sending `emailSimple` to the running user. Do not hand-write it.
- Precondition: the shipped template exists: `SELECT Id FROM FlowDefinitionView WHERE IsTemplate = true AND ApiName = 'GenerateLsQuoteDoc'` (Data API; Tooling does not answer it). No row → the LSC package is not fully installed: ⏸ STOP in the P5 format naming the pinned package version (on an org where `lsc4ce` was already installed, the release lacks the shipped template; do not reinstall); on a new org go back to Act 1.
- `processMetadataValues` `BuilderType`, `CanvasMode` (`AUTO_LAYOUT_CANVAS`) and `OriginBuilderType` must be present, or the deploy fails "Free-Form canvas mode doesn't support End elements" (FP-8.18). Deploy as `Draft` (`enableFlowDeployAsActiveEnabled=false`; activation is 8.27, FP-8.21).
- **Version Status** (Tooling, in the row) must be `Draft`. `InvalidDraft` is expected on some orgs, not an exception: recover in Flow Builder as the row says, re-read Status, record `PASSED_WITH_NOTES`, then activate in 8.27.

**8.26 Signature permission set** (file `<FIELD_REP_PS>_Signature.permissionset-meta.xml`; `package.xml` member `PermissionSet` `<FIELD_REP_PS>_Signature`; a new, narrow set, so no retrieve-and-merge)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Field rep signature capture: DocumentRecipient.Email edit only.</description>
    <fieldPermissions><editable>true</editable><field>DocumentRecipient.Email</field><readable>true</readable></fieldPermissions>
    <hasActivationRequired>false</hasActivationRequired>
    <label><PFX_LABEL> Field Rep Signature</label>
</PermissionSet>
```

**8.27 Flow activation request**
```
PATCH /services/data/v<API_VER>/tooling/sobjects/FlowDefinition/<ID:flowDefinition>
{ "Metadata": { "activeVersionNumber": <VersionNumber> } }
```
- Assign the signature permission set (8.26) to `<FIELD_REP_USER>` **before** activating, as separate steps. Reverse only on the customer's request, with `activeVersionNumber: 0`; there is no Metadata API path.

**8.28 ComplianceStatementDef payload**
```json
{
  "StatementText": "<DISCLAIMER_TEXT>",
  "ModuleType": "Quote",
  "StatementType": "Disclaimer",
  "UsageType": "LifeSciences",
  "JurisdictionType": "Country",
  "JurisdictionCountries": "<DISCLAIMER_COUNTRY>"
}
```
- The account-substitution filters (Account Field, Territory Info Field) are in **Disclaimer Filters** of Quote Document Settings (8.29), not on this record or on 8.10. Set them only if `DISCLAIMER_ACCOUNT_SUBSTITUTION = yes`.

**8.29 Quote Document Settings (Admin Console only)**
- Only activated templates of type "Default Quote Template" are listed; empty list → 8.23 is missing, inactive or of another type. Upgraded org: Signature Type may be unprovisioned (PDF renders without the signature): confirm it on the 8.23 template first.
- Fields commit on blur: click out of each field before Save, then re-open to confirm.
- Metadata API deploy is rejected (target-org feature-registration gap, FP-8.22); no SOQL/Tooling read exists, so re-opening the page is the only verification. `ServiceDocument` FlexiPages never appear in the Act 10 `ui.json`: expected and non-blocking.

**8.30–8.32 Web Draft Quote smoke test**
- Run as `<FIELD_REP_USER>` (8.30a); the admin-only fallback (Rep-session rule) records `PASSED` on the Master record type, with the substitution listed.
- Click paths, the Quantity = 1 rule, the grid wait and the G6 Reprice All retry (*"…You cannot ask for this if the context hasn't been established."*, FP-8.24) are in the 8.31 and 8.32 rows.
- **Browse Catalogs** (8.33) is the eligibility-filtered alternative (needs 8.8 and 8.9b); Reprice All again after it.
- 8.30–8.33a are always 👤 HUMAN (Operating rules: web verification checks). Send the person the four steps in one message with the exact values and the Report back items, then verify each answer by REST before moving on. Browse Catalogs → Select Catalog → Next sets the Quote's price book even if the flow is then abandoned, which changes what 8.31 shows: re-read `Quote.Pricebook2Id` before 8.31 and again after 8.33.
- The stage path must show only the five `QUOTE_STAGES` and no "Mark Status as Complete" (8.16a). Extras remaining → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`.

**8.31 Empty price book picker: four read-only diagnostics, then act**

The picker is populated once 8.9b is in place; first confirm 8.9b and 8.10 read back as deployed, hard-reload, retry once. No price book on the Quote → go straight to the fallback.

| # | Diagnostic | Result | Action |
| :-- | :-- | :-- | :-- |
| 0 | The rep profile has a `Pricebook2-Price Book Layout` layout assignment (8.3; retrieve the profile) | Missing | Add it through 8.3, redeploy, reopen the picker once (FP-8.34) |
| | | Present | Go to 1 |
| 1 | `<PRICEBOOK_n>` is visible to the rep: query `Pricebook2` as `<FIELD_REP_USER>` (Login-As, 8.30a); without a rep session check the rep's permission sets for Read on Price Book and the `Pricebook2` org-wide default | No row / no access | Grant price book visibility, reopen the picker once |
| | | Row returned | Go to 2 |
| 2 | Active `PricebookEntry` rows for `<PRODUCT_n>` in the rep's currency (`User.DefaultCurrencyIsoCode`, 4.8) | No row | Create or activate the entries (Act 7), reopen once |
| | | Row returned | Go to 3 |
| 3 | The Quote's `CurrencyIsoCode` equals the rep's currency | Different | Recreate the Quote in the rep's currency (8.30), reopen once |
| | | Equal | Go to 4 |
| 4 | Network log on (Playwright) or the human reading the browser network panel: open the picker, record the price book request and response (empty, error, access denied) | Any | Record only; go to the fallback |

- Populated after an action → `PASSED`, note which diagnostic fixed it. Still empty → run the Browse Catalogs path of 8.33 for this one line even if `RUN_BROWSE_CATALOGS_CHECK = no` (it sets the price book), Reprice All (8.32), `PASSED_WITH_NOTES` with the four results.
- Diagnostics 1–3 pass and 4 shows no price book request at all: re-check diagnostic 0 first (the known signature of the missing `Pricebook2` layout assignment).

**8.34 Create Quote From Visit (API first, Admin Console fallback; not shown on the iPad in this release)**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldValues><dataType>PICKLIST</dataType><fieldName>ActionName</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue>CreateQuote</picklistValue></fieldValues>
    <fieldValues><dataType>BOOLEAN</dataType><fieldName>IsMobileOnly</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>TEXT</dataType><fieldName>Color</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>TEXT</dataType><fieldName>Profiles</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>SObject</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue>Visit</picklistValue></fieldValues>
    <fieldValues><dataType>INTEGER</dataType><fieldName>SortOrder</fieldName><hasBooleanValue>false</hasBooleanValue><integerValue>2</integerValue></fieldValues>
    <fieldValues><dataType>TEXT</dataType><fieldName>Icon</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>TEXT</dataType><fieldName>PermissionSets</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>Location</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue>Visit</picklistValue></fieldValues>
    <fieldValues><dataType>LONGTEXT</dataType><fieldName>RecordTypes</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <isActive>true</isActive>
    <isOrgLevel>false</isOrgLevel>
    <lifeSciConfigCategory>QuickAction</lifeSciConfigCategory>
    <masterLabel>Create Quote From Visit</masterLabel>
</LifeSciConfigRecord>
```
- This XML is the API-first record body (Metadata-API ZIP like 8.10; member and file name = DeveloperName `Create_Quote_From_Visit`, because the `masterLabel` contains spaces and is rejected). The Admin Console path in the row is the fallback (FP-8.14, FP-8.22). Scope is applied in 8.34a; leave Profiles, Permission Sets and Record Types empty here.
- Save the XML without the markdown fences (the ```` ```xml ```` lines are not part of the file). Read the field values back from Tooling `LifeSciConfigFieldValue` with the columns `FieldName`, `DataType`, `PicklistValue`, `IntegerValue`, `HasBooleanValue`, `TextValue`, `LongTextValue` (there is no `BooleanValue` column; a BOOLEAN's value is `HasBooleanValue`). The `QuickAction` category may already exist (label `QuickAction`): reuse it.
- The from-visit path that works on the iPad is the Visit Quoted Order tab → **New** (9.5 layout, 9.9 FlexiPage), with Visit and Account for Quote pre-filled. Build this action anyway; 13.2 records whether it appears.
- **Expected:** the record reads back active, the action does **not** appear in the iPad visit ••• menu (only Delete). Profile scope, a sync schema or Dynamic Actions do not change this; do not try them. `PASSED_WITH_NOTES` / `KNOWN_LIMITATION` (K13); do not change the visit page or this record.

**8.34a Apply the Store Check scope (after 9.5)**
The row applies. The only change to the 8.34 body is `<fieldValues><dataType>LONGTEXT</dataType><fieldName>RecordTypes</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue>Store_Check</longTextValue></fieldValues>` (member `Create_Quote_From_Visit`, no `<assignments>`, 9.5a).

**Web UI automation notes (Playwright).** General quirks are in the preamble, "Tools and browser automation", item 7. Here: `QuoteSettings`, Quote Document Settings and Quick Action fields commit on blur (Save, then re-open).

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Quote record type/layout | Dedicated record type + layout matching the Create New Quote fields; `Pricebook2Id` excluded | Setup → Object Manager → Quote | Layout retrieve diff |
| Tab visibility | `standard-Quote` and `lsc4ce__AccountFilter` visible to the field rep | App Launcher; `GET /services/data/v<API_VER>/tabs` | Tabs API for `<FIELD_REP_USER>` or `PermissionSetTabSetting` query (8.6) |
| FlexiPage | Highlights Panel, Stage Path, four tabs, 9-column line table, footer; 0 `@@@` labels | Quote record page (web) | Screenshot; retrieved page (8.9) |
| Record page assignment | Quote FlexiPage assigned to the rep, manager and admin profiles via `profileActionOverrides` | Quote record as each profile | App retrieve; Approval tab for manager, not rep |
| Compact layout | `<PFX>Quote_Compact` primary on Quote; Account for Quote in the iPad header | Device header after 10.8 | Counts compare (8.9c); 13.14 |
| Product Views / Last Order | `OrderProductViewsSettings` active (profile and org level) with both views; Priority Products on | Admin Console; Tooling | `LifeSciConfigRecord` query |
| STT / pricing routing | One STT bound to `<PRICING_PROCEDURE>`, link visible through `<PFX>STT_Procedure_Link`; `QuoteSettings` binds `Quote_Record_Type` to the shipped mobile TPT | Tooling | `FieldPermissions` + `SalesTransactionType` + `LifeSciConfigRecord` queries (8.11a, 8.14) |
| FLS | `Status`, `SalesTransactionTypeId`, `VisitId`, both address lookups Edit on `<FIELD_REP_PS>` (count = before + 5) | Setup → Permission Sets | Permission set retrieve |
| Approval and Work Guide | Approval tab on the Quote page; approver = owner's manager; flows Active, run-as `<NOTIFY_ADMIN_USER>` | Quote page; flows | `activeVersionNumber` = newest `VersionNumber`; Act 14 |
| Manager territory | `<MANAGER_USER>` assigned to `<TERRITORY>` (5.4a, re-checked 8.21c) | Setup → Territories | `UserTerritory2Association` query |
| Quote status path | Five `QUOTE_STAGES` only, ordered, no generic statuses | Quote record page | Screenshot + record type retrieve |
| Quote lifecycle | Draft/Submitted graph (no Submit in Act 8); unlock branch built; Reject and Approve exercised in Act 14 (K24 if Approve fails) | Mobile Stage Path; web `Status`; Flows | Graph read-back; handler and flows Active; Act 14 |
| DocGen / Document Builder | Flow Active (Status `Draft` before activation, never `InvalidDraft`); signature FlexiPage bound; default template set; disclaimer active | Admin Console; Flow Builder | Flow `ActiveVersionId` = `LatestVersionId` + Admin Console re-open |
| Web smoke test | Draft Quote, one line, repriced (`NetUnitPrice` populated) | Quote detail page | `CalculationStatus` + `QuoteLineItem` query |
| Create Quote From Visit | `QuickAction` record active for Visit (org level, scope in 8.34a); not shown in the iPad visit menu (K13) | Tooling | `LifeSciConfigRecord` by masterLabel |
| Known gaps (not fixed here) | nil-Status mobile defect, Submit-not-idempotent (G1), PDF-stuck-In-Progress (G2, K1; cause fixed by 8.24a), raw token on the packaged Store Check heading, intermittent reprice error (G6) | Appendix:GAPS | Repro notes above |

### Checkpoint 8

Report: status `PASSED` when every Act 8 postcondition passes, `PASSED_WITH_NOTES` when the only deviations are `KNOWN_LIMITATION` outcomes (for example K1, K24). The web Quote configuration is in place and create and price are proven; Act 8 does not Submit a quote (Act 14). 8.34a (the Create Quote From Visit scope) has not run yet: it runs after 9.5 and is reported in Checkpoint 9. The 8.10 product views need `<ASSORTMENT>` from 9.12 and are first exercised on the iPad. Changed: Quote `RecordType`/`Layout`/`FlexiPage` (incl. Approval tab), `CompactLayout` and `compactLayoutAssignment` on Quote, app `profileActionOverrides`, `<FIELD_REP_PROFILE>` and `<FIELD_REP_PS>` edits, `CustomApplication` tab membership, `OrderProductViewsSettings`/`QuoteSettings`/`QuickAction` `LifeSciConfigRecord`s, `SalesTransactionType` (STT link) and `<PFX>STT_Procedure_Link`, `Quote.Status`/`DigitalSignatureType` `StandardValueSet`s, the `StagePathPermissionsHandler` trigger handler, lifecycle data graph, approval flows and notification type, `ServiceDocument` FlexiPage, DocGen `Flow`, signature `PermissionSet`, `ComplianceStatementDef`, Quote Document Settings. Reused: `<PRICING_PROCEDURE>`, `<CATALOG>`/`<PRICEBOOK_n>` from Act 7, `<FIELD_REP_PROFILE>`/`<FIELD_REP_PS>` from Act 4. Verified: web Draft-Quote smoke test (create → add line → reprice). Disclosures to the human: (1) Login-As left enabled if 8.30a (C12) was accepted; (2) `<MANAGER_USER>` assigned to `<TERRITORY>`; (3) the deploying admin (`<ADMIN_USER>`) was granted Document Builder access; (4) `<PFX>STT_Procedure_Link` is assigned to `<ADMIN_USER>` and the STT link set (8.11a); (5) the Browse Catalog currency fix from 7.18 was relied on; (6) the trigger handler is active org-wide; (7) the approval flows' background steps run as `<NOTIFY_ADMIN_USER>`; (8) the Quote compact layout is now the primary one. Side effect restated: the signature permission set alters the rep's access as recorded in Act 4. Open items: PDF stuck-"In Progress" root cause unresolved (platform-side, `KNOWN_LIMITATION`); unlock approval exercised only in Act 14; i18n raw-token defect open; nil-Status mobile New-Quote defect cross-referenced to Act 13. Actual duration: *(fill in at run time)*. Then ask: **"Act 8 is complete. Ready to continue to Act 9: Store Check & Visit Decoupling configuration?"**
## Act 9 — Store Check & Visit Decoupling configuration

**Purpose.** Turn on Store Check, decouple the Visit object so each Visit record type (In-Person, Remote, Store Check) routes to its own experience, build the Store Check assessment definition graph (3 tasks / 22 indicators) against the Act 7 catalog, and wire the Visit lifecycle (LifeSciStage path graph) so Begin/End Visit drive Planned → In Progress → Completed. **Estimated duration:** about 70 agent minutes + 20–35 human minutes (inputs step; the 9.9d and 9.23–9.25 web checks; legacy-override approval, only if 9.1 finds one; the 9.20a sharing-change approval on a `customer` org). **Depends on:** Act 2 (package: `LSStoreCheck`/`CoreCPQ`, `LifeSciencesCommercialAdmin`/`LifeSciencesFieldSalesRepresentative`), Act 3 (`enableLifeSciRecTypeRoutgPref` `true`), Act 4 (`<FIELD_REP_USER>`, `<FIELD_REP_PROFILE>`, `<FIELD_REP_PS>`), Act 5 (`<TERRITORY>` active, `<STORE_n>` Accounts + Places), Act 7 (`<PRODUCT_n>`, `<CATEGORY_n>`, `<PRIORITY_PRODUCTS>` in `<CATALOG>`).

### Story

Two things are irreversible: (1) removing an existing Visit New/Edit override pointing at `lsc4ce__LogAVisitAction` changes every existing HCP visit, so 9.2 stops and asks; (2) `IndustriesSettings.enableStoreCheck` and `enableLifeSciRecTypeRoutgPref` cannot be turned off once the package is active (`LSC4CEPackage=true`): disclosed, not gated.

**Known outcomes (record `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`, continue, do not stop):** (a) 9.9: no Quoted Order element in the layout editor; (b) Store Check sub-tabs (SC8) render only on an In-Progress iPad Visit, checked in 12.7; (c) the rep can edit indicator definitions and values via the packaged Modify All (9.21, K15); (d) web Begin Visit; (e) 9.5 read-back is semantically equal, not byte-identical; (f) the web Log a Visit cache message (9.23, 10.7a; K26).

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Turn on Store Check and set up Visit routing without disturbing the HCP flow." 🤖 Agent: confirms scope, runs the override precheck first and **stops** rather than deleting a legacy `lsc4ce__LogAVisitAction` override *(P1, P4)*. | `IndustriesSettings.enableStoreCheck`, `ObjectRecordTypeRoutingConfiguration`, `RecordType:Visit.*`; app/profile action-override read | Legacy override unknown until checked; detection covers common cases only. |
| 🧑‍💼 Admin: "I don't have real picklist values yet." 🤖 Agent: loads the defaults (`STORE_CHECK_COLUMNS` = `default`), changeable later *(P2)*; a re-run skips existing rows, a failure reports which exist *(P3, P5)*. | `AssessmentIndDefinedValue`; query-before-insert; reconciliation query | A row with the wrong `DataType` cannot be edited (FP-9.6). |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 9.in | Ask this Act's inputs: `STORE_CHECK_COLUMNS`, `TARGETS`, `VISIT_CHANNEL_VALUES`, `REP_VISIT_RECORD_TYPES` / `REP_VISIT_DEFAULT_RT`, `ADMIN_VISIT_ACCESS`, `SECONDARY_DISPLAY_TASK_TYPE`, `RESTOCK_DATE_TARGET`, `KPI_TYPE_MAP` | n/a | 👤 HUMAN — list each key still missing or `PENDING` in the frozen copy with its recommended answer from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Recommendations: `VISIT_CHANNEL_VALUES` = `In-Person, Remote, Phone, Email, WhatsApp, WeChat, SMS` (the picklist is empty on a fresh org); `ADMIN_VISIT_ACCESS` = `yes` when `ORG_KIND = test`, else `no`; `TARGETS`, when empty = Stock Count 10 and Facing 20 for every assortment product (Stock Count is needed by the anomaly test). `STORE_CHECK_COLUMNS` accepts `default` (the 22-indicator set with the Step details 9.17 values) or a customer-supplied set given as indicator rows with picklist values *(unverified — fallback: default)*; any other label (for example a screenshot-set name) is rejected at 9.in and re-asked. Fallback: use `default` and record `accepted recommendation`. **Non-blocking:** an unanswered key takes its recommendation. Validate, then write to the frozen copy and the manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING` | Keys already filled are not asked again; if none are missing, the step passes with no stop | — |
| 9.1 | Precheck: scan for a legacy Visit action override pointing at `lsc4ce__LogAVisitAction` outside the routing framework | `CustomObject:Visit` `actionOverrides`; `CustomApplication:lsc4ce__lifeSciencesCommercial` and `Profile:<FIELD_REP_PROFILE>` `profileActionOverrides` | Metadata API **retrieve** of `CustomObject:Visit`, the Life Sciences Commercial app and `<FIELD_REP_PROFILE>`; inspect the files (Step details 9.1). Not a Tooling query: `ActionOverride` is not a Tooling sObject | New and Edit on Visit are `Default` on every form factor and no app or profile override references `lsc4ce__LogAVisitAction` for Visit; or the override is found and reported. Must be clear before 9.5 | Read-only; safe to re-run | FP-9.8 |
| 9.2 | ⏸ STOP — legacy override found pointing at `lsc4ce__LogAVisitAction` on Visit New/Edit outside the routing framework | `ActionOverride` on Visit New/Edit | Only if 9.1 found an override other than `Default` (normally none on a new org: skip). Report the finding and consequence. On approval: retrieve the `Visit` `actionOverrides`, set New and Edit to `Default`, deploy only that object, re-retrieve and confirm nothing else changed. If the deploy is rejected, or 9.1 still finds it after an approved deploy: 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`) Setup → Object Manager → Visit → Buttons, Links & Actions → New/Edit → No override (default behavior) → Save; still present → stop `BLOCKED` and show the finding. **If the customer declines:** change nothing, do not use the UI path, record `declined` and stop `BLOCKED` (9.1 must be clear before 9.5). Run 9.7 in the same sitting | Re-run 9.1: no override on New or Edit | Skip if 9.1 found nothing | FP-9.8 |
| 9.3 | Confirm Store Check is on (enabled in step 3.1) | `IndustriesSettings.enableStoreCheck` | Read-only: retrieve `Industries.settings` | `enableStoreCheck=true`; `AssortmentProduct`, `RetailStoreKpi`, `StoreAssortment` describe successfully | `true` → `reused`; `false` → return to step 3.1 (proven only through the two-click UI, not a settings deploy) | — |
| 9.4 | Check whether the In-Person and Remote Visit record types exist | `RecordType:Visit.In_Person`, `RecordType:Visit.Remote` | **Data API** query `SELECT DeveloperName, IsActive FROM RecordType WHERE SobjectType='Visit'` (Tooling `RecordType` has no `DeveloperName`) | Both present and active → reuse. Absent → 9.4a and 9.4b (not a stop; the package installs no Visit record types, so a fresh org always needs 9.4b) | Query-only | — |
| 9.4a | Give `Visit.Channel` its picklist values (a fresh org has none, so Channel renders disabled) | `StandardValueSet:VisitChannel` | Describe `Visit.Channel`. No active values → use `VISIT_CHANNEL_VALUES` (9.in). Retrieve `StandardValueSet:VisitChannel` (rollback), add one `<standardValue>` per value, deploy it alone, describe again. A `CustomField:Visit.Channel` with a `valueSet` is rejected. If rejected or describe still lists no values, 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`): Setup → Object Manager → Visit → Fields & Relationships → Channel → Values → New. If still none, `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` (Channel stays disabled; 9.23 reports the Channel check as not met) and continue | Describe lists every requested value as active | Describe first; add only missing values | — |
| 9.4b | Create the `In_Person` and `Remote` Visit record types when 9.4 found them absent | `RecordType:Visit.In_Person` (label `In-Person`), `RecordType:Visit.Remote` (label `Remote`) | Metadata API deploy, 2 components. Default: no per-record-type Channel subset. If the customer asks for one, after 9.4a add `picklistValues` for `Channel` only (In-Person: In-Person default, Phone, Email, WhatsApp; Remote: Remote default, Phone, WeChat, SMS) and read back; if rejected, redeploy without it and record `PASSED_WITH_NOTES`. Without `picklistValues` a type offers every `Channel` value *(unverified for these two types — fallback: if 9.23 lists fewer than 7 for a type, add `picklistValues` with all 7 values and redeploy that type)*. Then re-run 9.4 | Data API query returns both, `IsActive=true` | Skip any that exists | — |
| 9.5 | Deploy Visit Store Check record type + layout + FlexiPage + app page overrides + profile entries + routing category + `Store_Check_New` routing record (7-component bundle) | `RecordType:Visit.Store_Check`, `Layout:Visit-Store Check Visit Record Page`, `FlexiPage:Store_Visit`, `CustomApplication:lsc4ce__lifeSciencesCommercial`, `Profile:<FIELD_REP_PROFILE>`, `LifeSciConfigCategory:ObjectRecordTypeRoutingConfiguration`, `LifeSciConfigRecord:Store_Check_New` | One Metadata API deploy, `rollbackOnError=true`, all 7 bodies in Step details 9.5. The app and profile files are the **retrieved full files plus the added elements** (Deploy safety rule). After 9.5 passes, run 8.34a (`QUOTE_FROM_VISIT_SCOPE`) | Deploy 7/7, 0 errors; read-back is **semantically equal** (whitespace-insensitive; platform defaults such as the `VisitPriority` picklist, category `type` `List` and `hasBooleanValue=false` allowed) | Query `Store_Check` RT + `LifeSciConfigRecord Store_Check_New`; skip if both present and active | FP-9.1 |
| 9.5a | Rule: QuickAction-category `LifeSciConfigRecord`s (for example `Create_Quote_From_Visit`) carry no assignments | `LifeSciConfigRecord` category `QuickAction` | Applies to 8.34 / 8.34a and later edits: deploy with `isOrgLevel` **false** and **no** `<assignments>` block (the category rejects Profile- and User-level assignments; scope by `RecordTypes`, 8.34a). If an earlier deploy left a Profile-level assignment, redeploy without it | Tooling read-back of `Create_Quote_From_Visit`: `isOrgLevel = false`, no profile or user assignment | Read first; already clean → `reused` | FP-8.14 |
| 9.6 | Deploy `Store_Check_Edit` routing record (required: every routed record type needs both New and Edit) | `LifeSciConfigRecord:Store_Check_Edit` | Metadata API deploy, same category | `LifeSciConfigRecord` active, `Action=Edit`, `RecordType=Store_Check`, `SObjectName=Visit`, `ComponentName=LifeSciencesStandard`. Edit routing needs a saved Visit: checked on the first real Visit in Act 12 (`PASSED_WITH_NOTES`, `KNOWN_LIMITATION` until then) | Query by `DeveloperName`; skip if present | — |
| 9.7 | Deploy HCP (`In_Person`) and `Remote` New+Edit routing records (required: unmapped record types fall back to standard Salesforce New/Edit, not LogAVisit) | `LifeSciConfigRecord:HCP_Visit_New`, `HCP_Visit_Edit`, `Remote`, `Remote_Edit` | Metadata API deploy, same category, 4 components in one package | All 4 active, each `ComponentName=lsc4ce__LogAVisitAction` (create the two Remote rows only when the Remote record type exists, 9.4b); masterLabels `HCP Visit New`, `HCP Visit Edit`, `Remote`, `Remote Edit`; New on an In-Person and a Remote Visit still opens LogAVisit (checked in 9.23); the Edit routing needs a saved Visit and is checked at 12.3, not here | Query by `DeveloperName`; skip existing | FP-9.8 |
| 9.8 | Assign Visit record types to `<FIELD_REP_PROFILE>` and validate no duplicate/overlapping mappings | `Profile:<FIELD_REP_PROFILE>` `recordTypeVisibilities` | Metadata API deploy of the **retrieved full profile plus** `recordTypeVisibilities` for `REP_VISIT_RECORD_TYPES` visible, `REP_VISIT_DEFAULT_RT` as default (Deploy safety rule); then the duplicate-key Tooling query (Step details 9.8) over the active routing rows | Profile shows all 3 RTs visible (retrieve also lists the three `RecordType` members, 4.2); zero duplicate `(RecordType, Action)` routing keys | Query profile RT visibility + routing table before deploy; skip unchanged rows | FP-9.2 |
| 9.8b | Make the Visit record types visible on the admin profile, Store Check the default (only if `ADMIN_VISIT_ACCESS = yes`; otherwise record `skipped`) | `Profile` `System Administrator` (`recordTypeVisibilities`) | Metadata API deploy of the **retrieved** System Administrator profile plus three `recordTypeVisibilities` entries: `Visit.In_Person` and `Visit.Remote` `visible=true`, `Visit.Store_Check` `visible=true`, `default=true`; change no other entry (Deploy safety rule: compare the profile's counts after; rollback: redeploy the retrieved copy). Without it the admin has only the Master Visit record type: Visits → New skips the record-type picker, opens the Master form, and Save fails "You don't have permission to create Visit records at this stage of the workflow" because the Visit lifecycle (9.11) does not accept Master (FP-9.10). The rep is not affected. The admin's Store Check Visit uses the same routing and lifecycle as the rep's (9.11a inserts one as the admin with the same record-type access). In-Person and Remote on web read the admin's own metadata cache, which 10.1c sets up in Act 10; until then they show the K26 message ("We couldn't perform this action because the metadata is out of date") for the admin as for the rep | Retrieved admin profile (manifest also lists the three `RecordType` members, per the 4.2 rule) shows the three Visit record types visible and `Store_Check` default; Visit describe as the admin: `Store_Check` `available=true` and `defaultRecordTypeMapping=true`, `In_Person` and `Remote` `available=true`. Optional 👤 HUMAN look, as the admin: Visits → **New** shows the record-type picker with Store Check pre-selected → **Cancel** (save nothing) | Retrieve profile → all three entries present and `Store_Check` default → `reused`; else merge and redeploy | FP-9.2, FP-9.10 |
| 9.9 | Add the Quoted Order tab to the Store Check Visit (FlexiPage tab; its list comes from the 9.5 layout `Quotes` related list) | `FlexiPage:Store_Visit` (Quoted Order tab); `Layout:Visit-Store Check Visit Record Page` (`Quotes` related list, deployed in 9.5) | (a) Describe Visit for the Quote child relationship name; (b) retrieve `Store_Visit`, add a Quoted Order tab with a Quote related list, deploy; (c) retrieve the layout and confirm the 9.5 `Quotes` related list (missing → add the 9.5 `<relatedLists>` block, deploy the layout alone). The iPad builds related lists from the layout | FlexiPage retrieve shows the Quoted Order tab using the described relationship name; layout retrieve shows `<relatedList>Quotes</relatedList>`. Rendering is checked in 13.2 (tab lists the visit's quotes with a **New** button on iPad and web) | Retrieve FlexiPage and layout; skip each part already present | FP-9.9 |
| 9.10 | Add Visits to web navigation via `subscriberTabs` + permission-set tab visibility | `CustomApplication:lsc4ce__lifeSciencesCommercial` (`subscriberTabs`), `PermissionSet:<FIELD_REP_PS>` (`tabSettings`) | Metadata API deploy, 2 components together (either alone leaves the tab hidden). **Retrieve both first and deploy the full files** (Deploy safety rule): app + `subscriberTabs`; `<FIELD_REP_PS>` + the one `tabSettings` element. **Never deploy the snippets below as the file.** | App `subscriberTabs` includes `standard-Visit`; `<FIELD_REP_PS>` tab setting `standard-Visit` visible (read-back may show `DefaultOn`). **Integrity (must pass before 9.11):** PS label unchanged; object, field and tab-setting counts equal `.pre` (tab settings +1); rep still has Read on `SalesTransactionType` and the Acts 7–8 Quote field permissions; `PermissionSetAssignment` for `<FIELD_REP_USER>` exists (re-create if not) | Retrieve both; skip if already set. If a count dropped, redeploy `.pre` plus the tab element and re-check | FP-9.1 |
| 9.11 | Build the Visit lifecycle `LifeSciStage` path graph (12 rows + 3 manual shares = 15 subrequests) | `LifeSciStageObject`, `LifeSciStagePath`, `LifeSciStageValue` ×3, `LifeSciStageOperation` ×3, `LifeSciStageAction` ×2, `LifeSciStageOperationAction` ×2, `LifeSciStageObjectShare` ×1, `LifeSciStageActionShare` ×2 | One Composite request (`allOrNone=true`, 15 subrequests) using the full body in Step details 9.11, guarded by a query of the Store Check path; every stage row carries its `SourceSystemIdentifier` key (Step details 8.18, *Stage record keys*) | 15 rows created (fewer when the stage object is reused); `<FIELD_REP_USER>` `UserRecordAccess`=Read on all 12 graph rows and Edit on none; every row's `SourceSystemIdentifier` equals its key. The endpoint check needs a Visit, so it runs in 9.11a | Path with `SourceSystemIdentifier` = `Visit_Store_Check`, or a path on the `Store_Check` record type named `Store Check Visit Lifecycle` → reuse (backfill empty keys); an existing `Visit` stage object is reused, never duplicated | FP-9.3, FP-9.4, FP-8.36 |
| 9.11a | Prove the graph on one disposable Store Check Visit, then remove it | Temporary `PermissionSet`, one `Visit` | (1) Deploy a temporary permission set `<PFX>Tmp_Visit_SC_RT` (label `Tmp Visit Store Check RT`; only `<recordTypeVisibilities><recordType>Visit.Store_Check</recordType><visible>true</visible></recordTypeVisibilities>` and `<hasActivationRequired>false</hasActivationRequired>`; the admin profile cannot use that record type, even from Apex) and assign it to the admin. (2) Insert one Planned Visit with `OwnerId` = `<ID:FIELD_REP_USER>` (so the rep can open it at 9.9d; an admin-owned Visit is not visible to the rep), record type `Store_Check`, at `<STORE_1>` (Account, `PlaceId` = the store's billing-address Place, `PlannedVisitStartTime` = now + 1 day, `PlannedVisitEndTime` = start + 1 hour, `InstructionDescription` = `TEMP_9.11A`; `PlaceId` and `PlannedVisitStartTime` are the only required fields). (3) `GET /connect/regulated-content/state-governance/path-association?recordId=<VisitId>&objectApiName=Visit`. (4) Set Status to In Progress and try to delete the Visit: the delete must be blocked. (5) Set Status back to Planned (delete works only at Planned), delete the Visit, unassign the set and remove it with a destructive deploy (empty `package.xml` plus `destructiveChanges.xml` naming the set). (3b) Run 9.9d now, while the Visit still exists; it is a numbered sub-step of this step, not a separate one | Endpoint returns the Active path with 3 nodes, Begin Visit at Planned, End Visit at In Progress; delete blocked while In Progress; afterwards 0 Visits and no temporary set remain. The endpoint's `label` is the action `Name` (`BeginVisit`); iPad button text is confirmed in 12.x | Leftover check, run first: `SELECT Id FROM Visit WHERE InstructionDescription='TEMP_9.11A'` and `SELECT Id FROM PermissionSet WHERE Name='<PFX>Tmp_Visit_SC_RT'` (assignments: `SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name='<PFX>Tmp_Visit_SC_RT'`); clean up any found (Status back to Planned, delete, unassign, destructive deploy) | FP-9.3, FP-9.4 |
| 9.9d | Make the web Visit page use `Store_Visit` for the Store Check record type (runs as sub-step (3b) of 9.11a, after its step (3) and before (4)) | `FlexiPage:Store_Visit` activation (app, record type and profile assignment) | 👤 HUMAN check: the person, as `<FIELD_REP_USER>` (Rep-session rule; Setup → Users → **Login** next to `<FIELD_REP_USER>`), opens the disposable Visit and reports the tab names with a screenshot (if the rep cannot open it, do this on the first real Visit in 12.2 and record that). The rep session can stay open for 9.23. `Store_Visit` (Details, Store Check, Quoted Order) shown → nothing to do. The write paths below are fallbacks: on a clean 9.5 deploy the page is already `Store_Visit`, and they have not been reached on a fresh org. Default page (Details, Related) shown → first retrieve `CustomApplication:lsc4ce__lifeSciencesCommercial` (the `.pre` rollback copy); if the `Store_Visit` `profileActionOverrides` from 9.5 (`View`, `Visit`, `Visit.Store_Check`, `<FIELD_REP_PROFILE>`, Large and Small) are missing, add them to the retrieved file, deploy the app alone (Deploy safety), re-retrieve and reopen the Visit. Overrides already present, deploy rejected, or page still default → 🖱️ UI (Playwright; 👤 HUMAN only if `PLAYWRIGHT_AVAILABLE = no`) Lightning App Builder → `Store_Visit` → Activation → **App, Record Type, and Profile** → Life Sciences Commercial / `Store_Check` / `<FIELD_REP_PROFILE>`, Desktop and Phone → Save, reopen the Visit. Then retrieve the app as the new `.pre` baseline | The rep's web Visit page is `Store_Visit`. Still default after one activation → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` (web only; the iPad uses the 9.5 overrides) | Read-only check first; activate only if the default page shows | FP-9.9 |
| 9.12 | Create Store Check Assortment(s) + link `<PRODUCT_n>`/`<PRIORITY_PRODUCTS>` via `AssortmentProduct`; create `StoreAssortment` per `<STORE_n>` | `Assortment`, `AssortmentProduct`, `StoreAssortment` | Composite `allOrNone=true` / Apex, `UsageType='StoreCheck'`, `Assortment.StartDate` and `StoreAssortment.StartDate` = today (required), priority products `AssortmentProduct.IsRequired=true` | `Assortment` + `StoreAssortment` queryable for `<ASSORTMENT>`; `IsRequired` matches `<PRIORITY_PRODUCTS>` | Query `Assortment` by `Name`; skip existing; add only missing `AssortmentProduct` rows | — |
| 9.13 | Create `AssessmentTaskDefinition` ×3 (Availability Audit, Primary Display, Secondary Display) | `AssessmentTaskDefinition` | Anonymous Apex, idempotent. Before insert, describe `AssessmentTaskDefinition.TaskType` and record the valid values | 3 rows, `TaskType` set per task from the described values | Query by `Name`; skip existing | — |
| 9.14 | Create `AssessmentIndicatorDefinition` — Availability Audit (8 indicators) | `AssessmentIndicatorDefinition` | Anonymous Apex, idempotent. Describe the `DataType` picklist once (Step details 9.14) before any insert: `DataType` cannot be changed after insert | 8 rows under Availability Audit (see Step details 9.14), each `DataType` from the described list | Query by `Name`; skip existing; if an existing row has the wrong `DataType`, see FP-9.6 | FP-9.6 |
| 9.15 | Create `AssessmentIndicatorDefinition` — Primary Display (7 indicators) | `AssessmentIndicatorDefinition` | As 9.14 | 7 rows under Primary Display (Step details 9.14–9.16), each `DataType` from the described list | As 9.14 | FP-9.6 |
| 9.16 | Create `AssessmentIndicatorDefinition` — Secondary Display (7 indicators) | `AssessmentIndicatorDefinition` | As 9.14 | 7 rows under Secondary Display (Step details 9.14–9.16), each `DataType` from the described list | As 9.14 | FP-9.6 |
| 9.17 | Create `AssessmentIndDefinedValue` picklist values for every picklist-type indicator | `AssessmentIndDefinedValue` | Anonymous Apex, idempotent; `Value` and `SequenceNumber` per row (no default flag exists; Step details 9.17) | Each picklist indicator has ≥2 ordered values, `SequenceNumber` 1..n, no gaps (default set: 12 lists, 46 rows). "Not Applicable" pre-selection is an Act 12 check, not a 9.17 criterion | Query by parent indicator + `Value`; skip existing | — |
| 9.18 | Create `AssessmentTaskIndDefinition` junctions (22 links, display order) | `AssessmentTaskIndDefinition` | Anonymous Apex, idempotent; column order set by `DisplayOrder` | 22 junction rows, `IsExcluded=false`, `DisplayOrder` matches the column order in Step details 9.18; Act 12 confirms the rendered order | Query by (task, indicator) pair; skip existing | — |
| 9.19 | Create `RetailStoreKpi` targets per `<TARGETS>` for numeric/currency indicators × `AssortmentProduct` | `RetailStoreKpi` | Anonymous Apex or Composite, idempotent, `CustomContextId=AssortmentProduct.Id`. Targets are **typed fields** by the indicator's `DataType`: Number → `TargetIntegerValue`, Decimal → `TargetDecimalValue`, Currency → `TargetPrice`, Boolean → `TargetBooleanValue`, DateTime → `TargetDateTimeValue`, String → `TargetStringValue` (no generic target field) | KPI rows exist for **Stock Count (`KpiType=Inventory`) and Facing (`KpiType=Facing`)** for every assortment product. `TARGETS` is never empty here (9.in applies the Stock Count 10 / Facing 20 default). Other indicators get a target only through `KPI_TYPE_MAP` (Step details 9.19) | Query by `(AssessmentIndDefinitionId, CustomContextId)`; skip existing | — |
| 9.20 | Create `ActionPlanTemplate` ×3 + version(Final) + items + item values + assignment to the `StoreAssortment` | `ActionPlanTemplate`, `ActionPlanTemplateVersion`, `ActionPlanTemplateItem`, `ActionPlanTemplateItemValue`, `ActionPlanTemplateAssignment` | Anonymous Apex, idempotent; **never** insert a version: the platform auto-creates the Draft; add the item and its two values **to it**, `UPDATE` it to `Final`, then insert the assignment (Step details 9.20) | 3 templates, each with exactly 1 `ActionPlanTemplateVersion` row (`Final`), one item and two item values, assigned to the `StoreAssortment` | Query `ActionPlanTemplate` by `UniqueName`; skip existing. More than one version row: do not repair, see FP-9.7 | FP-9.7 |
| 9.20a | ⏸ STOP — consent C13 (if `ORG_KIND = test`, C13 = `yes` at 0.11 and the C13 precondition passes, record `pre-consented (C13)` and act without stopping; otherwise ask live here, which is always the case on a `customer` org; record the answer in the manifest `consents`): set internal org-wide sharing to **Public Read Only** for `AssessmentIndicatorDefinition`, `AssessmentTaskDefinition` and `ProductTerritoryAvailability` | `CustomObject:AssessmentIndicatorDefinition`, `CustomObject:AssessmentTaskDefinition`, `CustomObject:ProductTerritoryAvailability` (`sharingModel`) | ⏸ Live stop unless pre-consented (above). Ask: "Set internal sharing to Public Read Only for these three objects? Every internal user gets Read; external sharing stays Private." Do not start 9.21 until answered. **Approve:** retrieve the three objects (rollback = redeploy them), then deploy three minimal `CustomObject` files with only `<sharingModel>Read</sharingModel>` (Step details 9.20a). **Decline:** change nothing, record `declined`; the explicit shares in 9.21 (incl. `AssessmentTaskDefinitionShare`) and 9.22 (incl. the PTA share) are then required. `ActionPlanTemplate` and `ProductTerrDtlAvailability` are not deployable as `CustomObject`, so their shares stay either way | `SELECT QualifiedApiName, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN ('AssessmentIndicatorDefinition','AssessmentTaskDefinition','ProductTerritoryAvailability')` → `InternalSharingModel = Read` on all three, external unchanged (approve); unchanged (decline) | Query first; already `Read` → `reused` (no stop) | — |
| 9.21 | Create runtime shares for `<FIELD_REP_USER>` (`AssortmentShare`, `ActionPlanTemplateShare`, `AssessmentTaskDefinitionShare`, `RetailStoreKpiShare`) | `*Share` objects | Anonymous Apex, idempotent, `AccessLevel='Read'`, `RowCause='Manual'`. `AssessmentTaskDefinitionShare` is optional only when 9.20a was approved and set that object to Read. Muting hardening (K15) only when `MUTE_INDICATOR_EDIT = yes` (Step details) *(unverified — fallback: skip)* | `<FIELD_REP_USER>` `UserRecordAccess`=Read (not Edit) on every Private parent row created in 9.12–9.20. Expected share rows: **10** after an approved 9.20a, **13** when declined (counts in Step details 9.21). **Known outcome (`KNOWN_LIMITATION` K15):** the rep keeps Edit on `AssessmentIndicatorDefinition` and `AssessmentIndDefinedValue` through the packaged Modify All, whatever the org-wide default; note it in the Checkpoint, not a failure | Query existing share rows by `(ParentId, UserOrGroupId)`; skip existing | — |
| 9.22 | Create `ProductTerritoryAvailability` (+auto-generated `ProductTerrDtlAvailability`) + shares (PTA share optional only after an approved 9.20a; the PTDA share always stays) for **every product in the Store Check assortment** (the 9.12 `AssortmentProduct` set) for `<TERRITORY>` | `ProductTerritoryAvailability`, `ProductTerrDtlAvailability`, `ProductTerritoryAvailabilityShare`, `ProductTerrDtlAvailabilityShare` | Anonymous Apex: insert PTA (`Status='Queued'`, `Purpose='Visit'`, `UsageType='LifeSciences'`); the platform sets `Active` and auto-generates PTDA (one row per product); then insert the shares per product (2, or 1 PTDA share after an approved 9.20a) | PTA `Status=Active` and PTDA `IsActive=true` for every assortment product; `<FIELD_REP_USER>` `UserRecordAccess`=Read (not Edit) on both. Expected shares for 3 products: 6 (3 after an approved 9.20a). Act 7's Purpose=Quote rows are separate | Query PTA by `(ProductId, TerritoryId, Purpose)`; skip existing | — |
| 9.22a | Give the All Visits list view explicit columns (web list check SC1) | `ListView:Visit.All_Visit` (deployed through `CustomObject:Visit`) | **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** first (org-wide list view). Retrieve `CustomObject:Visit` (retrieving `ListView:Visit.All_Visit` alone fails); keep the original as rollback. If the retrieve has no `All_Visit` (the platform creates it without a Metadata save), save `GET ui-api/list-info/Visit/All_Visit` as the rollback and deploy the whole list view, e.g. source file `objects/Visit/listViews/All_Visit.listView-meta.xml`: `<ListView><fullName>All_Visit</fullName>` + the 8 `<columns>` below + `<filterScope>Everything</filterScope><label>All</label></ListView>` (proven on a test org). Set the list view's `columns` to these **8** field names: `Name`, `Account`, `RecordType`, `Status`, `PlannedVisitStartTime`, `PlannedVisitEndTime`, `VisitPriority`, `Visitor`, and deploy the full list view. `NAME` and `ACCOUNT.NAME` fail validation. Disclose: org-wide list view, every user sees the columns | `ui-api/list-info/Visit/All_Visit` `displayColumns` lists all 8 (Name, Account, Record Type, Status, Planned Start Time, Planned End Time, Visit Priority, Visitor). Headers show on screen once the first Visit exists | Retrieve first; skip if the eight columns are present | — |
| 9.23 | 👤 HUMAN (web check, as the rep; the agent compares the report with the Per-screen checklist) — verify Visit RT picker and New Visit form render as designed | n/a | The person, as `<FIELD_REP_USER>` (Rep-session rule; Setup → Users → **Login** next to `<FIELD_REP_USER>`): (1) Visits tab → note the list view columns (SC1); (2) the list view's **New** button (not a direct `/lightning/o/Visit/new` URL, which skips the picker) → note the record types listed and which is pre-selected; ignore the territory selector (SC2); (3) **Store Check** → Next → note the form fields and whether Channel is editable with the 9.4a values (SC3) → **Cancel**; (4) New → **In-Person** → Next → wait up to 30 s, note what loads → **Cancel**; (5) New → **Remote** → Next → same → **Cancel**. **Report back:** SC1 columns; SC2 record types and the pre-selected one; SC3 fields and Channel values; what (4) and (5) load, with the exact text of any message; one screenshot per screen. Agent cross-check for SC3: do **not** use `describe/layouts/<Store_Check RT>` as the admin (it returns the caller's layout): verify from the deployed layout file plus the rep-profile assignment | Picker shows 3 RTs with Store Check pre-selected (SC2); New Visit form shows Account, *Place, Record Type (read-only), Planned End Time, Parent Organization, *Planned Start Time, Channel, and Channel is enabled with the 9.4a values (SC3); Visits list columns per 9.22a (SC1); New → In-Person and New → Remote route to the Log a Visit component (can take >15 s; the route is the pass criterion: before Act 10 the component shows "Translation Language Settings for the required languages or the initial metadata cache are missing" because the rep has no cache yet → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` K26; the form itself must load at 10.7a, after 10.1b). **Not checked here:** Store Check sub-tabs (SC8, In-Progress iPad Visit only) and Edit routing (needs a saved Visit) move to 12.7 and Act 12. **Cancel the New Visit form; do not save** (a Visit saved here is planned on another day and is not reused at 12.3). A blank Store Check tab on a Planned web Visit is expected (SC8 renders only on an In-Progress iPad Visit). Screenshots to receive: SC1 list columns, SC2 picker, SC3 form, In-Person → Next, Remote → Next | Re-run is non-destructive, read-only | — |
| 9.24 | Rep field access for the Quote Summary footer and the free-goods column | `FieldPermissions` on `<FIELD_REP_PS>`: `Quote.GrandTotal`, `QuoteLineItem.AdditionalFreeItemQty` | Two REST `POST /sobjects/FieldPermissions` bodies (`ParentId` = the `<FIELD_REP_PS>` Id, `SobjectType` `Quote` / `QuoteLineItem`): `Quote.GrandTotal` Read only (calculated; `PermissionsEdit=false`); `QuoteLineItem.AdditionalFreeItemQty` Read **and Edit** (reps add free items). Without them the footer has no Grand Total and the 8.9 grid lacks the free-quantity column. FLS reaches the iPad only through the generated cache (10.3) | `SELECT Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId = '<ID:FIELD_REP_PS>' AND Field IN ('Quote.GrandTotal','QuoteLineItem.AdditionalFreeItemQty')` returns 2 rows (Read; Read + Edit). Rep web (👤 HUMAN, in the 9.23 rep session; without a rep session the FLS query is the evidence and the render is checked at 13.x): the person opens `<PFX>Web_Quote_1` and reports whether the footer shows Grand Total and the line grid the free-quantity column (look only; save nothing); after Act 10 the cache marks the field updateable | Query first; same flags → `reused`; else create or update | FP-8.10 |
| 9.25 | Store Account record page (replaces the packaged HCP page for store accounts) | `FlexiPage` `lsc4ce_Store_Account_Record` (new); `CustomApplication` `lsc4ce__lifeSciencesCommercial` (`profileActionOverrides`) | Metadata API. (1) Deploy the new Account record page (highlights header; tabs **Details** and **Related**; standard tab titles; template `flexipage:recordHomeSingleColTemplateDesktop`); (2) **retrieve the app, merge** one `profileActionOverrides` entry (Step details 9.25) and deploy the app alone. The packaged `lsc4ce__AccountHCP` page stays the **app default** for Person Accounts. (The packaged HCP page shows store accounts "No access to the following entities: healthcareprovider" and raw `{!$Label.…}` tab names.) Reaches the iPad via 10.3 | Retrieved app carries the override for (`Account.Business_Account`, `<FIELD_REP_PROFILE>`) and no change to the app-level Account override; the person (👤 HUMAN, in the 9.23 rep session) opens a store account on web with a hard reload (Cmd+Shift+R, or Ctrl+Shift+R; an open tab keeps serving the packaged HCP page) and, after Act 10 and a sync, on the iPad, and reports: Details and Related tabs, no error banner, no raw label text; `ui.json` in the Act 10 cache contains the page (10.7) | Retrieve app → override present → `reused`; else merge and redeploy | FP-8.5 |
| 9.26 | Photo save: give the rep access to the `Image` object | `ObjectPermissions` on `<FIELD_REP_PS>` for `Image` | REST `POST /sobjects/ObjectPermissions` (ParentId = the `<FIELD_REP_PS>` Id, `SobjectType=Image`, `PermissionsRead`, `PermissionsCreate`, `PermissionsEdit` = true). `Image` has no FLS fields. The matching sync configuration is deployed in **10.1a**; without both halves the iPad photo save fails. The photo file reaches the server in the background after the Image record; photos taken earlier have no file | `SELECT PermissionsRead, PermissionsCreate, PermissionsEdit FROM ObjectPermissions WHERE ParentId = '<ID:FIELD_REP_PS>' AND SobjectType = 'Image'` → one row, all three true | Query first; present → `reused`; else create | — |

#### Step details

**9.1 Legacy override precheck**
```bash
# Metadata API retrieve — action overrides are readable only this way (the Tooling API has no ActionOverride object)
sf project retrieve start --metadata "CustomObject:Visit" "CustomApplication:lsc4ce__lifeSciencesCommercial" "Profile:<FIELD_REP_PROFILE>"
# then inspect: Visit.object actionOverrides (actionName New / Edit, type), and profileActionOverrides / actionOverrides in the app and profile
```
- Clear means: `New` and `Edit` on Visit are `Default` on every form factor and nothing in the retrieved app or profile references `lsc4ce__LogAVisitAction` for Visit (expected on a blank org: skip 9.2). UI fallback: Setup → Object Manager → Visit → Buttons, Links & Actions → New / Edit. On an upgraded org remove the override (9.2) before 9.5–9.7, since it makes Visit New/Edit ignore the routing table; removal waits for approval.

**9.4a–9.4b Channel values and the two base record types**
```xml
<!-- RecordType:Visit.In_Person -->
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>In_Person</fullName><active>true</active><label>In-Person</label></RecordType>
<!-- RecordType:Visit.Remote -->
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Remote</fullName><active>true</active><label>Remote</label></RecordType>
```
- 9.4a body: `<StandardValueSet xmlns="http://soap.sforce.com/2006/04/metadata"><sorted>false</sorted><standardValue><fullName>In-Person</fullName><default>false</default><label>In-Person</label></standardValue>…one entry per value…</StandardValueSet>`, file `standardValueSets/VisitChannel.standardValueSet-meta.xml`.
- The record types can deploy before or after 9.4a.

**9.5 Visit Store Check 7-component bundle**
```
RecordType:Visit.Store_Check
Layout:Visit-Store Check Visit Record Page
FlexiPage:Store_Visit
CustomApplication:lsc4ce__lifeSciencesCommercial     (retrieved full app + 2 profileActionOverrides, bodies below)
Profile:<FIELD_REP_PROFILE>                           (retrieved full profile + 1 layoutAssignments entry, body below)
LifeSciConfigCategory:ObjectRecordTypeRoutingConfiguration
LifeSciConfigRecord:Store_Check_New
```
- `Settings:Industries` (`enableLifeSciRecTypeRoutgPref`) is deliberately **not** in this bundle; that flip is Act 3's.
- `Store_Check_New` payload:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldValues><dataType>PICKLIST</dataType><fieldName>Action</fieldName><picklistValue>New</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>RecordType</fieldName><picklistValue>Store_Check</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>SObjectName</fieldName><picklistValue>Visit</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>ComponentName</fieldName><picklistValue>LifeSciencesStandard</picklistValue></fieldValues>
    <isActive>true</isActive>
    <isOrgLevel>true</isOrgLevel>
    <lifeSciConfigCategory>ObjectRecordTypeRoutingConfiguration</lifeSciConfigCategory>
    <masterLabel>Store Check New</masterLabel>
</LifeSciConfigRecord>
```

The six bodies that are not `Store_Check_New` (copy as written):
```xml
<!-- RecordType:Visit.Store_Check -->
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Store_Check</fullName><active>true</active><label>Store Check</label></RecordType>
```
```xml
<!-- Layout:Visit-Store Check Visit Record Page : the 7 SC3 fields (Per-screen acceptance checklist) + the Quotes related list (feeds the Quoted Order tab, 9.9) -->
<Layout xmlns="http://soap.sforce.com/2006/04/metadata">
    <layoutSections>
        <customLabel>false</customLabel><detailHeading>false</detailHeading><editHeading>true</editHeading><label>Information</label>
        <layoutColumns>
            <layoutItems><behavior>Edit</behavior><field>AccountId</field></layoutItems>
            <layoutItems><behavior>Required</behavior><field>PlaceId</field></layoutItems>
            <layoutItems><behavior>Readonly</behavior><field>RecordTypeId</field></layoutItems>
            <layoutItems><behavior>Edit</behavior><field>PlannedVisitEndTime</field></layoutItems>
        </layoutColumns>
        <layoutColumns>
            <layoutItems><behavior>Edit</behavior><field>ParentOrganizationId</field></layoutItems>
            <layoutItems><behavior>Required</behavior><field>PlannedVisitStartTime</field></layoutItems>
            <layoutItems><behavior>Edit</behavior><field>Channel</field></layoutItems>
        </layoutColumns>
        <style>TwoColumnsTopToBottom</style>
    </layoutSections>
    <relatedLists>
        <fields>QUOTE.NAME</fields>
        <fields>QUOTE.STATUS</fields>
        <fields>QUOTE.TOTALPRICE</fields>
        <relatedList>Quotes</relatedList>
    </relatedLists>
    <showEmailCheckbox>false</showEmailCheckbox><showHighlightsPanel>false</showHighlightsPanel><showInteractionLogPanel>false</showInteractionLogPanel>
    <showRunAssignmentRulesCheckbox>false</showRunAssignmentRulesCheckbox><showSubmitAndAttachButton>false</showSubmitAndAttachButton>
</Layout>
```
```xml
<!-- FlexiPage:Store_Visit : template recordHomeSingleColTemplateDesktop; header = highlights panel + stage path; tabset = Details (active) + Store Check -->
<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <flexiPageRegions><itemInstances><componentInstance>
        <componentInstanceProperties><name>collapsed</name><value>false</value></componentInstanceProperties>
        <componentInstanceProperties><name>enableActionsConfiguration</name><value>false</value></componentInstanceProperties>
        <componentInstanceProperties><name>enableActionsInNative</name><value>false</value></componentInstanceProperties>
        <componentInstanceProperties><name>hideChatterActions</name><value>false</value></componentInstanceProperties>
        <componentInstanceProperties><name>numVisibleActions</name><value>3</value></componentInstanceProperties>
        <componentName>force:highlightsPanel</componentName><identifier>force_highlightsPanel</identifier>
    </componentInstance></itemInstances>
    <itemInstances><componentInstance><componentName>lsc4ce:LifeSciStagePathContainer</componentName><identifier>lsc4ce_LifeSciStagePathContainer</identifier></componentInstance></itemInstances>
    <name>header</name><type>Region</type></flexiPageRegions>
    <flexiPageRegions><itemInstances><componentInstance><componentName>force:detailPanel</componentName><identifier>force_detailPanel</identifier></componentInstance></itemInstances><name>details</name><type>Facet</type></flexiPageRegions>
    <!-- The Store Check tab body is the standard Store Check record-page component (listed as "Store Check" under Standard in Lightning App Builder) -->
    <flexiPageRegions><itemInstances><componentInstance><componentName>ls_storecheck:lsStoreCheckVisit</componentName><identifier>ls_storecheck_lsStoreCheckVisit</identifier></componentInstance></itemInstances><name>storeCheck</name><type>Facet</type></flexiPageRegions>
    <flexiPageRegions>
        <itemInstances><componentInstance>
            <componentInstanceProperties><name>active</name><value>true</value></componentInstanceProperties>
            <componentInstanceProperties><name>body</name><value>details</value></componentInstanceProperties>
            <componentInstanceProperties><name>title</name><value>Standard.Tab.detail</value></componentInstanceProperties>
            <componentName>flexipage:tab</componentName><identifier>detailsTab</identifier>
        </componentInstance></itemInstances>
        <itemInstances><componentInstance>
            <componentInstanceProperties><name>body</name><value>storeCheck</value></componentInstanceProperties>
            <componentInstanceProperties><name>title</name><value>Store Check</value></componentInstanceProperties>
            <componentName>flexipage:tab</componentName><identifier>storeCheckTab</identifier>
        </componentInstance></itemInstances>
        <name>tabs</name><type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions><itemInstances><componentInstance>
        <componentInstanceProperties><name>label</name><value>Tabs</value></componentInstanceProperties>
        <componentInstanceProperties><name>tabs</name><value>tabs</value></componentInstanceProperties>
        <componentName>flexipage:tabset</componentName><identifier>flexipage_tabset</identifier>
    </componentInstance></itemInstances><name>main</name><type>Region</type></flexiPageRegions>
    <masterLabel>Store Visit</masterLabel><sobjectType>Visit</sobjectType>
    <template><name>flexipage:recordHomeSingleColTemplateDesktop</name></template><type>RecordPage</type>
</FlexiPage>
```
```xml
<!-- CustomApplication:lsc4ce__lifeSciencesCommercial : ADD these two elements to the RETRIEVED full app (keep every existing element). Scope = this profile + this record type only -->
<profileActionOverrides><actionName>View</actionName><content>Store_Visit</content><formFactor>Large</formFactor><pageOrSobjectType>Visit</pageOrSobjectType><recordType>Visit.Store_Check</recordType><type>Flexipage</type><profile><FIELD_REP_PROFILE></profile></profileActionOverrides>
<profileActionOverrides><actionName>View</actionName><content>Store_Visit</content><formFactor>Small</formFactor><pageOrSobjectType>Visit</pageOrSobjectType><recordType>Visit.Store_Check</recordType><type>Flexipage</type><profile><FIELD_REP_PROFILE></profile></profileActionOverrides>
```
```xml
<!-- Profile:<FIELD_REP_PROFILE> : creating Visit.Store_Check already added a layoutAssignments entry for this record type (Visit-Visit Layout) to every profile; in the RETRIEVED full profile REPLACE that entry's layout with this one, never add a second entry for the same record type -->
<layoutAssignments><layout>Visit-Store Check Visit Record Page</layout><recordType>Visit.Store_Check</recordType></layoutAssignments>
```
```xml
<!-- LifeSciConfigCategory:ObjectRecordTypeRoutingConfiguration (deploys as its own metadata type) -->
<LifeSciConfigCategory xmlns="http://soap.sforce.com/2006/04/metadata"><category>ObjectRecordTypeRoutingConfiguration</category><masterLabel>ObjectRecordTypeRoutingConfiguration</masterLabel></LifeSciConfigCategory>
```
- The desktop template is accepted for the Small (phone) override.

**9.6 Store_Check_Edit (required)**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldValues><dataType>PICKLIST</dataType><fieldName>Action</fieldName><picklistValue>Edit</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>RecordType</fieldName><picklistValue>Store_Check</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>SObjectName</fieldName><picklistValue>Visit</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>ComponentName</fieldName><picklistValue>LifeSciencesStandard</picklistValue></fieldValues>
    <isActive>true</isActive>
    <isOrgLevel>true</isOrgLevel>
    <lifeSciConfigCategory>ObjectRecordTypeRoutingConfiguration</lifeSciConfigCategory>
    <masterLabel>Store Check Edit</masterLabel>
</LifeSciConfigRecord>
```
- Without this record, Edit on a Store Check Visit does not open the Store Check experience. Exercised on the first saved Visit (Act 12).

**9.7 HCP (`In_Person`) + `Remote` routing (required)**
```xml
<!-- HCP_Visit_New.lifeSciConfigRecord-meta.xml -->
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldValues><dataType>PICKLIST</dataType><fieldName>Action</fieldName><picklistValue>New</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>RecordType</fieldName><picklistValue>In_Person</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>SObjectName</fieldName><picklistValue>Visit</picklistValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>ComponentName</fieldName><picklistValue>lsc4ce__LogAVisitAction</picklistValue></fieldValues>
    <isActive>true</isActive><isOrgLevel>true</isOrgLevel>
    <lifeSciConfigCategory>ObjectRecordTypeRoutingConfiguration</lifeSciConfigCategory>
    <masterLabel>HCP Visit New</masterLabel>
</LifeSciConfigRecord>
<!-- HCP_Visit_Edit (masterLabel "HCP Visit Edit"): identical with Action=Edit. Remote (masterLabel "Remote") and Remote_Edit (masterLabel "Remote Edit"): identical with RecordType=Remote and the matching Action. Do not copy the "HCP Visit" labels onto the Remote records. -->
```
- With routing on, an unmapped record type falls back to standard New/Edit and a legacy direct override bypasses routing; every record type needs both New and Edit. → FP-9.8
- Some Visit Decoupling behaviours (Account prefill on New Visit; Record Type editable after choosing the Account) differ by release; no step depends on them (Checkpoint 9 open item).

**9.8 Profile record-type visibility**
```xml
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <recordTypeVisibilities><recordType>Visit.In_Person</recordType><default>false</default><visible>true</visible></recordTypeVisibilities>
    <recordTypeVisibilities><recordType>Visit.Remote</recordType><default>false</default><visible>true</visible></recordTypeVisibilities>
    <recordTypeVisibilities><recordType>Visit.Store_Check</recordType><default>true</default><visible>true</visible></recordTypeVisibilities>
</Profile>
```
- One visible RT auto-routes (no picker); 2+ get the Select Visit Type screen (SC2; expect 3 offered). The set and default come from `REP_VISIT_RECORD_TYPES` / `REP_VISIT_DEFAULT_RT` (XML shows the default: all three, default `Store_Check`); include only the listed types.
- UI equivalent (one or the other, not both): Setup → Profiles → `<FIELD_REP_PROFILE>` → Record Type Settings (Visit).
- Duplicate-key query (Tooling, `sf data query -t`): `SELECT LifeSciConfigRecordId, FieldName, PicklistValue FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecord.LifeSciConfigCategory.DeveloperName='ObjectRecordTypeRoutingConfiguration' AND LifeSciConfigRecord.IsActive=true AND FieldName IN ('SObjectName','RecordType','Action')`. Group the rows by `LifeSciConfigRecordId` (3 rows per record: 6 routing records = 18 rows after 9.7); build the key `SObjectName|RecordType|Action` per record; any key shared by two records is a duplicate, which fails 9.8: deactivate the newer record and re-run.
- Validation: the duplicate-key query above (zero duplicates); Admin Console → Entity Record Type Mapping shows the same table. Do not deploy a deliberate duplicate to test it.

**9.9 Quoted Order tab on the Store Check Visit (FlexiPage tab + layout `Quotes` related list; verified on iPad and web)**
(a) Find the Quote child relationship on Visit. The link field is `Quote.VisitId` (labelled "Related Store Visit"):
```bash
sf sobject describe --sobject Visit --json | jq '.result.childRelationships[] | select(.childSObject=="Quote" and .field=="VisitId") | .relationshipName'
```
(b) Web FlexiPage tab. Retrieve the deployed `Store_Visit`, then add one facet and one tab to its existing tabset:
```xml
<flexiPageRegions>
    <itemInstances>
        <componentInstance>
            <componentInstanceProperties><name>parentFieldApiName</name><value>Visit.Id</value></componentInstanceProperties>
            <componentInstanceProperties><name>relatedListApiName</name><value><QUOTE_CHILD_RELATIONSHIP></value></componentInstanceProperties>
            <componentInstanceProperties><name>relatedListComponentOverride</name><value>NONE</value></componentInstanceProperties>
            <componentInstanceProperties><name>rowsToDisplay</name><value>10</value></componentInstanceProperties>
            <componentInstanceProperties><name>showActionBar</name><value>true</value></componentInstanceProperties>
            <componentName>force:relatedListSingleContainer</componentName>
            <identifier>quotedOrderRelatedList</identifier>
        </componentInstance>
    </itemInstances>
    <name>quotedOrder</name>
    <type>Facet</type>
</flexiPageRegions>
<!-- in the existing flexipage:tabset: add a flexipage:tab with title "Quoted Order" and body = quotedOrder -->
```
- `<QUOTE_CHILD_RELATIONSHIP>` is the value from (a), expected `Visit` (the API relationship name, used only in this FlexiPage `relatedListApiName`); the layout's related-list token is `Quotes` (used only in the 9.5 layout and (c)). They are different names for one relationship; do not swap them. With the 9.5 `Quotes` related list in place, the tab lists only this Visit's quotes, and **New** opens the quote form with Visit and Account for Quote pre-filled. If (a) returns nothing, use `Visit` and log an `instruction_gap` learning. 13.4 confirms the link.
- Add Quoted Order as the last tab of the retrieved tabset (facets `details`, `storeCheck`, `quotedOrder`); do not rebuild the page. The web page for Store Check comes from the app's `profileActionOverrides` (9.5), else 9.9d.
- Deploy the page alone, so a rollback cannot touch the routing records.

(c) Layout check. Retrieve `Layout:Visit-Store Check Visit Record Page` and confirm it carries the `Quotes` related list deployed in 9.5 (`<relatedList>Quotes</relatedList>` with `QUOTE.NAME`, `QUOTE.STATUS`, `QUOTE.TOTALPRICE`). Missing (for example, layout saved from the editor after 9.5) → deploy the layout alone with the 9.5 `<relatedLists>` block, then regenerate the cache (Act 10, or 10.8 if Act 10 ran). → FP-9.9
- The layout editor has no Quoted Order element or **Go to Quoted Order** button; the `Quotes` related list is the whole mechanism (the tab is empty on the iPad without it). `Quote.VisitId` is not a valid token (`Invalid related list:Quote.VisitId`).
- The **Create Quote From Visit** action (8.34) does not appear in the iPad visit ••• menu in this release (K13). The from-visit path is Quoted Order → **New**.

**9.10 subscriberTabs (FP-9.1 root cause)**

Elements to ADD to the retrieved full files (Deploy safety rule): in `CustomApplication:lsc4ce__lifeSciencesCommercial` `<subscriberTabs>standard-Visit</subscriberTabs>` (subscriber-owned, not the packaged `<tabs>` list); in `PermissionSet:<FIELD_REP_PS>` `<tabSettings><tab>standard-Visit</tab><visibility>Visible</visibility></tabSettings>`. Then the 9.10 checks.
- **Never** add `<tabs>standard-Visit</tabs>` to the managed app: `Cannot modify managed object: entity=TabSetMember, component=null, state=MANAGED_INSTALLED - tab`.
- Known lag: right after deploy, `userNavItems`/`/tabs` may still omit Visit; not a failure, verify in an authenticated browser session.

**9.11 LifeSciStage lifecycle graph (12 rows + 3 shares)**

Guard, in order: (1) `SELECT Id, Name, SourceSystemIdentifier FROM LifeSciStagePath WHERE SourceSystemIdentifier = 'Visit_Store_Check' OR (Name = 'Store Check Visit Lifecycle' AND StageObjectRecordTypeId = '<ID:Visit.Store_Check>')` returns a row → reuse it: run the key backfill and read-back (Step details 8.18, *Stage record keys*), confirm the 3 shares, skip the rest. Another Active path already on the `Store_Check` record type with a different name → ⏸ STOP and show it (two active paths on one record type). (2) `SELECT Id, SourceSystemIdentifier FROM LifeSciStageObject WHERE ObjectName = 'Visit' ORDER BY CreatedDate LIMIT 1` returns a row → reuse it: drop the `obj` subrequest, replace every `@{obj.id}` with its Id, set its key to `Visit` only if empty, and drop `sObj` if the rep already has a share on it. An existing Visit stage object (for example from an admin-built Visit path) is not a reason to skip the Store Check path. (3) Run the collision check. Then POST one Composite request to `/services/data/v<API_VER>/composite` (`allOrNone=true`). `<ID:Visit.Store_Check>` = `SELECT Id FROM RecordType WHERE SobjectType='Visit' AND DeveloperName='Store_Check'` (1 row); `<ID:FIELD_REP_USER>` = the rep's user Id (Act 4). Describe `Visit` first: `Status` must list `Planned`, `InProgress` and `Completed` (these are the `FieldValue`s below); any missing → stop and show the list.
```json
{"allOrNone": true, "compositeRequest": [
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageObject","referenceId":"obj","body":{"Name":"Visit","ObjectName":"Visit","IsControlledByStagePath":true,"SourceSystemIdentifier":"Visit"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStagePath","referenceId":"path","body":{"Name":"Store Check Visit Lifecycle","LifeSciStageObjectId":"@{obj.id}","FieldApiName":"Status","StageObjectRecordTypeId":"<ID:Visit.Store_Check>","ScopeType":"Default","Parameters":"{}","Status":"Active","SourceSystemIdentifier":"Visit_Store_Check"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageValue","referenceId":"vPl","body":{"Name":"Planned","FieldValue":"Planned","LifeSciStagePathId":"@{path.id}","SourceSystemIdentifier":"PathNode_Visit_Planned"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageValue","referenceId":"vIp","body":{"Name":"In Progress","FieldValue":"InProgress","LifeSciStagePathId":"@{path.id}","SourceSystemIdentifier":"PathNode_Visit_InProgress"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageValue","referenceId":"vCo","body":{"Name":"Completed","FieldValue":"Completed","LifeSciStagePathId":"@{path.id}","SourceSystemIdentifier":"PathNode_Visit_Completed"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageOperation","referenceId":"opPl","body":{"Name":"Visit Planned","LifeSciStageValueId":"@{vPl.id}","LifeSciStageObjectId":"@{obj.id}","Type":"WorkflowPath","Priority":1,"CanCreate":true,"CanEdit":true,"CanDelete":true,"SourceSystemIdentifier":"Context_Visit_Planned"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageOperation","referenceId":"opIp","body":{"Name":"Visit In Progress","LifeSciStageValueId":"@{vIp.id}","LifeSciStageObjectId":"@{obj.id}","Type":"WorkflowPath","Priority":1,"CanCreate":true,"CanEdit":true,"CanDelete":false,"SourceSystemIdentifier":"Context_Visit_InProgress"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageOperation","referenceId":"opCo","body":{"Name":"Visit Completed","LifeSciStageValueId":"@{vCo.id}","LifeSciStageObjectId":"@{obj.id}","Type":"WorkflowPath","Priority":1,"CanCreate":false,"CanEdit":false,"CanDelete":false,"SourceSystemIdentifier":"Context_Visit_Completed"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageAction","referenceId":"aBegin","body":{"Name":"BeginVisit","Label":"Begin Visit","Type":"Component","Parameters":"{\"componentConfiguration\":{\"name\":\"ls_storecheck:visitWorkflowAction\",\"parameters\":{\"status\":\"InProgress\",\"startGeoLocation\":\"true\"}}}","LifeSciStageObjectId":"@{obj.id}","SourceSystemIdentifier":"Visit_BeginVisit"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageAction","referenceId":"aEnd","body":{"Name":"EndVisit","Label":"End Visit","Type":"Component","Parameters":"{\"componentConfiguration\":{\"name\":\"ls_storecheck:visitWorkflowAction\",\"parameters\":{\"status\":\"Completed\",\"startGeoLocation\":\"false\"}}}","LifeSciStageObjectId":"@{obj.id}","SourceSystemIdentifier":"Visit_EndVisit"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageOperationAction","referenceId":"lBegin","body":{"Name":"lPlannedBegin","LifeSciStageOperationId":"@{opPl.id}","LifeSciStageActionId":"@{aBegin.id}","DisplayOrder":1,"SourceSystemIdentifier":"ContextAction_Visit_Planned_BeginVisit"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageOperationAction","referenceId":"lEnd","body":{"Name":"lInProgressEnd","LifeSciStageOperationId":"@{opIp.id}","LifeSciStageActionId":"@{aEnd.id}","DisplayOrder":1,"SourceSystemIdentifier":"ContextAction_Visit_InProgress_EndVisit"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageObjectShare","referenceId":"sObj","body":{"ParentId":"@{obj.id}","UserOrGroupId":"<ID:FIELD_REP_USER>","AccessLevel":"Read","RowCause":"Manual"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageActionShare","referenceId":"sBegin","body":{"ParentId":"@{aBegin.id}","UserOrGroupId":"<ID:FIELD_REP_USER>","AccessLevel":"Read","RowCause":"Manual"}},
 {"method":"POST","url":"/services/data/v<API_VER>/sobjects/LifeSciStageActionShare","referenceId":"sEnd","body":{"ParentId":"@{aEnd.id}","UserOrGroupId":"<ID:FIELD_REP_USER>","AccessLevel":"Read","RowCause":"Manual"}}
]}
```
- Flags: Planned = create/edit/delete true; In Progress = edit only (blocks delete); Completed = all false. If iPad Begin Visit (12.5–12.6) fails to change the status, check the `Parameters` keys (`status`, `startGeoLocation`) first and log an `instruction_gap` learning.
- The path endpoint returns the action `Name` (`BeginVisit`) as `label`. Read the iPad button text in 12.5: if it reads "BeginVisit", set the action's `Name` to `Begin Visit`, batch a regeneration (10.8) and re-check; if it still differs, `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`.
- `LifeSciStageObject` and `LifeSciStageAction` have **Private** internal sharing: the 3 manual shares are mandatory or `<FIELD_REP_USER>` sees "We couldn't load the workflow path for this record" (FP-9.3).
- **Begin Visit is non-functional on web** (FP-9.4): the component never emits the completion event (spinner, no DML, no error). Do not attempt it on web; it works on iPad (Acts 11–12).

**9.12–9.13 Assortment / AssortmentProduct / StoreAssortment / AssessmentTaskDefinition**
```apex
Assortment a = new Assortment(Name='<ASSORTMENT>', UsageType='StoreCheck', StartDate=Date.today());
insert a;
// productIds = the Product2 Ids of <PRODUCT_n>; priority = the Set<Id> of <PRIORITY_PRODUCTS>; storeAccounts = the Account Ids of <STORE_n>
List<AssortmentProduct> aps = new List<AssortmentProduct>();
for (Id p : productIds) aps.add(new AssortmentProduct(AssortmentId=a.Id, ProductId=p, IsRequired=priority.contains(p)));
insert aps;
List<StoreAssortment> sas = new List<StoreAssortment>();
for (Id acc : storeAccounts) sas.add(new StoreAssortment(AssortmentId=a.Id, AccountId=acc, StartDate=Date.today()));
insert sas;
// Idempotent form: query Assortment by Name, AssortmentProduct by (AssortmentId, ProductId) and StoreAssortment by (AssortmentId, AccountId) first and insert only the missing rows
AssessmentTaskDefinition availabilityAudit = new AssessmentTaskDefinition(Name='Availability Audit', TaskType='InventoryCheck');
AssessmentTaskDefinition primaryDisplay   = new AssessmentTaskDefinition(Name='Primary Display',   TaskType='PlanogramCheck');
AssessmentTaskDefinition secondaryDisplay = new AssessmentTaskDefinition(Name='Secondary Display', TaskType='PlanogramCheck');
insert new List<AssessmentTaskDefinition>{availabilityAudit, primaryDisplay, secondaryDisplay};
```
- Reuse the Act 7 `<PRODUCT_n>` records; no parallel Product2 fixture.
- `TaskType`: Availability Audit = `InventoryCheck`, Primary Display = `PlanogramCheck`, Secondary Display = `PlanogramCheck` (`SECONDARY_DISPLAY_TASK_TYPE`). Described values: `InventoryCheck`, `PlanogramCheck`, `ConductInStoreSurveys`, `Other`. Value not in the described list → stop and show the list. Tab columns come from the junctions (9.18), not `TaskType`.

**9.14–9.16 AssessmentIndicatorDefinition — full 22-indicator set**

The `DataType` picklist offers `Number`, `Boolean`, `DateTime`, `String`, `Decimal`, `Picklist`, `Currency`: there is **no `Text`, `Date` or `Photo`/`Image`** (use `String` for text, `DateTime` for dates). **Before the first insert**, run `sf sobject describe --sobject AssessmentIndicatorDefinition` and record the `DataType` and `AssessmentKpi` values in the manifest; if `NoStock`, `StockQuantity` or `Facing` is not in the `AssessmentKpi` list (or a table `DataType` is not in the `DataType` list), stop and show the described list; `DataType` is required and not updatable (wrong value → delete and recreate, FP-9.6). **Photo and Verified are modeled outside the indicator object** (Photo = task-level image-capture control, sync in 10.1a; Verified = UI checkbox cleared after Save & Close): exactly 22 rows.

| Task | Indicator (`Name`) | `DataType` | Default Comparison Rule | `AssessmentKpi` |
|---|---|---|---|---|
| Availability Audit | No Stock | Boolean | n/a | `NoStock` |
| Availability Audit | Stock Count | Number | GreaterThanOrEqualsTo | `StockQuantity` |
| Availability Audit | Out-of-Stock Reason | Picklist | n/a | none |
| Availability Audit | Days of Cover | Number | n/a | none |
| Availability Audit | Distribution Status | Picklist | n/a | none |
| Availability Audit | Backroom Stock On-Hand | Number | GreaterThanOrEqualsTo | none |
| Availability Audit | Shelf Price | Currency | n/a | none |
| Availability Audit | Last Restock Date | `DateTime` (no `Date` value; see the rule below) | n/a | none |
| Primary Display | Facing | Number | n/a | `Facing` |
| Primary Display | Primary Location Present | Picklist | n/a | none |
| Primary Display | Share of Shelf (%) | Number | GreaterThanOrEqualsTo | none |
| Primary Display | Position | Picklist | n/a | none |
| Primary Display | Planogram Compliance | Picklist | n/a | none |
| Primary Display | Price Tag Display | Picklist | n/a | none |
| Primary Display | Adjacency Compliance | Picklist | n/a | none |
| Secondary Display | Secondary Display | Picklist | n/a | none |
| Secondary Display | Display Location | Picklist | n/a | none |
| Secondary Display | POSM | Picklist | n/a | none |
| Secondary Display | POSM Condition | Picklist | n/a | none |
| Secondary Display | Promotional Price Display | Picklist | n/a | none |
| Secondary Display | Promotional Price Value | Currency | n/a | none |
| Secondary Display | Secondary Display Units | Number | n/a | none |

- Primary Location Present, Planogram Compliance, Adjacency Compliance, Secondary Display and Promotional Price Display are `Picklist`, not `Boolean`, so that "Not Applicable" can be recorded. Do not switch them.
- Last Restock Date: `RetailStoreKpi` has only a date-time target slot and no target is set for this column (9.19). Rule: `RESTOCK_DATE_TARGET = yes` → `DateTime`; otherwise `Date` if the describe offers it, else `DateTime`. The standard `DataType` list is Number, Boolean, DateTime, String, Decimal, Picklist, Currency (no `Date`), so the result is `DateTime` in both cases unless the describe lists `Date`.
- `AssessmentKpi` is set only on No Stock (`NoStock`), Stock Count (`StockQuantity`) and **Facing** (`Facing`, exact match); `DefaultComparisonRule` = `GreaterThanOrEqualsTo` only on Stock Count, Backroom Stock On-Hand and Share of Shelf (%). Spell `Share of Shelf (%)` identically in the 9.18 lookups.
- On the iPad all 22 columns render across the three tabs (8 / 7 / 7); Act 12 checks the Availability Audit tab (8 indicators plus Photo) first for truncated or missing columns, and whether "Not Applicable" shows pre-selected (9.17 stores no default).
- Anomalies filter (SC10): not exercised here. In Act 12 enter a Stock Count below target and open Filters → Anomalies: product listed → `PASSED`; not listed → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`. Do not change indicator definitions to force it.
- Apex shape per row (repeat for all 22, idempotent by `Name`):
```apex
AssessmentIndicatorDefinition ind = new AssessmentIndicatorDefinition(
    Name='Stock Count', DataType='Number', AssessmentKpi='StockQuantity',   // Facing: Name='Facing', DataType='Number', AssessmentKpi='Facing'
    DefaultComparisonRule='GreaterThanOrEqualsTo');
insert ind;
```

**9.17 AssessmentIndDefinedValue — default picklist values (`STORE_CHECK_COLUMNS` = `default`)**

| Indicator | Default ordered values (`STORE_CHECK_COLUMNS` default set) |
|---|---|
| Out-of-Stock Reason | Out of Stock – Supplier; Out of Stock – Backroom Only; Discontinued; Not Applicable |
| Distribution Status | Fully Distributed; Partially Distributed; Not Distributed |
| Primary Location Present | Yes; No; Not Applicable |
| Position | Eye Level; Above Eye Level; Below Eye Level; End Cap; Not Applicable |
| Planogram Compliance | Compliant; Partially Compliant; Non-Compliant; Not Applicable |
| Price Tag Display | Correct; Incorrect; Missing; Not Applicable |
| Adjacency Compliance | Compliant; Non-Compliant; Not Applicable |
| Secondary Display | Yes; No; Not Applicable |
| Display Location | Front of Store; End Cap; Checkout; Aisle; Not Applicable |
| POSM | Shelf Talker; Header Card; Floor Decal; None; Not Applicable |
| POSM Condition | Good; Damaged; Missing; Not Applicable |
| Promotional Price Display | Yes; No; Not Applicable |

- A row carries `Value` and `SequenceNumber` only; **there is no default flag** (no `IsDefault`) on it, the indicator or the junction. Load each list in table order.

**9.18 AssessmentTaskIndDefinition** — one junction per indicator (22 total), `DisplayOrder` as listed per task (Availability Audit: No Stock, Stock Count, Out-of-Stock Reason, Days of Cover, Distribution Status, Backroom Stock On-Hand, Shelf Price, Last Restock Date; Primary Display: Primary Location Present, Facing, Share of Shelf (%), Position, Planogram Compliance, Price Tag Display, Adjacency Compliance; Secondary Display: Secondary Display, Display Location, POSM, POSM Condition, Promotional Price Display, Promotional Price Value, Secondary Display Units), `IsExcluded=false`.
- `DisplayOrder` 1..N on each task's junctions sets the column order. If Act 12 shows a different order, record it in the Gap journal and continue; do not rebuild the junctions.

**9.19 RetailStoreKpi**
```apex
// Per assortment product: productId = Product2 Id; assortmentProductId = AssortmentProduct.Id of (<ASSORTMENT>, productId); stockTarget = the Stock Count integer from TARGETS
Id stockCountIndId = [SELECT Id FROM AssessmentIndicatorDefinition WHERE Name = 'Stock Count'].Id;
RetailStoreKpi k = new RetailStoreKpi(
    KpiType='Inventory',               // Stock Count = Inventory; Facing = Facing; describe KpiType first; a value not listed -> stop and show the list
    AssessmentIndDefinitionId=stockCountIndId,
    CustomContextId=assortmentProductId,  // Custom Context = Assortment Product
    ProductId=productId, StartDate=Date.today(),
    TargetIntegerValue=stockTarget);   // typed field by DataType (9.19 row)
insert k;
```
- `KpiType` offers `Facing`, `ShareOfShelf`, `OutOfStock`, `Revenue`, `Price`, `Inventory`; describe it before insert; if `Inventory` or `Facing` is not listed, stop and show the list (9.19 never runs with a guessed value). For Facing add a record with `KpiType='Facing'`, `AssessmentIndDefinitionId` = the Facing indicator and `TargetIntegerValue` = the Facing target from `TARGETS` (recommended 20).
- `TARGETS` is never left empty (Stock Count needs a target for the KPI check and the Act 12 anomaly test): empty in 9.in → apply the default and tell the customer.
- The other 6 numeric/currency indicators (Days of Cover, Backroom Stock On-Hand, Shelf Price, Share of Shelf %, Promotional Price Value, Secondary Display Units) need a `KpiType` value. Rule: Stock Count → `Inventory` and Facing → `Facing` are fixed. For any other indicator in `<TARGETS>`, use its `KPI_TYPE_MAP` value if that value is in the described `KpiType` list. Otherwise skip that target, mark it in the manifest and log an `unexpected_value` learning; never insert a guessed value.
- `RetailStoreKpi` targets are **assortment-level, not store-level**: use separate assortments if `<TARGETS>` must vary per store.

**9.20 ActionPlanTemplate**
```apex
ActionPlanTemplate t = new ActionPlanTemplate(UniqueName='Availability_Audit', ActionPlanType='LSStoreCheck', TargetEntityType='Visit', IsAdHocItemCreationEnabled=false);
insert t; // platform auto-creates a Draft ActionPlanTemplateVersion
ActionPlanTemplateVersion v = [SELECT Id FROM ActionPlanTemplateVersion WHERE ActionPlanTemplateId = :t.Id];
v.Status = 'Final';
update v; // do NOT insert a second version — produces duplicate/orphan Draft versions (known defect in this release)
```
- Known defect: a template's `Status` is computed from **all** its version rows, including soft-deleted ones. With more than one, **Begin Store Check** breaks on the iPad; the extra row cannot be deleted (`ENTITY_IS_DELETED`). Workaround: leave the broken template unassigned, create a new one with a new `UniqueName`, assign that. → FP-9.7
- Repeat for Primary Display and Secondary Display (one task per template, each with exactly one version row). `UniqueName` = the task name with spaces replaced by `_`: `Availability_Audit`, `Primary_Display`, `Secondary_Display`; item `UniqueName` = that + `_Item`; template `Name` = the task name. One Apex run per template is one transaction: on any error nothing is kept, so re-run it. A template that exists with no `Final` version (query `ActionPlanTemplateVersion` by `Status`) is not reused: leave it unassigned and apply the FP-9.7 workaround. Full field shapes:
```apex
// t = the ActionPlanTemplate just inserted; v = its auto-created version (assert exactly 1 version row)
ActionPlanTemplateItem it = new ActionPlanTemplateItem(Name=<task name>, UniqueName=<UniqueName> + '_Item', ActionPlanTemplateVersionId=v.Id,
    ItemEntityType='AssessmentTask', DisplayOrder=1, IsRequired=false);
insert it;
insert new List<ActionPlanTemplateItemValue>{
    new ActionPlanTemplateItemValue(Name='Name', ActionPlanTemplateItemId=it.Id, ItemEntityFieldName='AssessmentTask.Name', ValueLiteral=<task name>),
    new ActionPlanTemplateItemValue(Name='AssessmentTaskDefinitionId', ActionPlanTemplateItemId=it.Id, ItemEntityFieldName='AssessmentTask.AssessmentTaskDefinitionId', ValueLiteral=<AssessmentTaskDefinition Id>)
};
v.Status = 'Final'; update v;   // items and values go in BEFORE this update
insert new ActionPlanTemplateAssignment(ActionPlanTemplateVersionId=v.Id, AssociatedObjectId=<StoreAssortment Id>);  // assign each version to the StoreAssortment
```
- Assign each version to the `StoreAssortment` (one per store), not the Assortment; set `Name=<task name>` on the template.
- `Final` templates are immutable: to change items, create a new template.

**9.20a Org-wide sharing (Public Read Only, internal)**

File `objects/<Object>.object-meta.xml` for each of the three objects: `<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><sharingModel>Read</sharingModel></CustomObject>`.
- Only `sharingModel` is in the file; external stays Private. The retrieved copies are the rollback; the `EntityDefinition` query in the row is the pass rule. Rollback: redeploy the retrieved copies. The explicit shares in 9.21 and 9.22 stay harmlessly.

**9.21 Runtime shares** — `ActionPlanTemplateShare`, `AssortmentShare`, `AssessmentTaskDefinitionShare`, `RetailStoreKpiShare`, all `AccessLevel='Read'`, `RowCause='Manual'`, to `<FIELD_REP_USER>`. Count = 1 per template + 1 per assortment + 1 per task definition (omitted after an approved 9.20a) + 1 per `RetailStoreKpi`. For 3 templates, 1 assortment, 3 task definitions, 3 products with two targets each: **10 after an approved 9.20a (3 + 1 + 6), 13 when declined (3 + 1 + 3 + 6)**.
- **Indicator definitions stay editable by the rep (`KNOWN_LIMITATION` K15).** The packaged `IndustriesVisit` permission set grants ModifyAll on both objects, overriding sharing whatever the 9.20a default. Record a note and continue. Runs only when `MUTE_INDICATOR_EDIT = yes` (default `no`, asked at 9.21: "Should indicator definitions be read-only for reps before go-live?"; recommended: accept K15 for the pilot) and the **C14 check ([Irreversible-action consent list](#irreversible-action-consent-list))** passes. If yes: a permission set group with that set plus a muting set turning ModifyAll off for both objects; never edit the packaged set *(unverified — fallback: if the muted group does not remove Edit, keep the limitation as accepted and record it)*.

**9.22 Product Territory Availability**
```apex
ProductTerritoryAvailability pta = new ProductTerritoryAvailability(
    ProductId=productId, TerritoryId=<ID:TERRITORY>,
    AlignmentType='Territory Inclusion', Purpose='Visit', UsageType='LifeSciences', Status='Queued');
insert pta; // platform synchronously flips Status -> Active and auto-generates the matching ProductTerrDtlAvailability row
// Then insert 1 ProductTerritoryAvailabilityShare + 1 ProductTerrDtlAvailabilityShare per product, Read/Manual, to <FIELD_REP_USER>
```
- Territory membership alone does **not** grant PTA/PTDA access; with a Private default both shares are required. After an approved 9.20a the PTA share is optional; keep the PTDA share (that object's default cannot be changed by deploy).
- `ProductTerrDtlAvailability` has no status column: active = `IsActive=true`. For 3 products: 3 PTA Active, 3 PTDA `IsActive`, 6 Read shares (3 after an approved 9.20a); rep Read on all, Edit on none.

**9.25 Store Account page and its business-account assignment**
```xml
<!-- FlexiPage lsc4ce_Store_Account_Record.flexipage-meta.xml (deployed as-is; 2/2 components) -->
<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata">
  <flexiPageRegions><itemInstances><componentInstance>
    <componentInstanceProperties><name>collapsed</name><value>false</value></componentInstanceProperties>
    <componentInstanceProperties><name>enableActionsConfiguration</name><value>false</value></componentInstanceProperties>
    <componentInstanceProperties><name>enableActionsInNative</name><value>false</value></componentInstanceProperties>
    <componentInstanceProperties><name>hideChatterActions</name><value>false</value></componentInstanceProperties>
    <componentInstanceProperties><name>numVisibleActions</name><value>3</value></componentInstanceProperties>
    <componentName>force:highlightsPanel</componentName><identifier>force_highlightsPanel</identifier>
  </componentInstance></itemInstances><name>header</name><type>Region</type></flexiPageRegions>
  <flexiPageRegions><itemInstances><componentInstance><componentName>force:detailPanel</componentName><identifier>force_detailPanel</identifier></componentInstance></itemInstances><name>details</name><type>Facet</type></flexiPageRegions>
  <flexiPageRegions><itemInstances><componentInstance><componentName>force:relatedListContainer</componentName><identifier>force_relatedListContainer</identifier></componentInstance></itemInstances><name>related</name><type>Facet</type></flexiPageRegions>
  <flexiPageRegions>
    <itemInstances><componentInstance>
      <componentInstanceProperties><name>active</name><value>true</value></componentInstanceProperties>
      <componentInstanceProperties><name>body</name><value>details</value></componentInstanceProperties>
      <componentInstanceProperties><name>title</name><value>Standard.Tab.detail</value></componentInstanceProperties>
      <componentName>flexipage:tab</componentName><identifier>detailsTab</identifier>
    </componentInstance></itemInstances>
    <itemInstances><componentInstance>
      <componentInstanceProperties><name>body</name><value>related</value></componentInstanceProperties>
      <componentInstanceProperties><name>title</name><value>Standard.Tab.relatedLists</value></componentInstanceProperties>
      <componentName>flexipage:tab</componentName><identifier>relatedTab</identifier>
    </componentInstance></itemInstances>
    <name>tabs</name><type>Facet</type>
  </flexiPageRegions>
  <flexiPageRegions><itemInstances><componentInstance>
    <componentInstanceProperties><name>label</name><value>Tabs</value></componentInstanceProperties>
    <componentInstanceProperties><name>tabs</name><value>tabs</value></componentInstanceProperties>
    <componentName>flexipage:tabset</componentName><identifier>flexipage_tabset</identifier>
  </componentInstance></itemInstances><name>main</name><type>Region</type></flexiPageRegions>
  <masterLabel>Store Account Record</masterLabel><sobjectType>Account</sobjectType>
  <template><name>flexipage:recordHomeSingleColTemplateDesktop</name></template><type>RecordPage</type>
</FlexiPage>

<!-- merge into the retrieved CustomApplication lsc4ce__lifeSciencesCommercial -->
<profileActionOverrides>
  <actionName>View</actionName>
  <content>lsc4ce_Store_Account_Record</content>
  <formFactor>Large</formFactor>
  <pageOrSobjectType>Account</pageOrSobjectType>
  <recordType>Account.Business_Account</recordType>
  <type>Flexipage</type>
  <profile><FIELD_REP_PROFILE></profile>
</profileActionOverrides>
```
- Use the **standard tab titles** (`Standard.Tab.detail`, `Standard.Tab.relatedLists`), never `{!$Label.…}` (custom labels are not shipped to the iPad). After the deploy retrieve the page and confirm both are standard tokens; else redeploy.
- Retrieve the app first and merge (Deploy safety rule); leave the app-level Account override (`lsc4ce__AccountHCP`) untouched (Person Accounts). Deploy the page before the app or together; re-retrieve the app afterwards as the new baseline.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Store Check enabled | `IndustriesSettings.enableStoreCheck=true` | Setup → Salesforce Go → Store Check | Settings metadata read-back |
| Visit record types | `In_Person`, `Remote` (created in 9.4b when absent), `Store_Check` all active; `Visit.Channel` has the 9.4a values | Object Manager → Visit → Record Types | Data API `RecordType` query + `Channel` describe |
| Routing table | 6 `LifeSciConfigRecord` rows (HCP New/Edit, Remote New/Edit, Store Check New/Edit), no duplicate `(RecordType, Action)` keys, no legacy direct override on Visit New/Edit | Life Sciences Admin Console → Entity Record Type Mapping | Tooling query + Admin Console review |
| Profile routing | `<FIELD_REP_PROFILE>` sees RT picker (multi-RT) or auto-routes (single-RT) | New Visit flow as `<FIELD_REP_USER>` | SC2 check |
| Visit page | Store Check Visit record page with its tabs plus a Quoted Order tab (from the 9.5 `Quotes` related list); Quoted Order → New starts a visit-linked quote (13.2). Web `Store_Visit` per 9.9d; All Visits columns per 9.22a | Visit record, Store_Check RT | FlexiPage + layout retrieve; render check in 13.2 |
| Web nav | `standard-Visit` visible to `<FIELD_REP_USER>` in `lsc4ce__lifeSciencesCommercial`; `<FIELD_REP_PS>` keeps its label, permissions and the rep's assignment | Authenticated browser session | `subscriberTabs` + `tabSettings` read-back, pre/post counts, `PermissionSetAssignment` query |
| Lifecycle path | Planned → In Progress → Completed with Begin/End Visit (web Begin Visit non-functional: iPad only); delete blocked while In Progress; disposable Visit gone; temporary permission set unassigned (it stays, reported at Checkpoint 9) | Visit record page | Path-association endpoint on the 9.11a Visit + browser check |
| Store Check tabs | 3 sub-tabs (Availability Audit, Primary Display, Secondary Display), 22 indicator columns, category grouping, Out of Stock/Priority filters live, Anomalies not exercised (Act 12) | Store Check tab on an In-Progress Visit (iPad, Act 12) | Definition-graph query + iPad check |
| Targets | `RetailStoreKpi` targets per `<TARGETS>` for Stock Count (`TargetIntegerValue`) and Facing (`TargetIntegerValue`) on every assortment product; other indicators only via `KPI_TYPE_MAP` | `RetailStoreKpi` records | SOQL query |
| Access | `<FIELD_REP_USER>` has Read (not Edit) on every Private parent row in the definition graph, stage graph, and PTA/PTDA. Known outcome: Edit remains on indicator definitions and defined values | `UserRecordAccess` | SOQL query |
| Rep FLS, Store Account page, photo access | `<FIELD_REP_PS>`: Read on `Quote.GrandTotal`, Read + Edit on `QuoteLineItem.AdditionalFreeItemQty` (9.24), Read/Create/Edit on `Image` (9.26); `lsc4ce_Store_Account_Record` assigned to `Account.Business_Account` for `<FIELD_REP_PROFILE>` (9.25); QuickAction config records: org level false, no assignments (9.5a) | Field Level Security; app `profileActionOverrides` | `FieldPermissions` / `ObjectPermissions` queries; app retrieve |
| Mobile/offline config | Not built here: settings/`DbSchema` categories and the mobile cache belong to Act 10 | — | — |

### Checkpoint 9
Report: status (`PASSED` / `PASSED_WITH_NOTES` / `BLOCKED` / `FAILED` / `AWAITING_CUSTOMER_VALIDATION`), changed / reused / verified, where to see it, open items, actual duration; update the run manifest. Also report: (1) the 9.10 integrity check against `.pre`; (2) every `KNOWN_LIMITATION` taken (9.9 layout editor, SC8 deferral, K15, web Begin Visit, K26) and the 9.20a answer (C13 approved / declined); (3) the 8.34a result (`QUOTE_FROM_VISIT_SCOPE` applied, or `all`); (4) Act 12 carry-overs: Store Check sub-tabs and counts (SC8), column order versus `DisplayOrder` (9.18), whether "Not Applicable" is pre-selected, Begin Visit button text, Edit routing to Log a Visit, the Place type (ContactPointAddress) on the Visit form; (5) the unassigned temporary permission set `<PFX>Tmp_Visit_SC_RT` left by 9.11a. Ask: **"Act 9 is complete. Ready to continue to Act 10: Single mobile metadata generation?"**

## Act 10 — Single mobile metadata generation

**Purpose.** Bundle every configuration record both Store Check and Quotes need for the iPad client — schemas, app/profile settings, and the Quotes tab entry — into one deploy, then generate and verify the one mobile metadata cache the device will load. **Estimated duration:** about 35 agent minutes (dominated by asynchronous generation) + 5–10 human minutes (the 10.7a web check; 5–20 when 10.0a finds records another profile already uses) **Depends on:** Acts 1–9 (all configuration this bundle packages, in particular Act 6 context, Act 7 catalog, price books and pricing, Act 8 Quote web config, Act 9 Store Check & Visit Decoupling)

### Story

Two parts must both succeed: a synchronous metadata deploy and an asynchronous generation request against a Connect REST endpoint. The admin creates only the **parent** `LifeSciMobileMetadataRecord` (`New`, then `ValidationCompleted`); the job walks it through `Loading`/`Processing` to `Active` and creates the rep-profile **child** itself (`Active`, carrying the cache document), normally in about 2 minutes. The runtime selects the `Active` record with the greatest `Name` (auto-number `LSMMR-…`). **The cache is a snapshot: any pricing, schema, settings, profile-tab, FLS or FlexiPage fix made after this Act (including in Acts 11–15) reaches the device only after a regeneration (a new parent, 10.3–10.7 again, batched — 10.8).**

Two failure modes give no error. A `DbSchema_*` record deployed without its pair (for example `DbSchema_QuoteLineItem` without `DbSchema_Pricebook2`) silently breaks a device screen (blank "Select Price Book"). And pricing files come back as empty `{}` unless the selectors line up: the org-wide Revenue Settings procedure (7.17), the profile-scoped `OrderProductViewsSettings.PricingProcedure` (8.10), the org-level `OrderProductViewsSettings` where 8.10b created one, and the `QuoteSettings_OrgLevel` binding to `lsc4ce_pricing_mobile_tpt` (8.14). The checks below are therefore positive checks.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Make Quotes and Store Check show up on the iPad." 🤖 Agent: bundles every schema and setting into one deploy, generates one cache, verifies it and polls on a bound *(P1, P4)*. | Metadata API deploy; `LifeSciConfigRecord`; Connect REST generate; `LifeSciMobileMetadataRecord` polling | Generation time is not controllable; the platform retries up to 600s×3. |
| 🧑‍💼 Admin: "Pricing isn't showing." 🤖 Agent: checks every pricing selector first *(P5)*, never calls the *download* action, and starts a fresh parent if generation stalls *(P3, P4)*. | `OrderProductViewsSettings` (profile-scoped, org-level), Revenue Settings org value, `QuoteSettings_OrgLevel` TPT binding; `ContentVersion` GET | A missing selector gives empty pricing files with no error. Re-posting generate against an `Active` or stuck parent errors. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 10.0a | Pre-check config-record name collisions | `LifeSciConfigRecord`, `LifeSciConfigAssignment` | Tooling: `SELECT DeveloperName, MasterLabel, IsOrgLevel, IsActive FROM LifeSciConfigRecord` and `SELECT LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment`; plus `SELECT LifeSciConfigRecordId, FieldName, DataType, HasBooleanValue, TextValue, IntegerValue, NumberValue, LongTextValue, DateValue, DateTimeValue, PicklistValue, UrlValue, PhoneValue, ObjectValue FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId IN (<Ids of the names below>)` for the field diff (the value sits in the column that matches `DataType`; booleans are in `HasBooleanValue`); classify every `DeveloperName` the 10.1/10.1a ZIP will deploy, comparing names case-insensitively (`DBSchema_Image` and `DbSchema_Image` are the same schema) | Every target name is: absent → create; deployed earlier in this run (its step record in the manifest lists the name) → 10.1 rule; present otherwise with a different payload → ⏸ STOP in the P5 format with the name, its current assignees and a field diff; deploy over it only on the customer's yes, after saving the retrieved record under `org-changes/backup/`. A deploy **adds** the file's `<assignments>` to the record and keeps the existing assignees, so the other profile keeps the schema. What changes for that profile is the payload (`WhereSoql`, `Status`, `EnableDataUploadNotification`, `MandatoryFields`; the 10.1 template has no `MandatoryFields` element, so a list the existing record carries is dropped). To keep the other profile's payload, deploy the retrieved record with the rep assignment added instead of the template body (as 10.1b does), and record which choice was made per record. Present with the same payload → reuse, adding the rep assignment only | Read-only | — |
| 10.1 | Deploy the full profile-scoped configuration bundle in one shot: every `DbSchema_*` `LifeSciConfigRecord` either feature needs, scoped to `<FIELD_REP_PROFILE>`, plus the org-level `ApplicationSettings_OrgLevel`, `ProfileBasedAppSettings_OrgLevel` and `StoreCheckSetting_OrgLevel` records, the two Store Check field sets (only `Store_Check_Attributes` is referenced; `AssortmentProductFieldSet` stays blank), and standard `Quote` tab visibility | `LifeSciConfigRecord` + `LifeSciConfigCategory` + `FieldSet` + `Profile.tabVisibilities` (Metadata-API-format ZIP with `package.xml` at the archive root, never source format — FP-8.14; `Custom-<FIELD_REP_PROFILE>` assignment on the profile-scoped records). Expected count = 53 `DbSchema_*` + 3 org-level = 56 `LifeSciConfigRecord`, + 4 categories + 2 field sets + 1 profile = **63 components** (61 if the customer opts out of field sets) | **The agent builds `package.xml` and every record body from Step details 10.1; there is no shipped manifest.** Every `DbSchema_*` body uses the same 12 field values (template in Step details): only `SObject` and `WhereSoql` vary, and the two settings-schema records differ as noted there. One merged file per record (fields + assignment + `isActive`/`isOrgLevel`): a single deploy activates the records. Then `sf project deploy start --metadata-dir <zip> --wait 30 --json` (`rollbackOnError=true` by default) | Deploy `status === "Succeeded"`; component count equals the manifest count exactly (**63**; a lower count is the silent-drop signature → FP-10.7). The rep profile's `standard-Quote` tab is `DefaultOn` (it is `Hidden` on a fresh org because earlier Acts granted the tab through the permission set, and the mobile navigation reads the profile) | Detect: Tooling API query of `LifeSciConfigRecord` by `DeveloperName` for each target record (same read path as 8.10); reuse if MasterLabel + payload already match, else include in bundle | → FP-8.14, FP-10.4, FP-10.7 |
| 10.1a | Photo sync configuration: four `DbSchema` records for the Store Check photo save (Image, ContentVersion, ContentDocument, ContentDocumentLink) | `LifeSciConfigRecord` `DbSchema_Image`, `DbSchema_ContentVersion`, `DbSchema_ContentDocument`, `DbSchema_ContentDocumentLink` (profile-scoped to `<FIELD_REP_PROFILE>`) | Metadata-API-format ZIP as in 10.1 (package member and file name = the record's `DeveloperName`); bodies copied from the `DbSchema_RetailVisitKpi` template of 10.1 with the values in Step details 10.1a. Prerequisite: rep access to `Image` (9.26). `AttachmentsSupport = BACKGROUND` on all four, delta date field `SystemModstamp`. **Do not deploy a plain `DbSchema_ContentDocumentLink`** (no `WhereSoql`/`MandatoryFields`): it breaks the whole sync with `MALFORMED_QUERY`. Run this before 10.3 | Deploy result `Succeeded` with 4 of 4 components. Read back by Tooling query on `DeveloperName`: all four active with the values below; absent after `Succeeded` = silent-drop signature (FP-10.7): redeploy once, then stop `BLOCKED` if still absent. After 10.3–10.7 the four cache schemas are `Valid` and `db.json`/`sobjects.json` carry them (58 active `DbSchema_*` with 10.1b − 2 = **56**, see 10.7). First device photo on a Store Check indicator: the sync succeeds and the photo saves, and its JPEG is linked to its Image record on the server (query `ContentDocumentLink` for the Image Id; poll every 60 s, max 5 min, after one sync cycle). Proven on a physical iPad (app build 266.0.0): three photos synced, each linked to its Image record within about 10 min of Save & Close, no `MALFORMED_QUERY`. Other outcomes: sync fails with `MALFORMED_QUERY` → deactivate `DbSchema_ContentDocumentLink` only, batch a regeneration (10.8), record `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` (photo file not uploaded); photo saves but no file link after 5 min → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` | Tooling query by `DeveloperName` → reuse if the values match; else include in the ZIP | FP-10.7 |
| 10.1b | Give the rep the `ProviderVisit` schema that web Log a Visit reads | `LifeSciConfigRecord` `DbSchema_ProviderVisit` (profile-scoped to `<FIELD_REP_PROFILE>`) | Tooling: `SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord WHERE DeveloperName = 'DbSchema_ProviderVisit'`. **Present** (orgs with an earlier mobile setup often have it, assigned to another profile): retrieve it (`--metadata "LifeSciConfigRecord:DbSchema_ProviderVisit"`), save the retrieve under `org-changes/backup/`, add `<assignments><assignedTo>Custom-<FIELD_REP_PROFILE></assignedTo><assignmentLevel>Profile</assignmentLevel></assignments>`, keep every other element, and deploy it as a one-record Metadata-API ZIP as in 10.1. **Absent:** build it from the 10.1 data template with `SObject` = `ProviderVisit` and the `Visit` `WhereSoql` from Step details 10.1 (the value the existing record carries) *(unverified — fallback: the absent case has not been run; if the deploy fails, or 10.7a still shows a cache message after one regeneration, stop `BLOCKED` with the deploy result)*. Kept separate from 10.1 so the 63-component count holds. Skip only if the customer does not want reps to use web Log a Visit; then 10.7a records K26 as `PASSED_WITH_NOTES`. Run before 10.3 | Deploy `Succeeded` with 1 of 1 component. Read-back: the record is active and its retrieve lists `Custom-<FIELD_REP_PROFILE>` next to any assignment it had before (a deploy adds assignments, it does not replace them). After 10.7, `sobjects.json` has `ProviderVisit` | Detect: rep assignment already present → reuse | FP-10.7 |
| 10.1c | Give the admin the same `DbSchema_*` assignments as the rep, so web In-Person / Remote load for the admin (only if `ADMIN_VISIT_ACCESS = yes`; otherwise record `skipped`) | `LifeSciConfigAssignment` (Tooling API) on each `DbSchema_*` record assigned to `<FIELD_REP_PROFILE>`, assigned to the `System Administrator` profile | Web Log a Visit (`lsc4ce__LAV`) reads the logged-in user's own cache (`Metadata<profile>` static resource), and the 10.4 generation builds one only for a profile assigned to `DbSchema_*` records; the admin profile has none, so without this the admin sees the K26 message. List the rep's rows: Tooling `SELECT LifeSciConfigRecordId, LifeSciConfigRecord.DeveloperName FROM LifeSciConfigAssignment WHERE AssignedToId = '<ID:FIELD_REP_PROFILE>' AND LifeSciConfigRecord.DeveloperName LIKE 'DbSchema_%'` (58 on a fresh org with 10.1b) and save it under `org-changes/backup/`. For each record not yet assigned to the admin: `POST /tooling/sobjects/LifeSciConfigAssignment` body `{"LifeSciConfigRecordId":"<record Id>","AssignedToId":"<ID:System Administrator profile>","AssignmentLevel":"Profile"}`; record each new Id (rollback: delete those rows, then regenerate). Do **not** add `<assignedTo>Custom-System Administrator</assignedTo>` to the record XML (it fails for a standard profile, as in 8.10a). Run after 10.1–10.1b and before 10.3. If Act 10 is already done, regenerate once through 10.8 | One new row per rep `DbSchema_*` row, none failed; a Tooling count of the admin's `DbSchema_*` rows equals the rep's. After 10.5: the job also creates a child for the admin profile, and the static resource `MetadataSystem_Administrator` exists and lists `sobjects/ProviderVisit/recordTypes/Master.json` and the Visit record types. Optional 👤 HUMAN look, as the admin: Visits → New → **In-Person** → Next opens the Visit Engagement form → **Cancel** | Detect: admin row already present for a record → skip that record | FP-9.10, FP-10.7 |
| 10.1d | Turn on Translation Workbench with an active language (web Log a Visit reads a translation file from the cache) | `Settings:Language` (`enableTranslationWorkbench`); Translation Language Settings (Setup) | Read first: `sf project retrieve start --metadata Settings:Language --target-org <ORG_ALIAS> --json` → `enableTranslationWorkbench`. Adding an active language is a Setup action, so this is a 👤 HUMAN admin step: **Translation Language Settings** → **Enable** (if off) → **Add** → Language = English (or the reps' language), **Active** checked → **Save**. Tell the admin before they start: org-wide setting. Run before 10.3 | Re-retrieved `enableTranslationWorkbench` = `true`; after 10.5 the 10.7 ZIP contains `translations/<lang>.json` and the static resource `MetadataTranslations_<lang>` exists. Without it, web Log a Visit shows "Translation Language Settings for the required languages or the initial metadata cache are missing" after Act 10 even with 10.1b in place (K26) | Detect: workbench on and the language Active → `reused` | FP-10.7 |
| 10.2 | Verify every paired schema landed together, not just individually | `LifeSciConfigRecord` query | `sf data query --use-tooling-api --query "SELECT DeveloperName, MasterLabel FROM LifeSciConfigRecord WHERE DeveloperName LIKE 'DbSchema_%'" --json`, then retrieve the paired records (metadata type `LifeSciConfigRecord`, e.g. `--metadata "LifeSciConfigRecord:DbSchema_*"`) and confirm each profile-scoped record has `<assignments>` with `assignedTo = Custom-<FIELD_REP_PROFILE>` (the 3 org-level records have none) | Both halves of every pair present: `DbSchema_Quote`+`DbSchema_QuoteLineItem`, `DbSchema_Pricebook2`+`DbSchema_PricebookEntry`, `DbSchema_PriceAdjustmentSchedule`+`DbSchema_PriceAdjustmentTier` | Detect → report missing half; else proceed | → FP-10.4 |
| 10.3 | Create one `LifeSciMobileMetadataRecord` parent and move it to `ValidationCompleted` | `LifeSciMobileMetadataRecord` | **Hard gate — generate once.** Before creating the parent, confirm every server-side prerequisite is deployed and read back: pricing — the final pricing procedure version is the only Active one, with `ResetToListForOverride` and the `CurrencyIsoCode` input on both tier steps (7.17 org procedure; STT link 7.16/7.17a; schedule and tier effective dates 7.10a); Quote layout `VisitId` (8.2); Quote record page `LifeScience_Quote_Record` with its 4 tabs, line-table `displayFields` and `enableQuickAdd` / `enableSidepanel` (8.9), its app assignment (8.9b) and the Quote compact layout (8.9c); `OrderProductViewsSettings` incl. waterfall statuses (8.10, and the org-level record from 8.10b if created); Quote FLS (8.13); `QuoteSettings_OrgLevel` TPT binding (8.14); Store Check on (9.3), the `Quotes` related list on the Store Check Visit layout and `Store_Visit` FlexiPage (9.5, 9.9), the Visit stage graph (9.11); rep FLS and object access from 9.24 and 9.26; `lsc4ce_Store_Account_Record` (9.25); the photo `DbSchema` records (10.1a); the rep assignment on `DbSchema_ProviderVisit` (10.1b); the admin `DbSchema_*` assignments when `ADMIN_VISIT_ACCESS = yes` (10.1c). Any item missing → finish it first (stop `BLOCKED: pre-generation gate`, list what is missing). Later changes go through 10.8. **Two calls** (creating as `ValidationCompleted` fails with "Metadata Record Can only be Created in New Status"): (1) `sf api request rest /services/data/v<API_VER>/sobjects/LifeSciMobileMetadataRecord --method POST --body @mmr-parent-create.json` (`Status` `New`); (2) `PATCH` `/services/data/v<API_VER>/sobjects/LifeSciMobileMetadataRecord/<ID:parentRec>` with `{"Status":"ValidationCompleted"}`. **No `Name`** (auto-number), **no `ProfileId`, no child record** (the job creates it). Bodies in Step details 10.3. REST steps 10.3, 10.4 and 10.6 run through `sf api request rest` (the thread's standard channel; *Tools and browser automation*); *(unverified — fallback: if that command is unavailable, create and update the parent as anonymous Apex `insert`/`update` of `LifeSciMobileMetadataRecord`, call the generate endpoint from Workbench REST Explorer, and download the file from the ContentVersion Files UI; if none is available, stop `BLOCKED: needs approval — REST access`)* | Exactly one new parent with `Status = "ValidationCompleted"` and a `Name` that sorts after every existing record | Detect: never reuse an existing parent regardless of status — create a fresh one per attempt. First `SELECT Status, COUNT(Id) FROM LifeSciMobileMetadataRecord GROUP BY Status` (Data API): Active records this run did not create → C14 check (C14l) before (1) | → FP-10.1, FP-10.2 |
| 10.4 | Request mobile metadata generation for the new parent | Connect REST `metadata/actions/generate` | `sf api request rest /services/data/v<API_VER>/connect/life-sciences/commercial/metadata/actions/generate --method POST --body @generate-request.json` | HTTP 202, body contains "Task enqueued for metadata cache generation." | Detect: n/a (always a new POST tied to the parent just created) | → FP-10.1 |
| 10.5 | Poll the parent to completion on a bounded schedule | `LifeSciMobileMetadataRecord.Status` | Query the parent every 30 s, max 40 attempts (~20 min); normal completion is about 2 min. If still not `Active` at the bound, run FP-10.2 once (mark the stuck parent `Inactive`, create one new parent per 10.3, poll it with the same bound); report `BLOCKED` with both Ids only if that parent also stalls. Never create a third without new approval | Parent `Status` goes `ValidationCompleted` → `Published` → `Loading` → `Processing` → `Active`; `Published`, `Loading` and `Processing` are in-flight (one vocabulary, also FP-10.2). The job creates the children itself (`Active`): one per profile assigned to the `DbSchema_*` records. On an org where another profile keeps assignments (10.0a, 10.1b) that profile gets a child too; this is expected. Do not pre-create or change a child. The generation error log may hold two warnings ("No ARC developer names found in Account FlexiPages" and "No StoreCheckFeature developer names found, skipping FlexiPage metadata collection"): record a note (`KNOWN_LIMITATION`); they are harmless when `Store_Visit` with its Store Check component is in `ui.json` (10.7) | Detect: if the parent is still in flight past the bound, leave it and report; never re-POST generate against it | → FP-10.2 |
| 10.6 | Download the generated cache for inspection | `ContentVersion` VersionData | Find the file: `SELECT Id, Name, ProfileId, MetadataDocumentId FROM LifeSciMobileMetadataRecord WHERE ParentMobileMetadataRecId = '<ID:parentRec>' AND ProfileId = '<ID:FIELD_REP_PROFILE>'` (the job-created rep child; without the `ProfileId` filter the query returns one row per assigned profile; `MetadataDocumentId` is a ContentDocument Id; if null on the child, read the parent), then `SELECT Id FROM ContentVersion WHERE ContentDocumentId = '<that Id>' AND IsLatest = true` → `capturedIds.childContentVersionId`. Then `sf api request rest /services/data/v<API_VER>/sobjects/ContentVersion/<ID:childContentVersionId>/VersionData -S ./mobile-cache-<PFX>.zip` (`-S` = `--stream-to-file`, binary; never redirect stdout into the ZIP; never `metadata/actions/download`) | File downloaded, non-zero size, valid ZIP | Detect → re-download is safe (read-only GET) | → FP-10.5 |
| 10.7 | Verify ZIP acceptance criteria | ZIP contents | Local unzip + inspect | **File count 13** (`ui.json`, `nav.json`, `permissions.json`, `config.json`, `ast.json`, `flows.json`, `reporting.json`, `contextDefinition.json`, `decisionTable.json`, `expressionSet.json`, `upsertAllowlist.json`, `sobjects.json`, `db.json`); `arcConfig.json` is optional (only with a relationship graph), and so is `translations/<lang>.json` (one per translation language; e.g. `translations/en_US.json` gives 14 files): extra translation files are expected, not a failure. `contextDefinition.json`/`decisionTable.json`/`expressionSet.json` non-empty and reference `<PRICING_PROCEDURE>` + `<CONTEXT_DEF>`; only the `ACTIVE` pricing version is serialized; `expressionSet.json` holds `ResetToListForOverride` and the `CurrencyIsoCode` input on both tier steps. `db.json`/`sobjects.json` list every active `DbSchema_*` schema **except the two whose SObject is `LifeSciConfigRecord`** (`DbSchema_ProfileBasedAppSettings`, `DbSchema_QuoteDocumentSettings`): active `DbSchema_*` records − 2 = 53 + 4 (10.1a) + 1 (10.1b) − 2 = **56 of 58** (55 of 57 if 10.1b was skipped). `LifeSciConfigRecord` is a Tooling-only setup object (not in the data API; no object permission can be granted), and `config.json` lists no settings records either. **Known outcome: `PASSED_WITH_NOTES`, tag `KNOWN_LIMITATION` (K7); do not stop, create a permission set or regenerate for this.** Settings delivery is confirmed on the device at 11.5. **Page changes are verified in `ui.json`** (not on the device; files sit under `<profile>/metadata/`; keys: `nav.json` top-level `standard-Quote`; `ui.json` `.flexiPages.Store_Visit`, `.flexiPages.lsc4ce_Store_Account_Record`, `.flexiPages.LifeScience_Quote_Record.flexiPageRegions`, `.pageLayouts["Quote-Quote Layout"]`): `nav.json` has a `standard-Quote` entry; `Store_Visit` holds the Store Check component and its Quoted Order tab; `lsc4ce_Store_Account_Record` is present; the `LifeScience_Quote_Record` page has the header with only highlights + stage path, the 4 tabs Quote Line Items \| Details \| Related \| Approval, the `transactionSummary` footer, `displayFields` with the 9 fields, `enableQuickAdd` / `enableSidepanel` true, 2 Details sections; the Quote layout carries `VisitId`; `sobjects.json` has a `ProviderVisit` entry (10.1b) and its `Quote` entry carries `"compactLayoutAssignment":"<PFX>Quote_Compact"` (8.9c). **0 `@@@` tokens in every `ui.json` page entry** (count them across the whole file; any token → back to 8.9, then 10.8, before Checkpoint 10; this is the last check before the device sync) | Detect: re-run 10.6/10.7 after a fix without redoing 10.3–10.5 only while the parent is still pre-`Active`; once `Active`, any fix needs a new parent (10.8) | → FP-10.3, FP-10.6 |
| 10.7a | 👤 HUMAN web re-check of the Log a Visit route (9.23 carry-over) | n/a | The person, as `<FIELD_REP_USER>` on web (Rep-session rule; Setup → Users → **Login** next to `<FIELD_REP_USER>`), in a new rep session after 10.1b: Visits → New → **In-Person** → Next, then **Remote** → Next, as in 9.23; cancel without saving. **Report back:** whether each form loads; the exact text and a screenshot of any modal | Both forms load (the Visit Engagement form renders Account, Place, Planned Start/End, Save/Submit; no modal). A modal "We couldn't perform this action because the metadata is out of date…" or "Translation Language Settings for the required languages or the initial metadata cache are missing" means the rep's cache has no `ProviderVisit` (K26): check the 10.1b assignment and `sobjects.json` (10.7), fix through 10.1b, regenerate once (10.8), then re-check in a new rep session. Still shown after that → `FAILED`, report in the P5 format; it does not block Act 11 (the iPad does not use this web component). 10.1b skipped by the customer → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION` (K26) | Read-only re-run | — |
| 10.8 | Regeneration rule for every later change (standing step; **batch changes, regenerate once**) | `LifeSciMobileMetadataRecord` | Make all pending changes first, then regenerate **exactly once** at the end of the current Act (its checkpoint), then **one** device sync (11.x) and **one** app relaunch. Triggers: any change to a `DbSchema_*` record or 10.1 `LifeSciConfigRecord`; the rep permission set's field or object permissions (9.24, 9.26); any FlexiPage, layout, compact layout or app page-assignment change (8.9, 8.9c, 9.25); the rep profile's tabs; pricing (Revenue Settings procedure, decision tables, expression sets, `QuoteSettings_OrgLevel`); price adjustment schedule and tier effective dates (7.10a); and `OrderProductViewsSettings` / `ApplicationSettings` / `QuoteSettings` changes incl. waterfall statuses (not in the ZIP files, but regenerating makes the device pick them up). Regeneration = 10.3 (new parent), 10.4, 10.5, 10.6, 10.7, the device sync and the relaunch. **FLS and page changes reach the iPad only through a new cache.** After the device syncs the new cache, fully close and reopen the app (physical iPad: swipe away and reopen; simulator: terminate and relaunch), then check the UI change. If it still does not show: present in `ui.json` → `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`; absent → the change was not deployed: fix it and regenerate once more | The newest parent is `Active`; its ZIP contains the fix (10.7); the device has synced it and the app was relaunched | Always a new parent; never re-POST generate against an `Active` one | → FP-10.1, FP-10.2 |

#### Step details

**10.1 Bundled configuration deploy**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>ApplicationSettings</members>
    <members>DbSchema</members>
    <members>ProfileBasedAppSettings</members>
    <members>StoreCheckSetting</members>
    <name>LifeSciConfigCategory</name>
  </types>
  <types>
    <!-- Store Check baseline: 39 profile-scoped DbSchema records -->
    <members>DbSchema_Account</members>
    <members>DbSchema_ActionPlan</members>
    <members>DbSchema_ActionPlanItem</members>
    <members>DbSchema_ActionPlanTemplate</members>
    <members>DbSchema_ActionPlanTemplateAssignment</members>
    <members>DbSchema_ActionPlanTemplateItem</members>
    <members>DbSchema_ActionPlanTemplateItemValue</members>
    <members>DbSchema_ActionPlanTemplateVersion</members>
    <members>DbSchema_AssessmentIndDefinedValue</members>
    <members>DbSchema_AssessmentIndValue</members>
    <members>DbSchema_AssessmentIndicatorDefinition</members>
    <members>DbSchema_AssessmentTask</members>
    <members>DbSchema_AssessmentTaskDefinition</members>
    <members>DbSchema_AssessmentTaskIndDefinition</members>
    <members>DbSchema_Assortment</members>
    <members>DbSchema_AssortmentProduct</members>
    <members>DbSchema_ContactPointAddress</members>
    <members>DbSchema_DeviceSyncTransactionRecord</members>
    <members>DbSchema_LifeSciProductAcctRstrc</members>
    <members>DbSchema_LifeSciStageAction</members>
    <members>DbSchema_LifeSciStageObject</members>
    <members>DbSchema_LifeSciStageOperation</members>
    <members>DbSchema_LifeSciStageOperationAction</members>
    <members>DbSchema_LifeSciStageOperationCondn</members>
    <members>DbSchema_LifeSciStagePath</members>
    <members>DbSchema_LifeSciStageValue</members>
    <members>DbSchema_ObjectTerritory2Association</members>
    <members>DbSchema_Product2</members>
    <members>DbSchema_ProductTerrDtlAvailability</members>
    <members>DbSchema_ProductTerritoryAvailability</members>
    <members>DbSchema_ProfileBasedAppSettings</members>
    <members>DbSchema_ProviderAcctTerritoryInfo</members>
    <members>DbSchema_RecordType</members>
    <members>DbSchema_RetailStoreKpi</members>
    <members>DbSchema_RetailVisitKpi</members>
    <members>DbSchema_StoreAssortment</members>
    <members>DbSchema_Territory2</members>
    <members>DbSchema_User</members>
    <members>DbSchema_Visit</members>
    <!-- Quote, pricing, signature and document additions -->
    <members>DbSchema_AppUsageAssignment</members>
    <members>DbSchema_ComplianceStatementDef</members>
    <members>DbSchema_DigitalSignature</members>
    <members>DbSchema_DocumentRecipient</members>
    <members>DbSchema_PriceAdjustmentSchedule</members>
    <members>DbSchema_PriceAdjustmentTier</members>
    <members>DbSchema_Pricebook2</members>
    <members>DbSchema_PricebookEntry</members>
    <members>DbSchema_ProductCategoryProduct</members>
    <members>DbSchema_Quote</members>
    <members>DbSchema_QuoteDocument</members>
    <members>DbSchema_QuoteDocumentSettings</members>
    <members>DbSchema_QuoteLineItem</members>
    <members>DbSchema_SalesTransactionType</members>
    <!-- App settings -->
    <members>ApplicationSettings_OrgLevel</members>
    <members>ProfileBasedAppSettings_OrgLevel</members>
    <members>StoreCheckSetting_OrgLevel</members>
    <name>LifeSciConfigRecord</name>
  </types>
  <types>
    <members>AssortmentProduct.Store_Check_Fields</members>
    <members>Product2.Store_Check_Attributes</members>
    <name>FieldSet</name>
  </types>
  <types>
    <members><FIELD_REP_PROFILE></members>
    <name>Profile</name>
  </types>
  <version><API_VER></version>
</Package>
```

**Category bodies** (`lifeSciConfigCategories/<Name>.lifeSciConfigCategory`; reuse a category that already exists): `category` and `masterLabel` = the name; `DbSchema` has `<type>List</type>`, and `ApplicationSettings`, `ProfileBasedAppSettings` and `StoreCheckSetting` have `<type>Hierarchical</type>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifeSciConfigCategory xmlns="http://soap.sforce.com/2006/04/metadata">
    <category>StoreCheckSetting</category>
    <masterLabel>StoreCheckSetting</masterLabel>
    <type>Hierarchical</type>
</LifeSciConfigCategory>
```

Build `package.xml` from the member list above and each record from the templates below. The package member and file name (`lifeSciConfigRecords/<DeveloperName>.lifeSciConfigRecord`) are the record's **`DeveloperName`**, scoped to the rep profile inside the record, not by a suffix. ZIP layout: `package.xml`, `lifeSciConfigCategories/<Name>.lifeSciConfigCategory`, `lifeSciConfigRecords/<DeveloperName>.lifeSciConfigRecord`, `objects/Product2.object` and `objects/AssortmentProduct.object` (each holding a `<fieldSets>` element with the field set's inner `<fullName>`; no extra object `fullName`, or the deploy rejects the duplicate), `profiles/<FIELD_REP_PROFILE>.profile`. **Every data `DbSchema` body carries the same 12 field values; only `SObject` and `WhereSoql` vary.** One merged file per record:

```xml
<LifeSciConfigRecord xmlns="http://soap.sforce.com/2006/04/metadata">
    <assignments><assignedTo>Custom-<FIELD_REP_PROFILE></assignedTo><assignmentLevel>Profile</assignmentLevel></assignments>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>AttachmentsSupport</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>Type</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue>DATA</picklistValue></fieldValues>
    <fieldValues><dataType>TEXT</dataType><fieldName>Category</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>OBJECT</dataType><fieldName>SObject</fieldName><hasBooleanValue>false</hasBooleanValue><objectValue><SOBJECT_API_NAME></objectValue></fieldValues>
    <fieldValues><dataType>BOOLEAN</dataType><fieldName>OneWaySync</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>FIELD</dataType><fieldName>DeltaDateField</fieldName><fieldValue>LastModifiedDate</fieldValue><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>LONGTEXT</dataType><fieldName>PermissionSets</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>BOOLEAN</dataType><fieldName>EnableDataUploadNotification</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>PICKLIST</dataType><fieldName>Status</fieldName><hasBooleanValue>false</hasBooleanValue><picklistValue>Valid</picklistValue></fieldValues>
    <fieldValues><dataType>LONGTEXT</dataType><fieldName>Errors</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>LONGTEXT</dataType><fieldName>SobjectPlatformEvents</fieldName><hasBooleanValue>false</hasBooleanValue></fieldValues>
    <fieldValues><dataType>LONGTEXT</dataType><fieldName>WhereSoql</fieldName><hasBooleanValue>false</hasBooleanValue><longTextValue><WHERE_SOQL></longTextValue></fieldValues>
    <isActive>true</isActive><isOrgLevel>false</isOrgLevel><lifeSciConfigCategory>DbSchema</lifeSciConfigCategory><masterLabel>DbSchema_<SOBJECT_API_NAME></masterLabel><type>DATA</type>
</LifeSciConfigRecord>
```

- **Config-record schemas** (`DbSchema_ProfileBasedAppSettings`, `DbSchema_QuoteDocumentSettings`): `SObject` = `LifeSciConfigRecord`, `Type` = `CONFIGURATION`, `Category` (TEXT) = the category name (`ProfileBasedAppSettings` / `QuoteDocumentSettings`), `<type>CONFIGURATION</type>`, same profile assignment. Never in the cache (10.7).
- **Org-level records** (`ApplicationSettings_OrgLevel`, `ProfileBasedAppSettings_OrgLevel`, `StoreCheckSetting_OrgLevel`): `isOrgLevel` true, **no** `<assignments>`, `isActive` true, their own category. `<lifeSciConfigCategory>` = the record name without `_OrgLevel`. Each `fieldValues` element carries `dataType`, `fieldName`, `hasBooleanValue` (`true` only for a true BOOLEAN) and, when set, one value element (`integerValue`, `picklistValue`, `textValue`). Values (unlisted value = no value element):
  - `ApplicationSettings_OrgLevel` (15): BOOLEAN true: `EnableBackgroundNotifications`, `EnableViewOnlineOnHomeScreen`, `EnableDynamicActions`, `EnableFlows`, `IsCustomReportRender`, `EnableAdvancedSearch`, `EnablePlatformEventsPublishing`; BOOLEAN false: `EnableInlineHelpText`, `SuppressAppUpgrade`, `DefaultAdvancedSearchForLookups`; `AllocatedRefreshesPerHour` INTEGER 1; `PasswordPolicy` PICKLIST `Numeric`; `DefaultBrowser` PICKLIST `Safari`; `AppLoadingIcon` TEXT `OCE Spinner`; `IosMdmUrl` URL (no value).
  - `ProfileBasedAppSettings_OrgLevel` (4): `MobileAppName` PICKLIST `lsc4ce__lifeSciencesCommercial`; `MinuteInterval` INTEGER 5; `BulkActionUser` BOOLEAN true; `IsOrgInMaintenance` BOOLEAN false.
  - `StoreCheckSetting_OrgLevel` (9): BOOLEAN true: `UploadImage`, `ShowFilterOptions`, `CaptureGeolocationOnStart`, `ShowTheCollapseAllAction`, `ShowTheSearchBar`; `MaxAllowedVisitDistance` INTEGER 50; `ProductFieldSet` PICKLIST `Store_Check_Attributes`; `AssortmentProductFieldSet` and `SelectScheduledFlowForTriggeringBatchJob` PICKLIST (no value).
- **No-template data schemas** (`DbSchema_AppUsageAssignment`, `DbSchema_PriceAdjustmentSchedule`, `DbSchema_PricebookEntry`, `DbSchema_SalesTransactionType`): data template, change `SObject` only, `WhereSoql` empty.
- **Field sets.** `StoreCheckSetting_OrgLevel` sets `ProductFieldSet` = `Store_Check_Attributes` (on `Product2`) and leaves **`AssortmentProductFieldSet` blank** (a value would add that field set's columns to the iPad Store Check grid, which the design does not want). `Store_Check_Fields` (on `AssortmentProduct`) is still created here so the count stays 63, but is **not referenced**. A fresh org has neither, so create both in this deploy (`FieldSet` members above). `Store_Check_Attributes` displays `ProductCode`, `Type`, `Description`. `Store_Check_Fields` displays `AssortmentId`, `IsRequired`, `ProductId`, `Assortment.Name`, `Assortment.UsageType`, `Product.IsActive`, `Product.ProductCode`, `Product.Family`, `Product.IsAssetizable`; all with `isFieldManaged` and `isRequired` false. If the customer prefers not to create them, leave both setting values blank, drop the `FieldSet` block and the two object files (expected count 61, not 63).
- **Profile.** `<FIELD_REP_PROFILE>` in the package holds only `tabVisibilities` (`standard-Quote`, `DefaultOn`). Follow the Deploy safety rule (How the agent runs this thread): retrieve the profile first (with `CustomApplication`, `Layout` and `RecordType` members, as in 4.2); after the deploy compare the counts of object permissions, field permissions, tab visibilities, record-type visibilities and layout assignments with the retrieve; if any dropped, redeploy the retrieved full profile plus the tab element (Deploy safety rule, step 6).
- All DbSchema records are deployed here, once: 39 baseline (Store Check) plus the Quote, pricing and document additions. `<WHERE_SOQL>` is empty for every object except these five territory filters (`{USER.TERRITORYID}` and `{OT2A.OBJ.IDS}` are literal sync tokens; write `'` as `&apos;`):

| `SObject` | `WhereSoql` |
| :-- | :-- |
| `Account` | `Id IN (SELECT AccountId FROM ProviderAcctTerritoryInfo WHERE IsAvailableOffline = true AND Territory2Id = '{USER.TERRITORYID}' AND AccountId IN ({OT2A.OBJ.IDS}))` |
| `Visit` | `AccountId IN (SELECT AccountId FROM ProviderAcctTerritoryInfo WHERE IsAvailableOffline = true AND Territory2Id = '{USER.TERRITORYID}')` |
| `Product2` | `Id in ( Select RelatedProduct2Id from ProductTerrDtlAvailability Where TerritoryId = '{USER.TERRITORYID}' AND IsActive = true ) AND Id NOT IN ( Select RelatedProduct2Id from ProductTerritoryAvailability Where TerritoryId = '{USER.TERRITORYID}' AND AlignmentType = 'Territory Exclusion' AND UsageType = 'LifeSciences' AND Status = 'Active' )` |
| `ProductTerritoryAvailability` | `TerritoryId = '{USER.TERRITORYID}' AND AlignmentType = 'Territory Exclusion' AND UsageType = 'LifeSciences' AND Purpose = 'Visit' AND Status = 'Active'` |
| `ObjectTerritory2Association` | `Territory2Id = '{USER.TERRITORYID}'` |

- A record whose file name does not exactly match its `DeveloperName` is **silently dropped** by the deploy — no error, the component is simply absent (→ FP-10.7). Always diff the manifest count against the deploy result's count.
- `DbSchema_Quote`/`DbSchema_QuoteLineItem`, `DbSchema_Pricebook2`/`DbSchema_PricebookEntry` and `DbSchema_PriceAdjustmentSchedule`/`DbSchema_PriceAdjustmentTier` ship as pairs; a half pair produces `MISSING_PROFILE_SCOPED_DBSCHEMA_QUOTELINEITEM` symptoms (→ FP-10.4).
- The Quotes tab in `nav.json` is not a separate record: it appears when the `Quote`/`QuoteLineItem` schemas are in the cache and `standard-Quote` is `DefaultOn` on `<FIELD_REP_PROFILE>` (verified at 10.7).
- **Scope:** Store Check and Quote schema sets deploy and generate together in one cycle. If the combined ZIP fails acceptance in a way that does not isolate cleanly, fall back to two sequential bundles (Store Check first, then Quote-only) and record `PASSED_WITH_NOTES`.

**10.1a Photo sync schemas (Store Check photo save)**

Four `DbSchema_*` records, each a copy of the `DbSchema_RetailVisitKpi` body (10.1 template, rep-profile assignment, `isActive` true, `isOrgLevel` false) with these values changed:

| Record (`DeveloperName`) | `SObject` | `WhereSoql` | `MandatoryFields` | Delta date field | `AttachmentsSupport` |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `DbSchema_Image` | `Image` | empty (no territory filter) | as copied | `SystemModstamp` | `BACKGROUND` |
| `DbSchema_ContentVersion` | `ContentVersion` | `ContentDocumentId IN ({CONT.DOCS}) AND IsLatest = true` | as copied | `SystemModstamp` | `BACKGROUND` |
| `DbSchema_ContentDocument` | `ContentDocument` | `Id IN ({CONT.DOCS})` | `Id,CreatedDate,CreatedById,LastModifiedDate,LastModifiedById` | `SystemModstamp` | `BACKGROUND` |
| `DbSchema_ContentDocumentLink` | `ContentDocumentLink` | `LinkedEntityId IN ({RELATED.ENTITIES}) AND ContentDocument.LatestPublishedVersion.IsLatest = true` | `Id,ContentDocumentId,IsDeleted,LinkedEntityId` | `SystemModstamp` | `BACKGROUND` |

- `{CONT.DOCS}` and `{RELATED.ENTITIES}` are literal sync tokens, not placeholders. `MandatoryFields` is the record's mandatory-field list: "as copied" means: the `DbSchema_RetailVisitKpi` template has no `MandatoryFields` element, so omit the element for `DbSchema_Image` and `DbSchema_ContentVersion`; `DbSchema_ContentDocument` and `DbSchema_ContentDocumentLink` carry the explicit list in the table as a `LONGTEXT` `fieldValues` entry (`<fieldName>MandatoryFields</fieldName>`, `<longTextValue>` = the list). Apply the sync outcomes in the 10.1a row if the device still fails.
- Rep access to `Image` is 9.26. Without these records the device logs "table Image has no column named offlinelastmodifieddate" (then the same for `contentdocumentlink`).

**10.1b Why `DbSchema_ProviderVisit`**

- Web Log a Visit (Visits → New → In-Person / Remote; the `lsc4ce__LAV` component) loads `sobjects/ProviderVisit/recordTypes/Master.json` from the rep's cache static resource (`Metadata<FIELD_REP_PROFILE>`). Without a rep-assigned `DbSchema_ProviderVisit` that file returns 404 and the component shows "We couldn't perform this action because the metadata is out of date…". Before Act 10 there is no rep cache at all, hence the other text, "Translation Language Settings for the required languages or the initial metadata cache are missing". After Act 10 that same text means the cache has no `translations/<lang>.json`: Translation Workbench is off or no translation language is active (fresh orgs; 10.1d). The generation adds that file, and the static resource `MetadataTranslations_<lang>`, only for an active language.
- Adding the rep assignment and regenerating once makes both forms load on web; on the iPad, In-Person and Remote New Visit open the same form, and Store Check, Quotes and the View Database counts are unchanged.

**10.3 Create the LifeSciMobileMetadataRecord parent**

```json
// mmr-parent-create.json  (POST, then PATCH <ID:parentRec> with {"Status":"ValidationCompleted"})
{
  "ApplicationVersionName": "lsc4ce__lifeSciencesCommercial",
  "ApplicationVersionNumber": "<API_VER>",
  "Status": "New"
}
```

- `ApplicationVersionNumber`: the org API version in `<API_VER>` form (for example `68.0`); when parents already exist, use the same value as theirs.
- Create as `New` (any other status fails on insert), take the returned `id` as `<ID:parentRec>`, `PATCH` it to `ValidationCompleted`, and pass it to 10.4. Do not send `Name`, `ProfileId` or a child record.
- Always create a fresh parent; never reuse one regardless of status (→ FP-10.1, FP-10.2).

**10.4 Generate request**

```json
// generate-request.json
{
  "parentMetadataRecordId": "<ID:parentRec>",
  "apiVersion": "<API_VER>",
  "prefix": "lsc4ce"
}
```

- Expected: HTTP 202, body "Task enqueued for metadata cache generation."
- POSTing against a parent that is already `Active` errors (it must be `ValidationCompleted`), which is why 10.3 always creates a new parent (→ FP-10.1).

**10.6–10.7 Download and verify**

```bash
sf api request rest "/services/data/v<API_VER>/sobjects/ContentVersion/<ID:childContentVersionId>/VersionData" \
  --stream-to-file "./mobile-cache-<PFX>.zip"
unzip -l "./mobile-cache-<PFX>.zip"
grep -c '@@@' <each extracted ui.json entry> || true   # prints 0 = pass; exit 1 on zero matches is expected
```

- Never pass `--include` with `--stream-to-file` (the CLI rejects it). Never call `.../metadata/actions/download` to check the result (it can create a `ContentDocumentLink`; → FP-10.5). `/connect/life-sciences/commercial/configurations` is not a verification endpoint from a raw client (404; → FP-10.6): verify through the ZIP.
- The two `LifeSciConfigRecord` schemas cannot be cached: do not fix this (no permission set, no regeneration). 11.5 (Store Check tasks visible) is the live test; if it fails, follow the 11.5 row (check the two records, fix through 10.1, regenerate once per 10.8).
- If `contextDefinition.json`/`decisionTable.json`/`expressionSet.json` come back as empty `{}`: check every selector agrees on `<PRICING_PROCEDURE>`: the org-wide Revenue Settings `QocalPricingProcedure` (7.17); the profile-scoped `OrderProductViewsSettings.PricingProcedure` `LifeSciConfigRecord` (8.10) and, if created, the org-level record (8.10b); and `QuoteSettings_OrgLevel` binding `Quote_Record_Type` to `lsc4ce_pricing_mobile_tpt` (8.14). Any one missing gives an empty file and no error (→ FP-10.3).

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Configuration bundle | All DbSchema/settings records for Quotes + Store Check (56 records, 60 with the 10.1a photo schemas; plus the rep assignment on `DbSchema_ProviderVisit`, 10.1b), 4 categories, 2 field sets and the rep profile's Quote tab (`DefaultOn`) deployed in one deploy (63 components); profile-scoped records assigned to `<FIELD_REP_PROFILE>` | `LifeSciConfigRecord` list filtered to `AssignmentLevel='Profile'` | Deploy `status === "Succeeded"`, component count match |
| Mobile metadata records | One new parent `Status = "Active"` and its job-created children `Status = "Active"`, one per assigned profile; the rep's has `ProfileId = <ID:FIELD_REP_PROFILE>` | `LifeSciMobileMetadataRecord` for `<FIELD_REP_PROFILE>`, sorted by `Name` descending | Query after bounded poll |
| Mobile cache | ZIP has 13 files (+ optional `translations/<lang>.json`); pricing files non-empty with `<PRICING_PROCEDURE>`/`<CONTEXT_DEF>`; `db.json`/`sobjects.json` list 56 of 58 schemas (K7), including `ProviderVisit`; `nav.json` has `standard-Quote`; `Store_Visit` with the Store Check component is in `ui.json`; 0 `@@@` tokens. Later changes are batched into one regeneration (10.8) | Local inspection of `mobile-cache-<PFX>.zip` | Unzip + grep per 10.7 |

### Checkpoint 10

Report: status (`PASSED` / `PASSED_WITH_NOTES` if the poll ran long, or for 56 of 58, the two generation-log warnings, children for other assigned profiles (10.5), or K26 when the customer skipped 10.1b / `FAILED` if 10.7a still shows a cache message after the 10.1b fix and one regeneration / `BLOCKED` if the parent never reached `Active` within the bound), changed (config records, field sets, profile tab, the `DbSchema_ProviderVisit` rep assignment, new parent and job-created children with the rep child's Id) / reused (records 10.0a classified as reuse) / verified (ZIP contents per 10.7), where to see it (`LifeSciMobileMetadataRecord` by `Name` descending, downloaded ZIP), open items (schemas redeployed individually, pricing-empty incidents, the 56-of-58 note, 10.0a collisions and how each was handled, the two warnings, 10.7a), the standing reminder that later changes are batched into one regeneration (10.8), actual duration; update the run manifest.

Act 10 is complete. Ready to continue to Act 11: iPad onboarding & first sync?
## Act 11 — iPad onboarding & first sync

**Purpose.** Get the LSC iPad app installed, signed in as the field rep, and synced with the Act 10 mobile cache, so the device has Store Check and Quotes data. **Estimated duration:** about 10 agent minutes (server-side verification and waiting on the device) + 15–25 human minutes (install, login, sync are device actions the agent cannot perform) **Depends on:** Act 10 (Active mobile cache); Act 4 (`<FIELD_REP_USER>` exists with `<FIELD_REP_PROFILE>`/`<FIELD_REP_PS>`). 11.1 and the build read of 11.in may run during Acts 8–10 (Appendix A, O3); 11.2 onward waits for Act 10

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🤖 Agent: cannot install an app or tap a touchscreen, so the human does the device steps and reports what they see; the agent confirms server-side *(P1, P4)*. | Human hands on the iPad; `<IPAD_APP_BUILD>`; `<FIELD_REP_USER>` credentials | Stale data after sync: a background sync may still be completing; leave the app open (11.3). |
| 👤 Human: "Device shows Pending Approval." 🤖 Agent: expected for a new device *(P5)*. | `UserDevice` query; View Database (11.5) | No server-side sync timestamp exists; confirm by View Database and data presence. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 11.in | Ask this Act's inputs: `IPAD_APP_BUILD` | n/a | 👤 HUMAN — list each of these keys that is still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Validate, then write to the frozen copy and the manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING` | Keys already filled are not asked again; if none are missing, the step passes with no stop. `IPAD_APP_BUILD` is read, not asked, when the app is installed: Profile & Territory → View Database shows the App Version (record as `accepted recommendation`). Ask only if the app is not installed and no build was named | — |
| 11.1 | Install the LSC iPad app build | n/a | 👤 HUMAN — install `<IPAD_APP_BUILD>`. Simulator path: the agent may launch the already-installed app and read the screen | Human (or agent, simulator path) reports the app opens and its build string | Skip if already installed at the correct build | — |
| 11.1a | Check that no action plan template the rep can read has more than one version | `ActionPlanTemplate`, `ActionPlanTemplateVersion`, `UserRecordAccess` | Agent query, before the rep's first login: `sf data query --all-rows --query "SELECT ActionPlanTemplateId, COUNT(Id) FROM ActionPlanTemplateVersion GROUP BY ActionPlanTemplateId HAVING COUNT(Id) > 1" --target-org <ORG_ALIAS> --json` (`--all-rows`: deleted and purged version rows still count), then `SELECT RecordId, HasReadAccess FROM UserRecordAccess WHERE UserId = '<ID:FIELD_REP_USER>' AND RecordId IN (<those template Ids>)` | No template returned by the first query is readable by `<FIELD_REP_USER>`. Any readable one breaks the rep's first sync with `UNKNOWN_EXCEPTION` (FP-11.4): list each by `Name`, `OwnerId`, version count and `Status`, then apply FP-11.4 before 11.2 | Read-only; re-run after the fix. No rows from the first query: pass with no stop | FP-11.4, FP-9.7 |
| 11.2 | Log in as the field rep | n/a | 👤 HUMAN — sign in as `<FIELD_REP_USER>`. The human always enters the passcode and credentials, including on a simulator; the agent never records the passcode and never taps Reset Passcode or Log out | Login screen cleared, home screen shown (human report, or agent screen read on the simulator path) | Skip if already logged in as `<FIELD_REP_USER>` | — |
| 11.3 | Trigger first manual sync | n/a | 👤 HUMAN — first read Profile & Territory → **View Database** → **Last Synced** and record it as `lastSyncedBefore` (blank on a first sync), then Profile & Territory → Begin Sync → confirm Sync (two taps; same on iPad and simulator). Simulator path: the agent may tap; if the "Begin Sync?" alert ignores the first tap, tap once more (not a failure) | Profile & Territory → **View Database** shows **Last Synced** later than `lastSyncedBefore` (or populated, if it was blank) and **Total Sync Time** populated. Do not wait for a "Syncing" indicator to vanish: "Syncing" is also a static field label on the Quote page | Re-run any number of times; sync is not destructive | FP-11.1 |
| 11.4 | Confirm device registration server-side | `UserDevice` | Agent query: `SELECT Id, Status, IsVerified FROM UserDevice WHERE UserId = '<ID:FIELD_REP_USER>' ORDER BY LastModifiedDate DESC LIMIT 1` | A row exists for `<FIELD_REP_USER>`; `Status = "Pending Approval"` and `IsVerified = false` are expected (K17) and do not block sync; do not "fix" them | Confirms existing registration; nothing to create | FP-11.2 |
| 11.5 | Confirm cache delivery | Device View Database panel; mobile data presence | Human (or agent, simulator path) reports the Quotes tab after sync, reads Profile & Territory → View Database (Store Check task templates are seen there as Action Plan Template rows; **do not open Store Check or Begin Visit on an existing Visit to look at them**: opening Store Check creates `NotStarted` `AssessmentTask` rows that sync to the server, and Begin Visit leaves the Visit In Progress; the tasks themselves are checked at 12.7) (see "11.5 View Database check"), and opens Quotes → New to read the Quote section headers, then cancels without saving. Single evidence row for sync, app version and cache selection | Quotes tab visible and Action Plan Template rows > 0 in View Database; **Metadata Updated** = the rep-profile child of the Active LSMMR pair from Act 10; per-object row counts equal server counts (`ProductTerritoryAvailability` = 0 is correct, K12); Quote section headers are plain text (see details). If Store Check tasks or the Quotes tab are absent, this is the live test of the two `LifeSciConfigRecord` settings schemas missing from the cache (10.7): Tooling-query both settings records (`DeveloperName`, `IsActive`, assignment to `<FIELD_REP_PROFILE>`); fix any difference through 10.1, then regenerate once (10.8), sync (11.3) and relaunch. Still absent → `BLOCKED` (FP-10.4) | If absent, first re-check that Act 10's `Active` LSMMR pair is the one selected (greatest `Name` for the profile), then re-sync | FP-10.4 |
| 11.6 | Record app-build vs. package-version note | Run manifest | Agent compares the **App Version** from 11.5 with the pinned package version (Act 2, or detected at 0.9) | Note recorded, never blocking. Any skew (app newer or older): `KNOWN_LIMITATION` (K6), `PASSED_WITH_NOTES`, continue | n/a | FP-11.3 |

#### Step details

**11.3 Manual sync**

- If **Last Synced** has not advanced, re-read View Database every 60 s for up to 5 min (a background sync may still be completing); then run the manual sync once more; if still unchanged, record `BLOCKED` (sync not completing) and stop (→ FP-11.1).

**Simulator path for 11.1–11.3**

- Use when an iOS simulator with the app is supplied: the agent reads the screen and taps through a UI-automation CLI; the human enters the passcode. Device handling: the preamble, "iPad simulator and physical iPad". Do not conclude a sync started until View Database changes; times there are in the rep's Salesforce time zone.
- A physical iPad is unchanged: same two taps.

**11.5 View Database check**

- Record **Metadata Updated**, **Last Synced**, **App Version** and per-object row counts in the manifest.
- Each count must equal the server count: Store Check assessment task and indicator definitions, assortment and assortment products, store assortment, retail store KPIs, action plan templates (versions, items, assignments, item values), price books and entries, price adjustment schedules and tiers, products, `ProductTerrDtlAvailability`, and the Quote and lines already on the server. Compare against server counts scoped to what syncs, not raw org counts: action plan templates, versions, items and item values only for template versions that have an `ActionPlanTemplateAssignment`; products only with an active `PricebookEntry` in `<PRICEBOOK_n>` (`SELECT COUNT() FROM Product2 WHERE Id IN (SELECT Product2Id FROM PricebookEntry WHERE Pricebook2Id = '<ID:PRICEBOOK_n>' AND IsActive = true)`); confirm the assignment field names with a describe. An org with other templates or products shows higher raw totals; that is not a mismatch. Store Check settings are not in the cache: confirm instead that New Visit offers the Store Check type (pre-selected) at 12.2.
- **`ProductTerritoryAvailability` shows 0 rows on the device; correct when no product is excluded.** The cache schema syncs only `AlignmentType = 'Territory Exclusion'` rows, while Acts 7 and 9 create Inclusion rows. Compare `ProductTerrDtlAvailability` with the server's active rows instead.
- Quote section headers (New Quote form, Quote Details) must be plain text (8.9 deploys plain labels). Raw tokens such as `@@@SFDCQuote_InformationSFDC@@@` are a failure: return to 8.9, redeploy the page, regenerate the cache (10.8), sync, relaunch. Only the Store Check heading token (packaged component, G5) is `KNOWN_LIMITATION` (K5).
- With 10.1b applied, In-Person and Remote New Visit open the Visit Engagement form on the device as on web; `ProviderVisit` rows sync only for provider visits in the rep's territory, so its count can be 0.
- The Quote page shows three tabs on the device (Quote Line Items, Details, Related). The Approval tab is absent by design (8.9a hides it from the rep profile); it is checked at 13.3 and not a failure.
- A stale unsynced local quote draft may be on the device. Default: leave it, record it, do not stop and do not discard it without the customer's say-so. If it reappears in Act 13 (e.g. a stray line on the test store), ask the customer, recommending "discard it on the device, then sync".

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Device | App installed, `<FIELD_REP_USER>` logged in | Device screen (human-reported) | Human confirmation |
| Device registration | `UserDevice` row exists for `<FIELD_REP_USER>` | `UserDevice` query | 11.4 (Pending Approval/unverified accepted) |
| Mobile data | Quotes tab and Store Check templates visible; View Database counts match the server | Device; Profile & Territory → View Database | 11.5 |

### Checkpoint 11

Report: status (`PASSED_WITH_NOTES` is the normal outcome: Pending Approval, app/package skew and 0 `ProductTerritoryAvailability` are `KNOWN_LIMITATION` notes; a stale local draft is a note; raw Quote section tokens are an 8.9 defect, not a limitation) / `BLOCKED` if the Quotes tab or Store Check templates never appear after a confirmed sync and a confirmed Active-pair check, changed (device registration) / reused (n/a) / verified (`UserDevice`, View Database counts, data presence), open items (whether the manual or a background sync delivered the data), actual duration; update the run manifest.

Act 11 is complete. Ready to continue to Act 12: Store Check E2E?
## Act 12 — Store Check E2E

**Purpose.** Run one real Store Check on the device, start to finish, filling every indicator across all three tabs, and have the agent confirm server-side that what the rep entered landed as data, not just that the screen looked right. **Estimated duration:** 5–8 agent minutes (verification queries) + 10–20 human minutes (device taps, data entry, screenshots) **Depends on:** Act 11 (device synced with the Act 10 cache); Act 9 (Store Check configuration: assortment, targets, 3 task templates, the 22 indicators across 3 tabs; this Act is the first on-device proof it renders)

### Story

Two device behaviors look alarming but are not failures. The Begin Visit location dialog ("Continue without location?") is expected without location services; continue. A sync error citing an offline-start condition on the first upload after beginning a visit is a client reachability false-negative: let the device reconcile, check the server record, and do not retry the tap. The "Verified" checkbox is cleared after Save & Close (the rep-facing objects have no Verified field): `KNOWN_LIMITATION`, G8, K4, recorded as a note. The proof the Store Check "took" is server-side: `AssessmentTask` records, `RetailVisitKpi` rows (one per product and indicator answer), `AssessmentIndValue` rows (picklist answers only) and `ActionPlan` records for the 3 task templates; the agent checks all four.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 👤 Human: "It asks about location; I got a sync error right after starting the visit." 🤖 Agent: continue without location; the error is a known false-negative, so do not retry the tap and the agent checks the server record *(P5)*. | Begin Visit action; `Visit.Status`/`ActualVisitStartTime` query | Not In Progress after one reconciliation pass: escalate (12.5–12.6). |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 12.1 | Open Visits list | n/a | 👤 HUMAN (iPad) — Home → Visits (SC1) | Human reports the All list visible | Skip if already on the list | — |
| 12.2 | Start a new Visit, choose Store Check record type | n/a | 👤 HUMAN (iPad) — New → Record Type picker → "Store Check" → Next (SC2) | Human reports New Visit form open with Record Type = "Store Check" (read-only). Simulator path: Store Check is pre-selected; the picker offers In-Person, Remote and Store Check | — | — |
| 12.3 | Fill and save the New Visit form | `Visit` | 👤 HUMAN (iPad) — Account = `<STORE_n>`; Place: **first change the Place lookup's type from the default "Address" to `ContactPointAddress`** (the "Address" list is empty for the store; other types are Location and RetailStore), then pick "`<STORE_n>` - Billing Address"; Planned Start Time = now, Save (SC3–SC4) | Human reports the Visit record page opens, Status = Planned, and the Planned Start Time shown after Save is today in the rep's time zone (the device zone can differ from the user's zone; a date one day off means the Visit is not "dated today": correct it before 12.4). The Store Check tab has no **Edit** yet (it shows only Begin Store Check until a Store Check is saved), so the Edit routing check runs after 12.11 | Reuse an existing Planned Store Check visit for `<STORE_n>` dated today if one exists, else create (visits planned on earlier days are not reused) | FP-12.4 |
| 12.4 | Agent confirms Visit creation server-side | `Visit` query | After the human reports the Visit saved: `SELECT Id, Status, RecordType.Name, AccountId FROM Visit WHERE AccountId = '<ID:store>' AND RecordType.DeveloperName = 'Store_Check' AND CreatedDate >= <12.2 start time from the manifest, UTC> ORDER BY CreatedDate DESC` (a reused visit from 12.3: query it by its Id instead) | Exactly one row, `Status = "Planned"`. 0 rows: not synced yet; wait for the background sync and re-query, do not ask the rep to create another. More than one: stop and show them | Reuse the Id for the remaining steps | — |
| 12.5 | Begin the Visit | `Visit.Status` (via UI action) | (1) Read the button text first: if it shows `BeginVisit`, set the action Name to `Begin Visit`, regenerate the cache (10.8), sync (11.3), relaunch, record `PASSED_WITH_NOTES`; if `Begin Visit`, no action. (2) 👤 HUMAN (iPad): tap "Begin Visit". (3) On "Continue without location?" tap **Start Visit** (SC5–SC6). The action menu also offers Delete while the Visit is In Progress (web blocks it, 9.11a): never tap it; record a note (`KNOWN_LIMITATION`, K27) | Toast "Check-in complete. Your location wasn't captured." (expected without location services) | — | FP-12.1 |
| 12.6 | Agent confirms Visit is In Progress | `Visit` query | After the human reports Begin Visit done: `SELECT Status, ActualVisitStartTime FROM Visit WHERE Id = '<ID:visit>'` | `Status = InProgress` (the API value), `ActualVisitStartTime` populated | If not yet reflected, allow one reconciliation pass before treating a reported sync error as a real failure | FP-12.1 |
| 12.7 | Begin Store Check | n/a | 👤 HUMAN (iPad) — Store Check tab → "Begin Store Check" (SC7–SC8) | Human reports Store Check screen open, title = account name, 3 tabs with counts (one per assortment product): Availability Audit, Primary Display, Secondary Display. Each grid shows Verified and Product, then the indicators in the 9.18 order, then Photo; no product-attribute columns (10.1 leaves `AssortmentProductFieldSet` blank on purpose; if they appear, that setting has a value). Picklists open at "Select…" (Not Applicable is not pre-selected). The tab card heading may show a raw component name: cosmetic `KNOWN_LIMITATION` (K5, G5), not a failure | — | — |
| 12.8 | Fill Availability Audit tab for every assortment product | `RetailVisitKpi` (Availability Audit answers) | 👤 HUMAN (iPad) — per product: Verified, No Stock, Stock Count (vs. `<TARGETS>`), Out-of-Stock Reason, Days of Cover, Distribution Status, Backroom Stock On-Hand, Shelf Price, Last Restock Date, Photo (SC8–SC10). Set Out-of-Stock Reason on every product (`Not Applicable` on in-stock products; an empty one writes no row). No Stock on greys out the product's other 7 Availability Audit cells (2 of them picklists); they write no row, which 12.12 allows for. Do not toggle No Stock on and back off before saving: that left the product's other cells empty on the server; if you did, re-enter all of that product's cells | Human reports all rows filled, Photo excepted on a simulator (no camera: `KNOWN_LIMITATION`, K8; on a physical iPad take the photo); screenshots attached to the run record. Anomalies filter: a product with Stock Count below its target appears under Anomalies → Stock Count (not listed → record a note and continue; non-blocking). Priority filter: lists the priority product (non-blocking: if the filter shows otherwise, record a note and continue) | — | FP-12.2, FP-12.3 |
| 12.9 | Fill Primary Display tab for every assortment product | `RetailVisitKpi` (Primary Display answers) | 👤 HUMAN (iPad) — per product: Verified, Primary Location Present, Facing, Share of Shelf (%), Position, Planogram Compliance, Price Tag Display, Adjacency Compliance, Photo (SC11–SC12) | Human reports all rows filled (Photo excepted on a simulator) | — | FP-12.2, FP-12.3 |
| 12.10 | Fill Secondary Display tab for every assortment product | `RetailVisitKpi` (Secondary Display answers) | 👤 HUMAN (iPad) — per product: Verified, Secondary Display, Display Location, POSM, POSM Condition, Promotional Price Display, Promotional Price Value, Secondary Display Units, Photo (SC13–SC14) | Human reports all rows filled (Photo excepted on a simulator) | — | FP-12.2, FP-12.3 |
| 12.11 | Save & Close the Store Check | n/a | 👤 HUMAN (iPad) — before tapping, give every picklist cell on all three tabs a value (`Not Applicable` is allowed, and is the value for Out-of-Stock Reason on in-stock products; an empty picklist writes no row, which 12.12 counts as a shortfall; the cells that No Stock greys out are the exception) and pick each single-select value once (changing a chosen value leaves a stale value row, K22); then "Save & Close". Save is greyed out when nothing changed since the last save; then just close | Human reports the screen returns to the Visit record. Expected notes, not failures: every Verified box is cleared (G8); Last Restock Date may store the current time for one product and midnight UTC for others; the header may show a local visit name with an asterisk that differs from the server name until the next sync. **Edit routing check (first saved Store Check):** on the Visit's Store Check tab, **Edit** (top right) opens the Store Check edit form; Cancel without changing anything. The iPad Visit page has no record-level Edit (its action menu lists only Delete; never tap Delete, see 12.5); check record-level Edit routing (9.6/9.7) on web only, where the Visit page must use `Store_Visit` (9.9d) (web check unverified: fallback, record `PASSED_WITH_NOTES` if the human cannot run it) | — | — |
| 12.12 | Agent confirms task/indicator records | `AssessmentTask`, `RetailVisitKpi`, `AssessmentIndValue` | First `sf sobject describe --sobject <Obj> --json` for each object and confirm `AssessmentTask.ParentId` → `Visit`, `AssessmentIndValue.SourceObjectId` → includes `RetailVisitKpi`, `RetailVisitKpi.VisitId` → `Visit` (also `ActionPlan.TargetId` → includes `Visit`, 12.14); any mismatch: stop and report, do not guess a field. After the human reports Save & Close: `SELECT Id, AssessmentTaskDefinition.Name FROM AssessmentTask WHERE ParentId = '<ID:visit>'`; `SELECT Id FROM RetailVisitKpi WHERE VisitId = '<ID:visit>'` (count the rows and keep the Ids); then `SELECT COUNT() FROM AssessmentIndValue WHERE SourceObjectId IN (<those RetailVisitKpi Ids>)` (`AssessmentIndValue` has no `AssessmentTask` relationship; `SourceObjectId` points at the `RetailVisitKpi` row) | 3 `AssessmentTask` rows (one per task template; `Status` may stay `NotStarted`). With P = assortment product count, U = (product, boolean indicator) cells left untouched at default off (e.g. No Stock; each writes no row), C = picklist cells changed after first entry, L = picklist indicators in the Act 9 list (12 by default), and N = products with No Stock on (each greys out its other 7 Availability Audit cells, 2 of them picklists, which write no row): `RetailVisitKpi` count = P × 22 − U − 7N; `AssessmentIndValue` count is between P × L − 2N and P × L − 2N + C. Pass: both hold. A count above P × L − 2N (stale duplicate rows, K22) is `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; no data fix. **Second task set:** more than 3 `AssessmentTask` rows, or two sharing an `AssessmentTaskDefinitionId`, means Store Check was started twice on this Visit. Stop before 12.14, report each set's `CreatedDate` and which set holds the `RetailVisitKpi` rows, compute the counts against the set that holds them, and do not delete either set | Report actual vs. expected. A `RetailVisitKpi` shortfall equal to U is within the allowance. A larger shortfall: compare device entries with the KPI rows to name the missing product/indicator cells (usually an empty picklist or a toggled No Stock), ask the human to re-enter them through the Store Check **Edit** and Save & Close (that adds the missing rows without duplicates), re-run; if still short, record `FAILED` with the list | — |
| 12.13 | Merged into 12.12 | n/a | n/a | n/a | n/a | — |
| 12.14 | Agent confirms the Act 9 action-plan templates applied | `ActionPlan`, `ActionPlanItem` | After Save & Close: `SELECT Id, ActionPlanTemplateVersionId FROM ActionPlan WHERE TargetId = '<ID:visit>'` | 3 `ActionPlan` rows (one per Act 9 template) with 3 distinct `ActionPlanTemplateVersionId` values | Report count; fewer than the Act 9 template count: name the missing template. More, with repeated `ActionPlanTemplateVersionId` values: a second Store Check start (see 12.12), record `PASSED_WITH_NOTES` with each plan's `CreatedDate`; do not delete | — |
| 12.15 | End the Visit | `Visit.Status` (via UI action) | 👤 HUMAN (iPad) — tap "End Visit" | Human reports the path moves to Completed | — | — |
| 12.16 | Agent confirms Visit Completed | `Visit` query | After the human reports End Visit: `SELECT Status FROM Visit WHERE Id = '<ID:visit>'` | `Status = "Completed"`; Store Check Edit is disabled on the device afterwards (expected) | — | — |

#### Step details

**12.5–12.6 Begin Visit and the offline sync-error signature**

- A sync error saying the visit start was attempted offline is a reachability false-negative: **inconclusive**, not a failure. Do not retry Begin Visit. Let the device sit, then run the 12.6 query. `InProgress` with `ActualVisitStartTime` populated means disregard the error; otherwise escalate (→ FP-12.1).

**12.8–12.10 Verified checkbox (G8) and simulator handling**

- Verified toggles and survives an interim Save but is cleared after Save & Close; there is no server-side check. Record `PASSED_WITH_NOTES` with `KNOWN_LIMITATION` (G8, K4) and continue; if a future build persists it, record PASS. Do not regenerate or delete anything to chase it (→ FP-12.3).
- Simulator: use physical-style taps; if one misses while a picklist popup is closing, retry once after the popup is gone (→ FP-12.2). Let popups finish closing and read the screen after each entry. No camera: Photo cells stay empty.

**12.12 Expected indicator volume**

- 22 indicators (8 + 7 + 7; Verified and Photo are not indicators) per product. Example: 3 products, No Stock untouched on two (U = 2), 12 picklist indicators, no changed cells: 64 `RetailVisitKpi` (66 − 2) and 36 `AssessmentIndValue`; one changed cell allows up to 37.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Visit | Store Check visit created, started, completed for `<STORE_n>` | `Visit`, Status = Completed | 12.4/12.6/12.16 |
| Store Check data | All 22 indicators across 3 tabs filled for every assortment product (Photo excepted on a simulator; Verified does not persist, G8) | Device (human-reported; SC8–SC14 of the [per-screen acceptance checklist](#per-screen-acceptance-checklist)) | 12.12 |
| Indicator answers | `RetailVisitKpi` = P × 22 − U − 7N | `RetailVisitKpi` query | 12.12 |
| Task templates | 3 `ActionPlan` records applied to the visit | `ActionPlan` query | 12.14 |

### Checkpoint 12

Report: status (`PASSED` if all four server-side signals in 12.12, 12.14 and 12.16 confirm with no notes; `PASSED_WITH_NOTES` if the sync-error signature reconciled or any `KNOWN_LIMITATION` was recorded (G8, Photo on a simulator, K5, U shortfall, K22, K27, tasks left `NotStarted`); `BLOCKED` if the Visit never reaches In Progress after a reconciliation pass), changed (new Visit + AssessmentTask/AssessmentIndValue/RetailVisitKpi/ActionPlan records) / reused (a Planned Visit, if one existed) / verified (per End State), open items (indicator shortfall, unresolved sync error), actual duration; update the run manifest.

Act 12 is complete. Ready to continue to Act 13: Draft Quote E2E?
## Act 13 — Draft Quote E2E

**Purpose.** Build one Quote on the device from scratch through a saved Draft with priced, discounted line items, and reconcile every price the device shows against the Act 7 web simulation, not just trust what renders. **Estimated duration:** 8–12 agent minutes (reconciliation queries) + 30–45 human minutes (device taps, product selection, quantity entry) **Depends on:** Act 10 (Active mobile cache with Quote/pricing schemas); Act 12 (a completed Visit, for the Visit Decoupling branch); Act 7 (web pricing simulation values); Act 8 (Quote web configuration, stage path, DocGen prerequisites, 8.9c compact layout)

### Story

Two paths are exercised. Starting a Quote from the Act 12 Visit: Quoted Order tab → **New** opens the form with Visit and Account for Quote pre-filled, and the saved quote syncs with `Quote.VisitId` set. Create Quote From Visit (8.34) is absent from the iPad visit menu (K13): `PASSED_WITH_NOTES` / `KNOWN_LIMITATION`, not a stop; plain New with the Visit set by hand gives the identical link. Add Products: the "Products from Last Order" card is absent for a first quote and appears once a Submitted quote exists (hard expectation at 15.2).

Device-only precondition: the iPad engine ignores tier rows with an empty effective-date range (web tolerates them). Act 7 (7.10, 7.10a) dates every schedule and tier; 13.0a reads the dates back before pricing. The mobile cart is offline-first: lines, quantity edits and discounts stay on the device, unpriced, until the cart is **Saved**, and reach the server only after a sync; the quote's server ID can change at that sync. Every server-side check below follows a Save and a manual sync.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Can I start the quote from the store visit?" 🤖 Agent: yes, Quoted Order tab → New fills visit and store; the ••• menu has no Create Quote *(P1/P4)*. | Visit layout `Quotes` related list, Quoted Order tab | 13.2 confirms per run. |
| 👤 Human: "No Last Order card" / "won't save: locked." 🤖 Agent: the card appears once a Submitted quote exists (Act 15); the lock is a client defect, routed around *(P5)*. | `ProductsFromPreviousOrder` view | K21; `Workflow_XIsLockedAndCannotBeCreated`, gate G4. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 13.in | Ask this Act's inputs: `TEST_UNLOCK_ROUTE` (for Act 14); not asked: `QUOTE_ENTRY_PATH` defaults to `from_visit` (`accepted recommendation`) | n/a | 👤 HUMAN — list each of these keys that is still missing or `PENDING` in the frozen copy, with its recommended answer and source from the [Runtime input schema](#runtime-input-schema); the customer accepts, edits or answers. Validate, then write to the frozen copy and the manifest (`answered` or `accepted recommendation`) | Every key listed is filled; none `PENDING` | Keys already filled are not asked again; if none are missing, the step passes with no stop | — |
| 13.0a | Offline pricing parity precondition: read back the thread's tier and schedule effective dates (set at 7.10) | `PriceAdjustmentSchedule`, `PriceAdjustmentTier`, mobile metadata pair | Read-only agent queries, limited to the two schedules this thread created (standard org schedules are never touched): `SELECT Id, Name, EffectiveFrom, EffectiveTo FROM PriceAdjustmentSchedule WHERE Name IN ('<PFX>EssentialsVolumeSchedule','<PFX>DisplayTierSchedule')`; `SELECT Id, Name, EffectiveFrom, EffectiveTo FROM PriceAdjustmentTier WHERE PriceAdjustmentScheduleId IN (SELECT Id FROM PriceAdjustmentSchedule WHERE Name IN ('<PFX>EssentialsVolumeSchedule','<PFX>DisplayTierSchedule'))`. Dates are ISO 8601 date-times (`YYYY-MM-DDThh:mm:ss.000Z`) | 2 schedules and 4 tiers (`<PRICING_TIERS>`: 2 bands × 2), each with both `EffectiveFrom` (on or before today) and `EffectiveTo` (far future, e.g. 2099-12-31) set. The device's View Database **Metadata Updated** names the Active pair generated after the dates were set | Detect-only when all dates are set. If any is empty (7.10a skipped): run the 7.10a repair (**schedules first, then tiers**: the platform rejects a tier date while its parent schedule has none), refresh the Act 7 decision tables (7.12), then ONE regeneration (10.8), manual sync (11.3) and app relaunch before 13.1. Disclose any change in the checkpoint. Server pricing is unaffected | FP-13.2 |
| 13.1 | Open Quotes list | n/a | 👤 HUMAN (iPad) — Home → Quotes (Q1) | Human reports All Quotes / My Quotes tabs visible | — | — |
| 13.2 | Quoted Order render check, then apply `QUOTE_ENTRY_PATH` | n/a | **Non-blocking: run it whatever `QUOTE_ENTRY_PATH` is, record the result, never stop on it.** 👤 HUMAN (iPad) — on the Act 12 Store Check Visit the rep reports: A = **Quoted Order** tab lists the visit's quotes with a **New** button; B = **Create Quote** in the visit ••• menu (8.34; expected absent, K13). Then: if `QUOTE_ENTRY_PATH = from_visit` (default), tap **New** on the Quoted Order tab and check Visit and Account for Quote are pre-filled; if A is missing or `plain_new`, use plain "New" (Q2) with the Visit lookup set. Any fix made in this Act needs a cache regeneration (10.8), sync and relaunch before re-testing (preamble, "iPad simulator and physical iPad") | A and B reported as shown / absent; the chosen path is in the manifest. A shown is `PASSED`; B absent is a note (`KNOWN_LIMITATION`, K13). **A missing is `PASSED_WITH_NOTES`, not a stop:** check FP-9.9, continue on plain New (the 13.4 `VisitId` check proves the link either way) | Run once per configuration baseline | FP-9.9 |
| 13.3 | Create the Quote | `Quote` | 👤 HUMAN (iPad) — fill Quote Information: Sales Transaction Type (blank on the iPad form, while web fills it: pick `<PFX>Order`), Quote Name (agent-chosen test name such as "Store Check Quote 1"; the app capitalises the first letter), Account for Quote, Visit = the Act 12 Visit (set on every path), Shipping/Billing Contact Point Address (if the store has one, use it for both), Save (Q2–Q5). Status shows Draft as read-only text, not a picklist (an editable Status → FP-8.35). There is no Quote Currency field in a single-currency org; if offered, accept the org default. Save is greyed out when nothing changed since the last save | Human reports the Quote record page opens. Checks: (a) section headers are plain text; raw `@@@SFDC…@@@` is an 8.9 failure: redeploy, regenerate (10.8), sync, relaunch, re-check; (b) tabs are Quote Line Items, Details, Related; the Approval tab is absent by design (8.9a), not a failure; (c) the header shows the title plus 5 compact-layout fields: Account for Quote shows the store name only when the 8.9c compact layout was in place before the cache was last regenerated (blank: fix 8.9c, regenerate 10.8, sync, relaunch); Expiration Date is not displayed and Opportunity ID is always blank on device quotes (expected, not failures); Quote Number and Syncing stay blank until the first sync; (d) the stage path follows the org `Quote.Status` picklist order, which 8.16 set to the `QUOTE_STAGES` order (default Draft, Submitted, Request for Unlock, In Review, Rejected), so they match; a different device order is K18 (`PASSED_WITH_NOTES`); the price book may already be set | Reuse an existing Draft Quote for `<STORE_n>` with no line items if one exists, else create | FP-13.1 |
| 13.4 | Agent confirms Quote creation server-side | `Quote` query | After the human reports the Quote saved and a manual sync (11.3): `SELECT Id, Name, Status, VisitId FROM Quote WHERE QuoteAccountId = '<ID:store>' ORDER BY CreatedDate DESC LIMIT 1` (the iPad **Account for Quote** field writes `QuoteAccountId`; `AccountId` stays empty on device quotes, so an `AccountId` filter returns 0 rows) | Row returned, `Status = "Draft"`, `VisitId` = the Act 12 Visit on every path | Note the Id and Name; the server Id can change at the first sync (13.8a), so re-read by `QuoteAccountId` + Name after each sync | FP-13.1 |
| 13.5 | Open Actions → Add Line Items | n/a | 👤 HUMAN (iPad) — on the Quote record, Actions → "Add Line Items" (Q6–Q7) | Human reports Select Price Book screen opens | — | — |
| 13.6 | Select the price book | `Pricebook2` | 👤 HUMAN (iPad) — select `<PRICEBOOK_n>`, "Select Products" (Q8) | Human reports Add Products screen opens | — | FP-13.5 |
| 13.7 | Observe Add Products cards | `Assortment`/`ProductsFromPreviousOrder` | 👤 HUMAN (iPad) — report exactly which cards render: Store Assortment (with product count) and whether a Last Order card appears, is empty, or is absent (Q9) | Observation, `PASSED` either way; card state reported verbatim. Expected: absent when the store has no Submitted quote yet (note K21); present above Store Assortment when one exists (hard expectation at 15.2) | — | — |
| 13.8 | Choose products | n/a | 👤 HUMAN (iPad) — add every product used in the 7.14 simulation (listed in the manifest): Store Assortment card → Continue, or Add Manually → picker (All Products / Priority Products tabs, search, select, "Add to Quote") (Q9–Q11) | Toast "N products were added." (Q12) | — | — |
| 13.8a | Save, close and sync so the server sees the lines | n/a | 👤 HUMAN (iPad) — **Save** (the cart already reprices at this first Save, so net prices can show before 13.13), Close, record View Database **Last Synced** as `lastSyncedBefore`, then manual sync: Profile & Territory → Begin Sync → confirm Sync (same as 11.3; on a simulator use physical-style taps for the confirmation). Lines stay local until both happen | View Database **Last Synced** later than `lastSyncedBefore` | Safe to repeat | FP-11.1 |
| 13.9 | Agent confirms line items created | `QuoteLineItem` query | **After the 13.8a sync:** re-read the quote Id (`SELECT Id FROM Quote WHERE QuoteAccountId = '<ID:store>' AND Name = '<quote name>' AND VisitId = '<ID:visit>'`; the Id from 13.4 may no longer exist; more than one row → stop and show them), then `SELECT Id, Product2Id, Quantity FROM QuoteLineItem WHERE QuoteId = '<ID:quote>'` | Row count = number added. Before the sync this returns 0 rows: "not synced yet", not a failure. If Visit is blank on the device quote after sync, the Quote layout failed (`VisitId` must be Edit, 8.2): fix 8.2, regenerate (10.8), sync, relaunch, verify `VisitId` server-side | — | FP-9.9 |
| 13.10 | Enter the 7.14 simulation quantities | `QuoteLineItem.Quantity` | 👤 HUMAN (iPad) — enter, per line, the quantity the agent sends (Q12–Q13). Before 13.10 the agent picks one 7.14 simulation case per line and records it in the manifest: at least one line in a higher tier band (its lower bound, for example 10) and the 13.12 manual-discount line at the quantity of its 7.14 discount case, so 13.14 checks a tier price and a discounted price, not only the base band. Send the human the exact per-line quantity and discount in one list (for the default inputs: Product A quantity 1 with 10% off, Product B quantity 10, Product C quantity 1). The cart does **not** reprice on field change: Net Unit Price stays blank and Order Total at list until 13.13. Use the hardware keyboard (physical iPad: on-screen or hardware); edit-menu Select All does not work in the quantity field | Quantities entered without a client error (note the reprice component error if it appears) | — | FP-13.2 |
| 13.12 | Apply the 7.14 manual discount | n/a | 👤 HUMAN (iPad) — on the manual-discount product's line, enter the discount value and type recorded in the manifest (Q13) | Discount line reflects the entry (chip, e.g. 10%; the price updates at Save) | — | — |
| 13.12a | Check the Order Discount in the cart footer (look only) | n/a | 👤 HUMAN (iPad) — the footer reads Subtotal, **Order Discount** with an **Add** link, Discount, Grand Total (Q13). Do not apply one here: a header discount changes every line's net price, and 13.14 compares with the 7.14 simulation, which has none. To try it, use a separate Draft quote: Add → type, distribution, value → Save; Calculation Details then shows a Discount Distribution Service row | Order Discount (Add) is shown; missing → FP-7.15 | — | FP-7.15 |
| 13.13 | Save the Quote (not Save & Close, to allow reconciliation first) | `QuoteLineItem` | 👤 HUMAN (iPad) — "Save" (Q12 footer); this is when the cart reprices | Save completes, counters show expected Products/Items/Delivery | — | — |
| 13.11 | Open Calculation Details on the tiered line (**after 13.13 Save**) | n/a | 👤 HUMAN (iPad) — tap Net Unit Price → Calculation Details popover (Q13) | Rows shown: List Price, an adjustment row, Net Unit Price. The tier adjustment can show as a percentage (e.g. 2.60% on list 20 = 0.52 per unit, net 19.48). Before Save the popover is empty or shows only List Price and Net Unit Price. Adjustment rows can show only the percentage with an empty Amount cell (expected). Ask the human for a screenshot of the popover for the run record | — | — |
| 13.13a | Save, close and sync again | n/a | 👤 HUMAN (iPad) — Save & Close (if Save is greyed out nothing changed: just Close), then manual sync (as 13.8a); reopen the quote | View Database **Last Synced** later than `lastSyncedBefore` (recorded as in 13.8a); after the reopen the header shows Quote Number and Grand Total (non-blocking) | Safe to repeat | FP-11.1 |
| 13.14 | Agent reconciles device pricing against the Act 7 web simulation | `QuoteLineItem.NetUnitPrice`/`UnitPrice`/discount fields | **After the 13.13a sync:** re-read the quote Id (as 13.9), then `SELECT Product2Id, Quantity, UnitPrice, NetUnitPrice FROM QuoteLineItem WHERE QuoteId = '<ID:quote>'`, compared line by line to the Act 7 simulated outputs for the same product/quantity/tier inputs | Every line's `NetUnitPrice` matches the Act 7 simulation within rounding tolerance (±0.01 unless the customer sets another) | A mismatch is `FAILED`, not something to average away. First re-check 13.0a: a device price equal to list at a tiered quantity while the web gives the tier price is the empty-effective-date signature (e.g. 10 instead of 9; the manual-discount line is unaffected) | FP-13.2 |

#### Step details

**13.2–13.4 Visit Decoupling branch**

- From-visit path uses the 9.5 layout `Quotes` related list + 9.9 FlexiPage tab. Do not call a generic New-Quote form the from-Visit path: the 13.4 check proves the link. The visit ••• menu offers only Delete (K13); no fix attempt.
- Quoted Order tab empty or without New: FP-9.9 (layout lacks the `Quotes` related list, or the cache predates it). Meanwhile use plain New with the Visit set (Q2).

**13.3–13.4 Workflow_XIsLockedAndCannotBeCreated (gate G4)**

- Signature: a brand-new Quote fails to save with a "locked and cannot be created" workflow error (the client seeds no local `Status`). No deploy or setting fixes it; attempt no config changes.
- Follow G4: record 13.3 as `BLOCKED (G4)` with the device/app build, create the Quote on web (same fields, with the Visit lookup), and run 13.4 onward on it, with line entry on the iPad. Each later step reports its own result; the Act ends `BLOCKED` (or `FAILED` if pricing does not reconcile), never `PASSED` or `PASSED_WITH_NOTES`.

**13.8–13.14 Save and sync ordering**

- Run order: 13.8, 13.8a (Save + sync), 13.9, 13.10, 13.12, 13.12a (look only), 13.13 (Save), 13.11, 13.13a (Save & Close + sync), 13.14. Server checks always follow a sync, and the quote Id is re-read after each sync. 0 lines on the server right after 13.8 means the cart is not saved and synced yet.

**13.0a, 13.14 Device tier pricing needs dated tiers**

- Undated-tier symptom: the web simulation gives the tier price, the device charges list at the tier quantity, and Calculation Details shows only List Price and Net Unit Price. After dating (schedule first, then tiers), refreshing decision tables, generating a new pair and syncing, device prices equal the Act 7 simulation (e.g. 9.50/9.00 for the volume line at quantity 1/10) and Calculation Details shows the volume-discount row.

**13.10, 13.14 Reprice component error**

- An intermittent component-context error during quantity-triggered repricing is fixed in a later app build. If it recurs, record `<IPAD_APP_BUILD>` and treat it as known (→ FP-13.2).

**13.14 Address and label display (non-blocking)**

- Billing/Shipping Contact Point Address may render as "-": cosmetic, does not block Submit (K20, → FP-13.3). Raw `@@@SFDC…@@@` in Quote section headers is an 8.9 failure (→ FP-13.4); the Store Check heading token is K5.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Quote | Draft Quote exists for `<STORE_n>` with priced line items | `Quote`/`QuoteLineItem` | 13.4/13.9/13.14 |
| Pricing | Device `NetUnitPrice` matches the Act 7 simulation, including the tiered line | `QuoteLineItem` fields | 13.14 |
| Visit Decoupling | Quote started from the Visit (Quoted Order → New) or plain New with the Visit set by hand; `VisitId` populated either way | `Quote.VisitId` | 13.4 |
| Last Order card | Absent for the store's first quote; present once a Submitted quote exists (15.2) | Device (human-reported) | 13.7 |

### Checkpoint 13

Report: status (`PASSED` if pricing reconciles exactly; `PASSED_WITH_NOTES` if only `KNOWN_LIMITATION` items appeared (K13, K5, K20) and pricing reconciled; `BLOCKED` if `Workflow_XIsLockedAndCannotBeCreated` forced the G4 web-create workaround (report 13.3 as `BLOCKED (G4)` and list 13.4 onward separately); `FAILED` if pricing does not reconcile, which takes precedence over `BLOCKED`), changed (new Quote + QuoteLineItems) / reused (a Draft Quote) / verified (per End State), open items (Visit Decoupling result, Last Order card state, defect signatures hit), the final quote Id and name for Act 14 (re-read after the last sync), whether 13.0a changed dates or generated a new mobile pair, actual duration; update the run manifest.

Act 13 is complete. Ready to continue to Act 14: Submit, signature, PDF, unlock?
## Act 14 — Submit, signature, PDF, unlock

**Purpose.** Take the Act 13 Draft Quote through Review Order, disclaimer and signature capture, Submit it exactly once through the cart Review Order path, confirm its PDF (created by Submit Order), and, as an explicitly gated branch, exercise the Request-for-Unlock/In Review/Rejected route. **Estimated duration:** 10–15 agent minutes (precondition checks, status reconciliation, bounded PDF poll) + 10–15 human minutes (device taps, signing) **Depends on:** Act 13 (priced Draft Quote); Act 8 (Quote stage path, FLS, DocGen build-out; this Act exercises what Act 8 configured, it does not build it)

**Signed submit path.** Only one of two Submit actions is signed. The stage-path / Actions → Submit is a plain status update (`Status = Submitted`): no Review Order screen, disclaimer, signature, `DigitalSignature` or `DocumentRecipient`. The signed path: cart Save → **Review** → Review Order → sign → **lock icon** next to Submit Order + app passcode → **Submit Order**. This Act always uses the cart Review path; never the stage-path Submit. Act 14 produces the `Submitted` quote that Act 15 needs: with `TEST_UNLOCK_ROUTE = no` 15.0 reuses it; with `yes` the unlock branch moves it out of `Submitted` and 15.0 builds a replacement.

**Run order:** 14.1, 14.2, 14.2a, **14.6**, 14.3–14.5, 14.5a, 14.7 onward. The agent runs the 14.6 precondition read before the human starts 14.3 (the quote is Draft and its prices were reconciled at 13.14), so the human runs 14.3–14.7 in one go with no mid-sequence stop. Numbers are not changed.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🤖 Agent: before any tap, checks that Submit can render (`Quote.Status` FLS) and that stage-transition enforcement is active; Submit Order is one-shot and is never retried *(P4)*. | FLS check; `StagePathPermissionsHandler` check; signature capture | If FLS is missing, Submit does not appear. The client leaves the button tappable: never tap twice. |
| 👤 Human: "I tapped Submit twice." 🤖 Agent: checks the actual `Quote.Status` first; a duplicate is rejected by the server *(P5)*. "PDF is spinning": polls on a bound and reports where it stopped *(P4)*. | `Quote.Status` reconciliation; `QuoteDocument.Status` poll | Stall: `QuoteDocument` stays In Progress after the one Generate PDF tap (`KNOWN_LIMITATION` K1, 14.12); before the tap, In Progress is normal. |

### Build steps

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 14.1 | Confirm Submit is actually permitted to render | `PermissionSet`/`Profile` field-level security on `Quote.Status` | `sf data query --query "SELECT Field, PermissionsEdit FROM FieldPermissions WHERE Field='Quote.Status' AND ParentId='<ID:FIELD_REP_PS>'"` | `PermissionsEdit = true`; no row means false (layout can remain Readonly; FLS Edit is what the Submit action needs to render at all) | Detect → if false, grant FLS Edit on `<FIELD_REP_PS>`, then regenerate the cache (10.8), sync and relaunch the app; this is a configuration fix, not a UI troubleshooting problem | FP-14.1 |
| 14.2 | Confirm stage-transition enforcement is active | `LifeScienceTriggerHandler` `StagePathPermissionsHandler` | Tooling query: `SELECT Id, IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = 'StagePathPermissionsHandler'` | One row, `IsActive=true` | Read-only; re-run safely. `false` → ask consent C8, then run 8.17 (Tooling PATCH; the Admin Console switch is the 👤 HUMAN fallback only if the PATCH fails) and read `IsActive` back | FP-14.2 |
| 14.2a | Confirm the unlock approver can receive the approval (only if `TEST_UNLOCK_ROUTE = yes`) (precheck; the assignment is set up once at Act 5 step 5.4a) | `UserTerritory2Association` | `SELECT Id, IsActive FROM UserTerritory2Association WHERE UserId = '<ID:MANAGER_USER>'` (confirm field names with a describe first) | At least one active assignment, ideally to `<STORE_n>`'s territory (the one created at 5.4a). If none: run 5.4a now (do not build a second copy of the setup here), re-run this query, then continue. Without it the notification step fails with `REQUIRED_FIELD_MISSING` on `TerritoryId` and the approval is withdrawn | Detect → reuse an existing active assignment | FP-14.5 |
| 14.3 | Open the Draft Quote and start the signed Submit | n/a | 👤 HUMAN (iPad) — open the Draft Quote that Checkpoint 13 recorded (its final server Id and name, re-read after the last sync: the Id can change at sync), verify the quote name on screen, open its cart → **Save** (if enabled; it is greyed out when nothing changed since the last save) → **Review** (not Actions → Submit) → Review Order screen opens (Q14) | Human reports Review Order screen with lines and totals (Order Total bar) and a Delivery Details table matching Act 13's lines. If Actions → Submit was used by mistake, `Status` jumps to `Submitted` with no signature: record `BLOCKED (wrong path)` and see FP-14.3; use a fresh Draft Quote: build one for `<STORE_n>` by repeating the Act 13 quote build (13.3, 13.5–13.9, 13.10, 13.12, 13.13, 13.13a; same Visit and 7.14 lines, no 13.11 needed), re-read its Id after the last sync, and continue 14.3 on it | — | — |
| 14.4 | Read the disclaimer | n/a | 👤 HUMAN (iPad) — scroll to Disclaimer section, `<DISCLAIMER_TEXT>` for `<DISCLAIMER_COUNTRY>` (Q15) | Human confirms disclaimer text displayed, numbered clauses render (not raw tokens; if raw tokens appear, see FP-13.4) | — | FP-13.4 |
| 14.5 | Capture signature | n/a | 👤 HUMAN (iPad) — sign in "Your Signature" pad (Q15). Keep every stroke inside the pad; never start a stroke at the screen edge (an edge start triggers the iPadOS window gesture and shrinks the app; clear the pad and re-sign) | Human reports signature captured. Submit Order may still be greyed out, which is expected until 14.5a | — | — |
| 14.5a | Unlock Submit Order with the lock icon and passcode | n/a | 👤 HUMAN (iPad) — 14.6 already passed before 14.3, so no stop is needed here: tap the **lock icon** next to Submit Order, then enter the app passcode. The human always enters it, including on a simulator and after an app relaunch; the agent never types, records or stores it and never taps Reset Passcode or Log out | Submit Order becomes enabled | — | — |
| 14.6 | ⏸ STOP — confirm readiness for a one-shot Submit | n/a | Consent **C10**: runs **before 14.3**, before the human starts. If pre-consented and the precondition passes (`Quote.Status = Draft` read now from the server after the latest sync, and `NetUnitPrice` on the quote lines matches the Act 7 pricing simulation; do not use `CalculationStatus`, which stays `NotStarted` on iPad-priced quotes even when prices are correct), record `pre-consented (C10)` and give the human 14.3–14.7 in one message, telling the rep to tap Submit Order once; otherwise ask live. C10 covers this Submit; it is asked again only if 15.0 has to build a replacement source quote. Either way, state plainly that Submit will be tapped once and not retried regardless of how the screen looks afterward | Consent recorded before 14.7 | — | — |
| 14.7 | Tap Submit Order — once | `Quote.Status` (via UI action, stage transition) | 👤 HUMAN (iPad) (human only; do not script a double-tap) — tap Submit Order a single time | Human reports either the "Review submitted successfully." toast or an error; either way, do not tap again | — | FP-14.3 |
| 14.8 | Agent reconciles Quote status before any further action | `Quote` query | After the human reports the 14.7 tap (whatever the screen showed) and a manual sync (11.3): `SELECT Status FROM Quote WHERE Id = '<ID:quote>'` | `Status = "Submitted"` → success regardless of what the screen showed; anything else → investigate before any retry, and never retry Submit itself | Detect → this is the authoritative check, overriding the human's screen report if they disagree | FP-14.3 |
| 14.9 | Confirm path and line display | n/a | 👤 HUMAN (iPad) — path shows Submitted (current); lines are read-only (View Line Items) with the Act 13 values; totals show in a **Quote Summary** section below the Quote Line Items grid (Subtotal, Discount, Grand Total) (Q16) | Human reports path/UI matches. If the path also lists Status values that are not in `QUOTE_STAGES`, or ticks earlier values never visited, or offers Mark Status as Complete, record `PASSED_WITH_NOTES` `KNOWN_LIMITATION` (standard Status picklist order; see Act 8) and continue. **Locked-quote entry points:** on the Related tab, the Quote Line Items row ••• may still offer Edit and Delete and open the cart. Saving there fails with "Failed to save record" and the server is unchanged, so the lock holds: tell the rep to Close without saving, record `PASSED_WITH_NOTES` and report the exposed entry points to Salesforce Support as a UX defect with screenshots. Whether a `QuoteLineItem` `LifeSciStageOperation` row would hide them is unverified; do not add one in this run | — | — |
| 14.10 | Agent confirms signature artifacts | `DigitalSignature`, `DocumentRecipient`, `QuoteDocument` | After 14.8 shows `Submitted`: `SELECT Id FROM DigitalSignature WHERE ParentId = '<ID:quote>'`; `DocumentRecipient` has no Quote reference field, so query it through the quote document: `SELECT Id FROM QuoteDocument WHERE QuoteId = '<ID:quote>'`, then `SELECT Id, SignatureIdentifier FROM DocumentRecipient WHERE QuoteDocumentId = '<ID:quoteDocument>'` (fields: `QuoteDocumentId`, `DocumentId`, `DigitalSignatureId`, `RecipientId`; describe once to confirm) | Exactly one `DigitalSignature`, one `QuoteDocument` and one `DocumentRecipient` for the quote (`SELECT COUNT()`); `SignatureIdentifier` may be null until PDF generation completes, see 14.12). Both rows are created by the signed Submit Order on the device (the `DigitalSignature` with `ParentId` = the quote, the `DocumentRecipient` linked to it), normally within seconds and before any manual sync. **0 `DigitalSignature` or 0 `DocumentRecipient` after `Submitted`:** record 14.10 `FAILED` with the literal counts (queried as an admin with View All Data), do not re-tap Submit and do not create the rows; re-check on the next signed Submit (15.0, when it builds a source quote) before calling it a defect (FP-14.4). **More than one of any:** record 14.10 `FAILED` with the counts and stop: the quote was submitted or its PDF generated twice; do not re-submit, regenerate or delete anything without the customer's yes (FP-14.6) | — | FP-14.4 |
| 14.11 | Tap Generate PDF once (the tap produces the PDF) | `QuoteDocument` (via `Generate PDF` action) | Submit Order creates the `QuoteDocument` `In Progress` (14.10) but does not produce the file; the iPad **Generate PDF** tap does. Agent first queries `SELECT Id, Status FROM QuoteDocument WHERE QuoteId = '<ID:quote>'`. `In Progress` → 👤 HUMAN (iPad) — Actions (Submitted) → **Generate PDF**, **once** (Q17). The iPad shows the toast "PDF generation started" and opens no viewer; never tap it a second time (G2). `Completed` already → skip the tap. **iPad only:** on web the stage action shows "Unknown component" (K23), so never use it there; the finished PDF opens on web from the quote record (its Files / Quote Documents), not through that action. If no `QuoteDocument` exists, record `BLOCKED (no QuoteDocument after Submit Order)` as an open item, do not tap Generate PDF, and continue to 14.13 | Human reports the toast, or 14.11 recorded as skipped / no document | Detect → one tap per document; never a second tap | FP-14.4 |
| 14.12 | Agent polls PDF generation on a bound | `QuoteDocument.Status` | After the 14.11 tap, query every 20s, max 30 attempts (10 min) | `Status` reaches a terminal success state (`Completed`) with a document attached, created and last modified by the rep (seconds after the tap in testing). Agent check of the file: download its `VersionData` as raw bytes (as 10.6) and confirm the lines, totals and the signature image. The PDF has no disclaimer text (shown only on Review Order), and Bill To / Ship To are empty because the iPad quote carries no addresses: notes, not failures. `Queued` and `Generating` are in-flight: keep polling. `Failed` is terminal: stop polling, record 14.12 `FAILED` with the literal `Status`, and do not use K1; G2 still applies. If still "In Progress", "Queued" or "Generating" at the bound after the one tap, first re-run the 8.24a query: no row, or Create false → that is the cause; grant it (8.24a), and the next signed Submit with one tap completes; ask before any re-publish of this document (G2). Then run the two FP-14.4 configuration checks. If 8.24a and both checks pass, record `PASSED_WITH_NOTES` `KNOWN_LIMITATION` (K1; report to Salesforce Support if the customer wants it fixed), keep gate G2 and continue to 14.13; do not keep polling and do not stop with a P5. **G2: never re-publish the event, regenerate, delete or re-trigger a stuck document without the user's explicit consent**; an admin re-publishing the event completes it, but only with that consent. If either check fails, fix it per step details, then stay in the FP-14.4 branch (status `BLOCKED` until the fix is approved and applied). The fix approval does not cover a regenerate, re-publish or delete: ask again before any of them (G2) | Detect → do not re-trigger Generate PDF while a prior attempt is still in flight | FP-14.4 |
| 14.13 | ⏸ STOP — before the gated Request for Unlock / In Review / Rejected test | n/a | If `TEST_UNLOCK_ROUTE = no`, mark 14.13–14.15 `skipped` and continue (Act 15 then needs no extra step beyond 15.0). If `yes`, 14.2a must have passed; stop once to confirm who decides (`<MANAGER_USER>`, or the admin acting on the Approval Work Item in web; recommended default: the admin in web, one Reject). Unlock moves the quote out of `Submitted` (Request for Unlock → In Review → Rejected or Draft), so after this branch the store has no `Submitted` quote; Act 15.0 handles that. Reject and Approve both complete when 8.21a is applied; if it was skipped, Approve leaves the quote `In Review` (`KNOWN_LIMITATION` K24) | `<MANAGER_USER>` availability confirmed, or steps skipped by input | — | FP-14.5 |
| 14.14 | (If `TEST_UNLOCK_ROUTE = yes`) Exercise Request for Unlock | n/a | 👤 HUMAN (iPad) — Actions (Submitted) → "Request for Unlock" (sync afterwards: Profile & Territory → Begin Sync → Sync). Then stop and report the sync done; do not decide (14.15) until the agent reports `In Review`. If the human combines 14.14 and 14.15 in one turn, reconcile both afterwards by query instead of the bounded poll | After the human reports the sync done, the agent polls `Quote.Status` and the approval work item (`SELECT Id, Name, Status, AssignedToId FROM ApprovalWorkItem WHERE RelatedRecordId = '<ID:quote>' ORDER BY CreatedDate DESC LIMIT 1`; `Status` values: `Assigned`, `Approved`, `Rejected`, `Withdrawn`, `Errored`, `Recalled`, `Canceled`) every 15s, max 8 attempts (2 min); on timeout report the literal values. Expected `In Review` and work item `Assigned`. If `Status` stays `Request for Unlock` and the work item is `Withdrawn`/errored, re-check 14.2a. The quote stays at the literal value; record it | — | FP-14.5 |
| 14.15 | Manager decides, agent reconciles | `Quote.Status`; approval work item | 👤 HUMAN — after 14.14 shows `In Review`, the decision is made once, by Review → Approve or Reject → Confirm, **on web only**. For profiles with the 8.9b page assignment, the Quote record page carries the Work Guide on its **Approval** tab (8.9a). The iPad Quote page has no Approval tab by design (only Quote Line Items / Details / Related), so no decision is made on the iPad. The alternative route, always available, is the **Approval Work Item record page** (open it from the To Do List item or Approvals). After the human reports the decision, the agent first reads the work item's `AssignedToId` (14.14 query): the person deciding must be signed in on web as that user (unverified for any assignee other than `<ADMIN_USER>` — fallback: ask the customer who signs in; if nobody can, record 14.15 `BLOCKED` with the literal `Status` values and leave the work item untouched). Then it runs `SELECT Status FROM Quote WHERE Id = '<ID:quote>'` | Reject → `Status = Rejected` and the quote stays locked (the Related-tab line Edit/Delete entry points of 14.9 can still appear; Close without saving). Approve → `Draft` when 8.21a was applied. If 8.21a was skipped the quote stays `In Review` (K24: "Send Approved Notifications" fails as the Automated Process user); if so, record `PASSED_WITH_NOTES` + `KNOWN_LIMITATION`, do not move the quote back without the user's explicit consent, and continue. Either decision is valid. Report the literal value. On the iPad after a sync and a reopen: the same `Status` | Do not re-request unlock until the status is reconciled | FP-14.5 |

#### Step details

**14.1 FLS gap**

- Signature: Submit does not appear in the Actions menu at all, with no error (→ FP-14.1).

**14.7–14.8 Submit is non-idempotent on the client**

- Run 14.8's query first. `Status = "Submitted"` means it worked; treat any contrary human report as a UI read, not a system fact (→ FP-14.3).

**14.10, 14.12 PDF pipeline and signature reconciliation**

- Expected chain: `DigitalSignature` created at signing → Submit Order creates the `QuoteDocument` `In Progress` → the iPad **Generate PDF** tap (14.11, once) starts generation (the rep still needs Create on the Quote Document Creation Event, 8.24a) → `QuoteDocument` reaches a terminal state → `DocumentRecipient.SignatureIdentifier` populates once the document is attached.
- `In Progress` after Submit Order is normal until Generate PDF is tapped (14.11). Known stall point: `QuoteDocument` still "In Progress" after the one tap and the 14.12 bound. **Cause (K1):** the rep has no Create on `QuoteDocumentCreationEvent` (8.24a missing), so the event publish fails, and the Generate Quote Flow subscriber (Running, no errors) never fires. With 8.24a the document completes within seconds of the Generate PDF tap, with no admin action. A user-approved admin re-publish of the event for one stuck document also completes it, so the flow and template work. Do not build a workaround: the platform rejects a record-triggered flow on `QuoteDocument`, an Apex trigger on `QuoteDocument`, and a flow that creates the event. Re-publishing the event needs the user's explicit consent (G2); stuck documents are left as they are. `SignatureIdentifier` stays null: the expected symptom, not a separate defect (→ FP-14.4).
- Before reporting `BLOCKED`, run two read-only configuration checks (known causes of a stuck or failed `QuoteDocument`):
  1. **Session Security Level.** The `<FIELD_REP_PROFILE>` session setting must be Standard, not High Assurance. Agent read: `SELECT SessionType, SessionSecurityLevel FROM AuthSession WHERE UsersId = '<ID:fieldRepUser>' ORDER BY CreatedDate DESC`; the rep's `Oauth2` (iPad) session must read `STANDARD`. Record the method as `agent-read (AuthSession)`. If no such session row is returned, ask the human to read it in Setup → Profiles → `<FIELD_REP_PROFILE>` → Session Settings and record `human-read`.
  2. **"Query Non Vetoed Files".** Must be off for the rep on the profile and on every assigned permission set; if on, it blocks the `ContentVersion` insert during generation. Check: `SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId = '<ID:fieldRepUser>' AND PermissionSet.PermissionsQueryNonVetoedFiles = true` (describe `PermissionSet` first to confirm the field name).
- If either check fails: ⏸ STOP and show the change (both are security-relevant). Apply it on approval. Re-generating the document afterwards is itself a G2 action: ask the user's consent for that one new attempt before any tap. If both checks pass, record 14.12 as `PASSED_WITH_NOTES` `KNOWN_LIMITATION` (G2 kept) and continue.

**Device and automation guidance (Act 14)**

- Device handling (strokes inside the pad, human-entered passcode including after a relaunch, Sync path, Save before Sync, simulator reboot): the preamble, "iPad simulator and physical iPad". After a reboot, resume from the last reconciled `Quote.Status`; never re-tap Submit Order to recover.

**14.13–14.15 Request for Unlock branch**

- Route: Request for Unlock (queues offline, syncs) → `Request for Unlock`, locked → approval flow routes to the quote owner's manager → Approve `Draft`, Reject `Rejected`. `In Review` is a custom stage that runs once the approver holds a territory assignment (14.2a). Background steps run as `<NOTIFY_ADMIN_USER>` (8.21a). Name whoever decided.
- On the iPad, sync then close and reopen the quote to see the decision.
- The decision is irreversible. **Do not move a stuck quote back to Draft or Submitted without the user's explicit consent.** Report the literal resulting `Status` (→ FP-14.5).

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Quote | `Status = "Submitted"` (after the unlock branch the quote is no longer `Submitted`; Act 15.0 creates its own Last Order source) | `Quote` record | 14.8 query |
| Signature | `DigitalSignature` + `DocumentRecipient` records exist | Related lists / query | 14.10 |
| PDF | `QuoteDocument` reaches terminal state, or `PASSED_WITH_NOTES` `KNOWN_LIMITATION` at the known checkpoint (document stays `In Progress` after the one Generate PDF tap; G2 kept) | `QuoteDocument` query | 14.12 |
| Unlock route (if run) | Request for Unlock → In Review → Draft (Approve) or Rejected (Reject); actual resulting `Status` documented | Quote record; Approval Work Item record page | 14.15 |

### Checkpoint 14

Report: status (`PASSED` if Submit, signature and PDF reconcile cleanly, `PASSED_WITH_NOTES` if PDF stalled at the known checkpoint (K1, G2 kept, both FP-14.4 checks pass) but Submit/signature are clean, `FAILED` if 14.10 finds no `DigitalSignature` or no `DocumentRecipient` after `Submitted` (open item; re-check on the next signed Submit, FP-14.4), `BLOCKED` if Submit never reflects `Submitted` after reconciliation or if 14.11 recorded `BLOCKED (no QuoteDocument after Submit Order)` (an open item, listed in the report), `AWAITING_CUSTOMER_VALIDATION` if the customer deferred the Request-for-Unlock branch during the run; `TEST_UNLOCK_ROUTE = no` is not a deferral: 14.13–14.15 are `skipped` and the Act can still end `PASSED`), changed (Quote Status, DigitalSignature, DocumentRecipient, QuoteDocument) / reused (n/a) / verified (per End State table), open items (PDF stall as `KNOWN_LIMITATION`, unlock-branch result or deferral, Approve branch result; `KNOWN_LIMITATION` K24 only if 8.21a was not applied), actual duration; update the run manifest.

Act 14 is complete. Ready to continue to Act 15: Repeat order from Last Order + final acceptance?
## Act 15 — Repeat order from Last Order + final acceptance

**Purpose.** Create a second Quote for the same store and confirm what the Last Order product view does now that a Submitted quote exists for that store, then close the run with a two-level completion report covering configuration and customer workflow, web and iPad. **Estimated duration:** 6–10 agent minutes (reconciliation + final report assembly; about 15 when 15.0 builds a replacement source quote, for its prechecks and signature checks) + 10–15 human minutes (second Quote walkthrough); add 10–15 human minutes if 15.0 has to build a replacement source quote and submit it (second C10 Submit) **Depends on:** Act 14 (signed Submit path). A `<STORE_n>` Quote in `<LAST_ORDER_STATUS>` (default `Submitted`) must exist for Last Order to have anything to show; the Act 14 unlock branch moves its quote out of `Submitted`, so 15.0 creates a dedicated source quote when none qualifies; Act 13 (same product/line mechanics)

**Run order:** 15.0, 15.1, 15.2, 15.3, **15.5, 15.4**, 15.6, 15.7 (15.4 compares the lines that reach the server only after the 15.5 Save and sync). Numbers are not changed.

### User Thread

| User Thread | Needed (features, settings, services) | Known Gaps |
| :---- | :---- | :---- |
| 🧑‍💼 Admin: "Does Last Order work?" 🤖 Agent: reports exactly what appears and whether picking it prefills *(P1)*. | `ProductsFromPreviousOrder` view, `<LAST_ORDER_STATUS>` gating | Prefill is partial by design: manual discount not copied (`KNOWN_LIMITATION`, K2, 15.4). |
| 🧑‍💼 Admin: "Ready for a real store team?" 🤖 Agent: two verdicts, configuration and workflow, for web and iPad; what is proven, proven with caveats, unverified, and what Support should see *(P1, P5)*. | Final run-manifest assembly; UNVERIFIED, Gap journal, Human-required | Open items (PDF stall, heading token, Last Order prefill) are reported, not hidden. |

### Build steps

Device guidance: the preamble, "iPad simulator and physical iPad" (Sync from the Profile & Territory tab bar, not the cart's "…" menu; passcode human-entered; verify the open quote's name before tapping).

| # | Step | API / metadata name | Mechanism | Postcondition (query/check) | Idempotency (detect → reuse, else create) | Playbook |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 15.0 | Ensure a Last Order source quote exists | `Quote` | Agent: first `SELECT Id, Name, Status FROM Quote WHERE Id = '<ID:quote14>'`; only if it is not at `<LAST_ORDER_STATUS>`, `SELECT Id, Name, Status FROM Quote WHERE QuoteAccountId = '<ID:STORE_n>' AND Status = '<LAST_ORDER_STATUS>' AND CreatedDate >= <run start time from the manifest, UTC> ORDER BY CreatedDate DESC LIMIT 1`, and tell the customer which quote is used (never one created before this run) (device-created quotes write `QuoteAccountId`; `AccountId` stays empty). Act 14's signed Submit normally leaves one: reuse it as the source (`<ID:quote14>`) and continue. If none (expected when Act 14 ran the unlock branch): a quote of this store back at `Draft` after the unlock Approve can be re-submitted through Act 14's signed path (below) and used as the source; otherwise create a source quote for `<STORE_n>` exactly as in Act 13 (steps 13.3, 13.5–13.9, 13.10, 13.12, 13.13, 13.13a; same Visit, Store Assortment, the Act 13 line set incl. the manual discount), then run Act 14's signed path on it: cart Save → Review → sign → lock icon + passcode (human-entered) → Submit Order, once, checking `Quote.Status` before any further action. Recommended default: re-submit a Draft-after-unlock quote if there is one, else build the source quote now (consent C10 is asked again for this second one-shot Submit; the human taps Submit Order). Alternative: stop here and run Act 15 later | Query returns one row with `Status = <LAST_ORDER_STATUS>`; record its ID as the source quote. Act 15 does not need its PDF: a re-submit creates no new `QuoteDocument`, and an `In Progress` one is left as it is (no Generate PDF tap needed; G2 kept: no re-publish, regenerate or delete without consent) | Detect → reuse a qualifying quote; never move an existing `Submitted` quote | FP-15.1 |
| 15.1 | Create a second Quote for the same store | `Quote` | 👤 HUMAN (iPad) — same mechanism as 13.3 (Quoted Order → New on the visit, or plain New), for `<STORE_n>`. If `Workflow_XIsLockedAndCannotBeCreated` appears, follow gate G4: record 15.1 `BLOCKED (G4)` and create the Quote on web | Human reports Quote record opens, `Status = "Draft"` | Detect: always create new; this Act needs a *second* quote, do not reuse the 15.0 source quote | — |
| 15.2 | Open Add Products and observe the Last Order card | `ProductsFromPreviousOrder` | 👤 HUMAN (iPad) — Actions → Add Line Items → Select Price Book → Select Products | Human reports exactly what cards render: Store Assortment, and whether a "Products from Last Order" card appears above it (expected, since the 15.0 source quote is `<LAST_ORDER_STATUS>`); it names the submit date and submitter. **The card itself is a hard expectation:** if it is absent while the 15.0 source quote is `Submitted` (re-check its status first), it is not a `KNOWN_LIMITATION`; follow FP-15.1 and report in the P5 format. Only the prefill content is a known limitation (15.4) | — | FP-15.1 |
| 15.3 | Confirm the Last Order card is selected, then Continue | n/a | 👤 HUMAN (iPad) — the Last Order card is pre-selected when it appears (listed first); do not tap it, because tapping deselects it. Confirm it shows as selected, then Continue | The cart opens pre-filled ("<n> products were added."): the source quote's products and quantities, Discount empty on every line (15.4). A product list or empty cart instead → FP-15.2 | — | FP-15.2 |
| 15.5 | Save and sync the second Quote | `QuoteLineItem` | 👤 HUMAN (iPad) — Save (does not need to go through Submit again; if Save is greyed out nothing changed since the last save), then Profile & Territory → Begin Sync → Sync. Agent re-reads the quote ID and lines on the server after the sync | Human reports Save completes; server shows the lines | — | — |
| 15.4 | Agent compares resulting lines against the Act 14 quote | `QuoteLineItem` query | After the human reports the 15.5 Save and sync done (lines reach the server only then): `SELECT Product2Id, Quantity, Discount, NetUnitPrice FROM QuoteLineItem WHERE QuoteId = '<ID:quote15>'` vs. the 15.0 source quote's lines (confirm field names with a describe) | Report match / partial match / no match; any is a valid finding, not a failure. **Pass rule (expected outcome, K2):** (a) every source product is on the repeat quote with the same `Quantity`; (b) manual discount is not copied (`Discount` empty or 0 on the repeat line); (c) tier pricing is re-applied on Save, so each repeat `NetUnitPrice` equals the Act 7 simulated tier price for that quantity; (d) repeat total − source total = every manual discount on the source, since none is copied: Σ over source lines of (tier price − source `NetUnitPrice`) × `Quantity`, plus any quote-level (header) adjustment amount, within ±0.01 per total (rounding tolerance; ±0.01 is a default the customer can change: record the value used in the manifest). All four hold → `PASSED_WITH_NOTES` `KNOWN_LIMITATION` (K2) and continue; reps re-enter manual discounts on repeat orders. The repeat total legitimately differs from the source total by the manual discounts; this is not a `FAILED`. Products or quantities missing, or (d) off by more than the tolerance → report partial/no match with the differing lines and follow FP-15.2 | Detect → do not force a retry if the result is "browse only, no prefill" | FP-15.2 |
| 15.6 | Assemble the two-level completion report | Run manifest | Agent synthesizes across Acts 1–15: configuration verified vs. customer workflow verified, each for web and iPad | Report produced covering both axes | — | — |
| 15.7 | Final run-manifest close-out | Run manifest; `org-changes.md` | Agent asks the C12 cleanup question **at run close** (by `ORG_KIND`: `customer` → ask whether to turn Login-As off, recommending off; `test` → leave it on, no question) and records the answer and, where it was turned off, how. Then records final state, open items, per-Act timing totals and appendix fragment references, and hands over `run-learnings.jsonl`, the Gap journal and `org-changes.md` (row count, rows still `kept`, rows whose thread change is not yet applied). Any later fix to this org is logged in the same `org-changes.md` | Manifest closed; C12 answer recorded; every Act has `activeMinutes` and `humanWaitMinutes`; every UNVERIFIED item tested in this run has a `verification` row | — | — |

#### Step details

**15.2–15.4 Last Order behavior**

- If the card is absent, first check the 15.0 source quote is still `Submitted` (→ Act 14 FP-14.3) before treating it as a Last Order defect (→ FP-15.1).
- Known outcome: card pre-selected; prefill partial (manual line discount not copied, tier pricing re-applied on Save). Report the literal outcome: full, partial, browse-only or empty (→ FP-15.2).

**15.6 Two-level completion report format**

Report both axes explicitly, not collapsed into one verdict:

```
CONFIGURATION VERIFIED
  Web  : [deploys Acts 1-10 — status, any residual gaps]
  iPad : [Act 10 mobile cache — Active, ZIP acceptance per 10.7]

CUSTOMER WORKFLOW VERIFIED
  Web  : [Act 6-8 pricing/catalog simulations — pass/fail per scenario]
  iPad : [Act 12 Store Check E2E, Act 13-14 Quote E2E, Act 15 Last Order — pass/fail/unverified per step]

OPEN ITEMS (carried to appendices)
  [UNVERIFIED items, GAPS items, HUMAN-only items from Acts 10-15]
```

- Do not conflate the two claims: a schema deploying cleanly does not mean a rep can complete a transaction with it.

### End State

| Area | End state | Where to see it | Verified by |
| :---- | :---- | :---- | :---- |
| Last Order source | One quote for `<STORE_n>` in `<LAST_ORDER_STATUS>`, untouched by the unlock test | `Quote` query | 15.0 |
| Second Quote | Draft (or further, if the admin chose to carry it through Submit) Quote exists for `<STORE_n>` | `Quote`/`QuoteLineItem` records | 15.1/15.4 |
| Last Order behavior | Documented actual behavior (card presence + prefill content) | Device screen (human-reported) + 15.4 query | 15.2–15.4 |
| Run closure | Two-level completion report produced; C12 answered; run manifest closed | Run manifest | 15.6–15.7 |

### Checkpoint 15

Report: status (`PASSED_WITH_NOTES` is the normal outcome: the prefill does not carry the manual discount (K2); `PASSED` only if prefill matches the source quote exactly and every other Act 10–15 item is clean; `AWAITING_CUSTOMER_VALIDATION` if the admin wants to review open items (PDF stall, Store Check heading token, Last Order prefill) before accepting the run), changed (second Quote + lines) / reused (n/a) / verified (per End State table), open items (full list from the two-level report), actual duration; update the run manifest with final close-out.

Act 15 is complete. This closes the steel thread.
## Overall end state

| System area | End state | Where to see it | Verified in |
| :-- | :-- | :-- | :-- |
| Org foundation | State/Country picklists, Business Account record type, Person Accounts, Multi-Currency with `<CORP_CCY>` and `<ACTIVE_CCYS>`, Enterprise Territory Management, inventory, care-plan and survey preferences on | Setup → Company Information, State and Country/Territory Picklists, Territory Settings | Act 1 |
| Package | `lsc4ce` installed at the pinned version `<PKG_VERSION_ID>` (supplied, or detected at 0.9); admin holds the LSC4CE and Health Cloud Starter licences and permission sets | Setup → Installed Packages | Acts 1, 2 |
| Industries settings | Store Check, Quotes, Group Membership, record-type routing preference on; mobile-admin permission set assigned | Setup → Store Check, Quote Settings | Act 3 |
| Field Rep | `<FIELD_REP_USER>` on `<FIELD_REP_PROFILE>` with runtime licences, permission sets, Core CPQ access and Quote create access | Setup → Users | Acts 4, 8 |
| Territory and stores | Active `<TERRITORY_MODEL>`; rep assigned to `<TERRITORY>`; each `<STORE_n>` is a Business Account with a billing-address Place, linked to the territory | Territory Models; Accounts tab | Act 5 |
| Order Management and pricing | OM turned on; `<CONTEXT_DEF>` active with the Quote mapping as sole default; one active `<PRICING_PROCEDURE>` version (tiers + percentage/amount manual discount + header adjustment, Total Price Override reset to list, no rounding step); `<STT_NAME>`; Revenue Settings default set | Setup → Revenue Settings; Pricing Procedures | Acts 6, 7 |
| Catalog | `<CATALOG>`, `<CATEGORY_n>`, `<PRODUCT_n>`, selling models, `<PRICEBOOK_n>` with entries per currency, tier schedules, territory availability for Quotes, product discovery flow | Product Catalog Management; Price Books | Act 7 |
| Quote web | Quote record type, layout, FLS, record page (single-column template, highlights + stage path), product views (Store Assortment + Last Order + Priority tab), 5 Quote statuses with the Draft→Submitted graph and the unlock branch (Request for Unlock, In Review, Rejected; Approve and Reject) in place, Approval tab hidden for the rep and visible to the approver, signature, document template, disclaimer, default document | Quote record on web | Act 8 |
| Store Check web | Visit Decoupling (record-type routing) for In-Person, Remote and Store Check; Store Check Visit page with a Quoted Order tab (layout `Quotes` related list; New starts a visit-linked quote); Visit path Planned → In Progress → Completed; assortment, 3 tasks, indicators, targets, templates, availability, and the runtime shares (9.21: 10 rows after an approved C13, 13 if declined; 9.22: 3 or 6) | Visit record on web | Act 9 |
| Quote from visit | The Store Check Visit layout carries a `Quotes` related list; the Quoted Order tab lists the visit's quotes; New pre-fills Visit and Account for Quote; the saved quote has `Quote.VisitId` set. The Create Quote action does not appear in the iPad visit menu (K13) | Visit record on web and iPad | Acts 9, 13 |
| Mobile cache | One Active parent/child metadata pair; ZIP contains every DbSchema and non-empty pricing files; the 10.1 bundle is 63 components (61 if the customer opts out of the field sets) | `LifeSciMobileMetadataRecord` | Act 10 |
| iPad | Rep logged in, first sync complete; Store Check journey SC1–SC14 and Quote journey Q1–Q17 accepted or gated; Last Order verified on a second quote; price waterfall complete for lines priced on the iPad (K25 is the only accepted waterfall gap) | iPad app | Acts 11–15 |

## Per-screen acceptance checklist

The rep performs each item on the iPad. The agent then confirms the server-side record state with the listed query. Items marked **Gate** are known platform defects: they are tested once, and the result is reported in the P5 format.

### Store Check (14 screens)

| # | Screen | Accept when | Configured by | Agent confirms |
| :-- | :-- | :-- | :-- | :-- |
| SC1 | Visits → All Visits | List shows Name, Account, Record Type, Status, Planned Start Time; **New** present | 9.10 (Visits nav, tab visibility), 10.1 (`DbSchema_Visit`, `DbSchema_RecordType`), 12.1 | `GET /services/data/v<API_VER>/ui-api/list-ui/Visit` to find the All Visits list view's API name, then `GET …/ui-api/list-info/Visit/<that name>`: `displayColumns` include the eight columns (Name, Account, Record Type, Status, Planned Start Time, Planned End Time, Visit Priority, Visitor) |
| SC2 | New Visit → record-type picker | In-Person, Remote, Store Check offered; Store Check selectable | 3.5 (routing pref), 9.5–9.8 (Store Check RT, routing records, profile RTs) | Retrieve `Profile:<FIELD_REP_PROFILE>`: `recordTypeVisibilities` show `Visit.In_Person`, `Visit.Remote`, `Visit.Store_Check` visible. Do not use an admin describe: `recordTypeInfos[].available` reflects only the calling user |
| SC3 | New Store Check Visit form | Account, Place (required), Record Type (read-only Store Check), Planned End Time, Parent Organization, Planned Start Time (required), Channel | 9.5 (Store Check layout + FlexiPage) | `GET /services/data/v<API_VER>/sobjects/Visit/describe/layouts/<ID:storeCheckRecordType>` lists the seven fields, with Place and Planned Start Time required |
| SC4 | Form filled | Place lookup offers "<store> - Billing Address" | 5.6 (billing-address Place), 10.1 (`DbSchema_ContactPointAddress`) | `ContactPointAddress` for the store |
| SC5 | Visit record | Header (Account, Place, Planned Start, Status = Planned, Channel); path Planned → In Progress → Completed; **Begin Visit**; tabs Details / Store Check / Quoted Order | 9.5 (FlexiPage tabs), 9.5 / 9.9 (Quoted Order tab, checked in 13.2), 9.11 (stage graph) | `Visit.Status = Planned` |
| SC6 | Begin Visit | "Continue without location?" dialog → **Start Visit**; Begin Store Check disabled before start | 9.11 (stage operations/actions) | — |
| SC7 | Visit started | Toast "Check-in complete…"; Status In Progress; **End Visit**; Begin Store Check enabled | 9.11 | `Visit.Status` = the In Progress API value recorded at 12.6, `ActualVisitStartTime` set |
| SC8 | Store Check — Availability Audit | Title = account name, subtitle = full address; tabs Availability Audit / Primary Display / Secondary Display with counts; grouped by category; Priority ★; Target shown; the card heading may show a raw component name (K5); each tab grid shows Verified and Product, then the indicators in the 9.18 order, then Photo (no product-attribute columns, 10.1), with rows under Miscellaneous | 9.12–9.13, 9.19–9.22 (assortment, tasks, targets, templates, shares, availability), 7.2/7.5 (categories), 5.6 (address) | `AssessmentTask` rows for the Visit |
| SC9 | Availability Audit (scrolled) | Columns Verified, Product, No Stock, Stock Count, Out-of-Stock Reason, Days of Cover, Distribution Status, Backroom Stock On-Hand, Shelf Price, Last Restock Date, Photo | 9.14, 9.17, 9.18 | `AssessmentIndicatorDefinition` per column |
| SC10 | Filters | Out of Stock, ★ Priority (n), Anomalies | 9.12 (priority flags), 9.14 (No Stock) | — (**Anomalies**: see UNVERIFIED items) |
| SC11 | Primary Display | Verified, Product, Primary Location Present, Facing, Share of Shelf (%), Position, Planogram Compliance | 9.15, 9.17, 9.18 | indicator rows |
| SC12 | Primary Display (scrolled) | Planogram Compliance, Price Tag Display, Adjacency Compliance, Photo | 9.15, 9.17, 9.18 | indicator rows |
| SC13 | Secondary Display | Verified, Product, Secondary Display, Display Location, POSM, POSM Condition, Promotional Price Display | 9.16, 9.17, 9.18 | indicator rows |
| SC14 | Secondary Display (scrolled) | Promotional Price Display, Promotional Price Value, Secondary Display Units, Photo; **Save** / **Save & Close** persist values | 9.16–9.18, 10.1 (`DbSchema_AssessmentIndValue`, `DbSchema_RetailVisitKpi`) | `AssessmentIndValue` / `RetailVisitKpi` after sync. **Gate:** Verified checkbox not persisted |

### Quotes (17 screens)

| # | Screen | Accept when | Configured by | Agent confirms |
| :-- | :-- | :-- | :-- | :-- |
| Q1 | Quotes → All Quotes / My Quotes | Columns Quote Name, Account for Quote, Status, Subtotal, Total Price; **New** | 8.5–8.6 (Quote tab), 10.1 (`DbSchema_Quote` + profile tab visibility) | Quote list via UI API |
| Q2 | Create New Quote — Quote Information | Sales Transaction Type, Quote Name*, Quote Currency, Account for Quote*, Description, Shipping / Billing Contact Point Address, Validation Result, Status (read-only Draft), Expiration Date, Visit, Distribution Channel, Partner Account | 8.1–8.3 (RT, layout), 8.13 (FLS), 7.16 (STT) | Layout describe |
| Q3 | Create New Quote — more sections | Aggregation Strategy; Totals; Prepared For (Contact Name, Phone, Email, Fax); Address Information | 8.2 | **Gate:** raw i18n section-header tokens |
| Q4–Q5 | Create New Quote — address and system | Bill/Ship To City, Zip, Latitude, Longitude, Geocode Accuracy, State/Province Code, Country Code; System Information; **Save** | 8.2, 8.13, 8.15 | `Quote.Status = Draft`. **Gate:** nil Status on Save; `Workflow_XIsLockedAndCannotBeCreated` |
| Q6 | Quote record | Header = title + the first 5 compact-layout fields in the 8.9c order (Quote Number, Expiration Date, Syncing, Opportunity ID, Account for Quote; Expiration Date is not shown and Opportunity ID is blank on device, 13.3(c)); Grand Total, Discount, Subtotal and Billing/Shipping CPA (may show "-", K20) are read in the body, not the header; path Draft → Submitted → Request for Unlock → In Review → Rejected; tabs Quote Line Items / Details / Related (the Approval tab is hidden for the rep); Quoted Line Items + Quote Summary footer (`transactionSummary`, 8.9); no separate Quote Summary tab | 8.7–8.9 (FlexiPage, header, stage path), 8.16–8.21 (stages, approval tab) | — **Gate:** blank address |
| Q7 | Actions (Draft) | Add Line Items, Submit | 8.17–8.18 | — |
| Q8 | Select Price Book | Account + address shown; list of `<PRICEBOOK_n>`; Select Products enabled after choice | 7.6 (price books, entries), 10.1 (`DbSchema_Pricebook2`/`PricebookEntry`) | `Pricebook2` active, PBEs per currency |
| Q9 | Add Products to Quote | **Store Assortment** card (n Products) and **Last Order** card (from the second quote of a store, Act 15); Add Manually; Continue | 8.10 (product views), 9.12 (assortment) | — (the Last Order card is a hard expectation at 15.2 once a Submitted quote exists (15.0); only the prefill content is a known limitation, K2) |
| Q10–Q11 | Product picker | Tabs All Products / Priority Products; search by name, code, description; select and **Add to Quote** | 7.3, 7.7–7.8, 8.10 (`EnablePriorityProductsTab`), 9.12 (priority flags) | — |
| Q12 | Line editor | Toast "n products were added."; columns Product (price / unit), Quantity, List Price, Discount, Additional Free Item Quantity, Net Unit Price | 7.13–7.15 (procedure), 8.9 (line display fields), 8.14 (mobile pricing TPT) | `QuoteLineItem` rows after Save |
| Q13 | Pricing | Calculation Details popover (List Price, adjustments, Net Unit Price); footer Subtotal, Order Discount, Discount, Grand Total; counters Free Goods • Products • Items • Delivery | 7.10–7.15 (tiers, procedure) | `NetUnitPrice` equals the Act 7 simulation. **Gate:** reprice ComponentContext error |
| Q14 | Review Order | Close, lock icon (then the app passcode, human-entered, 14.5a), Submit Order (disabled until signed); summary card; Delivery Details; Order Total | 8.13, 8.18, 8.22 | — |
| Q15 | Disclaimer + signature | `<DISCLAIMER_COUNTRY>`-prefixed `<DISCLAIMER_TEXT>`; Your Signature pad with Clear | 8.28 (disclaimer), 8.22, 8.26–8.27 (signature), 10.1 (`DbSchema_ComplianceStatementDef`, `DbSchema_DigitalSignature`) | — |
| Q16 | Submitted | Toast "Review submitted successfully."; path at Submitted; lines read-only; Quote Summary (Subtotal / Discount / Grand Total) | 8.17–8.19 | `Quote.Status = Submitted`; one `DigitalSignature`. **Gate:** double submit |
| Q17 | Actions (Submitted) | Request for Unlock, View Line Items, Generate PDF | 8.21 (unlock action + approval flow), 8.23–8.24, 8.29 (documents) | `QuoteDocument` created `In Progress` at Submit; one Generate PDF tap completes it (toast "PDF generation started"; no viewer on the iPad; the PDF opens on web). **Gate:** PDF stuck In Progress (G2); unlock route (G10) |

## Irreversible-action consent list

C1–C11 and C14 are shown at step 0.11. C12 is asked just in time at 8.30a and never blocks. C13 is shown at 0.11 only when `ORG_KIND = test`; on a `customer` org it is always a live stop at 9.20a and is never pre-consented. For each item the customer answers `yes` (pre-consented) or `ask` (stop live). A `yes` holds only while its precondition check passes at the step; if it fails, the agent stops and shows what differs. Exception, not a failure: an action already in effect at the Act 0 baseline (C1 fields already `true`, `BillingCountryCode` present for C2, `IsPersonAccount` present for C3, Multi-Currency active for C4, the package installed for C5, Order Management On for C7, a C14a–C14c setting already enabled) is recorded `not applicable (already in effect)`; no prompt, and the step takes its detect-then-skip path.

| Item | Step | Action | Consequence | Precondition re-checked before acting |
| :-- | :-- | :-- | :-- | :-- |
| C1 | 1.1 → 1.2 | Enable Chatter and the base Industries / package / Document Management settings | Org-wide; no self-service way back | The 1.2 fields still read as in the 0.5 baseline |
| C2 | 1.3 → 1.4 | Convert to State and Country/Territory picklists | Hard to reverse: disabling is offered in Setup, but the integration values and code fields it created stay in use by later Acts; changes every address field in the org | Account describe has no `BillingCountryCode` field (`Address.settings` carries no picklist flag) |
| C3 | 1.7 → 1.8 | Enable Person Accounts | Org-wide; cannot be disabled | 1.5–1.6 done; Account describe has no `IsPersonAccount` field |
| C4 | 1.10 → 1.11 | Activate Multi-Currency with `<CORP_CCY>` and `<ACTIVE_CCYS>` | Cannot be deactivated; corporate currency is the base for every rate | Apex `UserInfo.isMultiCurrencyOrganization()` is `false` and `CurrencyType` is still unsupported or the single 0.7 row; 1.9 saved the Security Contact or recorded the field as absent |
| C5 | 2.2 → 2.3 | Install `lsc4ce` at `<PKG_VERSION_ID>` (only when 0.9 found it not installed; otherwise `not applicable (already installed)`) | Go/no-go, not irreversible: uninstall is possible only while no package data exists | 2.1 passed; package not yet installed |
| C6 | 5.2 → 5.3 | Activate `<TERRITORY_MODEL>` | Drives Account sharing from then on; no return to Planning | 5.1 done; model in `Planning`; no other model `Active`. Not asked when the customer chose their own active model at 5.1 |
| C7 | 6.3 → 6.4 | Turn On Order Management (the 11 settings in 6.4: Revenue Cloud, Quotes, Document Builder, Advanced Approvals, Context Service, Pricing, Price Waterfall, Transaction Processor, Order Capture, Standard Price Book activation, Quote record page; Quotes without Opportunity turns on as a side effect) | Org-wide; no supported disable path | the 6.2 dialog title matches with whitespace around the hyphen ignored; feature not yet On |
| C8 | 8.17 | Activate the `StagePathPermissionsHandler` trigger handler with a Tooling update (`IsActive=true`) | Org-wide stage-path enforcement; makes Submit available. Undo only on the customer's request: set `IsActive=false` with the same call | 8.13 FLS and 8.16 values in place; handler inactive |
| C9 | 8.20 → 8.21 | Build the Request for Unlock / In Review / Rejected branch and its approval flow | Adds lifecycle data and an active flow (Approve and Reject routes) | 8.18 graph and 8.19 shares present |
| C10 | 14.6 → 14.7 | One Submit Order tap on the test Quote (a second tap only when 15.0 has to build a source quote) | Locks the Quote; it is not resubmitted or reused | Signature captured; `Quote.Status = Draft`; the lines' `NetUnitPrice` matches the Act 7 simulation |
| C11 | Gated branches | Enter each gated test (G1–G12) once | Runs one known-defect test; state is preserved whatever the result | The gate's own step prerequisites are done |
| C12 | 8.30a | Enable Setup → Login Access Policies → *Administrators Can Log in as Any User* (so the person runs the web checks as the rep) | Org-wide login setting; reversible, turned off in Cleanup | Setting still off; `SMOKE_AS_REP = yes` |
| C13 | 9.20a | Set internal org-wide sharing to Public Read Only for `AssessmentIndicatorDefinition`, `AssessmentTaskDefinition` and `ProductTerritoryAvailability` | Every internal user gets Read on these three objects; external sharing is unchanged. Undo only on the customer's request: redeploy the retrieved copy. On a `test` org it may be pre-consented at 0.11; on a `customer` org always a live stop, never pre-consented. If declined, the explicit shares in 9.21 and 9.22 give the rep the same access | `InternalSharingModel` of the three objects is not already `Read` |
| C14 | Listed in C14a–C14m | Access grants and hard-to-reverse setup changes: one answer at 0.11 covers every row below; each step starts with a C14 check (`yes` and the precondition passes → act; `ask` → ⏸ live STOP; declined → step not run, recorded `declined`, reported `BLOCKED`) | Each row states its own consequence | Each row states its own precondition |
| C14a | 1.14–1.17 | Enable the four org preferences (`InventoryCountEnabled`, `InventoryBatchManagement`, `PrdInventoryOperationsPref`, `CarePlansPreference`) | Org-wide switches | The 1.14–1.17 `GET` of each preference does not already read enabled |
| C14b | 1.18a | Enable Account Plans | Org-wide; adds the Account Plan objects the package layouts need (2.4) | 0.5 baseline and 0.10 preference read not enabled |
| C14c | 1.13 | Enable Sales Territory (Enterprise Territory Management) | Org-wide; later sharing depends on it | `Territory2Settings.enableTerritoryManagement2` reads `false` |
| C14d | 4.9a, 8.15 | Assign the Quote-create permission sets to `<FIELD_REP_USER>` | Also grants org-wide `AppUsageAssignment` Read with no row-level isolation | The assignment row does not exist |
| C14e | 5.4a | Assign `<MANAGER_USER>` to `<TERRITORY>` | Gives the manager Read on the territory's stores. Reversible (delete the row) | No row for the (user, territory) pair |
| C14f | 8.25 | Assign the Document Builder licence (`DocumentBuilderUserPsl`) and permission set (`DocumentBuilderUser`) to the deploying admin | Licence and entitlement grant. Unavailable or declined → `BLOCKED_DOCGEN` | Neither assignment exists |
| C14g | 8.16a | Set the five generic `QuoteStatus` values inactive and deactivate the Quote Path (PathAssistant) | Org-wide; the Path for Quote stops showing | Values active; an active Path exists for Quote |
| C14h | 8.9c | Remove the `IsLargeDeal` field entry and the `CreateRampSchedule` default overrides (N, counted at the retrieve) from the Quote object deploy copy | Changes the Quote object metadata; rollback copy kept | Retrieve lists them; rollback copy saved |
| C14i | 9.22a | Deploy the All Visits list view with 8 explicit columns | Org-wide list view: every user sees the columns | Original list view saved as rollback; not all 8 columns present |
| C14j | G12 (13.3–13.6) | Change the rep's (or store's) currency to fix the mismatch | Changes which price books and currency the rep's Quotes use | 13.3–13.6 shows the mismatch |
| C14k | 9.21 | Muting hardening (permission set group with muting set), only when `MUTE_INDICATOR_EDIT = yes` | Changes the rep's effective access on indicator definitions *(unverified — fallback: skip)* | Group not already assigned |
| C14l | 10.3 | Generate a new mobile metadata cache on an org where Active `LifeSciMobileMetadataRecord` rows exist that this run did not create | Every mobile user of the org gets the new cache at their next sync | The 10.3 count shows such Active rows |
| C14m | 1.18 | Enable Surveys | Org-wide; cannot be turned off: once on, the Setup toggle is locked | `Survey.settings` retrieve reads `enableSurvey` = `false` |

**Manager-territory disclosure (part of C14).** Before 5.4a the agent tells the customer: "`<MANAGER_USER>` will be assigned to `<TERRITORY>` so the unlock approval can be requested and decided." Recorded in the manifest; 8.21c and 14.2a only re-check it.

## Gated branches

Each gate is entered once. Entering a gate is consent item **C11**: if pre-consented, the agent records it and enters; otherwise it stops (⏸) first. It runs the single test, and then follows the matching path below. In every case it reports in the P5 format, preserves state, records a Gap-journal row, and continues.

| Gate | Where | Single test | Known-defect signature | If the signature appears | If it does not |
| :-- | :-- | :-- | :-- | :-- | :-- |
| G1 Submit not idempotent | 14.7 | Rep taps Submit Order **once** | Second submit rejected server-side because the Quote is already Submitted (the client submits twice) | Reconcile `Quote.Status`. If Submitted, treat it as success and do not resubmit | Record PASS |
| G2 PDF stuck "In Progress" | 14.11–14.12 | Generate PDF once (the tap produces the PDF; never a second tap) | `QuoteDocument` stays In Progress after the one Generate PDF tap and the 14.12 bound | Check 8.24a first (rep Create on `QuoteDocumentCreationEvent`); if missing, grant it and test on the next signed Submit and tap. Then run the two FP-14.4 configuration checks. If one fails, ⏸ STOP and fix on approval; then ask again, separately, before any regenerate, re-publish or delete of the `QuoteDocument` (approving the fix is not approving that). Otherwise record `PASSED_WITH_NOTES` with `KNOWN_LIMITATION` (K1) and continue; never re-publish, regenerate or delete the stuck `QuoteDocument` without the user's explicit consent, and do not stop with a P5 | Confirm the PDF ContentDocument |
| G3 New-Quote Save with nil Status | 13.3 | Create one Quote on the iPad | Save fails, or the Quote saves with null `Status` | Confirm `Quote.Status` FLS on `<FIELD_REP_PS>` (8.13). If Edit is missing: grant Edit, regenerate (10.8, which includes the sync and the app relaunch), then repeat the Save once. If it still fails, report | Record PASS |
| G4 iOS workflow lock | 13.3 | Same new Quote | `Workflow_XIsLockedAndCannotBeCreated` | Report a client defect; record the step as `BLOCKED (G4)` (13.3 or 15.1); create the Quote on web (same fields, with the Visit lookup; as the rep per the Rep-session rule, otherwise as `<ADMIN_USER>` after 8.30b) and run the remaining steps on it, with line entry on the iPad. The Act ends `BLOCKED` (or `FAILED` if pricing does not reconcile) | Record PASS |
| G5 Raw i18n tokens (Store Check heading) | 12.7, 13.3 | Open Create New Quote, and the Store Check Visit | The packaged Store Check component heading shows a raw token (for example `ls_storecheck:lsStoreCheckVisit` or `@@@…@@@`). Quote-page section headers must be plain text (8.9); a token there is a thread defect, not this gate | Store Check heading: `KNOWN_LIMITATION` (K5), cosmetic, `PASSED_WITH_NOTES`. Quote-page token: redeploy the 8.9 plain-text labels, sync, re-check; record a note and continue | Record PASS |
| G6 Reprice ComponentContext error | 8.32 web, 13.10 iPad | Reprice All once on web (8.32) and once on the iPad (13.10); each is reported separately | "context hasn't been established" | Reconcile: QLI values unchanged. Retry **once** after reconcile. If it repeats, report | Record PASS |
| G7 Blank address lookups | 13.4, 14.3 | View the Quote and Review Order | Billing/Shipping CPA show "-" | Confirm FLS + CPA values on the server. If set but blank on the device, report | Record PASS |
| G8 Verified checkbox | 12.8–12.11 | Tick Verified, then Save & Close, then reopen | Verified unticked after reopen (the no-backing-field cause is inferred, not confirmed) | Report; other indicator values must persist. Verified is cleared after Save & Close. Record `PASSED_WITH_NOTES` with `KNOWN_LIMITATION` (K4); do not regenerate or delete | Record PASS |
| G9 Offline first upload | 12.5–12.6 | First upload after check-in | A sync error saying the visit start was attempted offline | Reconcile the Visit on the server, then rep runs one manual sync | Record PASS |
| G10 Unlock route + custom In Review stage | 8.21 build, 14.13–14.15 test | Rep taps Request for Unlock once; manager approves or rejects once | No stage change, no approval request for the manager, or status never reaches In Review | Report what was observed with the literal `Status`; leave the Quote as it is | Record PASS and the final status (Draft or Rejected) |
| G11 Last Order | 15.2–15.4 | Second quote for the same store → Add Products | Last Order card absent with a Submitted source quote in `<LAST_ORDER_STATUS>` (15.0), or the card present but the prefill is empty or partial | Card absent: not a limitation; follow FP-15.1 (run 15.0, re-check the source quote's `Status`, sync) and report if it persists. Card present, prefill drops manual discounts or is partial: `KNOWN_LIMITATION` (K2), `PASSED_WITH_NOTES`. Store Assortment path remains the accepted path | Record PASS |
| G12 Quote currency from rep, not store | 13.3–13.6 | New Quote on the iPad for a store, then Select Price Book | Quote `CurrencyIsoCode` differs from the store Account's, or no price books / products are offered | Reconcile: compare `Quote.CurrencyIsoCode`, `Account.CurrencyIsoCode`, `User.DefaultCurrencyIsoCode`. C14 check ([Irreversible-action consent list](#irreversible-action-consent-list)) before changing the rep currency; declined → report only. Fix the mismatch (4.8 / 5.8), then create one new Quote. Report as a known defect | Record PASS |

## Known limitations

**`KNOWN_LIMITATION`** is a tag on `PASSED_WITH_NOTES`. It marks platform or product behaviour that configuration cannot fix. It matches the "Status for known limitations" rule in the preamble: when the observed behaviour matches the entry below, the agent marks the step `done` with the tag, writes the Gap journal row and a run-log entry, lists it under "known limitations" in the checkpoint report, and continues. It is never a P5 stop. Every G-gate named below still applies. Behaviour that differs from the entry is not covered by it and follows the normal failure path.

Not in this list, on purpose: an empty Choose Price Book picker on the web Quote (8.31) points to a missing 8.9b page assignment and has diagnostics and a non-blocking fallback. Quotes without Opportunity being on is an expected setting (iPad quotes have no Opportunity). Raw `@@@SFDC…@@@` section headers on the Quote page are a thread defect fixed at 8.9, not a limitation.

| ID | Known limitation | Step(s) | Status the agent records | Gate / note |
| :-- | :-- | :-- | :-- | :-- |
| K1 | `QuoteDocument` stays In Progress after the one Generate PDF tap (14.11) and the 14.12 bound; PDF never completes. In Progress after Submit Order and before the tap is normal: the tap produces the PDF. Known cause: the rep lacks Create on `QuoteDocumentCreationEvent`, so the event publish fails (fixed by 8.24a; an admin re-publishing the event completes the document, so flow, template and service work). Only when 8.24a is in place and both FP-14.4 checks pass is it a limitation: report to Salesforce Support, quoting the K1 row. Config workarounds are rejected by the platform (record-triggered flow or Apex trigger on `QuoteDocument`, flow creating the event); no Apex workaround is built | 14.11–14.12 (8.24a, 8.29) | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`, after 8.24a and the two FP-14.4 checks pass | G2: do not regenerate or delete; admin re-publish only with the user's explicit consent |
| K2 | Last Order prefill drops manual discounts (line discounts and quote-level adjustments), or is partial. The Last Order card itself is still a hard expectation at 15.2 | 15.3–15.4 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` for the prefill only | G11; card absent is FP-15.1, not K2 |
| K3 | RSVP email service absent (0 rows, no RSVP Apex class); the Setup toggle may read Off | 3.7 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; never created through the API | Nothing later depends on it |
| K4 | G8: the Verified checkbox is not persisted after Save & Close | 12.8–12.11 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; other indicator values must persist | G8; FP-12.2 |
| K5 | Raw component heading on the packaged Store Check component (for example a raw component name or an `@@@…@@@` token) | 12.7, 13.x | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | G5 (Store Check heading only) |
| K6 | App build and package version skew | 11.6 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; record both versions | FP-11.3 |
| K7 | The cache ZIP holds two fewer `DbSchema` entries than the number of `DbSchema_*` records deployed (10.1, plus the four photo schemas of 10.1a): the two `LifeSciConfigRecord` schemas are missing. Expected = deployed count minus those two | 10.7 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; do not regenerate | FP-10.7; live test at 11.5 |
| K8 | No camera on the iPad simulator (a physical iPad takes the photo with its camera; this entry does not apply there) | Photo indicators in Act 12 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` for the photo part only | the preamble, "iPad simulator and physical iPad" |
| K9 | Document Management entities (`LifeScienceDocument`) never materialize (they need the Life Sciences Cloud for Customer Engagement org permission); Quote document generation (`QuoteDocument`, 8.24–8.27, Act 14) is separate and not affected | 0.4, 1.2 (FP-1.3) | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | No supported grant route |
| K10 | Shipped mobile `TransactionProcessingType` not yet present at 6.5 (provisioned later; bound at 8.14 through the `QuoteSettings_OrgLevel` record, API first, Admin Console fallback) | 6.5, 8.14 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` at 6.5 only; the 8.14 binding is a hard check | Timing, not a gap |
| K11 | Setup Audit Trail shows no separate row for the Standard Price Book activation | 6.5 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; verify by the `Pricebook2` check | |
| K12 | 0 `ProductTerritoryAvailability` rows on the device | 11.5 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | Expected count excepted in the row-count check |
| K13 | The Create Quote From Visit action (8.34) does not appear in the iPad visit ••• menu in this release (only Delete shows); the layout editor offers no Quoted Order element or Go to Quoted Order button | 13.2, 8.34, 9.9 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; 13.2 is a non-blocking check that records the result. Report to Salesforce Support if the action is required in the visit menu | Start the quote from the Visit's Quoted Order tab → New (Visit pre-filled) |
| K14 | The Quote stage path offers extra stages or **Mark Status as Complete** after 8.16a | 8.16a, 14.9 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; locked stages still refuse edits | Cause of the button not established |
| K15 | Indicator definitions stay editable by the rep (the packaged `IndustriesVisit` set grants ModifyAll) | 9.21 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | Optional hardening: a permission set group with a muting set (see UNVERIFIED items); never edit the packaged set |
| K16 | Profile extras and platform-default app grants on the Field Rep profile; View All from standard permission sets (allowed: any View All whose source is a standard permission set) | 4.1, 4.6 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; Modify All is allowed only where the source is the standard `IndustriesVisit` set on `AssessmentIndicatorDefinition`, `GnrcVstKeyPerformanceInd`, `GenericVisitTask` and `GenericVisitTaskContext` (K15), listed at Checkpoint 4 as `KNOWN_LIMITATION`; View All on `SalesTransactionType` from `<FIELD_REP_PS>` (after 4.9b) is also allowed; any other Modify All, or View All from a custom set or the profile, fails | FP-4.1 |
| K17 | `UserDevice` sits in Pending Approval with `IsVerified = false` after first login | 11.4 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | FP-11.2 |
| K18 | On-device stage path order differs from `QUOTE_STAGES` (8.16 sets the picklist to that order, so this means the picklist order was changed afterwards) | 13.3 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | |
| K19 | (Resolved, not recorded as a limitation) The Visit field blank on the device after sync is fixed by `VisitId` (Edit) on the Quote layout (8.2) and the 8.13 FLS. If Visit is blank at 13.9, re-check 8.2 and 8.13, regenerate the cache (10.8) and sync again; tag `KNOWN_LIMITATION` only if it is still blank after that | 13.9 | `PASSED` after the fix; otherwise `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | 8.2, 10.8 |
| K20 | Billing and shipping address display blank | 13.4, 14.3 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | G7 |
| K21 | Card absence only (a partial or empty prefill is K2): no Last Order card on Add Products at 13.7 (first quote for the store, or an earlier submitted quote; the record that drives the card is not established). The card is a hard expectation at 15.2 once 15.0 has built a Submitted quote | 13.7 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` at 13.7 only | G11; FP-15.1 |
| K22 | Untouched boolean indicator toggles write no `AssessmentIndValue` row: expected rows = products × picklist indicators, minus one per untouched boolean toggle (U) and per stale picklist duplicate; assessment tasks stay `NotStarted` | 12.12 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` within the one-row-per-toggle allowance | Larger shortfalls are investigated |
| K23 | The **Generate PDF** stage action shows "Unknown component" on web: the component behind it is internal to the legacy template picker, and the action is shared by web and iPad, so it works on iPad only. Report to Salesforce Support | 8.18, 14.11 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; do not use the action on web | Not a configuration defect; nothing to remove |
| K24 | Approval **Approve** branch, only if 8.21a was not applied: the "Send Approved Notifications" background step fails (UNKNOWN_EXCEPTION, updating the Quote as the Automated Process user); the quote stays In Review. Fixed by 8.21a (background notification steps run as `<NOTIFY_ADMIN_USER>`); Approve completes with 8.21a applied. Report the Automated Process behaviour to Salesforce Support | 8.21a, 14.13–14.15 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` only when 8.21a is missing | Do not move a stuck quote back to Draft or Submitted without the user's explicit consent |
| K25 | iPad price waterfall for lines priced on the server (edited on web, then synced) shows blank Amounts on percentage rows and no header-discount or override rows; lines priced locally on the iPad show them | 13.10–13.14 (Q13) | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | Workaround: reprice the lines on the iPad, or review totals on web. Report to Salesforce Support. The only accepted waterfall gap: any other missing waterfall value is reported normally |
| K26 | Web **Log a Visit** (Visits → New → In-Person / Remote) shows "Translation Language Settings for the required languages or the initial metadata cache are missing" before Act 10, because the rep has no cache yet. After Act 10 it loads only when the rep's cache has `ProviderVisit` (10.1b); without it the modal reads "We couldn't perform this action because the metadata is out of date…". The component reads `sobjects/ProviderVisit` and `translations/<lang>.json` from the rep cache. After Act 10, the "Translation Language Settings…missing" text means the cache has no translation file: Translation Workbench is off or no translation language is active (fresh orgs), fixed by 10.1d | 9.23, 10.1b, 10.1d, 10.7a | 9.23 (before Act 10): `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`. 10.7a: the form must load; fix through 10.1b or 10.1d. 10.1b skipped by the customer: `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | The iPad path (Act 12) is unaffected |
| K27 | The iPad offers **Delete** on an In Progress Store Check visit | 12.5 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; do not tap it | Report to Salesforce Support |
| K28 | 7 Turn On residual items have no supported read-back API in this release: (1) direct Transaction Processor preference, (2) direct Draft Order Capture preference, (3) Core CPQ App Usage Type inventory, (4) document-content provisioning queue state, (5) Context Definition packaging queue state, (6) pricing packaging/entitlement refresh internals, (7) Draft Order upgrade-executor internals | 6.5 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION`; the 11 settings must still pass their checks | Gap journal (Act 6) |
| K29 | The stores are owned by `<FIELD_REP_USER>`, so territory-based sharing to a non-owner (`ObjectTerritory2Association` / `ProviderAcctTerritoryInfo`) is not tested at 5.7 | 5.7 | `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` | Watch Acts 9 and 12 |

**Not configured by this runbook (optional).** (1) `Quote` and `QuoteLineItem` `DbSchema` filters that would limit offline quotes to offline-available accounts are not set. (2) `MaxQuoteLineItemsPerQuote` is left blank (no line limit). (3) The offline-support app setting is off. (4) No org-wide email address is set for notifications (optional at 8.21). (5) Keep the installed package on the latest patch release available for its version. None of these affects the acceptance checks.

## Failure playbook

IDs are `FP-<Act>.<n>`. Build steps reference these rows in their Playbook column. Signatures are given exactly as the platform returns them.

| ID | Error signature (exact text) | Root cause | Fix | Step |
| :-- | :-- | :-- | :-- | :-- |
| FP-1.1 | `INVALID_CROSS_REFERENCE_KEY: Account.Business_Account is active but unavailable to the authenticated System Administrator profile.` | A record type active at the org level is not visible to any profile automatically | Deploy and assign a permission set granting only `recordTypeVisibilities` for `Account.Business_Account` | 1.6 |
| FP-1.2 | Multi-Currency checkbox reverts to unchecked on reload, no error | The Security Contact field was empty at activation (only on releases that have the field) | Check Company Information for the field (1.9). If present, save it in the UI first, confirm it persisted, then activate in a separate save. If absent, activate directly | 1.9, 1.11 |
| FP-1.3 | n/a (silent gap) — Document Management entities never appear after `enableLSC4CEDocumentManagement=true` | `LifeScienceDocument`/`LifeScienceDocumentTemplate`/`LifeSciDocTemplateVersion` also need the Life Sciences Cloud for Customer Engagement org permission, which has no customer-facing grant route | None: a permanent platform gap. Tag `KNOWN_LIMITATION` (K9); the step ends `PASSED_WITH_NOTES` | 1.2 |
| FP-1.4 | Enable Sales Territory looks clicked but `Territory2Settings.enableTerritoryManagement2` stays `false` | Coordinate- or label-based clicks on this legacy Aura button silently no-op | Click the button by its accessible role and exact name (Enable Sales Territory); verify by `Territory2Settings` read-back | 1.13 |
| FP-1.5 | `no RecordType named Account.PersonAccount found` (deploying `<PFX>Business_Account_RT_Access` in 1.8a; a re-describe after 60 s still shows `available=false`) | The Metadata API names the Person Account record type under the `PersonAccount` object, so `Account.PersonAccount` does not resolve | Use `<recordType>PersonAccount.PersonAccount</recordType>` in the second `recordTypeVisibilities` entry and re-deploy; the 5.5 drift check and Act 5 expect that name | 1.8a |
| FP-2.1 | `Accounts Missing Organization Feature: Account.RecordType` / `Missing Organization Feature: B2C` / `Missing Organization Feature: StateCountryPicklist` | Business Account record type, Person Accounts ("B2C") or State/Country picklists missing | Complete 1.5 → 1.8 and 1.4; re-run 2.3 once | 2.4 |
| FP-2.2 | `FieldSet(InventoryCountAssessment.AdHocInvHeaderFieldSet): no CustomObject named InventoryCountAssessment found` (+ `AuditedInvHeaderFieldSet`) | Org preference `InventoryCountEnabled` off | Step 1.14; confirm `InventoryCountAssessment` describes; re-run 2.3 once | 2.4 |
| FP-2.3 | `FieldSet(InventoryOperation.AdjustmentHeaderFields): no CustomObject named InventoryOperation found` (+ `DisbursementHeaderFieldSet`, `ReturnHeaderFieldSet`) | Org preference `PrdInventoryOperationsPref` off | Step 1.16; confirm `InventoryOperation` describes; re-run 2.3 once | 2.4 |
| FP-2.4 | `FieldSet(ProductDisbursement.VisitSignatureFields): In field: ProductionBatchNumber - no CustomField named ProductDisbursement.ProductionBatchNumber found` + `Goal Assignments(GoalAssignment): The object type you specified GoalAssignment is invalid.` | Org preferences `InventoryBatchManagement` and `CarePlansPreference` off | Steps 1.15 and 1.17 (Care Plans branch only); confirm both objects describe; re-run 2.3 once | 2.4 |
| FP-2.5 | Install error: a package test class is invalid and needs recompilation (`Variable does not exist: Survey`) | `SurveySettings.enableSurvey` off | Step 1.18; confirm `Survey` describes; re-run 2.3 once | 2.4 |
| FP-2.6 | `Package Not Found` | A version alias resolved to an older release | Install with the exact `<PKG_VERSION_ID>` (04t…) | 2.3 |
| FP-2.7 | Install error naming `Layout(AccountPlan-…)` and `QuickAction(AccountPlan.ImportStakeholder)` / `QuickAction(AccountPlanParticipant.AssociateStakeholder)` with an invalid object name | Account Plans off (`AccountPlanSettings.enableAccountPlan=false`); the `AccountPlan` / `AccountPlanParticipant` describes return `NOT_FOUND` | Step 1.18a (deploy `AccountPlan.settings` `enableAccountPlan=true`); confirm both describes; re-run 2.3 once | 1.18a, 2.3, 2.4 |
| FP-3.1 | Store Check "Turn On" clicked but `Industries.settings` still reads `enableStoreCheck=false` | The first click only opens a confirmation modal; the modal's own "Turn On" persists the change | Click the modal's "Turn On", then verify by Metadata retrieve | 3.1 |
| FP-3.2 | RSVP/`LifeScienceRSVP` Setup toggle displays "Off" | Setup UI read-back defect: the toggle does not reflect the service state | Verify by `EmailServicesFunction`/`EmailServicesAddress` SOQL, never the toggle | 3.7 |
| FP-4.1 | `Read on AppUsageAssignment requires Read on at least one of these objects: Order, Quote, Asset, Contract` / `Permission Read Quote depends on permission(s): Read Opportunity` / `ViewAllRecords on AppUsageAssignment requires ViewAllRecords on at least one of these objects: Order, Quote, Asset, Contract` | The Metadata API enforces object-permission dependencies within one permission-set payload; granting AUA/Quote access this way cascades into a View All grant that breaks least privilege | Do not grant AppUsageAssignment/Opportunity/Quote on the custom permission set; keep it to the custom route-access objects (the Sales Transaction Type grant is added at 4.9b, after 7.16); take AUA/Opportunity/Quote access from the standard bundle (4.5) | 4.1 |
| FP-4.2 | `UNKNOWN_EXCEPTION: Unexpected Error when retrieving 'Account' Layout Information: Layout contains no sections!` | The custom profile has no `layoutAssignments` for Account | Add `layoutAssignments` for the default Account record type and `Account.Business_Account`, pointing at the standard Account layout | 4.2 |
| FP-4.3 | (no error; platform-automatic cascade) | Removing the sole permission set that depends on a PSL auto-unassigns that PSL about 1 second later | Expect and verify "N-1 PSLs", specifically the one tied to the removed set | 4.5 (caution, not triggered in this Act) |
| FP-4.4 | `DUPLICATE_VALUE` (PSL subrequest) + `PROCESSING_HALTED` (permission-set subrequest), whole Composite rolled back | A PSL assignment and the permission set that depends on it in one Composite request race with the platform's own management of that link | Assign the PSLs in their own Composite call first, confirm Active, then the permission sets in a second call (two Composite calls at 1.0; at 4.4/4.5: 10 PSLs, then 11 permission sets; the 12th, `RevLifecycleManagementQuotePricesTaxes`, at 4.9a) | 1.0, 2.1, 4.4/4.5 |
| FP-4.5 | PSL or permission-set assignment count differs from the expected 10 PSL / 11 PSA at 4.5, or the Quote permission set is not found before Turn On | The Quote permission set (`RevLifecycleManagementQuotePricesTaxes`) exists only after the 6.4 Turn On | Assign the 11 sets available at 4.5; assign the 12th at 4.9a; not a failure | 4.5, 4.9a |
| FP-4.6 | 4.6 shows View All or Modify All on an object outside K15, K16 and the Sales Transaction Type grant | A custom permission set or the profile grants it (K16 allows only a standard permission set as the source) | ⏸ STOP in the P5 format; change no permission set until the customer decides | 4.6, 4.9c |
| FP-4.7 | The Field Rep CLI session needs OAuth consent before it runs | The connected-app approval needs `CanApproveUninstalledApps` on the user *(unverified — fallback: skip 4.7 and rely on the 4.6 admin-side check)* | Only when `RUN_REP_CLI_CHECK = yes` (the rep's CLI login is optional; with `no`, 4.7 is skipped and the 4.6 admin-side check stands): assign the temporary permission set `<PFX>Temp_CLI_OAuth_Approval`, complete the consent (a person clicks), then delete the set and assignment | 4.7 |
| FP-4.8 | Select Price Book or Add Products shows nothing, or a Quote saves in the wrong currency | Known defect: the Quote takes the rep's `DefaultCurrencyIsoCode`, not the store Account's currency | Make the rep's currency equal the store's and the price book's (4.8, 5.8); do not change existing Quotes, create a new one | 4.8, 5.8 |
| FP-5.1 | — (bounded poll, no error expected) | `Territory2Model.State` moves `Planning`→`Activating`→`Active` asynchronously | Poll at a fixed interval to a maximum; if not `Active` within budget, stop for reconciliation rather than re-issue the PATCH | 5.3 |
| FP-5.2 | `400 INVALID_CROSS_REFERENCE_KEY — "Business Account record type is not valid for the executing user."` | A record type active at the org level is not visible to a given profile, including the admin's | Deploy and assign a `recordTypeVisibilities`-only permission set to the admin and the Field Rep before any Business Account create | 5.5 (pre-empts the failure before 5.6) |
| FP-5.4 | 5.1 finds another `Territory2Model` already `Active` | Only one model can be active per org; most customer orgs that use Territory Management already have one | Offer the 5.1 choice (use their active model, or stop); never deactivate it | 5.1, 5.3 |
| FP-5.3 | (no error expected) | — | Verify store Account/Place/territory-link visibility for the Field Rep directly (5.7); territory assignment alone does not grant it | 5.6/5.7 |
| FP-6.1 | (no error; silent no-op click) | Accessibility-tree node IDs are not stable across page loads; a replayed click can land on a stale node | Re-read the accessibility tree immediately before each click in the 3-click Turn On path and verify the dialog text changed. Get Started changes the plan to In Progress; re-read the page after it before clicking Turn On | 6.1-6.4 |
| FP-6.2 | `404 NOT_FOUND` on `/connect/revenue-cloud/setup/execute-custom-logic` | The endpoint only answers calls from the Salesforce UI; other callers get a generic 404 | Use the Context Service Business REST API (`/connect/context-definitions`) | 6.6 |
| FP-6.3 | `DUPLICATE_VALUE` on a single-row default-mapping PATCH with an Expression Set attached to the context definition | Core blocks mapping edits on a context definition with an attached Expression Set | Recovery only (avoid by doing 6.7 before any Expression Set attaches): detach the `ExpressionSetDefinitionContextDefinition` junction, deactivate the context definition version, PATCH the default mapping, reactivate, recreate the junction | 6.7 (recovery path) |
| FP-6.4 | The Order Management card shows a lock, "Purchase required" or "Contact Sales" instead of Set Up / Get Started | The Order Management licences are not provisioned on the org (the gap the 0.9b licence gate checks) | Do not retry the click or look for another way in. ⏸ STOP: re-run the 0.9b query, list the missing licences with their Setup labels and route the customer to their Salesforce account team. Re-run 0.9b; once it passes, continue from 6.1 | 6.1 |
| FP-6.9 | 7.15 would activate this thread's recipe while another `LifeSciencesCommercial` recipe is active | The customer has their own recipe of this subtype | Show it in the P5 format; activate this recipe only on the customer's yes; never edit or deactivate theirs | 6.9, 7.15 |
| FP-7.1 | `400 INVALID_INPUT` — `"Ensure that the lookup table in the ListPrice step is valid and try again."` | The validator resolves the List Price lookup table through any recipe matching the procedure's usage subtype with a ListPrice mapping; none exists yet | Create the recipe + ListPrice mapping (6.9) before authoring the procedure (7.13). The same error for "the lookup table in the VolumeDiscount step" means the `VolumeDiscount`/`VolumeTierDiscount` mapping is missing: add it (6.9/7.12a), then retry | 7.13 |
| FP-7.2 | `400 INVALID_INPUT` — `"Enter a valid rank to enable <PFX> LSC Pricing Procedure V1."` | The activation resource only toggles `IsActive`; the save validator rejects a null or `<= 0` `Rank`, even for the only version | `PATCH sobjects/ExpressionSetVersion/{id} {"Rank":1}` before `?action=activate` | 7.15 |
| FP-7.3 | `"No 'mode' found in 'body' entry"` (local CLI rejection) | The CLI request-file body needs an explicit shape even for an empty PATCH body | Use a request file with `{"body":{"mode":"raw","raw":""}}`, not `--body ""` | 7.15 |
| FP-7.4 | `JSON_PARSER_ERROR` on the simulation call | The body was wrapped under a `simulationInput` key | Send `input`/`config`/`contextInput` as top-level keys; pass `shouldSaveSimulationInput` as a query parameter | 7.14 |
| FP-7.5 | API: silent `PricebookEntry` rejection, or "Before creating this custom price, create a standard price…"; UI: "We hit a snag" | A custom `PricebookEntry` needs an active Standard entry for the same product, currency and selling model first | Activate the Standard PBE for every product in every active currency (7.6) before any custom entry | 7.6 |
| FP-7.6 | `"couldn't find the resource <X>"` during simulation or step binding | A field has three names (ContextTag, attribute Title, mapping field name) and the wrong one was used | Use the `ContextTag` name in step bindings and simulation input | 7.13, 7.14 |
| FP-7.7 | (no error; tiers silently use the cumulative/contract path) | A tiered-discount step is bound to an aggregated quantity field | Bind Range/Slab steps to the non-cumulative line quantity; the mobile offline engine does not support cumulative variants | 7.13 |
| FP-7.8 | Simulation results reflect stale tier or price-book-entry data | Decision tables are a cached snapshot and do not refresh on tier/PBE changes | `POST /services/data/v<API_VER>/actions/standard/refreshDecisionTable`, bounded poll on `RefreshStatus`, before any simulation or go-live | 7.12, 7.20 |
| FP-7.9 | JSON parse error on a PATCH built from a prior GET response | The GET can return HTML-entity-encoded quotes (`&quot;`) inside a JSON string | Turn entity-encoded quotes back into `"` before resubmitting | 7.13 |
| FP-7.10 | Mobile client: `"Unhandled pricing procedure steps: RoundingValuesCurrencyOutputRounding"` | The mobile offline engine does not support the `CurrencyOutputRounding`/`RoundingValues` step; a version containing it activates on the server and fails on the device at the first quantity change | Never include that step in a version intended for mobile; the 7.13 version omits it | 7.13 |
| FP-7.11 | `DUPLICATE_VALUE` on a direct `PermissionSetLicenseAssign` POST | The platform auto-manages the PSL assignment when a licensed permission set is assigned | Assign the `RevLifecycleManagementCalculatePricesApi` permission set only; never POST the PSL assignment | 7.16 |
| FP-7.12 | Mobile pricing files (`expressionSet.json`/`contextDefinition.json`/`decisionTable.json`) stay empty after generation with the org-default selector set | The org-default selector is necessary but not sufficient: the profile-scoped `OrderProductViewsSettings` (8.10) and the `QuoteSettings_OrgLevel` TPT binding (8.14) are also required | Set 7.17's selector here; confirm 8.10 and 8.14 are done before relying on Act 10 (FP-10.3) | 7.17 |
| FP-7.13 | "The adjustment type for this line item must be set to Override." when the procedure executes | Known Revenue Cloud pricing defect (fix status unconfirmed), tied to the `PriceAdjustmentTier.AdjustmentType` picklist constraint | Watch item: if it appears at 7.14 or on a web reprice, stop and report it as a known platform limitation in the P5 format; do not change the tier model | 7.14 |
| FP-7.14 | The iPad charges list price at tiered quantities while the web simulation gives the tiered price | `EffectiveFrom`/`EffectiveTo` are empty on `PriceAdjustmentSchedule`/`PriceAdjustmentTier`; the iPad engine skips them | Set the dates, schedules then tiers (`<TIER_EFFECTIVE_FROM>` / `<TIER_EFFECTIVE_TO>`), refresh the decision tables, regenerate (10.8), sync | 7.10a, 10.8, 13.0a |
| FP-7.15 | The iPad cart footer shows Subtotal, Discount and Grand Total but no Order Discount (Add); no error | Header Adjustments is off (`RevenueManagementSettings.enableRevenueAdjustment` = `false`); the 6.4 Turn On leaves it off | Run 7.17b, regenerate (10.8), sync | 7.17b, 13.12a |
| FP-7.16 | 7.18 Save As New Flow fails: `discoverProductsContext (Variable) - "apexClass" is invalid. Provide the API name of an Apex class that includes an Apex data type supported in flows.`, with follow-on `Check If Group ID Provided` and `SelectedQuoteLineGroupIdFormula` errors that `discoverProductsContext.groupId` does not exist | Flow Builder does not offer `ProductConfig` types: Product Configurator is off, and this org offers those types only when it is on. Product Discovery being on does not help, and an Apex `Type.forName('ProductConfig','DiscoverProductsContext')` read resolves either way | Close Flow Builder without saving, run 7.17c (Metadata API deploy of `Settings:ProductConfigurator` with `enableProductConfigurator` = `true`), reload, redo the Save As. If it still fails, or the 7.17c deploy is rejected, stop `BLOCKED` and raise a provisioning request. Never delete or retype the variable to force the save | 7.17c, 7.18 |
| FP-8.1 | New Quote shows no Quote-specific fields/sections | A blank org ships no Quote record types | Deploy the `RecordType` + `Profile.recordTypeVisibilities` bundle | 8.1 |
| FP-8.2 | "Cannot use field:Pricebook2Id in a layout" | `Pricebook2Id` is not layoutable on Quote | Omit it from the layout; set it via Browse Catalogs/Add Products after Save | 8.2 |
| FP-8.3 | "UNKNOWN_EXCEPTION: Unexpected Error when retrieving 'Account' Layout Information: Layout contains no sections!" | The profile has no Account `layoutAssignments` | Add `layoutAssignments` (default + Business Account RT) | 8.4 |
| FP-8.4 | A tab is on `CustomApplication` but absent from nav / `GET /tabs` has no entry | Tab visibility is a separate permission layer from app tab membership | Add `tabSettings` to the runtime `PermissionSet` (`tabVisibilities` is a Profile element), per surface | 8.6 |
| FP-8.5 | Highlights Panel + Stage Path missing on the record page | `recordHomeSimpleViewTemplate` has no compiled nib on mobile; the silent fallback drops the header | Switch the template to `recordHomeSingleColTemplateDesktop` (no web regression) | 8.7 |
| FP-8.6 | Browse Catalogs (or any layout/quick action) is API-available but has no UI control | The active FlexiPage header has no `force:highlightsPanel` | Add `force:highlightsPanel` as the first header component | 8.8 |
| FP-8.7 | Mobile pricing ZIP / Product Views stay empty after a clean procedure deploy | Both an org-default pricing procedure and a profile-scoped `OrderProductViewsSettings` with `PricingProcedure` are needed; either alone no-ops | Deploy both; verify by Tooling query on `LifeSciConfigRecord` | 8.10 |
| FP-8.8 | Quote routes to the wrong Sales Transaction Type | With two Sales Transaction Types on one procedure the one used is not predictable | Keep exactly one STT per pricing procedure | 8.11 |
| FP-8.9 | "DUPLICATE_VALUE" on PermissionSetLicenseAssignment | Assigning the CPQ-licensed permission set auto-creates the PSL assignment | Assign only the permission set; never POST the PSL assignment | 8.12 |
| FP-8.10 | The Submit action is absent from the Quote page (no error) | `Quote.Status` FLS is Readonly on the runtime permission set; Submit's `RecordUpdate` needs Edit even though the layout stays Readonly | Grant FLS Edit on `Quote.Status`, then regenerate (10.8, which includes the sync and the app relaunch) | 8.13 |
| FP-8.11 | (disclosed side effect) The Quote-Create permission set also grants org-wide `AppUsageAssignment` Read with no row-level isolation | The only target-native set providing Quote Create + Core CPQ User + AUA Create has no row-level isolation | Accept for this build; flag as not production-recommended | 8.15 |
| FP-8.12 | Web SLDS Path shows only 2 of 5 configured lifecycle stages | `Quote.Status` `StandardValueSet` ships without `Submitted` and `Request for Unlock` in a blank org (`In Review` and `Rejected` ship) | Add the 2 missing values with a `StandardValueSet` deploy, value set first (8.16, before the record type at 8.1), then order the five stages first | 8.16 |
| FP-8.13 | Submit never produces a server-side transition despite correct FLS and a fresh reprice | `StagePathPermissionsHandler` is inactive by default; the Admin Console switch does not respond to automation | Activate as in 8.17 (Tooling PATCH `IsActive=true` on `LifeScienceTriggerHandler`; the Admin Console switch is the human fallback); confirm with the Tooling query | 8.17 |
| FP-8.14 | `LifeSciConfigRecord` present in the payload but absent after deploy, or the package.xml member rejected | Source-format packaging can drop `LifeSciConfigRecord`; the member name must be the record's `DeveloperName` (equal to `masterLabel` only when the label has no spaces), not the retrieval filename | Use a Metadata-API-format ZIP (package.xml at archive root); look up `DeveloperName` first | 8.10 |
| FP-8.15 | (gated test) Unlock route; `In Review` is a custom stage | The route covers Approve and Reject; In Review is an addition to the documented Request for Unlock + approval-flow pattern | Run the single test at 14.13–14.15 and report the literal status. If the approver's notification opens a page with no Work Guide (the 8.9b page is not assigned to the approver's profile), decide on the Approval Work Item page: To Do List item → Review → Approve or Reject → Confirm (8.21) | 8.20, 8.21 |
| FP-8.16 | `DigitalSignature.SignatureType` has no valid value to select | `SignatureType` is driven by a `StandardValueSet`, not a custom picklist | Deploy a `StandardValueSet` with one value (for example "Default", `default=true`) | 8.22 |
| FP-8.17 | "The prices aren't up to date or the validation isn't complete." | `Quote.CalculationStatus` is `NotStarted`/stale; Submit needs a successful reprice first, independent of FLS | Run Reprice All (8.32) before expecting Submit to render | 8.13 |
| FP-8.18 | "Free-Form canvas mode doesn't support End elements. Remove any End elements or switch to Auto-Layout canvas mode." | A cloned Flow inherits Free-Form canvas metadata | Declare `BuilderType=LightningFlowBuilder`, `CanvasMode=AUTO_LAYOUT_CANVAS`, `OriginBuilderType=LightningFlowBuilder` | 8.24 |
| FP-8.19 | "INSUFFICIENT_ACCESS" / "Unsupported action type: CREATE_SERVICE_DOCUMENT" | `<ADMIN_USER>` (not just the end user) lacks Document Builder entitlement | Assign `DocumentBuilderUserPsl` + `DocumentBuilderUser` to `<ADMIN_USER>`, then redeploy | 8.25 |
| FP-8.20 | The Flow activates but DocGen fails downstream, no deploy error | The signature permission-set assignment must precede Flow activation | Assign the signature `PermissionSet` (8.26) before activating the Flow (8.27) | 8.26 |
| FP-8.21 | The Flow stays Draft after a Metadata API deploy | Org setting `enableFlowDeployAsActiveEnabled=false` | Activate by Tooling `PATCH /tooling/sobjects/FlowDefinition/<Id>` `{"Metadata":{"activeVersionNumber":<VersionNumber>}}` (newest `VersionNumber`, never a fixed 1) | 7.18, 8.27 |
| FP-8.22 | "'QuoteDocumentSettings' is not a valid value for the enum 'LifeSciConfigCategoryType'" | The org's Metadata API enum does not expose this category (feature-registration gap) | Configure in the Admin Console UI (Playwright); verify by re-opening the page, not SOQL/Tooling. The same first-save rule applies to the `OrderProductViewsSettings`, `QuoteSettings` and `QuickAction` categories ("no LifeSciConfigCategory named … found"): a record-only deploy fails until the category exists. 8.10, 8.14 and 8.34 deploy the category with the record first (as 9.5 does; unverified on a new org — fallback: the Admin Console save) and record the result as a `verification` row. `QuoteDocumentSettings` is not in the Tooling `Category` picklist: Admin Console only | 8.29 |
| FP-8.23 | Two valid add-line paths exist: Add Products and Browse Catalogs | Generic Lightning path vs. LSC eligibility-filtered path | Use the one the design calls for | 8.31 |
| FP-8.24 | "We couldn't refresh the prices and validate the configuration... You cannot ask for this if the context hasn't been established." | Server-side `ComponentContext` not established before a setup-metadata lookup during Reprice All: an intermittent platform defect | Click Reprice All again; a failed attempt corrupts nothing | 8.32 |
| FP-8.25 | Toast "sObject type 'AdminConsoleMenuItem__mdt' is not supported..." for non-admin users | Custom-metadata-type access exists only on the System Administrator profile layer | Not remediated; cosmetic and non-blocking; do not broaden access | n/a (Gap journal) |
| FP-8.26 | "CannotQuickDeployError" / "INVALID_ID_FIELD: Source validate did not run tests in the org" | An org with no custom Apex classes can never meet quick-deploy's `numTestsRun > 0` rule | Skip check-only/quick-deploy; use a standard `sf project deploy start` | 8.7 |
| FP-8.27 | `Workflow_XIsLockedAndCannotBeCreated` on mobile New Quote Save | iOS client defect: it never seeds `Status` on the unsaved Quote | See FP-13.1 and G4 | n/a (cross-ref) |
| FP-8.28 | Mobile Submit: the Review screen stays open and re-submits; the server replies "You can't update Quote ... at this stage of the workflow" and the client shows "Review submission failed. Please try again." | Submit is not idempotent on the client; server state is not corrupted | See FP-14.3 and G1 | n/a (cross-ref) |
| FP-8.29 | Generated `QuoteDocument`/PDF stuck `Status=In Progress`, `ContentVersionDocumentId=null` | A Flow step that sets the document defaults does not stamp `DocumentRecipient.SignatureIdentifier` | Check 8.24a first (rep Create on `QuoteDocumentCreationEvent`); then FP-14.4 and K1 | 8.24/8.24a/8.27 (cross-ref Act 14) |
| FP-8.30 | Raw i18n tokens (for example `@@@SFDC…@@@`) render instead of section-header labels | Quote page: token labels in the thread's `LifeScience_Quote_Record` page. Store Check heading: the packaged component | Quote page: redeploy with plain-text labels (8.9), regenerate (10.8), sync; catch it at 10.7 (0 `@@@` labels in `ui.json`). Store Check heading: `KNOWN_LIMITATION` (K5); do not hardcode English into the packaged component | n/a (cross-ref Act 10/13) |
| FP-8.31 | A redeployed `StandardValueSet`/`RecordType` reverts to old values despite editing the source | A full-name collision between the manifest and files already in the local package tree repackages the stale copy | Deploy with explicit candidate file paths, not component full names alone, when duplicates exist locally | 8.16 |
| FP-8.32 | Request for Unlock sets the status but no approval request reaches the manager | The rep has no manager in the user hierarchy (the `approver` formula is empty), or the approval flow is inactive | Set `<FIELD_REP_USER>.ManagerId` (4.8); activate the flow; have the rep request unlock again only after reconciling `Status` | 4.8, 8.21 |
| FP-8.33 | The Admin Console Product Views offers no Last Order option, or `ProductsFromPreviousOrder` is rejected on deploy | The org lacks a Salesforce-provisioned org permission (`LSDraftOrderPilot`; also check `LSStoreCheckPilot` and Core CPQ) | ⏸ STOP: the customer asks their Salesforce account team to enable it. Meanwhile deploy 8.10 with `StoreAssortment` only, record it in the Gap journal, and mark G11 not testable | 8.10 |
| FP-8.34 | Add Products opens with Price Book = None; typing the price book name lists nothing; diagnostics 1–3 of Step details 8.31 pass and 4 shows no price book request | The rep profile has no `Pricebook2` layout assignment (8.3 deployed only the Quote assignment) | Add `<layoutAssignments><layout>Pricebook2-Price Book Layout</layout></layoutAssignments>` to the rep profile (retrieve-and-merge, Deploy safety), redeploy, reopen Add Products: the price book is pre-selected | 8.3, 8.31 |
| FP-8.35 | The iPad Create New Quote shows Status as an editable picklist (Draft) instead of read-only text | The Quote record page's Details section has `Record.Status` `uiBehavior` = `none`; the iPad form follows the FlexiPage, not the Quote Layout's `Readonly` | Set it to `readonly` (8.9), redeploy, regenerate (10.8), sync | 8.9, 13.3 |
| FP-8.37 | 8.28 finds a disclaimer for the same module, type and country whose text differs, or a rerun would create a second one | `ComplianceStatementDef.Name` is an auto-number and `StatementText` cannot be filtered, so a lookup on either finds nothing | Look up by module, type, jurisdiction and country, compare the text client-side; show the existing row and ask before creating another | 8.28 |
| FP-8.36 | Admin Console → Workflow Paths: clicking a path opens it with another path's stages and operations (often the oldest path's), or editing, updating or deleting a stage, operation or action fails | The path's stage rows have an empty `SourceSystemIdentifier`. The editor loads a path and links its records by that key; rows created without it can't be found or matched | Don't save in the editor until fixed. Run the key backfill and read-back for the graph (Step details 8.18, *Stage record keys*), then reopen the path from the list and confirm it shows its own stages | 8.18, 8.21, 9.11 |
| FP-9.1 | `Cannot modify managed object: entity=TabSetMember, component=null, state=MANAGED_INSTALLED - tab` | The subscriber tried to edit the managed package's own `<tabs>` list | Use `CustomApplication.subscriberTabs` | 9.5, 9.10 |
| FP-9.2 | `INVALID_CROSS_REFERENCE_KEY` — "Business Account record type is not valid for the executing user" / RT active but unavailable to the profile | The record type is active at org level but not granted `recordTypeVisibilities` on the acting profile | Deploy a minimal permission set / profile RT visibility grant before the dependent create | 9.1, 9.8 |
| FP-9.3 | "We couldn't load the workflow path for this record. Ask your Salesforce admin for help." | All `LifeSciStage*` tables are empty for the Visit's record type | Build the 12-row + 3-share stage graph (9.11) | 9.11 |
| FP-9.4 | The Begin Visit spinner never resolves; no error, no DML (`NO_PERSISTENT_EFFECT`) | The packaged Begin Visit component renders nothing on web and never emits the completion event | Do not use web for Begin Visit; use the iPad (Acts 11–12) | 9.11 |
| FP-9.5 | `INVALID_FIELD: No such column 'DeveloperName'` on a `LifeSciConfigCategory` query (mobile bootstrap) | The rep lacks the `ViewDeveloperName` user permission | `<FIELD_REP_PS>` grants it in 4.1; if missing, redeploy 4.1 before the first mobile login | 4.1, 11.3 |
| FP-9.6 | An indicator renders with the wrong control type, or an update to `DataType` is rejected (field not updateable) | `AssessmentIndicatorDefinition.DataType` is create-only | ⏸ STOP (destructive). Delete the indicator's `AssessmentTaskIndDefinition` and `AssessmentIndDefinedValue` children and any `RetailStoreKpi` that references it, then the indicator, and recreate it with the correct `DataType`. Never do this after Store Check data exists for it | 9.14–9.16 |
| FP-9.7 | **Begin Store Check** fails on the iPad; reading the template returns "more than one row returned by a subquery" | The template has more than one `ActionPlanTemplateVersion` row (even a soft-deleted one); `Status` is computed over all of them | No API removes the extra row. Remove the broken template's assignment, create a new template with a new `UniqueName` (9.20 pattern, one auto-created version), assign it, and re-share it (9.21) | 9.20 |
| FP-9.8 | New or Edit on a Visit opens the standard Salesforce form instead of LogAVisit or Store Check | A legacy direct override on Visit New/Edit bypasses routing, or a record type lacks its New or Edit routing row (unmapped types fall back to the standard form) | Run 9.1. If an override exists, go to the 9.2 STOP. Otherwise query the routing rows and deploy the missing row from 9.6/9.7 | 9.1, 9.2, 9.6, 9.7 |
| FP-9.9 | The Quoted Order tab on the Store Check Visit is missing, empty, or has no New button | The layout has no `Quotes` related list (the iPad builds visit related lists from the layout), the mobile cache predates it, the FlexiPage related list uses the wrong relationship, or `Quote.VisitId` FLS is missing | Ordered checks: (1) layout retrieve shows `<relatedList>Quotes</relatedList>` (9.5); if not, deploy the 9.5 layout block alone; (2) the cache was regenerated after the layout change (10.8) and the device synced and relaunched; (3) the FlexiPage related list uses the relationship name from the 9.9 describe (`Visit`, parent field `Visit.Id`); (4) 8.13 FLS on `Quote.VisitId`; (5) if the Visit field is blank on the device's New Quote form, the Quote layout must carry `VisitId` as Edit (8.2) and the rep needs `VisitId` Edit (8.13): fix, then regenerate (10.8) and re-check. `Quote.VisitId` is not a valid layout related-list token. A missing Create Quote action in the visit menu is K13, not this failure. Never a stop: 13.2 continues with plain New | 9.5, 9.9, 13.2 |
| FP-9.10 | As the admin on web, Visits → New opens the Master Visit form with no record-type picker; Save fails "You don't have permission to create Visit records at this stage of the workflow" | The Visit record types are visible to the rep profile only (9.8), so the admin gets Master, which the Visit lifecycle (9.11) does not accept | Work as the rep (Login-As, as the web checks do), or run 9.8b. If In-Person / Remote then show "the metadata is out of date" as the admin, run 10.1c and regenerate once (10.8) | 9.8b, 10.1c |
| FP-10.1 | HTTP 400, parent "isn't ValidationCompleted" | Generate requires parent `Status = ValidationCompleted`; an `Active` (or otherwise advanced) parent rejects regeneration | Create a new parent record (10.3 to 10.7); never reuse | 10.3–10.4 |
| FP-10.2 | Parent not `Active` after 40 polls at 30 s (one 20 min bound); parent still in flight (`Published`/`Loading`/`Processing`) | Platform-side generation delay; the platform retries internally | Mark the stuck pair Inactive; generate one new parent record (10.3 to 10.7), one retry only (a second stall is `BLOCKED`); never re-POST generate against the stuck one | 10.5 |
| FP-10.3 | `contextDefinition.json`/`decisionTable.json`/`expressionSet.json` present but `{}` | Four selectors must agree on one procedure, and any one missing or different gives no error, just an empty file or the wrong procedure: (1) 7.17 Revenue Settings `QocalPricingProcedure`; (2) 8.10 profile-scoped `OrderProductViewsSettings.PricingProcedure` (wins for the rep); (3) 8.10b org-level `OrderProductViewsSettings_OrgLevel.PricingProcedure` (fallback); (4) 8.14 `QuoteSettings_OrgLevel`, which binds the Quote record type to `lsc4ce_pricing_mobile_tpt` | Fix whichever is missing, then generate a new parent record (10.3 to 10.7) | 10.7 |
| FP-10.4 | `MISSING_PROFILE_SCOPED_DBSCHEMA_QUOTELINEITEM` symptom: blank "Select Price Book" screen, no error | A `DbSchema_*` pair (for example `Pricebook2`/`PricebookEntry`, `Quote`/`QuoteLineItem`) was deployed with only one half profile-scoped | Deploy both halves of every pair together; verify by the 10.2 query | 10.1–10.2 |
| FP-10.5 | n/a; silent state mutation | `metadata/actions/download` creates a `ContentDocumentLink` as a side effect | Never call the download action as a verifier; GET `ContentVersion` `VersionData` instead | 10.6 |
| FP-10.6 | HTTP 404 from `/connect/life-sciences/commercial/configurations` | The endpoint is client-filtered to `UiTier`/`SfdcMobile` callers | Verify by the downloaded ZIP contents (10.7) | 10.7 |
| FP-10.7 | Deploy "Succeeded" but the component count, or the 10.2 count of `DbSchema_*` records, is below the 10.1 manifest, no error | Source-format `LifeSciConfigRecord` identity is the MasterLabel string, not the filename; a mismatched filename is silently dropped | Name each file `<name>.lifeSciConfigRecord` with `<name>` = the record's `DeveloperName` (for every 10.1/10.1a record this equals its `MasterLabel`; 8.10 records follow 8.10); diff component counts after every deploy. A `db.json`/`sobjects.json` schema count two below the number of `DbSchema_*` records deployed (the two `LifeSciConfigRecord` schemas) is a known outcome: `PASSED_WITH_NOTES` with `KNOWN_LIMITATION` (K7); do not regenerate. Any pricing or config fix after Act 10 does need regeneration (10.8) | 10.1 |
| FP-11.1 | n/a; no clear sync-completion signal | The two-tap manual sync is not proven reliable; a background "pin"-triggered sync has also delivered updates | Trigger manual sync as instructed; if data stays stale, wait rather than repeat the tap. The sync result signal is View Database (Last Synced / Total Sync Time); on a simulator use physical-style taps for the Begin Sync? alert (the preamble, "iPad simulator and physical iPad") | 11.3 |
| FP-11.2 | `UserDevice.Status = "Pending Approval"`, `IsVerified = false` | Normal first-run state for a new device | Not a blocker; proceed (K17) | 11.4 |
| FP-11.3 | App build vs. package version mismatch (informational) | The version strings are independent; no defect is known | Record in the run manifest. Known outcome: `KNOWN_LIMITATION` (K6), `PASSED_WITH_NOTES` | 11.6 |
| FP-11.4 | The first sync after the rep signs in fails with "Error while trying to access Salesforce" (`UNKNOWN_EXCEPTION`); a retry fails the same way | An action plan template the rep can read has more than one `ActionPlanTemplateVersion` row, usually one that came with the org and is shared to all internal users by an owner sharing rule. The template sync query errors on it. Deleting or purging the extra version does not help: the purged row stays in the table and still counts | ⏸ STOP — ask the customer before changing sharing; recommend hiding the template from the rep. A template this skill created (9.20): apply FP-9.7. A template that came with the org: (1) create a public group, for example `LSC_Action_Plan_Template_Sharers`, with the current owners of the templates that should stay shared; (2) move each multi-version template to an owner outside that group; (3) retrieve the `ActionPlanTemplate` sharing rules, replace the owner rule that shares from all internal users with one that shares from the new group to the same audience (the shared-from group of an existing rule cannot be changed, and this object has no criteria rules), deploy, and compare the rule count after. Keep the retrieve as the backup. The 9.21 manual shares keep the skill's own templates visible to the rep. Re-run 11.1a, then 11.2 | 11.1a, 11.2 |
| FP-12.1 | A sync error saying the visit start was attempted offline | A client reachability false-negative on the first Visit-start upload | Do not retry the tap; let background sync reconcile, then query `Visit.Status`/`ActualVisitStartTime` before treating it as a failure | 12.5–12.6 |
| FP-12.2 | The Verified checkbox cannot be toggled under automated simulator taps | It cannot be toggled under automated taps only; physical-style taps on a simulator and real touch work | Use physical-style taps on the simulator, or a human tap. It is still not persisted after Save & Close (G8): `KNOWN_LIMITATION` (K4) | 12.8–12.10 |
| FP-12.3 | Verified checkbox state absent from any query after Save | Observed limitation; no backing field is inferred, not confirmed | Report under G8; verify indicator values instead | 12.8–12.10 |
| FP-12.4 | New Visit form: the Place lookup does not offer "`<STORE_n>` - Billing Address", or Save fails on Place | The store's billing-address `ContactPointAddress` is missing or unreadable by the rep (5.6–5.7), or `DbSchema_ContactPointAddress` is not in the cache (10.1) | Re-run the 5.7 visibility check as `<FIELD_REP_USER>`. If the record is readable, check the Act 10 ZIP for the DbSchema. Do not create a second Place for the store | 12.3 |
| FP-13.1 | `Workflow_XIsLockedAndCannotBeCreated` on new-Quote save | The iOS client never seeds a local `Status` on a new Quote; Generic Workflow fails closed | Client defect, not fixable by config: record the step `BLOCKED (G4)`, use the G4 workaround (create on web, continue on the iPad); the Act ends `BLOCKED` | 13.3–13.4, 15.1 |
| FP-13.2 | Component-context error during a quantity-triggered reprice | Mobile pricing SDK error, intermittent; fixed in a later app build | Record `<IPAD_APP_BUILD>`; build-dependent, not a new defect | 13.10, 13.14 |
| FP-13.3 | Billing/Shipping Contact Point Address render as "-" | Known display gap on the Quote header/Review Order | Cosmetic, non-blocking; document (K20) | 13.4, 14.3 |
| FP-13.4 | Raw tokens render, for example `@@@SFDCQuote_InformationSFDC@@@` | Quote page: token labels in the thread's page (fixed at 8.9). Packaged Store Check heading: Translation Workbench does not inject the org default locale (open Core defect) | Quote page: re-check the labels (8.9), redeploy, record a note. Store Check heading: `KNOWN_LIMITATION` (K5), not fixable here | 13.14, 14.4 |
| FP-13.5 | Blank "Select Price Book" screen on the device | Same root cause as FP-10.4 | Re-check the 10.2 pairing | 13.6 |
| FP-14.1 | The Submit action is absent from the Actions menu, no error | `Quote.Status` FLS lacks `PermissionsEdit = true` on `<FIELD_REP_PS>` | Grant FLS Edit on `Quote.Status` (the layout can stay Readonly), then regenerate (10.8) | 14.1 |
| FP-14.2 | Stage transitions not enforced | `StagePathPermissionsHandler` is inactive | Activate as in 8.17, then re-run the 14.2 query | 14.2 |
| FP-14.3 | A second Submit tap is rejected with a stage-transition error | The client does not disable Submit after success; the server enforces exactly-once | Never retry Submit; reconcile `Quote.Status` first. If `Status` went to Submitted with no signature, the stage-path Submit was used: use a fresh Draft and the cart Review path | 14.7–14.8 |
| FP-14.4 | `QuoteDocument` stuck "In Progress" after the Generate PDF tap; `DocumentRecipient.SignatureIdentifier` stays null; logs may show "You do not have permission to create or edit files" | First cause: the rep has no Create on `QuoteDocumentCreationEvent` (8.24a missing), so the iPad Submit cannot publish the event. Other known configuration causes of the same symptom: profile Session Security Level High Assurance, or "Query Non Vetoed Files" enabled for the rep | Confirm Generate PDF was tapped once (14.11); bounded poll. Then check 8.24a (grant it if missing; the next signed Submit with one tap completes). Then check Session Security Level = Standard and "Query Non Vetoed Files" off (14.10/14.12 details). If either is wrong: ⏸ STOP and fix on approval; then ask again, separately, before any regenerate, re-publish or delete of the `QuoteDocument`. If both pass, record 14.12 as `PASSED_WITH_NOTES` with `KNOWN_LIMITATION` (K1), keep G2 (never re-publish, regenerate or delete the stuck `QuoteDocument` without the user's explicit consent), and continue; no P5 and no `BLOCKED`. Read Session Security Level from the rep's login session when profile metadata does not expose it; record the method. Separate case: 0 `DigitalSignature` / `DocumentRecipient` rows after a signed Submit → 14.10 `FAILED`; re-check on the next signed Submit before calling it a defect | 14.10, 14.12 |
| FP-14.6 | 14.10 counts more than one `DigitalSignature`, `QuoteDocument` or `DocumentRecipient` for one quote | Submit or Generate PDF ran twice (a retried tap, or a resend after a timeout) | Report the counts and the duplicate Ids; touch nothing; the customer decides which document to keep | 14.7–14.11 |
| FP-14.5 | (gated route: Approve and Reject) | Documented unlock pattern plus a custom In Review stage | Test once and report the literal `Status`; if no approval request appears, see FP-8.32. `Request for Unlock` failing with `REQUIRED_FIELD_MISSING` on `TerritoryId`: the approver has no active territory assignment; create it (5.4a, re-checked at 14.2a) | 14.13–14.15 |
| FP-15.1 | Last Order card absent despite a prior Submitted quote | Likely upstream: the Act 14 quote never reached `Submitted` (FP-14.3) | Re-check Act 14 `Quote.Status` before treating it as a Last Order defect. If no quote is in `<LAST_ORDER_STATUS>` at all, run 15.0 | 15.2 |
| FP-15.2 | n/a; prefill behaviour varies | `ProductsFromPreviousOrder` prefill drops manual discounts (K2); other prefill behaviour is not established | Report the literal outcome (full/partial/browse-only/none); do not force an assumption | 15.3–15.4 |

## Human-required steps

A step is listed here only when it needs a person: a physical iPad, a credential or OAuth consent, an approval only a person can give, or an input only the customer has. Every 🖱️ UI step in the Acts (Setup configuration pages) runs through Playwright; the web verification checks (8.9b, 8.16a, 8.30–8.33a, 9.9d, 9.23–9.25, 10.7a) always go to a person and are listed below; iPad steps are marked 👤 HUMAN (iPad); when `PLAYWRIGHT_AVAILABLE = no`, a human follows that step's click path instead, and those steps are not repeated here. Consent STOPs C1–C11 are answered once at 0.11 and are not listed here; they become live stops only when the answer is `ask` or a precondition differs. C12 is asked later (8.30a). C13 is answered at 0.11 on a `test` org and asked live at 9.20a on a `customer` org (or when its precondition fails); both are listed below.

| Step | Action (click path) | Report back | Agent verifies by | Reason human |
| :-- | :-- | :-- | :-- | :-- |
| 0.11, 1.in, 2.in, 4.in, 5.in, 7.in, 8.in, 9.in, 11.in, 13.in | Answer each question, or accept its recommended answer: six questions (seven keys) at 0.11, then only that Act's keys at each inputs step | The answers | Schema validation at each step; frozen copy and manifest record `answered` or `accepted recommendation` | Inputs are customer decisions and cannot be inferred |
| 0.1a | Complete the browser login opened by `sf org login web` for `<ORG_ALIAS>` (only if no matching `sf` login exists) | Login confirmed | `sf org display --target-org <ORG_ALIAS>` returns the expected instance | Browser login needs the account owner's credentials; cannot be scripted |
| 0.11 | Answer `yes` or `ask` for the irreversible-action consent items C1–C11 and C14 (one answer for all, or per item), and `ORG_KIND` (`customer` or `test`); C13 too when `ORG_KIND = test`. C12 is asked at 8.30a; on a `customer` org C13 is asked live at 9.20a | The answers | Manifest `consents` block complete | Informed consent for irreversible, org-wide actions; given once, with live stops wherever the answer is `ask` or a precondition differs |
| 1.13–1.18a, 4.9a, 5.4a, 8.9c, 8.15, 8.16a, 8.25, 9.21, 9.22a, 10.3, G12 | Only when C14 is `ask` or its precondition differs: approve or decline the named grant or change (C14a–C14m) | Approved / declined | The step's own check passes, or `declined` is recorded | Access grant or hard-to-reverse change; only the customer can consent |
| 1.9 | Save the Security Contact in Company Information, only where the field exists (UI; Playwright unless `PLAYWRIGHT_AVAILABLE = no`, then a person follows the click path). Where the field is absent, the agent records `securityContactField = absent` and `SECURITY_CONTACT = not applicable` | Security Contact saved, or field absent | Company Information read-back; the field value persisted | The value is a customer decision (a named contact) |
| 4.7 | Only when `RUN_REP_CLI_CHECK = yes` (the rep's CLI login is optional; skipped when `no`): complete the OAuth consent click for the CLI connected app, logged in as the Field Rep | Confirmation the consent screen was approved | Login History shows `Remote Access 2.0` / CLI success for `<FIELD_REP_USER>` | OAuth consent requires an interactive click by the account owner; cannot be scripted |
| 8.30a, run close | Decide whether the web smoke test runs as the rep. If yes, enable Setup → Login Access Policies → *Administrators Can Log in as Any User* (consent C12). At run close, ask the customer whether to turn it off again (`ORG_KIND = customer` only) | Yes / no (`SMOKE_AS_REP`) | The setting is on and the rep's Lightning session opens via Login-As; the answer is in the manifest | Org-wide login setting; only a person can consent |
| 8.9b, 8.16a, 8.30–8.33a | Web checks as the rep (Setup → Users → **Login** next to `<FIELD_REP_USER>`): 8.30 Quotes → **New Quote** → Account, Quote Name `<PFX>Web_Quote_1` → Save, then look at the saved Quote's Stage Path and buttons (8.9b, 8.16a); 8.31 Related → Quote Line Items → **Add Products** → price book → product → Quantity 1 → Save; 8.32 **Reprice All** once, then **Manage Header Adjustment** = Percentage 10 %; 8.33 (only if `RUN_BROWSE_CATALOGS_CHECK = yes`) **Browse Catalogs** → `<CATALOG>` → Next → one product → Preview Selection → Create Quote Line Items, then **Reprice All** (8.33a). Full click paths in each step | 8.30: saved yes/no, Quote name, any error text, Stage Path names in order, Browse Catalogs / Add Line Items / Submit shown, Approval tab or Mark Status as Complete shown; 8.31: price book pre-selected yes/no, grid loaded yes/no, line saved; 8.32: Reprice All result, Net Unit Price, Calculation Details screenshot; 8.33: a screenshot of each screen, line created | REST: `Quote` `Status`, `RecordTypeId`, STT, `Pricebook2Id`, `CalculationStatus`; `QuoteLineItem` count and `NetUnitPrice` against Act 7 (each step's verify column) | UI render checks; a person is faster and more reliable than browser automation on Lightning lookups and grids |
| 8.9b (manager) | Right after 8.30: Login-As `<MANAGER_USER>` (Setup → Users → **Login**) → open `<PFX>Web_Quote_1` in the Life Sciences Commercial app | Approval tab with the Work Guide shown yes/no; a screenshot | Retrieved app overrides for `<MANAGER_PROFILE>` (8.9b) | Same as 8.30–8.33a |
| 9.9d | As the rep: open the disposable Visit (Store Check record type); after an agent fix, reopen it once | The tab names shown; a screenshot | Retrieved app `Store_Visit` overrides (9.9d) | Same as 8.30–8.33a |
| 9.23–9.25 | Web checks as the rep: Visits list columns → **New** → record type picker → Store Check → Next → Cancel; New → In-Person → Next → Cancel; New → Remote → Next → Cancel; open `<PFX>Web_Quote_1` (footer, line grid) and a store account. Save nothing | SC1 columns; SC2 record types and the pre-selected one; SC3 fields and Channel values; what In-Person / Remote load (a K26 cache message is expected before Act 10); Grand Total in the footer, free-quantity column; store account tabs, any error banner or raw label text; a screenshot per screen | Deployed layout and rep-profile assignment (SC3), `FieldPermissions` (9.24), retrieved app override (9.25) | Same as 8.30–8.33a |
| 9.2 | If 9.1 found a legacy override: approve or decline its removal (the agent then removes it, 9.2 mechanism) | Approved / declined (routing cannot work while it stays) | Re-run 9.1; then 9.7 New/Edit check on an In-Person and a Remote Visit | Changes Visit New/Edit for every user; destructive to the existing HCP visit experience if removed without 9.7 |
| 9.20a | Only when not pre-consented at 0.11 (always on a `customer` org): approve or decline the org-wide sharing change (Public Read Only for three objects; consent C13) | Approved / declined | `EntityDefinition.InternalSharingModel = Read` for the three objects, or the 9.21 / 9.22 shares present when declined | Org-wide visibility change; always a live stop |
| 10.7a | Web check as the rep, in a new rep session: Visits → New → In-Person → Next, then Remote → Next; cancel both | Whether each form loads; the exact text and a screenshot of any modal | 10.1b assignment and `sobjects.json` (10.7) if a modal shows | Same as 8.30–8.33a |
| 11.1 | Install `<IPAD_APP_BUILD>` on the device | App opens | n/a (device state) | Physical device install |
| 11.2 | Log in as `<FIELD_REP_USER>` | Home screen shown | `UserDevice` query (11.4) | Physical device login |
| 11.3 | Profile & Territory → Begin Sync → confirm Sync | Sync progress completed | Data-presence check (11.5) | Physical device tap, no API equivalent |
| 12.1–12.16 | Visits list → New Visit → Begin Visit → Begin Store Check → fill all 3 tabs → Save & Close → End Visit | Screen state at each sub-step (photo where a step asks for one) | Server-side queries (12.4, 12.6, 12.12–12.14, 12.16) | Touchscreen data entry across 22 indicators; continue-without-location dialog |
| 13.1–13.13 | Quotes list → New/Create-from-Visit → Select Price Book → Add Products → product picker → quantities → Calculation Details → Order Discount → Save | Screen state at each sub-step; exact card/behavior observed | `QuoteLineItem`/`Quote` queries (13.4, 13.9, 13.14) | Touchscreen product selection and quantity entry; price-book/product-picker UI has no exercised API equivalent |
| 13.2 | On the Act 12 Visit, report whether the Quoted Order tab lists the visit's quotes with New, and whether Create Quote shows in the visit menu | Shown / absent for each | 13.4 `Quote.VisitId` after using Quoted Order → New | Rendering can only be observed on device and in the browser |
| 14.3–14.11 | Review Order → Disclaimer → sign → Submit Order (once) → Actions → Generate PDF (once; it produces the PDF) | Toast/path state after each tap | `Quote.Status`, `DigitalSignature`, `DocumentRecipient`, `QuoteDocument` queries (14.8, 14.10, 14.12) | Signature pad and one-shot Submit tap are physical device actions |
| 14.12 | If a FP-14.4 check fails (Session Security Level not Standard, or "Query Non Vetoed Files" on for the rep), approve or decline the change | Approved / declined | Re-run both FP-14.4 checks, then generate the PDF once more | Security-relevant setting; needs live approval |
| 14.6 | Confirm readiness for the one-shot Submit (consent C10, pre-consented or live) | Yes / no | Manifest records the C10 answer; `Quote.Status = Draft` read from the server | Consent for an irreversible Submit |
| 14.13, 14.15 | 14.13: confirm who decides the unlock (recommended: the admin in web, one Reject). 14.15: make the decision once (Review → Approve or Reject → Confirm), on web only | Who decides; the decision made | `Quote.Status` and the approval work item (14.15) | The decision is a person's; the iPad has no Approval tab |
| 8.17 (fallback) | Only if the Tooling PATCH of the handler fails: Admin Console → Trigger Handler Administration → click the row's Active switch once (consent C8; click path in 8.17) | Handler active | `IsActive` read-back | UI fallback for an org-wide activation |
| 15.0 (fallback) | Only when no source quote exists and one must be created on the iPad: follow the 13.3 steps for `<STORE_n>` (then 13.5–13.9, 13.10, 13.12, 13.13, 13.13a as in 15.0) | Quote record opens, `Status = "Draft"` | `Quote` query at 15.0 | Touchscreen quote creation |
| 14.14 | Actions (Submitted) → Request for Unlock | Resulting path state | `Quote.Status` query (14.15) | Device UI action, gated; runs when `TEST_UNLOCK_ROUTE = yes` |
| 15.1–15.3, 15.5 | New Quote → Add Products → select Last Order card → Save | Card state, resulting lines, Save confirmation | `QuoteLineItem` query (15.4) | Touchscreen UI with no exercised API equivalent |

## Build inventory

| Artifact (API name) | Type | Created/changed in step |
| :-- | :-- | :-- |
| `runs/run-NN/` (frozen inputs, manifest, learnings log, Act summaries, artifacts) | Local folder | 0.1, 0.12 |
| `Chatter.enableChatter`, `Industries.enableLifeSciencesCustomerEngagementBase`, `Industries.enableLSC4CEPackage`, `Industries.enableLSC4CEDocumentManagement` | Settings field | 1.2 |
| `Address` State/Country Picklists conversion | Org-wide config (UI wizard) | 1.4 |
| `Account.Business_Account` | RecordType | 1.5 |
| `<PFX>Business_Account_RT_Access` | PermissionSet | 1.6 |
| `Account.IsPersonAccount` (evidence: Account describe) | Org-wide config (UI page) | 1.8 |
| `PersonAccount.PersonAccount` visibility in `<PFX>Business_Account_RT_Access` | PermissionSet (recordTypeVisibilities) | 1.8a |
| `Organization` Security Contact | Org field (UI only, Playwright; only where the field exists) | 1.9 |
| `UserInfo.isMultiCurrencyOrganization()` | Org-wide config (deploy, UI fallback) | 1.11 |
| `CurrencyType` rows for `<ACTIVE_CCYS>`/`<CORP_CCY>` | Data | 1.12 |
| `Territory2Settings.enableTerritoryManagement2` | Settings field (deploy, UI fallback) | 1.13 |
| `OrgPreference: InventoryCountEnabled`, `OrgPreference: InventoryBatchManagement`, `OrgPreference: PrdInventoryOperationsPref`, `OrgPreference: CarePlansPreference` | Org preference | 1.14–1.17 |
| `Survey.enableSurvey` | Settings field | 1.18 |
| `AccountPlan.enableAccountPlan` | Settings field | 1.18a |
| `IndustriesLSC4CEPsl` / `LifeSciencesCommercialAdmin` / `HealthCloudStarter` PSL / `HealthCloudStarter` PS | PermissionSetLicenseAssign / PermissionSetAssignment (two Composite calls: licences, then permission sets) | 1.0, 2.1 |
| `lsc4ce` installed package (`<PKG_VERSION_ID>`; only when this thread installed it) | InstalledSubscriberPackage | 2.3 |
| `Industries.enableStoreCheck` | Settings field (deploy, UI fallback) | 3.1 |
| `Quote.enableQuote` (on after 3.2); `enableQuotesWithoutOppEnabled` (false after 3.2, true after the 6.4 Turn On, checked at 6.5) | Settings field (deploy, UI fallback) | 3.2, 6.5 |
| `Industries.enableGroupMembershipPref` | Settings field (deploy, UI fallback) | 3.3 |
| `Industries.enableLifeSciRecTypeRoutgPref` | Settings field | 3.5 |
| `<PFX>Mobile_Metadata_Admin` | PermissionSet | 3.6 |
| `<FIELD_REP_PROFILE>` | Profile | 4.1, 4.2 |
| `<FIELD_REP_PS>` | PermissionSet | 4.1, 4.2 |
| `<FIELD_REP_USER>` | User | 4.3 |
| `ActionPlansPsl`, `ContextServiceRuntimePsl`, `CorePricingRunTime`, `DocumentBuilderUserPsl`, `HealthCloudStarter`, `IndustriesLSC4CEPsl`, `IndustriesVisitPsl`, `ProductCatalogManagementViewerPsl`, `ProductDiscoveryUserPsl`, `RevenueLifecycleManagementUserPsl` | PermissionSetLicenseAssign (10) | 4.4 |
| `ActionPlans`, `ContextServiceRuntimePsl`, `CorePricingRunTimeUser`, `DocumentBuilderUser`, `HealthCloudStarter`, `IndustriesVisit`, `LifeSciencesCore`, `LifeSciencesFieldSalesRepresentative`, `ProductCatalogManagementViewer`, `ProductDiscoveryUser`, `RevLifecycleManagementQuotePricesTaxes`, `<FIELD_REP_PS>` | PermissionSetAssignment (11 at 4.5; the 12th, `RevLifecycleManagementQuotePricesTaxes`, at 4.9a) | 4.5, 4.9a |
| `<PFX>Temp_CLI_OAuth_Approval` | PermissionSet (temporary, only when 4.7 runs; its assignment is deleted after use and the set is left in place, unassigned) | 4.7 |
| `<TERRITORY_TYPE>`, `<TERRITORY_MODEL>`, `<TERRITORY>` | Territory2Type / Territory2Model / Territory2 | 5.1, 5.3 |
| `<STORE_n>` Account, `<STORE_n>` Place, `<STORE_n>` territory link, `<STORE_n>` PATI | Account (Business Account RT) / ContactPointAddress / ObjectTerritory2Association / ProviderAcctTerritoryInfo | 5.6 |
| Order Management bundle (Core CPQ, Quotes, Context Service, Salesforce Pricing, Transaction Processor, Draft Order Capture) | Org feature settings | 6.4 |
| Standard `Pricebook2` | sObject (activated) | 6.4 (activation), 7.6 (per-product PBE activation) |
| Quote record `FlexiPage` | Metadata (deployed) | 6.4 |
| PermissionSetAssignment (`CorePricingRunTimeUser`, `ContextServiceRuntimePsl`, `RevLifecycleManagementQuotePricesTaxes`, `ProductDiscoveryUser`, `ProductCatalogManagementViewer` → `<ADMIN_USER>`; optional) | PermissionSetAssignment (data) | 6.5b |
| `<CONTEXT_DEF>` | `ContextDefinition` | 6.6, 6.7, 6.8 |
| `QuoteEntitiesMapping` default flag | `ContextMapping` | 6.7 |
| `<PFX>LSCDefaultRecipe` | `PricingRecipe` | 6.9, 7.15 (activated + linked) |
| ListPrice table mapping | `PricingRecipeTableMapping` | 6.9 |
| `<CATALOG>`, `<CATEGORY_n>`, `<PRODUCT_n>`, Selling models + options, Category membership | `ProductCatalog` / `ProductCategory` / `Product2` / `ProductSellingModel` / `ProductSellingModelOption` / `ProductCategoryProduct` | 7.1–7.5 |
| `<PRICEBOOK_n>`, Price book entries | `Pricebook2` / `PricebookEntry` | 7.6 |
| Territory availability (Quote) | `ProductTerritoryAvailability` → `ProductTerrDtlAvailability` (+shares) | 7.7, 7.8 |
| Catalog/territory shares | `ProductCatalogShare` / `ProductTerritoryAvailabilityShare` | 7.8 |
| `<PFX>EssentialsVolumeSchedule`, `<PFX>DisplayTierSchedule`, Tier rows | `PriceAdjustmentSchedule` / `PriceAdjustmentTier` | 7.10, 7.11 |
| Decision tables (Range/Slab/List Price) | `DecisionTable` (refreshed) | 7.12, 7.20 |
| `<PRICING_PROCEDURE>` | `ExpressionSetDefinition` | 7.13 |
| `<PRICING_PROCEDURE>` version (V1 on a fresh org; each later change is a new version, the previous one kept inactive for rollback) | `ExpressionSetVersion` (20 steps with the floor group, 17 without; 15 variables) | 7.13, 7.14 (simulated), 7.15 (Rank set, activated, read back, then the old version deactivated) |
| `<STT_NAME>` | `SalesTransactionType` | 7.16 |
| `<PFX>STT_Procedure_Link` (Read / Edit on the STT procedure-link fields; assigned to `<ADMIN_USER>` only) | PermissionSet | 7.16, 7.16a, 8.11a (repair) |
| Org-default pricing-procedure selector | Revenue Settings (`QocalPricingProcedure`) | 7.17 |
| Header Adjustments (`enableRevenueAdjustment` = `true`) | Settings (`RevenueManagement`) | 7.17b |
| Product Configurator (`enableProductConfigurator` = `true`; only if 7.17c ran) | Settings (`ProductConfigurator`, Metadata API deploy) | 7.17c |
| `<PFX>Browse_Product_Catalog` flow + `ProductDiscovery.settings` (`discoverProductsFlowNameOrgValue`) | Flow metadata, Settings | 7.18 |
| `Quote.Quote_Record_Type` | RecordType | 8.1 |
| `Quote-Quote Layout` | Layout (`VisitId` Edit, `Status` Readonly; Quote Line Items related-list columns, Related tab only) | 8.2, 8.2a |
| `<FIELD_REP_PROFILE>` | Profile (recordTypeVisibilities, layoutAssignments) | 8.3, 8.4 |
| `lsc4ce__lifeSciencesCommercial` | CustomApplication (`subscriberTabs`) | 8.5 |
| `<FIELD_REP_PS>` | PermissionSet (tabSettings, fieldPermissions) | 8.6, 8.13 |
| `LifeScience_Quote_Record` | FlexiPage (template, header = highlights + stage path, tabs Quote Line Items / Details (2 sections) / Related / Approval, Quote Summary footer, line-table `displayFields` incl. `AdditionalFreeItemQty` and `enableQuickAdd` / `enableSidepanel` true, plain-text section labels, Details `Record.Status` `uiBehavior` `readonly`; deploy with sourceApiVersion ≥ 65) | 8.7, 8.8, 8.9, 8.9a, 8.9b |
| Profile overrides for the Quote View action (Large and Small) | CustomApplication `profileActionOverrides` | 8.9b |
| `Quote.<PFX>Quote_Compact` (primary compact layout, Account for Quote in the iPad header) | CompactLayout; `CustomObject` `Quote` `compactLayoutAssignment` | 8.9c |
| Embedded in this runbook as Appendix B (it lists each file, its step and the substitution): `LSC_Quote_Lock_and_Unlock_Approval_Process`, `LSC_Quote_Notifications_for_Lock_and_Unlock`, `LSC_Quote_Set_Status_In_Review`, `Notification_when_Quote_is_locked_and_Unlocked`, `Generate_Quote_Flow`, `lsc4ce_Quote_Document.flexipage-meta.xml` | Flow / NotificationType / FlexiPage metadata | 8.21a, 8.23, 8.24 |
| `OrderProductViewsSettings_<ID:fieldRepProfile>` | LifeSciConfigRecord (incl. waterfall statuses Draft / Submitted, retention 5) | 8.10 |
| `OrderProductViewsSettings_OrgLevel` | LifeSciConfigRecord (org level, no assignments) | 8.10b |
| `LifeSciConfigAssignment` (OrderProductViewsSettings → `System Administrator` profile) | Tooling API record | 8.10a |
| `<STT_NAME>` | SalesTransactionType (data) | 7.16 (confirmed in 8.11) |
| PermissionSetAssignment (CPQ-licensed PS → `<FIELD_REP_USER>`) | PermissionSetAssignment (data) | 8.12 |
| `QuoteSettings_OrgLevel` | LifeSciConfigRecord | 8.14 |
| PermissionSetAssignment (Quote-Create PS → `<FIELD_REP_USER>`) | PermissionSetAssignment (data) | 8.15 |
| `QuoteStatus` | StandardValueSet | 8.16 |
| `StagePathPermissionsHandler` (Active state) | `LifeScienceTriggerHandler` setup record (set by Tooling PATCH; Admin Console is the human fallback) | 8.17 |
| Lifecycle graph (`LifeSciStagePath`/`Value`/`Operation`/`Object`/`Action`/`OperationAction`, Draft→Submitted) | data | 8.18 |
| `LifeSciStageActionShare` | data | 8.19 |
| `ComplianceStatementDefShare` | data | 8.28 |
| Lifecycle graph (gated branch: Request for Unlock/In Review/Rejected) | data | 8.21 |
| `DigitalSignatureType` | StandardValueSet | 8.22 |
| Quote Document template FlexiPage (type `ServiceDocument`) | FlexiPage | 8.23 |
| DocGen Flow (clone of `ls_ordermgmt__GenerateLsQuoteDoc`) | Flow | 8.24 |
| PermissionSetAssignment (`DocumentBuilderUserPsl`+`DocumentBuilderUser` → admin) | PermissionSetAssignment (data) | 8.25 |
| `<FIELD_REP_PS>_Signature` | PermissionSet | 8.26 |
| PermissionSetAssignment (signature PS → `<FIELD_REP_USER>`); `FlowDefinition.activeVersionNumber` | PermissionSetAssignment (data); config | 8.27 |
| ComplianceStatementDef (`<DISCLAIMER_TEXT>`/`<DISCLAIMER_COUNTRY>`) | data | 8.28 |
| `QuoteDocumentSettings` (profile-scoped) | LifeSciConfigRecord (Admin Console UI only: Playwright, or 👤 HUMAN if `PLAYWRIGHT_AVAILABLE = no`) | 8.29 |
| Draft Quote + QuoteLineItem (smoke-test, disposable) | data | 8.30, 8.31 |
| `System Administrator` profile (`recordTypeVisibilities` `Quote.Quote_Record_Type`, default) | Profile | 8.30b |
| `System Administrator` profile (`recordTypeVisibilities` `Visit.In_Person`, `Visit.Remote`, `Visit.Store_Check` default; only if `ADMIN_VISIT_ACCESS = yes`) | Profile | 9.8b |
| `LifeSciConfigAssignment` rows: System Administrator profile on the rep's `DbSchema_*` records (only if `ADMIN_VISIT_ACCESS = yes`) | Tooling data | 10.1c |
| `IndustriesSettings.enableStoreCheck` | Settings | 9.3 |
| `RecordType:Visit.Store_Check` | RecordType | 9.5 |
| `Layout:Visit-Store Check Visit Record Page` (carries the `Quotes` related list for the Quoted Order tab) | Layout | 9.5, 9.9 |
| `FlexiPage:Store_Visit` | FlexiPage | 9.5, 9.9 |
| `CustomApplication:lsc4ce__lifeSciencesCommercial` | CustomApplication | 9.5, 9.10 |
| `Profile:<FIELD_REP_PROFILE>` | Profile | 9.5, 9.8 |
| `LifeSciConfigCategory:ObjectRecordTypeRoutingConfiguration` | LifeSciConfigCategory | 9.5 |
| `LifeSciConfigRecord:Store_Check_New` | LifeSciConfigRecord | 9.5 |
| `LifeSciConfigRecord:Store_Check_Edit`, `LifeSciConfigRecord:HCP_Visit_New/Edit, Remote/Remote_Edit` | LifeSciConfigRecord | 9.6, 9.7 |
| `LifeSciConfigRecord:Create_Quote_From_Visit` | LifeSciConfigRecord (`isOrgLevel` false, no assignments) | 8.34, 8.34a, 9.5a |
| `PermissionSet:<FIELD_REP_PS>` (tabSettings) | PermissionSet | 9.10 |
| `FieldPermissions` on `<FIELD_REP_PS>`: `Quote.GrandTotal` (Read), `QuoteLineItem.AdditionalFreeItemQty` (Read, Edit) | FieldPermissions (data) | 9.24 |
| `lsc4ce_Store_Account_Record` | FlexiPage (new Account record page: highlights header, Details / Related tabs) | 9.25 |
| `lsc4ce__lifeSciencesCommercial` `profileActionOverrides` (View, Large, `Account.Business_Account`, `<FIELD_REP_PROFILE>`) | CustomApplication (retrieved and merged) | 9.25 |
| `ObjectPermissions` on `<FIELD_REP_PS>` for `Image` (Read, Create, Edit) | ObjectPermissions (data) | 9.26 |
| `ObjectPermissions` on `<FIELD_REP_PS>` for `QuoteDocumentCreationEvent` (Read, Create) | ObjectPermissions (data) | 8.24a |
| `LifeSciStageObject/Path/Value/Operation/Action/OperationAction` (+3 shares), `Assortment`, `AssortmentProduct`, `StoreAssortment`, `AssessmentTaskDefinition` ×3, `AssessmentIndicatorDefinition` ×22, `AssessmentIndDefinedValue`, `AssessmentTaskIndDefinition` ×22, `RetailStoreKpi`, `ActionPlanTemplate` ×3 + version/items/values/assignment | Data (12 rows) / Data | 9.11–9.20 |
| Internal org-wide sharing Public Read Only for `AssessmentIndicatorDefinition`, `AssessmentTaskDefinition`, `ProductTerritoryAvailability` (only on approval) | CustomObject `sharingModel` | 9.20a |
| `ActionPlanTemplateShare`/`AssortmentShare`/`AssessmentTaskDefinitionShare` (optional after 9.20a)/`RetailStoreKpiShare` (10 rows after an approved 9.20a, 13 if declined) | Data | 9.21 |
| `ProductTerritoryAvailability`/`ProductTerrDtlAvailability` (+shares; the PTA share optional after 9.20a: 3 share rows approved, 6 declined) | Data | 9.22 |
| `DbSchema_Quote`, `DbSchema_QuoteLineItem`, `DbSchema_Pricebook2`, `DbSchema_PricebookEntry`, `DbSchema_PriceAdjustmentSchedule`, `DbSchema_PriceAdjustmentTier`, `DbSchema_ProductCategoryProduct`, `DbSchema_DigitalSignature`, `DbSchema_DocumentRecipient`, `DbSchema_QuoteDocument`, `DbSchema_ComplianceStatementDef`, `DbSchema_AppUsageAssignment`, `DbSchema_QuoteDocumentSettings`, `DbSchema_SalesTransactionType` (the full list is the 10.1 manifest: 63 components, 61 without the field sets) | `LifeSciConfigRecord` (profile-scoped) | 10.1 |
| `DbSchema_Visit`, `DbSchema_StoreAssortment`, `DbSchema_Assortment`, `DbSchema_AssortmentProduct`, `DbSchema_RetailVisitKpi`, `DbSchema_AssessmentTask`, `DbSchema_AssessmentTaskDefinition`, `DbSchema_AssessmentTaskIndDefinition`, `DbSchema_AssessmentIndicatorDefinition`, `DbSchema_AssessmentIndValue`, `DbSchema_AssessmentIndDefinedValue`, `DbSchema_ActionPlan` (+ `Item`/`Template`/`TemplateAssignment`/`TemplateItem`/`TemplateItemValue`/`TemplateVersion`) | `LifeSciConfigRecord` (profile-scoped) | 10.1 |
| `DbSchema_Image`, `DbSchema_ContentVersion`, `DbSchema_ContentDocument`, `DbSchema_ContentDocumentLink` (photo sync, `AttachmentsSupport=BACKGROUND`) | `LifeSciConfigRecord` (profile-scoped) | 10.1a |
| `ApplicationSettings`, `ProfileBasedAppSettings`, `StoreCheckSetting` (`Custom-<FIELD_REP_PROFILE>`) | `LifeSciConfigRecord` (profile-scoped) | 10.1 |
| `<FIELD_REP_PROFILE>` tab visibility for standard `Quote` tab | `Profile` metadata | 10.1 |
| New `LifeSciMobileMetadataRecord` parent+child pair | custom object record | 10.3 |
| `mobile-cache-<PFX>.zip` | downloaded `ContentVersion`/`ContentDocument` | 10.6 |
| `UserDevice` registration for `<FIELD_REP_USER>` | observed, not created by this runbook | 11.4 |
| Store Check `Visit`, `AssessmentTask`, `AssessmentIndValue`, `RetailVisitKpi`, `ActionPlan` (applied Act 9 templates) | record / records / record (system rollup) | 12.3–12.16 |
| Draft `Quote` (`<STORE_n>`), `QuoteLineItem` (Draft Quote) | record / records | 13.3–13.14 |
| `Quote.Status` → `Submitted`, `DigitalSignature`, `DocumentRecipient`, `QuoteDocument`, Second `Quote` + `QuoteLineItem` (`<STORE_n>`) | field update / record / records | 14.5–14.12 |
| Run manifest final close-out | document | 15.6–15.7 |

## UNVERIFIED items

These items are built by analogy, inferred, or proven only on their own and not in this combination. Each is tested once at the listed step, and the result is written as a `verification` learnings row (`proven`, `disproven` or `still_open`).

| Item | Why unverified | Step | How the runtime agent proves it |
| :-- | :-- | :-- | :-- |
| Turning on Product Configurator lets the 7.18 Save As succeed on an org that hit FP-7.16 (7.17c) | Proven with a validate-only deploy of the flow copy on one trial org; the Save As itself was not redone there | 7.17c, 7.18 | Record the redone Save As result; if it still fails, stop as 7.17c says |
| A Request for Unlock work item assigned to a user other than `<ADMIN_USER>` can be decided on web by the person signed in as that user | Not tested with a work item assigned to another user | 14.15 | Read `AssignedToId` (14.14 query); if not `<ADMIN_USER>`, follow the 14.15 fallback and record the outcome |
| The Field Rep signs in to the CLI with `sf org login web` for the 4.7 OAuth consent | Not yet confirmed | 4.7 | Login History shows the CLI success for the rep; otherwise skip 4.7 and rely on 4.6 (`PASSED`, substitution listed) |
| A `<NOTIFY_ADMIN_USER>` on a cloned admin profile is accepted when its profile has Modify All Data | Only the standard System Administrator profile was used | 8.in, 8.21a, 14.13 | Approve at 14.13 returns the quote to `Draft`; otherwise name a user on the standard System Administrator profile and re-run 8.21a |
| Profile names with spaces, `&`, parentheses or slashes substitute correctly into Act 8 XML and file names | Only a name of letters, digits and `_` was used | 8.9a | Retrieved FlexiPage and app show the override for the profile; otherwise rename the profile at 4.in |
| The 8.9b Quote record page assignment is what makes the 8.31 Choose Price Book picker populate | Seen populated after 8.9b; an empty picker before 8.9b was not compared | 8.31 | Record whether the picker opened populated on the first attempt. Empty with 8.9b read back as deployed → `disproven`; record the four diagnostics |
| The admin can read the shipped mobile `TransactionProcessingType` once 7.16 has run | The record exists within minutes of the Turn On, but an admin query at 6.5 returned 0 rows | 8.14 | Record the 8.14 pre-UI query result and, if 0 rows, how long the re-query took to return the row |
| Adding currencies beyond the single default, or a non-USD `<CORP_CCY>` | Only single-currency (USD) orgs exercised | 1.12 | Query `CurrencyType`; confirm `IsoCode`/`IsCorporate`/`IsActive` rows match `<CORP_CCY>`/`<ACTIVE_CCYS>` |
| Activating Multi-Currency, the corporate currency and the active currencies with one `Currency.settings` deploy | The Company Information checkbox is proven at API 68.0; the single deploy was not run | 1.11, 1.12 | Check `UserInfo.isMultiCurrencyOrganization()` and the `CurrencyType` rows; if either differs, use the UI fallback in the step |
| `DISCLAIMER_COUNTRY` as a two-letter code other than `US` in `JurisdictionCountries` | Only `US` was posted | 8.28 | Record the POST result; a rejection → the ⏸ STOP in the step |
| Removing a legacy Visit New/Edit override by deploying the `Visit` `actionOverrides` | General Metadata API behaviour; not run for this override | 9.2 | Re-run 9.1; override still present → use the UI path in 9.2 |
| Bundling the Chatter + Industries base settings into one deploy | Each proven alone; the 2-component deploy was not run | 1.2 | Re-retrieve both settings and confirm all 4 fields read back `true` |
| `enableLifeSciRecTypeRoutgPref` as a standalone single-field settings deploy | Deployed only inside the full Visit-routing bundle | 3.5 | Field reads back `true`, no errors, and Act 9's later bundle does not conflict |
| One permission set for `ViewDeveloperName`, `SkipVldBefMetadataGeneration` and the two mobile-metadata permissions | Not tested as one set | 3.6 | Deploys cleanly and `<ADMIN_USER>` has all four `userPermissions` `true` (`PermissionSetAssignment`/`UserPermissionAccess`) |
| 10 PSLs then 11 permission sets in two Composite calls at 4.4/4.5 (the 12th at 4.9a), not one combined call | Not tested as one combined call | 4.4/4.5 | Read back exactly 10 `PermissionSetLicenseAssign` and 11 `PermissionSetAssignment` rows (12 after 4.9a) |
| `ObjectTerritory2Association`/`ProviderAcctTerritoryInfo` visibility for a non-owner Field Rep on these store records | Territory membership alone does not grant access to other Private-model objects; not tested for these store records | 5.7 | Query both (or `UserRecordAccess`) as `<FIELD_REP_USER>`; if `HasReadAccess=false`, add a manual Read share before Act 9/12 |
| 4.7 skipped when `RUN_REP_CLI_CHECK = no`; the bootstrap session persists to a later Act | Not tested across Acts | 4.7 | Skipped: rely on the 4.6 admin-side check (`PASSED`, substitution listed). Run: an authenticated call as the Field Rep at the start of the later Act needing it; re-run 4.7 only if it fails |
| Multi-currency `PricebookEntry` creation (several `<ACTIVE_CCYS>`) | Not tested with more than one currency | 7.6 | Create one currency first; confirm Standard and custom entries activate and simulation gives the right `NetUnitPrice`, then the rest |
| Non-default `contextTtl` | Not tested with a TTL other than 10 minutes | 6.6 | On a customer-requested TTL, test session expiry on a disposable Quote |
| Price-floor step with more than one floor product | Not tested with more than one floor product | 7.13 | Simulate a floor and a non-floor product in one call; only the floor product is floored. Fallback: one floor product, record the others as not applied |
| Manual-discount scope narrower than all products (wrapped graph) | The built graph applies it on every line; scope wrapping is not tested for every case | 7.13 | One case on a listed product (discount) and one on an unlisted product (none). Fallback: rejected graph or failing case → stop `BLOCKED_PRICING_PROCEDURE` with the response |
| Mobile pricing when the org-level and profile-scoped order-product-view settings name different procedures | The profile-scoped setting is the one the device uses; a mismatch was not tested | 7.17, 8.10 | Keep all three on the same procedure (FP-10.3); Act 10 checks the procedure name in `expressionSet.json` |
| `LSDraftOrderPilot` gating of Last Order | What the permission gates on a new org is not isolated | 8.10 | The `PermissionsLSDraftOrderUser` precheck (Step details 8.10) and Product Views offering Last Order in the Admin Console. Fallback: FP-8.33 |
| Disclaimer account substitution filters (only if `DISCLAIMER_ACCOUNT_SUBSTITUTION = yes`) | Set on Quote Document Settings → Disclaimer Filters (8.29); substituted text not tested on a device | 8.28, 8.29 | Re-open 8.29, confirm both filters, then check the disclaimer on the iPad Review Order screen (14.4) |
| Visit Decoupling release scope | Several fixes tracked for a later release | 9.7 | No step depends on it; the customer raises the 9.7 question with Salesforce Support |
| `AssessmentIndDefinedValue` illustrative lists | Illustrative, not customer-sourced | 9.17 | Confirm or replace with customer values before the first live Store Check |
| `RetailStoreKpi.KpiType` for 6 of 8 numeric/currency indicators | Not tested beyond `Inventory` and `Facing` | 9.19 | Describe the `KpiType` picklist before insert |
| Anomalies / Priority filters on the Store Check tab | Not tested beyond a Stock Count below target | 12.8 | Enter a Stock Count below target, open Filters → Anomalies and Priority. Fallback: non-blocking; record a note |
| Task-definition templates (`AsmtTskDefTmpl` / `AsmtTaskDefTemplateIndDef`) | A newer native pair exists; the Action Plan path is used | 9.20 | Not needed; evaluate only if the Action Plan path fails |
| Editing a `Final` Action Plan template | No test edits a published template | 9.20 | Treat as immutable; create a new template (FP-9.7 pattern) |
| Reusing Act 7 catalog products instead of a dedicated Store Check fixture | Not tested with the Act 7 products | 9.12 | Confirm the Store Check tab resolves `<PRODUCT_n>` after sync (Act 12) |
| Duplicate-mapping validation | Expected: a second mapping for the same `(RecordType, Action)` is rejected | 9.8 | Duplicate-key query after 9.7 returns zero rows; deploy one duplicate on a disposable record and confirm rejection; if accepted, delete it and record `PASSED_WITH_NOTES` |
| `In_Person` and `Remote` offering all 7 `Channel` values with no `picklistValues` | Not tested beyond the Store Check form | 9.4b, 9.23 | 9.23 opens New Visit with each type and lists `Channel`; fewer than 7 → add `picklistValues` for all 7 values and redeploy that type |
| State/Country wizard button names and the post-enable re-check ceiling | Not recorded | 1.4 | Record the button names and re-check time; done when `BillingCountryCode` is in the Account describe |
| Unmapped-value handling in the State/Country scan | Not exercised | 1.4 | The scan reports unmapped values; none silently dropped |
| `SubscriberPackageVersion` validation field list | Not confirmed | 2.in | The query returns the fields the step reads; otherwise stop with the P5 report |
| Permission set group with a muting set to stop the rep editing indicator definitions (only when `MUTE_INDICATOR_EDIT = yes`; C14) | Packaged `IndustriesVisit` grants ModifyAll; the mute layering was not run | 9.21 | After assigning the group, the rep's `AssessmentIndicatorDefinition` access is Read only; never edit the packaged set. Fallback: keep K15 as accepted and record it |
| **Mark Status as Complete** removed from the Quote path | Cause of the button not established | 8.16a | Not offered afterwards; if still offered, `KNOWN_LIMITATION` (K14) |
| Setting unused `QuoteStatus` values inactive | `isActive=false` on a standard value not run | 8.16a | Read-back shows them inactive; else leave active and rely on the record-type filter |
| Combined single-shot mobile generation (Store Check + Quote) | Not tested as one cycle | 10.3–10.7 | ZIP acceptance check across both features' schemas in one cache |
| Two-tap manual sync reliability | Not tested apart from a background sync | 11.3 | Compare data presence before/after manual sync vs. an idle wait |
| Non-USD / multi-currency paths through Quotes/Store Check | Not tested with a non-USD currency; Quote currency comes from the rep (G12) | 12–15 | Re-run with a non-USD `<ACTIVE_CCYS>` currency and reconcile pricing |
| Photo DbSchemas (10.1a) on a fresh org | Not tested on a fresh org | 10.1a, 12.x | After the four schemas are created and the cache is regenerated, an iPad photo syncs with no `MALFORMED_QUERY` and is linked on the server. On failure re-check the `ContentDocumentLink` filter and `ContentDocument` pairing, regenerate, `PASSED_WITH_NOTES` |
| Relaunch after a cache change | Not tested with Sync alone (without a relaunch) | 10.8, 11.x | After regeneration and sync, relaunch once, then check the change; record whether it showed before the relaunch |
| Admin pricing and catalog permission sets (6.5b) assignable in every org | Assignment can be rejected for a missing licence | 6.5b | Record a rejection; continue on the rep path (`SMOKE_AS_REP = yes`) or the Master-record-type admin fallback at 8.30a, `PASSED_WITH_NOTES` |
| UI fallbacks at 3.1–3.4 | The deploy route has always worked | 3.1–3.4 | Only when a read-back stays `false`: follow the click path, then re-read. Fallback: 👤 HUMAN |
| 6.4 setting names are the plan's labels, not API names | Not confirmed as metadata or API names | 6.4, 6.5 | 6.5 verifies by effect (each feature's object or setting answers). Fallback: verify by effect |
| `PATCH` adding a version to an expression-set definition; staged build when the single `POST` is rejected | The `PATCH` and the staged build are not tested | 7.13 | Read back the version and steps. Fallback: retry with the `ExpressionSet` Id from the response (prefix `9QL`); if both are rejected, stop `BLOCKED_PRICING_PROCEDURE` with the response |
| Activating a new version while an older one is active (re-run) | Not tested on a re-run | 7.15 | Activate, read back active, then deactivate the old one. Fallback: stop and report |
| Creating the STT before the link permission set is created in a fresh org | Not tested on a fresh org | 7.16 | Read back `PricingProcedureId`. Fallback: create the STT with `Name` only, `PATCH` the link at 7.17a |
| The Quote compact layout is carried in `sobjects.json` and `ui.json` | Not inspected in the ZIP | 8.9c, 10.7 | Look for the assignment and layout in the ZIP. Fallback: the device header check at 13.14 |
| Approve returns the quote to Draft when the notification steps run as `<NOTIFY_ADMIN_USER>` (8.21a) | Run-as is the inferred cause, not isolated | 8.21a, 14.13 | Approve at 14.13, read `Quote.Status`. Fallback: `UNKNOWN_EXCEPTION` on the notification step → `PASSED_WITH_NOTES`, `KNOWN_LIMITATION` K24 |
| Adding the Store Check record type to `Create_Quote_From_Visit` by Admin Console re-save | The ZIP route is the proven one | 8.34, 8.34a | Read the saved record's `RecordTypes`. Fallback: the ZIP route |
| A customer-supplied `STORE_CHECK_COLUMNS` set | Only the default set is built | 9.in | Given as indicator rows with picklist values; anything else is rejected and re-asked. Fallback: `default`, recorded as `accepted recommendation` |
| Creating and generating the mobile metadata parent with the CLI command | CLI availability varies by version | 10.3, 10.4, 10.6 | Create the parent, generate, download. Fallback: anonymous Apex `insert`/`update` of `LifeSciMobileMetadataRecord`, the generate endpoint from Workbench REST Explorer and the ContentVersion Files UI; if none is available, stop `BLOCKED: needs approval — REST access` |
| Creating `DbSchema_ProviderVisit` on an org that has none (10.1b absent case) | Not tested on an org with no `DbSchema_ProviderVisit` | 10.1b, 10.7a | Build it from the 10.1 template (`SObject` `ProviderVisit`, the `Visit` `WhereSoql`); 10.7a loading both forms proves it. Fallback: stop `BLOCKED` with the deploy result |
| Record-level Edit on the web routes to Log a Visit or Store Check | Needs a saved Visit; not checked in Act 9 | 12.11 | Open Edit on the saved Visit on web. Fallback: `PASSED_WITH_NOTES` if the human cannot run it |

**Proven (no longer open):** Settings deploys for Store Check, Group Membership and Quotes; the Visit-routing records for Store Check, In-Person and Remote (9.6, 9.7); the unlock route (Request for Unlock → In Review → Draft or Rejected) with both Approve and Reject; the unlock approval flow; the Last Order view (the card appears once a Submitted quote exists; prefill limits are K2, K21); all 22 indicators, the third Action Plan template, the full indicator tab rendering, `DataType` values beyond Boolean and Number, and the PTA/PTDA row counts.

## Cleanup and rollback

Several changes cannot be undone, and the agent states this before Act 1:
- Chatter and the Industries base settings (C1: once on, they are not turned off by this thread);
- State/Country picklists;
- Person Accounts;
- Multi-Currency;
- OM Turn On (it enables Revenue Cloud features and activates the Standard Price Book);
- installing the package itself (uninstall is possible only while no package data exists; only when this thread installed it).

| Artifact class | Rollback mechanism | Notes |
| :-- | :-- | :-- |
| Metadata deploys (layouts, record types, FlexiPages, permission sets, config records) | Retrieve the pre-change state before each deploy; redeploy the retrieved state, or run a destructive-changes deploy for new components | ⏸ STOP before any destructive deploy |
| Seed data (accounts, places, products, price books, assortment, definitions) | ⏸ STOP first: list the records and counts to delete and wait for the customer's yes; then delete in reverse dependency order with Composite `allOrNone` | Records referenced by Visits or Quotes cannot be deleted until those are deleted. No data delete without the STOP |
| Pricing procedure / context | Deactivate the version (`?action=deactivate`), never delete an active one; detach the context from the expression set before changing mappings | |
| Territory model | Archive the model (cannot be deleted while Active) | |
| Mobile metadata records | Records cannot be deleted; mark the stale pair Inactive and generate a new pair | Never use the metadata download action as a check (it creates links) |
| Permission set / PSL assignments (including the admin-only `<PFX>STT_Procedure_Link` set) | Remove only what this thread added, and only on request (`DELETE …/sobjects/PermissionSetAssignment/<Id>`; the permission set itself stays in place) | Removing a permission set can cascade-remove a dependent license assignment; check before removing |
| iPad data | 👤 HUMAN only, on request, after a ⏸ STOP: first confirm the last Sync completed (Profile → Begin Sync → Sync shows no pending changes); then the person holding the iPad logs out, which clears the local store. The agent never taps Log out (11.2, 14.5a) | Unsynced changes are lost |
| Sharing change (C13, 9.20a) | ⏸ STOP, then redeploy the retrieved `CustomObject` rollback copies kept at 9.20a | Internal sharing returns to Private for the three objects |
| Trigger handler (C8, 8.17) | ⏸ STOP, then Tooling `PATCH` `{"IsActive":false}` on `StagePathPermissionsHandler` (before-values in the manifest) | Org-wide; not in the Setup Audit Trail |
| Quote object, compact layout and overrides (8.9c), status values and Path (8.16a) | ⏸ STOP, then redeploy the rollback copies saved at 8.9c and 8.16 and reactivate the deactivated Path in Setup → Path Settings | 8.16a inactivated generic values and the Quote Path |
| Approval-flow and territory grants (8.10a assignment, 5.4a manager territory, 9.21 shares, 9.11a temporary permission set) | ⏸ STOP, then remove only what the manifest lists; delete any leftover 9.11a temporary set | Removing a permission set can cascade (see above) |
| Login Access Policies setting (C12) | At run close (15.7, or at any terminal state: `BLOCKED`, `FAILED` or stopped, before the final report), ask: `ORG_KIND = customer` → ask the customer whether to turn *Administrators Can Log in as Any User* off again in Setup → Login Access Policies (recommended: off); `ORG_KIND = test` → leave it on. It is an org security setting, so never change it without that answer | Record the final state in the manifest |

## Success criteria

- [ ] **"Passes" means** a step status `PASSED`, or `PASSED_WITH_NOTES` whose only deviations are `KNOWN_LIMITATION` outcomes; an admin-side substitution (Rep-session rule) is recorded as `PASSED` with the substitution listed. `BLOCKED` and `FAILED` are not passes.
- [ ] Every Act ends with a checkpoint report, and the run manifest shows every step `done`, `reused` or `gated`, with nothing left `pending`; each `gated` step is listed with its gate.
- [ ] Configuration verified, web: every postcondition in Acts 1–9 passes (as defined above).
- [ ] Configuration verified, iPad: Act 10 ZIP acceptance passes (non-empty pricing files, every DbSchema present), and the rep's first sync completes.
- [ ] Customer workflow verified, web: a Draft Quote with lines is priced (8.30–8.32 smoke test), and the Store Check Visit renders with its path.
- [ ] Customer workflow verified, iPad: SC1–SC14 and Q1–Q17 are accepted per the checklist, and Act 15 Last Order is accepted or gated. If gate G4 fired, iPad Quote creation is reported as `BLOCKED (G4)` and this item is not met; the steps run on the web-created Quote are reported separately.
- [ ] Every deviation that matches a Known limitations entry (K1–K29) is recorded as `PASSED_WITH_NOTES` with the tag `KNOWN_LIMITATION`, listed in the checkpoint report, and did not stop the run.
- [ ] Quote from visit: the Store Check Visit's Quoted Order tab lists the visit's quotes; New pre-fills Visit and Account for Quote; the saved quote has `Quote.VisitId` set (13.2–13.4). The rep does not see the Approval tab; the approver does.
- [ ] Pricing: the active `<PRICING_PROCEDURE>` version includes the header adjustment and the `ResetToListForOverride` step; a Total Price Override with Proportionate distribution lands exactly on the target in simulation, and the device `NetUnitPrice` values match the Act 7 simulation. The only accepted price-waterfall gap is K25.
- [ ] Each gate G1–G12 that fired is reported with its signature, with state preserved and no blind retries.
- [ ] Every runtime input was pre-filled, answered or explicitly accepted by the customer (the manifest records which), and was asked no later than its "Asked at" step; nothing was applied from the illustrative example.
- [ ] Every irreversible or hard-to-reverse action and every access grant (C1–C14: including the Act 1 org preferences, Account Plans, Enable Sales Territory, 8.9c, 8.15, 8.16a, 8.25, 9.21, 9.22a and G12) had customer consent: pre-consented at 0.11 with a passing precondition check recorded in the manifest, or a live ⏸ STOP confirmation. Every delete had a live ⏸ STOP.
- [ ] The customer received the build inventory of what was created, and the Gap journal.
- [ ] `run-learnings.jsonl` has a row for every step that was not a clean first-attempt pass, and one `act_summary` row per Act.
- [ ] Every branch taken is traceable to a runtime input, a recorded query or describe result, or a STOP outcome in the manifest.

## Gap journal

The runtime agent appends a row each time a gate fires or a new gap appears, in the same format. Where the owner column names a Salesforce team, the customer's action is a Salesforce Support case that quotes the row's signature. No step in this thread waits on that case.

| Phase | Category | Severity | Status | What broke / is missing | Signature / repro | Owner & next step |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| Act 1 | Platform limitation | High | Known limitation (`KNOWN_LIMITATION`, K9) — `PASSED_WITH_NOTES`, no stop | Document Management entities never materialize: the Life Sciences Cloud for Customer Engagement org permission they need cannot be turned on by a customer or an admin | The setting deploys cleanly; entity describe/SOQL shows the entities inaccessible | Package-owning team; permanent, not a configuration error |
| Act 1 | Sequencing | Low | Resolved | The admin PSL/PS ladder must precede the settings ladder; it runs as step 1.0 and Act 2 only confirms it | Observed | Thread author: none |
| Act 1 | Scope decision | Low | Resolved by design choice | 20 of the 28 "Verify & Enable Settings" preferences (medical insights, key account management, consent, next-best-X and others) are not enabled in Acts 0–3 | 28-row modal inventory | Out of scope for Store Check + Account-backed Quotes; revisit only if a later Act needs one |
| Act 3 | Platform defect (cosmetic) | Low | Open, no fix needed | The RSVP/`LifeScienceRSVP` Setup toggle can display "Off" while the service is enabled (K3) | `EmailServicesFunction`/`EmailServicesAddress` records show the active state | Verify by query; do not "fix" a display-only toggle |
| Act 4 | Security / access model | Medium | Accepted, not fixed | Quote-create access necessarily grants org-wide `AppUsageAssignment` Read (no row-level sharing on AUA) | Observed | Product/security owner; no server-side fix available at build time |
| Act 4 / 8 | Platform defect (cosmetic) | Low | Not remediated, non-blocking | The managed custom-metadata-type access row (`AdminConsoleMenuItem__mdt`) is owned only by the System Administrator profile layer and toasts for non-admin users (FP-8.25) | Toast "sObject type 'AdminConsoleMenuItem__mdt' is not supported..." | Do not grant custom-metadata-type access as a side effect of any Act 4, 5 or 8 fix |
| Act 5 | Open question | Low | Deferred to Act 9/12 | Whether `ObjectTerritory2Association`/`ProviderAcctTerritoryInfo` need explicit manual shares for the Field Rep was not proven for this object pair | UNVERIFIED items | Confirm at 5.7 and during Act 9/12; add manual shares only if a direct query shows `HasReadAccess=false` |
| Act 6 | Platform limitation | Low | Accepted | 7 residual items behind the 11 Turn On settings (K28) have no supported read-back API in this release (Transaction Processor/Draft Order Capture, Core CPQ App Usage Type, packaging-queue and upgrade-executor internals) | Observed | No owner action: a bounded, accepted gap; do not block the build |
| Act 7 | Pricing / mobile | Medium | Resolved | Mobile pricing fails: the client cannot handle the `CurrencyOutputRounding`/`RoundingValues` step type; including that step is the defect | Observed | No rounding step in any procedure version intended for mobile (FP-7.10) |
| Act 7 | Platform limitation | Low | Accepted | No true zero-persistence dry run exists for the pricing simulation call; `shouldSaveSimulationInput=false` suppresses only the obvious save | Observed | Treat every simulation as a bounded-risk execution |
| Act 7 | Known residual defect | Low | Accepted, not fixed | Discount steps emit zero-value waterfall trace elements on lines without that discount: numerically correct, trace-shape only | Observed | Re-flag only if a simulation shows a numeric mismatch |
| Act 8 | FLS / field-model mismatch | Low | Resolved by 8.13; device display is K20 | Address Information rendered empty while `BillingContactPointAddrId`/`ShippingContactPointAddrId` were FLS-hidden; 8.13 grants Edit on both. Still blank on the device is K20 (G7) | Observed | Quote FlexiPage/FLS owner: re-point the FlexiPage to the UI-API-advertised fields or expose the lookups via FLS |
| Act 8 → 13 | iOS client | High | Open | `Workflow_XIsLockedAndCannotBeCreated` blocks mobile New Quote Save: the client never seeds `Status` and the Readonly layout gives no UI path to backfill it (G4, FP-13.1) | Observed | Report to Salesforce Support (iPad client) |
| Act 8 → 13/14 | iOS client | Medium | Open | Submit is not idempotent: the Review screen stays open and re-submits; the server rejects it, with a generic retry message and no data corruption (G1, FP-14.3) | Observed | Report to Salesforce Support (iPad Review screen) |
| Act 8 → 14 | Platform / DocGen | High | Cause found: rep Create on `QuoteDocumentCreationEvent` (8.24a); open only if it recurs with 8.24a in place | The generated QuoteDocument/PDF can stay `Status=In Progress`, `ContentVersionDocumentId=null` (G2, K1) | Observed | Agent: rule out Session Security Level and "Query Non Vetoed Files" first (FP-14.4). Salesforce Support only if it recurs with 8.24a in place |
| Act 8 | Platform / core execution context | Low | Open, self-resolving | Reprice All intermittently fails with a `ComponentContext`-not-established error (G6); unrelated to org config | Observed | Pricing execution-context owner: establish context before the setup-metadata SOQL lookup |
| Act 8 → 10/13 | Platform / core i18n | Medium | Open | Raw i18n tokens render instead of section-header labels on mobile when Translation Workbench is off (G5, FP-13.4) | Observed | Platform i18n: fall back to the org default locale |
| Act 8 | Config / lifecycle | Medium | Closed (proven) | Request for Unlock → In Review → Draft (Approve) or Rejected (Reject): both proven end to end; In Review is a custom addition. Approve needs 8.21a (K24 otherwise) | Observed | Agent: run the single gated test (14.13–14.15, G10) and report the literal `Status`; Salesforce Support if the Automated Process failure recurs |
| Act 9 | Platform defect | High | Unresolved | Begin Visit does not work on web/desktop: the web Begin Visit component renders an empty template and never emits the completion event (FP-9.4) | Observed | No configuration fix; run Begin Visit on the iPad (Act 12) |
| Act 9 | Product defect | Medium | Unresolved | The Store Check Verified checkbox does not persist after Save & Close (no backing field is inferred; G8, K4); automated taps also fail to toggle it, a real touch works (FP-12.2) | Observed | Do not rely on the checkbox persisting; report to Salesforce Support if the customer requires it |
| Act 9 | Managed-package restriction | Low | Resolved via workaround | A managed app's own `<tabs>` list cannot be edited | Observed | Use `subscriberTabs` (9.10, FP-9.1); `userNavItems`/`/tabs` lag behind a just-deployed change, so verify in an authenticated browser session |
| Mobile generation | Defect | Medium | Open | The pricing ZIP serializes empty `{}` unless all four pricing selectors are set (FP-10.3) | Observed | Verify all four selectors at every generation |
| Mobile generation | Documentation gap | Low | Open | The `nav.json` standard-Quote tab is emergent (Profile tabVisibility plus schema inclusion), not a standalone component | Observed | Flag to docs owner |
| Device (iOS client) | Defect | Medium | Open, not fixable from this runbook | A false "offline" sync error on the first Visit-start upload (G9) | Observed | Report to Salesforce Support (iOS client) |
| Device (iOS client) | Defect | Medium | Fixed in a later app build | Reprice component-context error / stale subtotal (FP-13.2) | Observed | Confirm the fix is present at `<IPAD_APP_BUILD>` |
| Act 8–9 → 13 | Design gap | Medium | Closed | Two Quoted Order mechanisms were built because no source said which the release supports. The Quoted Order tab (layout `Quotes` related list) works; the 8.34 action does not show on the iPad (K13) | 13.2 render check and 13.4 `VisitId` | 9.5 layout carries `Quotes`; 13.2 defaults to `from_visit` |
| Act 4–5, 13 | Platform defect | High | Open (workaround: currency alignment) | Quote currency comes from the rep's personal currency, not the store Account's; mismatches hide products and price books on web and iPad (G12, FP-4.8) | Gate G12 | Report to Salesforce Support; keep rep, store and price book currencies equal |
| Act 14 | Configuration | High | Fixed by 8.24a; K1 only if it recurs with 8.24a and both FP-14.4 checks in place | Without 8.24a the rep cannot create `QuoteDocumentCreationEvent`, so the iPad Submit's publish fails and the `QuoteDocument` stays In Progress. With Read + Create on `<FIELD_REP_PS>` the rep's document completes with no admin action, and the Generate Quote Flow subscriber runs with no errors. An admin re-publishing the event once (only with the user's approval) completes the PDF. Rejected: a record-triggered flow or Apex trigger on `QuoteDocument`, a flow creating the event. No Apex workaround | 14.11–14.12; no event processing in the rep's sync log at Submit | Agent: check 8.24a first; Salesforce Support only if it recurs with 8.24a in place. G2; admin re-publish only with explicit user consent |
| Act 14 | Platform defect | Medium | Avoided by 8.21a; `KNOWN_LIMITATION` K24 only when 8.21a is missing | Approve branch: the notification subflow fails with UNKNOWN_EXCEPTION when it updates the Quote as the Automated Process user; a named admin (8.21a) avoids it | 14.15; orchestration error in Send Approval Notifications | Platform (approvals). Agent: do not move stuck quotes back without the user's explicit consent |
| Act 8 → 14 | Platform limitation | Low | Known limitation (`KNOWN_LIMITATION`, K23) — no stop | The Generate PDF stage action shows "Unknown component" on web; the action is shared web/iPad, so it is iPad-only | Web Quote page, Submitted stage actions | Report to Salesforce Support. Agent: do not use the action on web |
| Act 9 → 13 | Instruction gap | Medium | Fixed in this thread | The Visit Quoted Order tab was empty on the iPad: the Store Check Visit layout had no related lists, and the iPad builds them from the layout. `Quote.VisitId` is rejected as a layout token; `Quotes` is accepted | Device and web check after adding `Quotes` | 9.5 layout carries it; 9.9(c) checks it; FP-9.9 lists the ordered checks |
| Act 9–10 | Config gap, resolved | Medium | Resolved (9.26, 10.1a) | iPad photo save failed ("table Image has no column named offlinelastmodifieddate", then `contentdocumentlink`); a plain `ContentDocumentLink` schema breaks sync with `MALFORMED_QUERY` | iPad photo save error; sync error | Rep access to `Image` plus four photo DbSchemas with filters; file upload confirmed on the server |
| Act 8–10 | Config gap, resolved | Medium | Resolved (8.9, 9.24, 9.25, 10.8) | The quote line grid and iPad cart showed full related-list columns; Grand Total and the free-quantity column were missing; store accounts opened the HCP page ("No access to the following entities: healthcareprovider") | Quote page without `displayFields`; a FlexiPage deployed from a `sourceApiVersion` 64.0 project fails | `displayFields` with `sourceApiVersion` ≥ 65, rep FLS, Store Account page, cache regenerated after every FLS/page/config change |
| Act 14 | Platform / mobile product gap | Low | Known limitation (`KNOWN_LIMITATION`, K25) — `PASSED_WITH_NOTES`, no stop | The iPad price waterfall for lines priced on the server shows blank Amounts on percentage rows and no header-discount or override rows; lines priced on the iPad show them | Price waterfall on the iPad cart (13.10–13.14) | Report to Salesforce Support. Agent: reprice on the iPad or review totals on web |

## Appendix A — Step dependencies

Rows are in execution order; the step tables keep their numbers, so the run order differs from the numbering here: 4.9a runs as 6.5a; 4.9b and 4.9c run as 7.16a; 8.16 runs first in Act 8 and 8.13 inside the 8.1–8.9a bundle; 8.25 before 8.24; 8.34a after 9.5; 9.9d inside 9.11a; 13.13 before 13.11; 15.5 before 15.4; 6.5b runs after 8.30a, only when `SMOKE_AS_REP = no`. 

**Run-order options.** These reorder only what the rows below already allow; every step, STOP and consent still runs, and nothing needs concurrent execution. An agent that does not use them runs the listed order.

| Option | May run early or during a wait | Guard |
| :-- | :-- | :-- |
| O1 | The next Act's `N.in` questions, asked while the current Act runs (speed rule 6) | Written to the frozen inputs only when `N.in` runs; `N.in` still validates and re-asks a key whose recommendation changed |
| O2 | 8.30a–8.33a while the 8.24 Flow Builder recovery waits on a person; 9.17–9.20 after the 9.20a (C13) question is sent and before it is answered | The STOP stays open in the manifest; 8.30b does not deploy while the human is saving in Setup; 9.21–9.22 still wait for 9.20a |
| O3 | 11.1 (app install) and the build read of 11.in during Acts 8–10, while the device is idle | 11.2 login and 11.3 sync stay after 10.7 and the accepted Act 10 checkpoint; the early request says it is for Act 11 |

| Step | Depends on |
| :-- | :-- |
| 0.1 | nothing (first step) |
| 0.1a | 0.1 |
| 0.2 | 0.1a |
| 0.3 | 0.1a |
| 0.4 | 0.1a |
| 0.5 | 0.2 |
| 0.6 | 0.1a |
| 0.7 | 0.3 |
| 0.8 | 0.1a |
| 0.9 | 0.1a |
| 0.9a | 0.9 |
| 0.9b | 0.1a |
| 0.10 | 0.5 |
| 0.11 | 0.3, 0.5-0.10, 0.9a (baseline reads inform the questions) |
| 0.12 | 0.11 |
| 0.13 | 0.12 |
| 1.in | 0.12 |
| 1.0 | 1.in |
| 1.1 | 1.0, 0.5 (settings baseline) |
| 1.2 | 1.1 |
| 1.3 | 1.2 (base Industries flags on first) |
| 1.4 | 1.3 |
| 1.5 | 1.4 (Address model converted before the new record type is exercised) |
| 1.6 | 1.5 |
| 1.7 | 1.6 |
| 1.8 | 1.7 |
| 1.8a | 1.8 |
| 1.9 | 1.8 (Security Contact saved first, only if the field exists) |
| 1.10 | 1.9 |
| 1.11 | 1.10 |
| 1.12 | 1.11 |
| 1.13 | 1.2 |
| 1.14 | 1.2 |
| 1.15 | 1.2 |
| 1.16 | 1.2 |
| 1.17 | 1.2 |
| 1.18 | 1.2 |
| 1.18a | 1.2 |
| 1.19 | 1.0-1.18a |
| 2.in | 1.19 |
| 2.1 | 1.0 |
| 2.2 | 2.1 |
| 2.3 | 2.2 |
| 2.4 | 2.3 (reactive, per failed attempt) |
| 2.5 | 2.3 |
| 3.1 | 2.3 (package installed, or detected at 0.9 and `reused`) |
| 3.2 | 2.3 |
| 3.3 | 2.3 |
| 3.4 | 2.3 |
| 3.5 | 3.1 and 1.2 |
| 3.6 | 2.1 (standard admin permission set already assigned), 2.3 |
| 3.7 | 2.3 |
| 3.8 | 3.1-3.7 |
| 4.in | 3.8 |
| 4.1 | 2.3 (package installed, or detected at 0.9 and `reused`) |
| 4.2 | 4.1, 1.5 (`Account.Business_Account` exists) |
| 4.3 | 4.1 |
| 4.4 | 4.3 |
| 4.5 | 4.4 (permission set licence read-back confirmed Active) |
| 4.6 | 4.5 |
| 4.7 | 4.3 |
| 4.8 | 4.3, 0.11 (`MANAGER_USER`, store currencies) |
| 5.in | 4.8 |
| 5.1 | 1.13 (Enterprise Territory Management enabled) |
| 5.2 | 5.1 |
| 5.3 | 5.2 |
| 5.4 | 5.3, 4.3 (`<FIELD_REP_USER>` exists) |
| 5.4a | 5.4, 0.11 (`MANAGER_USER`), 4.8 |
| 5.5 | 1.5, 4.3 |
| 5.6 | 5.1, 5.5 |
| 5.7 | 5.6 |
| 5.8 | 5.6, 4.8 |
| 6.1 | 2.3, 1.0 (admin access) |
| 6.2 | 6.1 |
| 6.3 | 6.2 |
| 6.4 | 6.3 (C7 answered at 0.11, or the live stop) |
| 6.5 | 6.4 |
| 6.5a | 6.5 |
| 4.9a | 6.5 (Order Management Turn On complete; runs from 6.5a) |
| 6.5b | 6.5, 8.30a (runs after 8.30a, only when `SMOKE_AS_REP = no`) |
| 6.6 | 6.5 (Order Management on, Context Service enabled) |
| 6.7 | 6.6 (definition created, inactive) |
| 6.8 | 6.7 (sole default mapping set) |
| 6.9 | 6.8, platform-shipped `Price_Book_Entry_Decision_Table_v2` existing |
| 7.in | 6.9 |
| 7.1 | 5.3 (territory model active), 6.5 |
| 7.2 | 7.1 |
| 7.3 | 7.1 |
| 7.4 | 7.3 |
| 7.5 | 7.2, 7.3 |
| 7.6 | 6.5 (Standard Price Book active), 7.3, 7.4 |
| 7.7 | 7.1-7.6, 5.3 (products and active territory model) |
| 7.8 | 7.1, 7.7, 4.3 |
| 7.9 | not applicable |
| 7.10 | 7.3, 7.4, 7.6 (Product2, selling model, Pricebook2 exist first) |
| 7.10a | 7.10 |
| 7.11 | 7.10a (all tiers present and dated before activation) |
| 7.12 | 7.11 |
| 7.12a | 7.12, 6.9 |
| 7.13 | 6.9 (recipe and `ListPrice` table mapping), 7.10a, 7.11 (schedule IDs embedded as constants) |
| 7.14 | 7.13 (version exists, inactive), 7.12a |
| 7.15 | 7.14 passing (set the Rank before activation; activate the new version and read it back before deactivating an older one) |
| 7.16 | 7.15 |
| 7.16a | 7.16 (the slot in which 4.9b and 4.9c run; they are not prerequisites of it) |
| 4.9b | 7.16 (Sales Transaction Type exists; runs as 7.16a) |
| 4.9c | 4.9b (re-run the 4.6 checks) |
| 7.17 | 7.15 (active version selectable) |
| 7.17b | 0.5 (baseline); before the Act 10 generation |
| 7.17c | only after a 7.18 Save As failure (FP-7.16); before the 7.18 redo |
| 7.17a | 7.16, 7.17 (verify; repair only if the link is empty) |
| 7.18 | 7.1 |
| 7.19 | 7.18 |
| 7.20 | 7.12, 7.15-7.17 (full chain wired) |
| 8.in | 7.20, 7.17 |
| 8.16 | 8.in (value set only) |
| 8.1 | 4.1, 6.5, 8.16 |
| 8.2 | 8.1 |
| 8.2a | 8.2 (same layout deploy; cosmetic) |
| 8.3 | 8.1, 8.2, 4.1 |
| 8.4 | 8.3, 4.2 |
| 8.5 | 2.3 (`lifeSciencesCommercial` app installed) |
| 8.6 | 8.5 |
| 8.7 | 8.1-8.6 |
| 8.8 | 8.7 |
| 8.9 | 8.8 (API version 65 or higher for `displayFields`) |
| 8.9a | 8.9 |
| 8.13 | 8.1-8.3 (deployed in the 8.1-8.9a bundle; read back before 8.17) |
| 8.9b | 8.9a |
| 8.9c | 8.9b |
| 8.10 | 7.17 (`<PRICING_PROCEDURE>` org default); runtime needs 9.12 `<ASSORTMENT>`/`<PRIORITY_PRODUCTS>` |
| 8.10a | 8.10 (always run) |
| 8.10b | 8.10, 7.17 |
| 8.11 | 7.16, 7.16a |
| 8.11a | 8.11, 7.16 (the link permission set) |
| 8.12 | 2.3, 4.5 |
| 8.14 | 8.11, 8.11a, 7.15, 7.16 (admin can read the mobile TPT) |
| 8.15 | 8.12 |
| 8.16a | 8.16, 8.1, 8.13, 8.9b (the rep render is checked at 8.30) |
| 8.17 | 8.13 (FLS), 8.16 (values), 8.9 (Stage Path container) |
| 8.18 | 8.17 |
| 8.19 | 8.18 |
| 8.20 | 8.19 |
| 8.21 | 8.20 |
| 8.21a | 8.21, 5.4a |
| 8.21b | 8.21a |
| 8.21c | 8.21b, 5.4a |
| 8.22 | 8.16 |
| 8.23 | 8.22 |
| 8.25 | 8.23 (run before 8.24) |
| 8.24 | 8.25 |
| 8.24a | 4.1 (`<FIELD_REP_PS>` exists); before 14.7 |
| 8.26 | 8.24 |
| 8.27 | 8.26, 8.24 |
| 8.28 | 8.23 |
| 8.29 | 8.23, 8.22, 8.28 |
| 8.30a | 8.1-8.19 (asked just in time; non-blocking) |
| 8.30b | 8.1 (`Quote_Record_Type` exists), 6.5b (when it ran); retrieve the admin profile first and add one entry |
| 8.30 | 8.30a, 8.30b, 8.1-8.19 (not 8.22-8.29; O2) |
| 8.31 | 8.30, 8.9b (record page assignment), 8.10 |
| 8.32 | 8.31 |
| 8.33 | 8.32, 8.8, 7.18, 7.19 |
| 8.33a | 8.33 |
| 8.34 | 8.10 (packaging rule), 8.13 (`VisitId` FLS) |
| 9.in | 8.34 |
| 9.1 | 5.5 (Business Account record-type visibility pattern) |
| 9.2 | 9.1 (only if 9.1 found a legacy override) |
| 9.3 | 3.1 |
| 9.4 | 9.1 |
| 9.4a | 9.4 |
| 9.4b | 9.4 |
| 9.5 | 3.5 (`enableLifeSciRecTypeRoutgPref` true), 9.4a, 9.4b |
| 8.34a | 9.5 (`Store_Check` record type exists) |
| 9.5a | 9.5 |
| 9.6 | 9.5 |
| 9.7 | 9.5 |
| 9.8 | 4.1, 9.5 |
| 9.8b | 9.4b, 9.5; retrieve the admin profile first and add the three entries |
| 9.9 | 9.5 (`Store_Visit` and Store Check layout exist), 8.13 |
| 9.10 | 4.1, 9.5 |
| 9.11 | 9.5 |
| 9.11a | 9.11 (contains 9.9d) |
| 9.9d | 9.9, 9.11a steps (1)–(3); runs as sub-step (3b) of 9.11a |
| 9.12 | 5.6, 7.3, 7.5 |
| 9.13 | 9.3 |
| 9.14 | 9.13 |
| 9.15 | 9.13 |
| 9.16 | 9.13 |
| 9.17 | 9.14-9.16 |
| 9.18 | 9.13-9.16 |
| 9.19 | 9.14-9.16 (indicators exist), 9.12 |
| 9.20 | 9.12, 9.13, 9.18 |
| 9.20a | 9.13-9.16 (objects available); C13 (live stop unless pre-consented on a `test` org); answered before 9.21 and 9.22 |
| 9.21 | 9.12-9.20, 9.20a (decides whether the task-definition share rows are needed) |
| 9.22 | 5.3, 9.12, 9.20a (decides whether the PTA share is needed) |
| 9.22a | 9.5 |
| 9.23 | 9.5-9.11a |
| 9.24 | 4.1, 6.4 (Quote objects enabled) |
| 9.25 | 1.5, 4.1, 8.5 (retrieve the app with its current tabs; merge, do not overwrite) |
| 9.26 | 4.1 |
| 10.0a | Acts 1-9 configuration deployed (the target record names are known) |
| 10.1 | 10.0a; Acts 1-9 configuration deployed (catalog, pricing, Store Check fixture, Quote web configuration) |
| 10.1a | 10.1, 9.26 (`Image` access) |
| 10.1b | 10.1 |
| 10.1c | 10.1, 10.1a, 10.1b, 9.8b; before 10.3 |
| 10.1d | before 10.3 |
| 10.2 | 10.1, 10.1a, 10.1b |
| 10.3 | 10.2 (bundle fully deployed before any pair is created) |
| 10.4 | 10.3 |
| 10.5 | 10.4 |
| 10.6 | 10.5 |
| 10.7 | 10.6, 7.17, 8.10, 8.10b, 8.14 |
| 10.7a | 10.7, 10.1b, 9.23 |
| 10.8 | 10.7 (standing step for every later change) |
| 11.in | 10.7 (the `IPAD_APP_BUILD` read may run earlier; O3) |
| 11.1 | 11.in (may run during Acts 8-10; O3) |
| 11.1a | 9.21, 4.3 |
| 11.2 | 11.1, 11.1a, 4.3, 10.7 |
| 11.3 | 11.2 |
| 11.4 | 11.3, 10.5 (Active mobile metadata pair) |
| 11.5 | 11.4 |
| 11.6 | 11.1, 2.3 |
| 12.1 | 11.5 |
| 12.2 | 12.1, 9.8 |
| 12.3 | 12.2 |
| 12.4 | 12.3 |
| 12.5 | 12.4 |
| 12.6 | 12.5 |
| 12.7 | 12.6 |
| 12.8 | 12.7, 9.12-9.19 |
| 12.9 | 12.8 |
| 12.10 | 12.9 |
| 12.11 | 12.10 |
| 12.12 | 12.11 |
| 12.13 | merged into 12.12 |
| 12.14 | 12.12, 9.20 |
| 12.15 | 12.14 |
| 12.16 | 12.15 |
| 13.in | 12.16 |
| 13.0a | 13.in, 7.10a |
| 13.1 | 13.0a, 11.5 |
| 13.2 | 13.1, 9.5 (`Quotes` related list), 9.9, 12.16 (the Act 12 Visit) |
| 13.3 | 13.2 |
| 13.4 | 13.3 |
| 13.5 | 13.4 |
| 13.6 | 13.5, 10.1 (Pricebook2 and PricebookEntry schemas) |
| 13.7 | 13.6 |
| 13.8 | 13.7 |
| 13.8a | 13.8 |
| 13.9 | 13.8a |
| 13.10 | 13.9, 7.14 |
| 13.12 | 13.10 |
| 13.12a | 13.12, 7.17b, 10.3 |
| 13.13 | 13.12 |
| 13.11 | 13.13 (run after the 13.13 Save) |
| 13.13a | 13.11 |
| 13.14 | 13.13a, 7.14 |
| 14.1 | 8.13 (`Quote.Status` FLS), 13.13a |
| 14.2 | 8.17 (`StagePathPermissionsHandler` active) |
| 14.2a | 13.in (`TEST_UNLOCK_ROUTE`), 8.21b, 8.21c (only if `TEST_UNLOCK_ROUTE = yes`) |
| 14.3 | 13.14 (Checkpoint 13 quote reconciled), 14.1, 14.2, 14.6 |
| 14.4 | 14.3, 8.28 |
| 14.5 | 14.4, 8.26, 8.27 |
| 14.5a | 14.5 |
| 14.6 | 13.14, 14.1, 14.2 (runs before 14.3) |
| 14.7 | 14.5a, 14.6 |
| 14.8 | 14.7 |
| 14.9 | 14.8 |
| 14.10 | 14.8 |
| 14.11 | 14.8, 14.10, 8.23-8.27 (DocGen build-out, Document Builder entitlement) |
| 14.12 | 14.10, 14.11 (the Generate PDF tap produces the file) |
| 14.13 | 14.12, 14.2a |
| 14.14 | 14.13, 8.21a-8.21c |
| 14.15 | 14.14 |
| 15.0 | 14.12; 14.15 too when `TEST_UNLOCK_ROUTE = yes` (the unlock branch changes the quote status) |
| 15.1 | 15.0 |
| 15.2 | 15.1, 15.0 (source quote at `<LAST_ORDER_STATUS>`), 8.10 (`ProductsFromPreviousOrder` view) |
| 15.3 | 15.2 |
| 15.5 | 15.3 |
| 15.4 | 15.5 |
| 15.6 | 15.4 |
| 15.7 | 15.6 |

## Appendix B — Act 8 asset files

The six metadata files Act 8 deploys. They are copies of platform templates that cannot be retrieved or cloned by API, so they ship inside this runbook. **Do not deploy them unchanged** and do not retype them: extract them with the script below, then apply the substitution in the table to the deploy copy.

| File | Step | Before deploying |
| :-- | :-- | :-- |
| `LSC_Quote_Lock_and_Unlock_Approval_Process.flow-meta.xml` | 8.21a | Replace every `<NOTIFY_ADMIN_USER>` (3 places) with the chosen admin username. The deploy copy must contain no `<NOTIFY_ADMIN_USER>` text |
| `LSC_Quote_Notifications_for_Lock_and_Unlock.flow-meta.xml` | 8.21a | None |
| `LSC_Quote_Set_Status_In_Review.flow-meta.xml` | 8.21a | None |
| `Notification_when_Quote_is_locked_and_Unlocked.notiftype-meta.xml` | 8.21a | None |
| `lsc4ce_Quote_Document.flexipage-meta.xml` | 8.23 | Deploy only after the 8.22 signature type value exists |
| `Generate_Quote_Flow.flow-meta.xml` | 8.24 | None (same flow logic as the inline copy in 8.24; the asset adds element descriptions and layout coordinates). After the deploy, read back the Flow version `Status`: it must be `Draft`, not `InvalidDraft` |

All flows are `Draft`; 8.21b and 8.24 activate them. The approver is resolved from the quote owner's manager, so no other username is needed.

**Extraction script.** Save this block as `<run>/artifacts/a08-extract.py` and run `python3 <run>/artifacts/a08-extract.py "<thread file>" <run>/artifacts/a08`. It finds each `<!-- asset: … -->` marker, writes the XML block that follows it, and checks the SHA-256. Expected output: `extracted 6 files`. Any other result is `ASSETS_MISSING` (Act 8 pre-check).

```python
import hashlib, pathlib, re, sys
thread, out = sys.argv[1], pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
lines = open(thread, encoding="utf-8").read().split("\n")
pat = re.compile(r"^<!-- asset: (\S+) sha256=([0-9a-f]{64}) -->$"); n = 0
for i, l in enumerate(lines):
    m = pat.match(l)
    if not m: continue
    if lines[i + 1] != "```xml": sys.exit(f"ASSETS_MISSING: no xml block after {m[1]}")
    j = lines.index("```", i + 2)
    data = ("\n".join(lines[i + 2:j]) + "\n").encode("utf-8")
    if hashlib.sha256(data).hexdigest() != m[2]: sys.exit(f"ASSETS_MISSING: checksum mismatch {m[1]}")
    (out / m[1]).write_bytes(data); n += 1
if n != 6: sys.exit(f"ASSETS_MISSING: found {n} of 6")
print(f"extracted {n} files to {out}")
```

### LSC_Quote_Lock_and_Unlock_Approval_Process.flow-meta.xml

<!-- asset: LSC_Quote_Lock_and_Unlock_Approval_Process.flow-meta.xml sha256=88e6de99b84e60eea77e5f5422425e980ce061181b5c988cd886d62fb92caab5 -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <apiVersion>62.0</apiVersion>
    <areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
    <decisions>
        <description>Quote is Approved or Rejected for Unlock</description>
        <name>Quote_Approved_or_Rejected_for_Unlock</name>
        <label>Quote Approved or Rejected for Unlock?</label>
        <locationX>314</locationX>
        <locationY>503</locationY>
        <defaultConnectorLabel>Default Outcome</defaultConnectorLabel>
        <rules>
            <name>is_Quote_Approved_for_Unlock_by_Approver</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>Pending_for_Manager_Approval_for_Unlock.Outputs.approvalDecision</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Approve</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Send_Approval_Notifications</targetReference>
            </connector>
            <label>is Quote Approved for Unlock by Approver</label>
        </rules>
        <rules>
            <name>is_Quote_Rejected_for_Unlock_by_Approver</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>Pending_for_Manager_Approval_for_Unlock.Outputs.approvalDecision</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Reject</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Send_Rejection_Notification</targetReference>
            </connector>
            <label>is Quote Rejected for Unlock by Approver</label>
        </rules>
    </decisions>
    <decisions>
        <description>Determines whether to trigger the unlock approval process or send a lock notification, based on the quote status</description>
        <name>Route_Lock_or_Unlock_Path</name>
        <label>Route Lock or Unlock Path</label>
        <locationX>710</locationX>
        <locationY>287</locationY>
        <defaultConnectorLabel>Default Outcome</defaultConnectorLabel>
        <rules>
            <name>Is_Quote_Submitted_for_Unlock_and_Approval</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>$Record.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Request for Unlock</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Send_for_Manager_approval</targetReference>
            </connector>
            <label>Is Quote Submitted for Unlock and Approval?</label>
        </rules>
        <rules>
            <name>Is_Quote_Submitted_for_Lock</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>$Record.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Submitted</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Send_Notifications_When_Quote_is_Locked_Stage</targetReference>
            </connector>
            <label>Is Quote Submitted for Lock?</label>
        </rules>
    </decisions>
    <description>Unlocks locked quotes via the approval process for LSC, including notifications to the quote owner and approver.</description>
    <environments>Default</environments>
    <formulas>
        <name>approver</name>
        <dataType>String</dataType>
        <expression>{!$Record.Owner:User.Manager.Username}</expression>
    </formulas>
    <interviewLabel>LSC Quote Lock and Unlock Approval Process {!$Flow.CurrentDateTime}</interviewLabel>
    <label>LSC Quote Lock and Unlock Approval Process</label>
    <orchestratedStages>
        <name>Send_Approval_Notifications</name>
        <label>Send Approval Notifications</label>
        <locationX>50</locationX>
        <locationY>611</locationY>
        <exitConditionLogic>and</exitConditionLogic>
        <stageSteps>
            <description>Notifications will be sent to the quote owner when Quote is approved by Approver for Unlock</description>
            <name>Send_Approved_Notifications</name>
            <actionName>LSC_Quote_Notifications_for_Lock_and_Unlock</actionName>
            <actionType>stepBackground</actionType>
            <assignees>
                <assignee>
                    <stringValue><NOTIFY_ADMIN_USER></stringValue>
                </assignee>
                <assigneeType>User</assigneeType>
            </assignees>
            <canAssigneeEdit>false</canAssigneeEdit>
            <debugSimulateStep>false</debugSimulateStep>
            <entryConditionLogic>and</entryConditionLogic>
            <exitConditionLogic>and</exitConditionLogic>
            <inputParameters>
                <name>ApprovalDecision</name>
                <value>
                    <elementReference>Pending_for_Manager_Approval_for_Unlock.Outputs.approvalDecision</elementReference>
                </value>
            </inputParameters>
            <inputParameters>
                <name>QuoteApprovedorRejectedReason</name>
                <value>
                    <elementReference>Pending_for_Manager_Approval_for_Unlock.Outputs.approvalComments</elementReference>
                </value>
            </inputParameters>
            <inputParameters>
                <name>QuoteId</name>
                <value>
                    <elementReference>$Record.Id</elementReference>
                </value>
            </inputParameters>
            <label>Send Approved Notifications</label>
            <requiresAsyncProcessing>false</requiresAsyncProcessing>
            <runAsUser>true</runAsUser>
            <shouldLock>false</shouldLock>
            <stepSubtype>BackgroundStep</stepSubtype>
        </stageSteps>
    </orchestratedStages>
    <orchestratedStages>
        <description>Quote will send to the Manager Approval for Unlock</description>
        <name>Send_for_Manager_approval</name>
        <label>Send for Manager approval</label>
        <locationX>314</locationX>
        <locationY>395</locationY>
        <connector>
            <targetReference>Quote_Approved_or_Rejected_for_Unlock</targetReference>
        </connector>
        <exitConditionLogic>and</exitConditionLogic>
        <stageSteps>
            <description>Approval Process for Manager Approval for Quote Unlock</description>
            <name>Pending_for_Manager_Approval_for_Unlock</name>
            <actionName>standard_approvals__EvaluateApproval</actionName>
            <actionType>stepApproval</actionType>
            <assignees>
                <assignee>
                    <elementReference>approver</elementReference>
                </assignee>
                <assigneeType>Resource</assigneeType>
            </assignees>
            <canAssigneeEdit>false</canAssigneeEdit>
            <debugSimulateStep>false</debugSimulateStep>
            <entryConditionLogic>and</entryConditionLogic>
            <exitConditionLogic>and</exitConditionLogic>
            <inputParameters>
                <name>ActionInput__RecordId</name>
                <value>
                    <elementReference>$Record.Id</elementReference>
                </value>
            </inputParameters>
            <label>Pending for Manager Approval for Unlock</label>
            <outputConfigParams>
                <name>approvalComments</name>
                <value xsi:nil="true"/>
            </outputConfigParams>
            <outputConfigParams>
                <name>approvalDecision</name>
                <value xsi:nil="true"/>
            </outputConfigParams>
            <requiresAsyncProcessing>false</requiresAsyncProcessing>
            <runAsUser>false</runAsUser>
            <shouldLock>false</shouldLock>
            <stepSubtype>ApprovalStep</stepSubtype>
        </stageSteps>
        <stageSteps>
            <description>Notifications will be sent to the quote owner and approver about the approval Submission.</description>
            <name>Send_Notifications</name>
            <actionName>LSC_Quote_Notifications_for_Lock_and_Unlock</actionName>
            <actionType>stepBackground</actionType>
            <assignees>
                <assignee>
                    <stringValue><NOTIFY_ADMIN_USER></stringValue>
                </assignee>
                <assigneeType>User</assigneeType>
            </assignees>
            <canAssigneeEdit>false</canAssigneeEdit>
            <debugSimulateStep>false</debugSimulateStep>
            <entryConditionLogic>and</entryConditionLogic>
            <exitConditionLogic>and</exitConditionLogic>
            <inputParameters>
                <name>QuoteId</name>
                <value>
                    <elementReference>$Record.Id</elementReference>
                </value>
            </inputParameters>
            <label>Send Notifications</label>
            <requiresAsyncProcessing>false</requiresAsyncProcessing>
            <runAsUser>true</runAsUser>
            <shouldLock>false</shouldLock>
            <stepSubtype>BackgroundStep</stepSubtype>
        </stageSteps>
        <stageSteps>
            <description>Sets the quote status to In Review after the unlock-request notification has been sent (Steel Thread 8.21, custom In Review stage).</description>
            <name>Set_Status_In_Review</name>
            <actionName>LSC_Quote_Set_Status_In_Review</actionName>
            <actionType>stepBackground</actionType>
            <canAssigneeEdit>false</canAssigneeEdit>
            <debugSimulateStep>false</debugSimulateStep>
            <entryConditionLogic>and</entryConditionLogic>
            <entryConditions>
                <leftValueReference>Send_Notifications.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Completed</stringValue>
                </rightValue>
            </entryConditions>
            <exitConditionLogic>and</exitConditionLogic>
            <inputParameters>
                <name>QuoteId</name>
                <value>
                    <elementReference>$Record.Id</elementReference>
                </value>
            </inputParameters>
            <label>Set Status In Review</label>
            <requiresAsyncProcessing>false</requiresAsyncProcessing>
            <runAsUser>false</runAsUser>
            <shouldLock>false</shouldLock>
            <stepSubtype>BackgroundStep</stepSubtype>
        </stageSteps>
    </orchestratedStages>
    <orchestratedStages>
        <description>Notifications will be sent to the quote owner When Quote Locked</description>
        <name>Send_Notifications_When_Quote_is_Locked_Stage</name>
        <label>Send Notifications When Quote is Locked Stage</label>
        <locationX>842</locationX>
        <locationY>395</locationY>
        <exitConditionLogic>and</exitConditionLogic>
        <stageSteps>
            <description>Notifications will be sent to the quote owner When Quote Locked</description>
            <name>Send_Notifications_When_Quote_is_Locked</name>
            <actionName>LSC_Quote_Notifications_for_Lock_and_Unlock</actionName>
            <actionType>stepBackground</actionType>
            <canAssigneeEdit>false</canAssigneeEdit>
            <debugSimulateStep>false</debugSimulateStep>
            <entryConditionLogic>and</entryConditionLogic>
            <exitConditionLogic>and</exitConditionLogic>
            <inputParameters>
                <name>QuoteId</name>
                <value>
                    <elementReference>$Record.Id</elementReference>
                </value>
            </inputParameters>
            <label>Send Notifications When Quote is Locked</label>
            <requiresAsyncProcessing>false</requiresAsyncProcessing>
            <runAsUser>false</runAsUser>
            <shouldLock>false</shouldLock>
            <stepSubtype>BackgroundStep</stepSubtype>
        </stageSteps>
    </orchestratedStages>
    <orchestratedStages>
        <name>Send_Rejection_Notification</name>
        <label>Send Rejection Notification</label>
        <locationX>314</locationX>
        <locationY>611</locationY>
        <exitConditionLogic>and</exitConditionLogic>
        <stageSteps>
            <description>Notifications will be sent to the quote owner when Quote is rejected by Approver for Unlock</description>
            <name>Send_Rejected_Notifications</name>
            <actionName>LSC_Quote_Notifications_for_Lock_and_Unlock</actionName>
            <actionType>stepBackground</actionType>
            <assignees>
                <assignee>
                    <stringValue><NOTIFY_ADMIN_USER></stringValue>
                </assignee>
                <assigneeType>User</assigneeType>
            </assignees>
            <canAssigneeEdit>false</canAssigneeEdit>
            <debugSimulateStep>false</debugSimulateStep>
            <entryConditionLogic>and</entryConditionLogic>
            <exitConditionLogic>and</exitConditionLogic>
            <inputParameters>
                <name>ApprovalDecision</name>
                <value>
                    <elementReference>Pending_for_Manager_Approval_for_Unlock.Outputs.approvalDecision</elementReference>
                </value>
            </inputParameters>
            <inputParameters>
                <name>QuoteApprovedorRejectedReason</name>
                <value>
                    <elementReference>Pending_for_Manager_Approval_for_Unlock.Outputs.approvalComments</elementReference>
                </value>
            </inputParameters>
            <inputParameters>
                <name>QuoteId</name>
                <value>
                    <elementReference>$Record.Id</elementReference>
                </value>
            </inputParameters>
            <label>Send Rejected Notifications</label>
            <requiresAsyncProcessing>false</requiresAsyncProcessing>
            <runAsUser>true</runAsUser>
            <shouldLock>false</shouldLock>
            <stepSubtype>BackgroundStep</stepSubtype>
        </stageSteps>
    </orchestratedStages>
    <processMetadataValues>
        <name>BuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>OriginBuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processType>ApprovalWorkflow</processType>
    <runInMode>SystemModeWithoutSharing</runInMode>
    <start>
        <locationX>584</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Route_Lock_or_Unlock_Path</targetReference>
        </connector>
        <filterFormula>ISCHANGED({!$Record.Status}) || ISNEW()</filterFormula>
        <object>Quote</object>
        <recordTriggerType>CreateAndUpdate</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Draft</status>
</Flow>
```

### LSC_Quote_Notifications_for_Lock_and_Unlock.flow-meta.xml

<!-- asset: LSC_Quote_Notifications_for_Lock_and_Unlock.flow-meta.xml sha256=44f4e1504166cc726cb42363d9f1edb83969f635e567e2e0b1bace471757fc5a -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <description>Sends a custom web notification to the Approver when the quote is submitted for the &quot;Unlock&quot; via Approval Process</description>
        <name>Notify_Approver_via_Custom_Notification_When_Quote_is_Submitted_for_Unlock</name>
        <label>Notify Approver via Custom Notification When Quote is Submitted for Unlock</label>
        <locationX>842</locationX>
        <locationY>890</locationY>
        <actionName>customNotificationAction</actionName>
        <actionType>customNotificationAction</actionType>
        <connector>
            <targetReference>Send_Email_Notification_to_Approver_When_Quote_is_submitted_for_Unlock</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>customNotifTypeId</name>
            <value>
                <elementReference>get_custom_Notification.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>recipientIds</name>
            <value>
                <elementReference>approversToReceiveNotifications</elementReference>
            </value>
        </inputParameters>
        <inputParameters>
            <name>title</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>Hi, {!getQuotes.Owner:User.Manager.LastName},</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>body</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>You have an approval request for quote {!getQuotes.Name}. Open the record and approve or reject it from the Work Guide.</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>targetId</name>
            <value>
                <elementReference>getQuotes.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>customNotificationAction</nameSegment>
        <offset>0</offset>
    </actionCalls>
    <actionCalls>
        <description>Sends a custom web notification to the quote owner when the quote is approved by the Approver for Unlock</description>
        <name>Notify_Quote_Owner_via_Custom_Notification_Alert_When_Quote_is_Approved</name>
        <label>Notify Quote Owner via Custom Notification Alert When Quote is Approved</label>
        <locationX>314</locationX>
        <locationY>890</locationY>
        <actionName>customNotificationAction</actionName>
        <actionType>customNotificationAction</actionType>
        <connector>
            <targetReference>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Approved</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>customNotifTypeId</name>
            <value>
                <elementReference>get_custom_Notification.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>recipientIds</name>
            <value>
                <elementReference>ownersToReceiveNotifications</elementReference>
            </value>
        </inputParameters>
        <inputParameters>
            <name>title</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Hi {!getQuotes.Owner:User.LastName}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>body</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>  Your quote {!getQuotes.Name} has been approved by {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.      Approver note: {!QuoteApprovedorRejectedReason}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>targetId</name>
            <value>
                <elementReference>getQuotes.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>customNotificationAction</nameSegment>
        <offset>0</offset>
    </actionCalls>
    <actionCalls>
        <description>Sends a custom web notification to the quote owner when the quote is locked.</description>
        <name>Notify_Quote_Owner_via_Custom_Notification_Alert_When_Quote_is_Locked</name>
        <label>Notify Quote Owner via Custom Notification Alert When Quote is Locked</label>
        <locationX>50</locationX>
        <locationY>782</locationY>
        <actionName>customNotificationAction</actionName>
        <actionType>customNotificationAction</actionType>
        <connector>
            <targetReference>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Locked</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>customNotifTypeId</name>
            <value>
                <elementReference>get_custom_Notification.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>recipientIds</name>
            <value>
                <elementReference>ownersToReceiveNotifications</elementReference>
            </value>
        </inputParameters>
        <inputParameters>
            <name>title</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>Hi {!getQuotes.Owner:User.LastName}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>body</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>The submitted quote {!getQuotes.Name} is currently locked and cannot be edited. To unlock it, click &quot;Request for Unlock&quot;.</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>targetId</name>
            <value>
                <elementReference>getQuotes.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>customNotificationAction</nameSegment>
        <offset>0</offset>
    </actionCalls>
    <actionCalls>
        <description>Sends a custom web notification to the quote owner when the quote is rejected by the Approver for Unlock</description>
        <name>Notify_Quote_Owner_via_Custom_Notification_Alert_When_Quote_Is_Rejected</name>
        <label>Notify Quote Owner via Custom Notification Alert When Quote Is Rejected</label>
        <locationX>578</locationX>
        <locationY>890</locationY>
        <actionName>customNotificationAction</actionName>
        <actionType>customNotificationAction</actionType>
        <connector>
            <targetReference>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Rejected</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>customNotifTypeId</name>
            <value>
                <elementReference>get_custom_Notification.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>recipientIds</name>
            <value>
                <elementReference>ownersToReceiveNotifications</elementReference>
            </value>
        </inputParameters>
        <inputParameters>
            <name>title</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Hi {!getQuotes.Owner:User.LastName}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>body</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Your quote {!getQuotes.Name} has been rejected by {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.  Reason: {!QuoteApprovedorRejectedReason}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>targetId</name>
            <value>
                <elementReference>getQuotes.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>customNotificationAction</nameSegment>
        <offset>0</offset>
    </actionCalls>
    <actionCalls>
        <description>Sends a custom web notification to the quote owner when the quote is submitted for &quot;Unlock&quot; Approval Process</description>
        <name>Notify_Quote_Owner_via_Custom_Notification_When_Quote_Is_Submitted_for_Unlock</name>
        <label>Notify Quote Owner via Custom Notification When Quote Is Submitted for Unlock</label>
        <locationX>842</locationX>
        <locationY>782</locationY>
        <actionName>customNotificationAction</actionName>
        <actionType>customNotificationAction</actionType>
        <connector>
            <targetReference>Notify_Approver_via_Custom_Notification_When_Quote_is_Submitted_for_Unlock</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>customNotifTypeId</name>
            <value>
                <elementReference>get_custom_Notification.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>recipientIds</name>
            <value>
                <elementReference>ownersToReceiveNotifications</elementReference>
            </value>
        </inputParameters>
        <inputParameters>
            <name>title</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>Hi {!getQuotes.Owner:User.LastName}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>body</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>You have submitted quote {!getQuotes.Name} for approval. It is now pending with {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>targetId</name>
            <value>
                <elementReference>getQuotes.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>customNotificationAction</nameSegment>
        <offset>0</offset>
    </actionCalls>
    <actionCalls>
        <description>Sends an approval email notification to the Approver when the quote is submitted for Unlock via Approval process.</description>
        <name>Send_Email_Notification_to_Approver_When_Quote_is_submitted_for_Unlock</name>
        <label>Send Email Notification to Approver When Quote is submitted for Unlock</label>
        <locationX>842</locationX>
        <locationY>998</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <connector>
            <targetReference>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Submitted_for_Unlock</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recipientAddresses</name>
            <value>
                <collectionElements>
                    <elementReference>approverEmailAddresses</elementReference>
                </collectionElements>
            </value>
        </inputParameters>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>CurrentUser</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>composeEmailContent</name>
            <value>
                <stringValue>True</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>Approval needed: Quote {!getQuotes.Name}</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailBody</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Hello {!getQuotes.Owner:User.Manager.FirstName}{!getQuotes.Owner:User.Manager.LastName},



A new approval request has been submitted by {!getQuotes.Owner:User.FirstName} {!getQuotes.Owner:User.LastName} for quote {!getQuotes.Name}. Please review the record and approve or reject the request from the Work Guide.



  Regards,

  Salesforce</stringValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
        <offset>0</offset>
        <versionString>3.0.1</versionString>
    </actionCalls>
    <actionCalls>
        <description>Sends an email notification to the quote owner when the quote is Approved by Approver.</description>
        <name>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Approved</name>
        <label>Send Email Notification to Quote Owner When Quote is Approved</label>
        <locationX>314</locationX>
        <locationY>998</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <connector>
            <targetReference>Create_App_Alert</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recipientAddresses</name>
            <value>
                <collectionElements>
                    <elementReference>ownersEmails</elementReference>
                </collectionElements>
            </value>
        </inputParameters>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>CurrentUser</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>composeEmailContent</name>
            <value>
                <stringValue>True</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>Quote {!getQuotes.Name} approved</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailBody</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Hi {!getQuotes.Owner:User.LastName},

Your submitted quote {!getQuotes.Name} has been approved by {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.

Approval comment:{!QuoteApprovedorRejectedReason}



Regards,

Salesforce</stringValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
        <offset>0</offset>
        <versionString>3.0.1</versionString>
    </actionCalls>
    <actionCalls>
        <description>Sends a custom web notification to the quote owner when the quote is Locked</description>
        <name>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Locked</name>
        <label>Send Email Notification to Quote Owner When Quote is Locked</label>
        <locationX>50</locationX>
        <locationY>890</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <connector>
            <targetReference>Create_App_Alert_5</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recipientAddresses</name>
            <value>
                <collectionElements>
                    <elementReference>ownersEmails</elementReference>
                </collectionElements>
            </value>
        </inputParameters>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>CurrentUser</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>composeEmailContent</name>
            <value>
                <stringValue>True</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>Quote {!getQuotes.Name} is locked</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailBody</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Hello {!getQuotes.Owner:User.LastName},

Quote {!getQuotes.Name} is currently locked. To make changes, click &quot;Request for Unlock&quot; on the quote record.

Thank you,
Salesforce</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>sendRichBody</name>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
        <offset>0</offset>
        <versionString>3.0.1</versionString>
    </actionCalls>
    <actionCalls>
        <description>Sends an email notification to the quote owner when the quote is rejected by Approver.</description>
        <name>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Rejected</name>
        <label>Send Email Notification to Quote Owner When Quote is Rejected</label>
        <locationX>578</locationX>
        <locationY>998</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <connector>
            <targetReference>Create_App_Alert_2</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recipientAddresses</name>
            <value>
                <collectionElements>
                    <elementReference>ownersEmails</elementReference>
                </collectionElements>
            </value>
        </inputParameters>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>CurrentUser</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>composeEmailContent</name>
            <value>
                <stringValue>True</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Quote {!getQuotes.Name} rejected</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailBody</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Hi {!getQuotes.Owner:User.LastName},



Your submitted quote {!getQuotes.Name} has been rejected by {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.



Comments: {!QuoteApprovedorRejectedReason}



 Please review the feedback and resubmit  the quote if needed.



Regards,

Salesforce</stringValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
        <offset>0</offset>
        <versionString>3.0.1</versionString>
    </actionCalls>
    <actionCalls>
        <description>Sends an approval email notification to the quote owner when the quote is submitted for Unlock via Approval process.</description>
        <name>Send_Email_Notification_to_Quote_Owner_When_Quote_is_Submitted_for_Unlock</name>
        <label>Send Email Notification to Quote Owner When Quote is Submitted for Unlock</label>
        <locationX>842</locationX>
        <locationY>1106</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <connector>
            <targetReference>Create_App_Alert_3</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recipientAddresses</name>
            <value>
                <collectionElements>
                    <elementReference>ownersEmails</elementReference>
                </collectionElements>
            </value>
        </inputParameters>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>CurrentUser</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>composeEmailContent</name>
            <value>
                <stringValue>True</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>Quote {!getQuotes.Name} submitted for approval</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailBody</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue> Hi {!getQuotes.Owner:User.LastName},



You have submitted quote {!getQuotes.Name} for approval. It is currently pending with {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.



  Regards,

  Salesforce</stringValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
        <offset>0</offset>
        <versionString>3.0.1</versionString>
    </actionCalls>
    <apiVersion>62.0</apiVersion>
    <areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
    <assignments>
        <description>Gathering the Email address and Users Ids of the both owners and Approvers for sending the email and custom notifications</description>
        <name>Get_Email_and_User_Ids</name>
        <label>Get Email and User Ids</label>
        <locationX>578</locationX>
        <locationY>350</locationY>
        <assignmentItems>
            <assignToReference>ownersEmails</assignToReference>
            <operator>Add</operator>
            <value>
                <elementReference>getQuotes.Owner:User.Email</elementReference>
            </value>
        </assignmentItems>
        <assignmentItems>
            <assignToReference>ownersToReceiveNotifications</assignToReference>
            <operator>Add</operator>
            <value>
                <elementReference>getQuotes.Owner:User.Id</elementReference>
            </value>
        </assignmentItems>
        <assignmentItems>
            <assignToReference>approversToReceiveNotifications</assignToReference>
            <operator>Add</operator>
            <value>
                <elementReference>getQuotes.Owner:User.ManagerId</elementReference>
            </value>
        </assignmentItems>
        <assignmentItems>
            <assignToReference>approverEmailAddresses</assignToReference>
            <operator>Add</operator>
            <value>
                <elementReference>getQuotes.Owner:User.Manager.Email</elementReference>
            </value>
        </assignmentItems>
        <connector>
            <targetReference>User_Territory_Association_for_Quote_Owner</targetReference>
        </connector>
    </assignments>
    <decisions>
        <description>Determines which notification should be sent based on either the Quote Status or the Approval Status.</description>
        <name>Route_notification_based_on_Quote_or_Approval_Status</name>
        <label>Route notification based on Quote or Approval Status</label>
        <locationX>578</locationX>
        <locationY>674</locationY>
        <defaultConnectorLabel>Default Outcome</defaultConnectorLabel>
        <rules>
            <name>Is_Quote_Locked_And_Submitted</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>getQuotes.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Submitted</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Notify_Quote_Owner_via_Custom_Notification_Alert_When_Quote_is_Locked</targetReference>
            </connector>
            <label>Is Quote Locked And Submitted</label>
        </rules>
        <rules>
            <name>Send_Notifications_when_Quote_is_Approved</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>ApprovalDecision</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Approve</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Update_Quote_Status_to_Draft</targetReference>
            </connector>
            <label>Send Notifications when Quote is Approved</label>
        </rules>
        <rules>
            <name>Send_Notifications_when_Quote_is_Rejected</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>ApprovalDecision</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Reject</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Update_Quote_Status_to_Rejected</targetReference>
            </connector>
            <label>Send Notifications when Quote is Rejected</label>
        </rules>
        <rules>
            <name>Is_Quote_Locked_And_Pending_Unlock</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>getQuotes.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Request for Unlock</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>Notify_Quote_Owner_via_Custom_Notification_When_Quote_Is_Submitted_for_Unlock</targetReference>
            </connector>
            <label>Is Quote Locked And Pending Unlock</label>
        </rules>
    </decisions>
    <description>Send the notifications to the quote owner and approver.</description>
    <environments>Default</environments>
    <interviewLabel>LSC Quote Notifications {!$Flow.CurrentDateTime}</interviewLabel>
    <label>LSC Quote Notifications for Lock and Unlock</label>
    <processMetadataValues>
        <name>BuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>OriginBuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processType>AutoLaunchedFlow</processType>
    <recordCreates>
        <name>App_Alert_Territory</name>
        <label>App Alert Territory for Quote owners</label>
        <locationX>50</locationX>
        <locationY>1106</locationY>
        <inputAssignments>
            <field>AlertReferenceRecordId</field>
            <value>
                <elementReference>Create_App_Alert_5</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>TerritoryId</field>
            <value>
                <elementReference>User_Territory_Association_for_Quote_Owner.Territory2Id</elementReference>
            </value>
        </inputAssignments>
        <object>AppAlertTerritory</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <name>App_Alert_Territory_for_Quote_owners_when_Approved</name>
        <label>App Alert Territory for Quote owners when Approved</label>
        <locationX>314</locationX>
        <locationY>1214</locationY>
        <inputAssignments>
            <field>AlertReferenceRecordId</field>
            <value>
                <elementReference>Create_App_Alert</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>TerritoryId</field>
            <value>
                <elementReference>User_Territory_Association_for_Quote_Owner.Territory2Id</elementReference>
            </value>
        </inputAssignments>
        <object>AppAlertTerritory</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <name>App_Alert_Territory_for_Quote_owners_when_Rejected</name>
        <label>App Alert Territory for Quote owners when Rejected</label>
        <locationX>578</locationX>
        <locationY>1214</locationY>
        <inputAssignments>
            <field>AlertReferenceRecordId</field>
            <value>
                <elementReference>Create_App_Alert_2</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>TerritoryId</field>
            <value>
                <elementReference>User_Territory_Association_for_Quote_Owner.Territory2Id</elementReference>
            </value>
        </inputAssignments>
        <object>AppAlertTerritory</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <name>App_Alert_Territory_for_Quote_owners_when_Request_for_Unlock</name>
        <label>App Alert Territory for Quote owners when Request for Unlock</label>
        <locationX>842</locationX>
        <locationY>1322</locationY>
        <connector>
            <targetReference>Create_App_Alert_4</targetReference>
        </connector>
        <inputAssignments>
            <field>AlertReferenceRecordId</field>
            <value>
                <elementReference>Create_App_Alert_3</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>TerritoryId</field>
            <value>
                <elementReference>User_Territory_Association_for_Quote_Owner.Territory2Id</elementReference>
            </value>
        </inputAssignments>
        <object>AppAlertTerritory</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <name>Copy_2_of_App_Alert_Territory_for_Quote_owners_when_Approved</name>
        <label>Copy 2 of App Alert Territory for Quote owners when Approved</label>
        <locationX>842</locationX>
        <locationY>1538</locationY>
        <inputAssignments>
            <field>AlertReferenceRecordId</field>
            <value>
                <elementReference>Create_App_Alert_4</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>TerritoryId</field>
            <value>
                <elementReference>get_User_Territory_Association_for_Manager.Territory2Id</elementReference>
            </value>
        </inputAssignments>
        <object>AppAlertTerritory</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <description>Sends an iPad app alert notification to the quote owner when the quote is Approved by Approver.</description>
        <name>Create_App_Alert</name>
        <label>Create App Alert</label>
        <locationX>314</locationX>
        <locationY>1106</locationY>
        <connector>
            <targetReference>App_Alert_Territory_for_Quote_owners_when_Approved</targetReference>
        </connector>
        <inputAssignments>
            <field>AdditionalMessage</field>
            <value>
                <elementReference>OwnerAppAlertOnQuoteApproved</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextName</field>
            <value>
                <stringValue>Quote</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextType</field>
            <value>
                <stringValue>Object</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>EffectiveDate</field>
            <value>
                <elementReference>$Flow.CurrentDateTime</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value>
                <stringValue>Hi {!getQuotes.Owner:User.LastName} Quote is Unlocked</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Type</field>
            <value>
                <stringValue>Notification</stringValue>
            </value>
        </inputAssignments>
        <object>AppAlert</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <description>Sends an iPad app alert notification to the quote owner when the quote is rejected by Approver.</description>
        <name>Create_App_Alert_2</name>
        <label>Create App Alert 2</label>
        <locationX>578</locationX>
        <locationY>1106</locationY>
        <connector>
            <targetReference>App_Alert_Territory_for_Quote_owners_when_Rejected</targetReference>
        </connector>
        <inputAssignments>
            <field>AdditionalMessage</field>
            <value>
                <elementReference>OwnerAppAlertOnQuoteRejected</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextName</field>
            <value>
                <stringValue>Quote</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextType</field>
            <value>
                <stringValue>Object</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>EffectiveDate</field>
            <value>
                <elementReference>$Flow.CurrentDateTime</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value>
                <stringValue>Quote is Rejected</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Type</field>
            <value>
                <stringValue>Notification</stringValue>
            </value>
        </inputAssignments>
        <object>AppAlert</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <description>Sends an iPad app alert notification to the quote owner when the quote is submitted for Unlock</description>
        <name>Create_App_Alert_3</name>
        <label>Create App Alert 3</label>
        <locationX>842</locationX>
        <locationY>1214</locationY>
        <connector>
            <targetReference>App_Alert_Territory_for_Quote_owners_when_Request_for_Unlock</targetReference>
        </connector>
        <inputAssignments>
            <field>AdditionalMessage</field>
            <value>
                <elementReference>OwnerAppAlertOnApprovalSubmission</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextName</field>
            <value>
                <stringValue>Quote</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextType</field>
            <value>
                <stringValue>Object</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>EffectiveDate</field>
            <value>
                <elementReference>$Flow.CurrentDateTime</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value>
                <stringValue>Quote is Submitted for Unlock</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Type</field>
            <value>
                <stringValue>Notification</stringValue>
            </value>
        </inputAssignments>
        <object>AppAlert</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <description>Sends  an iPad app alert notification to Approver when the quote is submitted for Unlock.</description>
        <name>Create_App_Alert_4</name>
        <label>Create App Alert 4</label>
        <locationX>842</locationX>
        <locationY>1430</locationY>
        <connector>
            <targetReference>Copy_2_of_App_Alert_Territory_for_Quote_owners_when_Approved</targetReference>
        </connector>
        <inputAssignments>
            <field>AdditionalMessage</field>
            <value>
                <elementReference>ApproverAppAlertOnApprovalRequest</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextName</field>
            <value>
                <stringValue>Quote</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextType</field>
            <value>
                <stringValue>Object</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>EffectiveDate</field>
            <value>
                <elementReference>$Flow.CurrentDateTime</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value>
                <stringValue>Quote is Submitted for Unlock</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Type</field>
            <value>
                <stringValue>Notification</stringValue>
            </value>
        </inputAssignments>
        <object>AppAlert</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordCreates>
        <description>Sends an iPad app alert notification to the quote owner when the quote is locked.</description>
        <name>Create_App_Alert_5</name>
        <label>Create App Alert 5</label>
        <locationX>50</locationX>
        <locationY>998</locationY>
        <connector>
            <targetReference>App_Alert_Territory</targetReference>
        </connector>
        <inputAssignments>
            <field>AdditionalMessage</field>
            <value>
                <elementReference>OwnerAppAlertOnQuoteLock</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextName</field>
            <value>
                <stringValue>Quote</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>DisplayContextType</field>
            <value>
                <stringValue>Object</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>EffectiveDate</field>
            <value>
                <elementReference>$Flow.CurrentDateTime</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value>
                <stringValue>Hi {!getQuotes.Owner:User.LastName} Quote is Locked</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Type</field>
            <value>
                <stringValue>Notification</stringValue>
            </value>
        </inputAssignments>
        <object>AppAlert</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <recordLookups>
        <name>get_custom_Notification</name>
        <label>Get Custom Notifications</label>
        <locationX>578</locationX>
        <locationY>242</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>Get_Email_and_User_Ids</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>DeveloperName</field>
            <operator>EqualTo</operator>
            <value>
                <stringValue>Notification_when_Quote_is_locked_and_Unlocked</stringValue>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>CustomNotificationType</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>
    <recordLookups>
        <name>get_User_Territory_Association_for_Manager</name>
        <label>Get User Territory Association for Manager</label>
        <locationX>578</locationX>
        <locationY>566</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>Route_notification_based_on_Quote_or_Approval_Status</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>UserId</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>getQuotes.Owner:User.Manager.Id</elementReference>
            </value>
        </filters>
        <filters>
            <field>IsActive</field>
            <operator>EqualTo</operator>
            <value>
                <booleanValue>true</booleanValue>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>UserTerritory2Association</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>
    <recordLookups>
        <name>getQuotes</name>
        <label>Get Quote</label>
        <locationX>578</locationX>
        <locationY>134</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>get_custom_Notification</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>QuoteId</elementReference>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>Quote</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>
    <recordLookups>
        <name>User_Territory_Association_for_Quote_Owner</name>
        <label>Get User Territory Association for Quote Owner</label>
        <locationX>578</locationX>
        <locationY>458</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>get_User_Territory_Association_for_Manager</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>UserId</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>getQuotes.OwnerId</elementReference>
            </value>
        </filters>
        <filters>
            <field>IsActive</field>
            <operator>EqualTo</operator>
            <value>
                <booleanValue>true</booleanValue>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>UserTerritory2Association</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>
    <recordUpdates>
        <description>Update the Quote status to &quot;Draft&quot; when the quote is Approved by the Approver for Unlock</description>
        <name>Update_Quote_Status_to_Draft</name>
        <label>Update Quote Status to Draft</label>
        <locationX>314</locationX>
        <locationY>782</locationY>
        <connector>
            <targetReference>Notify_Quote_Owner_via_Custom_Notification_Alert_When_Quote_is_Approved</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>getQuotes.Id</elementReference>
            </value>
        </filters>
        <inputAssignments>
            <field>Status</field>
            <value>
                <stringValue>Draft</stringValue>
            </value>
        </inputAssignments>
        <object>Quote</object>
    </recordUpdates>
    <recordUpdates>
        <description>Update the Quote status to &quot;Rejected&quot; when the quote is rejected by the Approver for Unlock</description>
        <name>Update_Quote_Status_to_Rejected</name>
        <label>Update Quote Status to Rejected</label>
        <locationX>578</locationX>
        <locationY>782</locationY>
        <connector>
            <targetReference>Notify_Quote_Owner_via_Custom_Notification_Alert_When_Quote_Is_Rejected</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>getQuotes.Id</elementReference>
            </value>
        </filters>
        <inputAssignments>
            <field>Status</field>
            <value>
                <stringValue>Rejected</stringValue>
            </value>
        </inputAssignments>
        <object>Quote</object>
    </recordUpdates>
    <start>
        <locationX>452</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>getQuotes</targetReference>
        </connector>
    </start>
    <status>Draft</status>
    <textTemplates>
        <description>Holds the template message sent to the approver when a quote is submitted as approval request for unlock.</description>
        <name>ApproverAppAlertOnApprovalRequest</name>
        <isViewedAsPlainText>true</isViewedAsPlainText>
        <text>{
  &quot;message&quot;: &quot;Hello {!getQuotes.Owner:User.Manager.LastName}, You have an approval request for quote {!getQuotes.Name}. Open the record and approve or reject it from the Work Guide.\nThank you,\nSalesforce&quot;
}</text>
    </textTemplates>
    <textTemplates>
        <description>Holds the template message sent to the Owner when a quote is submitted as approval request for unlock.</description>
        <name>OwnerAppAlertOnApprovalSubmission</name>
        <isViewedAsPlainText>true</isViewedAsPlainText>
        <text>{
  &quot;message&quot;: &quot;Hello {!getQuotes.Owner:User.LastName},  You have submitted a quote {!getQuotes.Name} for approval. It is now pending with {!getQuotes.Owner:User.Manager.FirstName} {!getQuotes.Owner:User.Manager.LastName}.\nThank you,\nSalesforce&quot;
}</text>
    </textTemplates>
    <textTemplates>
        <description>Holds the template message sent to the Owner when a quote is submitted as approval request for unlock is approved by the approver.</description>
        <name>OwnerAppAlertOnQuoteApproved</name>
        <isViewedAsPlainText>true</isViewedAsPlainText>
        <text>{
  &quot;message&quot;: &quot;Hello {!getQuotes.Owner:User.LastName},  Quote {!getQuotes.Name} is Approved by {!getQuotes.Owner:User.Manager.LastName}\nComments: {!QuoteApprovedorRejectedReason}\nThank you,\nSalesforce&quot;
}</text>
    </textTemplates>
    <textTemplates>
        <description>Holds the template message sent to the Owner when a quote is locked.</description>
        <name>OwnerAppAlertOnQuoteLock</name>
        <isViewedAsPlainText>true</isViewedAsPlainText>
        <text>{&quot;message&quot;: &quot;Hello {!getQuotes.Owner:User.LastName},  Quote {!getQuotes.Name} is currently locked. To make changes, click \&quot;Request for Unlock\&quot; on the quote record.\nThank you,\nSalesforce&quot;}</text>
    </textTemplates>
    <textTemplates>
        <description>Holds the template message sent to the Owner when a quote is submitted as approval request for unlock is rejected by the approver.</description>
        <name>OwnerAppAlertOnQuoteRejected</name>
        <isViewedAsPlainText>true</isViewedAsPlainText>
        <text>{&quot;message&quot;: &quot;Hello {!getQuotes.Owner:User.LastName},  Quote {!getQuotes.Name} is Rejected by {!getQuotes.Owner:User.Manager.LastName}\nComments: {!QuoteApprovedorRejectedReason}\nThank you,\nSalesforce&quot;}</text>
    </textTemplates>
    <variables>
        <description>Holds either &apos;Approve&apos; or &apos;Reject&apos; from the Approval Screen while review the Approval Request.</description>
        <name>ApprovalDecision</name>
        <dataType>String</dataType>
        <isCollection>false</isCollection>
        <isInput>true</isInput>
        <isOutput>false</isOutput>
    </variables>
    <variables>
        <description>Holds the approver&apos;s email address for sending notifications.</description>
        <name>approverEmailAddresses</name>
        <dataType>String</dataType>
        <isCollection>true</isCollection>
        <isInput>false</isInput>
        <isOutput>false</isOutput>
    </variables>
    <variables>
        <description>Holds the user IDs of those who should receive the Custom Notification on the web.</description>
        <name>approversToReceiveNotifications</name>
        <dataType>String</dataType>
        <isCollection>true</isCollection>
        <isInput>false</isInput>
        <isOutput>false</isOutput>
    </variables>
    <variables>
        <description>Holds the owner&apos;s email address for sending notifications.</description>
        <name>ownersEmails</name>
        <dataType>String</dataType>
        <isCollection>true</isCollection>
        <isInput>false</isInput>
        <isOutput>false</isOutput>
    </variables>
    <variables>
        <description>Holds the user IDs of those who should receive the Custom Notification on the web.</description>
        <name>ownersToReceiveNotifications</name>
        <dataType>String</dataType>
        <isCollection>true</isCollection>
        <isInput>false</isInput>
        <isOutput>false</isOutput>
    </variables>
    <variables>
        <description>Holds Approval Reason from the Approval Screen while review the Approval Request.</description>
        <name>QuoteApprovedorRejectedReason</name>
        <dataType>String</dataType>
        <isCollection>false</isCollection>
        <isInput>true</isInput>
        <isOutput>false</isOutput>
    </variables>
    <variables>
        <description>Quote Id</description>
        <name>QuoteId</name>
        <dataType>String</dataType>
        <isCollection>false</isCollection>
        <isInput>true</isInput>
        <isOutput>false</isOutput>
    </variables>
</Flow>
```

### LSC_Quote_Set_Status_In_Review.flow-meta.xml

<!-- asset: LSC_Quote_Set_Status_In_Review.flow-meta.xml sha256=9e57076d9df6d3fd0fc41e0080c26d8aebeaaf7855e3099c7ab04ae1846a7315 -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
    <description>Sets a Quote&apos;s Status to In Review. Called by LSC_Quote_Lock_and_Unlock_Approval_Process while the unlock request waits for manager approval.</description>
    <interviewLabel>LSC Quote Set Status In Review {!$Flow.CurrentDateTime}</interviewLabel>
    <label>LSC Quote Set Status In Review</label>
    <processMetadataValues>
        <name>BuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <processType>AutoLaunchedFlow</processType>
    <recordUpdates>
        <name>Update_Quote_Status_to_In_Review</name>
        <label>Update Quote Status to In Review</label>
        <locationX>176</locationX>
        <locationY>134</locationY>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>QuoteId</elementReference>
            </value>
        </filters>
        <inputAssignments>
            <field>Status</field>
            <value>
                <stringValue>In Review</stringValue>
            </value>
        </inputAssignments>
        <object>Quote</object>
    </recordUpdates>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Update_Quote_Status_to_In_Review</targetReference>
        </connector>
    </start>
    <status>Draft</status>
    <variables>
        <name>QuoteId</name>
        <dataType>String</dataType>
        <isCollection>false</isCollection>
        <isInput>true</isInput>
        <isOutput>false</isOutput>
    </variables>
</Flow>
```

### Notification_when_Quote_is_locked_and_Unlocked.notiftype-meta.xml

<!-- asset: Notification_when_Quote_is_locked_and_Unlocked.notiftype-meta.xml sha256=36312b5d799be07e0e1846d929173d45e690e7bf030430c75bae2e20df27eb38 -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomNotificationType xmlns="http://soap.sforce.com/2006/04/metadata">
    <customNotifTypeName>Notification when Quote is locked and Unlocked</customNotifTypeName>
    <desktop>true</desktop>
    <masterLabel>Notification when Quote is locked and Unlocked</masterLabel>
    <mobile>true</mobile>
    <slack>false</slack>
</CustomNotificationType>
```

### lsc4ce_Quote_Document.flexipage-meta.xml

<!-- asset: lsc4ce_Quote_Document.flexipage-meta.xml sha256=51ef4c20379957f3ffd63ee6a3622e1693f9f95aa991225fc988f110c62f4f57 -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <flexiPageRegions>
        <mode>Replace</mode>
        <name>prepareForLeftColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <mode>Replace</mode>
        <name>prepareForMiddleColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentName>runtime_service_fieldservice:userOrgDetail</componentName>
                <identifier>userOrgDetail_section</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>prepareForRightColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>prepareForLeftColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>3</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>gridColumn_left</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>prepareForMiddleColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>2</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>gridColumn_middle</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>prepareForRightColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>7</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>gridColumn_right</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>prepareFor</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>columns</name>
                    <value>prepareFor</value>
                </componentInstanceProperties>
                <componentName>flexipage:grid</componentName>
                <identifier>grid_prepareFor</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>header</name>
        <type>Region</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.QuoteNumber</fieldItem>
                <identifier>quoteNumber</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.BillingName</fieldItem>
                <identifier>billingName</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.BillingAddress</fieldItem>
                <identifier>billingAddress</identifier>
            </fieldInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>summaryLeftColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.LastModifiedDate</fieldItem>
                <identifier>lastModifiedDate</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.ShippingName</fieldItem>
                <identifier>shippingName</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.ShippingAddress</fieldItem>
                <identifier>shippingAddress</identifier>
            </fieldInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>summaryRightColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>summaryLeftColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>6</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>summary_left</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>summaryRightColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>6</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>summary_right</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>summaryInfo</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentName>runtime_revenue_foundation:docTreeGrid</componentName>
                <identifier>runtime_revenue_foundation_docTreeGrid</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>quoteLineItems</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>quoteLineItems</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>12</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>quoteLineGrid</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>quoteLineGrid</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <mode>Replace</mode>
        <name>additionalInfoLeftColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.Subtotal</fieldItem>
                <identifier>subtotal</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.Discount</fieldItem>
                <identifier>discount</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.TotalPrice</fieldItem>
                <identifier>totalPrice</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.Tax</fieldItem>
                <identifier>tax</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.ShippingHandling</fieldItem>
                <identifier>shippingAndHandling</identifier>
            </fieldInstance>
        </itemInstances>
        <itemInstances>
            <fieldInstance>
                <fieldItem>Record.GrandTotal</fieldItem>
                <identifier>grandTotal</identifier>
            </fieldInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>additionalInfoRightColumn</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>additionalInfoLeftColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>6</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>additionalInfo_left</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>additionalInfoRightColumn</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>colWidth</name>
                    <value>6</value>
                </componentInstanceProperties>
                <componentName>flexipage:gridColumn</componentName>
                <identifier>additionalInfo_right</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>additionalInfo</name>
        <type>Facet</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>richTextValue</name>
                    <value>&lt;p&gt;&lt;strong style=&quot;font-size: 14px;&quot;&gt;Quote Details &lt;/strong&gt;&lt;/p&gt;</value>
                </componentInstanceProperties>
                <componentName>runtime_service_fieldservice:serviceDocumentRichText</componentName>
                <identifier>quote_details_header</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>columns</name>
                    <value>summaryInfo</value>
                </componentInstanceProperties>
                <componentName>flexipage:grid</componentName>
                <identifier>summary_info</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>columns</name>
                    <value>quoteLineGrid</value>
                </componentInstanceProperties>
                <componentName>flexipage:grid</componentName>
                <identifier>quote_line_info</identifier>
            </componentInstance>
        </itemInstances>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>columns</name>
                    <value>additionalInfo</value>
                </componentInstanceProperties>
                <componentName>flexipage:grid</componentName>
                <identifier>additional_info</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>main</name>
        <type>Region</type>
    </flexiPageRegions>
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>signatureFields</name>
                    <value>Signature,true,SignedDate,false,SignedBy,false,SignatureType,false</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>signatureIdentifier</name>
                    <value>1ae3a97a-120f-4a6d-860f-0f8a2e9d81bf__1790925032535</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>signatureType</name>
                    <value>Default</value>
                </componentInstanceProperties>
                <componentName>ls_ordermgmt:lsFlexiSignature</componentName>
                <identifier>ls_ordermgmt_lsFlexiSignature</identifier>
            </componentInstance>
        </itemInstances>
        <mode>Replace</mode>
        <name>footer</name>
        <type>Region</type>
    </flexiPageRegions>
    <masterLabel>lsc4ce Quote Document</masterLabel>
    <parentFlexiPage>runtime_sales_quotes__Quote_sd_L_default</parentFlexiPage>
    <sobjectType>Quote</sobjectType>
    <template>
        <name>runtime_service_fieldservice:headerBodyFooterDocumentTemplate</name>
        <properties>
            <name>includeFooter</name>
            <value>true</value>
        </properties>
        <properties>
            <name>includeHeader</name>
            <value>true</value>
        </properties>
        <properties>
            <name>orientation</name>
            <value>portrait</value>
        </properties>
        <properties>
            <name>pageSize</name>
            <value>letter</value>
        </properties>
    </template>
    <type>ServiceDocument</type>
</FlexiPage>
```

### Generate_Quote_Flow.flow-meta.xml

<!-- asset: Generate_Quote_Flow.flow-meta.xml sha256=be60ed376291de102753684c51a4843a127adff041da24c83ba831efdd856a37 -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <description>Creates the quote document record and triggers PDF generation. This initiates the document creation workflow for Agentforce Life Sciences quotes.</description>
        <name>CreateQuoteDocument</name>
        <label>Create Quote Document</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <actionName>createServiceDocument</actionName>
        <actionType>createServiceDocument</actionType>
        <connector>
            <targetReference>END_ELEMENT_3</targetReference>
        </connector>
        <faultConnector>
            <targetReference>SendErrorEmail</targetReference>
        </faultConnector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recordId</name>
            <value>
                <elementReference>GetQuoteDocumentDetails.QuoteId</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>templateId</name>
            <value>
                <elementReference>GetQuoteDocumentDetails.DocumentTemplate</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <inputParameters>
            <name>documentType</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>QUOTE_DOCUMENT</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>pdfReportId</name>
            <value>
                <elementReference>GetQuoteDocumentDetails.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>createServiceDocument</nameSegment>
        <offset>0</offset>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </actionCalls>
    <actionCalls>
        <description>Sends an email notification to the user when quote document creation fails. Includes the quote name for troubleshooting.</description>
        <name>SendErrorEmail</name>
        <label>Send Error Email</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <connector>
            <targetReference>END_ELEMENT_4</targetReference>
        </connector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>recipientAddresses</name>
            <value>
                <collectionElements>
                    <elementReference>$User.Email</elementReference>
                </collectionElements>
            </value>
        </inputParameters>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>CurrentUser</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>composeEmailContent</name>
            <value>
                <stringValue>True</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
                <stringValue>We couldn&apos;t create the quote document</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailBody</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>We couldn&apos;t create the quote document for quote &quot;{!GetQuoteDocumentDetails.Quote.Name}&quot;. Contact your Salesforce admin for help.</stringValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
        <offset>0</offset>
        <versionString>3.0.1</versionString>
    </actionCalls>
    <actionCalls>
        <description>Sets the default signature ID for the signature component for Agentforce Life Sciences. Used to pre-populate the signature field on the quote document.</description>
        <name>SetQuoteDocumentDefaults</name>
        <label>Set Quote Document Defaults</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <actionName>setLsQuoteDocumentDefaults</actionName>
        <actionType>setLsQuoteDocumentDefaults</actionType>
        <connector>
            <targetReference>CreateQuoteDocument</targetReference>
        </connector>
        <faultConnector>
            <isGoTo>true</isGoTo>
            <targetReference>SendErrorEmail</targetReference>
        </faultConnector>
        <flowTransactionModel>CurrentTransaction</flowTransactionModel>
        <inputParameters>
            <name>quoteDocumentId</name>
            <value>
                <elementReference>$Record.QuoteDocumentId</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
        <nameSegment>setLsQuoteDocumentDefaults</nameSegment>
        <offset>0</offset>
    </actionCalls>
    <apiVersion>68.0</apiVersion>
    <areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
    <ends>
        <name>END_ELEMENT_3</name>
        <locationX>0</locationX>
        <locationY>0</locationY>
    </ends>
    <ends>
        <name>END_ELEMENT_4</name>
        <locationX>0</locationX>
        <locationY>0</locationY>
    </ends>
    <environments>Default</environments>
    <interviewLabel>Generate Quote Flow {!$Flow.CurrentDateTime}</interviewLabel>
    <label>Generate Quote Flow</label>
    <processMetadataValues>
        <name>BuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>OriginBuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processType>AutoLaunchedFlow</processType>
    <recordLookups>
        <description>Retrieves quote document details including the quote name and document ID. Used to populate the error email and track the document creation request.</description>
        <name>GetQuoteDocumentDetails</name>
        <label>Get Quote PDF</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>SetQuoteDocumentDefaults</targetReference>
        </connector>
        <faultConnector>
            <isGoTo>true</isGoTo>
            <targetReference>SendErrorEmail</targetReference>
        </faultConnector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>$Record.QuoteDocumentId</elementReference>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>QuoteDocument</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>
    <sourceTemplate>ls_ordermgmt__GenerateLsQuoteDoc</sourceTemplate>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>GetQuoteDocumentDetails</targetReference>
        </connector>
        <flowRunAsUser>TriggeringUser</flowRunAsUser>
        <object>QuoteDocumentCreationEvent</object>
        <triggerType>PlatformEvent</triggerType>
    </start>
    <status>Draft</status>
</Flow>
```
