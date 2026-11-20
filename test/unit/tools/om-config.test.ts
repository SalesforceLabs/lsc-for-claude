import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => ({ executeCheck: vi.fn() }));
vi.mock("../../../src/validation/rules-executor.js", () => exec);

import {
  collectOmChecks,
  omCheckableCauses,
  omUncheckedCauses,
  renderOmReport,
  toOmCheck,
  OM_WARN_ONLY,
} from "../../../src/tools/om-config.js";
import { getKnownCauses, type KnownCause } from "../../../src/validation/known-causes.js";

const cause = (over: Partial<KnownCause> = {}): KnownCause => ({
  id: "om-x",
  title: "Something is off",
  module: "order-management",
  symptoms: [],
  cause: "",
  fix: ["Fix it.", "Then sync."],
  check: { type: "soql", query: "SELECT Id FROM Quote", expect: "records.length == 0" },
  ...over,
});

beforeEach(() => exec.executeCheck.mockReset());

describe("omCheckableCauses()", () => {
  it("takes every Order Management cause with a check, and only those", () => {
    const all = getKnownCauses();
    const ids = omCheckableCauses().map((c) => c.id);
    expect(ids).toContain("om-stage-path-handler-inactive");
    expect(ids).toContain("om-submitted-stage-not-locked");
    expect(ids).toContain("om-product-not-available-for-quote");
    expect(ids.length).toBe(
      all.filter((c) => c.module === "order-management" && c.check && !c.by_design).length
    );
    expect(omUncheckedCauses().every((c) => !c.check)).toBe(true);
  });

  it("names only causes that exist as warn-only", () => {
    const ids = new Set(getKnownCauses().map((c) => c.id));
    for (const id of OM_WARN_ONLY) expect(ids.has(id)).toBe(true);
  });
});

describe("toOmCheck()", () => {
  it("passes when the check passes", () => {
    expect(toOmCheck(cause(), { passed: true, message: "ok" })).toMatchObject({
      status: "pass",
      detail: "Not found in the org.",
    });
  });

  it("fails with the records found and the fix", () => {
    const c = toOmCheck(cause(), {
      passed: false,
      message: "2 records",
      details: { records: [{ Name: "A" }, { Name: "B" }] },
    });
    expect(c).toMatchObject({ status: "fail", detail: "Found: A, B", fix: "Fix it. Then sync." });
  });

  it("warns, not fails, for a setup an org may choose", () => {
    expect(
      toOmCheck(cause({ id: "om-submitted-stage-not-locked" }), { passed: false, message: "1" })
        .status
    ).toBe("warn");
  });

  it("never turns a check that couldn't run into a pass", () => {
    expect(
      toOmCheck(cause(), { passed: false, message: "no such object", unavailable: true })
    ).toMatchObject({ status: "skip", detail: "Couldn't check: no such object" });
  });

  it("passes as not applicable when applies_if fails", () => {
    expect(
      toOmCheck(cause(), { passed: true, message: "" }, { passed: false, message: "none" }).detail
    ).toMatch(/^Doesn't apply/);
  });
});

describe("collectOmChecks()", () => {
  it("runs each check once, and skips the check when applies_if fails", async () => {
    exec.executeCheck.mockResolvedValue({ passed: true, message: "" });
    const routing = getKnownCauses().find((c) => c.id === "sc-visit-routing-standard-form")!;
    exec.executeCheck.mockImplementation(async (check) =>
      check === routing.applies_if
        ? { passed: false, message: "no StoreCheck record type" }
        : { passed: true, message: "" }
    );
    const checks = await collectOmChecks("demo");
    expect(checks.map((c) => c.id)).toEqual(omCheckableCauses().map((c) => c.id));
    expect(checks.every((c) => c.status === "pass")).toBe(true);
    const calls = exec.executeCheck.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(routing.check);
    expect(calls).toContain(routing.applies_if);
  });
});

describe("renderOmReport()", () => {
  it("gives the verdict, fixes, scope and the causes it can't check", () => {
    const out = renderOmReport(
      "demo",
      [
        { id: "a", title: "A", status: "fail", detail: "Found: X|Y", fix: "Do it." },
        { id: "b", title: "B", status: "skip", detail: "Couldn't check", scope: "Only some." },
      ],
      true
    );
    expect(out).toContain("## Overall: NEEDS ATTENTION");
    expect(out).toContain("1. **A:** Do it.");
    expect(out).toContain("Found: X\\|Y");
    expect(out).toContain("not passes");
    expect(out).toContain("- **B:** Only some.");
    expect(out).toContain("Not checked here");
  });

  it("says when Order Management doesn't look set up", () => {
    expect(renderOmReport("demo", [], false)).toContain("doesn't look set up");
    expect(renderOmReport("demo", [], true)).toContain("## Overall: READY");
  });
});
