# Intelligent Content — Support Engineering Training

**Session:** LSC4CE Value Chain Training — May 19, 2026
**Audience:** Support engineers
**Source:** Engineering training series (deck + Gemini transcript)
**Presenter:** Conor Fanlo

## Overview

Intelligent Content lets sales reps present ZIP/PDF content to HCPs/HCOs. Admins upload presentations; reps search, select, and present them. Most support issues fall into 3 buckets: **(1) malformed ZIP structure** breaking upload validation, **(2) Content Search misconfiguration** in Data 360, and **(3) targeting context restricting presentations the rep expected to see**.

> **Cardinal rule for ZIPs:** Select all files inside the folder and zip them — do NOT zip the parent folder. The parent folder wrapping breaks the `index.html` lookup.

## Data Model

| Object | Role |
|---|---|
| **Presentation** | Top-level record — name, type, territory alignment, version |
| **Presentation Page** | Individual page/slide. Reusable across multiple presentations. |
| **Presentation Link Page** | Junction object — links a Page to a Presentation (allows reuse) |
| **Presentation Page Product** | Maps a Page to Products + Messages (powers extended search) |
| **Content Document** | The underlying file storage (Salesforce Files) |
| **Presentation Clickment** | Captures user click-stream actions during a Presentation |
| **Presentation Party Access** | Manages external (Experience Cloud) sharing for email link delivery |

## Launching Presentations

Three launch points, all of which preserve record context:

| Launch from | How |
|---|---|
| **Intelligent Content tab** | App Launcher |
| **Visit** | Quick Action on Visit — passes Visit context (auto-associates presentation with the Visit, enables click-stream tracking) |
| **Account** | Quick Action on Account — passes Account context (drives recommendations) |

## Presentation Structure

| Type | Required files |
|---|---|
| **ZIP** | `index.html` (required, at root) + `thumbnail.jpg` (required, at root) + asset folders + supporting files |
| **PDF** | Single PDF file |

### ZIP packaging — common upload failure
**Wrong:** Zip the parent folder → file structure becomes `parent-folder/index.html` → validation fails
**Right:** Select all files inside the folder, then zip → `index.html` is at the root

### Dynamic Content (inside ZIPs)
- **Mustache merge fields** for variables
- **SDK Function Calls** for actions (e.g., navigate slides, launch survey)
- Function names + parameters MUST be valid — invalid calls silently fail or throw at runtime
- Details: see the **Content Guidelines** documentation (engineering follow-up to publish list of supported functions)

## Targeting (Account / Territory)

Targeting limits which **users** see a presentation, based on the account + territory context they've selected. Does NOT enforce visibility through the API or via object tabs.

| `TargetingContext` value | Behavior |
|---|---|
| **None** | All presentations shown regardless of targeting |
| **Warn** (a.k.a. Suggestion) | All shown; non-targeted ones display a warning if selected |
| **Restrict** | Only targeted presentations are displayed |

### Where targeting info lives
`ProviderAcctTerritoryInfo.TargetedPresentationInfo` — semicolon-delimited list of Presentation **Source System Identifiers** (NOT Salesforce IDs).

### Recommendations
Separate from targeting. Drives the "Recommended" section in the Intelligent Content tab.

- Source: `ProviderAcctTerritoryInfo.RecommendedPresentationInfo`
- Format: JSON, contains Salesforce IDs

## Search

| Search type | What it queries | Setup |
|---|---|---|
| **Basic** | Presentation name | None |
| **Extended / Advanced** | Admin-configured fields on `Presentation` + `PresentationPageProduct` | Configure `ExtendedSearchPresentationField` + `ExtendedSearchPresPageProductField` settings |
| **Content Search** | Semantic search of presentation **content** | Multi-step setup (see below). Requires Data 360. |

## Content Search Setup (Data 360 required)

**7 steps in order:**

1. **Deploy Data Kit** — Life Sciences Data Kit
2. **Create Data Streams** — for Content Document records
3. **Verify Data Streams, DMOs, DLOs** — check Data Cloud objects are populated
4. **Update Presentation Settings with File Types** — `ContentSearchIndexedFileTypes` (comma-separated)
5. **Re-upload Presentations** — required so the new data stream picks them up
6. **Create Search Index** — semantic index in Data Cloud
7. **Update Presentation Settings with Index Name + enable Content Search** — `ContentSearchIndexApiName` + `ContentSearchEnabled = true`

### Speeding up re-uploads
If you toggle `ExtractFilesFromZip` in Presentation Settings, files are extracted server-side on upload — saves a re-upload cycle but uses more storage.

### Content Search troubleshooting checklist
1. **Are records pushed to Data 360?** Query data streams.
2. **Is content included in the search index?** Inspect the chunk object. If `DataSource` is NOT `version data text`, content was NOT properly indexed.
3. **Is the result being filtered out?** Match score below threshold; or filter rules excluding the result.

> **Engineering follow-up:** Conor committed to share SQL queries to assist with content search debugging.

## Intelligent Content Player

Renders the presentation; large files take time as they download fully to the browser (this is expected, not a bug).

| Capability | Behavior |
|---|---|
| **Feedback** | Thumbs up/down per presentation or per page |
| **Drawing / Laser Pointer** | On-screen annotation tools |
| **Add Attendees** | Add account(s) viewing the presentation |
| **Add Presentations** | Load multiple presentations into the same Player session |
| **Start/Stop Tracking** | Pause/resume click-stream capture mid-presentation |
| **Associate with Visit** | Link the Player session to a Visit |
| **Cancel** | Discard the session — click-stream metrics are NOT saved |
| **Email** | Send a presentation link to an Account |

### Tracking persistence — critical
- Click-stream metrics save **only if the presentation is associated with a Visit**
- Saving the metrics is tied to **saving the Visit**
- If the user **cancels**, metrics are **discarded**

## Send Presentations as Email Links

Required setup:
1. **Community / Experience Cloud site**
2. **Presentation Player component** placed on a page within that site
3. **`PresentationLinkURL`** set in Presentation Settings = the URL of the page hosting the Player
4. **`PresentationLinkExpirationDays`** controls how long the link is valid (default 7)

When a user emails a presentation:
- A `PresentationPartyAccess` identifier is generated
- The link in the email points to the Experience Cloud page with the identifier in the URL
- External viewer accesses the presentation via the embedded Player

## Admin Console — Intelligent Content

| Tab | Purpose |
|---|---|
| **Presentations** | Upload, update version, activate/deactivate, "delete," edit territory alignment, manage page associations and product/message mapping |
| **Presentation Pages** | Edit, activate/deactivate. Deactivated pages are hidden from any presentation containing them (without deleting the presentation). |
| **Presentation Settings** | Global feature toggles (see Settings Reference) |
| **API Job Queue** | API requests to the Content API for presentation operations (Content API is a separate upload path, owned by another team) |

> **Common upload bug:** Click the **Apply button on step 2 of the upload wizard** when associating pages with products/messages — easy to miss.

## Presentation Settings Reference

### Targeting
| Setting | Purpose |
|---|---|
| `TargetingContext` | None / Suggestion / Restriction |

### Search
| Setting | Purpose |
|---|---|
| `ExtendedSearchPresentationField` | Field on Presentation included in extended search |
| `ExtendedSearchPresPageProductField` | Field on PresentationPageProduct included in extended search |
| `ContentSearchEnabled` | Toggle Data Cloud content search |
| `ContentSearchIndexApiName` | Semantic index API name |
| `ContentSearchIndexedFileTypes` | Comma-separated indexed file types |

### Grid UI
| Setting | Purpose |
|---|---|
| `ManageCustomPresentation` | Show "My Presentations" tab |
| `EnableSendingByEmailLinks` | Allow emailing presentations as links |
| `EnableControlsCollapse` | Collapse content category sections by default |

### Email Link Delivery
| Setting | Purpose |
|---|---|
| `PresentationLinkURL` | Base URL of the player on Experience Cloud |
| `PresentationLinkExpirationDays` | Link validity in days (default 7) |

### Player Runtime
| Setting | Purpose |
|---|---|
| `TrainingModeEnabled` | Training mode |
| `ShowSequenceNames` | Show page/slide names in player |
| `VisualIndicator` | Show visual indicators |
| `DisablePresenterTracking` | Skip presenter click-stream tracking |
| `DisableParticipantTracking` | Skip participant click-stream tracking |
| Pause tracking when player launches | Player starts paused. A Visit launch records nothing until the rep taps play. See [support-engineering-pause-tracking-on-launch.md](./support-engineering-pause-tracking-on-launch.md). |
| `ContentRatingBottomBar` | Rating in bottom bar |
| `ContentRatingMainView` | Rating in main view |
| `EnableDrawing` | Enable drawing tool |
| `EnableLaserPointer` | Enable laser pointer |

### Survey
| Setting | Purpose |
|---|---|
| `EnableRetake` | Allow survey retake |
| `EnableRetakeWithCopyingLastResponses` | Allow retake with copied prior responses |

## Custom Presentations (262)

A 262 release feature lets sales reps create custom presentations by **reusing pages from existing ZIP-based presentations**. Managed within the Intelligent Content tab:
- Add, remove, reorder slides drawn from the existing page pool
- Driven by `ManageCustomPresentation` setting

## Troubleshooting

### "Presentation upload fails with validation error"
**Cause (most common):** ZIP parent folder included — file structure is wrong.
**Fix:** Re-zip by selecting all files INSIDE the folder, not by zipping the folder itself. `index.html` must be at the ZIP root.

### "Content Search returns no results"
1. Confirm records pushed to Data 360 (query data streams)
2. Inspect the chunk object — `DataSource` should be `version data text`. If not, content wasn't indexed.
3. Verify `ContentSearchIndexedFileTypes` includes the file type
4. Confirm `ContentSearchEnabled = true` and `ContentSearchIndexApiName` is set
5. After config changes: re-upload presentations

### "Presentation grayed out / cannot be selected"
**Cause:** `TargetingContext = Restrict` AND the presentation's Source System Identifier isn't in `ProviderAcctTerritoryInfo.TargetedPresentationInfo` for this account/territory.
**Fix:** Add the SSI to the PATI record, or change `TargetingContext`.

### "Email link doesn't open the presentation"
1. Verify `PresentationLinkURL` is correct (the Experience Cloud page hosting the Player)
2. Verify the Player component is placed on that page
3. Check `PresentationLinkExpirationDays` — link may have expired
4. Verify Experience Cloud site is published and the external user has access

### "Click-stream metrics not saved after presentation"
1. Was the presentation **associated with a Visit**? (Required.)
2. Was the **Visit saved**? Metrics save together with the Visit.
3. Did the user **cancel** the Player? Cancel discards metrics by design.

### "Recommendations not showing"
**Cause:** `ProviderAcctTerritoryInfo.RecommendedPresentationInfo` is empty or contains invalid JSON.
**Fix:** Populate the field with valid JSON containing Salesforce IDs of presentations.

### "Page deactivated — but presentation still seems to include it"
**Cause:** Browser cache or stale metadata cache.
**Fix:** Refresh; deactivated `PresentationPage` records ARE hidden when a containing presentation is presented.

## Reference

- **Source deck:** Intelligent Content in Life Sciences Cloud (LSC), Spring '26 — slide ID `1Y18bzl0_Jjd7AmRQDpx5DypvKeteWnu71tzMhy7j1gY`
- **Source transcript:** Gemini, May 19, 2026 session — doc ID `1tx71Uv-2lqywAbDy0B43YIPDO-xSlMxB`
- **Companion files in this module:** `admin-1-talk-track-for-content-management.md`, `admin-2-talk-track-for-presentation-settings.md` (PM-side baseline)
- **Related — Visit sidebar:** see `visit-management/support-engineering-visit-engagement-side-menu.md` for how `TargetingContext` impacts the Presentations sidebar section during a Visit
- **Engineering follow-up:** ZIP samples + SDK function list + content-search debugging SQL pending (Conor Fanlo to share)
