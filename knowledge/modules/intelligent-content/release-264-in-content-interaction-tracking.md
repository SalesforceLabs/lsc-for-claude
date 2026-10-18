# In-Content Interaction Tracking - Winter '27 (264)

> Source: Winter '27 release enablement deck, now GA and confirmed against the official release notes (field availability caveats in the sections below). Platforms per deck: iPad and Web.

## What's New

Content developers can record element-level engagement inside HTML presentations (button taps, link clicks, video plays, other interactive elements), not just page views. Events are captured as an **in-content metric type** on `PresentationClickStrmEntry` (the deck also writes the object as `PresentationClickStreamEntry` in the setup slide), alongside existing presentation clickstream data.

Use case: the rep hands the iPad to the HCP to explore interactive content; the HCP's clicks and video plays are captured for analysis. Purpose: identify which messages, visual elements and interactions resonate, to optimize content and prioritize investment.

## Setup & Configuration (Content Developer)

1. **Identify the interaction to track** - e.g. button taps, link clicks, video plays.
2. **Create custom fields** (optional, customer-defined) on the `PresentationClickStreamEntry` object to hold interaction-specific data.
3. **Call `PresentationPlayer.trackInteraction()`** from the HTML slide when the interaction occurs, optionally passing a JSON payload:

```js
PresentationPlayer.trackInteraction({
  ContentEventType__c: "video_play",
  ContentEventIdentifier__c: "patient_case_video",
  ContentEventDescription__c: "Patient case video started",
});
```

The payload keys in the deck example are custom fields (`ContentEventType__c`, `ContentEventIdentifier__c`, `ContentEventDescription__c`); these are the customer's own fields and must exist on the object.

4. **Report on the data** - the interaction is stored with the presentation clickstream and the associated Account and Visit context.

No additional configuration in the presentation is required beyond adding the JavaScript calls to the HTML content.

## Verified Against Official Docs

- Presentation Player JavaScript functions are documented in Help ("Presentation Player Functions"): alert, createVisit, fetchWithParams, goNextPage, goToSlide, launchEmails, saveState, startTrackingPage, stopTrackingPage, upsert, etc. Touch-only functions (`defineNoSwipeRegion`, `destroyNoSwipeRegion`) are mobile-only; the rest work on mobile and desktop. **`trackInteraction` is not listed in the 264 Help index and no "trackInteraction Function" or "Track In-Content Interactions" article was found**, so its signature and payload rules rest on the deck alone.
- `PresentationClickStrmEntry` (Life Sciences Developer Guide, API 65.0+) lists `ContentEventDescription`, `ContentEventIdentifier`, `ContentEventType` and `MetricEntryType` as **"Reserved for future use"** (no further field description). The deck's `__c` names therefore appear to be custom fields; do not assume the standard fields are populated.
- Existing documented fields on the object: `MetricType` (calculated, e.g. Tracking or Content Rating), `ContentPageIdentifier`, `ContentReaction` (1 / -1 / 0), `UsageStartDateTime`, `UsageEndDateTime`, `ActualUsageDuration` (seconds), `PresentationId` (required, master-detail), `PresentationPageId`, `VisitId`, `ProviderVisitId`, `AccountId`.
- Data Cloud: the Life Sciences Data Kit DLO-to-DMO mapping for `PresentationClickStrmEntry` maps `ContentEventDescription`, `ContentEventIdentifier`, `ContentEventType` and `MetricEntryType` to same-named fields on the Presentation Click Stream Entry DMO.
- Presentation tracking can be paused by the rep (pause icon) and some presentations start paused; ending via Visit button saves metrics, Cancel discards them.

## Related

Retention/cleanup of these records: [release-264-clickstream-data-retention](./release-264-clickstream-data-retention.md).

## Gaps in the Deck

- The deck shows no reporting examples or standard field names for the in-content metric type.
- Existing rule still applies (see support-engineering notes): clickstream is only saved when the presentation is associated with a saved Visit; this deck does not state whether interactions follow the same rule.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_presentation_player_functions.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_intelligent_content_presentation_player.htm&release=264.0.0&type=5
- https://developer.salesforce.com/docs/atlas.en-us.life_sciences_dev_guide.meta/life_sciences_dev_guide/sforce_api_objects_presentationclickstrmentry.htm
- https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-presentationclickstrmentry_dmo_mappings.html
