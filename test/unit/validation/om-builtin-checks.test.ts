import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  retrieveMetadata: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { executeCheck } = await import("../../../src/validation/rules-executor.js");
const { recordNames } = await import("../../../src/validation/diagnose.js");

type Row = Record<string, unknown>;
const ok = (records: Row[]) =>
  Promise.resolve({ success: true, data: { totalSize: records.length, done: true, records } });
const bad = (error: string) => Promise.resolve({ success: false, error });
const run = (name: string) => executeCheck({ type: "builtin", name, expect: "none" }, "org");

/** soql answers by the first matching fragment; unmatched queries return no rows. */
function answer(map: Array<[string, Row[] | string]>) {
  vi.mocked(cli.runSoqlQuery).mockImplementation(((q: string) => {
    const hit = map.find(([frag]) => q.includes(frag));
    if (!hit) return ok([]);
    return typeof hit[1] === "string" ? bad(hit[1]) : ok(hit[1]);
  }) as never);
}

/** retrieveMetadata writes files into a temp folder, as the real one does. */
function files(byName: Record<string, string> | string) {
  vi.mocked(cli.retrieveMetadata).mockImplementation((async () => {
    if (typeof byName === "string") return { success: false, error: byName };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-test-"));
    for (const [n, t] of Object.entries(byName)) {
      fs.mkdirSync(path.join(dir, "x"), { recursive: true });
      fs.writeFileSync(path.join(dir, "x", n), t);
    }
    return { success: true, data: { outputDir: dir } };
  }) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("quote owner permission checks", () => {
  const owners: Row[] = [
    { Id: "005A", Name: "Owner A" },
    { Id: "005B", Name: "Owner B" },
  ];
  const assignments: Row[] = [
    { AssigneeId: "005A", PermissionSetId: "0PSa", PermissionSetGroupId: null },
    { AssigneeId: "005B", PermissionSetId: "0PSg", PermissionSetGroupId: "0PGb" },
  ];
  const base = (grants: Row[]): Array<[string, Row[] | string]> => [
    ["FROM User", owners],
    ["FROM PermissionSetAssignment", assignments],
    [
      "FROM PermissionSetGroupComponent",
      [{ PermissionSetGroupId: "0PGb", PermissionSetId: "0PSc" }],
    ],
    ["FROM FieldPermissions", grants],
    ["FROM ObjectPermissions", grants],
  ];

  it("passes when every owner gets edit, including through a group", async () => {
    answer(base([{ ParentId: "0PSa" }, { ParentId: "0PSc" }]));
    expect((await run("quote-owner-status-edit")).passed).toBe(true);
  });

  it("fails naming the owner with no grant", async () => {
    answer(base([{ ParentId: "0PSa" }]));
    const r = await run("quote-owner-quote-document-create");
    expect(r.passed).toBe(false);
    expect(recordNames(r)).toEqual(["Owner B"]);
  });

  it("passes when there are no quote owners", async () => {
    answer([["FROM User", []]]);
    expect((await run("quote-owner-status-edit")).passed).toBe(true);
  });

  it("couldn't check when a read fails", async () => {
    answer([["FROM User", "boom"]]);
    const r = await run("quote-owner-status-edit");
    expect(r.unavailable).toBe(true);
    expect(r.passed).toBe(false);
  });
});

describe("settings checks", () => {
  const settings = (name: string, body: string) => ({
    [`${name}.settings-meta.xml`]: `<?xml version="1.0"?><${name}Settings xmlns="x">${body}</${name}Settings>`,
  });

  it("passes when the flag is true", async () => {
    files(settings("RevenueManagement", "<enableRevenueAdjustment>true</enableRevenueAdjustment>"));
    expect((await run("setting-revenue-adjustment")).passed).toBe(true);
  });

  it("fails when the flag is false or missing from a file that was read", async () => {
    files(
      settings(
        "ProductConfigurator",
        "<enableProductConfigurator>false</enableProductConfigurator>"
      )
    );
    expect((await run("setting-product-configurator")).passed).toBe(false);
    files(settings("RevenueManagement", "<other>true</other>"));
    expect((await run("setting-revenue-adjustment")).passed).toBe(false);
  });

  it("couldn't check when the retrieve fails or returns no file", async () => {
    files("denied");
    expect((await run("setting-translation-workbench")).unavailable).toBe(true);
    files({});
    expect((await run("setting-translation-workbench")).unavailable).toBe(true);
  });
});

describe("pricing procedure checks", () => {
  const procedure = (steps: string) =>
    `<ExpressionSetDefinition xmlns="x"><versions><status>Active</status>${steps}</versions><versions><status>Inactive</status><steps><actionType>Rounding</actionType></steps></versions></ExpressionSetDefinition>`;
  const pam = (table: string) =>
    `<steps><actionType>PriceAdjustmentMatrix</actionType><label>Adj</label><customElement><parameters><name>LookUpApiName</name><type>Literal</type><value>${table}</value></parameters></customElement></steps>`;
  const list: [string, Row[]] = ["FROM ExpressionSet WHERE UsageSubtype", [{ ApiName: "Proc" }]];

  it("rounding: passes with none, fails on an active rounding step, ignores inactive versions", async () => {
    answer([list]);
    files({
      "Proc.expressionSetDefinition-meta.xml": procedure(
        "<steps><actionType>ListPrice</actionType></steps>"
      ),
    });
    expect((await run("pricing-rounding-step")).passed).toBe(true);
    files({
      "Proc.expressionSetDefinition-meta.xml": procedure(
        "<steps><actionType>RoundingValues</actionType><label>Round</label></steps>"
      ),
    });
    const r = await run("pricing-rounding-step");
    expect(r.passed).toBe(false);
    expect(recordNames(r)).toEqual(["Proc: Round"]);
  });

  it("rounding: couldn't check when the list or retrieve fails", async () => {
    answer([["FROM ExpressionSet WHERE", "no access"]]);
    expect((await run("pricing-rounding-step")).unavailable).toBe(true);
    answer([list]);
    files("timeout");
    expect((await run("pricing-rounding-step")).unavailable).toBe(true);
  });

  it("PAM: passes with no date parameters, fails on one, skips tier tables", async () => {
    files({ "Proc.expressionSetDefinition-meta.xml": procedure(pam("PAM_Table")) });
    answer([list, ["FROM DecisionTableParameter", []]]);
    expect((await run("pam-effective-dates")).passed).toBe(true);
    answer([
      list,
      [
        "FROM DecisionTableParameter",
        [
          {
            DecisionTable: { DeveloperName: "PAM_Table", SourceObject: "Foo__c" },
            FieldName: "EffectiveFrom",
          },
        ],
      ],
    ]);
    const r = await run("pam-effective-dates");
    expect(r.passed).toBe(false);
    expect(recordNames(r)).toEqual(["PAM_Table (Proc): EffectiveFrom"]);
    answer([
      list,
      [
        "FROM DecisionTableParameter",
        [
          {
            DecisionTable: { DeveloperName: "PAM_Table", SourceObject: "PriceAdjustmentTier" },
            FieldName: "EffectiveFrom",
          },
        ],
      ],
    ]);
    expect((await run("pam-effective-dates")).passed).toBe(true);
  });

  it("PAM: couldn't check when the parameter read fails", async () => {
    files({ "Proc.expressionSetDefinition-meta.xml": procedure(pam("PAM_Table")) });
    answer([list, ["FROM DecisionTableParameter", "denied"]]);
    expect((await run("pam-effective-dates")).unavailable).toBe(true);
  });
});

describe("pricing-procedure-selectors", () => {
  const views = (value: string | null) =>
    vi.mocked(cli.runToolingQuery).mockImplementation((() =>
      ok([
        {
          LifeSciConfigRecord: { DeveloperName: "OrderProductViewsSettings_OrgLevel" },
          PicklistValue: value,
        },
      ])) as never);
  const quotes: [string, Row[]] = [
    "FROM Quote",
    [{ SalesTransactionType: { Name: "STT One", PricingProcedureId: "9QA1" } }],
  ];
  const defs: [string, Row[]] = [
    "FROM ExpressionSetDefinition",
    [{ Id: "9QA1", DeveloperName: "Proc" }],
  ];

  it("passes when every named procedure is an active LSC one", async () => {
    views("Proc");
    answer([
      quotes,
      defs,
      [
        "FROM ExpressionSet WHERE ApiName",
        [{ ApiName: "Proc", UsageSubtype: "LifeSciencesCommercial" }],
      ],
      ["FROM ExpressionSetVersion", [{ ExpressionSet: { ApiName: "Proc" } }]],
    ]);
    expect((await run("pricing-procedure-selectors")).passed).toBe(true);
  });

  it("fails naming the selector and why", async () => {
    views("Other");
    answer([
      quotes,
      defs,
      [
        "FROM ExpressionSet WHERE ApiName",
        [
          { ApiName: "Proc", UsageSubtype: "RevenueCloud" },
          { ApiName: "Other", UsageSubtype: "LifeSciencesCommercial" },
        ],
      ],
      ["FROM ExpressionSetVersion", []],
    ]);
    const r = await run("pricing-procedure-selectors");
    expect(r.passed).toBe(false);
    expect(recordNames(r)).toEqual([
      "Product Views OrderProductViewsSettings_OrgLevel: Other (no active version)",
      "Sales Transaction Type STT One: Proc (not a Life Sciences Commercial procedure)",
    ]);
  });

  it("flags an empty selection and couldn't check on a failed read", async () => {
    views(null);
    answer([["FROM Quote", []]]);
    const r = await run("pricing-procedure-selectors");
    expect(recordNames(r)).toEqual([
      "Product Views OrderProductViewsSettings_OrgLevel: no procedure chosen",
    ]);
    answer([["FROM Quote", "denied"]]);
    expect((await run("pricing-procedure-selectors")).unavailable).toBe(true);
  });
});

describe("quote-approval-run-as", () => {
  const flow = (runAs: string) =>
    `<Flow xmlns="x"><orchestratedStages><stageSteps><label>Send</label><runAsUser>${runAs}</runAsUser><stepSubtype>BackgroundStep</stepSubtype></stageSteps><stageSteps><label>Approve</label><runAsUser>false</runAsUser><stepSubtype>ApprovalStep</stepSubtype></stageSteps></orchestratedStages></Flow>`;
  const list: [string, Row[]] = ["FROM FlowDefinitionView", [{ ApiName: "Quote_Flow" }]];

  it("passes with no flow, and when background steps run as a user", async () => {
    answer([["FROM FlowDefinitionView", []]]);
    expect((await run("quote-approval-run-as")).passed).toBe(true);
    answer([list]);
    files({ "Quote_Flow.flow-meta.xml": flow("true") });
    expect((await run("quote-approval-run-as")).passed).toBe(true);
  });

  it("fails naming a background step that doesn't run as a user", async () => {
    answer([list]);
    files({ "Quote_Flow.flow-meta.xml": flow("false") });
    const r = await run("quote-approval-run-as");
    expect(r.passed).toBe(false);
    expect(recordNames(r)).toEqual(["Quote_Flow: Send"]);
  });

  it("couldn't check when the retrieve fails", async () => {
    answer([list]);
    files("nope");
    expect((await run("quote-approval-run-as")).unavailable).toBe(true);
  });
});

describe("standard-price-first", () => {
  const entry = (Id: string, Product2Id: string, extra: Row = {}): Row => ({
    Id,
    Name: `Entry ${Id}`,
    Product2Id,
    CurrencyIsoCode: "USD",
    ProductSellingModelId: "m",
    ...extra,
  });
  const by = (custom: Row[], standard: Row[]) =>
    vi
      .mocked(cli.runSoqlQuery)
      .mockImplementation(((q: string) =>
        ok(q.includes("IsStandard = true") ? standard : custom)) as never);

  it("passes when each custom entry has a standard one", async () => {
    by([entry("1", "p1")], [entry("2", "p1")]);
    expect((await run("standard-price-first")).passed).toBe(true);
  });

  it("fails on a custom entry with no standard entry", async () => {
    by([entry("1", "p1"), entry("3", "p2")], [entry("2", "p1")]);
    const r = await run("standard-price-first");
    expect(r.passed).toBe(false);
    expect(recordNames(r)).toEqual(["Entry 3"]);
  });

  it("retries without a column the org doesn't have", async () => {
    vi.mocked(cli.runSoqlQuery).mockImplementation(((q: string) =>
      q.includes("ProductSellingModelId")
        ? bad("No such column 'ProductSellingModelId'")
        : ok([entry("1", "p1", { ProductSellingModelId: undefined })])) as never);
    expect((await run("standard-price-first")).passed).toBe(true);
  });

  it("couldn't check on another error", async () => {
    vi.mocked(cli.runSoqlQuery).mockImplementation((() => bad("denied")) as never);
    expect((await run("standard-price-first")).unavailable).toBe(true);
  });
});
