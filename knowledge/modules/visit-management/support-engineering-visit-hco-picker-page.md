# Web HCO picker returns no organizations

**What you see:** On web, the HCO picker returns no healthcare organizations. Person accounts exist, and HCOs exist, and the first page is empty.

`AccountPickerService` loads `HealthcareProvider` with `LIMIT 20` ordered by `Account.Name`, then applies `Account.IsPersonAccount = false`. When those 20 rows are all person accounts, the filter drops every row and the picker shows 0 HCOs.

This is not a Profile or User `LifeSciMetadata` override.

## How to pin it

1. Confirm the empty list is the web HCO picker. The generic account picker is a different query and can still return person accounts.
2. Load the page the picker takes before the HCO filter:

```sql
SELECT Id, AccountId, Account.Name, Account.IsPersonAccount
FROM HealthcareProvider
WHERE IsPrimaryProvider = true
ORDER BY Account.Name
LIMIT 20
```

All 20 rows have `Account.IsPersonAccount = true`.

3. Confirm HCOs exist past that page:

```sql
SELECT Id, AccountId, Account.Name
FROM HealthcareProvider
WHERE IsPrimaryProvider = true
AND Account.IsPersonAccount = false
ORDER BY Account.Name
LIMIT 5
```

Those organizations are in the territory and sort after the person accounts, so they never enter the 20-row page.

4. Stop. `AccountPickerService` paginates before `IsPersonAccount = false`. The filter then discards the page. Do not change a metadata override.

## Required answer

The reply must include all of:

- Cause: `AccountPickerService` paginates `HealthcareProvider` with `LIMIT 20` by `Account.Name` before `Account.IsPersonAccount = false`. The 20 person rows are dropped, so the HCO picker returns 0 organizations.
- Evidence: the first 20 primary providers by name are person accounts, and a later query shows HCOs with `IsPersonAccount = false`.
- Do not call this a Profile or User `LifeSciMetadata` override.

## Do not

- Do not start with `list_admin_settings` or a metadata override.
- Do not stop because a code search returned nothing. The two queries are the pin.
- Do not use this leaf when the first 20 primary providers already include an HCO. The empty page is this bug only when that page is entirely person accounts.
