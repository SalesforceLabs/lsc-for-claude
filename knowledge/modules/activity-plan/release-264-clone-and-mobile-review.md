# Clone Activity Plans and Review Them on iPad - Winter '27 (264)

Platform: Web (clone), iPad (review).

## Clone Activity Plans

- Permission set: **Life Sciences Commercial Admin**.
- Only **Account Goal** activity plans can be cloned. Cloned plans get Activity Type = Account Goal, Usage Type = Provider Plan Cycle, Build Type = Clone (not editable).
- Adjustments made during the source plan's review cycle are **not** carried forward.

### Prerequisites

1. An activity plan from a past time period exists for the territories you will select (the source plan).
2. A time period record exists with the start/end dates of the new plans.

### Steps

1. App Launcher > **Activity Plans** > **Clone Plan**.
2. Enter an **Activity Plan Name Prefix** (plans are named prefix + territory name, e.g. `Activity Plan 2026 Q2 Aurora`) and select the **Plan Time Period** for the new plans. Next.
3. Select territories (selecting a parent does not select child territories). Next.
4. Select the time period of the plan to clone; an overview of the source plan's goals appears.
5. Review goals and save. Each plan is created and associated with its territory, then the **Clone Activity Plans** batch job clones provider activity goals, goal measures and goal measure products.
6. **Go to Activity Plans**; cloned plans show with **In Progress** status.

Territories with no source plan in the selected period are skipped, so you may get fewer plans than territories selected.

### Notes

- Copies the plan's full hierarchy of goals and goal measures for the chosen time period and territories, instead of rebuilding thousands of records by hand or by data import.
- After cloning, **sync the plan to the current territory alignment** and fine-tune account-specific goals before activating.
- Flow/Apex callers can use the new invocable action `cloneActvtyPlanTerritories` (clones Activity Plan records and associates them with specified territories).

## Review and Adjust Activity Plans in the Mobile App

- Reps can review assigned goals, adjust interaction targets, add or remove accounts and submit changes for approval from the iPad. An internet connection is required. (From the release note; the iPad Help article "Activity Plan Review" was not found.)
- **Conflict to verify:** the Help article "Add a Tab for Activity Plan Reviews" (release 264) states "Activity Plan Review is available only on the web." Confirm iPad availability before promising it to customers.
- Web setup (per Help, optional phase; permission set Life Sciences Commercial Admin):
  1. Setup > Quick Find > **Tabs**.
  2. Under Lightning Component Tabs, **New**.
  3. Lightning Component = `lsc4ce:PlanCycle`.
  4. Enter label/name (e.g. `Activity Plan Review`), tab style, description. Next.
  5. Select profiles (sales reps and managers). Save.
- Reps view, review and request changes; managers view, approve and update. If you skip Field Review, set plan cycle status to Approved manually.
- Tip from Help: set realistic Employee Review (e.g. 2 weeks) and Manager Review (e.g. 1 week) periods.
- Whether `add_navigation_tab` / mobile metadata cache applies for iPad is not stated in Help (unverified).
- Related existing content: [release-260-adjustment-requests](./release-260-adjustment-requests.md).

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_activity_plans_clone_plans.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_activity_plans_create_tab.htm&release=264.0.0&type=5
- Not found: "Activity Plan Review" (iPad). `cloneActvtyPlanTerritories` invocable action not verified in Help.
