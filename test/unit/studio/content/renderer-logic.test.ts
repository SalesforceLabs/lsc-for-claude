import { describe, expect, it } from "vitest";
import * as server from "../../../../src/studio/content/logic.js";
import type { PresentationDraft } from "../../../../src/studio/content/types.js";
import * as renderer from "../../../../src-renderer/components/studio/content/content-logic.js";
import { changeKey, pendingFor, queueChange } from "../../../../src-renderer/components/studio/changes.js";
import { reachOfChange } from "../../../../src-renderer/components/studio/reach.js";
import type { EditPresentationFix } from "../../../../src-renderer/components/studio/content/content-types.js";

const base = (): PresentationDraft => ({
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
});

const edits: [string, (d: PresentationDraft) => PresentationDraft][] = [
  ["nothing", (d) => d],
  ["name", (d) => renderer.setField(d, "name", "Cordim 2")],
  ["empty date equals null", (d) => renderer.setField(d, "deactivationDate", "" as unknown as null)],
  ["gesture", (d) => renderer.setField(d, "gesture", null)],
  ["locked", (d) => renderer.setField(d, "locked", true)],
  ["move", (d) => renderer.movePage(d, 0, 1)],
  ["remove", (d) => renderer.removePage(d, "P2")],
  ["add", (d) => renderer.addPage(d, { pageId: "P3", name: "Safety", mandatory: true, products: [] })],
  ["mandatory", (d) => renderer.updatePage(d, "P1", { mandatory: true })],
  ["products", (d) => renderer.updatePage(d, "P2", { products: [{ id: "X2", name: "Other" }] })],
  ["product order only", (d) => renderer.updatePage(d, "P1", { products: [{ id: "X1", name: "Renamed" }] })],
  ["topic", (d) => ({ ...d, topics: renderer.addNamed(d.topics, { id: "T0", name: "Aaa" }) })],
  ["share", (d) => renderer.removeShare(d, "G1")],
  [
    "share swapped to subordinates",
    (d) => renderer.addShare(d, renderer.shareFor({ territoryId: "R1", name: "Boston", parentId: null, groupId: "G1", subordinatesGroupId: "G1S" }, true)!),
  ],
];

describe("renderer content-logic matches the server", () => {
  it.each(edits)("changedParts / sameDraft: %s", (_label, edit) => {
    const from = base();
    const to = edit(base());
    expect(renderer.changedParts(from, to)).toEqual(server.changedParts(from, to));
    expect(renderer.sameDraft(from, to)).toBe(server.sameDraft(from, to));
  });

  it("labels agree", () => {
    expect(renderer.FIELD_KEYS).toEqual(server.FIELD_KEYS);
    expect(renderer.FIELD_LABEL).toEqual(server.FIELD_LABEL);
    expect(renderer.GESTURE_LABEL).toEqual(server.GESTURE_LABEL);
    for (const k of renderer.FIELD_KEYS) {
      for (const v of [null, "", true, false, "TapTop", "x"]) expect(renderer.showField(k, v)).toBe(server.showField(k, v));
    }
  });
});

describe("editor helpers", () => {
  it("adding a page keeps its own settings and never duplicates", () => {
    const d = renderer.addPage(base(), { pageId: "P3", name: "Safety", mandatory: true, products: [{ id: "X9", name: "Z" }] });
    expect(d.pages.at(-1)).toEqual({ pageId: "P3", name: "Safety", mandatory: true, products: [{ id: "X9", name: "Z" }] });
    expect(renderer.addPage(d, { pageId: "P3", name: "Safety", mandatory: false, products: [] })).toBe(d);
  });

  it("one share per territory", () => {
    const t = { territoryId: "R1", name: "Boston", parentId: null, groupId: "G1", subordinatesGroupId: "G1S" };
    const d = renderer.addShare(base(), renderer.shareFor(t, true)!);
    expect(d.shares).toEqual([{ groupId: "G1S", territoryId: "R1", name: "Boston", subordinates: true }]);
    expect(renderer.shareName(d.shares[0])).toBe("Boston and below");
    expect(renderer.shareFor({ territoryId: "R2", name: "X", parentId: null }, false)).toBeNull();
  });

  it("names its tray row by what changed", () => {
    const to = renderer.setField(renderer.removeShare(base(), "G1"), "status", "Inactive");
    expect(renderer.editLabel("Cordim deck", renderer.changedParts(base(), to))).toBe("Change Cordim deck: status, territories");
  });

  it("checks the name", () => {
    expect(renderer.fieldProblem("name", "  ")).toMatch(/needs a name/);
    expect(renderer.fieldProblem("name", "x".repeat(81))).toMatch(/80/);
    expect(renderer.fieldProblem("name", "Fine")).toBeNull();
  });
});

describe("tray", () => {
  const fix = (to: PresentationDraft, from = base()): EditPresentationFix => ({
    kind: "editPresentation",
    label: "Change Cordim deck",
    presentationId: "0Pr000000000001",
    presentationName: "Cordim deck",
    from,
    to,
  });

  it("one change per presentation, keeping the first from, dropped when it cancels out", () => {
    const one = queueChange([], { fix: fix(renderer.setField(base(), "locked", true)) });
    expect(changeKey(one[0].fix)).toBe("presentation:0Pr000000000001");
    const two = queueChange(one, { fix: fix(renderer.setField(base(), "name", "New"), renderer.setField(base(), "locked", true)) });
    expect(two).toHaveLength(1);
    const queued = pendingFor(two, fix(base()))?.fix as EditPresentationFix;
    expect(queued.from).toEqual(base());
    expect(queueChange([], { fix: fix(base()) })).toEqual([]);
    // Edited back to how the org is: the change goes.
    expect(queueChange(two, { fix: fix(base(), renderer.setField(base(), "name", "New")) })).toEqual([]);
  });

  it("reaches desktop now and iPads on the next sync", () => {
    expect(reachOfChange({ fix: fix(renderer.setField(base(), "locked", true)) })).toMatchObject({ desktop: "now", ipad: "nextSync" });
  });
});
