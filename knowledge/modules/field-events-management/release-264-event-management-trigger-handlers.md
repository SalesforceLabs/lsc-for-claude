# New Event Management Trigger Handlers - Winter '27 (264)

Platform: Web and iPad.

## What's New

Seven trigger handlers keep monetary caps, expense buckets and account utilization limits consistent. Activate them from **Admin Console > Trigger Handler Administration**.

| Handler | Purpose |
|---------|---------|
| `EstimatedExpenseMonetaryCapsHandler` | Monetary cap checks on estimated expenses |
| `EstExpensePtcpAllocMonetaryCapsHandler` | Monetary cap checks on participant allocations of estimated expenses |
| `EstimatedExpPtcpAllocImmutabilityHandler` | Block changing the Participant on an estimated expense allocation (prevents cap bypass) |
| `ExpenseParticipantImmutabilityHandler` | Block changing the Participant on an Expense Participant (prevents cap bypass) |
| `MngEventParticipantImmutabilityHandler` | Block changing the Participant on a Managed Event Participant (prevents cap bypass) |
| `MngEventAcctUtilLmtsHandler` | Keep account utilization limits in sync with Managed Event changes |
| `MngEventPartAcctUtilLmtsHandler` | Keep account utilization limits in sync with Managed Event Participant changes |

## Using the MCP tools

- Find them: `list_trigger_handlers` (filter on "Est", "Mng", "Immutability").
- Enable: `toggle_trigger_handler` with the DeveloperName.

## Related

- [release-264-monetary-cap-utilization-limits](./release-264-monetary-cap-utilization-limits.md), [release-264-estimated-expense-allocation](./release-264-estimated-expense-allocation.md).
- Utilization limits and monetary caps themselves are set up with **Provider Activity Measure Type** records; a new batch job **Recalculate Account Utilization Count** recomputes counts in bulk. Account Merge now includes estimated and committed expenses.

## Verified Handler Behavior (Help: Monetary Cap, Account Utilization Limits)

Verified against Help: the immutability handlers **block** changing the Participant lookup after create; the two `*AcctUtilLmtsHandler`s drive utilization recalculation. Activate from Admin Console (Life Sciences Commercial) > **Trigger Handler Administration** (filter by Object API Name or search; toggle on).

| Handler | Verified behavior |
|---------|-------------------|
| `EstimatedExpenseMonetaryCapsHandler` | On estimated expense update, if a field referenced in the goal measure criteria changes, recalculates cap use for all child allocations; on delete, removes their contribution. Does not run on insert; never blocks or validates. |
| `EstExpensePtcpAllocMonetaryCapsHandler` | On allocation insert/update: rejects negative amounts, checks cap. Error blocks; Warning allows and stamps a discrepancy. Recalculates the Provider Activity Goal Measure. On delete, removes the amount. Mobile sync is not blocked (discrepancy created). |
| `EstimatedExpPtcpAllocImmutabilityHandler` | Participant (lookup to Managed Event Participant) on an Estimated Expense Participant Allocation cannot change after create. No exceptions; Account Merge unaffected. |
| `ExpenseParticipantImmutabilityHandler` | Participant (Account/Contact lookup) on Expense Participant cannot change after create. No exceptions. |
| `MngEventParticipantImmutabilityHandler` | Participant (Account or Expert lookup) on Managed Event Participant cannot change after create. Exceptions: Account Merge re-parenting and write-in reconciliation/conversion. |
| `MngEventAcctUtilLmtsHandler` | Recalculates account utilization when a Managed Event changes (criteria field or start date/time changed, plan period move updates both plans) or is deleted; create alone does not. Prerequisite for utilization limits. |
| `MngEventPartAcctUtilLmtsHandler` | Recalculates utilization and logs discrepancies on Managed Event Participant create/update/delete; Error blocks the add (except write-ins), Warning adds with discrepancy. Prerequisite for utilization limits. |

Other cap-related handlers that must also be active (already present before 264): `ExpenseParticipantMonetaryCapsHandler`, `MngEventPartMonetaryCapsHandler`, `MngEventMonetaryCapsHandler`, `ExpenseMonetaryCapsHandler`, `RecalculateExpPtcpOnExpChangeHandler`. Help's "Get Your Org Ready for Event Management" lists ~43 Event Management handlers that should be active, including `EventMgmtPtcpTypeRoleMapHandler` (unique type/role/event-type combination), `CreateMngEventPtcpHandler`, `MngEventDateTimeValidationHandler`, `SubjectAssignmentComplianceHandler`.

Related prerequisites from the same article: assign Life Sciences Commercial + Life Sciences Core permission sets to the Event Management admin, and Life Sciences Field Sales Representative + Life Sciences Core to reps/organizers; create Data-type object metadata cache configurations for Event Management objects (Attachment Download Method Background or Cache for Managed Event); create the field sets referenced by profile-level settings.

Batch job: **Recalculate Account Utilization Count** (Admin Console > Event Management > Field Event Jobs > Run Now, or Flow action `lsc4ce_flow__RcalcAccountUtilCount`) recomputes counts when handlers were off. Provider Activity Measure Types are inserted via Apex in Developer Console (see monetary cap doc).

Not verified: a standalone per-handler description for the seven new handlers in "Trigger Handlers by Object" (only partially retrieved); the release note itself lists names without behavior. "Account Merge now includes estimated and committed expenses" is confirmed in Monetary Cap Account Merge.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_get_org_ready.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_event_management_new_trigger_handlers.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_monetary_cap.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_event_management_account_utilization_limits.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_trigger_handler_manage.htm&release=264.0.0&type=5
