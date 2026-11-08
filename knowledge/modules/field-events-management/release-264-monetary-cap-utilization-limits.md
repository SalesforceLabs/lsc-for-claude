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

## End-user demo walkthrough (264 enablement video transcripts)

- **Utilization tracker** on each HCP account (web): shows configured limits, current utilization and remaining availability. Examples in the demo: a utilization limit of 5 with 5 used (0 available) blocks adding the HCP; a monetary cap block of $250 exceeded by $50 blocks; a warning-level utilization limit of 3 with 2 used leaves 1 available; a $5,000 cap with $2,100 paid leaves $2,900; a $2,000 cap with $1,400 used leaves $600.
- **Planning stage:** adding an HCP who has exceeded a limit is blocked (on both web and mobile). Opening the account profile from the picker shows the remaining cap (e.g. $1,700 left).
- **Estimated expense:** allocating the estimated speaker fee to the speaker holds that amount against their scheduled monetary cap (e.g. $500 held). If the allocation would hit the cap the rep sees it before submitting the event for approval and can swap the expert.
- **Actual expense (after the event):** allocating the actual speaker fee revalidates the cap; if it goes over, the system shows only a **warning** and still allows the allocation, because the speaker already provided the service and the payment must be recorded. A **Managed Event Participant Discrepancy Reason** record is created so the compliance risk can be reported. (Block at planning, warn at actuals: this is by design, not a bug.)

## Seen on screen (264 admin video)

- **Trigger handlers** (Admin Console > Trigger Handlers, search "Monetary") shows six handlers, all on in the demo: `ExpenseParticipantMonetaryCapsHandler` (ExpenseParticipant), `MngEventPartMonetaryCapsHandler` (MngEventParticipant), `MngEventMonetaryCapsHandler` (MngEvent), `ExpenseMonetaryCapsHandler` (Expense), `EstExpensePtcpAllocMonetaryCapsHandler` (EstimatedExpensePtcpAlloc) and `EstimatedExpenseMonetaryCapsHandler` (EstimatedExpense). The narrator says the utilization limit handlers (`MngEventAcctUtilLmtsHandler`, `MngEventPartAcctUtilLmtsHandler`) must be on too.
- **Lightning App Builder:** the Record Update Validation Notifier is placed on the Managed Event record page (the page was in the Closed stage, with Launch Survey and Create Visit buttons on the path).
- **Field Events Org Settings > Concluded Event Status** is a dual-list. In the demo Selected = Closed, Concluded, Execute; Available = Approved, Cancelled, Draft, Pending Approval. Execute is in the list, so an event in Execute warns instead of blocking.
- **Expense Types** list view (16 types) has columns Effective Start/End Date, Expense Availability Type, Allocation Type (Individual Allocation / Multiple Allocations), Classification, Parent Expense Type and Included In Cap. Only **Fee for Service** (Estimate) and **Expert Fee** (Actual, parent Fee for Service) have Included In Cap checked.
- **Activity Plans** list: Type = Event Management Limit, Status Approved, Active checked (e.g. "Monetary Cap - AP" with time period "Monetary Cap Time Period", "Utilization Limit - Warning"). An In Progress, inactive plan of the same type is not used.
- **Provider Activity Measure Type** (opened in Workbench; fields include Alert Type, Criteria, Category, Display Order and the Aggregated Activity Actual / Goal / Scheduled fields, which were blank for the monetary cap type). The monetary cap type had Alert Type = Error, Category = `MonetaryCapLimit` and this version 2 criteria:

```json
{"MngEventParticipant":{"contextCondition":{"conditions":[
  {"value":"Draft;PendingApproval;Approved;Execute;Concluded;Closed","operator":"In","field":"MngEvent.Status"},
  {"value":"Expert","operator":"In","field":"EventMgmtPtcpTypeRoleMap.EventMgmtParticipantType.StandardType"}]}},
 "EstimatedExpensePtcpAlloc":{"expenseBuckets":{
   "committed":{"conditions":[{"value":"Approved;Execute","operator":"In","field":"MngEvent.Status"}]},
   "estimated":{"conditions":[{"value":"Draft;PendingApproval","operator":"In","field":"MngEvent.Status"}]}},
  "contextCondition":{"conditions":[{"value":"Draft;PendingApproval;Approved;Execute","operator":"In","field":"MngEvent.Status"}]}},
 "ExpenseParticipant":{"expenseBuckets":{"actual":{"conditions":[
   {"value":"Draft;PendingApproval;Approved;Execute;Concluded;Closed","operator":"In","field":"MngEvent.Status"}]}},
  "contextCondition":{"conditions":[{"value":"Draft;PendingApproval;Approved;Execute;Concluded;Closed","operator":"In","field":"MngEvent.Status"}]}},
 "version":2}
```

  This matches the version 2 rules above (three nodes, Pascal-case `In`, semicolon lists, `MngEventParticipant` with `contextCondition` only). It limits the check to participants whose role type's StandardType is Expert, so attendees are not capped. Buckets: committed = event Approved or Execute; estimated = Draft or Pending Approval.
- **Provider Activity Goal Measures** list (type Event Management Limit) shows the measure types used in the demo, named by alert type: `HR264_MonetaryCap_Error`, `HR264_Utilization_Error`, `HR264_Utilization_Warning`, with Estimated / Committed / Actual / Total Expense Amount in USD for cap measures (e.g. estimated 1,200, committed 100, actual 4,500, total 5,800) and Total Committed / Scheduled / Activity values for utilization measures. Note the cap row shows Total 5,800 while actual is 4,500: the display here is the sum, while the cap formula above is `MAX(Actual, Estimated + Committed)`, so check which field the list column shows before relying on it.
- **Field Event Jobs** page: Apex Jobs (Align Event Product With Subject Product, **Calculate Expenses Against Monetary Caps**; each with Run Now and Schedule) and Platform Workflow Jobs (**Life Sciences Provider Activity Goal Sharing Job**, **Recalculate Account Utilization Count**; Run Now only).

## Quick checks if it does not work

1. All six monetary cap handlers and the two utilization handlers are on.
2. The Record Update Validation Notifier is on the Managed Event page (and Managed Event Participant page); without it nothing displays.
3. The plan is Type = Event Management Limit and Active, its time period covers the event date.
4. Each HCP has a Provider Activity Goal, a Goal Limit and a Goal Measure whose measure type matches the alert type wanted.
5. The expense type has Included In Cap checked (Fee for Service and Expert Fee in the demo).
6. Measure type criteria is valid version 2 JSON with the `MngEventParticipant` node.
7. Data loaded with handlers off: run Calculate Expenses Against Monetary Caps and Recalculate Account Utilization Count.
8. Goals shared to reps: run the Provider Activity Goal Sharing Job; reps see goals only through provider account territory alignment.
