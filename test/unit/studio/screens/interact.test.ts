import { describe, expect, it } from "vitest";
import { zonedNow, accountsLabel } from "../../../../src-renderer/components/studio/screens/calendar-logic";
import { selectAllLabel, selectionLabel, toggleId } from "../../../../src-renderer/components/studio/screens/accounts-logic";

describe("interact logic", () => {
  it("reads wall-clock time in a zone", () => {
    const at = new Date("2026-01-15T17:30:00Z");
    expect(zonedNow("America/New_York", at)).toEqual({ date: "2026-01-15", minutes: 12 * 60 + 30 });
    expect(zonedNow("Asia/Tokyo", at)).toEqual({ date: "2026-01-16", minutes: 2 * 60 + 30 });
    expect(zonedNow("Not/AZone", at)).toBeUndefined();
  });
  it("labels accounts", () => {
    expect(accountsLabel(1)).toBe("1 Account");
    expect(accountsLabel(3)).toBe("3 Accounts");
  });
  it("tracks multi-select", () => {
    const s = toggleId(new Set(), "a");
    expect([...s]).toEqual(["a"]);
    expect(toggleId(s, "a").size).toBe(0);
    expect(selectionLabel(0)).toBe("");
    expect(selectionLabel(2)).toBe("2 Selected");
    expect(selectAllLabel(3, 3)).toBe("Unselect All");
    expect(selectAllLabel(1, 3)).toBe("Select All");
  });
});
