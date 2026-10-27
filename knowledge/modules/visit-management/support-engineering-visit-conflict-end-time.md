# iPad visit conflict ignores the other visit's end time

**What you see:** iPad reports a visit conflict, or allows a visit, and web does the opposite for the same two visits. The message is that the account already has a visit within N days. N is `VisitConflictValidationPeriod`.

`VisitConflictValidationPlugin.findConflictingVisit` does not choose Planned Start instead of Planned End as a guess. Its query reads only the existing visit's `PlannedVisitStartTime` (`startDateField`). `PlannedVisitEndTime` is never read. The window is the new visit's start plus or minus N days. That is a start-plus-N boundary.

Web checks both sides: the existing visit's end is after the new start minus N, and the existing visit's start is before the new end plus N.

## How to pin it

1. Read `VisitConflictValidationPeriod` with `list_admin_settings({ category: "Visit" })`. If it is 0, this check does not run.
2. Load both visits:

```sql
SELECT Id, AccountId, PlannedVisitStartTime, PlannedVisitEndTime, Status
FROM Visit
WHERE Id IN ('<new visit id>', '<other visit id>')
```

3. Let S and E be the new visit's start and end, and N the period in days. iPad treats the other visit as a conflict only when its `PlannedVisitStartTime` is between S − N and S + N. Its `PlannedVisitEndTime` is not in the query.
4. Web treats it as a conflict when the other visit's end is after S − N and the other visit's start is before E + N.
5. Pick a pair that separates them. The other visit's start is outside S ± N, and its end falls inside that window, or the new visit's end reaches a visit whose start is after S + N. iPad and web disagree on that pair.
6. Stop. The fix is a two-sided condition that also reads the existing visit's end time, matching web. Do not stop at "it likely uses start rather than end."

## Required answer

The reply must include all of:

- Cause: `VisitConflictValidationPlugin.findConflictingVisit` queries only the existing visit's `startDateField`. The end time is never read. The window is the new visit's start plus or minus N days. Web checks both start and end.
- Evidence: one pair of visits where the existing visit's start is outside that start-only window and its end, or the new visit's end, makes web and iPad disagree.
- Fix: a two-sided end-time condition.

## Do not

- Do not leave the cause as "likely Planned Start rather than Planned End" without stating that `endDateField` is never read.
- Do not treat iPad and web as the same overlap rule.
- Do not change `VisitConflictValidationPeriod` to explain a pair that fails only one side of the overlap.
