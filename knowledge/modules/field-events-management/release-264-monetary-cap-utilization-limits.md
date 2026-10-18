# Monetary Cap and Utilization Limits - Winter '27 (264)

Applies to: iPad and Web. Status: GA.

## What's New

Automated controls for speaker compensation caps and attendee utilization limits during event planning, with real-time validation before an event is submitted.

- Monetary Cap: annual or quarterly compensation limits for HCP and KOL services. Committed speaker fees are checked against the total cap during speaker selection and expense allocation.
- Utilization Limits: country- or region-specific participation rules for HCPs attending in-person, virtual, and hybrid events. Checked at participant selection.

## Admin Setup & Configuration

### 1. Enable processing and user feedback
- Admin Console > Trigger Handler Administration: enable the monetary cap and utilization limit trigger handlers (see Reference below).
- Lightning App Builder: add **Utilization Tracker** to the Account record page; add **Record Update Validation Notifier** to the Managed Event record page.

### 2. Statuses and expense types
- Admin Console > Event Management > **Field Events Org Level Settings**: set **Concluded Event Statuses** so exceeded limits warn rather than block after the event occurs.
- Expense Types: select **Included in Cap** for each expense type that should count toward monetary-cap validation.

### 3. Activity Plan and Provider Activity Goals
- Create an Activity Plan with Type = **Event Management Limit**, set Active, and create a Time Period linked to the plan. One plan can cover monetary caps, utilization limits, or both.
- Create a Provider Activity Goal per account requiring validation, linking the participant account to the Activity Plan. Create separate goals for monetary caps and utilization limits. Use bulk data loading for many accounts.

### 4. Criteria, limits, measures, sharing
- Create Provider Activity Measure Types using the provided starter script: label, Alert Type, and criteria JSON for monetary cap or utilization validation; define qualifying event statuses and expense buckets.
- Create a Provider Activity Goal Limit for each goal and enter the monetary or activity limit.
- Create a Provider Activity Goal Measure linking the Provider Activity Goal and Provider Activity Measure Type, with Type = Event Management Limit.
- Share Provider Activity Goals with territories based on provider account-to-territory alignment.

The system calculates monetary expense buckets or utilization activity values from the configured criteria.

## End-User Flow

- Add attendees/experts: if an HCP has reached a cap or limit with Warn or Error behavior, the addition is warned or blocked.
- From the search screen, users can open Account profiles to review limits, current utilization, and remaining availability before selecting an eligible HCP.
- Reserve speaker fee: add the estimated speaker fee to the event and allocate it to the expert. The allocated estimate is held against the expert's monetary cap before submission for approval.
- Post-event: after the event begins, organizers can record actual speaker fees and add walk-in attendees even if this exceeds a cap or limit. The system allows the action, shows a warning, and creates a **Managed Event Participant Discrepancy** for compliance review and reporting.

## Limitations / Gotchas

- Before the event, exceeded limits block (or warn, per configured behavior); after Concluded Event Statuses apply, they warn instead.

## Reference (verified in Help)

### How the cap is calculated
- Expenses fall in three buckets: estimated, committed, actual. Only expense types marked **Included in Cap** count; `IsIncludedInCap = false` records are ignored.
- In progress: `Total = MAX(Actual, Estimated + Committed)`. Once the event reaches a status listed in **Concluded Event Status** (Field Events Org Level Settings), `Total = Actual`; estimates drop out.
- Limit lives on **Provider Activity Goal Limit**; totals roll up onto **Provider Activity Goal Measure** (Committed/Actual/Estimated/Total Expense Amount). Bucket detail and currency rates are stored as JSON in `ProviderActivityGoalMeasure.AdditionalInformation`.
- Actual expense = parent **Expense** with child **Expense Participant**; estimated = parent **Estimated Expense** with child **Estimated Expense Participant Allocation**.
- Alert type: **Error** blocks the action; **Warning** allows it and creates a **Managed Event Participant Discrepancy**. If both block and warn measure types apply, block wins.

### Provider Activity Measure Type (create via Developer Console > Debug > Open Execute Anonymous Window, Apex `insert`)
- `Category='MonetaryCapLimit'`, `IsActive=true`, `AlertType='Warning'` or `'Error'`; create one record per alert type with unique `DeveloperName`/`MasterLabel`.
- Version 1: `ActivityObject='ExpenseParticipant'`, criteria with `contextCondition` + `utilizationTypes` (actual bucket required); actual expenses only. Saving with version 2 JSON here fails.
- Version 2: `ActivityObject='EventManagementExpenses'`, `"version":2`, nodes `ExpenseParticipant`, `EstimatedExpensePtcpAlloc` (each with `contextCondition` + `expenseBuckets`) and `MngEventParticipant` (`contextCondition` only). Without the `MngEventParticipant` node, participants are never blocked.
- Operators are Pascal case (`Equals`, `In`, `NotEquals`, `NotIn`); lowercase fails silently or errors. Relationship paths up to 5 levels (e.g. `MngEvent.Status`). Multiple values are semicolon-separated.
- Then create Provider Activity Goal Measure (type Event Management Limit) per goal referencing the block measure type, and a Provider Activity Goal Limit.

### Utilization limit specifics
- Measure type: `Category='AccountUtilizationLimit'`, `ActivityObject='MngEventParticipant'`, `"version":1`; example buckets map `AttendanceStatus` SignUpComplete -> estimated, CheckInComplete -> committed, Attended -> actual. A record matching several buckets goes to Estimated, then Committed, then Actual priority.
- Limit is the **Activity Limit** field on Provider Activity Goal Limit; count is **Total Activity Value** on the goal measure, participant IDs in Additional Information. Exactly at limit: added without warning.
- Recalculation: participant create/update/delete always; Managed Event update only when a criteria field or start date/time changes (moving to another plan period updates both plans); event delete yes; event create alone no.
- Write-in exception: Write-In participants (old or new StandardType = WriteIn, including reconciliation) are always added even with Error, with a discrepancy record.
- Activity plan type must be `EventManagementLimit` and active; required handlers `MngEventAcctUtilLmtsHandler`, `MngEventPartAcctUtilLmtsHandler`. Lightning components: Account Utilization Tracker on Account and Expert pages; Record Update Validation Notifier (`lscRecordUpdateValidationNotifier`) on Managed Event and Managed Event Participant pages (mandatory for notifications).

### Batch jobs
- **Recalculate Account Utilization Count**: recalculates from scratch; use for bulk imports, initial setup before handlers are active, or after changing limits/criteria JSON. Run via Admin Console > Event Management tile > **Field Event Jobs** > Platform Workflow > Run Now (needs Life Sciences Commercial Admin); or via Flow action `lsc4ce_flow__RcalcAccountUtilCount` with optional Activity Plan ID (blank = plans current by date; explicit ID works even if the plan is inactive).
- **Calculate Expenses Against Monetary Caps**: recalculates actual/estimated amounts when data was loaded with handlers off; requires multicurrency; resets to zero if no participants exist; adds/deletes discrepancy records.
- **Share Provider Activity Goals Based on Activity Plan Type**: shares goals of Event Management Limit plans with territories aligned to the account.

### Account merge
Winner and loser with goal measures on the same Event Management Limit plan are consolidated per bucket (example: actual 300+200=500, estimated 400+600=1000, total = MAX = 1000). Child participants/expenses/allocations move to the winner; loser's goal measure is deleted; Expense Participant and allocation records are not deleted. Different currencies are converted at the historical rate of each expense's creation date; rates are kept in AdditionalInformation.

### Offline mobile
Mobile allows or blocks offline per last synced config; offline additions over the limit sync without rejection and create a discrepancy. Same for parallel web/mobile updates.

### Not verified
"Estimated expense exceeds limit" real-time notification wording and the starter script for measure types were not located in Help beyond the Apex samples above.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_monetary_cap.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_monetary_cap_setup.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_provider_activity_measure_types_monetary_cap_calculation.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_monetary_cap_account_merge.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_account_utilization_limits.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_considerations_utilization_limits.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_check_account_utilization_provider_activity_measure_types.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_check_account_utilization_running_batch_job.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_configure_org_wide_settings.htm&release=264.0.0&type=5
