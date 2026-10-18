/** Lists & Filters readiness: its validation rules plus Studio's own checks. */

import { inList, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { countOf, dbSchemaCheck, labels, loadDbSchema } from "./_activity-plan-shared.js";

const readiness: ReadinessModule = {
  ruleFiles: ["lists-filters-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);

    /** Lists (matching `where`) that have an object row but none of `child` hanging off it. Two queries: SOQL won't nest semi-joins. */
    const listsMissing = async (child: string, where: string) => {
      const objects = await query(`SELECT Id, LifeScienceAccountListId FROM LifeScienceAccountListObject WHERE LifeScienceAccountList.${where} LIMIT 2000`, org);
      if (objects.length === 0) return [];
      const withChild = new Set(
        (await query(`SELECT LifeSciAccountListObjectId FROM ${child} WHERE LifeSciAccountListObjectId IN (${inList(objects.map((o) => String(o.Id)))}) GROUP BY LifeSciAccountListObjectId`, org)).map((r) => String(r.LifeSciAccountListObjectId))
      );
      const bare = [...new Set(objects.filter((o) => !withChild.has(String(o.Id))).map((o) => String(o.LifeScienceAccountListId)))];
      if (bare.length === 0) return [];
      return query(`SELECT Id, Name FROM LifeScienceAccountList WHERE Id IN (${inList(bare)}) LIMIT 20`, org);
    };

    return Promise.all([
      runCheck(
        {
          id: "lists-filters.data.lists-exist",
          stage: "data",
          title: "Account lists exist",
          severity: "info",
          why: "Lists, filters and routes are what reps open first on the Accounts tab. With none, reps start from the full account list.",
          steps: ["Create a list, filter or advanced filter in the Accounts tab, or load shared ones for each territory."],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          const n = await countOf(`SELECT COUNT() FROM LifeScienceAccountList`, org);
          return n ? { pass: true, detail: `${plural(n, "list")}.` } : { pass: false, detail: "No account lists." };
        }
      ),

      runCheck(
        {
          id: "lists-filters.data.static-lists-empty",
          stage: "data",
          title: "Static lists have members",
          severity: "warning",
          why: "A static list is a hand-picked set of accounts. One with no members shows an empty Accounts tab, which looks like a sync problem to the rep.",
          steps: ["Open the list and add accounts, or delete it."],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Id, Name FROM LifeScienceAccountList WHERE Type = 'List' AND IsRoute = false AND Id NOT IN (SELECT LifeScienceAccountListId FROM LifeSciAccountListMember) LIMIT 20`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "static list")} with no members.`, examples: labels(rows) }
            : { pass: true, detail: "Every static list has members." };
        }
      ),

      runCheck(
        {
          id: "lists-filters.data.routes-empty",
          stage: "data",
          title: "Routes have stops",
          severity: "info",
          why: "A route is an ordered set of accounts for a day's visits. An empty one leaves the rep with nothing to follow.",
          steps: ["Open the route and add its accounts, or delete it."],
          uiPath: "LSC4CE App > Accounts > Routes",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Id, Name FROM LifeScienceAccountList WHERE IsRoute = true AND Id NOT IN (SELECT LifeScienceAccountListId FROM LifeSciAccountListMember) LIMIT 20`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "route")} with no stops.`, examples: labels(rows) }
            : { pass: true, detail: "Every route has stops (or there are none)." };
        }
      ),

      runCheck(
        {
          id: "lists-filters.data.inactive-owners",
          stage: "data",
          title: "No list is owned by an inactive user",
          severity: "warning",
          why: "A list belongs to its owner. When that user is deactivated, a shared list can no longer be edited or reassigned by the people who rely on it.",
          steps: ["Change the owner of each list listed to an active user."],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          const rows = await query(`SELECT Id, Name FROM LifeScienceAccountList WHERE Owner.IsActive = false LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "list")} owned by an inactive user.`, examples: labels(rows) }
            : { pass: true, detail: "All list owners are active." };
        }
      ),

      runCheck(
        {
          id: "lists-filters.config.lists-have-objects",
          stage: "config",
          title: "Every list says which object it shows",
          severity: "warning",
          why: "The list object row holds the object, columns and filter criteria. A list without one has nothing to display, so the app may show it empty or refuse to open it. Lists loaded by script often miss this row.",
          steps: ["Open the list in the Accounts tab and save its object, columns and criteria, or recreate it."],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Id, Name FROM LifeScienceAccountList WHERE Id NOT IN (SELECT LifeScienceAccountListId FROM LifeScienceAccountListObject) LIMIT 20`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "list")} with no object.`, examples: labels(rows) }
            : { pass: true, detail: "Every list has an object." };
        }
      ),

      runCheck(
        {
          id: "lists-filters.config.filters-have-criteria",
          stage: "config",
          title: "Filters have criteria",
          severity: "warning",
          why: "A filter with no criteria matches every account, so it is the full account list under another name.",
          steps: ["Open the filter and add its criteria, or delete it."],
          uiPath: "LSC4CE App > Accounts > Filters",
          surface: "objects",
        },
        async () => {
          const rows = await listsMissing("LifeSciAcctListFilterCrit", "Type IN ('Filter', 'AdvancedFilter')");
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "filter")} with no criteria.`, examples: labels(rows) }
            : { pass: true, detail: "Every filter has criteria." };
        }
      ),

      runCheck(
        {
          id: "lists-filters.config.lists-have-columns",
          stage: "config",
          title: "Lists have columns",
          severity: "info",
          why: "Columns are the fields shown per account. A list without them shows only names.",
          steps: ["Open the list and choose its columns."],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          const rows = await listsMissing("LifeSciAccountListColumn", "Id != null");
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "list")} with no columns.`, examples: labels(rows) }
            : { pass: true, detail: "Every list has columns." };
        }
      ),

      dbSchemaCheck(
        {
          id: "lists-filters.mobile.db-schema",
          stage: "mobile",
          title: "List objects sync to the iPad",
          severity: "error",
          why: "Lists, their members, columns and filter criteria are evaluated on the device. A missing object makes lists vanish or filters return everything.",
          steps: ["Admin Console > Mobile > DB Schema: add or switch on a record for each object listed.", "Publish to iPad."],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        schema,
        ["LifeScienceAccountList", "LifeSciAccountListMember", "LifeScienceAccountListObject", "LifeSciAccountListColumn", "LifeSciAcctListFilterCrit"]
      ),
    ]);
  },
};

export default readiness;
