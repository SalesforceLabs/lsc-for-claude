import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn() }));

const { runSoqlQuery } = await import("../../../../src/salesforce/cli.js");
const { collectVisitSections, readSettings, mergePermissions, addressKey } =
  await import("../../../../src/studio/screens/visit/sections.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;
const from = (q: string) => /FROM\s+(\w+)/i.exec(q)?.[1] ?? "";
const seen = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

const ctx = (scope: (t: string) => string | null | undefined = () => "") => {
  const notes: string[] = [];
  return {
    notes,
    ctx: {
      userId: "005USER",
      org: "rep",
      adminOrg: "admin",
      source: "rep",
      territories: [],
      format: { timeZone: "UTC", locale: "en-US" },
      core: {} as never,
      scope,
      config: async () => ({
        ProviderVisitSettings: {
          ShowRecentSidebar: true,
          HCOTypesForSamplesAndItems: "Hospital;Clinic",
          RequireBatchNumber: true,
        },
      }),
      note: (m: string) => notes.push(m),
    } as never,
  };
};

beforeEach(() => {
  org = {};
  vi.mocked(runSoqlQuery).mockReset();
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
    const rows = org[from(q)] ?? [];
    return Promise.resolve({
      success: true,
      data: { totalSize: rows.length, done: true, records: rows },
    });
  }) as never);
});

describe("collectVisitSections", () => {
  it("reads settings, permissions, products, inventory, attendees and an edited visit's rows", async () => {
    org.ObjectPermissions = [
      { SobjectType: "ProductDisbursement", PermissionsCreate: true, PermissionsEdit: false },
      { SobjectType: "ProductDisbursement", PermissionsCreate: false, PermissionsEdit: true },
    ];
    org.LifeSciMarketableProduct = [
      {
        Id: "m1",
        ProductId: "p1",
        Product: { Name: "Cardio" },
        SignatureRequirementLevel: "Required",
        DefaultDistributionQuantity: 2,
      },
    ];
    org.ProductItem = [{ Id: "i1", Product2Id: "p1", QuantityOnHand: 9 }];
    org.ProductBatchItem = [{ Id: "b1", ProductItemId: "i1", Lot: "L1" }];
    org.Account = [
      {
        Id: "a1",
        Name: "Ann",
        IsPersonAccount: true,
        BillingCity: "Austin",
        BillingPostalCode: "73301",
      },
    ];
    org.Visit = [{ Id: "v1", ParentVisitId: null }];
    org.ProviderVisitProdDetailing = [{ Id: "d1", ProviderVisitId: "v1", ProductId: "p1" }];
    const { ctx: c } = ctx();
    const s = await collectVisitSections(c);
    expect(s?.settings).toMatchObject({
      showRecentSidebar: true,
      requireBatchNumber: true,
      hcoTypesForSamplesAndItems: ["Hospital", "Clinic"],
    });
    expect(s?.permissions.ProductDisbursement).toEqual({ create: true, edit: true });
    expect(s?.products[0]).toMatchObject({
      id: "p1",
      name: "Cardio",
      signatureLevel: "Required",
      defaultQuantity: 2,
    });
    expect(s?.inventory.batches[0].lot).toBe("L1");
    expect(s?.attendeePool[0].addressKey).toBe("austin|73301");
    expect(s?.children.v1.ProviderVisitProdDetailing[0].values.ProductId).toBe("p1");
    expect(s?.gates).toEqual({ files: false, visitors: false });
  });

  it("reads nothing for tables the device doesn't sync", async () => {
    const { ctx: c } = ctx(() => undefined);
    const s = await collectVisitSections(c);
    expect(s?.products).toEqual([]);
    expect(s?.inventory.items).toEqual([]);
    expect(s?.attendeePool).toEqual([]);
    expect(
      seen().some((q) => /FROM LifeSciMarketableProduct|FROM ProductItem|FROM Account/.test(q))
    ).toBe(false);
  });

  it("bounds every read with a LIMIT", async () => {
    const { ctx: c } = ctx();
    await collectVisitSections(c);
    for (const q of seen().filter((q) => !/ IN \(/.test(q))) expect(q).toMatch(/LIMIT \d+/);
  });

  it("fails soft: a failing read leaves its part empty", async () => {
    vi.mocked(runSoqlQuery).mockImplementation((() =>
      Promise.resolve({ success: false, error: "No such object" })) as never);
    const { ctx: c } = ctx();
    const s = await collectVisitSections(c);
    expect(s?.products).toEqual([]);
    expect(s?.children).toEqual({});
  });
});

describe("pure readers", () => {
  it("readSettings defaults", () =>
    expect(readSettings(undefined)).toMatchObject({
      showRecentSidebar: false,
      nextVisitObjectives: "None",
    }));
  it("mergePermissions ORs", () =>
    expect(
      mergePermissions([
        { SobjectType: "X", PermissionsCreate: true, PermissionsEdit: false },
        { SobjectType: "X", PermissionsEdit: true },
      ])
    ).toEqual({ X: { create: true, edit: true } }));
  it("addressKey", () => {
    expect(addressKey("", null)).toBeUndefined();
    expect(addressKey(" Austin ", "1")).toBe("austin|1");
  });
});

describe("renderer types", () => {
  it("equal the server's interfaces", () => {
    const body = (p: string) => {
      const s = readFileSync(p, "utf8");
      const start = s.indexOf("/** ProviderVisitSettings values");
      const end = s.includes("/** Child objects the sidebar edits")
        ? s.indexOf("/** Child objects the sidebar edits")
        : s.length;
      return s.slice(start, end).trim();
    };
    expect(body("src-renderer/components/studio/visit/sections/types.ts")).toBe(
      body("src/studio/screens/visit/sections.ts")
    );
  });
});
