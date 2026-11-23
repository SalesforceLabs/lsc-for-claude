# Product selection fails when the parent therapeutic area is not on the territory

**What you see:** During Visit creation, selecting a product errors or is blocked. The product is a Brand that is aligned to the territory. Its parent Therapeutic Area is not assigned to that territory.

A Brand whose parent Therapeutic Area is off the territory is a supported setup. Web and the mobile app do not apply the same rule to that parent, and neither result is the expected one for this Brand.

## How to pin it

1. On `LifeSciMarketableProduct`, confirm the Brand and read `ParentTherapeuticAreaId`.
2. Query `ProductTerrDtlAvailability` for the rep's territory. The Brand has a row. The parent Therapeutic Area does not.
3. Select that Brand while creating a visit on web, then select it on the mobile app. Record both results. They differ.
4. Stop. Do not add the parent Therapeutic Area to the territory, and do not change product dates, field-level security, or the metadata cache for this case.

## Required answer

The reply must include all of:

- The parent Therapeutic Area being off the territory is supported for this Brand.
- Web and the mobile app disagree on selection of that Brand, and neither result is the expected one.
- Evidence: the Brand's availability row, the missing parent row, and the two client results.

## Do not

- Do not explain this as missing product metadata, field-level security, a stale metadata cache, or product start and end dates.
- Do not stop on the web check of the parent Therapeutic Area. Compare the mobile app on the same Brand.
- Do not treat an unaligned parent Therapeutic Area as an invalid product setup.
