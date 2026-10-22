import { describe, expect, it } from "vitest";
import { reachFor, whatHappensNext } from "../../../src-renderer/components/studio/what-next";
import { withoutUndone } from "../../../src-renderer/components/studio/source-control";
import type { PendingChange } from "../../../src-renderer/components/studio/changes";
import type { StudioFix } from "../../../src-renderer/components/studio/types";

const fix = (fields: Record<string, unknown>) => ({ label: "x", ...fields }) as unknown as StudioFix;
const change = (f: Record<string, unknown>, affects?: string[]): PendingChange => ({ fix: fix(f), ...(affects ? { affects } : {}) });
const layout = change({ kind: "editMetadata", doc: { type: "Layout", fullName: "A", label: "A" } }, ["Rep"]);
const listView = change({ kind: "editMetadata", doc: { type: "ListView", fullName: "Account.Mine", label: "Mine" } });
const psl = change({ kind: "assignPsl" });

describe("whatHappensNext as an undo", () => {
  it("words the lines as a restore, never as getting changes", () => {
    const reaches = [reachFor(layout), reachFor(layout), reachFor(listView), reachFor(psl)];
    const lines = whatHappensNext(reaches, { undo: true }).map((l) => l.text);
    expect(lines).toEqual([
      "Desktop users see it restored at once",
      "Publish to put iPads back in step with the org (Rep); if the change was never published, iPads aren't affected",
      "The list view is restored on iPads right away",
      "Reps get it restored on their next sync",
    ]);
    expect(lines.join(" ")).not.toMatch(/iPads get/);
  });

  it("uses the past tense once done", () => {
    expect(whatHappensNext([reachFor(layout)], { undo: true, done: true })[0].text).toBe("Desktop users see it restored now");
  });
});

describe("withoutUndone", () => {
  const edit = (name: string) => fix({ kind: "editMetadata", doc: { type: "Layout", fullName: name, label: name } });
  it("drops documents an undo restored and keeps the rest", () => {
    const applied = [edit("A"), edit("B")];
    expect(withoutUndone(applied, [edit("A")])).toEqual([applied[1]]);
    expect(withoutUndone(applied, [edit("A"), edit("B")])).toEqual([]);
    expect(withoutUndone(applied, [])).toEqual(applied);
  });

  it("drops a document that was changed twice and then restored", () => {
    expect(withoutUndone([edit("A"), edit("A")], [edit("A")])).toEqual([]);
  });
});
