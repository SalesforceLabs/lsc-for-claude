# Alignment Rules Processing Engine (SPM Integration) - Winter '27 (264)

Official Help title: "Manage Complex Territory Alignments with Advanced Rules". Configure advanced rules in Sales Planning and run them on a recurring schedule to keep account-to-territory alignments current, without custom implementations or external alignment tools. Rules can use healthcare provider specialties, geography, multiple addresses, and other segmentation criteria from a CRM Analytics dataset.

**Availability:** Lightning Experience, Enterprise and Unlimited editions, with the Life Sciences Cloud license, the Life Sciences Cloud for Customer Engagement add-on license, and the Customer Engagement managed package installed. Also requires the Sales Performance Management (SPM) and Territory Planning (TP) packages. Help lists these add-on licenses for Territory Planning: Life Sciences Cloud for Customer Engagement, AnalyticsQueryServiceForSalesPlanning, SalesPlanning, SonicEmbeddedStoreBase.

## What's New

- Richer data, better segments: Account, Healthcare Provider, Address, Specialty and related data are flattened into one CRM Analytics (CRMA) dataset.
- Rules defined where planners work: segmentation and territory carving rules are configured in Sales Planning / Territory Planning.
- Automated execution: a scheduled flow refreshes the dataset and runs a batch job that creates the territory associations.

Use case: a sales ops team defines ZIP + specialty, brick + specialty, and user assignment rules; LSC runs the calculation on a schedule and updates account-to-territory assignments.

## Integration Architecture

| Layer | Component | Role |
|-------|-----------|------|
| Planning | Sales Performance Management (SPM) | Planning suite; Sales Planning decides which accounts are in the plan, slices accounts into segments, holds the master Sales Plan for Territory Planning. |
| Geography | Salesforce Maps | Boundaries (ZIP, postal, brick, country); territories as map shapes. |
| Execution | Territory Planning | Carve boundaries, attach business rules, assign users. |
| Consumption | Life Sciences Cloud (LSC) | Consumes the resulting associations (OT2A / PATI), driving call lists, activity plans, and mobile scope. |

OT2A = ObjectTerritory2Association; PATI = ProviderAcctTerritoryInfo (see [Territory Alignment](../territory-alignment/_index.md)).

## Admin Setup (Help sequence: "Set Up Territory Planning for Agentforce Life Sciences")

1. **Create and activate a Territory Model** (Enterprise Territory Management) with the hierarchy the alignment will import. Do not rename imported territories/areas afterward.
2. **Create the CRMA dataset** by cloning the DPE template:
   1. Setup > **Data Processing Engine** > select **Create CRMA Dataset for Agentforce Life Sciences Territory Planning**.
   2. **Save As** a new definition; set name, API name, description.
   3. Review/customize the DPE nodes, then **Activate** and **Run**.
   4. If a field "isn't visible or accessible" error appears, grant the integration user field-level access and re-run.
   5. Verify: Setup > **Monitor Workflow Services** shows status Completed; App Launcher > **Data Manager** > Data Assets > open dataset > Explore. Confirm the dataset name matches the final writeback node, account IDs are populated, and each account has exactly one row.
3. **Configure Sales Planning data and segments:**
   1. App Launcher > **Sales Planning** > Sales Planning Settings > **Data Sources** > Add. Pick the DPE dataset; Record ID = **AccountId**, Record Name = **AccountName**; select every field planners will use in segments or rules.
   2. App Launcher > **Sales Plans** > **Create Plan** (name, description, year, start month).
   3. Open the plan > **Open Segment Builder** > create segments/child segments (filter rules on dataset fields; direct operators such as Equals and Contains).
4. **Configure alignments and rules** (Territory Planning Alignment Builder):
   1. Start territory carving or add alignments from a segment. Use a **live** dataset, not a copied one.
   2. Import the territory model.
   3. Add territory boundary for the alignment.
   4. Assign areas to the containers created by the boundary geo fields.
   5. Add area-specific assignment rules to refine accounts per container.
   6. Add an owner and users (with roles) to each area.
5. **Enable specialty-based rules:** turn on the **Healthcare Provider Specialty** trigger handler in the Admin Console.
6. **Schedule execution:**
   1. Setup > **Process Automation Settings** > set **Default Workflow User** (Help example: `Admin User`).
   2. Setup > **Flows** > open the managed-installed scheduled autolaunched flow template **Refresh and Execute Territory Planning Rules** > **Save As New Flow**.
   3. If you changed the DPE API name, replace the first action (the "Create LSC Commercial Territory Planning CRMA Dataset" action) with an action for your DPE; choose "Manually assign variables (advanced)" and map the accepted and Batch Job Id outputs.
   4. Verify the batch job in Setup > **Batch Management**: **Process Accounts for Territory Planning** must be active, use the Account object, type **AccountTerritoryPlanning**. The standard definition has no filters and processes all accounts in segments. For a filtered set, create an active batch definition (Account object, AccountTerritoryPlanning type) and point the flow at it.
   5. Optional: in the **Execute Territory Planning Rules** action set Sales Plan Id (`sfsp__SalesPlan__c`), Territory Model Id (`Territory2Model`), TPAlignmentIds (comma-separated), SegmentIds (`sfsp__SalesNode__c`), and **Should Replace Existing Territory Associations**: True deletes existing manual object-to-territory and user-to-territory associations and rebuilds from Territory Planning; False preserves manual associations and inserts/updates generated ones.
   6. Edit the Start element (date, time, frequency), save, **Activate**. A once-only schedule with a past start does not run.
7. After the batch completes, run or schedule the **Align Account to Territory** job to reconcile Provider Account Territory Information (PATI) records.

## How Assignments Are Calculated

- Dataset: one row per account ID; multi-value data (multiple addresses/specialties) can be combined into one delimited field. Use **Contains** to match one value, **Equals** to match the whole value.
- The batch locates the ETM territory by matching the area name; a name mismatch prevents the association from being created.
- If an area has a geographic container, accounts are first matched to the container (e.g. country + 3-digit postal code key), and only matches proceed to rules. A container with no rules qualifies every matching account; an area without a container relies on its rules. Parent-area rules apply to children when **Apply to Child Area** is selected.
- Output: ObjectTerritory2Association per qualifying account/area (shown as manual assigned accounts in ETM); UserTerritory2Association for area owners (no role) and assigned users (role chosen in Territory Planning).

## Scheduled Flow Logic (from earlier deck screenshot)

Create CRMA dataset, wait for the dataset job to complete, execute rules if Completed, send error email on failure. Help confirms the flow runs the DPE and waits for the dataset refresh before starting the account batch; the error-email branch is not described in Help.

## End-User Flow

Field lists, account access, and mobile sync scope reflect updated associations after each run.

## Limitations / Gotchas

- Deck described this as a pilot; the 264 Help release note does not label it pilot or beta.
- Requires SPM, TP, Maps/geography, CRMA/DPE, and the licenses above.
- Territory/area names must match exactly (SPM area vs ETM territory).
- Sales Planning does not support live Salesforce connections for datasets; set Asynchronous Data Set Creation in Territory Planning settings to carve from segments; lat/long must be numeric (precision 15, scale 12 recommended) for carving.
- Publishing to specific Salesforce fields from Territory Planning requires Sales Planning Ops Analyst, Query for Datapipelines User for Sales Planning, and SF Maps Territory Planning for Sales Planning permission sets.

## Not verified

Specific field names in the DPE dataset, ZIP+specialty / brick+specialty rule recipes, and the Publish button location were not confirmed in fetched Help.

## Sources

- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_account_territory_alignment.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_territory_planning_how_assignments_works.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_territory_planning_setup.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_territory_planning_create_crm_dataset.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_territory_planning_configure_sales_planning_data_and_segments.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_configure_territory_planning_alignments_and_rules.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_territory_planning_configure_and_schedule_rules_execution.htm&release=264.0.0&type=5
