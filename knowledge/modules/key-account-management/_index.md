# Key Account Management

## Documentation Files

- [kam-account-plan-web-mobile-transcription](./kam-account-plan-web-mobile-transcription.md)

## Support Engineering Training (LSC4CE Value Chain)

### Key Concepts

- **Status values live in KAM Settings** — Account Plan, Objective, and Action Plan status pick lists are all defined under Admin Console → KAM Settings (NOT per record type).
- **Deep hierarchy** — `AccountPlan → AccountPlanObjective → {Product, Stakeholder, Participant} → {StakeholderAction, StakeholderProduct, ParticipantStakeholder}`.
- **Stakeholder polymorphism** — `AccountPlanStakeholder.StakeholderRefnRecord` is polymorphic, points to `Account` (HCO) or `Contact` (HCP).
- **Product limitation** — A product attaches to ONE objective; cannot be shared across multiple objectives. Use separate product records if needed.
- **Action Plan Template Assignment** — Required to bind a Template Type = KAM template so Stakeholder Action gets a task list.
- **Stakeholder Details field set** — `StakeholderAccountSummaryColumns` on the HCP entity drives which fields surface in the stakeholder details component.
- **Import Objective prerequisites** — Goal Definition `IsActive = true` + Action Plan Template `TemplateType = KAM` + `Target = AccountPlanObjective`.

- [support-engineering-account-plan](./support-engineering-account-plan.md) — Jun 2026 session (53-slide deck). KAM + Sprint Settings, full hierarchical entity model, Action Plan Template Assignment, Import Stakeholder (6-step), Stakeholder Details + Hierarchical components, Import Objective with 3 prerequisites, Sprint assign/unassign, Participant/Stakeholder assignment via `AccountPlanparticipantsAndStakeholder` LWC, roll-up via KAM trigger handlers, 9 troubleshooting patterns.

## Winter '27 (Release 264) Enhancements

- [release-264-kam-ai-coding-agent](./release-264-kam-ai-coding-agent.md) — AI coding agent skills that automate KAM prerequisites, stakeholder picklists and goal/task import.
