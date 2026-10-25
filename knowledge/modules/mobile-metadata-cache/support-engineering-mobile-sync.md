# Mobile Sync Architecture — Support Engineering Training

**Session:** LSC4CE Value Chain Training — Feb 17, 2026
**Audience:** Support engineers
**Source:** Engineering training series (Gemini transcript + reference deck slides 56–61)
**Presenter:** Hyderabad team

## Overview

End-to-end walkthrough of what happens behind the scenes when a Life Sciences Cloud (LSC) user logs into the mobile / iPad app, syncs data, and works offline. The model has two halves: **metadata** (defining what objects/fields are downloaded) and **data** (the actual records). The sync engine round-trips both via a two-stage transaction pattern.

```
        ADMIN                                MOBILE/iPad USER
          │                                         │
   ┌──────▼──────┐                          ┌───────▼───────┐
   │ Admin       │   metadata generation    │ App login     │
   │ Console     │ ──────────────────────►  │ → download    │
   │ (configure  │   stored as ZIP in CMS   │   metadata    │
   │  metadata)  │                          │ → create      │
   └─────────────┘                          │   local DB    │
                                            │ → download    │
   ┌─────────────┐                          │   data        │
   │ Salesforce  │ ◄────── data download ───┤   (territory- │
   │ objects     │                          │    bound)     │
   │ (Account,   │                          └───────┬───────┘
   │  HCP, etc.) │                                  │
   └──────▲──────┘                          ┌───────▼───────┐
          │                                 │ Offline work  │
          │  ┌──── sync engine ────┐        │ → captures    │
          │  │ processes pending   │        │   visits etc. │
          └──┤ device sync         │ ◄──────┤ → comes online│
             │ transactions        │        │ → pushes via  │
             └─────────────────────┘        │   composite   │
                                            │   API         │
                                            └───────────────┘
```

## Phase 1 — Metadata Generation (Admin Side)

1. Admin logs into Salesforce and opens **Admin Console → Object Metadata Cache Configuration**.
2. For each object that should reach mobile, admin marks it **Active**, sets type (Data vs. Configuration), and configures sync parameters (see "Metadata Cache Settings" below).
3. Admin clicks **Generate Metadata** for a profile (or set of profiles).
4. A background service reads the Admin Console configuration and persists a compressed **ZIP file** to the CMS / Files. **One base template + one per profile** are generated, so for N selected profiles you get N+1 metadata files.
5. The base template is the common one; the profile-specific files contain only the deltas (which fields/objects are accessible for that profile).

**Where to find the generated metadata:** Setup → Files (CMS). Each metadata generation produces a new ZIP entry. The mobile device downloads the ZIP, parses it, and uses it to infer which entities and fields to query from the CRM.

## Phase 2 — Initial Login & Data Download (Mobile Side)

1. User opens the mobile app and enters credentials. A **connected app** handles the OAuth flow.
2. Once authenticated, the device requests the metadata ZIP allocated to the user's profile and downloads it.
3. The mobile app **creates a local database** based on the metadata schema (the objects and fields the user should see).
4. For each entity marked Active in metadata, the device pulls the **associated data** from Salesforce — filtered by territory and any configured WHERE clauses (see "Metadata Cache Settings").
5. The user is now ready to work offline.

## Phase 3 — Offline Work + Upload Cycle

1. User captures changes offline — creates a visit, modifies an account, adds a digital signature, etc. All changes persist in the **local mobile database**.
2. When the user comes back online, the mobile app pushes pending changes to Salesforce using the **composite API**.
3. Changes are **NOT pushed directly to the target objects.** Instead they land in a **two-stage transaction queue**:
   - **Stage A — `DeviceSyncTransaction`** (master) — one record per atomic batch
   - **Stage B — `DeviceSyncTransactionRecord`** (children) — one per actual object change inside the batch
4. A **sync engine** (server-side) processes the queued transaction records and pushes them to the actual Salesforce objects (Account, HCP, Visit, etc.).
5. On the next sync down, the device receives the updated records — this time with their Salesforce IDs filled in (which is how the mobile app knows the upload succeeded and clears the local pending state).

### Atomicity

Multiple object changes that belong together (e.g., creating an Account + HCP + HCP Specialty in one rep action) are grouped into a **single DeviceSyncTransaction** so that they succeed or fail together (all-or-none).

If the number of child records exceeds the configured per-transaction maximum (default recommendation: **10 records**), the system splits them into multiple transactions **while maintaining dependency links** between them, so atomicity is preserved across the split.

## Phase 4 — Transaction Lifecycle

A `DeviceSyncTransaction` cycles through these states:

| State | Meaning | Next |
|---|---|---|
| **Received but not processed** | Pushed to CRM, waiting for sync engine to pick up | → Processing |
| **Processing / Retry** | Sync engine is working on it (or retrying after a transient error) | → Success or Failed |
| **Successfully Processed** | Pushed to the actual Salesforce objects | (Terminal — cleaned up after next mobile sync down) |
| **Failed** | Permission denied, dependency missing, validation rule blocked, etc. | (Terminal — admin can manually adjust or re-trigger) |
| **Cancelled** | Admin explicitly cancelled before processing | (Terminal) |
| **Manual Adjustment** | Admin marked for manual handling (e.g., DCR pending approval) | (Terminal — pending admin action) |

**Cleanup:** the mobile device only removes pending records from its local store after receiving an **acknowledgment** from the CRM on the next sync down. So Success and Failed both count as "done from mobile's perspective" — the device clears either.

## The Six Sync Types

| Sync Type | Trigger | Blocks UI? | Scope |
|---|---|---|---|
| **Initial Sync** | First-time login | ✅ Yes | Metadata + all assigned data |
| **Manual Sync** | User taps "Begin Sync" in profile menu | ✅ Yes | Metadata + delta data |
| **Territory Switch** | User changes territory in profile picker | ✅ Yes | Metadata + full data re-download (acts like initial sync) |
| **Days Offline Limit** | Configured threshold reached (default 10, recommend 7) | ✅ Yes (forces user online + sync) | Upload + full metadata refresh |
| **Background Sync** | App reopened while online | ❌ No | Data delta only (no metadata refresh) |
| **Upload-Only Sync** | Any change captured while user is online | ❌ No | Immediate push to CRM |

**Why most are blocking:** the first four involve **metadata refresh** — that's a structural change to the local DB that can't safely happen while the user is interacting with the UI. Background sync only does data and is safe to run concurrently.

**Upload-Only sync philosophy:** the system's bias is to keep mobile lightweight — any change captured while online is pushed to CRM immediately, rather than buffered locally. Local buffer is only used when truly offline.

## Metadata Cache Settings (per object)

Configured in **Admin Console → Object Metadata Cache Configuration → [object]**:

| Field | Purpose |
|---|---|
| **Is Active** | Master switch — when false, nothing about this object is downloaded |
| **Type** | `Data` (records flow both ways) or `Configuration` (read-only / structural) |
| **Status** | `Empty` / `Validating` / `Error` / `Cancelled` / `Validated` — generation lifecycle |
| **Profiles** | Which profiles get this object in their metadata |
| **One-Way Sync** (renamed in product UI to **"Web-to-Mobile Sync"**) | When true, data only flows CRM → mobile; mobile changes are NOT pushed back. Use for historical/reference tables. |
| **Delta Date Field** | The **date field** used to determine "what's new since last sync." Typically `LastModifiedDate`. Customer can use a custom date field — but it MUST be a date type, no other field types are accepted. |
| **Where Clause** | Filter for which records get downloaded. Two modes: simple (multiple AND/OR conditions via a builder) or **Advanced** (raw dynamic SOQL-style WHERE). Essential when an org has 10K+ records of an entity — without filtering, the device would download all of them. |
| **Attachment Behavior** | `Background` (downloaded in a background thread) or `Cached` (synced inline with the record) |

## Troubleshooting

### Symptom: "I changed data on mobile but it's not showing on CRM"

Diagnosis path:
1. **Check the DeviceSyncTransaction record for that user/session.**
   - Was the upload processed successfully? If yes → see step 2.
   - Was it Failed? Read the `DeviceSyncTransactionLog` for the error (permission, dependency, validation). Child rows still present on `DeviceSyncTransactionRecord` means the client submitted them — that is not silent data loss. For a Visit submit whose Presentation Forum, click stream, or disbursement is missing on web, follow [support-engineering-visit-sync-not-data-loss.md](../visit-management/support-engineering-visit-sync-not-data-loss.md).
   - Was it Cancelled or Manual? Admin intervention is pending.
2. **Was it processed but reverted?** Check the object's history — another user or admin may have overwritten the change.
3. **Is the object subject to Data Change Request?** If the entity requires DCR approval, the change is in pending-approval state, not actually applied. Look in the DCR queue.

> **Quick query (Workbench):** `SELECT Id, Status, Log, RecordId FROM DeviceSyncTransactionRecord WHERE ParentId IN (SELECT Id FROM DeviceSyncTransaction WHERE CreatedById = '<userId>') ORDER BY CreatedDate DESC`

### Symptom: "Data is on the CRM but not visible on mobile"

This is almost always an access/permission/metadata issue, not a sync engine issue.

Diagnosis path:
1. **Verify the data is accessible to the user** — log in as the user in the web UI and see if the record is visible. If not, it's a sharing/permission issue, not a mobile issue.
2. **Check the metadata generation** — did the user have access to the field/object **at the time metadata was generated**? Metadata is a snapshot. If access was granted after the last metadata generation, the user won't see the data on mobile.
3. **Re-generate metadata** for the user's profile (Admin Console → Object Metadata Cache → Generate Metadata).
4. **Have the user run a manual sync** so the new metadata reaches the device.
5. If still missing after the above — examine the generated metadata ZIP in CMS / Files. If the field/object isn't in the ZIP, it's a metadata bug. If it IS in the ZIP and still not on mobile, escalate.

### Symptom: "Mobile won't let user do anything — blocking popup"

Cause: **Days Offline Limit** hit. The blocking popup forces the user to come online and push their data before allowing any further action. This is intentional — prevents data loss from a device that's been offline too long.

Fix: have the user come online, dismiss the blocker by completing the forced sync.

### Symptom: "Records are duplicating / atomicity broke"

Cause: The per-transaction record limit was misconfigured (e.g., too low) and the split logic created a broken dependency chain.
Fix: check the **Max Transaction Records per DeviceSyncTransaction** setting in Admin Console. Recommendation: **10**. Values below 5 cause excessive splitting; values above 50 can hit composite API limits.

### Symptom: "Where is the metadata stored?"

The generated metadata ZIPs live in **Files** (CMS). Navigate: Setup → Files → search by recent date or by the metadata generation timestamp. Each generation produces a new file. The mobile device pulls the latest one for its profile on sync.

## Cross-Reference

- **Programmatic metadata generation:** see [`programmatic-generation.md`](./programmatic-generation.md) in this module for the API path to generate metadata via Apex / SOAP (alternative to Admin Console clicks).
- **Quotas / Throttling:** if you're seeing composite API failures on upload, check org-level API quotas — sync uses composite API and shares the quota pool with regular integrations.
- **Idle Background Sync:** Spring '26 added the periodic background scheduler that triggers background syncs even when the app is foregrounded but idle — see release notes for 260.
- **Reference deck slides:** Slides 56–61 of the Sync deck cover the architecture diagram, sync types, and metadata cache settings in visual form. The .pptx is available in the LSC4CE Value Chain Training Drive folder (file `1-bn2827Goc7XjnVFTf6YIzGBB8E62Syw`).
