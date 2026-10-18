# Enablement Coaching - Employee Flow - Winter '27 (264)

Persona: Emma (Employee). Available on web and iPad. Lifecycle context: [overview](./release-264-coaching-overview-lifecycle.md).

## Self-Evaluation (when enabled)
- Planned events are not shared yet and do not appear in the employee's list view, calendar or reports; the event appears after the coach's first status move.
- Employee reviews the assessment, goes through the steps (if configured) and submits her own view against the same rubric. The coach cannot see her responses until submission.
- On submit: event moves to Evaluation in Progress; the form is in view mode for the employee (side by side); coach responses are not visible; the employee's responses are disclosed to the coach.
- Note from the deck: ignore the top buttons in the demo UI (configuration work in progress).

## Acknowledgement (when enabled)
- Feedback Review is the first stage where the coach assessment is disclosed to the employee.
- With Self-Evaluation enabled, employee sees a side-by-side review of her self-evaluation and the coach's scores.
- Employee acknowledges and may add acknowledgement comments. Status updates to Acknowledged and the Acknowledged date is captured.
- Coach then completes the event; the permanent record is closed and read only for the employee.

## Previous Coaching Events
In the flow of work, the Previous field links to the prior completed event, so coach and employee can trace growth. Matching: same Assessment Definition, same employee, any coach, closest past event (evaluated at the coach's first status move). Visibility of previous score/comments depends on the employee's Show Previous setting ([admin setup](./release-264-coaching-admin-setup.md)).

## Calendar
Both coach and employee see coaching events in the calendar with the event indicator and filters; only the coach can create coaching events.

## Verified Against Official Help
- Help confirms employees see coaching sessions only after the coach shares them, and that linked field visits become visible to the coachee after sharing. Previous scores appear alongside current evaluations (most recent completed evaluation using the same template).
- Help gives no detail on the self-evaluation or acknowledgment steps beyond the summary ("employee self-evaluation" and "formal acknowledgments"); the flow above is deck-sourced.

## Sources
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_link_field_visits_with_evaluations.htm&release=264.0.0&type=5
