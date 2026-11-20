import { beforeEach, describe, expect, it, vi } from "vitest";

// LifeScienceTriggerHandler is a Tooling API object: the standard API answers
// "sObject type 'LifeScienceTriggerHandler' is not supported". These tests pin
// the trigger handler tools to the Tooling API.
const cli = vi.hoisted(() => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedToolingQuery: vi.fn(),
  createToolingRecord: vi.fn(),
  updateToolingRecord: vi.fn(),
}));
vi.mock("../../../src/salesforce/cli.js", () => cli);
vi.mock("../../../src/salesforce/auth.js", () => ({
  validateOrgConnection: vi.fn(async () => ({ targetOrg: "demo" })),
}));

import { register } from "../../../src/tools/admin-console.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
const tools = new Map<string, Handler>();
register({
  tool: (name: string, _d: string, _s: unknown, fn: Handler) => tools.set(name, fn),
} as never);

const ok = (records: unknown[]) => ({ success: true, data: { records } });

beforeEach(() => {
  for (const fn of Object.values(cli)) fn.mockReset();
});

describe("list_trigger_handlers", () => {
  it("queries the Tooling API, never the standard API", async () => {
    cli.runToolingQuery.mockResolvedValue(
      ok([
        {
          Id: "1",
          DeveloperName: "StagePathPermissionsHandler",
          MasterLabel: "Stage Path Permissions",
          IsActive: true,
        },
      ])
    );
    const res = await tools.get("list_trigger_handlers")!({});
    expect(cli.runSoqlQuery).not.toHaveBeenCalled();
    expect(cli.runToolingQuery.mock.calls[0][0]).toContain("FROM LifeScienceTriggerHandler");
    expect(res.content[0].text).toContain("StagePathPermissionsHandler");
  });

  it("escapes the filter so quotes and wildcards match literally", async () => {
    cli.runToolingQuery.mockResolvedValue(ok([]));
    await tools.get("list_trigger_handlers")!({ objectName: "O'Brien_%" });
    const q = cli.runToolingQuery.mock.calls[0][0] as string;
    expect(q).toContain("LIKE '%O\\'Brien\\_\\%%'");
  });
});

describe("toggle_trigger_handler", () => {
  it("reads and updates the handler through the Tooling API", async () => {
    cli.runToolingQuery.mockResolvedValue(
      ok([
        {
          Id: "0Xx1",
          DeveloperName: "StagePathPermissionsHandler",
          MasterLabel: "Stage Path Permissions",
          IsActive: false,
        },
      ])
    );
    cli.updateToolingRecord.mockResolvedValue({ success: true });
    await tools.get("toggle_trigger_handler")!({
      handlerName: "StagePathPermissionsHandler",
      active: true,
    });
    expect(cli.runSoqlQuery).not.toHaveBeenCalled();
    expect(cli.updateToolingRecord).toHaveBeenCalledWith(
      "LifeScienceTriggerHandler",
      "0Xx1",
      { IsActive: true },
      "demo"
    );
  });

  it("escapes the handler name", async () => {
    cli.runToolingQuery.mockResolvedValue(ok([]));
    await tools.get("toggle_trigger_handler")!({ handlerName: "x' OR Name != '", active: true });
    expect(cli.runToolingQuery.mock.calls[0][0]).toContain("DeveloperName = 'x\\' OR Name != \\''");
    expect(cli.updateToolingRecord).not.toHaveBeenCalled();
  });
});
