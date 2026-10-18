import { describe, it, expect } from "vitest";
import { syncOverview, type SyncOverviewDeps } from "../../../src/studio/sync-overview.js";

const ok = (records: Array<Record<string, unknown>>) => ({ success: true as const, data: { records, totalSize: records.length } });
const fail = (error: string) => ({ success: false as const, error });

function deps(opts: { fields?: string[]; telemetry?: Array<Record<string, unknown>>; soqlError?: string }): SyncOverviewDeps {
  return {
    telemetryFields: () => async () => new Set(opts.fields ?? []),
    querier: () =>
      ({
        soql: async (q: string) => {
          if (opts.soqlError) return fail(opts.soqlError);
          if (q.includes("FROM DeviceSyncSummary")) return ok(opts.telemetry ?? []);
          if (q.includes("FROM UserTerritory2Association")) return ok([{ UserId: "005000000000001AAA", cnt: 14 }]);
          if (q.includes("FROM User")) return ok([{ Id: "005000000000001AAA", Username: "slow@x.com", Name: "Sam Slow", Profile: { Name: "Rep" } }]);
          return ok([]);
        },
        tooling: async () => fail("no tooling in test"),
      }) as never,
  };
}

const row = (user: string, end: string, extra: Record<string, unknown> = {}) => ({
  Id: Math.random().toString(36),
  CreatedDate: "2026-10-01T10:00:00.000Z",
  CreatedBy: { Username: user },
  SyncTrigger: "Manual",
  Type: "data",
  CompletionStatus: "Finished",
  DownloadStart: "2026-10-01T10:00:00.000Z",
  DownloadEnd: end,
  SyncEndDate: end,
  ...extra,
});

describe("syncOverview", () => {
  it("returns notes, not an error, when DeviceSyncSummary is missing", async () => {
    const r = await syncOverview("org", { days: 7 }, deps({}));
    expect(r.telemetry).toBeNull();
    expect(r.notes.some((n) => /isn.t available/.test(n))).toBe(true);
    expect(r.days).toBe(7);
  });

  it("says so when the window has no syncs", async () => {
    const r = await syncOverview("org", {}, deps({ fields: ["Id"], telemetry: [] }));
    expect(r.verdict?.status).toBe("no-data");
    expect(r.notes.some((n) => /No syncs/.test(n))).toBe(true);
  });

  it("surfaces a telemetry query failure as a note", async () => {
    const r = await syncOverview("org", {}, deps({ fields: ["Id"], soqlError: "boom" }));
    expect(r.notes.some((n) => n.includes("boom"))).toBe(true);
  });

  it("ranks the slow rep and joins name, profile and territories", async () => {
    const fast = Array.from({ length: 12 }, (_, i) => row(`ok${i % 3}@x.com`, "2026-10-01T10:00:10.000Z"));
    const slow = Array.from({ length: 3 }, () => row("slow@x.com", "2026-10-01T10:01:00.000Z"));
    const r = await syncOverview("org", {}, deps({ fields: Object.keys(row("a", "b")), telemetry: [...fast, ...slow] }));
    expect(r.reps).toBe(4);
    expect(r.usersAtRisk).toHaveLength(1);
    expect(r.usersAtRisk[0]).toMatchObject({ userId: "005000000000001AAA", name: "Sam Slow", profile: "Rep", territories: 14 });
    expect(r.usersAtRisk[0].reasons).toContain("In 14 territories");
    expect(r.daily).toHaveLength(1);
  });
});
