# Enablement Coaching Overview and Lifecycle - Winter '27 (264)

## What's New

New GA feature for pharma field employees. Positioned around the employee being coached, because privacy laws (GDPR) and works-council rules protect employee information. Every coaching record maps 1:1 to one employee; self-evaluation and coach evaluation stay two-way blind until the blind period closes.

GA highlights:
- **Structured assessments**: standardized question bank with weighted scoring; every employee evaluated against the needed rubric across markets.
- **Dual perspectives and peer coaching**: coach evaluation plus employee self-evaluation in one view. The same employee can be coach in one event and coached in another.
- **Two-way blind**: self-evaluations are independent; no party sees another's input until the blind period closes.
- **Linked to field activities**: coaching can be attached to HCP Visit records or be standalone (other interaction types such as store check or medical events are future).
- **Previous evaluations**: previous score and comments visible on the current event.
- **Offline**: full assessment capability with no connectivity.

Personas: Marcus (Coach), Emma (Employee), James (System Admin), Olivia (Business Admin).

Foundations: Discovery Framework and OmniScript (assessment engine; DF defines the weighted rubric, OmniScript renders the guided form); Lightning Mobile Renderer (LMR) powers coaching screens in the iPad app, works offline and syncs when back online; Generic Workflow drives the lifecycle.

## Two Settings, Four Lifecycles

Configured per coachee (see Coachee Settings in [admin setup](./release-264-coaching-admin-setup.md)):

| Setting | OFF | ON |
|---|---|---|
| Self-Evaluation | Coach evaluates alone | Coach and employee evaluate independently, blind to each other |
| Acknowledgment | No formal sign-off | Employee must formally acknowledge |

| Variation | Path |
|---|---|
| 1 Simple | Planned -> Evaluation in Progress -> Completed |
| 2 With Acknowledgment | Planned -> Evaluation in Progress -> Feedback Review -> Acknowledged -> Completed |
| 3 With Self-Evaluation | Planned -> Self-Evaluation -> Evaluation in Progress -> Completed |
| 4 Full Cycle | Planned -> Self-Evaluation -> Evaluation in Progress -> Feedback Review -> Acknowledged -> Completed |

Cancelled is a terminal state alongside Completed.

## Who Sees What and When

| Status | Coach | Employee |
|---|---|---|
| Planned | Full access; event visible and in calendar | No access |
| Self-Evaluation | Writes own record blind | Writes own record blind |
| Evaluation in Progress | Access to all records; calibrates own record | No access to the coach evaluation results |
| Feedback Review | Read only | Reads coach evaluation for the first time |
| Acknowledged | Read only | Acknowledges evaluation |
| Completed | Read only | Read only |

Cancelled rules:
- Available to the coach at any point before the lock point.
- Cancelled before the first coach status move: employee has no visibility at all.
- Cancelled after the first coach status move but before the lock point: employee sees header and session only, no evaluation content.
- Cancelled after the lock point is not possible; once the evaluation is visible to the employee, Completed is the only terminal state.

## Design Principles

1. Status-driven lifecycle: every transition is a status change by a named actor/system.
2. Unified lock point: system locks and shows the evaluation at the same status: Feedback Review (variations 2 and 4) or Completed (variations 1 and 3). Employee never sees a non-completed evaluation.
3. Progressive editability: coach evaluation editable until lock point, immutable after.
4. Customer-composed lifecycle: two admin switches create four variations.
5. Employee-side timeout protection (Future): Self-Eval and Acknowledgment auto-advance after configured days.
6. Blind evaluation: separate records, not disclosed until Evaluation in Progress.
7. Peer coaching support: a user cannot be Coach and Employee in the same Enablement Coaching record, but can across records.
8. Role lock at first status move (commitment point).
9. Secondary coach parity (Future): same access as Coach at all statuses.
10. Debrief is recommended, not enforced; the lock point means the cycle is complete. Debrief timing follows company policy, not product behavior.
11. Cancelled is pre-lock only; Completed only after.
12. Session link is optional (can be multiple; other interaction types in future).
13. Hard deletion on reassignment (Future): coach reassignment before first coach status move deletes the original response.
14. Offline conflict resolution: standard LSC sync rules when web and iPad edit different fields.

## Verified Against Official Help
- Availability: Lightning Experience, Enterprise/Unlimited, Life Sciences Cloud license + Life Sciences Cloud for Customer Engagement add-on + Customer Engagement managed package. Features available starting **September 2026**. Offline, calendar, and session features also run on the Life Sciences Cloud mobile app for iOS (**iPad only**).
- Help describes five feature areas: Discovery Framework assessment templates, historical evaluation scores, linked field visits, offline support, calendar scheduling. Self-evaluation and formal acknowledgment are mentioned in the summary.
- Help does not document the status names, blind-period rules, or the four lifecycle variations; those remain from the internal deck.

## Sources
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_complete_evaluations_anywhere_with_offline_support.htm&release=264.0.0&type=5
