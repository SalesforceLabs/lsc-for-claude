import { describe, it, expect } from "vitest";
import { describeStep, emptyHistory, HISTORY_LIMIT, record, redo, undo } from "../../../src-renderer/components/studio/tray-history.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";

const change = (id: string, label = `Change ${id}`): PendingChange =>
  ({ fix: { kind: "setActive", label, record: { type: "config", category: "UISchema", developerName: id }, to: false }, affects: [] }) as unknown as PendingChange;

describe("tray history", () => {
  it("undoes and redoes every step, and a new step clears redo", () => {
    const a = [change("a")];
    const ab = [...a, change("b")];
    let h = record(record(emptyHistory(), a), ab);
    h = undo(h);
    expect(h.present).toBe(a);
    h = undo(h);
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe(a);
    const ac = [...a, change("c")];
    h = record(h, ac);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
    expect(undo(h).present).toBe(a);
  });

  it("ignores a step that didn't change the tray and keeps at most HISTORY_LIMIT", () => {
    const a = [change("a")];
    const h = record(emptyHistory(), a);
    expect(record(h, a)).toBe(h);
    let long = emptyHistory();
    for (let i = 0; i <= HISTORY_LIMIT + 5; i++) long = record(long, [change(String(i))]);
    expect(long.past).toHaveLength(HISTORY_LIMIT);
  });

  it("says what a step does", () => {
    const a = change("a", "Turn off Tab A");
    const b = change("b", "Hide Tab B");
    expect(describeStep([], [a])).toBe("Turn off Tab A");
    expect(describeStep([a], [a, b])).toBe("Hide Tab B");
    expect(describeStep([], [a, b])).toBe("2 changes");
    expect(describeStep([a], [])).toBe("Take “Turn off Tab A” out of the tray");
    expect(describeStep([a, b], [])).toBe("Take 2 changes out of the tray");
    // A layout's change replaced by its next arrangement is that change.
    const a2 = change("a", "Edit layout");
    expect(describeStep([a], [a2])).toBe("Edit layout");
  });
});
