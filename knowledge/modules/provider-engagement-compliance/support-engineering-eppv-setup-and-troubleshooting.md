# Account Compliance (EPPV) — Setup Checklist, Rules, Gotchas and Reporting

Field-tested setup of Provider Engagement Compliance (Japan: EPPV and MID) in a sandbox, end to end through to the iPad. Complements the PM overview in [release-262-eppv-mid](./release-262-eppv-mid.md). Evergreen: object and tool names are as of Winter '27 (API 68.0).

## 1. What it is

- Each HCO gets an **Action Plan** made of dated **Compliance Cycles**. A completed visit that carries a compliance activity completes the cycle.
- The iPad tab is **Account Compliance** (取引先コンプライアンス). The PM deck calls it "Account Compliances".

## 2. Data model

```
CareProgram (Category = ProviderEngagementCompliance)
 ├ CareProgramProduct
 ├ ActionPlanTemplateAssignment → ActionPlanTemplateVersion (Final)
 │     → Items (ItemEntityType = PrvdEngmtComplianceCycle)
 │     → ItemValues (Name, DurationInDays)
 └ ActionPlan (TargetId = HCO account,
               TargetReferenceRecordId = CareProgram,
               ActionPlanType = PrvdEngmtCompliance)
     └ PrvdEngmtComplianceCycle   (generated when the plan is started)
         └ completed by AssessmentTask (TaskType = PrvdEngmtComplianceTask) on a Completed Visit
```

Use `describe_sobject` for field names. These are standard objects, not `__c`.

## 3. Setup checklist that worked

1. **Enable the feature** (Setup > Life Sciences for Customer Engagement Setup > Configure Provider Engagement Compliance).
   - Reps: Life Sciences Core + Field Sales Representative.
   - Admins: Commercial Admin + Core.
2. **Action Plan State picklist** must have a value for each shipped plan state (at least Not Started, In Progress, Completed, Stopped). In the Admin Console, map **each shipped plan state to a distinct picklist value**. Also map the Care Program statuses, and set the **Assessment Task record type and field set**.
3. **Make Action Plan Status read-only for reps** (field-level security). Reps must not edit it.
4. **Page layouts** — add the fields, or the data can't be entered:
   - Care Program: Announce Date, Pre-cycle Start Date, Extension End Date, Modification End Date.
   - Care Program Product: LS Marketable Product.
   - Action Plan Template: Last Cycle Behavior, Restart Behavior, Pre-cycle Required, Subcategory, Stop Allowed After Completion.
   - Action Plan: define an **explicit actions list** with the Start action, `StopActionPlanForCompliance` and `RestartActionPlanForCompliance`. **Without it the Start button never shows.**
5. **Sharing**: an Action Plan Template sharing rule (all internal users). Care Programs and Action Plans reach reps through territory sharing, or through plan ownership.
6. **Flows**: clone, schedule and activate the four flows. Two handle visibility (care programs and plans to territories); two update assessment tasks and cycles. `Update_Assessment_Task_On_Visit_Completion_Clone` is the one that **completes a cycle**.
7. **Account Compliance tab**: add it to the desktop app and to mobile navigation (`add_navigation_tab`, tab name `standard-AccountCompliance`), and enable it for the rep profile.
8. **Quick action** *Capture Compliance Activity* (`ActionName` `AssociateCareProgram`, location Visit), assigned to the rep profile. The iPad labels it **Report Compliance Activity**. Create it with `create_quick_action`.
9. **DB Schema records** (record names `DbSchema_<Object>`), each created (`create_db_schema`, Type DATA) and assigned to the rep profile. No field filters (no `WhereSoql`) on any of them. The 11 objects: `CareProgram`, `CareProgramProduct`, `ActionPlan`, `ActionPlanItem`, `ActionPlanTemplate`, `ActionPlanTemplateVersion`, `ActionPlanTemplateAssignment`, `ActionPlanTemplateItem`, `ActionPlanTemplateItemValue`, `PrvdEngmtComplianceCycle`, `AssessmentTask`.
10. **Generate the metadata cache** with `generate_mobile_metadata_cache` for one `profileName` at a time, then sync the iPad. Generating for many profiles at once hit `REQUEST_LIMIT_EXCEEDED`.

**Verify with `check_eppv_config`** (optionally `profileName` for the rep profile). It checks Care Programs and products, plan targets and cycles, the four cloned flows, the 11 DB Schema records, the tab, the quick action and the cache. It does not check the Action Plan State picklist and status mappings, layouts, FLS or sharing; confirm those by hand.

## 4. Rules and gotchas

### Starting a plan
- Only the **Start Compliance Action Plan** button moves a plan to In Progress. DML, the API and the edit form can't. Starting generates the cycles. A plan that isn't started has no cycles.
- Plan start date must be **on or after the Care Program start date and no later than today**.

### Care Program dates
- Announce Date must be today or later.
- Start Date ≥ Pre-cycle Start Date ≥ Announce Date.
- A product can't be added once the announce date is today or earlier. Workaround for demos: insert the program with dates at today+2, add the product, then update the dates to today.
- Back-dating is impossible.

### Templates
- A **Final** template or template version is locked. To change anything, create a new template, Care Program and plans.
- `IsPreCycleRequired` adds a "Pre Delivery" cycle. **The iPad drops the first cycle (by start date) from both the completed count and the total**, so 8 cycles show as /7.

### Demoing a later cycle
Create a visit dated inside that cycle's window and submit it. Future-dated visits can be submitted.

### Cycle completion
- **Create Visit** makes a plain Visit (no compliance activity).
- **Report Compliance Activity** creates the AssessmentTask that ties the visit to the Care Program.
- The cycle completes when the visit is **Completed** and the flow has run. The iPad shows it after a sync.
- Batch jobs and flows: none of the `prvd_cmpl` batch actions write plan progress (Update Assessment Tasks, Action Plan Share Job, Manage Care Program Sharing). Don't run them to force completion.

### Common errors
| Symptom | Cause |
|---|---|
| "Unknown Account" on the iPad | Plan `TargetId` is missing, or that account isn't on the device (not in the Account sync). |
| Visit save error "Account and Place cannot be empty" | Same cause as above. |
| Duplicate hospitals in the list | Old plans for the same HCO still exist. Delete or stop them. |
| Cycle dates look one day off | UTC vs. the viewer's time zone. |
| Start button missing | Action Plan layout has no explicit actions list (section 3, step 4). |

## 5. iPad list semantics

Two different statuses appear on each card:
- **Top-right badge**: the plan state (`ActionPlanState`).
- **Cycle chip and current-cycle columns**: the cycle whose dates include today.

Progress counts all cycles minus the pre-cycle. The header filters 未開始 / 進行中 / 完了 are **plan-state** filters.

## 6. Reporting on the server

- No standard report type exists for cycles. Make **custom report types**, one object only (e.g. *EPPV Cycles*, *EPPV Action Plans*). The lookup from a cycle to its plan isn't reportable, and `OwnerId` and `TargetId` aren't reportable columns.
- Custom fields on the standard cycle object work in reports. **Known report bug**: a cycle report returned only Cycles 1–5 although 8 exist. SOQL shows all 8, so verify report totals against SOQL.
- A plan × cycles pivot isn't possible with standard reports. The workaround is the **EPPV Cycle Matrix** LWC:
  - Apex controller `EppvCycleMatrixController`: `with sharing`, `WITH USER_MODE`.
  - One row per plan, one column per cycle (✓ completed, ● current, ○ open), pre-cycle rule applied and first cycle shown. Search, plan-state filter and territory filter.
  - Deploys as an AppPage flexipage and a tab, plus a permission set (`…_Matrix`: tab visibility and Apex class access) assigned to each user.
  - Territory filter: plan → `TargetId` account → ObjectTerritory2Association → active-model Territory2, ancestors included. Users with View All Data see every territory; others see the territories they are assigned to and everything below.
- Lightning tab URL `/lightning/n/<TabApiName>` works without app navigation. "Page doesn't exist" means the user lacks the permission set.
- Cached Apex (`cacheable=true`): a stale response shape caused `rows.map is not a function`. Hard refresh, or make the LWC tolerate both shapes.
