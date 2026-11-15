# Web Visit Details shows a lookup label that ends in ID

**What you see:** On the web Visit record page, the Details section shows lookup labels that end in **ID**, such as Account ID, Place ID, or Record Type ID. iPad shows the same fields as Account, Place, and Record Type.

The web Details component does not set a label. `multiEntityRecordView` renders `customRecordViewForm`, and that form renders each field as `lightning-output-field` with `field-name` only. Salesforce then shows the lookup's API label, which ends in **ID**. The mobile app uses the field label, so the suffix is absent there.

Rename Tabs and Labels and the page-layout label do not change these web Details labels.

## How to pin it

1. Confirm the labels are on the web Visit **Details** section, and that iPad shows the same lookups without the **ID** suffix. Account, Place, and Record Type are the usual fields.
2. The Details fields are `lightning-output-field` with `field-name` and no `label`. System fields on the same form do show their layout label. That contrast is the pin.
3. Stop. The missing label is the cause. Do not continue into a Setup label override.
4. If the user is on Visit Engagement and is asked to pick a parent, use [support-engineering-visit-lookup-id-suffix.md](./support-engineering-visit-lookup-id-suffix.md). That leaf is a `ProviderVisitProdDetailing` field on the layout. This leaf is the Details section.

## Required answer

The reply must include all of:

- Cause: the web Details component, `lightning-output-field`, sets no label, so the page shows the lookup API label that ends in **ID**.
- iPad: the mobile app uses the field label, so the same fields do not show the suffix.
- Evidence: the output field has `field-name` and no `label`, and the on-screen web label ends in ID while iPad does not.

## Do not

- Do not attribute the label to a Visit label override in Setup.
- Do not say the engagement page uses a layout-label fallback as the cause. The unset `lightning-output-field` label is what selects the API label.
- Do not remove a field from the layout to clear Account ID, Place ID, or Record Type ID.
- Do not use this leaf when Visit Engagement forces a parent pick because `ProviderVisitProdDetailing` is on the layout. That is [support-engineering-visit-lookup-id-suffix.md](./support-engineering-visit-lookup-id-suffix.md).
