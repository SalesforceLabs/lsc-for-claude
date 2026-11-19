import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const { matchSymptom } = await import("../../../src/validation/symptom-match.js");
const { getKnownCauses } = await import("../../../src/validation/known-causes.js");
const { getAllRules } = await import("../../../src/validation/rules-loader.js");

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures", name), "utf-8"));

// Phrasings a user would type, each with the cause it should find or with none. A cause that
// starts covering a 'silent' phrasing should move it to 'matches' with that cause.
const scenarios: { matches: { says: string; expect: string[] }[]; silent: string[] } = fixture(
  "troubleshoot-scenarios.json"
);
// The same problems in other words. Many 'matches' above are stored symptoms word for word, so
// they pass by construction; these show how the matcher does on wording it has not seen.
const heldout: { cases: { says: string; expect: string[] }[] } = fixture(
  "troubleshoot-heldout.json"
);

// Floors, not targets: raise them when a change does better, never lower them to pass.
const HELDOUT_MIN_RIGHT = 76;
const HELDOUT_MAX_FALSE = 19;

describe("troubleshooting scenarios", () => {
  const causes = getKnownCauses();
  const rules = getAllRules();
  const top = (says: string) => matchSymptom(says, causes, rules)[0];

  it("puts the right cause first", () => {
    const wrong = scenarios.matches
      .map(({ says, expect: ids }) => ({ says, ids, id: top(says)?.item.id }))
      .filter(({ ids, id }) => !id || !ids.includes(id))
      .map(({ says, ids, id }) => `"${says}": got ${id ?? "nothing"}, want ${ids.join(" or ")}`);
    expect(wrong).toEqual([]);
  });

  it("stays silent when nothing covers the problem", () => {
    const noisy = scenarios.silent
      .map((says) => ({ says, hit: top(says) }))
      .filter(({ hit }) => hit)
      .map(({ says, hit }) => `"${says}": matched ${hit!.item.id} on "${hit!.matched}"`);
    expect(noisy).toEqual([]);
  });

  it("handles held-out wording at least as well as before", () => {
    let right = 0;
    let falseHits = 0;
    for (const { says, expect: ids } of heldout.cases) {
      const id = top(says)?.item.id;
      if (ids.length && id && ids.includes(id)) right++;
      if (!ids.length && id) falseHits++;
    }
    expect(right).toBeGreaterThanOrEqual(HELDOUT_MIN_RIGHT);
    expect(falseHits).toBeLessThanOrEqual(HELDOUT_MAX_FALSE);
  });
});
