# Managed Event Type Mapping - Winter '27 (264)

Applies to: iPad and Web. Status: GA.

## What's New

Admins map Managed Event record types to Managed Event Types (declarative 1:1). When a user selects a record type while creating an event, the mapped Managed Event Type is populated automatically on web and mobile. This reduces clicks and prevents inconsistent classification. Duplicate mappings are prevented.

Example: selecting the Speaker Event record type populates the mapped Managed Event Type automatically.

## Admin Setup & Configuration

Prerequisites:
- Create Managed Event record types.
- Create Managed Event Type records.

Steps:
1. Setup > Life Sciences for Customer Engagement > Configure Event Management for Customer Engagement: turn on **Autopopulate Managed Event Type in Managed Event Records**.
2. Admin Console > Event Management > **Event Type Mappings**: click New, select a Managed Event record type, select a Managed Event Type record, select Active, and save.
3. Remove the Managed Event Type field from the page layout. Mapped values populate automatically in the backend.

## End-User Flow

Mobile: from the home page open the Managed Event tab, tap New, select a record type, and enter the event name and other details to create the draft. The Managed Event Type is populated in the backend from the admin mapping. The same behavior applies on web.

## Limitations / Gotchas

- Each record type can map to only one event type.

## Verification Notes

- The dedicated Help article "Event Type Mappings" (`ind.lsc_event_management_event_type_mappings.htm`) was **not found** in the salesforce-docs index for release 264. The setup steps above come from the release note and are not independently verified (including the "Autopopulate Managed Event Type in Managed Event Records" toggle and the Event Type Mappings Admin Console path).
- Verified related setup (Event Management Participant Setup): Managed Event Types are created from App Launcher > **Managed Event Types** > New (name plus a template such as Speaker Meeting). Requires the **Life Sciences Commercial Admin** permission set.
- Verified prerequisites (Get Your Org Ready): create Managed Event record types (e.g. rep presentations, speaker meetings, HCP sponsorships) and Managed Event Type picklist values (Category, e.g. Marketing Speaker Meeting, Presentation; Subcategory, e.g. Speaker Meeting, Lunch and Learn, Advisory Boards). Users need create/edit/delete on Managed Event and Managed Event Type.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_participant_setup.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_get_org_ready.htm&release=264.0.0&type=5
