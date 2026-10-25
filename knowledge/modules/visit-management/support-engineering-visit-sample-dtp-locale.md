# Web Samples and DTP do not render after a product is selected

**What you see:** On the Visit Engagement page on web, selecting a product does not render Samples or Direct to Practitioner. The same visit renders both on iPad.

The org locale is English (Ireland, Euro) in the old JDK format, `en_IE_EURO`. Web locale parsing does not accept that value, and Samples and Direct to Practitioner do not render. Switch the org to the ICU locale.

This is not a Provider Visit page layout, and it is not a missing Product Disbursements related list.

## How to pin it

1. Confirm Samples and Direct to Practitioner are missing on web only, after a product is selected, and both render on iPad for the same visit.
2. Read the org locale:

```sql
SELECT DefaultLocaleSidKey
FROM Organization
```

`DefaultLocaleSidKey` is `en_IE_EURO`. That is English (Ireland, Euro) in the old JDK format. The ICU locale does not use the `_EURO` suffix.

3. Stop. Web parses that locale and fails, so those two panels do not render. iPad does not use that parser.
4. Switch the org to the ICU locale. Enable ICU locale formats, and set the locale so it is no longer `en_IE_EURO`. After the change, select the product again on web. Samples and Direct to Practitioner render.

## Required answer

The reply must include all of:

- Cause: the org locale is English (Ireland, Euro) in the old JDK format, `en_IE_EURO`. That value breaks web locale parsing and blocks Samples and Direct to Practitioner after a product is selected.
- Evidence: `Organization.DefaultLocaleSidKey` is `en_IE_EURO`, web does not render the two panels, and iPad does.
- Fix: switch the org to the ICU locale.

## Do not

- Do not add Product Disbursements or a Direct to Practitioner related list to the Provider Visit page layout.
- Do not treat iPad and web as the same renderer. iPad already renders these panels.
- Do not change the product record. The product selection is what exposes the failed locale parse.
