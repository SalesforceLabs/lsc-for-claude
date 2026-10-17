import { describe, expect, it } from "vitest";
import { buildDetail, chartTicks, firstOfThisMonth, formatAxisValue, formatChartDate, seriesGranularity, shiftSeries, timeColumn } from "../../../../src/studio/screens/tableau.js";

const model = {
  semanticDataObjects: [{ apiName: "Rx", dataObjectName: "Rx__dll", semanticDimensions: [{ apiName: "Period", dataObjectFieldName: "Period_a__c" }] }],
  semanticCalculatedDimensions: [
    { apiName: "Activity_Date_clc", expression: "DATEADD(&#39;day&#39;, DATEDIFF(&#39;day&#39;, {MAX([Rx].[Period])}, DATETRUNC(&#39;month&#39;, TODAY())), [Rx].[Period])" },
    { apiName: "Plain_clc", expression: "[Rx].[Period]" },
    { apiName: "Other_clc", expression: "DATEADD('day', 3, [Rx].[Period])" },
  ],
};

describe("tableau detail chart", () => {
  it("shifts the latest day to the first of this month", () => {
    const rows: [string, number][] = [
      ["2024-10-01", 1],
      ["2026-09-15T00:00:00.000Z", 3],
      ["2025-03-10", 2],
    ];
    expect(shiftSeries(rows, "2026-10-01")).toEqual([
      ["2024-10-17", 1],
      ["2025-03-26", 2],
      ["2026-10-01", 3],
    ]);
    expect(shiftSeries(rows, null).map((p) => p[0])).toEqual(["2024-10-01", "2025-03-10", "2026-09-15"]);
  });
  it("finds the first of the month in the viewer's zone", () => {
    expect(firstOfThisMonth(new Date("2026-10-17T12:00:00Z"), "America/New_York")).toBe("2026-10-01");
    expect(firstOfThisMonth(new Date("2026-11-01T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-01");
    expect(firstOfThisMonth(new Date("2026-10-17T12:00:00Z"), "Not/AZone")).toBe("2026-10-01");
  });
  it("draws dots for first-of-month series and a line for daily ones", () => {
    expect(seriesGranularity([["2026-08-01", 1], ["2026-09-01", 2]])).toBe("month");
    expect(seriesGranularity([["2026-08-01", 1], ["2026-08-02", 2]])).toBe("day");
  });
  it("labels dates and axis values like the device", () => {
    expect(formatChartDate("2024-11-01")).toBe("Nov 1, 2024");
    expect(formatAxisValue(600, false)).toBe("600");
    expect(formatAxisValue(2000, true)).toBe("2K%");
    expect(formatAxisValue(1500, false)).toBe("1.5K");
    expect(formatAxisValue(0, true)).toBe("0%");
  });
  it("picks ticks like the measured charts", () => {
    expect(chartTicks(0, 617, false).ticks.map((t) => t.value)).toEqual([0, 200, 400, 600]);
    expect(chartTicks(60, 80, false, true).ticks.map((t) => t.value)).toEqual([0, 50, 100]);
    expect(chartTicks(0, 15, false, true).ticks.map((t) => t.value)).toEqual([0, 7, 14]);
    expect(chartTicks(1999.6, 2000.6, true).ticks.map((t) => t.label)).toEqual(["0%", "1K%", "2K%"]);
    const d = chartTicks(0, 617, false).domain;
    expect(d[0]).toBeLessThan(0);
    expect(d[1]).toBeCloseTo(771.25);
    expect(chartTicks(0, 617, false).ticks.length).toBe(4);
  });
  it("builds the chart summary, or nothing for a single point", () => {
    const detail = buildDetail([["2024-11-01", 70], ["2024-12-01", 79]], false);
    expect(detail).toMatchObject({ granularity: "month", startLabel: "Nov 1, 2024", endLabel: "Dec 1, 2024", lastLabel: "79" });
    expect(buildDetail([["2024-11-01", 70]], false)).toBeUndefined();
  });
  it("reads the model's time dimension", () => {
    expect(timeColumn({ calculatedFieldApiName: "Activity_Date_clc" }, model)).toEqual({ table: "Rx__dll", column: "Period_a__c", shifted: true });
    expect(timeColumn({ calculatedFieldApiName: "Plain_clc" }, model)).toEqual({ table: "Rx__dll", column: "Period_a__c", shifted: false });
    expect(timeColumn({ tableFieldReference: { tableApiName: "Rx", fieldApiName: "Period" } }, model)).toEqual({ table: "Rx__dll", column: "Period_a__c", shifted: false });
    expect(timeColumn({ calculatedFieldApiName: "Other_clc" }, model)).toBeUndefined();
    expect(timeColumn(undefined, model)).toBeUndefined();
  });
});
