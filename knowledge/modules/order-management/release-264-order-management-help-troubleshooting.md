# Order Management Troubleshooting, Quote Sharing and Price Waterfall (Salesforce Help, 264)

What Salesforce Help (release 264) says about Order Management issues, territory-based quote sharing, the Order Management flows and Price Waterfall. Use this before forming a theory from org data: when a symptom matches a row here, give Help's cause and fix first.

Sources:
- Troubleshooting Order Management: https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_troubleshooting.htm&release=264.0.0&type=5
- Quoted Order Sharing by Territory: https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_quote_sharing_territory.htm&release=264.0.0&type=5
- Add Account to Quotes Record Page: https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_configure_quote_sharing_territory.htm&release=264.0.0&type=5
- Order Management Flows: https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_flows.htm&release=264.0.0&type=5
- Price Waterfall: https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_price_waterfall.htm&release=264.0.0&type=5
- Price Waterfall Considerations: https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_price_waterfall_considerations.htm&release=264.0.0&type=5

## Issues and resolutions (Troubleshooting Order Management)

| Symptom | Cause and fix |
|---|---|
| iPad: opening or creating a quote fails with "Invalid configuration for lists. Field database wasn't found or there's no access to that field." Quote creation is blocked. | The Quote layout or a related list on the iPad references an **Opportunity field** that isn't available or accessible in the mobile quote configuration. Remove the Opportunity field reference from the mobile Quote layout (or related list), or make the field available and accessible to the mobile context. Then regenerate the metadata cache and sync. Don't grant broad object or field access to fix this. |
| A quote created and saved on the iPad doesn't lock or follow its approval workflow, though Generic Workflow is configured for its record type. Web works. | The quote's record type is cleared on save when **RecordTypeId isn't in the active Sales Transaction Context**. Add RecordTypeId to your Sales Transaction Context extension so it isn't nullified on save. Then regenerate the cache and test with a new iPad quote. |
| iPad Quote Details page shows field labels as @ tags instead of values; desktop is fine. | Field Section components render on the web only. For iPad add a Record Detail component instead of, or in addition to, the Field Section components. |
| Price Waterfall shows more than one row for the same tier discount; Pricing Simulation is correct. | Known issue in Revenue Lifecycle Management Order Capture, no workaround. Use Pricing Simulation for the breakdown. |
| Rep can't tap Net Unit Price to open the Price Waterfall popover. | Confirm Price Waterfall is on and quote statuses are configured. Have the rep log out and back in. |
| Price Waterfall popover opens but is empty. | The quote's status doesn't match the configured open or closed quote statuses. Compare the quote's Status picklist value with both lists, **including case**; a case mismatch causes this. |
| Popover works online but is empty offline. | Turn on Price Waterfall Persistence. |
| Some lines show waterfall data and others don't. | Expected: only lines that resulted from a waterfall-eligible pricing rule have waterfall data. |
| Waterfall data for a quote that closed last week is gone. | Retention expired. Default is 7 days after the quote's last modified date; increase Waterfall Open Quotes Retention Days. |
| Retention Days is 30 but reps see waterfall data for only 15 days. | Retention is capped at 15 days whatever the setting. |
| After a territory change a rep briefly sees waterfall data from the old territory. | Expected; clearing takes one sync. |
| Price Waterfall is off but reps still see old data. | Not synced yet; sync the device. |
| Mobile metadata generation fails and the app can't publish metadata org-wide. | Turn on Order Capture in an org that publishes LSC mobile metadata; it controls the Retail Execution and Assortment objects the mobile metadata validator requires. |
| Rep can't add any configurable products; Validate Mandatory Quote Fields flow blocks it with a validation error. | Known issue, no workaround. |
| A header-level discount doesn't apply, no error. | The discount distribution service needs its header discount type, value and distribution logic inputs to resolve. Check the List Group and Assignment elements that map them and that the correct context tag is selected (similarly named tags get mixed up). An unresolved input fails silently. |
| Quote PDF fails above 750 line items. | Up to 700 lines generate. No workaround above that. For up to 2,000 products, use the Related Record Table component for quote line items on the Quotes page. |
| iPad pricing doesn't match a recently changed price book, pricing procedure or decision table. | Regenerate the metadata cache; iPad pricing runs offline from cached data. |
| Rep can't see Quote Line Group on the iPad. | Quote Line Group isn't supported on iPad. |
| "System.CalloutException: Unable to tunnel through proxy. Proxy returns HTTP/1.1 403 Forbidden" when Base64 encoding. | The org's network proxy blocks the external domain. Have IT allow it, or use the Static Resource approach. |
| A store check photo syncs but isn't visible after the device syncs. | Set the Image object's metadata cache configuration attachment download method to Background, then resync. |

## Quote sharing by territory

- **Quotes have no relationship to territory.** The territory link comes from the **account**: users assigned to an account's territory get visibility into that account's quotes and related records. Don't add a territory field to Quote or build criteria sharing rules on one.
- The **Manage Quote Sharing** batch job runs on a set schedule, evaluates territory assignments and shares quoted orders and their related records with the right users.
- Records shared: **Quotes** (the primary record, linked to an account through territory assignment, drives the child records), **Quote Line Items** and **Quote Line Price Adjustments** (historical discounts).
- Works on web and iPad.
- Flows (Order Management Flows; each must be customized and activated):
  - **Share Created Quote**: shares a newly created quote with territories based on the related account's territory sharing configuration.
  - **Share Quotes**: shares quote records with their territories on a recurring schedule.
- Add the **Account for Quote** field to the Quote page layout header (Setup > Object Manager > Quote > Page Layout; needs Life Sciences Commercial Admin) so reps pick the account when creating a quoted order.
- Reps seeing only their own quotes is the usual result of a Private Quote org-wide default with the sharing job or flows not running. Check that the flows are active and the batch job is scheduled before changing sharing settings.

## Other Order Management flows

| Flow | What it does |
|---|---|
| Browse Product Catalog | Lists qualified products for the selected territory when line items are added |
| Build Product Details | Called by a parent flow; gets qualified product IDs and prepares the Apex output |
| Generate Quote Document for Agentforce Life Sciences | Triggers quote PDF generation on the Quote Document Creation event |
| Set Quote Document Defaults | Sets the default signature ID for the signature component on the quote document |
| Validate Mandatory Quote Fields | Checks Account, Billing and Shipping Contact Point Address and Sales Transaction Type aren't empty when App Usage Type is Life Sciences Order Management |

## Price Waterfall

- Shows each pricing step for a line: list price, discretionary discounts, automated discounts, net price. Reps tap **Net Unit Price** on a line to see it.
- A quote must have line items **priced through a discount flow** for the waterfall to exist.
- Offline quotes: the Offline Pricing SDK calculates the waterfall on the device and uploads it at the next sync. Previously submitted or web-created quotes: the rep downloads the waterfall data.
- **Price Waterfall turns on automatically when you set up the org with Salesforce Go.** **Price Waterfall Persistence** (needs Price Waterfall on) caches the data on the iPad for offline viewing, after closing the popover and across app relaunches.
- Turning off: the whole feature removes cached data at next sync and the popover disappears for everyone; Persistence only keeps the popover online but stops offline viewing; for one user, it disappears for that rep at their next sync.
- **Configure Open and Closed Quote Statuses first.** If both are empty, no waterfall data syncs to an iPad. Include every active quote status the org uses, custom ones too, in one of the lists, spelled exactly as the Quote Status picklist values including capitalization.
- Retention: Waterfall Open Quotes Retention Days, default 7 days after the quote's last modified date, capped at 15. Longer retention uses more device storage.
- On each sync the iPad removes waterfall data older than the retention period, data for quotes not in a configured open or closed status, and draft waterfall data beyond the most recent entry per line.
