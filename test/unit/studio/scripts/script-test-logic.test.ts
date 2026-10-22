import { describe, expect, it } from "vitest";
import {
  canRun,
  childSummary,
  cleanEnv,
  envFields,
  formatLocation,
  formatMs,
  headline,
  needsObject,
  recordOption,
  shouldOfferFix,
  statusTone,
  type TestRunResult,
} from "../../../../src-renderer/components/studio/scripts/script-test-logic";

const base = (over: Partial<TestRunResult>): TestRunResult => ({
  ok: true,
  results: [],
  outcome: "pass",
  logs: [],
  queries: [],
  contract: [],
  durationMs: 10,
  notes: [],
  ...over,
});

describe("headline", () => {
  it("names the action a visit script would block", () => {
    const h = headline(base({ outcome: "block", results: [{ title: "x", status: "error" }] }), "VisitActionValidation", { actionName: "Complete" });
    expect(h).toMatchObject({ tone: "error", title: "Would block Complete", detail: "1 error" });
  });
  it("defaults a visit action to Submit", () => {
    expect(headline(base({ outcome: "block" }), "VisitActionValidation").title).toBe("Would block Submit");
  });
  it("warns without blocking", () => {
    const h = headline(base({ outcome: "warn", results: [{ title: "a", status: "warning" }, { title: "b", status: "warning" }] }), "Validation");
    expect(h).toMatchObject({ tone: "warning", title: "Would warn, rep can continue", detail: "2 warnings" });
  });
  it("passes", () => {
    expect(headline(base({ results: [{ title: "ok", status: "success" }] }), "Validation")).toMatchObject({ tone: "pass", title: "Passes" });
  });
  it("reports a thrown error and an unusable result", () => {
    expect(headline(base({ error: { message: "boom" }, outcome: "none" }), "Validation")).toMatchObject({ tone: "error", detail: "boom" });
    expect(headline(base({ outcome: "none", contract: ["returned nothing"] }), "Validation")).toMatchObject({ tone: "unknown", detail: "returned nothing" });
  });
});

describe("inputs", () => {
  it("offers the action to visit scripts and the status change to workflow scripts", () => {
    expect(envFields("VisitActionValidation").map((f) => f.key)).toEqual(["actionName"]);
    expect(envFields("Validation").map((f) => f.key)).toEqual(["actionName", "fromStatus", "toStatus"]);
  });
  it("drops blanks and defaults the visit action", () => {
    expect(cleanEnv("VisitActionValidation", { actionName: "  " })).toEqual({ actionName: "Submit" });
    expect(cleanEnv("Validation", { fromStatus: " Draft ", toStatus: "" })).toEqual({ fromStatus: "Draft" });
  });
  it("needs an object for everything but visit scripts", () => {
    expect(needsObject("Validation", null)).toBe(true);
    expect(needsObject("VisitActionValidation", null)).toBe(false);
    expect(canRun("Validation", "Account", "code", "001")).toBe(true);
    expect(canRun("Validation", "Account", "  ", "001")).toBe(false);
    expect(canRun("Validation", "Account", "code", null)).toBe(false);
  });
});

describe("formatting", () => {
  it("maps statuses to tones", () => {
    expect([statusTone("success"), statusTone("warning"), statusTone("error"), statusTone("")]).toEqual(["pass", "warning", "error", "unknown"]);
  });
  it("formats locations and durations", () => {
    expect(formatLocation({ line: 3, column: 7 })).toBe("line 3, column 7");
    expect(formatLocation({ line: 3 })).toBe("line 3");
    expect(formatLocation({})).toBeNull();
    expect(formatMs(420)).toBe("420 ms");
    expect(formatMs(3900)).toBe("3.9 s");
  });
  it("summarises a record for the picker", () => {
    const children = [
      { object: "ProviderVisitProdDetailing", label: "details", count: 5 },
      { object: "ProductDisbursement", label: "samples", count: 1 },
      { object: "X", label: "messages", count: 0 },
    ];
    expect(childSummary(children)).toBe("5 details · 1 sample");
    const o = recordOption({ id: "1", objectName: "ProviderVisit", name: "V-1", accountName: "Dr A", date: "2026-03-04T10:00:00Z", status: "Planned", children });
    expect(o).toEqual({ value: "1", label: "V-1", detail: "Dr A · Mar 4, 2026 · Planned · 5 details · 1 sample" });
  });
});

describe("shouldOfferFix", () => {
  it("is for broken scripts, not for a legitimate block", () => {
    expect(shouldOfferFix(base({ error: { message: "x" } }))).toBe(true);
    expect(shouldOfferFix(base({ contract: ["bad"] }))).toBe(true);
    expect(shouldOfferFix(base({ outcome: "block" }))).toBe(false);
  });
});
