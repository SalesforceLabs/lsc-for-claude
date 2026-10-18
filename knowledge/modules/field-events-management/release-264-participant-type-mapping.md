# Participant Type Mapping - Winter '27 (264)

Applies to: iPad and Web. Status: GA.

## What's New

Admins configure participant types, roles, and valid combinations for each Managed Event Type. Default mappings streamline participant creation, and standardized classifications improve data quality, reporting, and compliance.

- Admins define organization-specific participant roles and map them to standardized types.
- Admins define valid Type + Role combinations by Managed Event Type and identify the default role for each participant type.
- When an HCP is added to an event (e.g. a Speaker Event), the configured participant type and default role are applied. The system validates the combination for that Managed Event Type before saving.

## Admin Setup & Configuration

Prerequisites:
- Create active **Event Management Participant Type Role Mapping** records.
- Optionally create active Managed Event Participant record types.

Steps:
1. Admin Console > Event Management > **Participant Type Mappings**: click New and select a participant type.
2. Set a default role (not required for colleagues).
3. Select a record type and save.
4. In each custom participant related list, configure one record type developer name for Attendees, Experts, Write-Ins, and Non-Profiled Participants.

Mapped values populate the participant record type, participant type, role, and type-role mapping fields.

## End-User Flow (Mobile)

1. Open a Managed Event and go to the participants section.
2. Choose Attendee, Expert, Colleague, Write-In, or Non-Profiled Participant.
3. Tap the available action and select or enter the participant.
4. The system auto-populates record type, participant type, default role, and type-role mapping. The user does not select these manually.

## Participant Model and Related Setup (verified in Help)

Event Management participants use three layers: a standard type (Colleague, Attendee, Expert, Write-In Attendee, Non-Profiled Attendee), a custom label (**Event Management Participant Type** record), and a role (**Event Management Participant Role** record). An **Event Management Participant Type Role Mapping** joins a type, a role, and a Managed Event Type into a valid combination.

Setup order (requires the **Life Sciences Commercial Admin** permission set; App Launcher objects):
1. **Event Management Participant Types** > New: name, standard type (e.g. Expert), and Type picklist value (e.g. Key Opinion Leader). Create the Type picklist values first.
2. **Event Management Participant Roles** > New: name, standard role (organizer, coorganizer, coordinator, contributor, approver, attendee, expert), and Role picklist value (e.g. Event Organizer).
3. **Event Management Participant Type Role Mappings** > New: name, Managed Event Type, participant type, participant role, **Active**, save.
4. Admin Console > Event Management > **Field Events Org Level Settings** > participant role settings: set Attendee, Expert, Write-In, and Non-Profiled **Participant Default Role** (picklist values from the Role field). Help states event workflows do not work as expected without this.

Behavior and limits:
- `EventMgmtPtcpTypeRoleMapHandler` (beforeInsert, beforeUpdate) enforces a unique combination of participant type, participant role, and Managed Event Type per mapping record.
- Colleagues: the current user must be added as a colleague before other participants.
- Write-ins are reconciled to existing accounts or converted to non-profiled attendees (via Party Profile).

## Verification Notes

- The dedicated Help article "Participant Type Mappings" (`lsc_event_management_participant_type_mappings.htm`) was **not found** in the index. The Admin Console > Event Management > **Participant Type Mappings** UI steps and the "record type developer name per related list" step above are from the release note and unverified.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_participant_setup.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_configure_org_wide_settings.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_how_event_management_works.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_trigger_handlers_objects.htm&release=264.0.0&type=5
