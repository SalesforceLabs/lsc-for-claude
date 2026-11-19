# Visit expense allocation fails with REQUIRED_FIELD_MISSING [Name]

**What you see:** Allocate or Save on a visit expense throws **Script-thrown exception**. The error underneath is `REQUIRED_FIELD_MISSING [Name]` on `ExpenseParticipant`.

The visit expense save does not send a Name. `ExpenseParticipantNameHandler` is the before-insert handler that sets it. When that handler does not run, Name stays blank and the save fails.

## Why the handler does not run

Salesforce treats a missing `LifeScienceTriggerHandler` record as inactive. `ExpenseParticipantNameHandler` is a system handler. Life Sciences setup does not create `LifeScienceTriggerHandler` records for system handlers, so a new org can be missing this row. A missing row turns the handler off.

Creating the row in the org is not the supported fix. Open a Salesforce support case.

## How to pin it

1. Confirm the failure is expense allocation on a visit and the underlying error is `REQUIRED_FIELD_MISSING [Name]` on `ExpenseParticipant`.
2. Query `LifeScienceTriggerHandler` for `DeveloperName = 'ExpenseParticipantNameHandler'`. A missing row is the pin. Stop there.
3. Tell the user the handler record is missing and that creating it by hand is not the supported fix.

## Required answer

The reply must include all of:

- Cause: a missing `LifeScienceTriggerHandler` record leaves `ExpenseParticipantNameHandler` inactive, so Name is never set.
- Origin: Life Sciences setup does not create records for system handlers, so the row can be absent.
- Fix: open a Salesforce support case. Do not create the handler record in the org.
- Evidence: no `LifeScienceTriggerHandler` row for `ExpenseParticipantNameHandler`, and the error is `REQUIRED_FIELD_MISSING [Name]`.

## Do not

- Do not say the origin of the missing row is unknown.
- Do not create the `LifeScienceTriggerHandler` row, or ask the user to create it.
- Do not stop on the generic Script-thrown exception. The required-field error on Name is the pin.
- Do not treat an existing inactive row the same as a missing row. An inactive row is an admin toggle. This case is a row that setup never created.
