import { describe, expect, it } from "vitest";
import * as renderer from "../../../../src-renderer/components/studio/content/content-logic.js";
import { changeKey, queueChange } from "../../../../src-renderer/components/studio/changes.js";
import { reachOfChange } from "../../../../src-renderer/components/studio/reach.js";
import type { ContentDraft } from "../../../../src-renderer/components/studio/content/content-types.js";

const draft = (id: string, over: Partial<ContentDraft> = {}): ContentDraft => ({
  id,
  org: "admin@x.com",
  name: `Page ${id}`,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  files: [],
  checks: [],
  revision: 0,
  turns: [],
  ...over,
});

describe("new presentations", () => {
  it("starts inactive and empty", () => {
    const d = renderer.blankPresentation("Launch deck");
    expect(d.fields.status).toBe("Inactive");
    expect(d.pages).toEqual([]);
    expect(d.shares).toEqual([]);
    expect(renderer.holdsDraftedPages(d)).toBe(false);
  });

  it("builds the tray change with the drafted pages and their current names", () => {
    const d = renderer.blankPresentation("Launch deck");
    d.pages = [
      { pageId: "0Xx000000000001", name: "Approved intro", mandatory: true, products: [] },
      renderer.draftedPage({ id: "abc", name: "Old name" }),
    ];
    const fix = renderer.newPresentationFix("k1", d, [{ id: "abc", name: "Dosing" }]);
    expect(fix.kind).toBe("createPresentation");
    expect(fix.label).toBe("Create Launch deck");
    expect(fix.newPages).toEqual([{ pageId: "new:abc", draftId: "abc", name: "Dosing" }]);
    expect(fix.draft.pages[1].name).toBe("Dosing");
    expect(renderer.holdsDraftedPages(fix.draft)).toBe(true);
    expect(changeKey(fix)).toBe("presentation-new:k1");
    expect(reachOfChange({ fix }).desktop).toBe("now");
  });

  it("drops a drafted page from the upload when it leaves the presentation", () => {
    let d = renderer.blankPresentation("");
    d = renderer.addPage(d, renderer.draftedPage({ id: "abc", name: "Dosing" }));
    d = renderer.removePage(d, "new:abc");
    const fix = renderer.newPresentationFix("k1", d, []);
    expect(fix.newPages).toEqual([]);
    expect(fix.label).toBe("Create New presentation");
  });

  it("replaces an older version of the same new presentation in the tray", () => {
    const a = renderer.newPresentationFix("k1", renderer.blankPresentation("A"), []);
    const b = renderer.newPresentationFix("k1", renderer.blankPresentation("B"), []);
    const tray = queueChange(queueChange([], { fix: a }), { fix: b });
    expect(tray).toHaveLength(1);
    expect(tray[0].fix.label).toBe("Create B");
  });
});

describe("draft events", () => {
  const turn = {
    id: "t1",
    prompt: "Make it",
    at: "x",
    status: "running" as const,
    reply: "",
    steps: [],
  };

  it("ignores events for a draft not in the list yet, then takes its snapshot", () => {
    let list: ContentDraft[] = [];
    list = renderer.applyDraftEvent(list, "a", { type: "turn", turn });
    expect(list).toEqual([]);
    list = renderer.applyDraftEvent(list, "a", {
      type: "draft",
      draft: draft("a", { turns: [turn] }),
    });
    expect(list.map((d) => d.id)).toEqual(["a"]);
    expect(renderer.draftRunning(list[0])).toBe(true);
  });

  it("folds steps and reply text into the turn", () => {
    let list = [draft("a", { turns: [turn] })];
    const step = { id: "s1", label: "Writing slides", status: "running" as const };
    list = renderer.applyDraftEvent(list, "a", { type: "step", turnId: "t1", step });
    list = renderer.applyDraftEvent(list, "a", {
      type: "step",
      turnId: "t1",
      step: { ...step, status: "done" },
    });
    list = renderer.applyDraftEvent(list, "a", {
      type: "reply-delta",
      turnId: "t1",
      text: "Here ",
    });
    list = renderer.applyDraftEvent(list, "a", {
      type: "reply-delta",
      turnId: "t1",
      text: "it is.",
    });
    list = renderer.applyDraftEvent(list, "a", {
      type: "writing",
      turnId: "t1",
      path: "01.html",
      chars: 5,
    });
    const t = list[0].turns[0];
    expect(t.steps).toEqual([{ ...step, status: "done" }]);
    expect(t.reply).toBe("Here it is.");
    list = renderer.applyDraftEvent(list, "a", { type: "turn", turn: { ...t, status: "done" } });
    expect(renderer.draftRunning(list[0])).toBe(false);
  });

  it("keeps the newest draft first", () => {
    let list = [draft("a", { updatedAt: "2026-11-02T00:00:00.000Z" }), draft("b")];
    list = renderer.applyDraftEvent(list, "b", {
      type: "draft",
      draft: draft("b", { updatedAt: "2026-11-03T00:00:00.000Z" }),
    });
    expect(list.map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("counts slides by their html files", () => {
    expect(
      renderer.slideCount({
        files: [
          { path: "01_a.html", content: "" },
          { path: "02_b.html", content: "" },
          { path: "css/style.css", content: "" },
        ],
      })
    ).toBe(2);
  });

  it("labels pages named only by their number with their presentation", () => {
    expect(renderer.pageLabel({ name: "2", presentations: ["Cordim: Dosing"] })).toBe(
      "Cordim: Dosing — page 2"
    );
    expect(renderer.pageLabel({ name: "2", presentations: ["A", "B"] })).toBe("2");
    expect(renderer.pageLabel({ name: "Dosing", presentations: ["A"] })).toBe("Dosing");
    expect(renderer.pageLabel({ name: " ", presentations: [] })).toBe("Untitled page");
    expect(renderer.slidesLabel(1)).toBe("1 slide");
    expect(renderer.slidesLabel(3)).toBe("3 slides");
  });
});
