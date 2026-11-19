import { describe, expect, it } from "vitest";
import {
  applyCreatePresentation,
  previewCreatePresentation,
} from "../../../../src/studio/content/create.js";
import type {
  CreatePresentationFix,
  PresentationDraft,
} from "../../../../src/studio/content/types.js";

const draft = (over: Partial<PresentationDraft> = {}): PresentationDraft => ({
  fields: {
    name: "Launch deck",
    status: "Inactive",
    activationDate: null,
    deactivationDate: null,
    gesture: null,
    pinchZoom: true,
    doubleTapZoom: true,
    canEmail: false,
    locked: false,
  },
  pages: [{ pageId: "new:abc", name: "Dosing", mandatory: false, products: [] }],
  topics: [],
  shares: [],
  ...over,
});

const fix = (
  d: PresentationDraft,
  newPages = [{ pageId: "new:abc", draftId: "abc", name: "Dosing" }]
): CreatePresentationFix => ({
  kind: "createPresentation",
  label: "Create Launch deck",
  key: "k",
  draft: d,
  newPages,
});

// These guards answer before anything is read from the org.
describe("creating a presentation", () => {
  it("needs a page", async () => {
    expect((await previewCreatePresentation(fix(draft({ pages: [] }), []), "org")).blocked).toBe(
      "Add at least one page."
    );
  });

  it("refuses a page that is neither in the org nor drafted", async () => {
    const p = await previewCreatePresentation(fix(draft(), []), "org");
    expect(p.blocked).toMatch(/isn't a page in the org or one Roz drafted/);
    const bad = draft({
      pages: [{ pageId: "not-an-id", name: "X", mandatory: false, products: [] }],
    });
    expect((await previewCreatePresentation(fix(bad, []), "org")).blocked).toBe(
      "A page isn't a page Id."
    );
  });

  it("keeps drafted pages inactive and undistributed", async () => {
    const active = draft();
    active.fields.status = "Active";
    expect((await previewCreatePresentation(fix(active), "org")).blocked).toMatch(/saved inactive/);
    const shared = draft({
      shares: [{ groupId: "00G000000000001", name: "West", subordinates: false }],
    });
    expect((await previewCreatePresentation(fix(shared), "org")).blocked).toMatch(
      /Take the territories off/
    );
    const r = await applyCreatePresentation(fix(shared), "org");
    expect(r.ok).toBe(false);
  });
});
