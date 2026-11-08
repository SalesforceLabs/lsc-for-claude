# Field Events Management — Troubleshooting

## "We couldn't add the participant to the event either because the participant type and role aren't mapped for this event type or because the mapping record isn't active"

**Where it shows up:** On a `MngEvent`'s Attendees tab, specifically on the **Non-Profiled Attendees** and/or **Write-Ins** cards. Unlike a normal validation toast, this is load-bearing — the card never renders its **Update / + Add** button at all, so the participant category is completely unusable, not just showing a warning. Experts, Attendees, and Colleagues are typically unaffected.

**Do NOT assume this is just an inactive `EventMgmtPtcpTypeRoleMap` row.** In practice the mapping row usually already exists and is already `IsActive = true` — that's a red herring. The real defect is one level up, on the **role** the mapping row points to.

### Root cause

`EventMgmtParticipantRole` has two picklist fields that look redundant but aren't:

- **`Role`** — a normal (non-restricted-looking, but actually still restricted) picklist that *does* include `NonProfiledAttendee` and `WriteInAttendee` as valid values.
- **`StandardRole`** — a **restricted** picklist that does **not** include `NonProfiledAttendee` or `WriteInAttendee`. Its full value set (verified on Summer '26 / API v66.0) is: `Organizer, Coorganizer, Coordinator, Contributor, Approver, HostOrganizer, HostSpeaker, SatelliteOrganizer, Attendee, Expert, Other`.

Because no valid `StandardRole` value exists for these two categories, orgs frequently never end up creating a dedicated `EventMgmtParticipantRole` record for them at all. Instead, whoever configured `EventMgmtPtcpTypeRoleMap` reused the plain **Attendee** role (`StandardRole = Attendee`) for the `NonProfiledAttendee` and `WriteInAttendee` type mappings. The platform can't resolve a Non-Profiled Attendee / Write-In add action against a role that isn't actually typed as that role, so it refuses to render the add action and surfaces the generic "aren't mapped ... mapping record isn't active" error — even though, from a naive `EventMgmtPtcpTypeRoleMap.IsActive` check, everything looks fine.

### Diagnose

1. Confirm the symptom is really this bug and not a genuinely missing/inactive mapping row:
   ```sql
   SELECT Id, Name, MngEventTypeId, EventMgmtParticipantTypeId, EventMgmtParticipantRoleId, IsActive
   FROM EventMgmtPtcpTypeRoleMap
   WHERE MngEventTypeId = '<the event's MngEventTypeId>'
   ```
   If you see active rows for `EventMgmtParticipantTypeId` = the org's "NonProfiled"/"WriteIn" `EventMgmtParticipantType` records, don't stop here — check what role they point to next.

2. Look up the roles those mapping rows reference:
   ```sql
   SELECT Id, Name, Role, StandardRole FROM EventMgmtParticipantRole
   ```
   If the `EventMgmtParticipantRoleId` on the NonProfiledAttendee/WriteInAttendee mapping rows resolves to a record with `Role = Attendee` (i.e. the same role used for the plain Attendee mapping) rather than `Role = NonProfiledAttendee` / `Role = WriteInAttendee`, that confirms this bug.

3. Confirm no correctly-typed role record exists at all — this is usually the case:
   ```sql
   SELECT Id, Name, Role, StandardRole FROM EventMgmtParticipantRole
   WHERE Role IN ('NonProfiledAttendee', 'WriteInAttendee')
   ```
   Zero rows = confirmed.

4. `describe_sobject` does not surface picklist values. To see the actual `StandardRole` value set (needed before picking a fallback value in the fix below), hit the REST describe endpoint directly:
   ```bash
   sf api request rest "/services/data/v66.0/sobjects/EventMgmtParticipantRole/describe" \
     --target-org <org> --stream-to-file /tmp/role_describe.json
   ```
   then inspect `fields[].picklistValues` for `Role` and `StandardRole`.

### Fix

1. Create one dedicated `EventMgmtParticipantRole` record per missing category. Since `StandardRole` has no matching value, use `Other`:
   ```
   create_record EventMgmtParticipantRole
     Name: "LSC NonProfiled Attendee Role"
     Role: "NonProfiledAttendee"
     StandardRole: "Other"

   create_record EventMgmtParticipantRole
     Name: "LSC WriteIn Attendee Role"
     Role: "WriteInAttendee"
     StandardRole: "Other"
   ```

2. Repoint **every** existing `EventMgmtPtcpTypeRoleMap` row for the NonProfiledAttendee/WriteInAttendee `EventMgmtParticipantType` to the new role (there is typically one row per `MngEventType`, so do this for all of them, not just the event type you're debugging — the misconfiguration is almost always org-wide, not per-event-type):
   ```sql
   SELECT Id, Name, MngEventTypeId, EventMgmtParticipantTypeId
   FROM EventMgmtPtcpTypeRoleMap
   WHERE EventMgmtParticipantTypeId IN ('<NonProfiled type Id>', '<WriteIn type Id>')
   ```
   Then `bulk_update_records` on `EventMgmtPtcpTypeRoleMap`, setting `EventMgmtParticipantRoleId` to the matching new role Id for each row (NonProfiled rows → the NonProfiled role, WriteIn rows → the WriteIn role). Leave `IsActive` alone — it was already `true`.

3. Verify by reloading the event's Attendees tab: the error text should be gone and the card should show its normal **+ Non-Profiled Attendee** / **+ Write-Ins** action. As a full end-to-end check, add a participant through that action and confirm the new `MngEventParticipant` record's `EventMgmtPtcpTypeRoleMapId` resolves to the row you just fixed:
   ```sql
   SELECT Id, Name, EventMgmtPtcpTypeRoleMapId, EventMgmtParticipantTypeId, EventMgmtParticipantRoleId
   FROM MngEventParticipant
   WHERE Id = '<new participant Id>'
   ```

### Don't chase these dead ends

- **Don't just flip `IsActive` on the existing mapping row.** It's usually already `true` — the row points at the *wrong role entirely*, which `IsActive` can't fix.
- **Don't try to set `StandardRole` to `NonProfiledAttendee`/`WriteInAttendee`.** It's a restricted picklist without those values; `create_record`/`update_record` will fail with "bad value for restricted picklist field." Use `Other`.
- **Don't assume this is a permission/sharing issue.** The mapping rows in question are typically owned by the same user as the working Expert/Attendee/Colleague mappings — sharing is not the differentiator.

## Email Invitation to Attendees shows "Email Templates (0) / No templates are available"

**Where it shows up:** On the iPad, on a managed event: **Actions → Email Invitation to Attendees → Send Email**. It happens even when the device DB has the templates, sharing is correct and sync works.

### Root cause

The app first loads all active local `LifeSciEmailTemplate` rows, then filters them for the event (`SendEmailCoordinator.additionalFiltering`, lifesciences-ios). Only templates reachable through the event's Subjects are kept:

`SubjectAssignment` (`AssignmentId` = the `MngEvent`) → `Subject` → `SubjectMaterialTemplate` (`TemplateType = 'Email'`, `TemplateReferenceId` = the `LifeSciEmailTemplate`)

If the event has no `SubjectAssignment`, or its Subjects have no Email `SubjectMaterialTemplate`, the list is 0. Template fields such as `EmailInvitationContextType` and `EmailInvitationActionType` don't affect this picker.

### Fix

1. Make sure the template is active, has a start date on or before today, and is shared with the reps. Sharing is a Manual read share to a public group, because the sharing model is Private.
2. For each Subject, create a `SubjectMaterialTemplate`:
   - `Name`: `Email Template`
   - `SubjectId`: the Subject
   - `TemplateType`: `Email`
   - `TemplateReferenceId`: the `LifeSciEmailTemplate` Id

   `LifeSciEmailTemplateId` is derived from `TemplateReferenceId` and can't be written. Setting it fails with "Field is not writeable".
3. Give each event a Subject. Put it on the Products and Topics tab, or insert a `SubjectAssignment` with `SubjectId` and `AssignmentId` = the event Id. `ManagedEventReferenceId` can't be written either.
4. Do an incremental sync. Both new record types sync as new rows.
5. Check on the iPad: **Actions → Email Invitation to Attendees** now shows "Email Templates (N)".

**Org-wide alternative:** The email setting `DisableTemplateFilteringOnMeetings = true` skips this filter and shows all active templates. It applies to every meeting, so use it only to confirm the diagnosis.

### Verified

In org 26lsdo-july, the filter was empty. 262 had 0 `SubjectMaterialTemplate` rows and 1 `SubjectAssignment`, on a Draft event. 264-pm-trial had 10 `SubjectMaterialTemplate` rows. After script 07 and an Immunexis `SubjectAssignment` on Barcelona Clinical Practice Exchange (Approved), the iPad showed "Email Templates (1): Managed Event Invitation".

## Other iPad picker and action problems (field-tested)

Each of these has an entry in `known-causes.yaml` (`diagnose_lsc_issue` matches the symptom text).

| Symptom on the iPad | Cause | Fix |
|---|---|---|
| Email picker lists a template that says "Template cannot be downloaded" | The template has no usable body: no Active `LifeSciEmailTmplSnapshot` with an `EmailBody` and `Language` = `en_US` (a value like `en_US;fr` is not found) | Delete that template's `SubjectMaterialTemplate` rows, and set the snapshot `Language` to `en_US`. Link only templates that have a body |
| **+ Actuals** line item picker is empty | `ExpenseType` has no parent/child hierarchy, no `Classification`, or `ExpenseAvailabilityType` is not `ManagedEvent` (`ManagedEventAndVisit` types were hidden) | Parents = Estimate categories, children = Actual types; set `Classification`, availability `ManagedEvent`, `AllocationType` (null breaks allocation), `IsIncludedInCap` where a cap applies |
| New Experts picker: "Empty list" | Experts need `Status` = Approved, a `Type` (HCP) and an unexpired `ExpertSubject` for the event's Subject | Fix the expert rows and add `ExpertSubject` rows with a future `ExpirationDate`; sync |
| Invite expert, Save: "You do not have access to the Accounts linked to Speakers" | The app requires the expert's Account to be in the rep's territory (`ObjectTerritory2Association`, cause `Territory2Manual`); server read access is not enough | Align the expert Accounts to the rep's territory; sync the device |
| Expert list is filtered, Account Search button is missing | Eligibility checks apply when the event has a Speaker Bureau Subject **and** the user can read `Subject.ComplianceType`; only trained experts show | By design. Test Account Search on an event without a Speaker Bureau Subject |
| Submit for Approval (or any stage action) does nothing | Stage actions are record updates; a rep with read-only access (event owned by someone else) can't run them | Test on an event the rep owns, or transfer or share it. Not a configuration bug |
| A Component stage action closes the menu and nothing opens | Wrong component name, bad `Parameters` JSON, or a component not exposed in the build. No error is shown | Compare with the Admin and End User Guides. **Add Speaker is not a documented action**: reps add experts from Attendees → Experts → New. Remove an Add Speaker action instead of fixing it |
| Cap handler error `Malformed JSON … ProviderActivityMeasureType … Criteria: []` on an `ExpenseParticipant` insert | The criteria path `MngEvent.Status` resolves through `ExpenseParticipant.MngEventId`, which can't be written from Apex | Pause `ExpenseParticipantMonetaryCapsHandler` while seeding, re-enable it and confirm it is active. Test cap warn and block in the UI |
| Server fixed, iPad unchanged | The metadata cache and data sync are separate; sharing changes and no-op saves don't advance `LastModifiedDate` | Begin Sync → Sync, accept "New metadata", wait for "Synced". To force records out, change a field and restore it |

## Setup checklist for a new org (order matters)

1. **Trigger handlers.** `LifeScienceTriggerHandler` may be reachable only through the Tooling API (`sf data query/update record --use-tooling-api`); if `list_trigger_handlers` / `toggle_trigger_handler` can't see it, use that. Activate the handlers named in the Admin Guide plus the cap and utilization ones (`*MonetaryCapsHandler`, `MngEventAcctUtilLmtsHandler`, `MngEventPartAcctUtilLmtsHandler`). Leave `MngEventBusinessHoursHandler` off unless `BusinessHours` syncs.
2. **Expense types.** Parent (Estimate) → child (Actual) hierarchy, `Classification`, `ExpenseAvailabilityType = ManagedEvent`, `AllocationType`, `IsIncludedInCap`.
3. **Participant model.** Types, roles and `EventMgmtPtcpTypeRoleMap` rows per `MngEventType`; org-level `ManagedEventOrgLevelConfig` (default roles, venue resource type, Confirmed resource status, closed statuses, statuses to calculate actuals); profile-level `ManagedEventConfig`.
4. **Subjects.** Managed Event and Speaker Bureau Subjects, Email and Presentation `SubjectMaterialTemplate` rows, and a `SubjectAssignment` on every event.
5. **Experts.** Approved, typed, unexpired `ExpertSubject`; expert Accounts aligned to the rep's territory.
6. **Email templates.** Sharing (public group + Manual read share, since the OWD is Private), Active snapshot with a body, Subject links.
7. **Monetary cap chain.** Activity Plan (type *Event Management Limit*, active, with Time Period) → Provider Activity Goal per provider → Provider Activity Measure Type (Category `MonetaryCapLimit`, `ActivityObject = ExpenseParticipant`, AlertType Warning or Error, criteria JSON) → Goal Measure → Goal Limit (`MonetaryLimit`; Warn and Block are separate measure types). The event dates must fall inside the plan's time period, and the cap handlers must be on.
8. **Workflow path.** `LifeSciStageObject` (MngEvent) → `LifeSciStageOperation` → `LifeSciStageOperationAction` → `LifeSciStageAction` (`RecordUpdate` with `FieldApiName` / `FieldValue`, or `Component` with JSON `Parameters`). Submit for Approval is a RecordUpdate of Status to PendingApproval.
9. **Profile and sync.** Rep profile assigned in the sync configuration, sharing and territory for the rep, then a device sync.
10. **UI-only settings** (can't be scripted): colleague field sets, `ComplianceSubjectField`, `ActiveTrainingFieldName`, "Related List - Life Sciences" components, Utilization Tracker and Record Update Notifier on pages, Event Type and Participant Type Mapping tabs, Concur settings.

Cap criteria JSON (the `value` is `;`-separated; use real `MngEvent.Status` values — the guide's "Completed" is *Concluded*):

```json
{"contextCondition":{"conditions":[{"field":"MngEvent.Status","operator":"In","value":"Draft;Concluded"}]},
 "utilizationConditions":{"estimated":{"conditions":[]},"committed":{"conditions":[]},"actual":{"conditions":[]}}}
```

## Data-model facts that save trial and error

- The object is `MngEvent`. Required on insert: `Name`, `MngEventTypeId`. Status values: Draft, PendingApproval, Approved, Execute, Concluded, Closed, Cancelled. Setting `Status` through Apex walks the path, so set each step in order.
- `MngEventParticipant.ParticipantId` is an Account; `EventMgmtPtcpTypeRoleMapId` carries role and type per event type. The owner is added automatically as a participant.
- `MngEventResource.ResourceType` and `Status` are restricted picklists whose values describe() doesn't list. Take them from existing rows or the org config (`Venue`, `Confirmed`).
- `EstimatedExpense`: `ExpenseSourceId` = event, `ExpenseTypeId`, `Amount`. `Expense`: `ExpenseOriginId` = event, `RelatedExpenseTypeId`, `EstimatedExpenseId`, `ExpenseType` (e.g. Billable). `ExpenseParticipant`: `Name`, `ExpenseId`, `ParticipantId` = `MngEventParticipant`, `Amount`; `MngEventId` is read-only.
- `ProviderActivityMeasureType` has `DeveloperName` / `MasterLabel`, not `Name`. Editing it in the same transaction as non-setup DML gives `MIXED_DML_OPERATION` (same for group membership and shares: use separate scripts).
- `LifeSciEmailTemplate` (prefix `1LL`): the body lives in `LifeSciEmailTmplSnapshot` and `LifeSciEmailTmplRelaFrgmt`.

## How to investigate

- **Read the guides first.** Check the Admin Guide, End User Guide and release videos before building config; the Add Speaker action and a `ManagedEvent/Create` template context were detours for things the guides don't have. When a user shows a working screen, trust it over a theory.
- **Separate server problems from device problems.** Query as the rep (`sf data query -o <rep alias>`) to prove what the rep can see, then check the device database (profile → View Database) for what synced. Most "empty picker" cases were sync, territory or Subject-link issues, not missing records.
- **Find the real filter in the app source** when a picker is empty (the Subject rule was found in `SendEmailCoordinator.additionalFiltering`); don't guess at context-type fields.
- **Seed scripts:** use try/catch per DML stage with `System.debug` markers (an unhandled platform error returns only `UNKNOWN_EXCEPTION`), run stages as separate scripts, keep them idempotent with one concern each.
- **Handlers fire on seed data.** Pause one handler for the seed run instead of removing logic, then re-enable it and verify it is active.
- **Test with a rep-owned event** at each stage (Draft, Approved, Execute, Concluded) so approval, sign-in and actuals can be exercised.
- CLI: `sf data query` prints a warning before JSON, so use `--json 2>/dev/null` and parse from the first `{`.
