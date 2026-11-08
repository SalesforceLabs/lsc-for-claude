# Create Visit from Managed Event - Winter '27 (264)

Applies to: iPad and Web. Status: GA.

## What's New

Reps can create individual or group visits directly from a field event's attendee list. Selected attendees are pre-populated in the Visit experience (Visit SPA), reducing duplicate entry and improving capture of informal HCP interactions around an event.

- One attendee becomes the primary account on the visit.
- Multiple selections create a group visit with additional attendees and child visits.
- Admins control availability by event type, event status, and event user role, with optional validation for Attended status.

## Admin Setup & Configuration

Group visits use the workflow action; individual visits use the attendee row-level Create Visit icon.

Prerequisites:
- Set up Visit Management, including group visits.

Steps:
1. Admin Console > Event Management > **Field Events Profile Settings**: configure **Allowed Attendance Statuses for Visits** to control eligible attendees.
2. Admin Console > **Workflow Configuration**: create an **Open Component** action for Managed Event.
   - Action/Button: Create Visit
   - Component: `industries_ls_commercial:eventVisitParticipantSelectorLauncher`
   - Add the action to the appropriate Managed Event workflow stage.
   - Configure stage and user-role conditions.
   - Save and activate the workflow.

## End-User Flow

Group visit:
1. Open the Managed Event.
2. From the workflow, tap Actions > Create Visit.
3. Select eligible attendees. The first becomes the primary account.
4. Tap Create Visit to open the visit with the remaining selections as attendees.

Individual visit (mobile): in the Attendee section, tap the row-level calendar icon next to the attendee to start a visit for that attendee.

## Verification Notes

- No Help article for "Create Visit" from a Managed Event was found in the index. The setup below was **seen on screen** in the 264 admin enablement video (not in a Help article):
  - Admin Console > Workflow Configuration > **Workflow Actions** > New > **Open Component**. Fields: Action Name `Create Visit`, Button Label `Create Visit`, Object `Managed Event`; under Component Parameters, Component Name `industries_ls_commercial:eventVisitParticipantSelectorLauncher` (Component Parameters left blank). Note the different namespace: the other Managed Event open-component actions use `lsc4ce:` (e.g. `lsc4ce:LaunchSurveyModal`, `lsc4ce:mngEventParticipantEmailing`), but this one is `industries_ls_commercial:`.
  - The action is then added under **Workflow Paths** > Managed Event - Speaker Event > the **Execute** stage > stage operation `MngEvnt Execute Organizer` > **Stage Operation Actions** (order: Conclude, Launch Survey, Create Visit). Stage operation conditions use `CurrentUserEventRole` In `Organizer;Coorganizer;Coordinator;Contributor`-style role lists (the Conclude operation was shown with that value).
  - Field Events Profile Settings > **Visit Settings** > **Allowed Attendance Statuses for Visits** is a dual-list; in the video Selected = Attended, Check-In Complete, Sign Up Complete, Available = No Show. (Expense Allocation lists beside it have their own settings.)
  - Verify in your own org: Workflow Actions > Open Component lists each action's Component Name.
- Verified related group-visit behavior (Add Attendees to Group Visits): add the **Child Visits** related list to the Visit page layout (enables the Attendees sidebar); each attendee gets a child visit linked to the parent; the account on a child visit cannot be changed (remove and re-add); removing an attendee deletes its visit and provider visit records; after the parent visit is submitted, Attendees is read-only; deleting a parent visit deletes children without warning, but is blocked if the parent is Completed or any child has a signature. Do not configure a New button on the Related List - Life Sciences Attendees component.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_add_attendees.htm&release=264.0.0&type=5

## End-user demo walkthrough (264 enablement video transcripts)

- Web: on the completed Managed Event the rep clicks the **Create Visit** action, then chooses an individual visit (one attendee) or a group visit (several), and clicks **Start Visit**. The selected attendees carry into the Visit SPA; the first becomes the primary, the rest become visit attendees (child visits). The rep then sets a future date; no participant re-entry.
- Mobile: for a one-on-one follow-up, tap the icon on the attendee row (visit starts with that participant added; Cancel returns to the event). For a group, tap the **Create Visit** action, select all or some attendees, and the visit opens with the first as primary and the rest as additional attendees; each is managed as a child visit.
- Use case in the demo: follow-up visits scheduled right after a speaker event.
