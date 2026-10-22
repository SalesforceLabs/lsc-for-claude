import { describe, expect, it } from "vitest";
import { updatedAgo } from "../../../src-renderer/components/ui/updated-ago.js";

describe("updatedAgo", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const before = (ms: number) => new Date(now - ms).toISOString();

  it("says how old an answer is in minutes, then hours, then the date", () => {
    expect(updatedAgo(before(20_000), now)).toBe("Updated just now");
    expect(updatedAgo(before(12 * 60_000), now)).toBe("Updated 12 min ago");
    expect(updatedAgo(before(3 * 3_600_000 + 5 * 60_000), now)).toBe("Updated 3 h ago");
    expect(updatedAgo(before(3 * 86_400_000), now)).toMatch(/^Updated on /);
  });

  it("is empty for a missing or unreadable time", () => {
    expect(updatedAgo("garbage", now)).toBe("");
  });
});
