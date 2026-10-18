# Quoted Orders Admin Setup - Winter '27 (264)

Audience: Business Admin and Pricing Admin. Overview and data model: [release-264-quoted-orders-overview](./release-264-quoted-orders-overview.md). Pricing procedure/recipe/context detail: [release-264-pricing](./release-264-pricing.md).

## 1. Salesforce Go (Revenue Cloud setup)
- Location: Setup -> Salesforce Go -> filter "Agentforce for Life Sciences Cloud" -> open the **Customer Engagement - Order Management** feature card.
- One switch enables: Revenue Cloud, Quotes, Context Service, Salesforce Pricing, Price Waterfall Setup, Transaction Pricing.
- The guided checklist also covers: Document Builder, Advanced Approvals, Quote Capture, Standard Price Book, and activating the Quote record page (guided quote layout).
- Still manual after the switch: admin permission sets, standard price book, context extension, and the pricing recipe/procedure.
- Set Up Transaction Pricing opens Revenue Settings: switch on Transaction Processing for Quotes and Orders and select the out-of-the-box transaction processing type shipped for the LSC customer-engagement mobile license (needed for offline quote capture/pricing).
- Optional "Apply Header Adjustments to Quotes" step redirects to Revenue Settings to enable Header Adjustment (places Manage Header Adjustment on the Sales Transaction Line Editor).

## 2. Permission sets
Assign to the admin and the sales rep user before configuring.

**Admin**
- Context Service Admin and Context Service Runtime (required for the extended Sales Transaction context the pricing procedure consumes)
- Life Sciences Commercial Admin and Life Sciences Commercial Core
- Product Catalog Management Designer and Viewer
- Salesforce Pricing Admin

**Sales rep**
- Price and Tax Calculation for Quoting
- Product Catalog Management Viewer
- Document Builder User
- Salesforce Pricing Run Time User
- Life Sciences Field Sales Representative

Also enable the **Quote Capture** permission on the Life Sciences for Customer Engagement setup page; this is what makes quote capture and pricing work offline on the iPad.

## 3. Field-level security by profile
In Salesforce Go -> Order Management, open "Activate Field-Level Security by Profile for Required Objects", select each required profile (Business Admin, Sales Rep), grant read or edit on required fields, and save. Covers Quote, Quote Line Item, and related pricing and document objects. Custom context-attribute fields (e.g. free goods) must also be made visible to the needed profiles before mapping and activating the context.

## 4. Generic workflow (stage control)
Controls what a rep can do to a Quoted Order at each stage; admins define allowed actions (create, edit, delete, submit) per stage and a stage path is shown on the record.
- **Draft**: rep can create, edit, add lines, delete.
- **Submit**: quoted order is locked.
- **Request for Unlock**: rep requests unlock; once the manager approves, the rep can edit.

## 5. Flows
- **Select Discover Products Flow** (Salesforce Go -> Order Management): choose the flow that launches the product catalog so reps can browse and add products to a quote.
- **LSC Validate Mandatory Quote Fields** (V1): record-triggered flow, runs after save on Quote; enforces required fields before a quote can progress.

## 6. Quote document template
- In Document Builder create a Quote document template mapped to the quote and line items; lay out header, pricing table, and terms with merge fields.
- Drag in the **Life Sciences Digital Signature** component and position the signature block.
- Disclaimers: insert records in **Compliance Statement Definition**; review-screen disclaimer text can be filtered by market/territory on account/territory fields (same pattern as Consent and Visit Management).
- Reps generate the PDF from the iPad after the manager's signature is captured.

## 7. Mobile metadata (offline quotes and pricing)
Admin Console -> Life Sciences Customer Engagement Setup -> Mobile tab.
1. **Object Metadata Cache Configuration** (Type = Data, per profile that needs offline order capture, e.g. Pharmacy Sales Rep): Quote, Quote Line Item, and Quote Document are already configured by the order-capture setup. Add Pricebook Entry, Pricebook2, Price Adjustment Schedule, Price Adjustment Tier, and activate.
2. If the pricing procedure uses a custom decision table via Price Adjustment Matrix, also add its custom source entity as a Data entry (optional SOQL WHERE filter; Delta Sync tracks Last Modified Date) or the offline discount lookup has no data.
3. **Metadata Cache** tab -> Create New Cache, then sync devices.

## 8. Admin Console: Orders and Pricing Settings
Admin Console -> Order Management tile -> Orders and Pricing Settings. "Apply Settings To" = Org Default or Profile.
- **Product Views**: active quick-add options (Products From Previous Order, Store Assortment); when Products From Previous Order is on, set the Last Quote Status used to find the prior quote (e.g. Submitted/Approved).
- **Priority Products**: enable the Priority Products tab to surface Required store-assortment products while browsing the catalog.
- **Transaction Configuration**: set the Pricing Procedure per org/profile (e.g. LSC Rev Default Procedure - All; another example used was LSC OM Pricing).
- **Pricing Waterfall retention**: choose Open quote statuses (e.g. Draft) that retain pricing calculation and explainability offline; Closed quote statuses (e.g. Submitted) so a closed quote's pricing is available offline; Open Quote Log Retention (Days) caps on-device waterfall storage (example value 5).
- **Quote Settings**: offline Quote record type; Transaction Processing Type "TPT for LS4CE Mobile" (ships with 264; controls e.g. whether pricing/tax calc is skipped); Max Quote Line Items Per Quote = 1,000 in the example.
- At runtime the profile -> pricing procedure mapping is realized through the **Sales Transaction Type** entity (SalesTransactionType), a lookup on the Quote.

## 9. Visit record type routing
Quoted Orders are launched from the Visit (Visit tabs include Store Check and Quoted Order). Enable Record Type Routing in Life Sciences Customer Engagement Setup, then configure under Admin Console; create separate page layouts per Visit Type (record type) and assign them to profiles. Orgs with existing LogAVisit overrides must remove them first.

## Limitations / Gotchas
- The waterfall is data-intensive; not all of it downloads. It is available on demand (tap Net Unit Price; if not cached the app guides the rep to download online).
- Cost books are not supported for LSC Order Management.

## Verified Against Official Help (Set Up Quotes and Pricing)
- **Scope/licensing:** Help lists the **Revenue Lifecycle Management add-on license** (plus Life Sciences Cloud, Customer Engagement add-on, managed package; iPad only for mobile) as the requirement for quoted orders and pricing. Turn on: Setup > **Salesforce Go** > Customer Engagement - Order Management > Setup (release note wording: Agentforce Life Sciences > LSC Order Management). Needs the **Life Sciences Commercial Admin** permission set.
- The toggle activates: Revenue Cloud, Quotes (no opportunity needed), Document Builder, Advanced Approvals (web only), Context Service, Salesforce Pricing, Price Waterfall, Transaction Pricing, Quote Capture, Standard Price Book. Then deploy the Quote record page.
- **Rep/user permission sets (Help):** Health Cloud Starter, Life Sciences Core, Life Sciences Field Sales Representative, Product Catalog Management Viewer, Document Builder User, Price and Tax Calculation for Quoting, Salesforce Pricing Runtime User. Create custom profiles from Standard User with Read + View All on Sales Transaction Type and Application Usage Assignments; reps need Read/Edit on those objects.
- **Correction:** the admin list above says "Life Sciences Commercial Core"; Help names **Life Sciences Core** for users and Life Sciences Commercial Admin for admins.
- **FLS (read-only for reps):** Quote: Status, GrandTotal, CalculationStatus, ValidationResult, TotalPrice, Subtotal. QuoteLineItem: TotalLineAmount, Subtotal, NetUnitPrice, NetTotalPrice, TotalAdjustmentAmount, TotalAdjustment, PriceWaterfallIdentifier, Discount, DiscountAmount, Margin, MarginAmount.
- **Sharing:** Quote = Private (so reps see only their territory's quotes); Catalog = Public Read Only for reps; also review Expression Set, Price Adjustment Schedule, Sales Transaction Type, Product Territory (Detailed) Availability, Product, Life Science Stage Action/Object.
- **Admin Console path (Help):** App Launcher > Admin Console > **Orders Management** > **Quotes and Pricing settings** tab; choose org or profile. Sections: Product Views (Last Order or Store Assortment, plus last-order status), Default Pricing Procedure, Priority Products tab (Enable Priority Products Tab), Disclaimer Filters, Price Waterfall Settings, Default Quote Document, Quote Fields and Mobile Layout. (Deck calls this "Orders and Pricing Settings".)
- **Sales Transaction Type** pricing procedure takes priority over the Admin Console selection; it is auto-populated on iPad-created quotes.
- **Flows shipped:** Browse Product Catalog; Build Product Details (calls the getQualifiedProducts action); Generate Quote Document for Agentforce Life Sciences (triggered by Quote Document Creation event); Set Quote Document Defaults (default signature ID); Share Created Quote; Share Quotes (recurring); Validate Mandatory Quote Fields (Account, Billing/Shipping Contact Point Address, Sales Transaction Type when App Usage Type is Life Sciences Order Management).
- **Locking/unlocking:** workflow stages Draft, Submitted, Request for Unlock; a record-triggered approval flow routes to the owner's manager (approve -> Draft/unlocked; reject -> Rejected/locked); optional notification flow and Approval tracking components on the Quote page. Help marks the sample flow "for reference only". Unlock requests can be submitted offline.
- **Mobile cache objects (Data type):** Quote, QuoteLineItem, QuoteDocument, Quote Document Recipient, DigitalSignature, DocumentRecipient, Pricebook2, PricebookEntry, PriceAdjustmentSchedule, PriceAdjustmentTier, Product2, ProductSellingModel, ProductCategoryProduct, LifeSciMarketableProduct, ProductTerritoryAvailability and ProductTerrDtlAvailability (where: `Territory.Name = '{USER.TERRITORY}' AND AlignmentType = 'Territory Exclusion'`), LifeSciProductAcctRstrc, UnitOfmeasure. Regenerate the cache after changing price books or pricing procedures (iPad prices from cached data). Custom Price Adjustment Matrix objects need their own cache record.
- Quote PDFs can be generated, viewed, and edited only from web (per Help); the deck shows iPad PDF generation, which Help does not confirm.
- Not verified: "Cost books not supported", TPT for LS4CE Mobile, Max Quote Line Items, Visit record type routing steps.

## Sources
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_basics.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_om_basics.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_get_org_ready_users.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_flows.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_mobile_app_configuration.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_quote_locking_unlocking.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_admin_console_configurations.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_configure_product_views.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_configure_priority_product_tab.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_order_management_create_quotes_from_anywhere.htm&release=264.0.0&type=5
