<!-- Run guide (README) for the Store Check and Order Management Setup Steel Thread v6. Converted from the README.html that ships with the thread. -->

> **In this repo** the thread file is [release-264-store-check-order-management-steel-thread-v6.md](./release-264-store-check-order-management-steel-thread-v6.md). To run it, copy it into an empty run folder under its original name, `Life Sciences Cloud — Store Check and Order Management Setup Steel Thread (Claude 5.5) v6.md`, which the start prompt below expects. For setup errors, start from [the troubleshooting index](./release-264-order-management-store-check-troubleshooting.md).

# Store Check & Order Management Steel Thread v6 — How to run it

A coding agent sets up Life Sciences Cloud Store Check and iPad quoting in your Salesforce org. You start it, answer its questions and do the iPad steps.

**Acts 11–15** need an iPad · **16 Acts** (0 to 15)


## What you get

At the end, a Field Sales Rep can run a **Store Check** on the iPad (stock, displays, photos) and take a **quote** from the store assortment, the last order or the catalog, with tiered pricing, a discount, a signature, Submit and a PDF.

| Who | Does what |
| --- | --- |
| The agent | Everything that can be done by CLI, API or browser automation. It checks each change and stops when it needs you. |
| You (Salesforce admin) | Start the run, answer questions, approve changes that can't be undone, and do the iPad steps. |
| Approver | One Approve or Reject on web in Act 14, only if you test the unlock route. |

## Before you start

- **Org:** you are System Administrator. The edition supports Life Sciences Cloud for Customer Engagement. Know whether it is a `customer` or `test` org.
- **Licences:** the 10 permission set licences below, each with a free seat, plus one free Salesforce user licence for the rep. Your Salesforce account team provisions them. The run stops at Act 0 if one is missing.
- **Package:** the `lsc4ce` package version ID (`04t…`), unless it is already installed.
- **Files:** just this README and the v6 thread file. The metadata files Act 8 deploys are inside the thread; the agent extracts and checksums them.
- **Computer:** a coding agent, the Salesforce CLI (`sf`), Node.js and Google Chrome. Without Node and Chrome the agent can't automate Setup pages, and you do about 30 min of extra Setup clicks.
- **iPad:** an iPad or simulator with the Life Sciences Cloud app build for your release. A real iPad is needed for photos.
- **People:** an email you can read for the rep user (the login arrives there), and a manager/approver user (the admin is fine for a test).
- **Data:** your stores, products, prices and disclaimer text, or accept the agent's starter set. Customer orgs must supply their own disclaimer.

**The 10 licences to ask for**

| API name | Setup label |
| --- | --- |
| `CorePricingRunTime` | Salesforce Pricing Run Time |
| `DocumentBuilderUserPsl` | Document Builder User |
| `ProductDiscoveryUserPsl` | Product Discovery User |
| `RevenueLifecycleManagementUserPsl` | Revenue Cloud User |
| `IndustriesLSC4CEPsl` | — |
| `HealthCloudStarter` | — |
| `IndustriesVisitPsl` | — |
| `ActionPlansPsl` | — |
| `ContextServiceRuntimePsl` | — |
| `ProductCatalogManagementViewerPsl` | — |

For labels marked —, check Setup → Company Information → Permission Set Licenses.

## Start the run

1. Make a new empty folder and copy the v6 thread file into it.
2. Open your coding agent in that folder.
3. Paste the prompt below. Replace `<ORG_URL>` with your org's URL.
4. Answer the six Act 0 questions. After that, the agent comes to you only when it needs you.

```
Run the Life Sciences Cloud Store Check and Order Management steel thread in this folder.

- Thread: "Life Sciences Cloud — Store Check and Order Management Setup Steel Thread (Claude 5.5) v6.md" in this folder.
- Target org: <ORG_URL>. Use only this org; do not query or change any other org.
- Follow the thread verbatim, Act 0 to Act 15, in its stated run order. Do not edit the thread.
- Use only the sf CLI, the Salesforce APIs, a browser and this folder. Do not read anything outside this folder. If you cannot go on without something else, stop and tell me.
- Minimal interruptions: when the thread asks AUTO_CONTINUE, recommend yes. Stop only at ⏸ STOP and 👤 HUMAN, and for any destructive, sharing-default (OWD) or security change not covered by a consent item.
- Safety: retrieve before every deploy and compare counts after; log every org change outside a step in org-changes.md; never write session tokens to files; never re-tap Submit (check Quote.Status first); never re-publish, regenerate or delete a QuoteDocument without my consent. On the iPad: I enter the passcode myself; never tap Reset Passcode or Log out.
- Write each run-learnings.jsonl row as soon as it happens.
- Keep runs/run-NN/RESUME.md current after every Act: where the run is, what is next, what is waiting on me.

Start with Act 0.
```

If the session ends: resume prompt

Start a new session with this. Finished steps are not redone.

```
Resume run-NN of the steel thread in this folder from runs/run-NN/RESUME.md and the run manifest.
<then paste the bullet rules from the start prompt, unchanged>
```

Optional: answer questions in advance

Put answers in `runs/inputs/run-inputs.json` (keys from the thread's Runtime input schema). The agent checks them at the start and won't ask those again.

```
{ "PFX": "Acme_", "CORP_CCY": "EUR", "ACTIVE_CCYS": [], "ORG_KIND": "customer", "AUTO_CONTINUE": "yes" }
```

The agent keeps everything for a run in `runs/run-NN/`: manifest, one summary per Act, change log, `RESUME.md`. **Keep `runs/` private**; it has org IDs and usernames.

## How the run talks to you

| You see | It means |
| --- | --- |
| ⏸ STOP | The agent waits for your decision. |
| 👤 HUMAN | A person does this: a login, a consent, an iPad tap, or a web check as the rep. |
| 🖱️ UI | A Setup page the agent automates. You do it only if automation isn't available. |
| Checkpoint | End-of-Act report: status, what changed, what's open. |
| `PASSED` / `PASSED_WITH_NOTES` | Done. "With notes" means a known platform limitation was hit; still a pass. |
| `BLOCKED` / `FAILED` | Something is missing, declined or broken. The report says what happened, why it matters and what the agent can do. |

Every question comes with a recommended answer. Nothing is used until you answer or accept it.

**Web checks** (Acts 8, 9 and 10) are yours: a person clicks through Lightning far faster than browser automation. The agent sends the exact clicks and a **Report back** list. Reply with the answers and screenshots; the agent confirms each one on the server.

## Your first decisions (Act 0)

| Question | Tip |
| --- | --- |
| `PFX`: prefix for everything created | Letters/digits plus one `_`, e.g. `Acme_`. Reuse an earlier run's prefix if one exists. |
| `CORP_CCY`: currency | Keep the org's corporate currency for all stores. Stores in several currencies stop the run. |
| `ACTIVE_CCYS`: extra currencies | None. |
| `IRREVERSIBLE_CONSENT` | `yes` (go ahead) or `ask` (ask me live), for all items or each one. Recommended: `ask` on customer orgs. On a test org this also covers C13, the sharing change. |
| `PLAYWRIGHT_AVAILABLE`, `AUTO_CONTINUE` | Playwright `yes` if the agent's test works (Setup pages only; web checks are always yours). No Node/Chrome, or prefer to click yourself? Answer `no`: you get about 10 Setup click paths across Acts 1, 6, 7 and 8, and the run waits for you at each. Auto-continue `yes`, so clean Acts run back to back. |
| `ORG_KIND` | `customer` or `test`. No default. |

## Changes that need your OK

These can't be undone or affect the whole org. You decide at Act 0; the agent re-checks before each one and asks again if anything changed. Decline any and that part is skipped and reported.

Consent list C1–C14

| Item | Step | Change | Undo? |
| --- | --- | --- | --- |
| C1 | 1.1 | Chatter and base Industries settings | No |
| C2 | 1.3 | State/Country picklists | Hard |
| C3 | 1.7 | Person Accounts | No |
| C4 | 1.10 | Multi-Currency | No |
| C5 | 2.2 | Install the `lsc4ce` package | Only before package data exists |
| C6 | 5.2 | Activate the territory model | Can't go back to Planning |
| C7 | 6.3 | Turn On Order Management | No |
| C8 | 8.17 | Activate the quote stage trigger | Yes |
| C9 | 8.20 | Unlock branch and approval flow | Partly |
| C10 | 14.6 | One Submit of the test quote | No (quote locks) |
| C11 | Gates | Run each known-defect test once | — |
| C12 | 8.30a | Admins can log in as any user | Yes |
| C13 | 9.20a | Public Read Only sharing on 3 Store Check objects (test org: answered at Act 0; customer org: always asked live) | Yes |
| C14 | various | Access grants and setup changes (preferences, Account Plans, territory, quote permissions, Document Builder, statuses/Path, overrides, list view, muting, rep currency, mobile cache) | Per item |

**Always asked live:** deletes, sharing changes on a customer org (C13), security changes not on the list, and anything that differs from what the agent expected.

## The Acts, one by one

Each card shows what happens and **what you do**. Clean Acts run back to back; the agent stops only when it needs you.

1. [0**Discovery**Checks the org, asks 6 questions](#act-0)
2. [1**Org foundation**Settings the package needs](#act-1)
3. [2**Package install**Installs lsc4ce](#act-2)
4. [3**Post-install settings**Store Check and Quotes on](#act-3)
5. [4**Rep user**Creates the Field Rep](#act-4)
6. [5**Territory & stores**Who sees which stores](#act-5)
7. [6**Order Management**Quotes and pricing on](#act-6)
8. [7**Catalog & pricing**Products, prices, discounts](#act-7)
9. [8**Quote setup (web)**Quote pages, stages, PDF, unlock](#act-8)
10. [9**Store Check setup**Visit types, tasks, indicators](#act-9)
11. [10**Mobile snapshot**Package config for the iPad](#act-10)
12. [11**iPad: first sync**Install, log in, sync](#act-11)
13. [12**iPad: Store Check**One full store visit](#act-12)
14. [13**iPad: Quote**Quote from the visit](#act-13)
15. [14**iPad: Sign & Submit**Sign, submit once, PDF](#act-14)
16. [15**iPad: Repeat order**Reorder from last order, wrap up](#act-15)

nothing to do  answers & approvals  hands-on iPad

0

### Discovery

Agent 15 min · You 5–10 min

Answers & approvals

Logs in and looks around without changing anything: edition, currencies, existing setup, licences.

#### You do

1. Finish the browser login within ~2 min if one opens. If it times out, run the command the agent gives you.
2. Answer the six questions above.

#### Heads-up

- Stops if a licence is missing, more than one `lsc4ce` package is found, or stores need several currencies.
- Always waits for you after this Act.

1

### Org foundation

Agent 90 min · You 5–10 min

Answers & approvals

Turns on Chatter, State/Country picklists, Person Accounts, Multi-Currency, Territory Management and some preferences.

#### You do

1. Confirm the admin user.
2. Consents C1–C4 if you chose `ask`.

#### Heads-up

- Several of these can't be undone; the agent lists them first.

2

### Package install

Agent 20 min · You 2–5 min

Answers & approvals

Installs the package once. Known install errors are fixed and retried; unknown ones stop the run.

#### You do

1. Give the package version ID (`04t…`) if it isn't installed.
2. Consent C5 if `ask`.

3

### Post-install settings

Agent 10 min · You none

Nothing to do

Turns on Store Check, Quotes and related settings.

#### Heads-up

- The RSVP email service may be missing (K3). It isn't used.

4

### Rep user

Agent 20 min · You 5–10 min

Answers & approvals

Creates the rep's profile, permission set and user, with only the access the journeys need, plus manager and currency.

#### You do

1. Give the rep's email, the names and the manager.
2. Keep the rep's login email; you need it on the iPad.

#### Heads-up

- The quote permission set also grants org-wide read on App Usage Assignment (C14d).

5

### Territory & stores

Agent 15 min + 5 per store · You 5–10 min

Answers & approvals

Creates and activates a territory, assigns rep and manager, and creates the stores with full addresses.

#### You do

1. Give territory names and stores.
2. Consent C6 if `ask`.

6

### Order Management

Agent 30 min · You 0–5 min

Answers & approvals

Turns on Order Management and sets up the quote pricing context.

#### You do

1. Consent C7 if `ask`.

#### Heads-up

- If the org already has quotes or an active custom price book, the agent always asks live (6.3).

7

### Catalog & pricing

Agent 60 min · You 5–10 min

Answers & approvals

Builds catalog, products, price books, two tier discounts and the pricing procedure, then simulates prices. Act 13 compares the iPad against these numbers.

#### You do

1. Give catalog, products, prices and tiers, or accept the starter set.

#### Heads-up

- Step 7.17b turns on Header Adjustments. Without it the iPad cart footer has no Order Discount (Add).

8

### Quote setup (web)

Agent 1.5–2 h · You 20–40 min

Answers & approvals

Sets up the web quote: page, stages, product views, signature, disclaimer, PDF template and unlock approval. Then a web test creates and prices a quote.

#### You do

1. Give the assortment, priority products, disclaimer and stages.
2. Allow Login-As so you can run the web test as the rep (C12).
3. **Web test, as the rep:** Setup → Users → **Login** next to the rep. The agent sends the exact values and checks your results.
4. 8.30: Quotes → **New Quote** → Account, name `<PFX>Web_Quote_1` → Save. Report: saved? Any error text? On the saved quote: the stage names in order, whether Browse Catalogs, Add Line Items and Submit show, and whether an Approval tab or **Mark Status as Complete** shows (neither should).
5. 8.31: Related → Quote Line Items → **Add Products** → price book → product → Quantity 1 → Save. Report: price book pre-selected? Grid loaded? Saved?
6. 8.32: **Reprice All** once, then **Manage Header Adjustment** = Percentage 10 %. Report: Net Unit Price and a Calculation Details screenshot.
7. 8.33 (if on): **Browse Catalogs** → catalog → Next → one product → Preview Selection → Create Quote Line Items → **Reprice All**. Report: a screenshot of each screen.
8. Then **Log out as** the rep, Setup → Users → **Login** next to the manager, and open the same quote. Report: is the Approval tab there?
9. If asked, switch the trigger handler to Active in the Admin Console (8.17).

#### Heads-up

- The longest Act.
- Browse Catalogs → Next sets the quote's price book even if you abandon it.
- Step 8.24a lets the rep create the PDF event. Without it the iPad PDF stays In Progress (K1). Don't grant it by saving the rep profile in Setup.
- When the agent says the web checks are done, use **Log out as …** at the top of the page (web only).

9

### Store Check setup

Agent 70 min · You 20–35 min

Answers & approvals

Gives Store Check visits their own page while In-Person and Remote visits stay as they are. Builds 3 tasks, 22 indicators, targets and visit stages.

#### You do

1. Answer the Store Check questions (unanswered ones use the recommendation).
2. **Sharing decision C13:** on a test org you answer it at Act 0; on a customer org it is asked live here. If you decline, the agent shares records directly instead.
3. **Web check, as the rep:** first, when the agent asks, open the test Store Check visit and report its tabs (expected: Details, Store Check, Quoted Order).
4. Then: Visits list (note the columns) → **New** → note the record types and which is pre-selected → Store Check → Next → note the fields → **Cancel**.
5. Then New → In-Person → Next, and New → Remote → Next. Note what loads; **Cancel each; don't save.**
6. Still as the rep: open the test quote (Grand Total in the footer?) and a store account (Details and Related tabs, no error?). Send a screenshot of each screen.

#### Heads-up

- A blank Store Check tab on a web visit is expected; it fills on the iPad.
- In-Person and Remote may show a "metadata cache missing" message before Act 10. That's expected (K26).
- As the admin, Visits → New opens a plain form with no Store Check / In-Person / Remote choice, and Save fails. Answer `yes` to the admin Visit access question (9.8b; in Act 10, step 10.1c then lets In-Person / Remote open for the admin too) or check visits as the rep.

10

### Mobile snapshot

Agent 35 min · You 5–20 min

Answers & approvals

Bundles all settings into the snapshot the iPad downloads, then checks it. Later fixes reach the iPad only after a new snapshot.

#### You do

1. Approve overwriting existing mobile config records, if any.
2. **Web check, as the rep** (new session): Visits → New → In-Person → Next, then Remote → Next; cancel both. Report whether each form loads, with a screenshot of any message.

11

### iPad: first sync

Agent 10 min · You 15–25 min

Hands-on: iPad

You set up the iPad; the agent confirms the device and data arrived.

#### You do

1. Install the app.
2. Log in as the rep. You type the password and passcode.
3. Profile & Territory → Begin Sync → Sync.
4. Check View Database, open Quotes → New, then cancel.

#### Heads-up

- Don't open Store Check or Begin Visit yet.
- "Pending Approval" after first login is expected (K17).

12

### iPad: Store Check

Agent 5–8 min · You 10–20 min

Hands-on: iPad

You run one Store Check; the agent confirms everything saved on the server.

#### You do

1. Visits → New → Store Check. Pick the store. For Place, switch the lookup type to `ContactPointAddress` and pick the billing address. Planned Start = now. Save.
2. Begin Visit → Continue without location → Start Visit.
3. Store Check tab → Begin Store Check. Fill all three tabs; every picklist needs a value (`Not Applicable` is fine).
4. Save & Close, check Edit opens, Cancel. Then End Visit.

#### Heads-up

- **Never tap Delete** on an in-progress visit (K27).
- Don't switch No Stock off and on again before saving.
- Verified checkboxes clear after saving (K4); expected.

13

### iPad: Quote

Agent 8–12 min · You 30–45 min

Hands-on: iPad

You build a quote from the visit; the agent compares every price with Act 7.

#### You do

1. Say whether to test the unlock route.
2. On the visit's Quoted Order tab, tap New. Pick Sales Transaction Type `<PFX>Order` (it's blank), and enter the name, account, visit and addresses the agent gives. Status should read Draft and not be editable. Save.
3. Actions → Add Line Items → price book → Select Products → add the listed products. Save, Close, sync.
4. Enter the given quantities and discount. Check the footer shows Order Discount (Add), but don't apply one on this quote. Save. Send a screenshot of Net Unit Price → Calculation Details. Save & Close, sync.

#### Heads-up

- Lines reach the server only after Save and sync.
- Create Quote isn't in the visit ••• menu (K13).

14

### iPad: Sign & Submit

Agent 10–15 min · You 10–15 min

Hands-on: iPad

You sign and submit the quote once; the agent checks status, signature and PDF. Optional unlock test.

#### You do

1. Open the quote and check its name. Cart → Save → **Review** (not Actions → Submit).
2. Read the disclaimer and sign inside the pad, away from the screen edge.
3. **Wait for the agent's OK**, then tap the lock icon and type the passcode.
4. Tap **Submit Order once**. Never again, whatever the screen shows.
5. Generate PDF only when the agent says so. Don't tap it repeatedly.
6. Unlock test (if on): Actions → Request for Unlock, sync, report. Then Approve or Reject once, on web.
7. If a PDF security check fails, approve or decline the fix (14.12).

#### Heads-up

- The PDF can take up to 10 min to complete. If it stays In Progress, the agent checks 8.24a first (K1). Don't regenerate or delete it.

15

### iPad: Repeat order

Agent 6–15 min · You 10–15 min

Hands-on: iPad

You create a second quote from the last order; the agent compares lines and writes the final report.

#### You do

1. If asked, build and submit one more source quote first.
2. New quote for the same store → Add Line Items → price book → Select Products.
3. The Last Order card is pre-selected. **Don't tap it** (that deselects it). Continue, Save, sync.
4. Customer org: decide whether to turn Login-As off (recommended: off).

#### Heads-up

- Manual discounts don't carry over to the repeat order (K2).

## iPad tips

|  |  |
| --- | --- |
| Sync | Profile & Territory → Begin Sync → Sync. Save open records first. |
| Passcode | Always you. The agent never taps Reset Passcode or Log out. |
| After a new snapshot | Close and reopen the app; syncing isn't enough. |
| Check the name | Before acting on a quote, check its name matches the one the agent gave. |
| Taps stop working | Restart the iPad or simulator, then tell the agent. |
| Report back | Say what you see, or send a screenshot. The agent checks the server. |

## If something goes wrong

**The agent stopped. What now?**

The last message names the step. Find it under that Act above.

**I tapped Submit twice.**

Tell the agent. It checks the real status; the server rejects duplicates.

**The PDF keeps spinning.**

Usually step 8.24a is missing (K1). The agent checks it. Don't regenerate or delete it.

**No price book or products on the iPad.**

Usually the rep's currency differs from the store's. The agent checks and asks before fixing.

**My fix doesn't show on the iPad.**

It needs a new snapshot (Act 10), then sync and reopen the app.

**Licence check failed.**

Get the licence from your account team, then rerun the start prompt; the run resumes.

**Can I change an answer?**

Yes. Tell the agent; it shows what changes first.

**Known platform limitations (not failures)**

When one of these happens the step is `PASSED_WITH_NOTES` and the run goes on.

| ID | What you see |
| --- | --- |
| K1 | PDF stays In Progress after Submit (fixed by 8.24a) |
| K2 | Repeat order drops manual discounts |
| K3 | RSVP service missing |
| K4 | Verified checkboxes clear after save |
| K5 | Raw text token in the Store Check heading |
| K8 | No camera on the simulator |
| K13 | Create Quote missing from the visit menu |
| K17 | Pending Approval after first login |
| K26 | "Metadata cache missing" on web In-Person/Remote before Act 10 |
| K23 | Generate PDF shows "Unknown component" on web |
| K27 | Delete offered on an in-progress visit; never tap it |

## What can't be undone

- Chatter and Industries base settings
- State/Country picklists
- Person Accounts
- Multi-Currency
- Order Management Turn On
- Package install (uninstall only before package data exists)

Everything else can be rolled back on request: the agent saves a copy before each change and asks before any delete. Try a sandbox first if you're unsure.

## You're done when

- Every Act has a checkpoint report and nothing is left pending.
- Web: a draft quote is priced, and the Store Check visit shows its stages.
- iPad: first sync works; the Store Check and quote screens are accepted; the repeat order works.
- iPad prices match the Act 7 simulation.
- Every irreversible change had your OK.
- You received the build inventory, the gap journal and the completion report.
