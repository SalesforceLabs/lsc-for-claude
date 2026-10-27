# iPad rejects every visit as outside best time

**What you see:** On iPad, saving a visit fails with **Schedule the visit within your account's best times.** The error is `outsideMyBestTime`. It happens for every account, including accounts whose `ContactPointBestContactTime` rows already have a territory. The same visit can save on web.

A null `TerritoryId` on a best-time row is not the cause. Filling in Territory does not fix it.

## How to pin it

1. Confirm the message is the iPad best-time error, and `VisitMyBestTimeValidationHandler` is active. If that handler is off, this message does not come from best time.
2. Load the best times for the visit's address. Include rows with a territory and rows with a null territory.

```sql
SELECT Id, DayOfWeek, FromTime, ToTime, IsActive, BestTimeType, TerritoryId
FROM ContactPointBestContactTime
WHERE ContactPointReferenceId = '<addressId>'
AND BestTimeType = 'MyBestTime'
AND IsActive = true
```

3. Compare the visit's planned start and end to `FromTime` and `ToTime` on the row whose `DayOfWeek` matches the visit. Those fields are raw time values such as `08:00:00.000Z`.
4. If the visit falls inside that window and iPad still rejects it, stop. `CallMyBestTimeValidator` parses those raw values with the 12-hour display format (`h:mm a`). The parse does not match, so the `TimePeriod` is always nil. With no period, the check throws `outsideMyBestTime` for every account.
5. Repeat on a second account whose best-time row already has `TerritoryId` set. The same error is the pin. It is not a missing territory on one export row.
6. Web reads the same `FromTime` and `ToTime` values and allows the visit. The fix is to parse the raw time format in `CallMyBestTimeValidator`. Do not populate Territory, and do not add best-time rows.

## Required answer

The reply must include all of:

- Cause: `CallMyBestTimeValidator` parses raw `FromTime` and `ToTime` with a 12-hour display format, so `TimePeriod` is always nil and it throws `outsideMyBestTime` for every account. This is a code defect. The fix is a raw-format parse.
- Evidence: name one visit whose start and end fall inside an active `MyBestTime` row, and that iPad still shows the best-time error. State that the same failure happens when `TerritoryId` is already set.
- Do not tell the customer to populate Territory, add best-time rows, or move the visit to another weekday.

## Do not

- Do not call this a config or data gap, and do not say it is not a code defect.
- Do not lead with a null `TerritoryId` on `ContactPointBestContactTime`.
- Do not lead with "the visit is outside the Wednesday window" or "DayOfWeek was resolved in UTC" once an in-window visit is rejected.
- Do not turn off `VisitMyBestTimeValidationHandler` as the diagnosis. The handler runs the check. `CallMyBestTimeValidator` is what fails to parse the time.
