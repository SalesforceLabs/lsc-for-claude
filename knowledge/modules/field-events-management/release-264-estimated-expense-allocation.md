# Estimated Expense Allocation - Winter '27 (264)

Applies to: iPad and Web. Status: GA.

## What's New

Field Events supports allocating estimated expenses to participants during event planning. Teams see planned per-participant costs and can evaluate committed speaker fees against monetary caps before the event (see release-264-monetary-cap-utilization-limits). Allocation can be even or uneven.

## Admin Setup & Configuration

Prerequisites:
- Grant users create, edit, and delete access to **Expense Participant** records.
- Add the Expense component to the Managed Event record page.
- In Admin Console configure:
  - Managed Event Colleague Restricted Roles
  - Estimated Expense Allocation Invitation Status
  - Search Settings - Expenses: field sets, enable system generated filter, and partial allocation

Partial allocation controls whether the allocated total may be less than the expense amount.

Create an estimated Expense Type (App Launcher > Expense Types > New):
- Name (e.g. Food)
- Expense Availability Type = Managed Event
- Effective dates
- Allocation type
- Included in Cap, if applicable
- Classification = Estimated
- Leave Parent Expense Type blank

## End-User Flow (iPad)

Add estimated expense:
1. Open the Managed Event and go to Expenses.
2. Tap Add Estimated Expenses.
3. Select an expense category, enter a name and amount, and save.
4. Use the default event-based filter or advanced search to find expense types.

Allocate:
1. Open the estimated expense and tap Allocate.
2. Even allocation: select participants and save.
3. Uneven allocation: turn on Uneven Allocation, enter each participant's amount, and save.

## Reference (verified in Help)

- Expense types are a parent/child pair: estimated type (Classification = Estimated, Parent Expense Type blank, e.g. Travel) and actual child type (Classification = Actual, Parent Expense Type = the estimated type, e.g. Airfare). Select an allocation type on both (not mandatory, but recommended to avoid errors). Needs the Life Sciences Commercial Admin permission set.
- Records: Estimated Expense -> Expense Type = parent estimated type, linked to the event via **Expense Source**. Allocating creates child **Estimated Expense Participant Allocation** records. Actual Expense uses **Related Expense Type** = child type and **Expense Origin**.
- Allocation modes: even always totals the expense amount. Uneven: with **Allow partial expense allocation** on, total may be less than but not more than the amount; otherwise it must equal the amount.
- Profile-level settings (Admin Console > Event Management > **Field Events Profile Settings**): Expense Allocation Eligible Participant Types (blank = all types), Estimated Expense Allocation Invitation Status (matches Managed Event Participant's Participant Response), Actual Expense Allocation Attendance Status, Allow partial expense allocation, Toggle the system-generated expense type filter (default filter matches event type/subtype), Expense Type Display/Search Field Sets, Managed Event Colleague Restricted Roles.
- Enable advanced search for expense types: Admin Console > Mobile tile > Application Settings > **Enable advanced search for lookups**; if off, all expense types show.
- Related handlers: `EstimatedExpenseMonetaryCapsHandler` and `EstExpensePtcpAllocMonetaryCapsHandler` (rejects negative allocation amounts; Error blocks, Warning allows with discrepancy; mobile sync is never blocked but creates a discrepancy), `EstimatedExpPtcpAllocImmutabilityHandler` (Participant lookup cannot change after create). See release-264-event-management-trigger-handlers.
- Help describes the iPad Allocate action as the row ellipsis menu > Allocate (the "Allocate" button wording above may differ slightly).
- **Not verified:** the `EstimatedExpense.IsAllocationUneven` field and its behavior were not found in Help.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_expense_management.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_manage_events_post_approval_tasks.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_configure_profile_level_settings.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_monetary_cap.htm&release=264.0.0&type=5
