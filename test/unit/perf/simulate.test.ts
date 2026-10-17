import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { deflateRawSync } from "zlib";
import type { DeviceHttp, DeviceRequest, DeviceResponse, DeviceSession } from "../../../src/perf/device/session.js";
import { ZipReader } from "../../../src/perf/device/zip.js";
import { downloadArchive, parseDownloadInfo, type UserSpecificPermissions } from "../../../src/perf/device/metadata.js";
import { buildSchema, filterAvailableFields, assertUserSpecificPermissions } from "../../../src/perf/device/schema.js";
import {
  AdaptiveBatch,
  buildLegacyQuery,
  chunk,
  emptyIds,
  initialBatchSize,
  legacyChunkSize,
  orderPhases,
  replayInitialSync,
  resolveTags,
  substituteTag,
  tableComplexity,
  type ReplayContext,
} from "../../../src/perf/device/replay.js";
import type { SchemaTable } from "../../../src/perf/device/schema.js";
import { resolveFlow, selectTerritory, userInfoPath, parseUserInfo } from "../../../src/perf/device/user-info.js";
import { compareToTelemetry, filterTables } from "../../../src/perf/simulate.js";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): DeviceResponse {
  return { status, headers, body: Buffer.from(JSON.stringify(body)) };
}

function session(handler: (req: DeviceRequest) => DeviceResponse | Promise<DeviceResponse>) {
  const calls: DeviceRequest[] = [];
  const http: DeviceHttp = async (req) => {
    calls.push(req);
    return handler(req);
  };
  const s: DeviceSession = { username: "u@x.org", instanceUrl: "https://x", apiVersion: "v67.0", http };
  return { s, calls };
}

function table(over: Partial<SchemaTable> & { sobject: string }): SchemaTable {
  return {
    developerName: over.sobject,
    fields: ["Id", "Name"],
    attachmentsSupport: "none",
    userAccessEntities: "'*','P'",
    weight: 10,
    fromPermissionSet: false,
    ...over,
  };
}

const ctx: ReplayContext = { userId: "005U", territoryName: "T1", territoryId: "0MIT", serverHandlesContentInList: false };

describe("tags", () => {
  it("resolves scalar tags case-insensitively and only when referenced", () => {
    const t = table({ sobject: "A", whereSoql: "OwnerId = '{user.id}' AND Terr = '{USER.TERRITORY}'" });
    const tags = resolveTags(t, ctx, emptyIds());
    expect(tags.scalars).toEqual({ "{USER.ID}": "005U", "{USER.TERRITORY}": "T1" });
    expect(tags.emptyLists).toEqual([]);
  });

  it("uses '*' for access entities and an empty value for teams", () => {
    const t = table({ sobject: "A", whereSoql: "X IN ({USER.ACCESS.ENTITIES}) AND '{USER.TEAMS}'", userAccessEntities: "" });
    const tags = resolveTags(t, ctx, emptyIds());
    expect(tags.scalars["{USER.ACCESS.ENTITIES}"]).toBe("'*'");
    expect(tags.scalars["{USER.TEAMS}"]).toBe("");
  });

  it("reports empty id lists so the table is skipped", () => {
    const t = table({ sobject: "C", whereSoql: "AccountId IN ({ACCOUNT.IDS})" });
    expect(resolveTags(t, ctx, emptyIds()).emptyLists).toEqual(["{ACCOUNT.IDS}"]);
    const ids = emptyIds();
    ids.accountIds.add("001");
    expect(resolveTags(t, ctx, ids).emptyLists).toEqual([]);
  });

  it("substitutes case-insensitively", () => {
    expect(substituteTag("a IN ({account.ids}) {ACCOUNT.IDS}", "{ACCOUNT.IDS}", "'1'")).toBe("a IN ('1') '1'");
  });
});

describe("schema", () => {
  const usp: UserSpecificPermissions = {
    availableFields: { Account: ["Id", "Name", "Secret__c", "UserRecordAccess.HasEditAccess"], Cfg__c: ["Id"], Empty: ["Id"] },
    fieldPermissions: [
      { field: "Account.Id", readable: true },
      { field: "Account.Name", readable: true },
      { field: "Account.Secret__c", readable: false },
      { field: "Cfg__c.Id", readable: true },
    ],
    objectPermissions: [{}],
  };
  const files = {
    db: {
      Account: { SObject: "Account", DeveloperName: "Z_Account", WhereSoql: "OwnerId='{USER.ID}'", DeltaDateField: "LastModifiedDate", AttachmentsSupport: "CACHE" },
      Cfg__c: { SObject: "Cfg__c", DeveloperName: "Cfg" },
      Empty: { SObject: "Empty", DeveloperName: "E" },
    },
    dbPs: {},
    sobjects: {
      Account: { fields: [{ fullName: "Id", type: "String" }, { fullName: "Name", type: "String" }, { fullName: "Secret__c", type: "String" }] },
    },
    config: { Cfg__c: {} },
    permissions: {
      profile: { fullName: "Rep", customPermissions: [{ enabled: true, name: "CP1" }, { enabled: false, name: "CP2" }] },
      permissionSets: [{ fullName: "PS1", customPermissions: [{ enabled: true, name: "CP1" }] }],
    },
  };

  it("filters unreadable fields and drops tables with no readable fields", () => {
    expect(filterAvailableFields(usp)).toEqual({
      Account: ["Id", "Name", "UserRecordAccess.HasEditAccess"],
      Cfg__c: ["Id"],
    });
  });

  it("builds the table list: config exclusion, field intersection, UserRecordAccess, access entities", () => {
    const r = buildSchema({ files, usp, assignedPermissionSets: ["PS1"] });
    expect(r.tables.map((t) => t.sobject)).toEqual(["Account"]);
    expect(r.tables[0].fields).toEqual(["Id", "Name", "UserRecordAccess.HasEditAccess"]);
    expect(r.tables[0].attachmentsSupport).toBe("cache");
    expect(r.userAccessEntities).toBe("'*','Rep','CP1','PS1'");
  });

  it("fails like a device when userSpecificPermissions is incomplete", () => {
    expect(() => assertUserSpecificPermissions({ availableFields: {}, fieldPermissions: [], objectPermissions: [] })).toThrow(/userSpecificPermissions/);
  });

  it("merges permission-set tables, lowest DeveloperName wins, skipping those without availableFields", () => {
    const f = {
      ...files,
      dbPs: {
        Account__c: { SObject: "Account", DeveloperName: "A_Account_PS", PermissionSets: "PS1" },
        Other__c: { SObject: "Other", DeveloperName: "Other", PermissionSets: "PS2" },
      },
      permissions: {
        ...files.permissions,
        permissionSets: [{ fullName: "PS1", availableFields: { Account: ["Id"] } }, { fullName: "PS2" }],
      },
    };
    const r = buildSchema({ files: f, usp, assignedPermissionSets: ["PS1", "PS2"] });
    const acct = r.tables.find((t) => t.sobject === "Account");
    expect(acct?.developerName).toBe("A_Account_PS");
    expect(acct?.fromPermissionSet).toBe(true);
    expect(r.tables.some((t) => t.sobject === "Other")).toBe(false);
    expect(r.notes.join(" ")).toMatch(/skipped/);
  });
});

describe("ordering", () => {
  const names = ["DeviceSyncTransactionRecord", "ContentVersion", "Opt__c", "Contact", "Account", "ContentDocumentLink", "ObjectTerritory2Association", "Attachment", "ContentDocument", "Visit__c"];
  const phasesOf = (flow: "enhanced" | "legacy", where: Record<string, string> = {}) =>
    orderPhases(names.map((sobject) => table({ sobject, whereSoql: where[sobject] })), flow).map((p) => p.map((t) => t.sobject));

  it("enhanced: OT2A, Account, the rest with Opt__c and DSTR last, then the finalize steps (DSTR repeats)", () => {
    expect(phasesOf("enhanced")).toEqual([
      ["ObjectTerritory2Association"],
      ["Account"],
      ["Contact", "Visit__c", "Opt__c", "DeviceSyncTransactionRecord"],
      ["Attachment", "ContentDocumentLink"],
      ["DeviceSyncTransactionRecord"],
      ["ContentVersion", "ContentDocument", "DeviceSyncTransactionRecord"],
    ]);
  });

  it("legacy: OT2A and Account are plain tables without id tags, and DSTR runs after the main tables", () => {
    const phases = phasesOf("legacy");
    expect(phases.slice(0, 2)).toEqual([["Contact", "Visit__c", "ObjectTerritory2Association", "Account", "Opt__c"], ["DeviceSyncTransactionRecord"]]);
    expect(phases.slice(2)).toEqual(phasesOf("enhanced").slice(3));
  });

  it("legacy: OT2A and Account go first when a WHERE uses their id tags", () => {
    const phases = phasesOf("legacy", { Contact: "AccountId IN ({ACCOUNT.IDS})", Visit__c: "Id IN ({OT2A.OBJ.IDS})" });
    expect(phases.slice(0, 3)).toEqual([["ObjectTerritory2Association"], ["Account"], ["Contact", "Visit__c", "Opt__c"]]);
  });

  it("downloads ContentVersion and ContentDocument only after a ContentDocumentLink", () => {
    const phases = orderPhases(["Attachment", "ContentVersion", "DeviceSyncTransactionRecord"].map((sobject) => table({ sobject })), "enhanced").map((p) => p.map((t) => t.sobject));
    expect(phases).toEqual([["DeviceSyncTransactionRecord"], ["Attachment", "DeviceSyncTransactionRecord"]]);
  });

  it("scores complexity as 1 plus the selects in the WHERE", () => {
    expect(tableComplexity(undefined)).toBe(1);
    expect(tableComplexity("OwnerId = '{USER.ID}'")).toBe(1);
    expect(tableComplexity("Id IN (SELECT A FROM B WHERE C IN (Select D FROM E))")).toBe(3);
  });
});

describe("replayInitialSync scheduling", () => {
  it("runs DSTR in each of its phases and keeps one summed row", async () => {
    const { s, calls } = session(() => json({ records: [{ Id: "x" }], hasMore: false }));
    const seen: string[] = [];
    const res = await replayInitialSync({
      session: s,
      flow: "enhanced",
      context: ctx,
      syncStart: new Date("2026-10-17T00:00:00Z"),
      onTable: (r) => seen.push(r.sobject),
      tables: ["DeviceSyncTransactionRecord", "ContentDocumentLink", "Contact"].map((sobject) => table({ sobject })),
    });
    const sti = calls.filter((c) => JSON.parse(c.body ?? "{}").objectName === "DeviceSyncTransactionRecord");
    expect(sti).toHaveLength(3);
    expect(res.map((r) => r.sobject)).toEqual(["DeviceSyncTransactionRecord", "ContentDocumentLink", "Contact"]);
    expect(res[0]).toMatchObject({ requests: 3, records: 3 });
    expect(seen.filter((n) => n === "DeviceSyncTransactionRecord")).toHaveLength(1);
    expect(seen).toHaveLength(3);
  });
});

describe("skip rules and dependencies", () => {
  it("passes Account ids to dependents and skips tables whose id list is empty", async () => {
    const { s, calls } = session((req) => {
      const body = JSON.parse(req.body ?? "{}");
      if (body.objectName === "Account") return json({ records: [{ Id: "001A" }, { Id: "001B" }], hasMore: false });
      return json({ records: [{ Id: "x" }], hasMore: false });
    });
    const res = await replayInitialSync({
      session: s,
      flow: "enhanced",
      context: ctx,
      syncStart: new Date("2026-10-17T00:00:00Z"),
      tables: [
        table({ sobject: "Contact", whereSoql: "AccountId IN ({ACCOUNT.IDS})" }),
        table({ sobject: "Account" }),
        table({ sobject: "Sti__c", whereSoql: "Id IN ({STI.OBJ.IDS})" }),
      ],
    });
    const by = Object.fromEntries(res.map((r) => [r.sobject, r]));
    expect(by.Account.records).toBe(2);
    expect(by.Contact.records).toBe(1);
    expect(by.Sti__c.skipped).toMatch(/STI\.OBJ\.IDS/);
    const contact = JSON.parse(calls.find((c) => JSON.parse(c.body ?? "{}").objectName === "Contact")?.body ?? "{}");
    expect(contact.tags).toEqual([{ tagName: "{ACCOUNT.IDS}", tagValue: "'001A','001B'" }]);
    expect(calls.findIndex((c) => JSON.parse(c.body ?? "{}").objectName === "Account")).toBeLessThan(
      calls.findIndex((c) => JSON.parse(c.body ?? "{}").objectName === "Contact")
    );
  });

  it("skips a table with no Id field", async () => {
    const { s } = session(() => json({ records: [] }));
    const [r] = await replayInitialSync({ session: s, flow: "enhanced", context: ctx, syncStart: new Date(), tables: [table({ sobject: "A", fields: ["Name"] })] });
    expect(r.skipped).toMatch(/Id/);
  });
});

describe("enhanced flow", () => {
  it("paginates with the query locator and sends the documented body and header", async () => {
    let n = 0;
    const { s, calls } = session(() => {
      n++;
      return json({ records: [{ Id: `${n}a` }, { Id: `${n}b` }], hasMore: n < 3, queryLocator: n < 3 ? `loc${n}` : null });
    });
    const [r] = await replayInitialSync({
      session: s,
      flow: "enhanced",
      context: ctx,
      syncStart: new Date("2026-10-17T00:00:00.000Z"),
      tables: [table({ sobject: "Visit__c", whereSoql: "OwnerId='{USER.ID}'", deltaDateField: "LastModifiedDate" })],
    });
    expect(r.records).toBe(6);
    expect(r.requests).toBe(3);
    expect(calls[0].url).toBe("/services/data/v67.0/connect/life-sciences/commercial/sobject/query");
    expect(calls[0].headers).toEqual({ "X-Chatter-Entity-Encoding": "false" });
    const b0 = JSON.parse(calls[0].body ?? "{}");
    expect(b0).toMatchObject({
      objectName: "Visit__c",
      queryType: "GenericQuery",
      where: "OwnerId='{USER.ID}'",
      tags: [{ tagName: "{USER.ID}", tagValue: "005U" }],
      timeStamp: [{ fieldName: "LastModifiedDate", rangeStartTime: "1970-01-01T00:00:00.000Z", rangeEndTime: "2026-10-17T00:00:00.000Z" }],
    });
    expect(b0.queryLocator).toBeUndefined();
    expect(JSON.parse(calls[1].body ?? "{}").queryLocator).toBe("loc1");
    expect(JSON.parse(calls[2].body ?? "{}").queryLocator).toBe("loc2");
  });

  it("defaults the timestamp field to SystemModstamp", async () => {
    const { s, calls } = session(() => json({ records: [] }));
    await replayInitialSync({ session: s, flow: "enhanced", context: ctx, syncStart: new Date(), tables: [table({ sobject: "A" })] });
    expect(JSON.parse(calls[0].body ?? "{}").timeStamp[0].fieldName).toBe("SystemModstamp");
  });

  it("chunks content IN-lists at 1500 unless the server handles them", async () => {
    const run = async (serverHandles: boolean) => {
      const { s, calls } = session((req) => {
        const o = JSON.parse(req.body ?? "{}");
        if (o.objectName === "Account") return json({ records: Array.from({ length: 3200 }, (_, i) => ({ Id: `001${i}` })) });
        return json({ records: [] });
      });
      await replayInitialSync({
        session: s,
        flow: "enhanced",
        context: { ...ctx, serverHandlesContentInList: serverHandles },
        syncStart: new Date(),
        tables: [
          table({ sobject: "Account", attachmentsSupport: "cache" }),
          table({ sobject: "ContentDocumentLink" }),
          table({ sobject: "ContentVersion", whereSoql: "FirstPublishLocationId IN ({RELATED.ENTITIES})" }),
        ],
      });
      return calls.filter((c) => JSON.parse(c.body ?? "{}").objectName === "ContentVersion").length;
    };
    expect(await run(false)).toBe(3);
    expect(await run(true)).toBe(1);
  });

  it("drops VersionData from ContentVersion", async () => {
    const { s, calls } = session(() => json({ records: [] }));
    await replayInitialSync({
      session: s,
      flow: "enhanced",
      context: ctx,
      syncStart: new Date(),
      tables: [table({ sobject: "ContentDocumentLink" }), table({ sobject: "ContentVersion", fields: ["Id", "VersionData", "Title"] })],
    });
    const cv = calls.map((c) => JSON.parse(c.body ?? "{}")).find((b) => b.objectName === "ContentVersion");
    expect(cv.fields).toEqual(["Id", "Title"]);
  });

  it("records a table error without failing the run", async () => {
    const { s } = session((req) => (JSON.parse(req.body ?? "{}").objectName === "Bad__c" ? json([{ errorCode: "X", message: "boom" }], 400) : json({ records: [{ Id: "1" }] })));
    const res = await replayInitialSync({ session: s, flow: "enhanced", context: ctx, syncStart: new Date(), tables: [table({ sobject: "Bad__c" }), table({ sobject: "Ok__c" })] });
    expect(res.find((r) => r.sobject === "Bad__c")?.error).toMatch(/boom/);
    expect(res.find((r) => r.sobject === "Ok__c")?.records).toBe(1);
  });

  it("stops at maxRecordsPerTable and honors cancellation", async () => {
    const { s } = session(() => json({ records: [{ Id: "1" }, { Id: "2" }], hasMore: true, queryLocator: "l" }));
    const [r] = await replayInitialSync({ session: s, flow: "enhanced", context: ctx, syncStart: new Date(), maxRecordsPerTable: 4, tables: [table({ sobject: "A" })] });
    expect(r.records).toBe(4);
    expect(r.truncated).toMatch(/maxRecordsPerTable/);

    const ac = new AbortController();
    ac.abort();
    const [c] = await replayInitialSync({ session: s, flow: "enhanced", context: ctx, syncStart: new Date(), signal: ac.signal, tables: [table({ sobject: "A" })] });
    expect(c.skipped).toBe("cancelled");
  });
});

describe("legacy flow", () => {
  it("builds the query with the delta filter appended and tags substituted", async () => {
    const { s, calls } = session(() => json({ done: true, totalSize: 1, records: [{ Id: "1" }] }));
    await replayInitialSync({
      session: s,
      flow: "legacy",
      context: ctx,
      syncStart: new Date("2026-10-17T01:02:03.456Z"),
      tables: [
        table({ sobject: "Visit__c", fields: ["Id", "LastModifiedDate"], whereSoql: "OwnerId='{user.id}'", deltaDateField: "LastModifiedDate" }),
        table({ sobject: "Plain__c", fields: ["Id", "LastModifiedDate"], deltaDateField: "LastModifiedDate" }),
      ],
    });
    const qs = calls.map((c) => decodeURIComponent(c.url.split("?q=")[1]));
    expect(qs).toContain("SELECT Id,LastModifiedDate FROM Visit__c WHERE OwnerId='005U' AND LastModifiedDate > 1970-01-01T00:00:00Z AND LastModifiedDate <= 2026-10-17T01:02:03Z");
    expect(qs).toContain("SELECT Id,LastModifiedDate FROM Plain__c WHERE LastModifiedDate > 1970-01-01T00:00:00Z AND LastModifiedDate <= 2026-10-17T01:02:03Z");
  });

  it("omits the delta filter when the delta field is not requested", () => {
    const q = buildLegacyQuery(table({ sobject: "A", deltaDateField: "LastModifiedDate" }), ["Id"], undefined, new Date());
    expect(q).toBe("SELECT Id FROM A");
  });

  it("fetches later pages through composite/batch in groups of 15", async () => {
    const { s, calls } = session((req) => {
      if (req.method === "GET") return json({ totalSize: 100, done: false, nextRecordsUrl: "/services/data/v67.0/query/01gLOC-2", records: [{ Id: "a" }, { Id: "b" }] });
      const body = JSON.parse(req.body ?? "{}");
      return json({ hasErrors: false, results: body.batchRequests.map(() => ({ statusCode: 200, result: { records: [{ Id: "x" }, { Id: "y" }] } })) });
    });
    const [r] = await replayInitialSync({ session: s, flow: "legacy", context: ctx, syncStart: new Date(), tables: [table({ sobject: "Big__c" })] });
    // 100 records at 2 per page: 49 later pages -> 15 + 15 + 15 + 4
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(4);
    expect(JSON.parse(posts[0].body ?? "{}").batchRequests[0]).toEqual({ method: "GET", url: "v67.0/query/01gLOC-2" });
    expect(JSON.parse(posts[0].body ?? "{}").haltOnError).toBe(true);
    expect(r.records).toBe(2 + 49 * 2);
    expect(r.requests).toBe(5);
  });

  it("can follow nextRecordsUrl sequentially", async () => {
    let n = 0;
    const { s, calls } = session(() => {
      n++;
      return json({ totalSize: 6, done: n >= 3, nextRecordsUrl: `/services/data/v67.0/query/01gL-${n * 2}`, records: [{ Id: `${n}` }, { Id: `${n}b` }] });
    });
    const [r] = await replayInitialSync({ session: s, flow: "legacy", legacyPaging: "sequential", context: ctx, syncStart: new Date(), tables: [table({ sobject: "A" })] });
    expect(r.records).toBe(6);
    expect(calls[1].url).toBe("/services/data/v67.0/query/01gL-2");
  });

  it("chunks IN-lists to the formQuery limits", async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `001${String(i).padStart(12, "0")}`);
    const { s, calls } = session((req) => {
      if (req.url.includes("FROM%20Account")) return json({ done: true, records: ids.map((Id) => ({ Id })) });
      return json({ done: true, records: [] });
    });
    const t = table({ sobject: "Contact", whereSoql: "AccountId IN ({ACCOUNT.IDS})" });
    await replayInitialSync({ session: s, flow: "legacy", context: ctx, syncStart: new Date(), tables: [table({ sobject: "Account" }), t] });
    const contactQs = calls.map((c) => decodeURIComponent(c.url.split("?q=")[1] ?? "")).filter((q) => q.includes("FROM Contact"));
    const template = "SELECT Id,Name FROM Contact WHERE AccountId IN ({ACCOUNT.IDS})";
    const size = legacyChunkSize(template.length, "AccountId IN ({ACCOUNT.IDS})".length, 1);
    expect(contactQs.length).toBe(Math.ceil(5000 / size));
    expect(Math.max(...contactQs.map((q) => q.length))).toBeLessThanOrEqual(14000);
  });

  it("computes the formQuery chunk size", () => {
    expect(legacyChunkSize(100, 0, 1)).toBe(Math.floor((14000 - 300 - 200) / 22));
    expect(legacyChunkSize(100, 3000, 1)).toBe(Math.floor((4000 - 3000 - 200) / 22));
    expect(legacyChunkSize(100, 0, 2)).toBe(Math.floor(Math.floor((14000 - 300 - 200) / 22) / 2));
    expect(legacyChunkSize(20000, 10, 1)).toBe(1);
  });
});

describe("batch sizing and helpers", () => {
  it("picks the initial batch by record weight", () => {
    expect([initialBatchSize(100), initialBatchSize(300), initialBatchSize(900)]).toEqual([10000, 1000, 500]);
  });
  it("sizes from the first page then halves on slow pages", () => {
    const b = new AdaptiveBatch(100);
    b.update(1, 1024 * 1024, 1000); // 1 MB/s -> 10 MB target, 1 KB/record -> 10240 -> clamped 10000
    expect(b.size).toBe(10000);
    b.update(100, 1, 1);
    expect(b.size).toBe(5000);
  });
  it("chunks arrays", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("filters tables by include/exclude", () => {
    const t = [{ sobject: "A" }, { sobject: "B" }, { sobject: "C" }];
    expect(filterTables(t, ["a", "b"], ["B"]).map((x) => x.sobject)).toEqual(["A"]);
  });
});

describe("user-info", () => {
  it("omits userDeviceId by default and encodes access checks", () => {
    const p = userInfoPath({ apiVersion: "v67.0" });
    expect(p).toMatch(/^\/services\/data\/v67\.0\/connect\/life-sciences\/commercial\/mobile\/user-info\?configOnly=false&mdName=&accessChecks=/);
    expect(p).not.toContain("userDeviceId");
    expect(userInfoPath({ apiVersion: "v67.0" }, { userDeviceId: "x y" })).toContain("userDeviceId=x%20y");
  });
  it("chooses the enhanced flow only with the setting and an access check", () => {
    const on = { syncSettings: { enhancedSyncUsingConnectAPI: true }, accessChecks: { "IndustriesLsCommercialOCE.orgHasMobileEnhancedSyncEnabled": true } };
    expect(resolveFlow(on)).toBe("enhanced");
    expect(resolveFlow({ ...on, accessChecks: {} })).toBe("legacy");
    expect(resolveFlow({ ...on, syncSettings: {} })).toBe("legacy");
  });
  it("parses tolerantly and picks the first leaf territory", () => {
    const info = parseUserInfo({
      metadataEntities: [{ id: "1KA", name: "v1" }, { name: "no id" }],
      territoryHierarchy: [{ name: "Root", id: "0M1", children: [{ name: "Leaf", id: "0M2", children: [] }] }],
      user: { id: "005", profile: { name: "Rep" } },
    });
    expect(info.metadataEntities).toHaveLength(1);
    expect(selectTerritory(info.territories)?.name).toBe("Leaf");
    expect(selectTerritory(info.territories, "0m1")?.name).toBe("Root");
    expect(info.user.profileName).toBe("Rep");
  });
});

describe("metadata download", () => {
  const payload = Buffer.from("x".repeat(25));
  const md5 = createHash("md5").update(payload).digest("hex");
  const info = parseDownloadInfo({
    metadataContentVersionInfo: { contentVersionId: "068", checksum: md5.toUpperCase(), contentSize: payload.length, versionDataURL: "/v/068" },
    userSpecificPermissions: {},
  });
  const rangeHandler = (data: Buffer) => (req: DeviceRequest): DeviceResponse => {
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers?.Range ?? "");
    const a = Number(m?.[1]);
    const b = Math.min(Number(m?.[2]), data.length - 1);
    return { status: 206, headers: { "content-range": `bytes ${a}-${b}/${data.length}` }, body: data.subarray(a, b + 1) };
  };

  it("downloads in Range chunks and verifies the MD5", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-test-"));
    try {
      const { s, calls } = session(rangeHandler(payload));
      const r = await downloadArchive(s, info, dir, { chunkBytes: 10 });
      expect(r.bytes).toBe(25);
      expect(r.requests).toBe(3);
      expect(calls.map((c) => c.headers?.Range)).toEqual(["bytes=0-9", "bytes=10-19", "bytes=20-29"]);
      expect(fs.readFileSync(r.file).equals(payload)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an archive whose MD5 does not match", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-test-"));
    try {
      const { s } = session(rangeHandler(Buffer.from("y".repeat(25))));
      await expect(downloadArchive(s, info, dir, { chunkBytes: 10 })).rejects.toThrow(/MD5 mismatch/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires contentVersionId and checksum", () => {
    expect(() => parseDownloadInfo({})).toThrow(/metadataContentVersionInfo/);
  });
});

describe("zip reader", () => {
  function makeZip(files: Record<string, string>, method: 0 | 8): Buffer {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const raw = Buffer.from(content);
      const data = method === 8 ? deflateRawSync(raw) : raw;
      const nameBuf = Buffer.from(name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(method, 8);
      lh.writeUInt32LE(data.length, 18);
      lh.writeUInt32LE(raw.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      locals.push(lh, nameBuf, data);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(method, 10);
      ch.writeUInt32LE(data.length, 20);
      ch.writeUInt32LE(raw.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt32LE(offset, 42);
      central.push(ch, nameBuf);
      offset += lh.length + nameBuf.length + data.length;
    }
    const cen = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(cen.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cen, eocd]);
  }

  for (const method of [0, 8] as const) {
    it(`reads json entries (method ${method}) and matches by path suffix`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-zip-"));
      try {
        const f = path.join(dir, "a.zip");
        fs.writeFileSync(f, makeZip({ "P/metadata/db.json": '{"a":1}', "P/metadata/db_ps.json": '{"b":2}' }, method));
        const z = ZipReader.open(f);
        expect(z.readJson("db.json")).toEqual({ a: 1 });
        expect(z.readJson("db_ps.json")).toEqual({ b: 2 });
        expect(z.readJson("missing.json")).toBeUndefined();
        z.close();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("telemetry comparison", () => {
  it("compares against the median of successful initial syncs", () => {
    const sample = (over: object) => ({ id: "", createdDate: "", user: "", kind: "initial", outcome: "success", failed: false, totalSec: 1, downloadSec: 100, uploadSec: 0, metadataSec: 10, downloadedRecords: 1000, dbSizeGb: 0, network: "", appVersion: "", ...over }) as never;
    const c = compareToTelemetry(
      { metadata: { bytes: 1, seconds: 5, version: "v", requests: 1 }, totals: { records: 2000, requests: 1, bytes: 1, seconds: 50, tablesDownloaded: 1, tablesSkipped: 0, tablesFailed: 0 } },
      [sample({}), sample({ downloadSec: 300 }), sample({ failed: true, downloadSec: 9999 }), sample({ kind: "delta" })]
    );
    expect(c.sampleCount).toBe(2);
    expect(c.download).toEqual({ simulated: 50, deviceMedian: 200, ratio: 0.25 });
    expect(c.metadata.ratio).toBe(0.5);
    expect(c.records.ratio).toBe(2);
  });
});

describe("progress", () => {
  it("reports each table as it finishes, including skipped ones", async () => {
    const { s } = session(() => json({ records: [{ Id: "1" }, { Id: "2" }] }));
    const seen: Array<{ sobject: string; records: number; skipped?: string }> = [];
    await replayInitialSync({
      session: s,
      flow: "enhanced",
      context: ctx,
      syncStart: new Date(),
      tables: [table({ sobject: "A" }), table({ sobject: "B" })],
      maxTotalRecords: 2,
      concurrency: 1,
      onTable: (r) => seen.push({ sobject: r.sobject, records: r.records, skipped: r.skipped }),
    });
    expect(seen).toEqual([
      { sobject: "A", records: 2, skipped: undefined },
      { sobject: "B", records: 0, skipped: "maxTotalRecords reached" },
    ]);
  });
});
