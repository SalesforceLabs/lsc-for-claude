import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import * as zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { ContentCollector, DEFAULT_MAX_COLLECTED_ROWS, downloadContent } from "../../../src/perf/content.js";
import { createHttp, type DeviceHttp, type DeviceRequest } from "../../../src/perf/device/session.js";
import { replayInitialSync, type ReplayContext } from "../../../src/perf/device/replay.js";
import type { SchemaTable } from "../../../src/perf/device/schema.js";

describe("discarding response bodies", () => {
  let server: http.Server;
  let base = "";
  const payload = Buffer.alloc(300_000, "a");
  const gz = zlib.gzipSync(payload);

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const plain = req.url === "/plain";
      res.writeHead(200, plain ? {} : { "content-encoding": "gzip" });
      res.end(plain ? payload : gz);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("counts decoded and wire bytes without keeping the body", async () => {
    const res = await createHttp(base, "tok")({ method: "GET", url: "/gz", discardBody: true });
    expect(res.body.length).toBe(0);
    expect(res.bodyBytes).toBe(payload.length);
    expect(res.wireBytes).toBe(gz.length);
  });

  it("counts an unencoded body too", async () => {
    const res = await createHttp(base, "tok")({ method: "GET", url: "/plain", discardBody: true });
    expect(res.body.length).toBe(0);
    expect(res.bodyBytes).toBe(payload.length);
    expect(res.wireBytes).toBe(payload.length);
  });

  it("still returns the body when asked normally", async () => {
    const res = await createHttp(base, "tok")({ method: "GET", url: "/gz" });
    expect(res.body.equals(payload)).toBe(true);
    expect(res.bodyBytes).toBeUndefined();
  });

  it("downloads attachment bodies as discarded streams and sums bodyBytes", async () => {
    const seen: DeviceRequest[] = [];
    const send: DeviceHttp = async (req) => {
      seen.push(req);
      return { status: 200, headers: {}, body: Buffer.alloc(0), bodyBytes: 1234 };
    };
    const session = { username: "u", instanceUrl: "https://x.my.salesforce.com", apiVersion: "v67.0", http: send };
    const res = await downloadContent(session, { attachments: [{ name: "a", url: "/files/1", size: 0 }], clm: [], notes: [] }, { attachments: true });
    expect(seen[0].discardBody).toBe(true);
    expect(res.attachments?.bytes).toBe(1234);
  });

  it("keeps CLM chunks in memory for the MD5 check", async () => {
    const seen: DeviceRequest[] = [];
    const send: DeviceHttp = async (req) => {
      seen.push(req);
      return { status: 200, headers: {}, body: Buffer.alloc(10) };
    };
    const session = { username: "u", instanceUrl: "https://x.my.salesforce.com", apiVersion: "v67.0", http: send };
    const res = await downloadContent(session, { attachments: [], clm: [{ name: "c", url: "/files/1", size: 10 }], notes: [] }, { clm: true });
    expect(seen[0].discardBody).toBeUndefined();
    expect(res.clm?.files).toBe(1);
  });
});

describe("ContentCollector memory", () => {
  const none = (sobject: string) => ({ sobject, attachmentsSupport: "none" as const });
  const bg = { sobject: "Account", attachmentsSupport: "background" as const };

  it("does not keep file content returned in an Attachment's Body", () => {
    const c = new ContentCollector({ attachments: true, clm: false }, [bg, none("Attachment")]);
    c.observe(bg, [{ Id: "001AAA" }]);
    c.observe(none("Attachment"), [
      { Id: "00PA", ParentId: "001AAA", Body: "/services/data/v67.0/sobjects/Attachment/00PA/Body", BodyLength: 5, Name: "a" },
      { Id: "00PB", ParentId: "001AAA", Body: "B".repeat(100_000), BodyLength: 5, Name: "b" },
    ]);
    const urls = c.plan("v67.0").attachments.map((a) => a.url);
    expect(urls).toEqual(["/services/data/v67.0/sobjects/Attachment/00PA/Body", "/services/data/v67.0/sobjects/Attachment/00PB/Body"]);
  });

  it("stops keeping rows at the cap and says the numbers are lower bounds", () => {
    const c = new ContentCollector({ attachments: true, clm: false }, [bg, none("ContentDocumentLink")], 3);
    c.observe(bg, [{ Id: "001AAA" }]);
    c.observe(
      none("ContentDocumentLink"),
      Array.from({ length: 10 }, (_, i) => ({ ContentDocumentId: `069${i}`, LinkedEntityId: "001AAA" }))
    );
    const plan = c.plan("v67.0");
    expect(plan.notes.join(" ")).toMatch(/at most 3 rows.*7 ContentDocumentLink.*lower bounds/);
  });

  it("has a generous default cap and no note under it", () => {
    expect(DEFAULT_MAX_COLLECTED_ROWS).toBeGreaterThanOrEqual(100_000);
    const c = new ContentCollector({ attachments: false, clm: true }, []);
    c.observe(none("Presentation"), [{ Id: "P1", Name: "A", Type: "ZIP", Status: "Active" }]);
    expect(c.plan("v67.0").notes.join(" ")).not.toMatch(/at most/);
  });
});

describe("collected id lists", () => {
  const ctx: ReplayContext = { userId: "005U", territoryName: "T", territoryId: "0MIT", serverHandlesContentInList: false };
  const account: SchemaTable = {
    sobject: "Account", developerName: "Account", fields: ["Id"], attachmentsSupport: "none", userAccessEntities: "'*'", weight: 10, fromPermissionSet: false,
  };
  const send: DeviceHttp = async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify({ totalSize: 5, done: true, records: ["001A", "001B", "001C", "001D", "001E"].map((Id) => ({ Id })) })),
  });
  const session = { username: "u", instanceUrl: "https://x", apiVersion: "v67.0", http: send };

  it("notes when ids past the cap were dropped", async () => {
    const notes: string[] = [];
    const results = await replayInitialSync({ session, flow: "legacy", context: ctx, syncStart: new Date(), tables: [account], maxCollectedIds: 3, onNote: (n) => notes.push(n) });
    expect(results[0].records).toBe(5);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/at most 3 ids.*lower bounds/);
  });

  it("is silent under the cap", async () => {
    const notes: string[] = [];
    await replayInitialSync({ session, flow: "legacy", context: ctx, syncStart: new Date(), tables: [account], onNote: (n) => notes.push(n) });
    expect(notes).toEqual([]);
  });
});
