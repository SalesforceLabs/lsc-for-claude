# Custom Scripts

LSC4CE supports **JavaScript-based custom scripts** for workflow validation and visit action validation. Scripts run on the mobile device (and in web), are authored as headless LWCs, deployed via Workbench, and registered against the **Life Science Custom Script** object in Admin Console.

## Three Script Types

| Type | When it fires | Blocking? |
|---|---|---|
| **Validation** | On workflow status transition | ✅ Blocks via toast on error |
| **Workflow-Dependent Checklist** | When user clicks the info (ⓘ) icon | ❌ Informational only |
| **Visit Action Validation** | On Visit Sign / Submit | ✅ Blocks visit completion |

> A fourth type, Custom Permission–based, existed in OCE but is **not currently supported in LSC4CE**.

## Execution Context

Scripts have access to four variables:

- `record` (sync) — current entity record + context data
- `user` (sync) — current user fields
- `db` (async, **always `await`**) — query the database; results cached
- `env` (sync) — `actionName`, `fromStatus`, `toStatus`

Every accessor method has **namespace-prefixed** and **`noNs_`** variants — use the right one based on whether the field is package-shipped or customer-created.

## Documentation

## Support Engineering Training (LSC4CE Value Chain)

- [Validations using Custom Scripts](./support-engineering-validations-custom-scripts.md) — three script types, execution context, deployment workflow (LWC → Workbench → Admin Console → Refresh), troubleshooting (namespace mismatches, action label mismatches, missed Refresh, access issues)
- [Visit script passes every institution](../visit-management/support-engineering-visit-script-institution-guard.md) — the customer's Visit Action Validation script inverts the institution check. A missing Save dispatch is a second cause. The customer corrects the script.
