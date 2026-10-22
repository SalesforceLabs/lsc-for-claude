// Sent to every MCP client when it connects (the `instructions` field of the
// initialize result). Claude Code plugin users don't get this repo's CLAUDE.md,
// and other clients (Codex, Cursor, …) get nothing else, so the rules a model
// needs to use these tools correctly live here.
export const SERVER_INSTRUCTIONS = `Tools for Salesforce Life Sciences Cloud for Customer Engagement (LSC4CE): an LSC knowledge base plus tools that read and change a Salesforce org through the Salesforce CLI (sf).

Choosing an org:
- If only one org is authenticated, use it without asking.
- If several are and none is selected, ask the user once, then call set_target_org. Never ask again in the session.
- Don't call check_lsc_setup or list_sf_orgs before every operation; only when the user asks about setup or a tool reports an authentication error.

Use the dedicated tools, not run_soql / get_record / describe_sobject / create_record, for:
- Admin Console settings: list_admin_settings, update_admin_setting, create_admin_setting. They are Tooling API records (LifeSciConfigRecord, LifeSciConfigFieldValue, LifeSciConfigCategory) that standard SOQL can't see.
- DB Schema (mobile sync) records: list_db_schema, get_db_schema, create_db_schema, update_db_schema, toggle_db_schema. Field names are SObject, Type, WhereSoql, DeltaDateField, OneWaySync, AttachmentsSupport, MandatoryFields.
- Quick and custom actions: list_lsc_actions, create_quick_action, create_custom_action, update_lsc_action, delete_lsc_action.
- Mobile metadata cache: check_mobile_cache_status, generate_mobile_metadata_cache.
- Mobile navigation tabs: list_navigation_tabs, add_navigation_tab.
- Enabling or disabling a feature such as DCR: list_trigger_handlers, then toggle_trigger_handler.
These objects do not exist, so never query them: LifeSciCustomAction__mdt, CustomAction__c, QuickAction__mdt, LifeSciConfigType__c, MobileMetadataCache__c, MobileApplicationDetail.

LSC objects are standard objects without __c. Use Visit, ProviderVisit, HealthcareProvider, ContactPointAddress, BusinessLicense, ProviderAffiliation, ProviderAcctTerritoryInfo, ActivityPlan, ProviderActivityGoal, TimePeriod, Product2, LifeSciMarketableProduct, ProductItem, ProductBatchItem, ProviderSampleLimit, Territory2, ObjectTerritory2Association. Names like Visit__c, HealthcareProvider__c or SampleLimit__c are wrong. When unsure, call describe_sobject or search_lsc_knowledge.

Presentations (Intelligent Content):
- "associate / link / tag with X": X is a Topic. Call assign_presentation_content with topicNames; don't search Territory2.
- "give access to [person]": find their territory in UserTerritory2Association, then call distribute_presentation.
- "distribute to [territory]": call distribute_presentation.

OmniStudio (FlexCards, OmniScripts, DataRaptors) runs only on the web app. Never suggest it for the LSC Mobile (iPad) app.

After changing mobile configuration (DB Schema, actions, tabs, mobile settings), remind the user to regenerate the mobile metadata cache so iPads get it.

Ask before writing to a production org. For implementation guidance, search the knowledge base (search_lsc_knowledge, get_lsc_module_docs, explain_lsc_concept) and cite the source rather than answering from memory.`;
