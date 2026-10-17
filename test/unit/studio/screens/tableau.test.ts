import { describe, expect, it } from "vitest";
import { describeTimeRange, formatPercent, formatShort, parseBan, parsePopc } from "../../../../src/studio/screens/tableau.js";

const bundle = (target: Row, extra: Row = {}): Row => ({
  insightGroups: [{ type: "ban", insights: [{ insightType: "popc", result: { facts: { target_period_value: target, ...extra } } }] }],
});
type Row = Record<string, unknown>;

describe("tableau number formatting", () => {
  it("compacts like the device", () => {
    expect(formatShort(2160)).toBe("2.16K");
    expect(formatShort(13390)).toBe("13.39K");
    expect(formatShort(1680)).toBe("1.68K");
    expect(formatShort(2_500_000)).toBe("2.5M");
  });
  it("fixes two decimals under 1000 and formats percents", () => {
    expect(formatShort(11.7)).toBe("11.70");
    expect(formatPercent(2000.08)).toBe("2,000.08%");
  });
});

describe("tableau bundle parsing", () => {
  it("prefers the server-formatted BAN", () => {
    expect(parseBan(bundle({ raw: 2160, formatted: "2.16K" }))).toBe("2.16K");
    expect(parseBan(bundle({ raw: 2000.08, formatted: "2,000.08%" }))).toBe("2,000.08%");
  });
  it("falls back to the raw value, then to '-'", () => {
    expect(parseBan(bundle({ raw: 13390 }))).toBe("13.39K");
    expect(parseBan(bundle({ is_nan: true }))).toBe("-");
    expect(parseBan(undefined)).toBe("-");
  });
  it("explains the all-time case", () => {
    const p = parsePopc(bundle({ raw: 1, formatted: "1" }), true);
    expect(p.relative).toBeUndefined();
    expect(p.comparison).toContain("can’t be compared to a previous time range");
  });
  it("builds a full comparison", () => {
    const facts = {
      comparison_period_value: { raw: 1, formatted: "1" },
      difference: { absolute: { formatted: "+1.2K" }, relative: { formatted: "12.5%" }, direction: "up" },
      comparison_period_label: "Prior Month",
    };
    const p = parsePopc(bundle({ raw: 2, formatted: "2" }, facts), false);
    expect(p).toEqual({ relative: "+12.5%", tone: "positive", comparison: "(+1.2K) vs. prior month" });
  });
  it("shows 'No value' for a ranged follow without a comparison", () => {
    expect(parsePopc(undefined, false).comparison).toBe("No value");
  });
});

describe("tableau time range", () => {
  it("is All without a followed range", () => {
    expect(describeTimeRange(null)).toBe("All");
    expect(describeTimeRange({ operator: "Undefined" })).toBe("All");
  });
  it("labels operator ranges", () => {
    expect(describeTimeRange({ timeRangeType: "ThisMonth" })).toBe("Current Month");
    expect(describeTimeRange({ timeRangeType: "PreviousQuarter" })).toBe("Previous Quarter");
    expect(describeTimeRange({ timeRangeType: "LastDays", value: 7 })).toBe("Last 7 Days");
  });
});
