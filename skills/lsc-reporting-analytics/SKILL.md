---
name: lsc-reporting-analytics
description: Guides CRM Analytics, reports, dashboards, and KPI configuration. Use when the user asks about reporting, dashboards, analytics or KPIs in LSC.
---

For reporting and analytics guidance, call `search_lsc_knowledge({ query: "reporting analytics" })` to get sourced documentation.


------------|
| Call Frequency | Visit (completed count by account) |
| Reach | ProviderAcctTerritoryInfo (accounts with visits) |
| Detailing Effectiveness | ProviderVisitProdDiscussion (message coverage) |
| Sample Compliance | ProviderSampleLimit (limit utilization %) |
| Goal Achievement | ProviderActivityGoal (actual vs target) |
| Territory Coverage | ProviderAcctTerritoryInfo (visited vs total) |

## Tips

- Use `run_soql` to prototype report queries before building reports
- Use `describe_sobject` to verify field names for report formulas
- CRM Analytics requires the CRM Analytics Plus license
- Einstein Discovery requires additional licensing for predictive models

