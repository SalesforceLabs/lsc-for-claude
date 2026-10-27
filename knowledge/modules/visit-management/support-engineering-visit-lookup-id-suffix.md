# Visit Engagement shows a lookup label that ends in ID

**What you see:** On Visit Engagement on web, a lookup shows its raw label with an **ID** suffix. The label is not the relationship name.

A `ProviderVisitProdDetailing` field was added to the layout. That field is the parent lookup, so the screen forces a parent to be picked and labels the control with the raw name plus ID. This is not a regression in how labels are chosen.

## How to pin it

1. Confirm the control is a lookup on Visit Engagement whose label ends in **ID**, and that the user is asked to pick a parent.
2. Open the layout for that section. A `ProviderVisitProdDetailing` field is on it. The usual field is `ProviderVisitProductDtlId`.
3. Stop. That field on the layout is the cause. Remove it. The parent prompt and the ID suffix go away.
4. If the Provider Visit Information merged fields are empty and this lookup is not what the user sees, use [support-engineering-visit-information-dtl-field.md](./support-engineering-visit-information-dtl-field.md). This case is the ID suffix and the forced parent pick.

## Required answer

The reply must include all of:

- Cause: a `ProviderVisitProdDetailing` field on the layout forces picking a parent. Visit Engagement shows that lookup's raw label with an ID suffix. This is not a label regression.
- Evidence: the field is on the layout, and the on-screen label ends in ID.
- Fix: remove the `ProviderVisitProdDetailing` field from the layout.

## Do not

- Do not change label selection, translations, or Rename Tabs and Labels.
- Do not call this a package regression.
- Do not leave the field on the layout and rename it. The field does not belong on this layout.
