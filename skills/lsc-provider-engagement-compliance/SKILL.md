---
name: lsc-provider-engagement-compliance
description: Guides Provider Engagement Compliance (Japan EPPV and MID) setup and troubleshooting. Use when user asks about EPPV, MID, Account Compliance, 取引先コンプライアンス, compliance cycles, Care Program with ProviderEngagementCompliance, Start Compliance Action Plan, Report Compliance Activity, PrvdEngmtComplianceCycle, or reporting on cycles.
---

## How to Answer EPPV / Account Compliance Questions

**Always call MCP tools to get sourced documentation.** Do not answer from general knowledge alone.

| User asks about... | Call this tool |
|---------------------|---------------|
| Setup checklist, rules, gotchas, reporting | `get_lsc_module_docs({ module: "provider-engagement-compliance" })` |
| Overview, what EPPV/MID are, rep experience | `search_lsc_knowledge({ query: "EPPV MID Provider Engagement Compliance" })` |
| Check an org's EPPV setup | `check_eppv_config()` or `check_eppv_config({ profileName: "<rep profile>" })` |
| An error or symptom | `diagnose_lsc_issue({ symptom: "<error text>" })` (known causes `eppv-*`) |
| DB Schema records for the feature | `list_db_schema({ filter: "ActionPlan" })`, `create_db_schema`, `assign` to the rep profile |
| Tab / quick action | `list_navigation_tabs`, `add_navigation_tab`, `list_lsc_actions`, `create_quick_action` |
| Flows, plans, cycles in the org | `run_soql` on `ActionPlan`, `PrvdEngmtComplianceCycle`, `AssessmentTask`, `CareProgram` (standard objects) |
| Mobile cache | `generate_mobile_metadata_cache({ profileName })` — **one profile per call** |

Admin Console data, DB Schema and actions use their dedicated tools, never `run_soql`.

## Model in one picture

`CareProgram` (Category ProviderEngagementCompliance) → `CareProgramProduct`, `ActionPlanTemplateAssignment` → `ActionPlanTemplateVersion` (Final) → Items (`PrvdEngmtComplianceCycle`) + ItemValues (Name, DurationInDays); `ActionPlan` (TargetId = HCO, TargetReferenceRecordId = CareProgram, ActionPlanType PrvdEngmtCompliance) → `PrvdEngmtComplianceCycle` (generated on Start) → completed by `AssessmentTask` (TaskType PrvdEngmtComplianceTask) on a Completed Visit.

## Setup order (what worked)

1. Enable feature; permission sets (reps: Core + Field Sales Representative; admins: Commercial Admin + Core).
2. Action Plan State picklist values + Admin Console status mappings (distinct value per shipped state), Care Program statuses, Assessment Task record type and field set.
3. Action Plan Status read-only for reps (FLS).
4. Page layouts: Care Program, Care Program Product, Action Plan Template fields, and an **explicit actions list on Action Plan** (else no Start button).
5. Sharing: Action Plan Template rule; territory sharing or ownership for plans and programs.
6. Clone, schedule and activate the four flows (`Update_Assessment_Task_On_Visit_Completion_Clone` completes cycles).
7. Account Compliance tab (desktop and mobile navigation), enabled for the rep profile.
8. Quick action `AssociateCareProgram` ("Report Compliance Activity" on the iPad), assigned to the rep profile.
9. Eleven DB Schema records (`DbSchema_<Object>`: CareProgram, CareProgramProduct, ActionPlan, ActionPlanItem, ActionPlanTemplate, ...Version, ...Assignment, ...Item, ...ItemValue, PrvdEngmtComplianceCycle, AssessmentTask), no field filters, assigned to the rep profile.
10. Generate the cache per profile, then sync the iPad.

Full detail: the module doc `support-engineering-eppv-setup-and-troubleshooting`.

## Rules to state up front

- Only the **Start Compliance Action Plan** button moves a plan to In Progress (not DML, API or edit form); cycles generate on Start.
- Plan start date: on/after the Care Program start date and not after today.
- Care Program: Announce Date ≥ today; Start ≥ Pre-cycle Start ≥ Announce. No products once announce date is today or earlier (insert at today+2, add product, then set dates to today). No back-dating.
- Final templates/versions are locked; changes need a new template, program and plans.
- Pre-cycle: the iPad excludes the first cycle from completed and total (8 cycles show /7).
- A cycle completes only via **Report Compliance Activity** on a Completed Visit inside the cycle window, after the flow runs and the iPad syncs. Plain Create Visit never completes one. The `prvd_cmpl` batch actions don't write plan progress.
- iPad: badge = plan state; cycle chip = cycle whose dates include today; 未開始/進行中/完了 filters are plan-state filters.
- Reporting: no standard cycle report type. Use single-object custom report types and verify against SOQL (a report once showed only Cycles 1–5 of 8). Plan-by-cycle matrix needs the EPPV Cycle Matrix LWC.

## Troubleshooting flow

1. Run `check_eppv_config` for an org-wide picture, and `diagnose_lsc_issue` with the exact symptom.
2. "Unknown Account" / "Account and Place cannot be empty": check `ActionPlan.TargetId` and that the account is on the device.
3. Start missing: Action Plan layout actions list.
4. Cycle not completing: AssessmentTask exists, visit Completed and dated in the window, flow active with no faults, then sync.
5. One-day-off dates: UTC display.

Never suggest OmniStudio for the mobile tab; use LSC apps or standard LWCs.
