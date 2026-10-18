# Dependent Picklists on Visit Engagement - Winter '27 (264)

Platform: iPad and Web. Note: the release note for this feature is dated Summer '26 (262, week of June 22); the Winter '27 Help article is "Configure Dependent Picklists for Visits".

## What's New

Standard field dependencies now work on the Visit Engagement page: when a field user selects a value in the controlling field, dependent picklist fields filter to show only the mapped values. Example: a rep picks a product discussion topic and the related picklist narrows to values valid for that topic.

## Supported Areas / Objects

- Visit header (Provider Visit object)
- Provider Visit Product Discussion
- Custom objects related to the visit (configured for Visit Engagement)

Controlling field: checkbox or single-select picklist. Dependent field: single-select or multi-select picklist. Filtering works alongside record-type picklist restrictions (dependencies filter within the record-type-restricted set).

## Admin Setup

Permission: **Customize Application**. Create the controlling and dependent picklist fields first.

1. Object Manager > the object > **Fields & Relationships** > **Field Dependencies**.
2. Click **New**; select the controlling field and the dependent field; **Continue**.
3. In the dependency matrix, select which dependent values (rows) are available for each controlling value (columns).
4. Save.
5. **Generate the metadata cache** for the objects you added dependencies to so the change syncs to the mobile app (Admin Console > Mobile).

## Behavior

- With no controlling value selected, the dependent field cannot be set.
- Changing the controlling value resets the dependent field only if the previously selected value is no longer valid.

## Gotchas

- Forgetting the metadata cache refresh is the likely cause of dependencies not applying on Visit Engagement (mobile).

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_configure_dependent_picklists.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_execution_dependent_picklists.htm&release=262.0.0&type=5
