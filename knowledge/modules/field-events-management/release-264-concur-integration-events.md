# Concur Integration for Events - Winter '27 (264)

Applies to: iPad and Web. Status: GA.

## What's New

Field Events synchronize event expenses, participant allocations, and receipts with Concur through MuleSoft. The event record shows the linked report, sync status, and errors.

- Expense reports created in Concur sync into Life Sciences Cloud; reports created in Life Sciences Cloud can be synced to Concur.
- Users link an actual event expense to an eligible, user-owned Concur report. Linking creates an **Expense Report Entry** that carries the expense into Concur.
- Linked expenses, allocations, and receipts are sent via the scheduled MuleSoft integration. Users review and submit the reimbursement report in Concur without re-entering data.
- Changes made in Concur (corrected amounts, report statuses) sync back to the event expense.

## Admin Setup & Configuration

Prerequisite: use the built-in MuleSoft **Concur Expense Sync** integration. Customers already using it for Visits can reuse the existing setup.

1. Object Manager: configure **Expense > Expense System Integration Status** values and **Expense Report > Expense System Integration Status** values. Match both picklists to the corresponding Concur status values.
2. Admin Console > **Concur Settings**:
   - Expense Status for Expense Report Mapping: expense statuses eligible for linking
   - Expense Report Statuses: reports available for linking
   - Managed Event Status for Expenses: events eligible for linking expenses to reports
3. Set Concur Integration Expense Status and Expense Report Status to **Pending** for records that should sync or link.

## Verification Notes

- No Help article covering Concur for **events** (Concur Settings, Managed Event Status for Expenses, event expense to Expense Report Entry) was found in the index. The setup above is from the release note and **unverified**.
- Verified for the existing **visit** Concur integration:
  - Prebuilt **Concur Expense Sync** app deployed via MuleSoft Direct; bidirectional sync. Setup: https://developer.salesforce.com/docs/industries/lifesciences/guide/mulesoft-direct-integrations.html#concur-expense-sync
  - Expenses sync only when linked to an **Expense Report** (App Launcher > Expense Reports > New; expenses without a report do not sync). Admins can create reports and transfer ownership to the rep.
  - Create an expense from the Visit Expenses tab: New > Expense Only or Expense & Receipt (capture the receipt first), pick expense type, report, currency, amount.
  - Expense types need Expense Availability Type, active, and effective dates covering today. Related trigger handlers (visits): ExpenseLockHandler, ExpenseParticipantLockHandler, ExpenseParticipantNameHandler, ContentDocumentLinkLockHandler, ContentDocumentLockHandler.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_sync_visit_expenses_to_concur.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_concur_expense_sync_setup_using_mulesoft_integration.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_config_expenses.htm&release=264.0.0&type=5
