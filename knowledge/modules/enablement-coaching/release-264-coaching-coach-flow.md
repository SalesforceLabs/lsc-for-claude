# Enablement Coaching - Coach Flow - Winter '27 (264)

Persona: Marcus (Coach). Available on web and iPad (same steps shown for both). Lifecycle context: [overview](./release-264-coaching-overview-lifecycle.md).

## Creating the Event
1. Verify the Assessment Definition is Active and shared with the coach by the Business Admin.
2. Create the Enablement Coaching record with starting Status = **Planned** (needed because the first move depends on adding the employee). On save:
   - Linked Assessment Definition becomes immutable.
   - Coach record is created and becomes immutable.
   - End date defaults to 30 minutes after start (needed for the calendar). Web: applied on save; iPad: visible before save.
3. Preview the form.
4. **Add the employee**: triggers the configured validations in order (profile, overlap, hierarchy). Without an employee the event cannot progress. On web, refresh the page so Generic Workflow derives the right variation from the coachee's settings. Once added, the employee record is immutable.
5. **Link to Visits** (Enablement Coaching Sessions): can be done any time the evaluation is editable by the coach. Session link is optional.
6. Review the employee's previous score in the flow of work; governed by the profile setting of the employee being coached, not the coach.
7. **Progress the status** (first move): action surfaced is either Self-Evaluation or Evaluation in Progress based on the employee's settings. This shares the event header and the associated assessment definition with the employee.

Planned events are not shared yet and appear only to the coach (list view, calendar, reports).

## Calibration (after employee submits)
Debrief timing follows company policy; not governed by product. Coach steps:
1. Review employee responses (when Self-Evaluation enabled for that employee).
2. Calibrate: go through steps and submit own evaluation.
3. Add a development plan (optional additional/development plan comments).
4. Submit and Finalize: additional action required; the form loads after the finalization step.
5. Capture overall evaluation comments.

Status then becomes Feedback Review (Acknowledgement enabled for the employee) or Completed. The event is locked for the coach.

## Completion
With Acknowledgement enabled: coach views the employee's acknowledgment comments and Acknowledged date, then completes the event. Completed events are linked as Previous for later events when they match the same Assessment Definition and same employee, regardless of coach, and are in the closest past relative to the current event (matched at the coach's first status move).

## Calendar
Coaching events appear in the calendar with an event indicator (OOB colors; customizable), can be filtered, and a coaching event can be created from the calendar (coach only).

## Verified Against Official Help
- **Correction/nuance on linking visits:** Help says coaches select field visit records from the related list **while the session is in Planned or Self-Evaluation status**; linked visits show in the session header and become visible to the coachee after the session is shared. The deck's "any time the evaluation is editable by the coach" is broader than Help. One or multiple visits can be linked, creating an audit trail of when and where observations were gathered.
- Calendar: coaches create sessions from the calendar grid or Enablement Coaching tab; employees see sessions only after the coach shares them.
- Previous scores populate in the Evaluation tab; **Show Previous Evaluation Score** toggle.
- Offline: coaches can complete entire evaluations offline on iPad and sync later.

## Sources
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_link_field_visits_with_evaluations.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_schedule_and_track_from_calendar.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_view_historical_evaluation_scores.htm&release=264.0.0&type=5
