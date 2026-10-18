# Data Cloud Data Kit, Tableau Next, and Mobile Home Dashboards

## Documentation Files

- [data-kit-to-mobile-dashboard-walkthrough](./data-kit-to-mobile-dashboard-walkthrough.md) — Field-verified walkthrough (Winter '27, API 68.0): deploy the Life Sciences Data Kit, verify CRM-to-Data 360 streams, add a stream the kit lacks (Visit), build a Tableau Next semantic model, visualizations and dashboard, then put the dashboard on the LSC Home screen and see it on the iPad. Includes the access, API-version, and dashboard-page-name gotchas.

For the product setup steps, see the official admin guide chapter "Integrate Data 360 and Tableau Next with Customer Engagement". For the SSOT-versus-Singularity background and a Tableau Next metrics demo, see the `data-cloud-singularity-and-tabnext-metrics` module.

## Winter '27 (Release 264) Enhancements

Life Sciences Data Kit adds an **Email Message Fragment** DMO and data stream, expanded **Email Message** mappings and updated **Presentation Click Stream Entry** mappings. See `winter-27-official` release notes and `intelligent-content/release-264-in-content-interaction-tracking.md`.

**Deploy (Help: "Deploy Life Sciences Data Kit")** - requires Data 360, the Life Sciences Cloud license, Customer Engagement add-on license and managed package. Permission set to deploy: **Data Cloud Architect** (Life Sciences Commercial Admin and Data Cloud User are also listed for the Email Template bundle feature).
1. Data Cloud Setup > Quick Find `Data Kits` > **Data Kits**.
2. Select **Life Sciences Data Kit**, review contents, click **Data Kit Deploy**.
3. Select a data space.
4. Select each component and enter your org ID for each.
5. Click **Deploy**.

The kit has six bundles: Activity Plan, Email Template, Marketable Product, Presentation, Provider Visit, Sales Territory Account. The Help DMO list (264) names Email Template bundle objects (Email Template, Email Template Fragment, Email Template Related Fragment, Email Template Snapshot) and Presentation bundle objects (including Presentation Click Stream Entry); it does not list Email Message or Email Message Fragment.

**Email Message Fragment mapping** (DLO `LifeScienceEmailFragment` to DMO `EmailMessageFragment`): `ContentVersionId` to `ContentDocumentVersionId`; `DataSource` to `DataSourceId`; `DataSourceObject` to `DataSourceObjectId`; `Id` to `Id`; `LifeSciEmailTmplFragmentId` to `EmailTemplateFragmentId`; `LifeScienceEmailId` to `EmailMessageId`.

**Email Message mapping** (DLO `LifeScienceEmail` to DMO `EmailMessage`), notable fields: `Status` to `EmailStatus`; `SubjectText` to `EmailSubjectText`; `ScheduledDateTime`, `SentDateTime`, `CancelledDateTime`, `BouncedDateTime`; `UrgencyType`; `EmailTemplateId`; `PresentationId`; `CommSubscriptionConsentId`; `Consent_Ignored` to `IsConsentIgnored`; `FirstOpenedDate` to `FirstOpenDateTime`; `LastOpenedDate` to `LatestOpenDateTime`; `ToAccountId` to `RelatedToId`; `ToContactId` to `ToIndividualId`; `SenderEmailAddress` to `FromAddress`; `SentToEmailAddress` to `ToEmailAddressListText`; `SenderTerritoryId`, `SenderUserId`.

**Presentation Click Stream Entry mapping** (DLO `PresentationClickStrmEntry` to DMO `PresentationClickStreamEntry`) includes the in-content fields `ContentEventDescription`, `ContentEventIdentifier`, `ContentEventType` and `MetricEntryType`, plus `ContentReaction` to `ContentReactionNumber`, `ActualUsageDuration` to `ActualUsageDurationNumber`, `PresentationFileContentName` to `PresentationFileName`, `Product_Record_Object` to `ProductRecordObject`, `ProductId` to `ProductReferenceRecordId`.

**Archiving:** on the Presentation Click Stream Entry data stream select **Store Deleted Records** to keep data in Data Cloud after Intelligent Content retention cleanup deletes org records.

Not verified: whether the "Email Message Fragment" stream is shipped in a named bundle and how the deck's "expanded" Email Message mappings differ from earlier releases (no Help text found).

Sources:
- https://help.salesforce.com/s/articleView?id=ind.lsc_customer_engagement_deploy_data_kit.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_customer_engagement_data_model_objects_data_kit.htm&release=264.0.0&type=5
- https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-lifescienceemailfragment_dmo_mappings.html
- https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-lifescienceemail_dmo_mappings.html
- https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-presentationclickstrmentry_dmo_mappings.html
- https://help.salesforce.com/s/articleView?id=ind.lsc_intelligent_content_data_retention.htm&release=264.0.0&type=5
