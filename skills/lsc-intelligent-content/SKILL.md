---
name: lsc-intelligent-content
description: Guides Life Sciences Cloud (LSC) Intelligent Content (CLM) configuration. Use when user asks about presentations, content management, CLM, closed loop marketing, content library, presentation settings, HTML presentations, PDF presentations, content API, territory distribution, presentation pages, dynamic content, Presentation object configuration, content player, menu player, recommended/targeted presentations, or a Visit launch that does not record the Intelligent Content session.
---

## CRITICAL — "ASSOCIATE WITH" MEANS TOPIC, NOT TERRITORY

When a user says "**associate** a presentation **with X**" (or "link to X", "tag with X"), X is a **Topic name** — NOT a territory. NEVER search Territory2 for it. ALWAYS search Topic:

```
run_soql({ query: "SELECT Id, Name FROM Topic WHERE Name LIKE '%X%' AND NetworkId = null" })
```
Then call: `assign_presentation_content({ presentationId: "...", topicNames: ["X"] })`

When a user says "**give access to [person]**" (or "grant access to", "distribute to [person]"), look up that person's **territory**, then distribute:

```
run_soql({ query: "SELECT Territory2Id, Territory2.Name FROM UserTerritory2Association WHERE UserId IN (SELECT Id FROM User WHERE Name LIKE '%person%')" })
```
Then call: `distribute_presentation({ presentationId: "...", territoryIds: ["<territory ID>"] })`

| Phrase pattern | Meaning | Search object |
|---|---|---|
| "associate with X" / "link to X" / "tag with X" | Topic assignment | `Topic` |
| "give access to [person]" / "grant access to [person]" | Territory distribution via person's territory | `UserTerritory2Association` → `distribute_presentation` |
| "distribute to [territory]" | Direct territory distribution | `Territory2` → `distribute_presentation` |

---

## How to Answer Intelligent Content Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| CLM concepts, content flow, best practices | `get_lsc_module_docs({ module: "intelligent-content" })` |
| Specific content topic (tracking, dynamic content, etc.) | `search_lsc_knowledge({ query: "<topic>" })` |
| Visit launch does not record the presentation session, or click stream is missing and the player did open | `search_lsc_knowledge({ query: "Pause tracking when player launches Visit" })` then follow **Pause tracking on launch** below. Do **not** start with metadata cache or a missing bundle. |
| Admin Console presentation settings | `list_admin_settings({ category: "IntelligentContent" })` |
| Trigger handler status | `list_trigger_handlers()` |
| Object fields and relationships | `describe_sobject({ sobject: "Presentation" })` |
| Presentation data in the org | `run_soql({ query: "SELECT ... FROM Presentation ..." })` |
| Mobile cache status | `check_mobile_cache_status()` |
| Validation / audit | `audit_mobile_config({ group: "content-config-check" })` |

Always preserve the citation block (lines starting with > 📖, > 🔗, > 📂) from the tool response verbatim in your answer.

---

## Pause tracking on launch

Load `support-engineering-pause-tracking-on-launch.md`. Call `list_admin_settings({ category: "IntelligentContent" })` and read **Pause tracking when player launches** for that rep (user, then profile, then org). Finish only when the reply states every fact under **Required answer**: the setting is on, the player starts paused, and this is not a metadata-cache gap or a failed sync. Do not leave those as open alternatives.

---

## Configuration Mode

When the user asks about configuring Intelligent Content / CLM features, **ask them which mode they prefer**:

1. **Show me the documentation** — call `get_lsc_module_docs({ module: "intelligent-content" })` and present the relevant sections
2. **Walk me through it** — configure it directly in their org step-by-step (guided setup below)

Default to **guided setup** when connected to an org, or documentation mode if no org is connected.

### Guided Setup Workflow

#### Step 1: Check Current State
```
list_trigger_handlers()
list_admin_settings({ category: "IntelligentContent" })
```

#### Step 2: Report Findings
Present a summary table of what's configured vs what's missing/disabled.

#### Step 3: Propose Changes
For each issue found, propose the fix and wait for user confirmation.

#### Step 4: Apply Changes (with user confirmation)
```
toggle_trigger_handler({ handlerName: "ContentTriggerHandler", active: true })
update_admin_setting({ recordId: "...", fields: { ... } })
```

#### Step 5: Verify
Re-run the checks from Step 1 to confirm everything is configured correctly.

---

## Tool Usage Rules

### Correct Object Names
| Correct | Wrong (NEVER use) |
|---------|-------------------|
| `Presentation` | `Presentation__c`, `CLMContent__c`, `CLMPresentation__c` |
| `PresentationPage` | `PresentationSlide__c`, `PresentationContent__c` |
| `PresentationShare` | — |
| `PresentationPageProduct` | — |
| `LifeSciPresEvent` | `PresentationEvent__c`, `PresentationTracking__c` |
| `Topic` | — |
| `ProviderAcctTerritoryInfo` | — |

### Wrong Field Names on Presentation
| Wrong Field | Correct Field |
|---|---|
| `IsActive` | `Status` (picklist: `Active`, `Inactive`) |

**`IsActive` does NOT exist on Presentation.** To activate: `update_record({ objectName: "Presentation", recordId: "<id>", fields: { Status: "Active" } })`

### Tool Restrictions
- **DO NOT** use `run_soql` for Admin Console settings — use `list_admin_settings`
- **DO NOT** use `run_soql` for mobile cache — use `check_mobile_cache_status()`
- **DO NOT** suggest OmniStudio/FlexCard/OmniScript for mobile — NOT available on LSC Mobile iPad app

### Presentation Upload Tool (`upload_presentation`)

Supported formats: `.pptx` (requires LibreOffice), `.pdf`, `.zip` (HTML pages), or directory of `.zip` files. Optional parameters: `activationDate`, `deactivationDate`, `playerGesture`, `enableDoubleTapZoom`, `enablePinchZoom`, `topics`, `sendByEmail`, `presentationId`.

After upload: distribute to territories → activate (set Status to Active) → assign products/topics → regenerate mobile cache.

### Territory Distribution Tool (`distribute_presentation`)

- `includeChildren: true` (default) uses `TerritoryAndSubordinates` groups — cascades to all child territories
- `includeChildren: false` uses `Territory` groups for exact territory only
- Skips territories already distributed

---

## PresentationPlayer Native Bridge API (CLM Runtime)

The LSC CLM player injects a **`PresentationPlayer`** object into the JavaScript runtime of each HTML slide. This is NOT the same as `com.veeva.clm` (Veeva's JS API) — they are completely separate objects with different signatures.

### PresentationPlayer vs com.veeva.clm

| | `PresentationPlayer` (LSC) | `com.veeva.clm` (Veeva) |
|---|---|---|
| **Injected by** | LSC CLM runtime (native bridge) | Veeva CRM CLM runtime |
| **gotoSlide signature** | `gotoSlide(PageId, slideName, animation)` — 3 args | `gotoSlide(keyMessage, presentation)` — 2 args |
| **Defined in JS?** | No — injected by native runtime | Yes — `veeva-library.js` |
| **Navigation model** | Uses `slideName` (HTML filename within zip) | Uses `keyMessage` (Key Message name) |

### PresentationPlayer.gotoSlide(PageId, slideName, animation)

Navigate between pages within a multi-page zip or between Key Messages.

| Parameter | Type | Description |
|---|---|---|
| `PageId` | String or null | The Salesforce ID of the target `PresentationPage` record. Pass `null` to navigate by slide name instead. |
| `slideName` | String | The HTML filename within the zip (e.g., `"02_index.html"`). Used when `PageId` is null. |
| `animation` | String or null | Transition animation. Pass `null` for default. |

**Correct usage:**
```javascript
// Navigate to a specific HTML page within the same multi-page zip
PresentationPlayer.gotoSlide(null, "02_index.html", null);

// Navigate using a PageId (obtained from PresentationDOMContentLoaded event)
PresentationPlayer.gotoSlide("a1B5g00000XXXXX", null, null);
```

**Common mistakes:**
```javascript
// WRONG — 1 argument: CLM player treats it as PageId and appends .pdf
PresentationPlayer.gotoSlide("02_index.html");
// Result: 404 for "02_index.html.pdf"

// WRONG — passing zip name instead of HTML filename
PresentationPlayer.gotoSlide(null, "SI_PRODUCT_A_20.zip", null);
// Result: "The page can't be accessed because it's not part of the current presentation"

// WRONG — using Veeva API signature
com.veeva.clm.gotoSlide("keyMessageName", "presentationName");
// Result: fails in LSC runtime (com.veeva.clm doesn't exist)
```

### Other PresentationPlayer Methods

| Method | Description |
|---|---|
| `PresentationPlayer.goNextPage()` | Navigate to the next page in sequence |
| `PresentationPlayer.goPreviousPage()` | Navigate to the previous page in sequence |
| `PresentationPlayer.gotoSlide(PageId, slideName, animation)` | Navigate to a specific page |

### PresentationDOMContentLoaded Event

The CLM player fires a `PresentationDOMContentLoaded` event after loading each slide. The event provides `configData` JSON containing page IDs that can be used with `gotoSlide()`.

```javascript
document.addEventListener("PresentationDOMContentLoaded", function(event) {
    var configData = JSON.parse(event.detail);
    // configData contains page IDs for the current presentation
});
```

---

## Multi-Page Zip Navigation

### How Multi-Page Zips Work

A single Intelligent Content zip can contain multiple HTML pages. The CLM player identifies pages by their **HTML filename** within the zip (e.g., `01_index.html`, `02_index.html`).

**Typical multi-page zip structure:**
```
MyPresentation.zip
├── 01_index.html          ← Page 1 (loaded first)
├── 01_thumbnail.jpg
├── 02_index.html          ← Page 2
├── 02_thumbnail.jpg
├── 03_index.html          ← Page 3
├── 03_thumbnail.jpg
└── assets/
    ├── doc_000001/         ← Assets for page 1
    ├── doc_000002/         ← Assets for page 2
    └── doc_000003/         ← Assets for page 3
```

The numeric prefix (`01_`, `02_`, etc.) determines page ordering in the CLM player **when no manifest is present**.

### Optional `content.json` Manifest (explicit order + titles)

A multi-page zip may include a `content.json` at its root to control slide **order and titles** independently of filename sort. It is a JSON array, one entry per slide:

```json
[
  { "title": "Slide 1", "thumbnail": "01_thumbnail.jpg", "path": "01_firstSlide.html" },
  { "title": "Efficacy Data", "thumbnail": "02_thumbnail.jpg", "path": "02_secondSlide.html" }
]
```

- `path` — the slide's HTML filename within the zip
- `thumbnail` — the slide's thumbnail image
- `title` — the display title (independent of the filename)

When `content.json` is present, its array order wins over the numeric-prefix sort. When absent, the player falls back to the `NN_` numeric-prefix ordering described above. If slides appear in the wrong order or show filename-derived titles, add or fix `content.json`.

### Dynamic Content — Mustache Templating

Slides can render dynamic values at runtime using Mustache. Mark a container with `data-tpl="mustache"` and use `{{variable}}` placeholders inside it:

```html
<div data-tpl="mustache" class="item-list">
  <div>Presentation Index: {{presentationindex}}</div>
</div>
```

Available context includes values like `territory`, `user`, `mngEvent`, and `presentationindex`. Use this for content that must reflect the current rep, territory, event, or slide position. If `{{...}}` renders literally instead of substituting, the container is missing `data-tpl="mustache"`.

### Navigating Within a Multi-Page Zip

To navigate between pages in the same zip, use `PresentationPlayer.gotoSlide()` with the target HTML filename:

```javascript
// From 01_index.html, navigate to page 3
PresentationPlayer.gotoSlide(null, "03_index.html", null);
```

### Porting Veeva CLM Content to LSC

When migrating content from Veeva CRM CLM to LSC Intelligent Content:

1. **Replace `com.veeva.clm.gotoSlide()`** with `PresentationPlayer.gotoSlide(null, slideName, null)`
2. **Replace `com.veeva.clm.nextSlide()`** with `PresentationPlayer.goNextPage()`
3. **Replace `com.veeva.clm.prevSlide()`** with `PresentationPlayer.goPreviousPage()`
4. **Map Key Message names to HTML filenames** — Veeva uses Key Message names; LSC uses the actual HTML filename within the zip
5. **Remove Veeva JS Library** (`veeva-library.js`) — it won't function in LSC runtime
6. **Do NOT define `PresentationPlayer` in JavaScript** — it is a native bridge object injected by the CLM runtime. Overwriting it (e.g., with `Object.defineProperty` or `window.PresentationPlayer = {...}`) will break content loading
7. **Do NOT inject shim scripts into HTML `<head>`** — any script that interferes with the native bridge initialization can cause "Content could not load" errors

### Common Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| "The page can't be accessed because it's not part of the current presentation" | Passing zip name or Key Message name instead of HTML filename | Use `PresentationPlayer.gotoSlide(null, "02_index.html", null)` |
| 404 for `filename.pdf` | Calling `gotoSlide()` with 1 argument — CLM player treats it as PageId and appends `.pdf` | Always use 3 arguments: `gotoSlide(null, slideName, null)` |
| "Content could not load" | JavaScript shim overwriting `PresentationPlayer` before native bridge loads | Never define `PresentationPlayer` in your code; patch navigation logic in the app JS instead |
| Navigation works in Veeva but not LSC | Using `com.veeva.clm` API which doesn't exist in LSC | Replace all Veeva API calls with `PresentationPlayer` equivalents |
| Nav buttons do nothing | Navigation code in wrong branch (e.g., fix in `if(presentation)` but buttons call without presentation param) | Ensure the fix is in the code path that actually executes for nav button clicks |
| Presentation shows blank / images missing on iPad | Offline caching issue, not authoring. The player serves assets from IndexedDB via a **service worker** (`content-sw.js`); if the worker didn't register or the cache didn't populate, assets 404 offline even though the content is valid | Re-sync the device, confirm the presentation fully downloaded, and reload. Suspect the service worker / offline cache before editing slide content — a slide that renders online but blanks offline is almost always a caching problem |
| Slides in wrong order or wrong titles | Missing/incorrect `content.json`, or reliance on filename order when a manifest exists | Add or correct `content.json` (see Optional Manifest above), or fix the `NN_` numeric prefixes |
| `{{variable}}` shows literally | Container missing `data-tpl="mustache"` | Wrap dynamic content in `<div data-tpl="mustache">…</div>` |

---

### Content Assignment Tool (`assign_presentation_content`)

- Assign topics by ID (`topicIds`) or name (`topicNames`)
- Assign products per-page (`products` array) or to all pages (`productIdForAllPages`)
- When topics are assigned by name, automatically looks up matching `LifeSciMarketableProduct` records and assigns them to all pages
- Skips duplicate assignments
