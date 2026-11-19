# iOS Visit data inconsistency from a duplicate field API name

**What you see:** The LSC mobile app throws a data inconsistency error on a Visit. A custom field such as Visit Reason exists on both `Visit` and `ProviderVisit` with the same API name.

The mobile app shows the `Visit` copy. The two fields are not the same value, so the record looks inconsistent. Remove the duplicate so the API name exists on only one of the two objects.

This is not fixed by refreshing the metadata cache or by a `LifeSciMetadataRecord` override.

## How to pin it

1. Confirm the error is on the mobile Visit screen, and name the field the user was editing.
2. Describe that API name on `Visit` and on `ProviderVisit`. Stop when both objects have it.
3. The `Visit` field is the one the mobile app shows. Remove the duplicate. Do not refresh the metadata cache, and do not look for a settings override, while both copies exist.

## Required answer

The reply must include all of:

- Cause: the same custom-field API name is on `Visit` and `ProviderVisit`. The mobile app shows the `Visit` copy.
- Evidence: both objects have that API name.
- Fix: remove the duplicate so the name exists on only one object.

## Do not

- Do not split this into separate issues or stop at "the field belongs on ProviderVisit."
- Do not refresh the metadata cache or check `LifeSciMetadataRecord` before naming the duplicate API name.
- Do not say a custom field on `Visit` is ignored when a field with the same API name also exists on `ProviderVisit`. The mobile app uses the Visit copy.
