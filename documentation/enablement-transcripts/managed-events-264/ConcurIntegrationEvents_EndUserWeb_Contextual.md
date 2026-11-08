# ConcurIntegrationEvents_EndUserWeb (264 enablement video)

Source: ConcurIntegrationEvents_EndUserWeb.mp4 and the matching Transcript.docx. Narration is speech-to-text; on-screen context is added from video frames where noted.

## On-screen context

Not extracted yet. This file is the narration only; frames for this video have not been reviewed.

## Narration

Transcript: ConcurIntegrationEvents_EndUserWeb.mp4
Detected language: en (100.0%)

Hello my name is Crystal Deshpande and I'm a product manager on Agent Force Live Sciences.
Today I'll be demoing the Concur integration for events which connects event expenses in LSE with
the Concur expense reimbursement process including participant allocations and receipts.
This reduces duplicate entry and manual reconciliation while giving event teams
visibility into linked reports, sync statuses and errors.
In this demo, I'll create an expense report in Concur and sync it to LSE.
I'll then link an event expense to that report, send it to Concur and confirm that it appears there.
Finally, I'll make an update to that expense in Concur and sync that change back into LSE,
demonstrating the end-to-end flow between both systems.
Okay, let's go ahead and jump into the demo.
So first, I'm in Concur, logged in as my sales rep user and I will now create an expense
report for an upcoming speaker event that I'm planning.
I've entered all the details I need to create the report.
Now my report is created in Concur.
Now, the MuleSoft integration is a scheduled integration.
So it can be scheduled for a predefined frequency.
But for the purpose of this demo, I will be triggering that job manually since we want to
do this real time.
Okay, I see my job has completed.
So now I will go into LSE and view my expense reports.
So here I see that the expense report I just created for the ImmuneXus speaker event in
September has been created in LSE.
Now my event has completed and I want to go ahead and enter all my actual expenses.
I have a parking expense that I have paid for, which I will need reimbursed.
So I'm going to go ahead and add this parking expense to my event in LSE
and once I've added the expense, I can go ahead and link an expense report, which is
in Concur.
Here I see a list of all my expense reports that are still in not submitted status.
These reports are specific to only me and this non-submitted status is set by the admin.
Only expense reports in the defined statuses would show up here.
So I see my expense that I created in Concur for this event.
And I will go ahead and select that and link that expense report to this expense.
Once I link this expense, there is an entity called expense report entries.
An expense report entry record is created once an expense is linked to an expense report.
And that record is also sent to Concur.
So now I see that my expense report entry record has been created.
I can go ahead and trigger the MuleSoft job to sync that expense to my report in Concur.
Okay, I see this job has now completed.
So now I will go into Concur and let's see if my expense has been created here.
And I do see the $18 parking expense has been linked to the expense report that I created
earlier.
Now I can go into this expense and I can go ahead and make any changes that are required
for the expense and submit it for approval within Concur.
However, I do see that the amount is $18 and I forgot to include the taxes I paid
and my total was actually $21.
So I go ahead and make this change in Concur and save the expense.
Now when that next scheduled job runs, this update will go back to LSE into my event.
But for now, we need to run it manually.
Now I see the scheduled job has run and I can now go back into my event.
And I am able to see if my updated amount has made it to the event.
And I see that the event expense has been updated
and is synced with the amount in Concur.
So you can see how the integration is syncing the creation and the changes back and forth
from LSE to Concur.
Once I submit my expense report in Concur and the expenses are paid,
those status changes are synced back into LSE.
Okay, that concludes my demo of the Concur integration for events.
Thank you!
