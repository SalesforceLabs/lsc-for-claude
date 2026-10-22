import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/salesforce/cli.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/salesforce/cli.js")>()),
  cachedDescribeSObject: vi.fn(async () => ({
    success: true,
    data: {
      name: "RecommendedAction",
      label: "Recommended Action",
      fields: [
        { name: "Id", label: "Id", type: "id" },
        { name: "Name", label: "Name", type: "string", nameField: true },
        { name: "Score__c", label: "Score", type: "double", custom: true },
      ],
    },
  })),
  runSoqlQuery: vi.fn(async () => ({ success: true, data: { totalSize: 7, records: [] } })),
}));
vi.mock("../../../../src/studio/apps/sync.js", () => ({ syncedObjectsOf: async () => new Set(["RecommendedAction"]), syncedObjectsFor: async () => new Set() }));
vi.mock("../../../../src/perf/device/session.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/perf/device/session.js")>()),
  createTokenSession: vi.fn(() => ({ http: async () => ({ status: 200, headers: {}, body: Buffer.from("{}") }) })),
}));

import { describeForApp } from "../../../../src/studio/apps/describe.js";
import { sampleRecords } from "../../../../src/studio/apps/sample.js";
import { RunAsError, userGet } from "../../../../src/studio/apps/run-as.js";
import type { DeviceHttp } from "../../../../src/perf/device/session.js";

const login = { instanceUrl: "https://x.my.salesforce.com", accessToken: "SECRET-TOKEN", username: "carmen@x.com" };
const json = (status: number, body: unknown) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });

describe("run as a test user", () => {
  it("reports object and field access from the user's describe", async () => {
    const { createTokenSession } = await import("../../../../src/perf/device/session.js");
    (createTokenSession as ReturnType<typeof vi.fn>).mockReturnValue({
      http: (async (req: { url: string }) =>
        req.url.includes("/describe")
          ? json(200, { name: "RecommendedAction", label: "Recommended Action", queryable: true, updateable: false, fields: [{ name: "Id", label: "Id", type: "id" }, { name: "Name", label: "Name", type: "string" }] })
          : json(200, { totalSize: 3, records: [] })) as DeviceHttp,
    });
    const [o] = await describeForApp(["RecommendedAction"], "org", login);
    expect(o.access).toBe("read");
    expect(o.hiddenFields).toEqual(["Score__c"]);
    expect(o.note).toContain("carmen@x.com can't read RecommendedAction.Score__c");
    expect(o.recordCount).toBe(3);
    expect(JSON.stringify(o)).not.toContain("SECRET-TOKEN");
  });

  it("reports no access when the user's describe is refused", async () => {
    const { createTokenSession } = await import("../../../../src/perf/device/session.js");
    (createTokenSession as ReturnType<typeof vi.fn>).mockReturnValue({ http: (async () => json(404, [{ message: "nope" }])) as DeviceHttp });
    const [o] = await describeForApp(["RecommendedAction"], "org", login);
    expect(o).toMatchObject({ exists: true, access: "none", fields: [] });
  });

  it("fails with a sign-in message on 401, never falling back to the admin", async () => {
    await expect(userGet(login, "/x", (async () => json(401, [])) as DeviceHttp)).rejects.toBeInstanceOf(RunAsError);
    const { createTokenSession } = await import("../../../../src/perf/device/session.js");
    (createTokenSession as ReturnType<typeof vi.fn>).mockReturnValue({ http: (async () => json(401, [])) as DeviceHttp });
    await expect(sampleRecords("SELECT Id FROM Account", "org", login)).rejects.toThrow(/sign in again/);
  });

  it("samples as the user", async () => {
    const { createTokenSession } = await import("../../../../src/perf/device/session.js");
    (createTokenSession as ReturnType<typeof vi.fn>).mockReturnValue({
      http: (async (req: { url: string }) => {
        expect(decodeURIComponent(req.url)).toContain("LIMIT 5");
        return json(200, { totalSize: 1, records: [{ attributes: {}, Id: "001" }] });
      }) as DeviceHttp,
    });
    expect(await sampleRecords("SELECT Id FROM Account", "org", login)).toEqual({ records: [{ Id: "001" }], totalSize: 1 });
  });
});
