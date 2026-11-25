import { describe, it, expect } from "vitest";
import {
  matchText,
  mostWordsWithin,
  queryTerms,
  sectionAround,
  wordsNeeded,
} from "../../src/search-match.js";

describe("queryTerms()", () => {
  it("drops stopwords and short words, and cuts plurals", () => {
    expect(queryTerms("How do sample limits work?")).toEqual(["sample", "limit", "work"]);
    expect(queryTerms("Approval Process tiers")).toEqual(["approval", "process", "tier"]);
  });
});

describe("wordsNeeded()", () => {
  it("needs every word of a short query and at least half of a long one", () => {
    expect([1, 2, 3, 4, 6, 7].map(wordsNeeded)).toEqual([1, 2, 2, 2, 3, 4]);
  });
});

describe("matchText()", () => {
  const doc =
    "Quotes lock at Submitted.\nThe approval runs on the quote stage path, through a flow.";

  it("matches a question whose words don't appear together", () => {
    const m = matchText(doc, "quote approval process stage path");
    expect(m).not.toBeNull();
    // Centred on the line with the most query words.
    expect(doc.slice(m!.index)).toMatch(/^The approval runs/);
  });

  it("centres on the section holding the most query words, not a stray line", () => {
    const md = [
      "## Overview",
      "Quote product requirements are covered below.",
      "## Checklist",
      "1. Pricebook entry for the product",
      "2. Territory availability",
      "3. Quote tiers",
      "4. Requirements met",
    ].join("\n");
    const m = matchText(md, "quote product pricebook territory tier requirements")!;
    expect(md.slice(m.index)).toMatch(/^(## Checklist|1\. Pricebook)/);
  });

  it("ranks the exact phrase above any word match", () => {
    const phrase = matchText("Set sample limits per product.", "sample limits")!;
    const words = matchText("Limits on each sample apply.", "sample limits")!;
    expect(phrase.score).toBeGreaterThan(words.score);
  });

  it("ranks a document holding more of the words higher", () => {
    const more = matchText("quote approval stage path", "quote approval stage path tier")!;
    const fewer = matchText("quote approval", "quote approval stage path tier");
    expect(fewer).toBeNull(); // 2 of 5 words is under half
    expect(more.score).toBeGreaterThan(0);
  });

  it("doesn't match when too few words are present", () => {
    expect(matchText("Visits and calls.", "quote approval stage path")).toBeNull();
    expect(matchText("Nothing relevant here", "zzznonexistent")).toBeNull();
  });
});

describe("sectionAround()", () => {
  const doc = [
    "# Runbook",
    "Intro.",
    "## Checklist",
    "1. Product",
    "7. Tiers: query PriceAdjustmentTier",
    "8. Regenerate the cache",
    "### Detail",
    "More detail.",
    "## Next",
    "Other.",
  ].join("\n");

  it("returns the whole section holding the match, sub-sections included", () => {
    const out = sectionAround(doc, doc.indexOf("1. Product"), 1000);
    expect(out.startsWith("## Checklist")).toBe(true);
    expect(out).toContain("8. Regenerate the cache");
    expect(out).toContain("More detail.");
    expect(out).not.toContain("## Next");
  });

  it("cuts a long section at line ends, keeping the lines after the match", () => {
    const out = sectionAround(doc, doc.indexOf("7. Tiers"), 40);
    expect(out).toContain("7. Tiers");
    expect(out).not.toContain("## Next");
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("mostWordsWithin()", () => {
  it("counts the most distinct words found close together", () => {
    const text = "alpha beta " + "x".repeat(2000) + " gamma delta alpha";
    expect(mostWordsWithin(text, ["alpha", "beta", "gamma", "delta"], 100)).toBe(3);
    expect(mostWordsWithin(text, ["alpha", "beta", "gamma", "delta"], 5000)).toBe(4);
    expect(mostWordsWithin(text, ["omega"], 100)).toBe(0);
  });
});

describe("matchText() ranking", () => {
  it("ranks a passage holding the words together above a long file that only mentions them apart", () => {
    const filler = (n: number) => "Unrelated setup notes. ".repeat(n);
    const spread = [
      "# Garden handbook",
      "Turnips need water.",
      filler(80),
      "Fences need paint.",
      filler(80),
      "Compost goes in spring.",
      filler(80),
      "Greenhouse vents open at noon.",
      filler(80),
      "Hoses hang in the shed.",
    ].join("\n");
    const together = [
      "# Garden notes",
      "## Watering",
      "Water turnips beside the fence, add compost, and open the greenhouse vents.",
    ].join("\n");
    // The long file holds one more of the query's words, but never two of them near each other.
    const q = "turnip fence compost greenhouse vents hose";
    expect(matchText(together, q)!.score).toBeGreaterThan(matchText(spread, q)!.score);
  });
});
