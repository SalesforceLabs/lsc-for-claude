import { describe, expect, it } from "vitest";
import {
  changedParts,
  checkCurrent,
  describeChanges,
  draftProblem,
  draftWarnings,
  planIsEmpty,
  planWrites,
  type DraftRows,
} from "../../../../src/studio/content/logic.js";
import type { PresentationDraft } from "../../../../src/studio/content/types.js";

const draft = (over: Partial<PresentationDraft> = {}): PresentationDraft => ({
  fields: {
    name: "Cordim deck",
    status: "Active",
    activationDate: "2026-01-01",
    deactivationDate: null,
    gesture: "TapBottom",
    pinchZoom: false,
    doubleTapZoom: false,
    canEmail: false,
    locked: false,
  },
  pages: [
    { pageId: "P1", name: "Intro", mandatory: false, products: [{ id: "X1", name: "Cordim" }] },
    { pageId: "P2", name: "Efficacy", mandatory: true, products: [] },
  ],
  topics: [{ id: "T1", name: "Cardio" }],
  shares: [{ groupId: "G1", territoryId: "R1", name: "Boston", subordinates: false }],
  ...over,
});

const rows = (): DraftRows => ({
  links: new Map([
    ["P1", { id: "L1", order: 1 }],
    ["P2", { id: "L2", order: 2 }],
  ]),
  pageState: new Map([
    ["P1", { mandatory: false, products: new Map([["X1", "PP1"]]) }],
    ["P2", { mandatory: true, products: new Map() }],
    ["P3", { mandatory: true, products: new Map([["X9", "PP9"]]) }],
  ]),
  topics: new Map([["T1", "TA1"]]),
  shares: new Map([["G1", ["S1"]]]),
});

describe("changedParts", () => {
  it("ignores names and finds each changed part", () => {
    const from = draft();
    const to = draft({ topics: [{ id: "T1", name: "Renamed" }] });
    expect(changedParts(from, to)).toEqual([]);
    to.fields.pinchZoom = true;
    to.pages = [...to.pages].reverse();
    expect(changedParts(from, to)).toEqual(["field:pinchZoom", "pages"]);
  });

  it("treats an empty date as none", () => {
    expect(changedParts(draft(), draft({ fields: { ...draft().fields, deactivationDate: "" as never } }))).toEqual([]);
  });
});

describe("checkCurrent", () => {
  it("is ok when the org still holds `from`", () => {
    const from = draft();
    const to = draft({ topics: [] });
    expect(checkCurrent(from, from, to)).toEqual({ state: "ok" });
  });

  it("is applied when the org already holds `to`", () => {
    const to = draft({ topics: [] });
    expect(checkCurrent(to, draft(), to)).toEqual({ state: "applied" });
  });

  it("refuses when a touched part changed, not an untouched one", () => {
    const from = draft();
    const to = draft({ topics: [] });
    const current = draft({ shares: [] });
    expect(checkCurrent(current, from, to)).toEqual({ state: "ok" });
    const other = draft({ topics: [{ id: "T2", name: "Onc" }] });
    expect(checkCurrent(other, from, to)).toEqual({ state: "changed", parts: ["topics"] });
  });

  it("compares a page's settings only on the pages `from` has", () => {
    const from = draft();
    const to = draft();
    to.pages = [...to.pages, { pageId: "P3", name: "Safety", mandatory: true, products: [] }];
    to.pages[2].mandatory = false;
    expect(checkCurrent(from, from, to).state).toBe("ok");
  });
});

describe("planWrites", () => {
  it("writes only changed fields", () => {
    const to = draft();
    to.fields.canEmail = true;
    to.fields.name = "Cordim deck 2";
    const plan = planWrites(draft(), rows(), to, changedParts(draft(), to));
    expect(plan.presentation).toEqual({ Name: "Cordim deck 2", CanSendByEmail: true });
    expect(plan.reorderLinks).toEqual([]);
  });

  it("adds, removes and reorders links", () => {
    const to = draft();
    to.pages = [{ pageId: "P3", name: "Safety", mandatory: true, products: [] }, to.pages[1]];
    const plan = planWrites(draft(), rows(), to, changedParts(draft(), to));
    expect(plan.deleteLinks).toEqual(["L1"]);
    expect(plan.createLinks).toEqual([{ PresentationPageId: "P3", DisplayOrder: 1 }]);
    expect(plan.reorderLinks).toEqual([]);
  });

  it("swaps orders", () => {
    const to = draft();
    to.pages = [to.pages[1], to.pages[0]];
    const plan = planWrites(draft(), rows(), to, ["pages"]);
    expect(plan.reorderLinks).toEqual([
      { Id: "L2", DisplayOrder: 1 },
      { Id: "L1", DisplayOrder: 2 },
    ]);
  });

  it("plans an added page's own settings against what it holds, without duplicating products", () => {
    const to = draft();
    to.pages = [...to.pages, { pageId: "P3", name: "Safety", mandatory: false, products: [{ id: "X9", name: "Imx" }] }];
    const plan = planWrites(draft(), rows(), to, changedParts(draft(), to));
    expect(plan.mandatory).toEqual([{ Id: "P3", IsMandatory: false }]);
    expect(plan.createProducts).toEqual([]);
    expect(plan.deleteProducts).toEqual([]);
  });

  it("diffs products, topics and shares", () => {
    const to = draft({
      topics: [{ id: "T2", name: "Onc" }],
      shares: [{ groupId: "G2", territoryId: "R2", name: "NYC", subordinates: true }],
    });
    to.pages[0].products = [{ id: "X2", name: "Imx" }];
    const plan = planWrites(draft(), rows(), to, changedParts(draft(), to));
    expect(plan.createProducts).toEqual([{ PresentationPageId: "P1", ProductId: "X2" }]);
    expect(plan.deleteProducts).toEqual(["PP1"]);
    expect(plan.createTopics).toEqual(["T2"]);
    expect(plan.deleteTopics).toEqual(["TA1"]);
    expect(plan.addShares.map((s) => s.groupId)).toEqual(["G2"]);
    expect(plan.removeShares).toEqual(["G1"]);
  });

  it("is empty when the org already holds the change", () => {
    const to = draft({ topics: [] });
    expect(planIsEmpty(planWrites(to, rows(), to, ["topics"]))).toBe(true);
  });
});

describe("describeChanges", () => {
  it("names added, removed and moved pages and territories", () => {
    const to = draft({ shares: [{ groupId: "G2", territoryId: "R2", name: "NYC", subordinates: true }] });
    to.pages = [{ pageId: "P3", name: "Safety", mandatory: false, products: [] }, to.pages[1], to.pages[0]];
    const lines = describeChanges("Cordim deck", draft(), to);
    expect(lines.map((l) => `${l.field}: ${l.before} → ${l.after}`)).toEqual([
      "Page: (not in it) → Safety, page 1",
      "Page order: Intro, Efficacy → Safety, Efficacy, Intro",
      "Territories: Boston → NYC and below",
    ]);
  });

  it("shows a new presentation's settings as having had no value", () => {
    const from = draft({ shares: [] });
    from.pages = [];
    from.fields = { ...from.fields, name: "", pinchZoom: false };
    const to = draft({ shares: [] });
    to.pages = [];
    to.fields = { ...to.fields, pinchZoom: true };
    const line = (created: boolean) =>
      describeChanges("New", from, to, created).find((l) => l.field === "Pinch to zoom");
    expect(line(false)?.before).toBe("No");
    expect(line(true)?.before).toBe("(none)");
  });
});

describe("draftWarnings and draftProblem", () => {
  it("warns about shared pages, removed pages and an active deck nobody sees", () => {
    const to = draft({ shares: [] });
    to.pages = [{ ...to.pages[0], mandatory: true }];
    const w = draftWarnings(draft(), to, { P1: ["Other deck"] }, "2026-11-17");
    expect(w).toEqual([
      "Intro is also in Other deck. Its required setting and products change there too.",
      "Pages taken out stay in the org; only their place in this presentation goes.",
      "The presentation isn't distributed to any territory, so reps won't see it.",
    ]);
  });

  it("warns about dates", () => {
    const to = draft();
    to.fields.activationDate = "2026-05-01";
    to.fields.deactivationDate = "2026-04-01";
    expect(draftWarnings(draft(), to, {}, "2026-11-17")).toEqual([
      "It stops being available before it starts.",
      "Its end date has passed, so reps won't see it.",
    ]);
  });

  it("refuses what the org can't take", () => {
    expect(draftProblem(draft(), ["Active", "Inactive"], [])).toBeNull();
    expect(draftProblem(draft({ fields: { ...draft().fields, name: " " } }), [], [])).toMatch(/name/);
    expect(draftProblem(draft({ fields: { ...draft().fields, status: "Gone" } }), ["Active"], [])).toMatch(/Gone/);
    expect(draftProblem(draft({ fields: { ...draft().fields, activationDate: "May 1" } }), [], [])).toMatch(/isn't a date/);
    const twice = draft();
    twice.pages = [twice.pages[0], twice.pages[0]];
    expect(draftProblem(twice, [], [])).toMatch(/twice/);
  });
});
