# Product guidance from a presentation ignores effective dates

**What you see:** A `ProductGuidance` row is `IsActive` and its `EffectiveStartDate` or `EffectiveEndDate` is outside the visit. It still appears when the product is reached from a presentation. The same guidance is absent when that product is added directly.

`PresentationItemService.isActiveProductGuidance` and the DAO that loads those `PresentationPageProduct` rows filter `ProductGuidance.IsActive` only. They omit `EffectiveStartDate` and `EffectiveEndDate`. The direct product path applies both dates, so the same row is excluded there.

An empty code search does not change this. The method and the DAO are the pin. Do not ask for a component name.

## How to pin it

1. Load the guidance:

```sql
SELECT Id, Name, IsActive, EffectiveStartDate, EffectiveEndDate, ProductReferenceRecordId
FROM ProductGuidance
WHERE Id = '<guidance id>'
```

`IsActive` is true, and the visit date is before `EffectiveStartDate` or after `EffectiveEndDate`.

2. Confirm the presentation link:

```sql
SELECT Id, PresentationPageId, ProductId, ProductGuidanceId
FROM PresentationPageProduct
WHERE ProductGuidanceId = '<guidance id>'
```

3. Add that product on the visit with no presentation. The guidance is not offered.
4. Open the same product from the presentation page in step 2. The guidance is offered.
5. Stop. That split confirms the close: `PresentationItemService.isActiveProductGuidance` and its DAO kept the presentation row on `IsActive` and omitted `EffectiveStartDate` and `EffectiveEndDate`. The direct product path applied the dates.

## Required answer

The reply must include all of:

- Cause: `PresentationItemService.isActiveProductGuidance` and its DAO filter `IsActive` only and omit `EffectiveStartDate` and `EffectiveEndDate`. The direct product path applies those dates and hides the same row.
- Evidence: one `ProductGuidance` that is active, outside its effective window, linked by `PresentationPageProduct`, present from the presentation, and absent when the product is added directly.
- Do not leave the path unverified, and do not ask for a component name.

## Do not

- Do not stop because a code search returned no hits.
- Do not treat both paths as the same filter.
- Do not deactivate the guidance or edit its dates to explain the difference. The dates are already outside the visit. The presentation path ignores them.
