# Quoted Orders Rep Flow (iPad) - Winter '27 (264)

End-user experience for the Pharmacy Sales Rep on the Life Sciences Cloud iPad app. Admin configuration: [release-264-quoted-orders-admin-setup](./release-264-quoted-orders-admin-setup.md).

## End-User Flow
1. **Home**: Agentforce Welcome Center prompts (promotions, delayed deliveries, out-of-stock accounts, competitive insights) and territory announcements. Navigation: Home, Accounts, Managed Events, Visits, Quotes.
2. **Visit**: planned visit -> Begin Visit on arrival (captures geolocation) -> In Progress. Visit tabs: Details, Related, Surveys, Presentation, Store Check, Quoted Order. The account carries the assigned price book and customer tier.
3. **Store Check** (optional precursor): availability audit against the store assortment, priority products first; out-of-stock reasons (Not Ordered, Backorder, Delisted, Supplier Delay, Other). What is seen on the shelf informs quoted quantities.
4. **Create Quoted Order**: New button launches guided creation.
5. **Header**: many fields auto-populate. Rep sets Quote Date, Requested Delivery Date, Account, Billing Address, Distribution Channel, Payment Terms, and the Price Book that drives pricing. Related Store Visit can be linked if the quote was not started from a visit. Bill-To Country and Customer Tier come from the account, not per quote.
6. **Add products**: copy from last order, add the store assortment, or add manually from the catalog. Rep sees products available in the territory, honoring account product restrictions.
7. **Quantities**: set on the Edit Sales Units keypad per line; every change re-runs pricing (offline too).
8. **Free goods**: add free-goods quantity on a line; pricing updates to show the attributable discount.
9. **Price waterfall**: live for the current quote (offline pricing SDK); previous quotes' waterfalls can be downloaded on demand online. Tap a line for Calculation Details.
10. **Discounts**: product (line) discount via Discount -> Add (Amount or Percentage, one type per line); header (order) discount as Amount or Percentage, distributed Equal or Proportionate.
11. **Review**: quote summary with each discount and calculation, delivery details, legal disclaimer, totals (gross, total discount amount and %, net).
12. **Signature**: manager signs on the iPad; the app asks the rep for a passcode to leave the screen (prevents accidental exit). Rep unlocks with device authentication and submits.
13. **Submit**: works with no connectivity; auto-syncs on reconnect. Approvals (if configured) are handled by Salesforce after sync.
14. **Email**: a Quick Action opens the quoted-order email template pre-populated with quote details.

## Offline Sync Behavior
- Phase 1: Quote / Quote Line Item records sync.
- Phase 2: Price Waterfall records sync (stored in HBase, not a standard object, so they cannot ride the same batch).
- The server validates pricing on sync and reproduces every step the iPad computed; the offline SDK runs identical logic, it does not approximate.

## Live Pricing Behavior Shown
- 8% volume discount drops to 5% when the quantity reduction means the 200-unit tier no longer qualifies.
- Example totals shown: order total 18,180 minus 1,748 (9.61%) = 16,432.

## Gotchas
- Products on the Store Assortment marked Required appear under the Priority Products tab only if enabled in Orders and Pricing Settings.
- Submitted quotes are locked by the generic workflow; editing requires an unlock request approved by a manager.

## Verified Against Official Help
- Help: reps tap **Net Unit Price** on a line item to see the waterfall; the quote must have line items priced through a discount flow. Offline quotes: the Offline Pricing SDK computes the waterfall on device and uploads it at next sync (no manual download). Previously submitted or web-created quotes require downloading waterfall data.
- Unlock requests can be submitted offline and queue until sync; manager approves/rejects from the Quote record page or a notification (approve -> Draft; reject -> Rejected, stays locked).
- Help says Quote PDF generate/view/edit is web-only; the deck's iPad PDF/email step is not confirmed.
- Pricing is on-save only (recalculated when the rep saves the quote). The deck's "every change re-runs pricing" should be read in that light.

## Sources
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_price_waterfall.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_quote_locking_unlocking.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_pricing_procedures.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_order_management_setup_basics.htm&release=264.0.0&type=5
