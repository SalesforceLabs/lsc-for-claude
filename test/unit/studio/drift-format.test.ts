import { describe, expect, it } from "vitest";
import { batchRecent, batchType, recentType, splitRecentErrors } from "../../../src-renderer/components/studio/drift-format";
import type { RecentChange } from "../../../src-renderer/components/studio/drift-types";

const change = (name: string, at: string, by = "Admin2 User", detail = "DbSchema"): RecentChange => ({
  kind: "config",
  name,
  detail,
  featureId: "mobile-sync",
  featureTitle: "Mobile Sync",
  modifiedAt: at,
  modifiedBy: by,
});

describe("recent changes rows", () => {
  it("folds five or more changes by one person in one minute into a batch", () => {
    const run = Array.from({ length: 6 }, (_, i) => change(`DbSchema_${i}`, `2026-10-19T17:49:${String(10 + i).padStart(2, "0")}.000+0000`));
    const rows = batchRecent([change("Earlier", "2026-10-19T18:02:00.000+0000"), ...run, change("Later", "2026-10-19T16:00:00.000+0000")]);
    expect(rows.map((r) => r.kind)).toEqual(["one", "batch", "one"]);
    expect(rows[1].kind === "batch" && rows[1].changes).toHaveLength(6);
  });

  it("keeps short runs and different people as separate rows", () => {
    const at = "2026-10-19T17:49:00.000+0000";
    const rows = batchRecent([change("A", at), change("B", at), change("C", at, "Someone Else"), change("D", at), change("E", at)]);
    expect(rows.every((r) => r.kind === "one")).toBe(true);
  });

  it("names Admin Console categories, and says how many kinds a mixed batch has", () => {
    expect(recentType(change("X", "2026-10-19T17:49:00Z"))).toBe("DB Schema");
    expect(recentType(change("X", "2026-10-19T17:49:00Z", "A", "MobileSettings"))).toBe("Mobile Settings");
    expect(batchType([change("X", "t"), change("Y", "t", "A", "QuickAction")])).toBe("2 kinds");
  });

  it("keeps a capped list apart from sources that failed", () => {
    const out = splitRecentErrors(
      ["Flows: insufficient access", "Admin Console setting values: more changed in the last 14 days than are listed (newest shown) — pick a shorter period"],
      ["Admin Console setting values"]
    );
    expect(out).toEqual({ failed: ["Flows: insufficient access"], limited: ["Admin Console setting values"] });
  });
});
