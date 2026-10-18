# Simplified Attendee Data Capture in Group Visits - Winter '27 (264)

Platform: iPad and Web (Lightning Experience; Enterprise/Unlimited with Life Sciences Cloud, the Customer Engagement add-on and managed package).

## What's New

- **Efficient navigation (default):** the Attendee Visit action now appears directly in the Attendees section of the parent visit. Attendee name buttons at the top of the Attendee Visit Engagement page save the current attendee visit and open the next one in one step (previously reps had to return to the parent visit). No additional setup beyond attendees being enabled.
- **Focused attendee data entry (optional):** the Attendee Visit Engagement page can show only the Samples, Direct to Practitioner, and Marketing Items sidebars. Detailed products and discussions are captured once on the parent visit and still carry over to all attendees on submit, as before.

## Admin Setup

### Enable attendees and the sidebar (Help: Add Attendees / Configure the Sidebar Menu)

Permissions: **Customize Application** (page layouts, Lightning pages, Rename Tabs and Labels); **Life Sciences Commercial Admin** (visit settings).

1. Object Manager > Visit > **Page Layouts** > edit the layout for field users.
2. Add the **Child Visits** related list (labeled Attendees; this enables the Attendees sidebar menu on Visit Engagement). Keep the Attendees related list for visibility/reference only.
3. Setup > **Lightning App Builder** > edit the Visit record page > drag **Related List - Life Sciences** onto the page and configure it to show attendees. Do NOT configure a New button on the Attendees related list component (it can create a generic record not tied to the visit).
4. Sidebar order follows related list order: Content = Presentation Forums; Product Details = Provider Visit Product Detailings; Samples = Product Disbursements; Direct to Practitioner = Provider Visit Requested Samples; Marketing Items = Provider Visit Marketing Items; Attendees = Child Visits; Custom Objects = any custom object with a lookup to Visit whose lookup field API name must end in `Visit__c` (variants such as `Visit_ID__c` are unsupported and block saves). Only the listed standard objects are supported. Recommendations appear automatically at the top.
5. Optional: Setup > **Rename Tabs and Labels** to rename related lists (e.g. Product Disbursements to Samples).

### Focused attendee data entry (existing content, not found in Help)

1. Admin Console > Visit Administration > Visit Settings.
2. Enable **Capture only samples and marketing items per attendee**.
3. Run the metadata cache so the setting applies on the Visit Engagement page (mobile).

Note: this setting name does not appear in the Winter '27 "Configure Visit Settings" Help article; verify the label in an org.

## End-User Flow

- Add attendees from the Attendees sidebar: up to 5 suggestions sharing the visit address and up to 5 accounts affiliated with the primary account; **Search All Attendees** finds and multi-selects others. Each added attendee creates a child visit linked to the parent. On desktop, add attendees from Visit Engagement via Edit Visit.
- Click **Attendee Visit** in the Attendees section, then click the next attendee's name button to save and move on. With the optional setting on, only Samples, Direct to Practitioner and Marketing Items sidebars appear.

## Considerations

- Child visit account cannot be changed; remove and re-add the attendee.
- Removing an attendee deletes its visit and provider visit records. After the parent is submitted the Attendees section is read-only; child visits with signatures, samples or other activity records cannot be deleted even on unlocked visits.
- Deleting a parent visit silently deletes all child visits; deletion is blocked if the parent is Completed or any child has a signature.
- Attendee section shows static fields (record type icon, name, subtitle, invitation email status for Remote Engagement, Attendee Visit button, actions menu such as Last Visit/Send Email).
- Visit Agent (voice logging) does not support group visits.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_add_attendees.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_configure_sidebar.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_configure_visit_settings.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_execution_enhanced_group_visits.htm&release=264.0.0&type=5
