# Field Email Fragment Tracking - Winter '27 (264)

## What's New

Field Email now records exactly which email fragments were selected by the end user when an email is sent. Previously the system stored the email and the template, but not the exact fragment subset chosen at send time. Fragment usage is now stored in a new transaction-grain entity, **Life Science Email Fragment**: each successful send records one row per (Email, Fragment), including the fragment version-at-send. History stays accurate even if templates or fragments are edited later.

**Use case:** A sales rep sends a planned email to an HCP using an approved template and a selected set of fragments. Later, a reviewer opens that send transaction and retrieves the exact fragments and their version-at-send, even though the template has since been revised.

## Admin Setup & Configuration

1. **Enable tracking:** Admin Console > Email > Email Settings > Tracking Settings > check **Track email fragment usage**. (Tracking Settings also contains Days to Track Status, Days to Keep Sent Emails, Days to Check History, and Status Tracking Batch Size.)
2. **Mobile (iPad) sync:** Admin Console > Mobile > Object Metadata Cache Configuration (DB Schema):
   - Add a record for **LifeScienceEmailFragment** (Name shown in the deck: `DbSchema_LifeSciEmailFragment`; Is Active checked; Type: Object; Delta Sync Date Field: Last Modified Date; profile e.g. Field Sales Representative) with SOQL Filter Condition `CreatedDate = TOMORROW`.
   - Edit the existing record for **LifeSciEmailTmplFragment** and set **Attachment Download Method** to `cache`.

### Fragment Setup (Help: "Manage and Share Email Fragments")

Permission set: **Life Sciences Commercial Admin**.

- Uploading an email template ZIP with a **Fragments** folder auto-creates Life Science Email Template Fragment (`LifeSciEmailTmplFragment`) records. You can also create/update them manually or via Data Loader.
- For a manual fragment: upload the fragment HTML and associate its Content Document with the fragment record. Record names must match the file names in the template ZIP (without extension), are **case-sensitive**, and must be **under 80 characters**. Include a description; it is shown to reps when they pick fragments.
- Share fragments, either:
  - One template: Admin Console > **Email** > **Email Templates** > open template > **Update Fragments Sharing**.
  - All templates: Admin Console > **Email** > **Email Fragment Jobs** > run or schedule the email fragment batch job (e.g. daily so new reps get access). The table shows job status and who started it.

### Mobile Object Metadata Cache (Help: "Mobile App Configuration for Emails")

Configured in Admin Console > **Mobile** tile; generate the metadata cache afterward (Help marks this as important). Documented email objects, all Type Data: ContentDocument, ContentDocumentLink (attachment download **Background**), ContentVersion, DataUsePurpose, LifeSciEmailTemplate, LifeSciEmailTmplFragment, LifeSciEmailTmplRelaFrgmt, LifeSciEmailTmplSnapshot (attachment download **Cache**), LifeScienceEmail, LifeSciMarketableProduct, Survey, TerritoryContentTmplAsgnt, Topic, TopicAssignment. The Help article does not list `LifeScienceEmailFragment` or set `cache` on `LifeSciEmailTmplFragment`; those two steps above come from the release deck.

## End-User Flow

- iPad: on the Send Email screen, the rep opens **Add Fragments** (searchable list with Fragment Name and Description, min/max selection, All / Selected toggle) and saves the selection. On a successful send, the selected fragments are recorded.
- The deck's iPad demo slide was a placeholder (no demo content).

## Data Model

- New entity: **Life Science Email Fragment** (object reference in the deck: `LifeScienceEmailFragment`), child of Life Science Email (one row per Email and Fragment), with a link to Content Version.
- Related existing entities in the diagram: Life Science Email, Life Science Email Template, Life Science Email Template Fragment (`LifeSciEmailTmplFragment`), Life Science Email Template Related Fragment, Life Science Email Template Snapshot, Content Document / Content Document Link / Content Version.

## Limitations/Gotchas

- Tracking only applies when **Track email fragment usage** is enabled.
- iPad visibility requires the DB Schema record for `LifeScienceEmailFragment` and the `cache` attachment download setting on `LifeSciEmailTmplFragment`, followed by mobile metadata cache regeneration (standard practice).
- The developer guide page for `LifeScienceEmailFragment` says only "Reserved for future use" (no field list). Confirmed fields from the Data 360 DLO mapping: `Id`, `LifeScienceEmailId` (parent email), `LifeSciEmailTmplFragmentId` (template fragment), `ContentVersionId`, `DataSource`, `DataSourceObject`. Version-at-send is represented by the linked Content Version. Use `describe_sobject` to confirm anything else.
- Fragment record names over 80 characters or not matching ZIP file names will not behave as expected (Help constraints).
- Data Cloud: `LifeScienceEmailFragment` maps to the `EmailMessageFragment` DMO (see data-cloud-data-kit module).

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_email_manage_fragments.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_email_dbschema_metadata.htm&release=264.0.0&type=5
- https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-lifescienceemailfragment_dmo_mappings.html
- https://developer.salesforce.com/docs/atlas.en-us.life_sciences_dev_guide.meta/life_sciences_dev_guide/sforce_api_objects_lifescienceemailfragment.htm
