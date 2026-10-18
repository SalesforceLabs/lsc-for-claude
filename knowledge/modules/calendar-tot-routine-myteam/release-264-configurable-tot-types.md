# Configurable Time Off Territory (TOT) Types - Winter '27 (264)

Platforms: iPad (mobile) and Web. Status in deck: GA (customer VOC-driven feature).

## What's New

TOT now supports **configurable Downtime Categories** for categorizing users' time off. Organizations define their own TOT types to match regional and country-specific needs, using standard Salesforce configuration, while still integrating with existing TOT scheduling and business rules.

- **Organization-specific TOT categories**: define and manage Downtime Category values per your policies.
- **Platform-aligned configuration**: uses Object Manager and Translation Workbench (standard Salesforce capabilities).
- **Integrated TOT experience**: configured categories apply across scheduling, overlapping rules, and working-day calculations.

Example use case: a global pharma company defines TOT types such as Training, Conference, Jury Duty, or Volunteer Day, each with different scheduling rules. The deck's sample picklist also shows values like Coaching, Maternity Leave, Civic Activity, PTO, US Holiday, France Holiday, Germany Holiday.

### How this builds on Summer '26 (262)

[release-262-enhanced-tot.md](./release-262-enhanced-tot.md) added the **Time Off Territory Time Slot Mode** (None/Slot-Based/Date-Range/Both) controlling *how long/when* time off is logged. Winter '27 addresses a different axis: *what kind* of time off it is. The two are independent; Downtime Category drives the TOT type and the overlapping rules, while slot mode drives time entry. (The deck does not state any interaction between them beyond "integrates with existing TOT scheduling and business rules".)

## Admin Setup & Configuration

### 1. Configure the Downtime Category

In **Setup > Object Manager > Territory User Downtime**:
1. Customize the **Downtime Category** picklist values (field API name shown in the deck: `DowntimeCategory`, data type Picklist) to suit the organization.
2. Update the page layout to:
   - **Add** Downtime Category
   - **Remove** the existing Downtime Type

Translation Workbench can be used to translate the category values (per the deck's "platform-aligned" note).

### 2. Configure TOT Rules

In **Admin Console > Time Off Territory**:
1. Select **Downtime Category** as the field used for TOT rules (per the deck; the Help rules article does not mention this).
2. Configure **overlapping rules** for each Downtime Category as needed.

Per Help ("Configure Time Off Territory Rules", permission set Life Sciences Commercial Admin):
1. App Launcher > **Admin Console** > **Time Off Territory** > **Time Off Territory Rules**.
2. Turn on Time Off Territory Rules. When off, standard validations apply: no TOT entries during visits, non-business hours or holidays.
3. Select the profile (or **Default** for all profiles).
4. Select a rule to update, **Default** for default parameters, or **New Rule** to create one.
5. The default rule decides whether a time-off entry can be created during an event and applies to all TOT types.
6. To override for a specific TOT type, set values in that type's row; blank values fall back to the default rule.
7. Save.

### Prerequisites (Help: "Get Your Org Ready for Time Off Territory")

- Activate trigger handlers: `TUDUpdateHandler`, `TUDBHValidationHandler`, `TUDVisitValidationHandler`, `TUDHolidayValidationHandler`, `TUDOverlapHandler`, `TUDEventValidationHandler`, `TUDSharingHandler`, `VisitTimeOffValidationHandler`, `MngEventDateTimeValidationHandler`.
- Admin Console > **Planner** > **Planner Settings**: select profile (or Default) and set **Global Business Hours** (create business hours in Setup first if none exist). Save.

## End-User Flow (iPad and Web)

- When creating or editing a Time Off Territory record (object label "Territory User Downtime"), the user selects a **Downtime Category** from the organization's configured values.
- Available categories reflect the organization's configuration and the **applicable record type**.
- The configured Downtime Category is shown consistently in the **Calendar, Home Page, and My Team Scheduler**.
- TOT creation and updates follow the overlapping rules configured for the selected Downtime Category.
- iPad: the Create New Territory User Downtime modal (from Calendar) shows a searchable Downtime Category picker, Start Date, and Territory.

## Data Model

| Item | Detail |
|------|--------|
| Object | Territory User Downtime (TOT record) |
| Field | Downtime Category (`DowntimeCategory`, Picklist) replaces the Downtime Type on the page layout |

## Limitations / Gotchas

- Downtime Category must be added to the page layout and Downtime Type removed, otherwise users will still see the old type field.
- The Admin Console TOT rules must be pointed at Downtime Category, or overlapping rules will not key off the new categories.
- Category availability is also governed by record type.
- Not stated in the deck: migration of existing Downtime Type values, and any mobile metadata cache regeneration requirement (likely prudent after layout changes, but unconfirmed).

## Licensing

Not stated in the deck.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_time_off_territory_get_your_org_ready.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_time_off_territory_configure_rules.htm&release=264.0.0&type=5
- Unverified in Help: the `DowntimeCategory` field on Territory User Downtime / `TerritoryUserDowntime`, Object Manager picklist and page-layout steps, and Downtime Category selection in TOT rules (deck only). The Help rules article refers to "TOT types" generically.
