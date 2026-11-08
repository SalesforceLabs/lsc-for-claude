# ConcurIntegrationEvents_Admin (264 enablement video)

Source: ConcurIntegrationEvents_Admin.mp4 and the matching Transcript.docx. Narration is speech-to-text; on-screen context is added from video frames where noted.

## On-screen context (from video frames)

Partial: only the frames reviewed so far; timestamps approximate (+/- 10 s).

- ~50 s: Setup > Object Manager > Expense > Fields & Relationships (24 fields): includes Expense Origin (lookup to Visit, Managed Event, Managed Event Session), Expense System Integration Status (picklist), Expense System Integration Error (text area), External System Last Sync Date (date/time), Estimated Expense (lookup).

## Narration

Transcript: ConcurIntegrationEvents_Admin.mp4
Detected language: en (100.0%)

Hello, my name is Crystal Deshpande and I am a product manager on Agent Force Life Sciences.
Today I'll be doing a demonstration of the setup of the Concur integration for events.
The Concur integration for events is a build-on to the Concur integration for visits introduced
in the previous release. It uses the same built-in MuleSoft Concur expense sync integration
to connect event expenses with the Concur reimbursement process, including participant
allocations and receipts. For customers already using Concur expense sync for visits, the MuleSoft
integration setup is already complete. For that reason, this demo will not cover the MuleSoft setup.
Instead, I'll focus on what's new for events, configuring the event-specific settings.
As a prerequisite, we want to begin with the ExpenseObject expense system integration status
field. We need to ensure that all of the picklist values are configured here and these need to match
the expense status picklist values in Concur. Similarly, we need to do the same for the
ExpenseReport object expense system integration status. Same thing here. We need to configure
the same status values that are available in Concur for the expense report. Once those
statuses are set, we need to go to the admin console where we have introduced a new admin tile
for Concur settings. Within this admin console, we have three event management related settings.
We have the expense status for expense report mapping and here we are adding expense statuses
to make them eligible for linking a Concur expense report. This setting is for expense report
statuses. Only expense reports with these statuses will be available for linking the expense.
And the last setting here is for the managed event status for expenses. Only managed events
in these statuses are going to be eligible for linking an expense to an expense report.
Now we have this Concur integration expense status and Concur integration expense report status.
This status is used to let the integration know that any expenses that are in pending status
need to be synced with Concur. And similarly, any expense reports that are in pending status
need to be linked to Concur. So this concludes the setup of the events management Concur integration.
