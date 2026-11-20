# Order Management and Store Check References - Winter '27 (264)

Where to read the official documentation and enablement for Store Check and Order Management (quoted orders). For setup errors, start from [the troubleshooting index](./release-264-order-management-store-check-troubleshooting.md); for a full setup from a blank org, use the [steel thread](./release-264-store-check-order-management-steel-thread-v6.md) and its [run guide](./release-264-store-check-order-management-steel-thread-run-guide.md).

## Salesforce Help (public)

Start at the overview; the other articles are its children in the Help tree.

| Topic | Article |
|---|---|
| Overview | [Order Management overview](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_overview.htm&type=5) |
| Setup basics | [Set up basics](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_basics.htm&release=264.0.0&type=5), [Order Management basics](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_om_basics.htm&release=264.0.0&type=5) |
| Users and permission sets | [Get the org ready: users](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_get_org_ready_users.htm&release=264.0.0&type=5) |
| Admin Console (Orders and Pricing Settings) | [Admin Console configurations](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_admin_console_configurations.htm&release=264.0.0&type=5) |
| Store Check (assortments, assessment tasks and indicators, retail store KPIs, action plan templates) | [Store Check setup](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_store_check_setup.htm&release=264.0.0&type=5) |
| Pricing procedures | [Pricing procedures](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_pricing_procedures.htm&release=264.0.0&type=5) |
| Price waterfall | [Price waterfall](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_price_waterfall.htm&release=264.0.0&type=5) |
| Product views and Priority Products tab | [Product views](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_configure_product_views.htm&release=264.0.0&type=5), [Priority product tab](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_configure_priority_product_tab.htm&release=264.0.0&type=5) |
| Flows | [Order Management flows](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_flows.htm&release=264.0.0&type=5) |
| Quote lock and unlock | [Locking and unlocking quotes](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_quote_locking_unlocking.htm&release=264.0.0&type=5) |
| iPad and offline | [Mobile app configuration](https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_mobile_app_configuration.htm&release=264.0.0&type=5) |

## Release enablement (access-controlled)

| Resource | Link | Access |
|---|---|---|
| Release enablement deck | [Partner Community deck](https://partners.salesforce.com/069KX0000055FfM) | Salesforce Partner Community login |
| Release enablement video | [Vidyard recording](https://share.vidyard.com/watch/keeugRYKZuNw8YrSpwuKqi) | Password protected. Ask the Life Sciences Cloud product or enablement team for the password; it is not kept in this repo |

The enablement content in this module ([overview](./release-264-quoted-orders-overview.md), [admin setup](./release-264-quoted-orders-admin-setup.md), [rep flow](./release-264-quoted-orders-rep-flow.md), [pricing](./release-264-pricing.md)) summarizes the 264 deck.

## In this repo

- [Winter '27 official release notes](../../release-notes/winter-27-official.md) — new Store Check data model items (`AsmtIndDefExt`, `AssessmentIndicatorDefinition.DefaultComparisonRule`, `Assortment.UsageType`, `AssortmentProduct.IsRequired`, `StoreAssortment.StoreCheckType`) and quoted-order changes
- [Store Check pilot (260)](./release-260-store-check-pilot.md) — Store Check data setup order
- [Setup runbook](./release-264-order-management-setup-runbook.md) — field-verified gotchas, products missing on Add Products (PTA/PTDA)
- [Known causes](../../troubleshooting/known-causes.yaml) — `order-management` entries matched by `diagnose_lsc_issue`
