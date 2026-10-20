import { describe, it, expect } from "vitest";
import { matchSymptom, normalizeText, phraseScore, tokens } from "../../../src/validation/symptom-match.js";
import type { KnownCause } from "../../../src/validation/known-causes.js";
import type { ValidationRule } from "../../../src/validation/rules-loader.js";

const cause = (id: string, symptoms: string[], keywords: string[] = []): KnownCause => ({
  id,
  title: id,
  module: "test",
  symptoms,
  keywords,
  cause: "why",
  fix: ["do this"],
});

const rule = (id: string, symptoms: string[]): ValidationRule => ({
  id,
  name: id,
  description: "description",
  category: "configuration",
  severity: "error",
  check: { type: "soql_count", query: "SELECT COUNT() FROM Account", expect: "count > 0" },
  symptoms,
  resolution: { steps: ["step"] },
});

describe("normalizeText()", () => {
  it("straightens curly quotes and drops record ids and numbers", () => {
    expect(normalizeText("Failed to assign topic to 0Pz5g000000abcDEFG. ‘x’")).toBe("failed to assign topic to . 'x'");
  });

  it("splits words joined by JSON escapes", () => {
    expect(normalizeText("Column:42\\nNo such column")).toBe("column: no such column");
  });

  it("keeps words that look like ids but have no digits", () => {
    expect(normalizeText("healthcareproviderspecialty")).toBe("healthcareproviderspecialty");
  });
});

describe("tokens()", () => {
  it("drops stop words and folds plurals", () => {
    expect(tokens("Accounts missing on the iPad")).toEqual(["account"]);
  });
});

describe("phraseScore()", () => {
  it("scores a stored fragment found in a longer pasted error as 1", () => {
    const pasted = `HTTP 400 [{"message":"ERROR at Row:1:Column:42\\nNo such column 'LastModifiedDate' on entity 'ContentDocumentLink'."}]`;
    expect(phraseScore(pasted, "No such column 'LastModifiedDate' on entity 'ContentDocumentLink'")).toBe(1);
  });

  it("matches fragments only as whole words", () => {
    expect(phraseScore("unable to validate mngevent", "validate mng")).toBe(0);
    expect(phraseScore("template cannot be downloaded", "page template")).toBe(0);
  });

  it("scores a short description inside a stored phrase", () => {
    expect(phraseScore("coming soon", "Extra tabs with 'Coming Soon' on the iPad")).toBe(0.9);
  });

  it("ignores a single shared word in a longer phrase", () => {
    expect(phraseScore("visit not saving", "Visit won't submit on the iPad")).toBe(0);
  });

  it("gives partial credit for shared distinctive words", () => {
    const score = phraseScore("related list empty on ipad", "Related list empty on the iPad but fine on the web");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});

describe("matchSymptom()", () => {
  const causes = [
    cause("delta", ["No such column 'LastModifiedDate'"], ["DeltaDateField"]),
    cause("coming-soon", ["Coming Soon"]),
    cause("accounts", ["No accounts on the iPad"], ["Account"]),
  ];
  const rules = [rule("rule-1", ["Coming Soon tab shown"])];

  it("ranks the exact fragment first", () => {
    const [top] = matchSymptom("INVALID_FIELD: No such column 'LastModifiedDate' on entity 'Topic'", causes, rules);
    expect(top.item.id).toBe("delta");
    expect(top.matched).toBe("No such column 'LastModifiedDate'");
  });

  it("returns causes before rules on equal scores", () => {
    const ids = matchSymptom("Coming Soon tab shown", causes, rules).map((m) => m.item.id);
    expect(ids.slice(0, 2)).toEqual(["coming-soon", "rule-1"]);
    const tie = matchSymptom("coming soon", [cause("c", ["coming soon x"])], [rule("r", ["coming soon x"])]);
    expect(tie.map((m) => m.kind)).toEqual(["cause", "rule"]);
  });

  it("drops loose matches next to an exact one", () => {
    const ids = matchSymptom("No such column 'LastModifiedDate' on entity 'Account'", causes, rules).map((m) => m.item.id);
    expect(ids).toEqual(["delta"]);
  });

  it("returns nothing for unrelated text", () => {
    expect(matchSymptom("the weather is nice", causes, rules)).toEqual([]);
  });
});
