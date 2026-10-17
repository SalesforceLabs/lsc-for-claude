import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { ContentCollector, downloadContent, type ContentItem, type ContentPlan } from "../../../src/perf/content.js";
import type { DeviceRequest, DeviceSession } from "../../../src/perf/device/session.js";

function sessionOf(handler: (req: DeviceRequest) => Promise<{ status?: number; body: Buffer }> | { status?: number; body: Buffer }) {
  const calls: DeviceRequest[] = [];
  const session: DeviceSession = {
    username: "rep@x.org",
    instanceUrl: "https://x.my.salesforce.com",
    apiVersion: "v67.0",
    http: async (req) => {
      calls.push(req);
      const r = await handler(req);
      return { status: r.status ?? 200, headers: {}, body: r.body };
    },
  };
  return { session, calls };
}

const plan = (attachments: ContentItem[] = [], clm: ContentItem[] = []): ContentPlan => ({ attachments, clm, notes: [] });
const item = (n: number, size = 100): ContentItem => ({ name: `f${n}`, url: `/files/${n}`, size });

describe("attachment downloads", () => {
  it("fetches one at a time, in order, with plain GETs and no extra headers", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { session, calls } = sessionOf(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { body: Buffer.alloc(10) };
    });
    const res = await downloadContent(session, plan([1, 2, 3, 4].map((n) => item(n))), { attachments: true });
    expect(maxInFlight).toBe(1);
    expect(calls.map((c) => c.url)).toEqual(["/files/1", "/files/2", "/files/3", "/files/4"]);
    expect(calls.every((c) => c.method === "GET" && c.headers === undefined)).toBe(true);
    expect(res.attachments).toMatchObject({ candidates: 4, files: 4, bytes: 40, failures: 0 });
    expect(res.outsideSyncWindow).toBe(true);
  });

  it("stops at maxFiles and reports lower bounds", async () => {
    const { session, calls } = sessionOf(() => ({ body: Buffer.alloc(5) }));
    const res = await downloadContent(session, plan([1, 2, 3, 4, 5].map((n) => item(n))), { attachments: true, maxFiles: 2 });
    expect(calls).toHaveLength(2);
    expect(res.attachments?.files).toBe(2);
    expect(res.attachments?.truncated).toMatch(/maxFiles/);
    expect(res.notes.some((n) => /lower bounds/.test(n))).toBe(true);
  });

  it("stops at maxBytes", async () => {
    const { session, calls } = sessionOf(() => ({ body: Buffer.alloc(60) }));
    const res = await downloadContent(session, plan([1, 2, 3, 4].map((n) => item(n))), { attachments: true, maxBytes: 100 });
    expect(calls).toHaveLength(2);
    expect(res.attachments?.bytes).toBe(120);
    expect(res.attachments?.truncated).toMatch(/maxBytes/);
  });

  it("counts failures, keeps going, and lists the largest files", async () => {
    const { session } = sessionOf((req) => (req.url === "/files/2" ? { status: 404, body: Buffer.alloc(0) } : { body: Buffer.alloc(Number(req.url.split("/")[2]) * 10) }));
    const res = await downloadContent(session, plan([1, 2, 3].map((n) => item(n))), { attachments: true });
    expect(res.attachments).toMatchObject({ files: 2, failures: 1, errors: ["HTTP 404"] });
    expect(res.attachments?.largest.map((f) => [f.name, f.bytes])).toEqual([["f3", 30], ["f1", 10]]);
  });

  it("refuses URLs outside Salesforce and never sends them", async () => {
    const { session, calls } = sessionOf(() => ({ body: Buffer.alloc(1) }));
    const res = await downloadContent(
      session,
      plan([{ name: "evil", url: "https://evil.example.com/x", size: 1 }, { name: "proto", url: "//evil.example.com/x", size: 1 }]),
      { attachments: true }
    );
    expect(calls).toHaveLength(0);
    expect(res.attachments?.failures).toBe(2);
  });

  it("does not keep bodies: the result is small plain data", async () => {
    const { session } = sessionOf(() => ({ body: Buffer.alloc(1024 * 1024) }));
    const res = await downloadContent(session, plan([1, 2, 3].map((n) => item(n))), { attachments: true });
    expect(res.attachments?.bytes).toBe(3 * 1024 * 1024);
    expect(JSON.stringify(res).length).toBeLessThan(5000);
  });

  it("reports the result shape", async () => {
    const { session } = sessionOf(() => ({ body: Buffer.alloc(1) }));
    const res = await downloadContent(session, plan([item(1)]), { attachments: true });
    expect(res).toMatchObject({ outsideSyncWindow: true, limits: { maxFiles: 200, maxBytes: 2 * 1024 ** 3 }, notes: [] });
    expect(res.clm).toBeUndefined();
    expect(Object.keys(res.attachments!).sort()).toEqual(["bytes", "candidates", "failures", "files", "largest", "seconds", "skipped"]);
  });
});

describe("CLM downloads", () => {
  const data = Buffer.from("x".repeat(25));
  const md5 = createHash("md5").update(data).digest("hex");
  const rangeServer = (req: DeviceRequest) => {
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers?.Range ?? "");
    return { body: data.subarray(Number(m![1]), Number(m![2]) + 1) };
  };

  it("fetches Range chunks of at most chunkBytes and verifies the MD5", async () => {
    const { session, calls } = sessionOf(rangeServer);
    const res = await downloadContent(session, plan([], [{ name: "p / s", url: "/sfc/x", size: 25, checksum: md5 }]), { clm: true, chunkBytes: 10 });
    expect(calls.map((c) => c.headers?.Range)).toEqual(["bytes=0-9", "bytes=10-19", "bytes=20-24"]);
    expect(res.clm).toMatchObject({ files: 1, bytes: 25, failures: 0 });
  });

  it("fails a file whose checksum does not match", async () => {
    const { session } = sessionOf(rangeServer);
    const res = await downloadContent(session, plan([], [{ name: "p", url: "/sfc/x", size: 25, checksum: "0".repeat(32) }]), { clm: true, chunkBytes: 10 });
    expect(res.clm).toMatchObject({ files: 0, failures: 1 });
  });

  it("fails on an empty chunk instead of looping", async () => {
    const { session, calls } = sessionOf(() => ({ body: Buffer.alloc(0) }));
    const res = await downloadContent(session, plan([], [{ name: "p", url: "/sfc/x", size: 25 }]), { clm: true, chunkBytes: 10 });
    expect(calls).toHaveLength(1);
    expect(res.clm?.failures).toBe(1);
  });

  it("never runs more than four downloads at once", async () => {
    let inFlight = 0;
    let max = 0;
    const { session } = sessionOf(async () => {
      max = Math.max(max, ++inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return { body: Buffer.alloc(10) };
    });
    const res = await downloadContent(session, plan([], Array.from({ length: 12 }, (_, i) => item(i, 10))), { clm: true });
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
    expect(res.clm?.files).toBe(12);
  });

  it("honors maxFiles", async () => {
    const { session, calls } = sessionOf(() => ({ body: Buffer.alloc(10) }));
    const res = await downloadContent(session, plan([], Array.from({ length: 10 }, (_, i) => item(i, 10))), { clm: true, maxFiles: 3 });
    expect(calls).toHaveLength(3);
    expect(res.clm?.truncated).toMatch(/maxFiles/);
  });
});

describe("ContentCollector", () => {
  const bg = { sobject: "Account", attachmentsSupport: "background" as const };
  const none = (sobject: string) => ({ sobject, attachmentsSupport: "none" as const });

  it("finds ContentDocument attachments for parents in background tables", () => {
    const c = new ContentCollector({ attachments: true, clm: false }, [bg, none("ContentDocumentLink")]);
    c.observe(bg, [{ Id: "001AAA" }]);
    c.observe(none("ContentDocumentLink"), [
      { ContentDocumentId: "069A", LinkedEntityId: "001AAA" },
      { ContentDocumentId: "069B", LinkedEntityId: "003ZZZ" },
    ]);
    c.observe(none("ContentDocument"), [{ Id: "069A", LatestPublishedVersionId: "068A" }, { Id: "069B", LatestPublishedVersionId: "068B" }]);
    c.observe(none("ContentVersion"), [
      { Id: "068A", ContentDocumentId: "069A", Title: "a", ContentSize: 5, VersionData: "/services/data/v67.0/sobjects/ContentVersion/068A/VersionData" },
      { Id: "068B", ContentDocumentId: "069B", Title: "b", ContentSize: 5 },
    ]);
    const p = c.plan("v67.0");
    expect(p.attachments).toEqual([{ name: "a", url: "/services/data/v67.0/sobjects/ContentVersion/068A/VersionData", size: 5 }]);
  });

  it("plans active presentations, custom first, one page for a PDF", () => {
    const c = new ContentCollector({ attachments: false, clm: true }, []);
    const now = new Date("2026-10-17T00:00:00Z");
    c.observe(none("Presentation"), [
      { Id: "P1", Name: "B", Type: "ZIP", Status: "Active" },
      { Id: "P2", Name: "A", Type: "PDF", Status: "Active", IsCustom: true },
      { Id: "P3", Name: "Old", Type: "ZIP", Status: "Active", DeactivationDate: "2026-01-01T00:00:00Z" },
      { Id: "P4", Name: "Draft", Type: "ZIP", Status: "Draft" },
    ]);
    c.observe(none("PresentationLinkedPage"), [
      { PresentationId: "P1", PresentationPageId: "S1", DisplayOrder: 1 },
      { PresentationId: "P1", PresentationPageId: "S1", DisplayOrder: 2 },
      { PresentationId: "P2", PresentationPageId: "S2", DisplayOrder: 1 },
      { PresentationId: "P2", PresentationPageId: "S3", DisplayOrder: 2 },
    ]);
    c.observe(none("PresentationPage"), ["S1", "S2", "S3"].map((Id) => ({ Id, Name: Id, Type: "zip", Status: "Active" })));
    c.observe(none("ContentDocumentLink"), ["S1", "S2", "S3"].map((s, i) => ({ ContentDocumentId: `D${i}`, LinkedEntityId: s })));
    c.observe(none("ContentDocument"), [0, 1, 2].map((i) => ({ Id: `D${i}`, LatestPublishedVersionId: `V${i}`, FileType: "ZIP" })));
    c.observe(none("ContentVersion"), [0, 1, 2].map((i) => ({ Id: `V${i}`, ContentSize: 100 + i, VersionDataUrl: `/v/${i}` })));
    const p = c.plan("v67.0", now);
    expect(p.clm.map((x) => [x.name, x.url])).toEqual([["A / S2", "/v/1"], ["B / S1", "/v/0"]]);
  });
});
