import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  apiRequest: vi.fn(),
  dataPath: vi.fn(async (_org: string, p: string) => p),
}));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const cli = await import("../../../../src/salesforce/cli.js");
const collect = await import("../../../../src/config/collect.js");
const { collectVisitChecks } = await import("../../../../src/studio/screens/visit/checks.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;
let failing: string[];
const from = (q: string) => /FROM\s+(\w+)/i.exec(q)?.[1] ?? "";
const seen = () => [
  ...vi.mocked(cli.runSoqlQuery).mock.calls.map((c) => String(c[0])),
  ...vi.mocked(cli.runToolingQuery).mock.calls.map((c) => String(c[0])),
];

const RULE = JSON.stringify({
  template: {
    name: "T1",
    blockType: "Warning",
    operations: [{ operation: "RULE", rule: "A" }],
  },
  products: {
    "01t000000000001": {
      rules: {
        A: {
          strategy: "SKU",
          remaining: 4,
          quota: 8,
          calculation: "SamplesInPeriod",
          starts: "2026-01-01",
          period: { type: "Month", params: { offset: 0 } },
        },
        Z: { calculation: "Unknown" },
      },
      info: { firstDropDate: "2026-02-01" },
    },
  },
});

const ctx = (scope: (t: string) => string | null | undefined = () => "") => {
  const notes: string[] = [];
  return {
    notes,
    ctx: {
      userId: "005000000000001",
      org: "rep",
      adminOrg: "admin",
      source: "rep",
      territories: [],
      format: { timeZone: "UTC", locale: "en-US" },
      core: {} as never,
      scope,
      config: async () => ({
        ProviderVisitSettings: {
          ValidateSampleInventory: true,
          ValidateSampleLimits: true,
          SampleInventoryValidationMode: "Warning",
        },
        TimeOffTerritorySettings: { RulesValidationEnabled: true, SetName: "Default" },
      }),
      note: (m: string) => notes.push(m),
    } as never,
  };
};

beforeEach(() => {
  org = {};
  failing = [];
  const answer = ((q: string) => {
    if (failing.includes(from(q)))
      return Promise.reject(new Error("QUERY_TIMEOUT: took longer than 30s"));
    const rows = org[from(q)] ?? [];
    return Promise.resolve({
      success: true,
      data: { totalSize: rows.length, done: true, records: rows },
    });
  }) as never;
  vi.mocked(cli.runSoqlQuery).mockReset().mockImplementation(answer);
  vi.mocked(cli.runToolingQuery).mockReset().mockImplementation(answer);
  vi.mocked(cli.apiRequest)
    .mockReset()
    .mockResolvedValue({ success: true, data: { fields: [] } } as never);
  vi.mocked(collect.collectCategoryRecords)
    .mockReset()
    .mockResolvedValue([
      {
        category: "TimeOffTerritoryRule",
        isActive: true,
        fields: {
          RuleSet: "Default",
          TimeOffTerritoryType: "Vacation",
          Visit: "Not Allowed",
          IsParent: false,
        },
      },
      {
        category: "TimeOffTerritoryRule",
        isActive: false,
        fields: {
          RuleSet: "Default",
          TimeOffTerritoryType: "Sick",
          Visit: "Not Allowed",
          IsParent: false,
        },
      },
      { category: "TimeOffTerritoryDynamicRule", isActive: true, fields: {} },
    ] as never);
});

describe("collectVisitChecks: samples and time off territory", () => {
  it("reads the sample limits, the last inventory count, the rep's time off and the rules", async () => {
    org.ProviderSampleLimit = [
      {
        AccountId: "001000000000001",
        ProductId: "01t000000000001",
        PrvdSampleLmtTemplateName: "T1",
        Rule: RULE,
      },
      { AccountId: "001000000000002", ProductId: "01t000000000001", Rule: "not json" },
    ];
    org.InventoryCountAssessment = [{ ActualStartDateTime: "2026-10-01T10:00:00Z" }];
    org.TerritoryUserDowntime = [
      {
        StartDate: "2026-11-03T00:00:00Z",
        EndDate: "2026-11-04T00:00:00Z",
        DownTimeType: "Vacation",
      },
    ];
    org.LifeScienceTriggerHandler = [{ IsActive: true }];
    const { ctx: c } = ctx();
    const out = await collectVisitChecks(c);
    const sample = out!.sample!;
    expect(sample).toMatchObject({
      inventoryOn: true,
      inventoryMode: "warning",
      limitsOn: true,
      inventoryCountRead: true,
      lastInventoryAt: "2026-10-01T10:00:00Z",
    });
    expect(sample.limits).toHaveLength(1);
    expect(sample.limits[0]).toMatchObject({ template: "T1", blockType: "Warning" });
    expect(sample.limits[0].products["01t000000000001"].rules).toEqual({
      A: expect.objectContaining({
        calculation: "SamplesInPeriod",
        remaining: 4,
        quota: 8,
        strategy: "SKU",
      }),
    });
    expect(out!.tot).toMatchObject({
      on: true,
      rulesEnabled: true,
      setName: "Default",
      dynamicRules: true,
      events: [{ type: "Vacation" }],
    });
    expect(out!.tot!.rules).toEqual([
      { ruleSet: "Default", type: "Vacation", visit: "Not Allowed", isParent: false },
    ]);
  });

  it("puts a LIMIT on every query", async () => {
    const { ctx: c } = ctx();
    await collectVisitChecks(c);
    const soql = seen();
    expect(soql.length).toBeGreaterThan(5);
    for (const q of soql) expect(q, q).toMatch(/\bLIMIT \d+/i);
    const limit = soql.find((q) => /FROM ProviderSampleLimit/.test(q))!;
    expect(limit).toMatch(/LIMIT 501/);
    expect(soql.find((q) => /FROM TerritoryUserDowntime/.test(q))).toMatch(
      /UserId = '005000000000001'/
    );
  });

  it("fails soft: a read that errors leaves its part out and the rest intact", async () => {
    failing = ["ProviderSampleLimit", "TerritoryUserDowntime", "InventoryCountAssessment"];
    const { ctx: c, notes } = ctx();
    const out = await collectVisitChecks(c);
    expect(out!.sample!.limits).toEqual([]);
    expect(out!.sample!.limitsUnavailable).toBeTruthy();
    expect(out!.sample!.inventoryCountRead).toBe(false);
    expect(out!.tot!.unavailable).toBeTruthy();
    expect(out!.tot!.rules).toHaveLength(1);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("says why when the device doesn't sync the objects, and reads nothing for them", async () => {
    const { ctx: c } = ctx((t) =>
      t === "ProviderSampleLimit" || t === "TerritoryUserDowntime" ? undefined : ""
    );
    const out = await collectVisitChecks(c);
    expect(out!.sample!.limitsUnavailable).toMatch(/doesn't sync/);
    expect(out!.tot!.unavailable).toMatch(/doesn't sync/);
    expect(seen().some((q) => /FROM (ProviderSampleLimit|TerritoryUserDowntime)/.test(q))).toBe(
      false
    );
  });
});

describe("renderer types", () => {
  it("equal the server's", () => {
    const strip = (src: string) =>
      [...src.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)]
        .map(([, name, body]) => name + body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, ""))
        .sort();
    const server = readFileSync("src/studio/screens/visit/checks.ts", "utf8");
    const renderer = readFileSync("src-renderer/components/studio/visit/checks/types.ts", "utf8");
    expect(strip(renderer)).toEqual(strip(server));
    expect(strip(renderer).length).toBeGreaterThanOrEqual(5);
  });
});
