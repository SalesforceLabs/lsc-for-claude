# Custom LSC Apps: Offline Bundles, Offline GraphQL, Nested Components - Winter '27 (264)

Platform: iPad. All three features available starting the week of October 5, 2026.

## Access Custom LSC Apps Offline

Offline-enabled LSC apps are available without a prior connected session: during each sync the mobile app downloads the custom app bundles to the device.

## How Offline Support Works (Help)

The Lightning Mobile Runtime hosts LWCs in the app. With offline support on, an interception layer resolves UI API requests from the device's local SQLite database: (1) check for a registered handler, (2) if matched, respond locally with no network call, (3) if none and online, fall through to the network, (4) if none and offline, the adapter returns an error. Writes (create/update/delete) persist locally with temporary IDs (`EntityName-UUID`) and sync on reconnect. With offline off, LWC quick actions talk straight to the server and the app only sees changes after the next sync.

**Enable:** permission **Life Sciences Commercial Admin**. Admin Console > **Mobile** > **Application Settings** > under **LSC Mobile Apps**, turn on **Use Mobile Apps offline**.

## Supported / Unsupported Adapters Offline (Help)

Supported (local handlers): `getRecord`, `createRecord`, `updateRecord`, `deleteRecord`, `getRecordCreateDefaults`, `getLayout`, `getRecordUi`, `getLookupRecords` (`lightning/uiRecordApi`); `getRelatedListRecords` (`lightning/uiRelatedListApi`); `getObjectInfo`, `getObjectInfos` (batch; partial failures possible), `getPicklistValues`, `getPicklistValuesByRecordType` (`lightning/uiObjectInfoApi`).

Unsupported (cannot resolve offline): `notifyRecordUpdateAvailable`; `getRelatedListInfo`, `getRelatedListInfoBatch`, `getRelatedListsInfo`, `getRelatedListRecordsBatch`, `getRelatedListCount`; `getNavItems` (`lightning/uiAppsApi`); **`graphql` (`lightning/uiGraphQLApi`)**; any Connect API (`/connect/`), Apex REST (`/services/apexrest/`) and SOQL via REST (`/services/data/{version}/query`) call. Apex methods are also not in the supported list.

## Resolve GraphQL Queries Offline

When offline, the mobile app resolves GraphQL queries from your custom LWCs against the data synced to the device.

- Turn on offline support for the Life Sciences Cloud mobile app.
- Build queries with the `graphql` wire adapter from `lightning/uiGraphQLApi`.
- Only data in the synced DB Schema is available offline; make sure the queried objects/fields are enabled in DB Schema (`list_db_schema`).
- **Conflict to verify:** the Winter '27 release note says offline GraphQL resolves from synced data, but the Help adapter table lists `graphql` (`lightning/uiGraphQLApi`) as unsupported offline. Test in the target app version before relying on it. Salesforce's Mobile Offline developer guide describes Offline GraphQL as a subset: no aggregate queries, no mutations, pagination only on top-level record queries (not nested child queries), no optional fields or dynamic query construction, and `lightning/graphql` does not support offline (use `lightning/uiGraphQLApi`).
- See official help: "Supported and Unsupported LWC Adapters for Offline Use".

## Combine Multiple Components in a Single LSC App

A single LSC app on the Home Page or on a tab in a Lightning record page can contain multiple nested custom LWCs (previously one component per app).

- Build **one parent LWC** that you add to the page and nest child components inside it.
- **Only the parent** needs the `lscMobileInline_` prefix and a `targets` entry in its configuration (`.js-meta.xml`) file.
- Child components (list, card, menu) can be reused across multiple LSC apps.
- Official help: "Multiple Components in an LSC App".

## Related Inline Component Setup (Help)

- Inline component API name needs the `lscMobileInline_` prefix; `lightning__RecordAction` and `lightning__RecordPage` targets, with an Integer `mobileHeight` property in the RecordPage targetConfig (pixel height in the app).
- On iPad, inline components in record page tabs need a Quick Action (type Lightning Web Component) on the object whose **Name** matches the component name exactly (e.g. `lscMobileInline_HelloWorld`); it need not be on a page layout and is hidden from the quick action menu. Not required for Home Page components or LWC quick actions.
- Help recommends only one LSC app as an inline component per record page; multiple can break the page renderer (the nested-parent approach above is the supported alternative).
- Regenerate the metadata cache after changes.

## Not Found

The Help article "Multiple Components in an LSC App" was not found in the search index; the nested-component guidance above is from the existing note.

## Reminder

OmniStudio (FlexCards, OmniScripts) is not available in the mobile app; custom LWC apps are the supported route for mobile customization.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_custom_lwc_apps_offline_adapters.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_custom_lwc_apps_enable_offline_support.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_custom_lwc_apps_offline_support.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=ind.lsc_custom_lwc_apps.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=ind.lsc_customer_engagement_create_and_add_lwc_as_inline_component_on_record_page.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=ind.lsc_quick_action_management_troubleshooting.htm&release=264.0.0&type=5 (search excerpt)
- https://developer.salesforce.com/docs/platform/mobile-offline/guide/use-graphql-limitations.html (search excerpt)
