# Life Sciences — Winter '27 (Release 264) Official Release Notes

Source: Salesforce Release Notes, Industries > Life Sciences (Winter '27, PDF export dated 2026-10-18, pp. 657–688). Online: https://help.salesforce.com/s/articleView?id=release-notes.rn_lifesciences.htm&release=264&type=5

> Life Sciences Cloud (LSC) is now Agentforce Life Sciences. You may see references to LSC in our application and documentation.

Unless noted, every feature below requires Lightning Experience in Enterprise or Unlimited edition, the Life Sciences Cloud license, the Life Sciences Cloud for Customer Engagement add-on license, and the Life Sciences Cloud for Customer Engagement managed package. "iPad" means the Life Sciences Cloud mobile app for iOS (iPad only).

## Overview

Field reps can dictate visit notes and automatically populate records, even while offline. Order Management makes it easy to execute store checks accurately and create quoted orders with consistent and transparent pricing. Event Management now provides real-time notifications when participants overutilize accounts or their estimated expenses exceed monetary limits.

## Account Management

### Manage Complex Territory Alignments with Advanced Rules
Configure advanced rules in Sales Planning and run them on a recurring schedule. Build alignments from HCP specialties, geography, multiple addresses and other segmentation criteria using a CRM Analytics dataset that supports addresses and specialties.
- **Requires:** Sales Performance Management (SPM) and Territory Planning (TP) packages.
- **How:** Clone and activate the Data Processing Engine template that generates the CRM Analytics dataset, select the dataset and rule fields in Sales Planning Setup, create the plan and segments in Segment Builder, then customize/activate/run the **Refresh and Execute Territory Planning Rules** flow (triggers the batch job). For specialty-based rules, turn on the **Healthcare Provider Specialty** trigger handler in the Admin Console.

### Find Accounts Faster with Relevance-Based Search on the iPad
Account Search now ranks the strongest matches first (by relevance, not alphabetically). Dynamic filters switch between address-only matches, account-only matches and a consolidated view. Applies to offline, standard Account Search on iPad. (Updated week of Oct 5, 2026.)

## Enablement Coaching (available starting September 2026)

- **Build Standardized Evaluations with the Discovery Framework** — assessment templates with question banks, scoring criteria and competency weights (Discovery Framework + OmniStudio). Admins need the Life Sciences Commercial Admin permission set and Assessment Platform User permission.
- **View Historical Evaluation Scores** — previous scores from the most recent completed evaluation with the same template auto-populate in the Evaluation tab; toggle **Show Previous Evaluation Score**.
- **Link Field Visits with Evaluations** — while a session is in Planned or Self-Evaluation status, coaches select field visits from the related list; linked visits show in the session header and are visible to coachees after sharing.
- **Complete Coaching Evaluations Anywhere with Offline Support** — coaches access Enablement Coaching sessions in the iPad app and sync later.
- **Schedule and Track Coaching Sessions from Calendar** — in the Admin Console, configure calendar event metadata to map Enablement Coaching sessions to calendar views; Salesforce auto-creates the calendar events. Employees see sessions only after the coach shares them.

## Engagement Planning

- **Set Up Key Account Management Faster with an AI Coding Agent** (added week of Sept 21) — skills for Claude Code and Agentforce Vibes: `life-sciences-kam-coordinate`, `life-sciences-prerequisites-validate`, `life-sciences-territory-configure` (Salesforce Skills Library on GitHub). Handles permission set assignments and stakeholder picklist creation; imports standardized goals/tasks into account plans and territory business plans; asks for explicit approval before any org-wide action; sessions can be paused/resumed. Users need Health Cloud Starter, Life Sciences Commercial Admin and Life Sciences Key Account Management permission sets.
- **Clone Activity Plans Instead of Building Them from Scratch** — App Launcher > Life Sciences Commercial > Activity Plans tab > **Clone Plan**. Copies the goal/goal-measure hierarchy for the chosen time period and territories, syncs to current territory alignment, lets you fine-tune account-specific goals before activation. (Invocable action: `cloneActvtyPlanTerritories`.)
- **Review and Adjust Activity Plans in the Mobile App** — reps review assigned goals, adjust interaction targets, add/remove accounts and submit for approval on iPad (internet connection required). Setup: add a tab for Activity Plan Reviews.
- **Configure Time Off Territory Categories** (added week of Oct 5) — Admin Console > Time Off Territory > Time Off Territory Rules; custom downtime categories (training, company days, regulatory duties) and rules controlling whether they can overlap other activities. New field `TerritoryUserDowntime.DowntimeCategory`.

## Engagement Execution

- **Prepare Life Sciences Cloud for a Field Rep's First Visit** (added week of Sept 21) — AI-coding-agent headless workflow: configures territories and users, deploys metadata, creates minimal test data, regenerates the mobile metadata cache. Skills: `life-sciences-fieldsalesrep-coordinate`, `life-sciences-prerequisites-validate`, `life-sciences-territory-configure`. Requires a provisioned org with the managed package and installation prerequisites; users need Health Cloud Starter and Life Sciences Commercial Admin. After sync, manually confirm on an enrolled iPad.
- **Voice-Based Visit Logging — Generally Available (Visit Agent)** — on-device processing populates product details, messages, reactions, presentations, place and time, offline. **English only.** Setup: Setup > *Life Sciences for Customer Engagement Setup* > **Set Up Custom Agents** > turn on Visit Agent; assign the **Access Custom Agents** permission set (pilot users must be reassigned this new permission set). The app downloads the Whisper speech-to-text model (~632 MB) at login; reps must turn on Apple Intelligence on the iPad. Needs Agentforce for Life Sciences Cloud add-on. HCP Reactions (positive/negative/neutral) are AI-generated drafts the rep must review — not authoritative records.
- **Host Twilio Remote Sessions from the Desktop Site** (week of Oct 5) — attendee management, mute, audio/video controls, approved presentations with drawing tools/laser pointer, signature requests (consent, product, sample), visit/remote-player toggle, approved-template follow-up email, per-attendee content engagement. HCPs join by secure link without installing an app.
- **Capture Attendee Details Faster in Group Visits** — Attendee Visit action in the parent visit's Attendees section; attendee-name button saves and opens the next attendee visit.
- **Focus Attendee Data Entry on Samples and Marketing Items** (week of Oct 5) — Admin Console > Visit Administration > Visit Settings > **Capture only samples and marketing items per attendee**.
- **Request Remote Consent Signatures from Participants on Mobile Phones** (week of Oct 5) — HCPs on phones review consent topics, opt in/out and sign electronically (previously laptop/desktop only).
- **Capture Consent in More Ways** — verbal consent or a document reference to a paper form; admins can require at least one proof. Admin Console > Consent Administration (mobile and web proof settings). New fields `CommSubConsentCmplSnpsht.IsVerbalConsent` and `ConsentDocumentReference`.
- **Access Custom LSC Apps Offline** (week of Oct 5) — custom app bundles download on every sync; no prior connected session required.
- **Resolve GraphQL Queries Offline in Custom LSC Apps** (week of Oct 5, iPad) — offline support on; use the `graphql` wire adapter from `lightning/uiGraphQLApi`.
- **Combine Multiple Components in a Single LSC App** (week of Oct 5, iPad) — one parent LWC (with `lscMobileInline_` prefix and a `targets` entry) can nest multiple child LWCs on the Home Page or a record-page tab.

## Event Management

- **Event Type Mappings** — Admin Console > Event Management tile; classify a Managed Event by its record type automatically.
- **Participant Type Mappings** — Admin Console > Event Management tile; populates Participant Type, Participant Role and Participant Type Role Mapping on Managed Event Participant records for any record type.
- **Projected costs in Monetary Caps** — allocate estimated expenses to participants; checks run when an account is added to an event. Create **Provider Activity Measure Type** records (Developer Console) for actual, estimated and committed buckets.
- **Account Utilization Limits** — limit events per account; real-time warnings/blocks; discrepancies logged; new **Recalculate Account Utilization Count** batch job. Configured with Provider Activity Measure Type records.
- **Account Merge** now covers estimated and committed expenses (previously actual only).
- **New trigger handlers** (activate via Admin Console > Trigger Handler Administration): `EstExpensePtcpAllocMonetaryCapsHandler`, `EstimatedExpenseMonetaryCapsHandler`, `EstimatedExpPtcpAllocImmutabilityHandler`, `ExpenseParticipantImmutabilityHandler`, `MngEventParticipantImmutabilityHandler`, `MngEventAcctUtilLmtsHandler`, `MngEventPartAcctUtilLmtsHandler`. (Names added week of Sept 7.)
- New field `EstimatedExpense.IsAllocationUneven`.

## Intelligent Content

- **In-content interaction tracking** — call `PresentationPlayer.trackInteraction({...})` from HTML slides (button taps, link clicks, video plays); custom fields on the presentation click stream entry object are supported. New field `PresentationClickStrmEntry.MetricEntryType`.
- **Data retention** — Intelligent Content Admin Console > **Data Retention** tab; retention period for click stream records, manual or scheduled cleanup.
- **Email fragment tracking** — Admin Console > Email > Email Settings > Tracking Settings > **Track email fragment usage**. Creates a `LifeScienceEmailFragment` record per included fragment (snapshot). Mobile: object metadata cache configuration for Life Science Email Fragment with SOQL filter `CreatedDate = TOMORROW`; on Life Science Email Template Fragment set Attachment Download Method = **Cache**.
- **Content library / player** — Inquiry and Survey quick actions in the presentation player menu and per attendee on desktop (configure the actions with the *Intelligent Content* location); four thumbnails per row on mobile; drag handles for slide reordering.
- **Automatic email selection on mobile** — iPad picks the best opted-in email; recipients ordered by Contact Point Email preference rank (ranked ascending, then unranked, ties alphabetical), consistent with desktop; reps can choose other addresses based on consent settings.
- **Data 360** — Life Sciences Data Kit adds an Email Message Fragment DMO/data stream, expanded Email Message mappings (send status, scheduling, consent, template) and updated Presentation Click Stream Entry mappings. Needs Life Sciences Commercial Admin, Data Cloud Architect and Data Cloud User permission sets.
- **Content Ingestion API** — source-agnostic REST API to ingest remediated content from external DAM systems (prepared ZIP CLM packages, PDFs, preconfigured email templates) with automated territory distribution and activation. Requires a MuleSoft Anypoint Platform subscription; integration users need custom permission sets based on the Life Sciences Commercial and Salesforce API Integration licenses plus access to the mapped objects/fields.

## Order Management

> Order Management for Agentforce Life Sciences includes only Orders and Pricing functionality. Using other Order Management-aligned services (e.g., Billing) can increase subscription costs — contact your Salesforce account executive. Also requires the Revenue Lifecycle Management add-on license.

- **Single setup location** — Setup > **Salesforce Go** > Agentforce Life Sciences > turn on **LSC Order Management** and **Store Check**.
- **Store Check** — define activities and KPIs, compare captured values to store targets, geolocation tracking at visit start, surveys. Setup > Salesforce Go > turn on Store Check. Also needs the Agentforce for Life Sciences Cloud add-on license.
- **Quoted orders** — create/submit from web or iPad (offline), pre-populate from last order or assortments, capture digital signatures, approval workflows that lock submitted orders (managers can unlock/approve).
- **Pricing procedures** — App Launcher > **Pricing Procedure**; product base prices, discounts, price waterfall, consistent offline pricing on mobile.

## Other

- **Add Tableau Next Components to Lightning Pages** — Metric, Visualization and Dashboard components in Lightning App Builder (record and home pages), interactive on iPad. Needs the Tableau Next add-on license.
- **Digital Verification Setup Is Changed** — internal users no longer need a connected/external client app; portal users configure an external client app (OAuth settings → auth provider with Consumer Key/Secret → named credential; publish the community site with headless login; add the domain to Remote Site Settings). Requires the Life Sciences Advanced Therapy Management add-on license.

## New and Changed Objects

| Area | Object | Change |
|------|--------|--------|
| Engagement Execution | `CommSubConsentCmplSnpsht` | New fields `IsVerbalConsent`, `ConsentDocumentReference` |
| Engagement Planning | `TerritoryUserDowntime` | New field `DowntimeCategory` |
| Intelligent Content | `LifeScienceEmailFragment` | New object (email fragment tracking) |
| Intelligent Content | `PresentationClickStrmEntry` | New field `MetricEntryType` |
| Order Management | `AsmtIndDefExt` | New object (translations of assessment indicator definitions) |
| Order Management | `DistributionChannel` | New object (direct orders and transfer orders) |
| Order Management | `QuoteDocumentCreationEvent` | New object (event generated when a quote document is created) |
| Order Management | `AssessmentIndicatorDefinition` | New field `DefaultComparisonRule` |
| Order Management | `Assortment` | New field `UsageType` |
| Order Management | `AssortmentProduct` | New field `IsRequired` |
| Order Management | `RetailStoreKpi` | New field `TargetPrice` |
| Order Management | `RetailVisitKpi` | New fields `TargetPrice`, `ActualPrice` |
| Order Management | `StoreAssortment` | New field `StoreCheckType` |
| Order Management | `Quote` | New fields `Visit`, `RequestedFirstDeliveryDate`, `CaptureDate`, `PaymentTerm`, `BillingContactPointAddress`, `TotalFreeQuantity`, `TotalQuantity`, `AdditionalInformation`, `AggregationStrategy`; `ShippingContactPointAddress` (the source PDF lists this one under "Provider Engagement Compliance Cycle" — likely a typo in the release notes; verify in your org) |
| Order Management | `QuoteLineItem` | New fields `AdditionalFreeItemQty`, `TotalQuantity` |
| Order Management | `QuoteLineGroup` | New field `ShippingContactPointAddress` |
| Event Management | `EstimatedExpense` | New field `IsAllocationUneven` |

## New and Changed Invocable Actions

| Action | Purpose |
|--------|---------|
| `cloneActvtyPlanTerritories` | Clone Activity Plan records and associate them with specified territories |
| `evaluateAccess` | Evaluate whether the running user has a specified access check (user permission) |
| `getQualifiedProducts` | Retrieve PricebookEntry IDs for products a user is authorized to use for an account and territories |
| `setLsQuoteDocumentDefaults` | Set default attributes on document recipients for a quote document based on its attached Lightning flexipage layout |
| `shareQuoteBasedOnAccount` | Sync Quote sharing with Account sharing (queries AccountShare, upserts QuoteShare) |

## New Connect REST API Resources

- `POST /connect/core-pricing/waterfalls/retrieve` — retrieve pricing waterfall data for multiple line items in one request. Request body: `WaterfallDownloadInputRepresentation`; response body: `WaterfallDownloadOutputRepresentation`.

## Changes to Published Notes (by month)

- **October 2026:** Order Management disclaimer on scope/cost (Oct 12); Relevance-Based Account Search note added (Oct 5); TOT categories, Twilio desktop, remote consent on phones, offline custom LSC apps, offline GraphQL, nested components, in-content interaction tracking, email fragment tracking, content library/player, automatic email selection, Data 360 email fragment/presentation streams added (Oct 5); Event-Type and Participant-Type Mapping notes added.
- **September 2026:** KAM AI coding agent and first-visit AI agent added (Sept 21); TOT categories note removed then re-added in October; Event Management trigger handler names added (Sept 7).
- **August 2026:** `IsVerbalConsent` / `ConsentDocumentReference` fields added to objects list.
