# Visit Engagement still shows the old Samples label

**What you see:** Setup > **Rename Tabs and Labels** renamed a related list, such as Product Disbursements to Samples. Visit Engagement still shows the old name.

Visit Engagement reads that name from the Standard Label Translations document. It does not bypass Rename Tabs and Labels. The document is stale. Re-generate it.

## How to pin it

1. Confirm Rename Tabs and Labels already has the new name, and Visit Engagement shows the previous name. The Samples section is the usual case. The same check applies to any related list renamed for Visit Engagement.
2. Open Admin Console > **Standard Label Translations** and read **Last Refreshed Date**. Or query the document:

```sql
SELECT Id, DeveloperName, LastModifiedDate
FROM Document
WHERE DeveloperName = 'StdObjectsTranslations'
```

3. Compare that date to the rename. If the document was last refreshed before the rename, stop. The new label was never written into the document Visit Engagement uses.
4. Re-generate the standard label translations with **Create Standard Label Translations Document**. After it finishes, Last Refreshed Date is later than the rename, and Visit Engagement shows the new label.

## Required answer

The reply must include all of:

- Cause: Standard Label Translations were last refreshed before the Rename Tabs and Labels change, so Visit Engagement still has the old label.
- Evidence: the Last Refreshed Date, or `Document.LastModifiedDate` for `StdObjectsTranslations`, is before the rename. Rename Tabs and Labels already has the new name.
- Fix: re-generate the standard label translations. Do not say a managed-package component bypasses Rename Tabs and Labels.

## Do not

- Do not leave the cause as an unverified component that ignores Rename Tabs and Labels.
- Do not use this leaf when desktop shows the raw key `NextVisitObjectiveLabel`. That key was dropped from the en_US LSC translations document. See [support-engineering-visit-next-objective-label.md](./support-engineering-visit-next-objective-label.md).
- Do not stop at Translation Workbench. The stale document is the pin, and re-generating it is the fix.
- Do not change the page layout or the related list to force the new name while the document date is still before the rename.
