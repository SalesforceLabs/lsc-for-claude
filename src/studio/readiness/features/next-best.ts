/** Next Best (NBC / NBA / NBM) readiness: its validation rules plus Studio's own checks. */

import { fetchCache } from "../../collectors/mobile-sync.js";
import { isMissingObject } from "../../collectors/briefings.js";
import { countGroupedBy, plural, query, type Row } from "../../helpers.js";
import { runCheck, type ReadinessModule, type StudioCheckResult } from "../index.js";
import { fieldUsersReadResult } from "./_field-access.js";
import { cacheFreshResult, daysSince } from "./_mobile-sync-shared.js";
import { loadDbSchema, once, syncResult } from "./_visit-shared.js";

/** Scores older than this mean the scoring job (Einstein Studio / Data Cloud) stopped writing. */
const STALE_DAYS = 14;
const SYNC_OBJECTS = [
  "TerritoryAccountScore",
  "TerritoryAcctRcmdAction",
  "TerritoryAcctProdMsgScore",
  "ProductGuidance",
];
const EXPLAIN_SAMPLE = 200;

/*
 * Score, action and message tables hold a row per account and territory, so in a large org they run
 * to millions. The data checks read a fixed number of rows (the most recently written scores, a plain
 * sample of actions) or look rows up by id, instead of counting over the whole table: a count with a
 * filter on an unindexed field scans everything, and is slowest when the answer is "none".
 */
const SAMPLE_ROWS = 500;
/** Inactive guidance records looked up; the guidance library is small, so this is all of them in practice. */
const GUIDANCE_CAP = 2000;

/** "1 score" / "3 scores" with the plural spelled out. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const isAre = (n: number) => (n === 1 ? "is" : "are");
const hasHave = (n: number) => (n === 1 ? "has" : "have");

/** Whether any row exists — one row read instead of a count over the whole table. */
async function exists(object: string, org: string): Promise<boolean> {
  return (await query(`SELECT Id FROM ${object} LIMIT 1`, org)).length > 0;
}

/** The sentence saying which scores were looked at, so a pass is never read as "every score is fine". */
function scoresNote(n: number, limit: number, what = "scores"): string {
  return n < limit
    ? `Checked all ${many(n, "score", "scores")}.`
    : `Checked the ${limit} most recently written ${what}, not every one in the org.`;
}

/** Today as YYYY-MM-DD, to compare with date fields the way SOQL's TODAY does. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const OFF: StudioCheckResult = {
  pass: true,
  skip: true,
  detail: "Next Best isn't set up in this org: no score records exist.",
};

const readiness: ReadinessModule = {
  ruleFiles: ["next-best-config.yaml"],
  checks: async (org) => {
    // false = no scores at all, so nothing downstream can be judged.
    const scored = once(async () => {
      try {
        return await exists("TerritoryAccountScore", org);
      } catch (err) {
        if (isMissingObject(err)) return false;
        throw err;
      }
    });
    const dbSchema = once(() => loadDbSchema(org));
    const caches = once(() => fetchCache(org));
    // SystemModstamp is indexed, so ordering by it with a LIMIT reads only the newest rows.
    const scores = once(() =>
      query(
        `SELECT Id, Name, Account.Name, LastModifiedDate, TotalScore, Rank, TerritoryId FROM TerritoryAccountScore ORDER BY SystemModstamp DESC LIMIT ${SAMPLE_ROWS}`,
        org
      )
    );
    const gate = (fn: () => Promise<StudioCheckResult>) => async () =>
      (await scored()) ? fn() : OFF;

    return Promise.all([
      runCheck(
        {
          id: "next-best.access.score-read",
          stage: "access",
          title: "Field users can read Next Best scores",
          severity: "error",
          why: "Next Best cards come from TerritoryAccountScore. A rep whose profile and permission sets don't grant Read on it sees an empty Next Best list even though scores exist.",
          steps: [
            "Open Setup > Permission Sets and pick a set the field users on the profiles listed hold, or create one",
            "Grant Read on Territory Account Score, Territory Account Recommended Action and Territory Account Product Message Score",
            "Assign the set to any of those users who don't hold it",
          ],
          uiPath: "Setup > Permission Sets > Object Settings",
          surface: "objects",
        },
        gate(() => fieldUsersReadResult(org, "TerritoryAccountScore", "Territory Account Score"))
      ),
      runCheck(
        {
          id: "next-best.data.scores-current",
          stage: "data",
          title: `Scores were refreshed in the last ${STALE_DAYS} days`,
          severity: "warning",
          why: "Next Best Customer ranks accounts from scores written by an external model. If the writing job stopped, reps keep seeing last quarter's priorities.",
          steps: [
            "Check the Einstein Studio / Data Cloud job that writes Territory Account Score is running",
            "Look at the job's last run for errors",
          ],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const rows = await scores();
          const latest = rows
            .map((r) => String(r.LastModifiedDate ?? ""))
            .sort()
            .pop();
          const age = daysSince(latest) ?? 0;
          return {
            pass: age <= STALE_DAYS,
            detail: `The newest score was written ${plural(age, "day")} ago.`,
          };
        })
      ),
      runCheck(
        {
          id: "next-best.data.scores-complete",
          stage: "data",
          title: "Scores have a total and a rank",
          severity: "warning",
          why: "The Next Best list sorts by Rank. A score with no Rank or TotalScore sorts unpredictably or is dropped, so a priority account may never show.",
          steps: [
            "Open the scoring job's output mapping",
            "Make sure TotalScore and Rank are written for every row, then reload the scores",
          ],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const rows = await scores();
          const scope = scoresNote(rows.length, SAMPLE_ROWS);
          const noTotal = rows.filter((r) => r.TotalScore == null);
          const noRank = rows.filter((r) => r.Rank == null);
          const bad = rows.filter((r) => r.TotalScore == null || r.Rank == null);
          return bad.length
            ? {
                pass: false,
                detail: `${many(noTotal.length, "score", "scores")} without a total and ${many(noRank.length, "score", "scores")} without a rank. ${scope}`,
                examples: bad.slice(0, 5).map((r) => label(r)),
              }
            : { pass: true, detail: `Every score checked has a total and a rank. ${scope}` };
        })
      ),
      runCheck(
        {
          id: "next-best.data.scores-territory",
          stage: "data",
          title: "Scores are tied to a territory",
          severity: "info",
          why: "Reps see the scores of their own territories. A score with no territory is visible to nobody who filters by territory.",
          steps: [
            "Check the scoring job fills TerritoryId from the account's territory assignment",
          ],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const rows = await scores();
          const scope = scoresNote(rows.length, SAMPLE_ROWS);
          const none = rows.filter((r) => !r.TerritoryId);
          return none.length
            ? {
                pass: false,
                detail: `${none.length} of ${many(rows.length, "score", "scores")} ${hasHave(none.length)} no territory. ${scope}`,
                examples: none.slice(0, 5).map((r) => label(r)),
              }
            : { pass: true, detail: `Every score checked has a territory. ${scope}` };
        })
      ),
      runCheck(
        {
          id: "next-best.data.explainability",
          stage: "data",
          title: "Score explanations are valid JSON",
          severity: "warning",
          why: "The 'why this account' panel reads ScoreExplainabilityInfo. Text that isn't valid JSON leaves the panel empty or throws on the iPad.",
          steps: [
            "Open a score record and read Score Explainability Info",
            "Fix the scoring job so it writes the documented JSON structure",
          ],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const rows = await query(
            `SELECT Id, ScoreExplainabilityInfo FROM TerritoryAccountScore ORDER BY SystemModstamp DESC LIMIT ${EXPLAIN_SAMPLE}`,
            org
          );
          const scope = scoresNote(rows.length, EXPLAIN_SAMPLE, "scores' explanations");
          const filled = rows.filter((r) => r.ScoreExplainabilityInfo);
          if (!filled.length)
            return {
              pass: true,
              skip: true,
              detail: `No score checked carries an explanation. ${scope}`,
            };
          const bad = filled.filter((r) => {
            try {
              JSON.parse(String(r.ScoreExplainabilityInfo));
              return false;
            } catch {
              return true;
            }
          });
          return bad.length
            ? {
                pass: false,
                detail: `${bad.length} of ${many(filled.length, "explanation", "explanations")} ${isAre(bad.length)}n't valid JSON. ${scope}`,
                examples: bad.slice(0, 5).map((r) => String(r.Id)),
              }
            : {
                pass: true,
                detail: `${filled.length === 1 ? "The 1 explanation parses" : `All ${filled.length} explanations parse`}. ${scope}`,
              };
        })
      ),
      runCheck(
        {
          id: "next-best.data.actions-not-overdue",
          stage: "data",
          title: "No recommended action is overdue",
          severity: "warning",
          why: "Next Best Action cards stay 'Upcoming' until a rep completes or skips them. Overdue ones pile up and bury the current recommendations.",
          steps: [
            "Check the recommendation job refreshes or retires past-due actions",
            "Mark stale actions as skipped or expired",
          ],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          // A plain sample with no ORDER BY stops after 500 rows; DueDate and Status aren't indexed.
          const rows = await query(
            `SELECT Id, Name, DueDate, Status, Account.Name FROM TerritoryAcctRcmdAction LIMIT ${SAMPLE_ROWS}`,
            org
          );
          if (!rows.length)
            return {
              pass: true,
              skip: true,
              detail: "No recommended actions exist (Next Best Action not in use).",
            };
          const day = today();
          const overdue = rows.filter(
            (r) => r.Status === "Upcoming" && r.DueDate && String(r.DueDate).slice(0, 10) < day
          );
          const scope =
            rows.length < SAMPLE_ROWS
              ? `Checked all ${many(rows.length, "recommended action", "recommended actions")}.`
              : `Checked a sample of ${SAMPLE_ROWS} recommended actions, not every one in the org.`;
          return overdue.length
            ? {
                pass: false,
                detail: `${overdue.length} of ${rows.length} ${isAre(overdue.length)} still Upcoming past the due date. ${scope}`,
                examples: overdue
                  .slice(0, 5)
                  .map((r) => label(r, `due ${String(r.DueDate).slice(0, 10)}`)),
              }
            : { pass: true, detail: `None is Upcoming past its due date. ${scope}` };
        })
      ),
      runCheck(
        {
          id: "next-best.data.messages-active",
          stage: "data",
          title: "Message scores point at active product guidance",
          severity: "warning",
          why: "Next Best Message suggests a message to deliver. If the guidance behind it is inactive, reps are told to say something that no longer exists.",
          steps: [
            "Open Product Guidance and reactivate the records listed, or remove their scores",
          ],
          uiPath: "App Launcher > Product Guidance",
          surface: "objects",
        },
        gate(async () => {
          if (!(await exists("TerritoryAcctProdMsgScore", org)))
            return {
              pass: true,
              skip: true,
              detail: "No message scores exist (Next Best Message not in use).",
            };
          // Start from the guidance library (small), then count the scores of inactive guidance by its id,
          // which uses the lookup's index instead of joining every message score to its guidance.
          const inactive = await query(
            `SELECT Id, Name FROM ProductGuidance WHERE IsActive = false LIMIT ${GUIDANCE_CAP}`,
            org
          );
          const capped = inactive.length >= GUIDANCE_CAP;
          const names = new Map(inactive.map((r) => [String(r.Id), String(r.Name ?? r.Id)]));
          const scope = capped
            ? `Checked the scores of ${GUIDANCE_CAP} inactive guidance records, not every one in the org.`
            : `Checked every message score against the ${many(inactive.length, "inactive guidance record", "inactive guidance records")}.`;
          if (!inactive.length)
            return {
              pass: true,
              detail:
                "No product guidance is inactive, so every message score points at active guidance.",
            };
          const used = await countGroupedBy(
            "TerritoryAcctProdMsgScore",
            "ProductGuidanceId",
            [...names.keys()],
            org
          );
          const n = [...used.values()].reduce((a, b) => a + b, 0);
          return n
            ? {
                pass: false,
                detail: `${many(n, "message score points", "message scores point")} at inactive guidance. ${scope}`,
                examples: [...used]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([id, c]) => `${names.get(id) ?? id}: ${many(c, "score", "scores")}`),
              }
            : { pass: true, detail: `No message score points at inactive guidance. ${scope}` };
        })
      ),
      runCheck(
        {
          id: "next-best.mobile.db-schema",
          stage: "mobile",
          title: "Next Best objects sync to the iPad",
          severity: "error",
          why: "Scores, actions, message scores and product guidance are read on the device. An object missing from DB Schema means its cards never appear offline.",
          steps: [
            "Open Admin Console > Mobile > DB Schema",
            "Add or switch on a record for each object listed",
            "Publish to iPad",
          ],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => {
          const schema = await dbSchema();
          const used = await Promise.all(
            SYNC_OBJECTS.map(async (o) => ((await exists(o, org).catch(() => false)) ? o : null))
          );
          const objects = used.filter((o): o is string => o !== null);
          return objects.length
            ? syncResult(org, schema, objects)
            : { pass: true, skip: true, detail: "No Next Best data to sync." };
        })
      ),
      runCheck(
        {
          id: "next-best.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes your latest DB Schema changes",
          severity: "warning",
          why: "If Next Best DB Schema records changed after the last publish, the iPad still runs the old schema.",
          steps: [
            "Regenerate the cache for the profiles listed (Publish to iPad in Studio, or /lsc:generate-metadata-cache)",
          ],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        gate(async () => {
          const schema = (await dbSchema()).filter((r) =>
            SYNC_OBJECTS.some(
              (o) => o.toLowerCase() === String(r.fields.SObject ?? "").toLowerCase()
            )
          );
          return cacheFreshResult(org, await caches(), ["DbSchema"], schema, [], true);
        })
      ),
    ]);
  },
};

/** A score or action's name, with its account (when there is one) and any other note in brackets. */
function label(r: Row, extra?: string): string {
  const notes = [(r.Account as Row | null | undefined)?.Name, extra].filter(Boolean);
  return notes.length ? `${r.Name ?? r.Id} (${notes.join(", ")})` : String(r.Name ?? r.Id);
}

export default readiness;
