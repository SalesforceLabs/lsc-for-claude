import { describe, expect, it } from "vitest";
import { decodeSummary, summaryContent, weekRange } from "../../../../src/studio/screens/record-dashboard.js";

const key = JSON.stringify({ keyInfo: [{ sectionName: "Profile", sectionData: [{ data: "A" }, { data: "B" }] }], changeInfo: [{ sectionName: "x", sectionData: [{ data: "C1" }] }] });
const change = JSON.stringify({ changeInfo: [{ sectionName: "y", sectionData: [{ data: "C2" }] }] });

describe("record dashboard", () => {
  it("decodes summary sections and tolerates bad JSON", () => {
    expect(decodeSummary(key).keyInfo).toEqual([{ title: "Profile", content: ["A", "B"] }]);
    expect(decodeSummary("nope")).toEqual({ keyInfo: [], changeInfo: [] });
  });

  it("folds change info into one Changes section ahead of the key info", () => {
    expect(summaryContent(key, change)).toEqual([
      { title: "Changes", content: ["C1", "C2"] },
      { title: "Profile", content: ["A", "B"] },
    ]);
    expect(summaryContent("{}", "{}")).toEqual([]);
  });

  it("uses the Monday to Sunday week in the viewer's time zone", () => {
    const r = weekRange(new Date("2026-10-17T20:00:00Z"), { timeZone: "America/Los_Angeles", locale: "en-US" });
    expect(r).toEqual({ from: "2026-10-12", to: "2026-10-18", label: "Oct 12 – 18" });
    expect(weekRange(new Date("2026-10-29T12:00:00Z"), { timeZone: "UTC", locale: "en-US" }).label).toBe("Oct 26 – Nov 1");
  });
});
