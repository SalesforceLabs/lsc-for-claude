/** Lists & Filters readiness: its validation rules plus Studio's own checks. */

import { countGroupedBy, inList, plural, query, type Row } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { dbSchemaCheck, labels, loadDbSchema } from "./_activity-plan-shared.js";

/*
 * Member tables (LifeSciAccountListMember) grow with every account a rep adds, so the data checks
 * never ask "is any list in the org missing members?" with an anti-join: when the answer is no,
 * that scans every member row. They read a fixed number of lists and look their members up by
 * list id instead. When the org has fewer lists than the sample size, the sample is all of them.
 */
const SAMPLE_ROWS = 500;
/** Inactive users whose lists are looked up; an org with more is checked for these only. */
const INACTIVE_USERS = 2000;

/** "1 static list" / "3 static lists" for nouns `plural` can't spell. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** The sentence saying what was looked at, so a pass is never read as "every list in the org". */
const checkedNote = (rows: Row[], one: string, more: string) =>
  rows.length < SAMPLE_ROWS
    ? `Checked all ${many(rows.length, one, more)}.`
    : `Checked a sample of ${SAMPLE_ROWS} ${more}, not every one in the org.`;

/** Lists matching `where` (up to the sample size) that have no member rows, looked up by list id. */
async function emptyLists(where: string, org: string): Promise<{ sampled: Row[]; empty: Row[] }> {
  const sampled = await query(
    `SELECT Id, Name FROM LifeScienceAccountList WHERE ${where} LIMIT ${SAMPLE_ROWS}`,
    org
  );
  if (!sampled.length) return { sampled, empty: [] };
  const members = await countGroupedBy(
    "LifeSciAccountListMember",
    "LifeScienceAccountListId",
    sampled.map((r) => String(r.Id)),
    org
  );
  return { sampled, empty: sampled.filter((r) => !members.has(String(r.Id))) };
}

const readiness: ReadinessModule = {
  ruleFiles: ["lists-filters-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);

    /**
     * Lists (matching `where`) that have object rows but none of `child` on any of them. A list
     * with several object rows keeps its criteria or columns on some of them only (the join
     * objects usually have none), so a list counts as covered when any row has one.
     * Two queries: SOQL won't nest semi-joins.
     */
    const listsMissing = async (child: string, where: string) => {
      const objects = await query(
        `SELECT Id, LifeScienceAccountListId FROM LifeScienceAccountListObject WHERE LifeScienceAccountList.${where} LIMIT 2000`,
        org
      );
      if (objects.length === 0) return [];
      const withChild = new Set(
        (
          await query(
            `SELECT LifeSciAccountListObjectId FROM ${child} WHERE LifeSciAccountListObjectId IN (${inList(objects.map((o) => String(o.Id)))}) GROUP BY LifeSciAccountListObjectId`,
            org
          )
        ).map((r) => String(r.LifeSciAccountListObjectId))
      );
      const covered = new Set(
        objects
          .filter((o) => withChild.has(String(o.Id)))
          .map((o) => String(o.LifeScienceAccountListId))
      );
      const bare = [...new Set(objects.map((o) => String(o.LifeScienceAccountListId)))].filter(
        (id) => !covered.has(id)
      );
      if (bare.length === 0) return [];
      return query(
        `SELECT Id, Name FROM LifeScienceAccountList WHERE Id IN (${inList(bare)}) LIMIT 20`,
        org
      );
    };

    return Promise.all([
      runCheck(
        {
          id: "lists-filters.data.lists-exist",
          stage: "data",
          title: "Account lists exist",
          severity: "info",
          why: "Lists, filters and routes are what reps open first on the Accounts tab. With none, reps start from the full account list.",
          steps: [
            "Create a list, filter or advanced filter in the Accounts tab, or load shared ones for each territory.",
          ],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          // Reading up to the sample size says "some" without counting the whole table.
          const n = (await query(`SELECT Id FROM LifeScienceAccountList LIMIT ${SAMPLE_ROWS}`, org))
            .length;
          if (!n) return { pass: false, detail: "No account lists." };
          return {
            pass: true,
            detail: n < SAMPLE_ROWS ? `${plural(n, "list")}.` : `At least ${SAMPLE_ROWS} lists.`,
          };
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
          const { sampled, empty } = await emptyLists("Type = 'List' AND IsRoute = false", org);
          if (!sampled.length) return { pass: true, detail: "There are no static lists." };
          const scope = checkedNote(sampled, "static list", "static lists");
          return empty.length
            ? {
                pass: false,
                detail: `${empty.length} of ${many(sampled.length, "static list", "static lists")} ${empty.length === 1 ? "has" : "have"} no members. ${scope}`,
                examples: labels(empty.slice(0, 20)),
              }
            : { pass: true, detail: `Every static list checked has members. ${scope}` };
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
          const { sampled, empty } = await emptyLists("IsRoute = true", org);
          if (!sampled.length) return { pass: true, detail: "There are no routes." };
          const scope = checkedNote(sampled, "route", "routes");
          return empty.length
            ? {
                pass: false,
                detail: `${empty.length} of ${many(sampled.length, "route", "routes")} ${empty.length === 1 ? "has" : "have"} no stops. ${scope}`,
                examples: labels(empty.slice(0, 20)),
              }
            : { pass: true, detail: `Every route checked has stops. ${scope}` };
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
          // The User table is small next to the lists, so start from the inactive users and look
          // their lists up by owner, rather than filter every list on its owner's status.
          const users = await query(
            `SELECT Id FROM User WHERE IsActive = false LIMIT ${INACTIVE_USERS}`,
            org
          );
          const scope =
            users.length < INACTIVE_USERS
              ? `Checked the lists of all ${many(users.length, "inactive user", "inactive users")}.`
              : `Checked the lists of ${INACTIVE_USERS} inactive users, not every one in the org.`;
          if (!users.length)
            return {
              pass: true,
              detail: "All list owners are active. The org has no inactive users.",
            };
          const owners = await countGroupedBy(
            "LifeScienceAccountList",
            "OwnerId",
            users.map((u) => String(u.Id)),
            org
          );
          if (!owners.size) return { pass: true, detail: `All list owners are active. ${scope}` };
          const n = [...owners.values()].reduce((a, b) => a + b, 0);
          const rows = await query(
            `SELECT Id, Name FROM LifeScienceAccountList WHERE OwnerId IN (${inList([...owners.keys()].slice(0, 200))}) LIMIT 20`,
            org
          );
          return {
            pass: false,
            detail: `${plural(n, "list")} owned by ${many(owners.size, "inactive user", "inactive users")}. ${scope}`,
            examples: labels(rows),
          };
        }
      ),

      runCheck(
        {
          id: "lists-filters.config.lists-have-objects",
          stage: "config",
          title: "Every filter says which object it filters",
          severity: "warning",
          why: "A filter's object rows hold the objects, columns and criteria it is built from. A filter without any has nothing to evaluate, so the app may show it empty or refuse to open it. Static lists keep their accounts as members instead, and advanced filters built on a report use the report, so neither is checked here.",
          steps: [
            "Open the filter in the Accounts tab and save its object, columns and criteria, or recreate it.",
          ],
          uiPath: "LSC4CE App > Accounts > Lists",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Id, Name FROM LifeScienceAccountList WHERE (Type = 'Filter' OR (Type = 'AdvancedFilter' AND ReportIdentifier = null)) AND Id NOT IN (SELECT LifeScienceAccountListId FROM LifeScienceAccountListObject) LIMIT 20`,
            org
          );
          return rows.length
            ? {
                pass: false,
                detail: `${plural(rows.length, "filter")} with no object.`,
                examples: labels(rows),
              }
            : { pass: true, detail: "Every filter has an object." };
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
          const rows = await listsMissing(
            "LifeSciAcctListFilterCrit",
            "Type IN ('Filter', 'AdvancedFilter')"
          );
          return rows.length
            ? {
                pass: false,
                detail: `${plural(rows.length, "filter")} with no criteria.`,
                examples: labels(rows),
              }
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
            ? {
                pass: false,
                detail: `${plural(rows.length, "list")} with no columns.`,
                examples: labels(rows),
              }
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
          steps: [
            "Admin Console > Mobile > DB Schema: add or switch on a record for each object listed.",
            "Publish to iPad.",
          ],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        schema,
        [
          "LifeScienceAccountList",
          "LifeSciAccountListMember",
          "LifeScienceAccountListObject",
          "LifeSciAccountListColumn",
          "LifeSciAcctListFilterCrit",
        ]
      ),
    ]);
  },
};

export default readiness;
