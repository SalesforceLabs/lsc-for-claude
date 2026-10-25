# Mobile dynamic actions stay off

**What you see:** Dynamic actions do not run on the mobile app. Visit actions that depend on them are missing. `EnableDynamicActions` looks enabled in the admin setting, or nobody has checked whether that setting record is active.

The mobile app does not receive an inactive Application Settings record. With no record on the device, it defaults `EnableDynamicActions` to false.

This is not a limit on reading `User.Profile.Name`, and it is not Salesforce Dynamic Forms on Mobile. Those do not turn this setting on.

## How to pin it

1. Call `list_admin_settings({ category: "ApplicationSettings" })`.
2. Open `ApplicationSettings_OrgLevel`. Read **Active** before the field value.
3. If **Active** is No, stop. The record is not synced. The device defaults `EnableDynamicActions` to false even when the field on that inactive record is true.
4. Activate `ApplicationSettings_OrgLevel`. After the next sync, the device uses the field value on that record. If the field itself is false, set `EnableDynamicActions` to true on the active record.
5. A profile override is a separate record. Check it only after the org record is active. An inactive org record is enough to explain a device that has never received the setting.

## Required answer

The reply must include all of:

- Cause: `ApplicationSettings_OrgLevel` is inactive, so it is not synced. The mobile app defaults `EnableDynamicActions` to false.
- Evidence: **Active: No** on that record from `list_admin_settings({ category: "ApplicationSettings" })`.
- Fix: activate the record. Do not treat this as a platform limit, and do not enable Dynamic Forms on Mobile.

## Do not

- Do not lead with `User.Profile.Name` or with Dynamic Forms on Mobile.
- Do not call the missing actions working as designed while `ApplicationSettings_OrgLevel` is inactive.
- Do not change `EnableDynamicActions` on an inactive record and expect the device to pick it up. Activate the record first.
