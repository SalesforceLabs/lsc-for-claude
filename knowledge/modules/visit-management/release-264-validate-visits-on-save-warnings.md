# Validate Visits on Save and Return Warnings - Winter '27 (264)

Platform: iPad and Web. Note: the release note is dated Summer '26 (262, week of June 22, 2026); the Winter '27 Help article is "Visit Action Validation Scripts".

## What's New

- Visit Action Validation custom scripts can now run on **Save**, not just Submit or Sign.
- Scripts can return a new **warning** status, which shows a dismissible confirmation instead of a blocking error (web and mobile).

Previously, validation only ran on Submit or signature capture, so reps learned of issues late, and admins could not warn without hard-blocking.

Use case: enforce country- or company-specific rules not available out of the box (e.g. visit limits). A rep over the limit sees a warning on Save and can continue; a stricter rule can return a blocking error that prevents the save.

## Admin Setup (update the existing Visit Action Validation custom script)

1. Read the current action from the `actionName` environment option and include `Save` in the supported actions:

```js
const actionName = env.getOption('actionName');
const allowedActions = ['Save', 'Submit', 'Sign'];
```

   Check `actionName` to apply the same validation to all actions, or define different behavior for Save, Submit, and Sign.

2. For non-blocking issues, return `status: 'warning'` with the message in `title`:

```js
return [{
    status: 'warning',
    title: 'At least one detailed product should be discussed in the visit.'
}];
```

Scripts that call `runCustomScriptValidations` can drop it; scripts that still include it keep working.

## Script Registration (Admin Console)

1. Create a Lightning web component containing the validation script.
2. Admin Console > **Workflow Configuration** > **Custom Scripts**: add the script with Script Name (e.g. `visitSampleScript`), your LWC component name, and Type **Visit Action Validation**.
3. Create only **one** Visit Action Validation script per org. Scripts have no Active field: saving activates it, deleting deactivates it.
4. After changing the component, return to Custom Scripts and select **Refresh** on the script row.

## Behavior and Considerations

- Validation runs for Save, Submit and Sign (Sign covers digital and paper signatures). It also runs for child attendee visits and for saves triggered by actions such as starting a remote session or opening an attendee visit. It does NOT run for Withdraw.
- Warnings-only result: one window lists all warnings and the user can continue or cancel. If errors and warnings are both returned, errors take precedence and the action is blocked.
- The same script runs on mobile and web; test both. Use `async`/`await` so it works on desktop (mobile strips it and runs `db` calls synchronously).
- Visit data may exist only in memory: read current values from `contextData` (the Help example uses a `getFieldData` helper because context differs between mobile and web); reserve `db.query` for unmodified data (e.g. Account record type).
- To vary behavior by user group (errors for one team, warnings for another), query `PermissionSetAssignment`; reps need the **View Setup and Configuration** permission.
- Reps cannot access Profile; query `ProfileIdentifier` on `UserAdditionalInfo` instead.
- Offline mobile evaluation: add any custom objects the script queries (e.g. visit limit definitions) and `PermissionSetAssignment` to the metadata cache configuration (DB Schema) with Type **Data** and **Web-to-Mobile Sync**, then regenerate the cache.

Reference: "Visit Action Validation Scripts" in Salesforce Help. See also the `lsc-custom-scripts` skill for IIFE/CodeText conventions.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_custom_scripts_example_visit_action_validation_script.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_execution_visit_script_validation.htm&release=262.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_custom_scripts_visit_data_example.htm&release=264.0.0&type=5 (search excerpt only)
