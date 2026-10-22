import { describe, it, expect } from "vitest";
import { afterApply, afterReview, emptyTray, pendingCount, queueAll, queueInto, stepBack, stepForward, trayKey, trayOf, updateTray, type TrayMap } from "../../../src-renderer/components/studio/tray-state.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";

const change = (id: string, to: boolean | string = false): PendingChange =>
  ({ fix: { kind: "setActive", label: `Change ${id}`, record: { type: "config", category: "UISchema", developerName: id }, from: true, to }, affects: [] }) as unknown as PendingChange;

describe("per-org tray state", () => {
  it("files trays by lowercased username and keeps other orgs' trays", () => {
    let m: TrayMap = {};
    m = queueInto(m, "Rep@Acme.com", [change("a")]);
    m = queueInto(m, "other@acme.com", [change("b"), change("c")]);
    expect(trayKey("Rep@Acme.com")).toBe("rep@acme.com");
    expect(pendingCount(m, "rep@acme.com")).toBe(1);
    expect(pendingCount(m, "OTHER@acme.com")).toBe(2);
    expect(pendingCount(m, "nobody@acme.com")).toBe(0);
  });

  it("merges a newer change to the same setting into the older one", () => {
    const first = change("a", "x");
    const second = change("a", "y");
    const merged = queueAll([first], [second]);
    expect(merged).toHaveLength(1);
    expect((merged[0].fix as unknown as { to: string; from: boolean }).to).toBe("y");
    expect((merged[0].fix as unknown as { from: boolean }).from).toBe(true);
  });

  it("queues several changes as one undoable step", () => {
    let m = queueInto({}, "o", [change("a")]);
    m = queueInto(m, "o", [change("b"), change("c")]);
    expect(pendingCount(m, "o")).toBe(3);
    m = stepBack(m, "o");
    expect(pendingCount(m, "o")).toBe(1);
    m = stepForward(m, "o");
    expect(pendingCount(m, "o")).toBe(3);
  });

  it("leaves the map alone when nothing is queued or changed", () => {
    const m = queueInto({}, "o", [change("a")]);
    expect(queueInto(m, "o", [])).toBe(m);
    expect(updateTray(m, "o", (t) => t)).toBe(m);
    expect(trayOf({}, "o")).toEqual(emptyTray());
  });
});

describe("closing the review dialog", () => {
  it("drops only what was applied, keeping a change queued while the dialog was open", () => {
    const a = change("a");
    const b = change("b");
    const fromChat = change("c");
    let m = queueInto({}, "o", [a, b]);
    m = queueInto(m, "o", [fromChat]);
    const t = afterApply(trayOf(m, "o"), [a]);
    expect(t.history.present).toEqual([b, fromChat]);
    expect(t.history.past).toEqual([]);
  });

  it("keeps a newer change to an applied setting that arrived while reviewing", () => {
    const a = change("a", "x");
    const newer = change("a", "y");
    const t = afterApply({ ...emptyTray(), history: { past: [], present: [newer], future: [] } }, [a]);
    expect(t.history.present).toEqual([newer]);
  });

  it("takes the dialog's word only for what it was given", () => {
    const a = change("a");
    const b = change("b");
    const c = change("c");
    const fromChat = change("d");
    // The dialog was given a, b, c; the user took b out; d arrived meanwhile.
    expect(afterReview([a, b, c, fromChat], [a, b, c], [a, c])).toEqual([a, c, fromChat]);
    // A change replaced meanwhile under the same key is left alone.
    const replaced = change("b", "y");
    expect(afterReview([a, replaced, c], [a, b, c], [a, c])).toEqual([a, replaced, c]);
  });

  it("never mixes orgs: changes queued for A stay out of B's tray and B's apply", () => {
    const own = change("b1");
    const fromChat = change("a1");
    let m = queueInto({}, "b@acme.com", [own]);
    m = queueInto(m, "A@acme.com", [fromChat]);
    expect(trayOf(m, "b@acme.com").history.present).toEqual([own]);
    m = updateTray(m, "b@acme.com", (t) => afterApply(t, [own]));
    expect(pendingCount(m, "b@acme.com")).toBe(0);
    expect(trayOf(m, "a@acme.com").history.present).toEqual([fromChat]);
  });

  it("returns the same array when nothing changed", () => {
    const list = [change("a"), change("b")];
    expect(afterReview(list, list, list)).toBe(list);
  });
});
