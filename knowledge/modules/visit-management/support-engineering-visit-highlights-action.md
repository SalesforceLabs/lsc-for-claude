# Visit quick action is missing or will not open on iPad

**What you see:** An Update Record quick action on Visit, such as `Cancel_visit`, is missing on iPad on package 264. On package 262 the button can show, and the layout does not open.

iPad builds those actions from the FlexiPage Highlights Panel assigned to the Visit's record type. The packaged page for the `SalesforceTesting` record type does not include `Cancel_visit`.

This is not a blank GoTo target, and it is not a metadata-cache filter.

## How to pin it

1. Open the Visit and read its record type. The packaged case is `SalesforceTesting`.
2. Open the Lightning record page assigned to that record type. On the Highlights Panel, read the action list.
3. `Cancel_visit` is not in that list. The action can still exist as a Visit quick action. iPad does not show it from the object. It shows the Highlights Panel list for the page this record type uses.
4. Stop. Add `Cancel_visit` to that Highlights Panel, or assign the record type a page whose Highlights Panel already includes it. The button then shows, and the layout opens.

## Required answer

The reply must include all of:

- Cause: iPad builds Visit actions from the FlexiPage Highlights Panel. The `SalesforceTesting` record type's packaged page does not include `Cancel_visit`.
- Evidence: that record type, that page, and a Highlights Panel action list that omits `Cancel_visit`.
- Fix: add the action to the Highlights Panel, or assign the record type a page that already has it.

## Do not

- Do not start with a blank GoTo target on package 262.
- Do not start with a metadata cache or an action filter on package 264.
- Do not stop because the quick action exists on the Visit object. The page assigned to the record type is what iPad reads.
