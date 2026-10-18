# Presentation Clickstream Data Retention - Winter '27 (264)

> Source: Winter '27 release enablement deck, now GA; confirmed against the official Winter '27 release notes and Salesforce Help where noted in Sources.

## What's New

Page views and in-content interactions generate `PresentationClickStreamEntry` records. A retention policy in the Intelligent Content Admin Console now removes older records automatically or on demand, to control org storage.

## Admin Setup & Configuration

Permission set: **Life Sciences Commercial Admin**. Available in Lightning Experience (Enterprise/Unlimited) with the Life Sciences Cloud license, Customer Engagement add-on license and managed package.

1. App Launcher > **Admin Console** > **Intelligent Content** > **Data Retention**.
2. Under **Retention Policy**, enter the number of months to keep presentation click stream entry records. **Minimum retention period is 12 months.**
3. Under **Interaction Data Cleanup**, run or schedule the cleanup job:

| Option | Behavior |
|---|---|
| Run Now | Queues a job that deletes records older than the retention period. Deleted records can't be recovered. |
| Schedule | Choose how often the cleanup job runs: daily, weekly, or monthly. |

4. Save your changes.

> Help warning: validate regulatory and retention requirements before deleting; permanent deletion can affect audit trails and historical reporting.

## Archiving Before Deletion

To keep the data after deletion from the org: deploy the **Life Sciences Data Kit**, open the **Presentation Click Stream Entry** data stream (Presentation bundle) in Data Cloud, and select **Store Deleted Records**. The data then stays in Data Cloud after records are deleted from the org.

## Related

- [release-264-in-content-interaction-tracking](./release-264-in-content-interaction-tracking.md)
- Data Kit install steps: [release-260-smart-content-search](./release-260-smart-content-search.md)

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_intelligent_content_data_retention.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_intelligent_content_data_retention.htm&release=264.0.0&type=5
