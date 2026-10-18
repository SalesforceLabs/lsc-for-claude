import { describe, it, expect } from "vitest";
import {
  changeKey,
  commitFrom,
  copiesFirst,
  isMobileChange,
  queueChange,
  queuedCopy,
  viewFor,
  type PendingChange,
} from "../../../src-renderer/components/studio/changes.js";
import { emptyHistory, record, redo, undo } from "../../../src-renderer/components/studio/tray-history.js";
import * as renderer from "../../../src-renderer/components/studio/copy-names.js";
import * as server from "../../../src/studio/metadata/copy.js";
import type { StudioFix } from "../../../src-renderer/components/studio/types.js";

const LAYOUT = "Account-HCP Layout";
const doc = { type: "Layout" as const, fullName: LAYOUT, label: "HCP Layout" };
const op = (relatedList: string) => ({ op: "removeRelatedList" as const, relatedList });
const edit = (...lists: string[]): PendingChange => ({
  fix: { kind: "editMetadata", label: "Edit HCP Layout", doc, ops: lists.map(op) } as StudioFix,
});
const copy = (profile: string, ...lists: string[]): PendingChange => ({
  fix: {
    kind: "copyForProfile",
    label: `Make a copy of HCP Layout just for ${profile}`,
    doc,
    copy: { fullName: `${LAYOUT} - ${profile}`, label: `HCP Layout - ${profile}` },
    profile,
    ...(lists.length ? { ops: lists.map(op) } : {}),
  } as StudioFix,
  affects: [profile],
});
const other = (id: string): PendingChange =>
  ({ fix: { kind: "setActive", label: id, record: { type: "config", category: "UISchema", developerName: id }, to: false }, affects: [] }) as unknown as PendingChange;
const opsOf = (p: PendingChange | undefined) => (p?.fix as { ops?: { relatedList: string }[] } | undefined)?.ops?.map((o) => o.relatedList);

describe("copy names", () => {
  it("are the same in the renderer as on the server", () => {
    for (const [layout, profile] of [
      [LAYOUT, "LS Rep"],
      ["PersonAccount-Person%20Account%20Layout", "System Administrator"],
      ["Account-" + "Long%20Name%28x%29".repeat(8), "LS: Rep/Field"],
    ]) {
      expect(renderer.layoutCopyName(layout, profile)).toEqual(server.layoutCopyName(layout, profile));
    }
    for (const [page, profile, label] of [
      ["Account__LSC_Page", "LS Rep (Field)", "Account HCP page"],
      ["A".repeat(78), "LS Rep", "x"],
      ["Home_Page", "Rep", "L".repeat(120)],
    ]) {
      expect(renderer.flexiPageCopyName(page, profile, label)).toEqual(server.flexiPageCopyName(page, profile, label));
    }
  });
});

describe("a copy in the tray", () => {
  it("is keyed by document and profile, and is a mobile change", () => {
    expect(changeKey(copy("LS Rep").fix)).toBe(`copy:Layout:${LAYOUT}:ls rep`);
    expect(changeKey(copy("LS Rep").fix)).not.toBe(changeKey(copy("LS Phone").fix));
    expect(isMobileChange(copy("LS Rep").fix)).toBe(true);
    // Queuing it twice leaves one.
    expect(queueChange(queueChange([], copy("LS Rep")), copy("LS Rep"))).toHaveLength(1);
    expect(queuedCopy([copy("LS Rep")], doc, "ls rep")).toBeDefined();
    expect(queuedCopy([copy("LS Rep")], doc, "LS Phone")).toBeUndefined();
  });
});

describe("the profile's view of the tray", () => {
  it("is the tray itself when the profile has no copy", () => {
    const tray = [edit("A"), copy("LS Phone", "B")];
    expect(viewFor(tray, "LS Rep")).toBe(tray);
    expect(viewFor(tray, null)).toBe(tray);
  });

  it("swaps the shared document's edits for the copy's, for the copy's profile only", () => {
    const tray = [other("x"), edit("A"), copy("LS Rep", "B")];
    const view = viewFor(tray, "LS Rep");
    expect(view.map((p) => p.fix.kind)).toEqual(["setActive", "editMetadata", "copyForProfile"]);
    expect(opsOf(view[1])).toEqual(["B"]);
    // Another profile still sees, and edits, the shared document.
    expect(opsOf(viewFor(tray, "LS Phone").find((p) => p.fix.kind === "editMetadata"))).toEqual(["A"]);
  });

  it("adds the copy's edits when nothing was queued for the shared document, and none when the copy has no edits", () => {
    expect(opsOf(viewFor([copy("LS Rep", "B")], "LS Rep")[1])).toEqual(["B"]);
    expect(viewFor([edit("A"), copy("LS Rep")], "LS Rep").map((p) => p.fix.kind)).toEqual(["copyForProfile"]);
  });

  it("sends the copy's edits back into the copy, leaving the shared document's edit as it was", () => {
    const tray = [edit("A"), copy("LS Rep", "B")];
    // The draft replaces the edit of the document the way queueChange does.
    const next = queueChange(viewFor(tray, "LS Rep"), edit("B", "C"));
    const back = commitFrom(tray, "LS Rep", next);
    expect(back).toHaveLength(2);
    expect(opsOf(back.find((p) => p.fix.kind === "editMetadata"))).toEqual(["A"]);
    expect(opsOf(back.find((p) => p.fix.kind === "copyForProfile"))).toEqual(["B", "C"]);
    // Nothing changed in the view: nothing changes in the tray, in the same order.
    const ordered = [other("x"), copy("LS Rep", "B"), edit("A")];
    expect(commitFrom(ordered, "LS Rep", viewFor(ordered, "LS Rep"))).toEqual(ordered);
  });

  it("keeps edits made while the copy has none out of the shared document", () => {
    const tray = [copy("LS Rep")];
    const next = queueChange(viewFor(tray, "LS Rep"), edit("C"));
    const back = commitFrom(tray, "LS Rep", next);
    expect(back.map((p) => p.fix.kind)).toEqual(["copyForProfile"]);
    expect(opsOf(back[0])).toEqual(["C"]);
  });

  it("drops the copy's edits when the last of them is undone", () => {
    const tray = [copy("LS Rep", "B")];
    const back = commitFrom(tray, "LS Rep", viewFor(tray, "LS Rep").filter((p) => p.fix.kind !== "editMetadata"));
    expect((back[0].fix as { ops?: unknown }).ops).toBeUndefined();
  });

  it("puts the shared edits back when the copy is taken out of the tray", () => {
    const tray = [edit("A"), copy("LS Rep", "B")];
    const view = viewFor(tray, "LS Rep");
    const back = commitFrom(tray, "LS Rep", view.filter((p) => p.fix.kind !== "copyForProfile"));
    expect(back.map((p) => p.fix.kind)).toEqual(["editMetadata"]);
    expect(opsOf(back[0])).toEqual(["A"]);
    // A copy with edits and nothing queued for the shared document: taking it out leaves nothing.
    expect(commitFrom([copy("LS Rep", "B")], "LS Rep", [])).toEqual([]);
  });

  it("queues a new copy beside the shared edits and ahead of them", () => {
    const tray = [edit("A")];
    const next = queueChange(viewFor(tray, "LS Rep"), copy("LS Rep", "A"));
    const back = commitFrom(tray, "LS Rep", next);
    expect(back.map((p) => p.fix.kind)).toEqual(["copyForProfile", "editMetadata"]);
    expect(opsOf(back[0])).toEqual(["A"]);
    expect(opsOf(back[1])).toEqual(["A"]);
  });

  it("leaves another profile's edits to the shared document in the shared edit", () => {
    const tray = [copy("LS Rep", "B")];
    const next = queueChange(viewFor(tray, "LS Phone"), edit("Z"));
    const back = commitFrom(tray, "LS Phone", next);
    expect(back.map((p) => p.fix.kind)).toEqual(["copyForProfile", "editMetadata"]);
    expect(opsOf(back[0])).toEqual(["B"]);
    expect(opsOf(back[1])).toEqual(["Z"]);
  });

  it("orders a copy ahead of edits to its document, and leaves a tray already in order alone", () => {
    const late = [edit("A"), other("x"), copy("LS Rep")];
    expect(copiesFirst(late).map((p) => p.fix.kind)).toEqual(["copyForProfile", "editMetadata", "setActive"]);
    const fine = [copy("LS Rep"), edit("A")];
    expect(copiesFirst(fine)).toBe(fine);
  });

  it("undoes and redoes queuing and taking out the copy", () => {
    const tray = [edit("A")];
    const queued = commitFrom(tray, "LS Rep", queueChange(viewFor(tray, "LS Rep"), copy("LS Rep", "A")));
    const out = commitFrom(queued, "LS Rep", viewFor(queued, "LS Rep").filter((p) => p.fix.kind !== "copyForProfile"));
    let h = record(record(emptyHistory(tray), queued), out);
    expect(h.present.map((p) => p.fix.kind)).toEqual(["editMetadata"]);
    h = undo(h);
    expect(h.present).toBe(queued);
    h = undo(h);
    expect(h.present).toBe(tray);
    h = redo(h);
    expect(h.present).toBe(queued);
  });
});
