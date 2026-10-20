/** Next Best (NBC / NBA / NBM) readiness: its validation rules plus Studio's own checks. */

import { fetchCache } from "../../collectors/mobile-sync.js";
import { isMissingObject } from "../../collectors/briefings.js";
import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule, type StudioCheckResult } from "../index.js";
import { fieldUsersReadResult } from "./_field-access.js";
import { cacheFreshResult, daysSince } from "./_mobile-sync-shared.js";
import { loadDbSchema, once, syncResult } from "./_visit-shared.js";

/** Scores older than this mean the scoring job (Einstein Studio / Data Cloud) stopped writing. */
const STALE_DAYS = 14;
const SYNC_OBJECTS = ["TerritoryAccountScore", "TerritoryAcctRcmdAction", "TerritoryAcctProdMsgScore", "ProductGuidance"];
const EXPLAIN_SAMPLE = 200;

const OFF: StudioCheckResult = { pass: true, skip: true, detail: "Next Best isn't set up in this org: no score records exist." };

const readiness: ReadinessModule = {
  ruleFiles: ["next-best-config.yaml"],
  checks: async (org) => {
    // false = no scores at all, so nothing downstream can be judged.
    const scored = once(async () => {
      try {
        return (await count(`SELECT COUNT() FROM TerritoryAccountScore`, org)) > 0;
      } catch (err) {
        if (isMissingObject(err)) return false;
        throw err;
      }
    });
    const dbSchema = once(() => loadDbSchema(org));
    const caches = once(() => fetchCache(org));
    const gate = (fn: () => Promise<StudioCheckResult>) => async () => ((await scored()) ? fn() : OFF);

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
          steps: ["Check the Einstein Studio / Data Cloud job that writes Territory Account Score is running", "Look at the job's last run for errors"],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const rows = await query(`SELECT MAX(LastModifiedDate) latest, COUNT(Id) cnt FROM TerritoryAccountScore`, org);
          const age = daysSince(rows[0]?.latest) ?? 0;
          return { pass: age <= STALE_DAYS, detail: `${Number(rows[0]?.cnt ?? 0).toLocaleString("en-US")} scores; the newest was written ${plural(age, "day")} ago.` };
        })
      ),
      runCheck(
        {
          id: "next-best.data.scores-complete",
          stage: "data",
          title: "Every score has a total and a rank",
          severity: "warning",
          why: "The Next Best list sorts by Rank. A score with no Rank or TotalScore sorts unpredictably or is dropped, so a priority account may never show.",
          steps: ["Open the scoring job's output mapping", "Make sure TotalScore and Rank are written for every row, then reload the scores"],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const [noTotal, noRank] = await Promise.all([
            count(`SELECT COUNT() FROM TerritoryAccountScore WHERE TotalScore = null`, org),
            count(`SELECT COUNT() FROM TerritoryAccountScore WHERE Rank = null`, org),
          ]);
          return noTotal + noRank
            ? { pass: false, detail: `${plural(noTotal, "score")} without a total and ${plural(noRank, "score")} without a rank.` }
            : { pass: true, detail: "Every score has a total and a rank." };
        })
      ),
      runCheck(
        {
          id: "next-best.data.scores-territory",
          stage: "data",
          title: "Scores are tied to a territory",
          severity: "info",
          why: "Reps see the scores of their own territories. A score with no territory is visible to nobody who filters by territory.",
          steps: ["Check the scoring job fills TerritoryId from the account's territory assignment"],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const n = await count(`SELECT COUNT() FROM TerritoryAccountScore WHERE TerritoryId = null`, org);
          return n ? { pass: false, detail: `${plural(n, "score")} have no territory.` } : { pass: true, detail: "Every score has a territory." };
        })
      ),
      runCheck(
        {
          id: "next-best.data.explainability",
          stage: "data",
          title: "Score explanations are valid JSON",
          severity: "warning",
          why: "The 'why this account' panel reads ScoreExplainabilityInfo. Text that isn't valid JSON leaves the panel empty or throws on the iPad.",
          steps: ["Open a score record and read Score Explainability Info", "Fix the scoring job so it writes the documented JSON structure"],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const rows = await query(`SELECT Id, ScoreExplainabilityInfo FROM TerritoryAccountScore ORDER BY LastModifiedDate DESC LIMIT ${EXPLAIN_SAMPLE}`, org);
          const filled = rows.filter((r) => r.ScoreExplainabilityInfo);
          if (!filled.length) return { pass: true, skip: true, detail: "No score carries an explanation." };
          const bad = filled.filter((r) => {
            try {
              JSON.parse(String(r.ScoreExplainabilityInfo));
              return false;
            } catch {
              return true;
            }
          });
          return bad.length
            ? { pass: false, detail: `${bad.length} of ${filled.length} sampled explanations aren't valid JSON.`, examples: bad.map((r) => String(r.Id)) }
            : { pass: true, detail: `${plural(filled.length, "sampled explanation")} all parse.` };
        })
      ),
      runCheck(
        {
          id: "next-best.data.actions-not-overdue",
          stage: "data",
          title: "No recommended action is overdue",
          severity: "warning",
          why: "Next Best Action cards stay 'Upcoming' until a rep completes or skips them. Overdue ones pile up and bury the current recommendations.",
          steps: ["Check the recommendation job refreshes or retires past-due actions", "Mark stale actions as skipped or expired"],
          uiPath: "Setup > Einstein Studio",
          surface: "objects",
        },
        gate(async () => {
          const total = await count(`SELECT COUNT() FROM TerritoryAcctRcmdAction`, org);
          if (!total) return { pass: true, skip: true, detail: "No recommended actions exist (Next Best Action not in use)." };
          const n = await count(`SELECT COUNT() FROM TerritoryAcctRcmdAction WHERE DueDate < TODAY AND Status = 'Upcoming'`, org);
          return n
            ? { pass: false, detail: `${n} of ${total} recommended actions are still Upcoming past their due date.` }
            : { pass: true, detail: `${plural(total, "recommended action")}; none overdue.` };
        })
      ),
      runCheck(
        {
          id: "next-best.data.messages-active",
          stage: "data",
          title: "Message scores point at active product guidance",
          severity: "warning",
          why: "Next Best Message suggests a message to deliver. If the guidance behind it is inactive, reps are told to say something that no longer exists.",
          steps: ["Open Product Guidance and reactivate the records listed, or remove their scores"],
          uiPath: "App Launcher > Product Guidance",
          surface: "objects",
        },
        gate(async () => {
          const total = await count(`SELECT COUNT() FROM TerritoryAcctProdMsgScore`, org);
          if (!total) return { pass: true, skip: true, detail: "No message scores exist (Next Best Message not in use)." };
          const n = await count(`SELECT COUNT() FROM TerritoryAcctProdMsgScore WHERE ProductGuidance.IsActive = false`, org);
          return n ? { pass: false, detail: `${n} of ${total} message scores point at inactive guidance.` } : { pass: true, detail: `${plural(total, "message score")} all point at active guidance.` };
        })
      ),
      runCheck(
        {
          id: "next-best.mobile.db-schema",
          stage: "mobile",
          title: "Next Best objects sync to the iPad",
          severity: "error",
          why: "Scores, actions, message scores and product guidance are read on the device. An object missing from DB Schema means its cards never appear offline.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => {
          const schema = await dbSchema();
          const used = await Promise.all(
            SYNC_OBJECTS.map(async (o) => ((await count(`SELECT COUNT() FROM ${o}`, org).catch(() => 0)) > 0 ? o : null))
          );
          const objects = used.filter((o): o is string => o !== null);
          return objects.length ? syncResult(org, schema, objects) : { pass: true, skip: true, detail: "No Next Best data to sync." };
        })
      ),
      runCheck(
        {
          id: "next-best.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes your latest DB Schema changes",
          severity: "warning",
          why: "If Next Best DB Schema records changed after the last publish, the iPad still runs the old schema.",
          steps: ["Regenerate the cache for the profiles listed (Publish to iPad in Studio, or /lsc:generate-metadata-cache)"],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        gate(async () => {
          const schema = (await dbSchema()).filter((r) => SYNC_OBJECTS.some((o) => o.toLowerCase() === String(r.fields.SObject ?? "").toLowerCase()));
          return cacheFreshResult(org, await caches(), ["DbSchema"], schema, [], true);
        })
      ),
    ]);
  },
};

export default readiness;
