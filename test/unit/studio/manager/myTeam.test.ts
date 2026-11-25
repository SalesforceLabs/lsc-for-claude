import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/salesforce/cli.js", () => ({
  apiRequest: vi.fn(),
  dataPath: vi.fn(async (_org: string, rest: string) => `/services/data/v66.0${rest}`),
}));
const cli = await import("../../../../src/salesforce/cli.js");
const my = await import("../../../../src/studio/screens/manager/myTeam.js");

beforeEach(() => {
  vi.mocked(cli.apiRequest).mockReset();
});

describe("week math", () => {
  it("starts on the configured day and labels like the device", () => {
    // 2026-03-04 is a Wednesday.
    expect(my.myTeamWeek("2026-03-04", "Monday")).toMatchObject({
      start: "2026-03-02",
      label: "Mar 2 - Mar 8, 2026",
    });
    expect(my.myTeamWeek("2026-03-04", "Sunday").start).toBe("2026-03-01");
  });
  it("falls back to Monday when the first day is unknown", () => {
    expect(my.myTeamWeek("2026-03-04", "").start).toBe("2026-03-02");
  });
  it("labels a week across a year end with the closing year", () => {
    expect(my.myTeamWeek("2025-12-31", "Monday").label).toBe("Dec 29 - Jan 4, 2026");
  });
  it("gives the start-of-week epoch at local midnight", () => {
    expect(my.startOfWeekEpoch("2026-03-02", "UTC")).toBe(Date.UTC(2026, 2, 2) / 1000);
    expect(my.startOfWeekEpoch("2026-03-02", "America/Los_Angeles")).toBe(
      Date.UTC(2026, 2, 2, 8) / 1000
    );
  });
  it("titles a day like EEEE, MMMM d, yyyy", () => {
    expect(my.dayTitle(Date.UTC(2026, 2, 2, 12), "UTC")).toBe("Monday, March 2, 2026");
  });
});

describe("activities", () => {
  const base = {
    id: "a1",
    startDate: Date.UTC(2026, 2, 2, 15, 0) / 1000,
    endDate: Date.UTC(2026, 2, 2, 16, 30) / 1000,
    type: "Visit",
  };
  it("names types and appends the subtype", () => {
    expect(my.typeLabel("TerritoryUserDowntime")).toBe("Time Off Territory");
    expect(my.typeLabel("meeting")).toBe("Event");
    expect(my.typeLabel("coaching_event")).toBe("Coaching Event");
    expect(my.typeLabel("Event")).toBe("General Event");
    expect(my.typeLabel("Visit", "Face to Face")).toBe("Visit (Face to Face)");
  });
  it("shows a dash for missing values and a time range in the viewer's zone", () => {
    const a = my.mapActivity(base, "America/Los_Angeles", "en-US");
    expect(a.timeRange).toMatch(/7:00\sAM - 8:30\sAM/);
    expect([a.details, a.status, a.userName, a.address]).toEqual(["-", "-", "-", "-"]);
  });
  it("greys a completed visit without a subtype only", () => {
    expect(my.mapActivity({ ...base, status: "Completed" }, "UTC", "en-US").muted).toBe(true);
    expect(
      my.mapActivity({ ...base, status: "Completed", subtype: "Face to Face" }, "UTC", "en-US")
        .muted
    ).toBe(false);
    expect(my.mapActivity({ ...base, status: "Planned" }, "UTC", "en-US").muted).toBe(false);
  });
  it("keeps the API's days, empty ones included", () => {
    const days = my.mapWeek(
      [
        { dayDate: Date.UTC(2026, 2, 2) / 1000, activities: [] },
        { dayDate: Date.UTC(2026, 2, 3) / 1000, activities: [base] },
      ],
      "UTC",
      "en-US"
    );
    expect(days.map((d) => d.activities.length)).toEqual([0, 1]);
    expect(days[1].title).toBe("Tuesday, March 3, 2026");
  });
  it("labels territories with the rep", () => {
    expect(
      my
        .mapTerritories([
          { territoryId: "T1", territoryName: "US-W", salesRepName: "Evan" },
          { territoryId: "T2", territoryName: "US-E", salesRepName: null },
          {},
        ])
        .map((t) => t.label)
    ).toEqual(["US-W (Evan)", "US-E"]);
  });
});

describe("collectMyTeam", () => {
  const ctx = (over = {}) =>
    ({
      adminOrg: "admin",
      org: "rep",
      userId: "005000000000001AAA",
      format: { timeZone: "UTC", locale: "en-US" },
      config: async () => ({ PlannerAdministration: { FirstDayOfTheWeek: "Sunday" } }),
      note: vi.fn(),
      ...over,
    }) as never;
  it("lists the managed territories", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({
      success: true,
      data: {
        records: [{ territoryId: "0MI000000000001", territoryName: "T", salesRepName: "R" }],
      },
    });
    const out = await my.collectMyTeam(ctx());
    expect(out?.territories[0].label).toBe("T (R)");
    expect(out?.firstDay).toBe("Sunday");
    expect(vi.mocked(cli.apiRequest).mock.calls[0][0]).toContain(
      "/users/005000000000001AAA/managed-territories"
    );
  });
  it("takes the activity colours from the planner settings", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({ success: true, data: { records: [] } });
    const out = await my.collectMyTeam(
      ctx({
        config: async () => ({
          PlannerAdministration: { ColorPlannedCall: "#112233", ColorGeneralEvent: "not a colour" },
        }),
      })
    );
    expect(out?.colors.Visit).toBe("#112233");
    expect(out?.colors.Event).toBe(my.typeColors({}).Event);
  });
  it("says so when the territories can't be read", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({ success: false, error: "NOT_FOUND" });
    const out = await my.collectMyTeam(ctx());
    expect(out?.territories).toEqual([]);
    expect(out?.note).toMatch(/^Not in the preview/);
  });
});

describe("loadMyTeamWeek", () => {
  it("asks for the week's start epoch", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({ success: true, data: { records: [] } });
    const w = await my.loadMyTeamWeek("o", {
      territoryId: "0MIHn0000008qvnOAA",
      date: "2026-03-04",
      firstDay: "Monday",
      timeZone: "UTC",
      locale: "en-US",
    });
    expect(w.days).toEqual([]);
    expect(vi.mocked(cli.apiRequest).mock.calls[0][0]).toContain(
      `/territory/0MIHn0000008qvnOAA/start-of-week/${Date.UTC(2026, 2, 2) / 1000}/weekly-territory-activities`
    );
  });
  it("draws the week in the colours it is given", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({
      success: true,
      data: {
        records: [
          { dayDate: Date.UTC(2026, 2, 2) / 1000, activities: [{ id: "a", type: "Visit" }] },
        ],
      },
    });
    const w = await my.loadMyTeamWeek("o", {
      territoryId: "0MIHn0000008qvnOAA",
      date: "2026-03-04",
      firstDay: "Monday",
      timeZone: "UTC",
      locale: "en-US",
      colors: { Visit: "#112233" },
    });
    expect(w.days[0].activities[0].color).toBe("#112233");
  });
  it("skips the call without a territory", async () => {
    const w = await my.loadMyTeamWeek("o", {
      date: "2026-03-04",
      firstDay: "Monday",
      timeZone: "UTC",
      locale: "en-US",
    });
    expect(w.label).toBe("Mar 2 - Mar 8, 2026");
    expect(cli.apiRequest).not.toHaveBeenCalled();
  });
});
