# Sample-limit menu missing because the profile setting is off

**What you see:** On Visit Engagement, the sample-limit menu (the ellipsis next to the product) is missing, and sample-limit enforcement does not run. Samples themselves can still be listed.

`ProviderSampleLimit` is not the first check. That row is read only after **Validate Sample Limits** is on for the user. The org-level value does not count when a profile record overrides it.

## How to pin it

1. Call `list_admin_settings({ category: "Visit" })`. Find `ValidateSampleLimits`.
2. Read the record that applies to this user. A user record wins, then the profile record, then the org record (`IsOrgLevel`).
3. Open the profile record assigned to the rep's profile. If `ValidateSampleLimits` is false there, stop. The org record can still be true. The profile record is the one the visit uses.
4. Confirm that profile value with the customer before changing it. A profile save can turn enforcement off while the org setting stays on.
5. Query `ProviderSampleLimit` only after `ValidateSampleLimits` is true for that profile. A missing account-product row is a later problem: the ellipsis is visible, and submit reports that the provider sample limit does not exist.

## Required answer

The reply must include all of:

- Cause: `ValidateSampleLimits` is off on the profile-level Visit setting for this user. The org-level value is not the one in effect.
- Evidence: the profile assignment and the field value from `list_admin_settings({ category: "Visit" })`.
- A missing `ProviderSampleLimit` row does not explain a missing ellipsis. Do not re-test templates or create that row until the profile setting is on.

## Do not

- Do not treat a missing `ProviderSampleLimit` for the account and product as the cause while the profile setting is off.
- Do not read only the org-level record.
- Do not turn the profile setting on without confirming that value with the customer.
