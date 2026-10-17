import { describe, it, expect } from "vitest";
import type { DeviceHttp, DeviceRequest, DeviceResponse, DeviceSession } from "../../../src/perf/device/session.js";
import { LocalIdStore, type ReplayContext, type TableResult } from "../../../src/perf/device/replay.js";
import type { SchemaTable } from "../../../src/perf/device/schema.js";
import { QUERY_PATH, VISIBILITY_PATH, simulateDelta, type DeltaResult } from "../../../src/perf/device/delta.js";
import { aggregateRuns } from "../../../src/studio/sim-runs.js";
import { renderSimulation } from "../../../src/tools/perf-simulate.js";
import type { SimulationResult } from "../../../src/perf/simulate.js";

const ctx: ReplayContext = { userId: "005U", territoryName: "T1", territoryId: "0MIT", serverHandlesContentInList: false };

function json(body: unknown, status = 200): DeviceResponse {
  return { status, headers: {}, body: Buffer.from(JSON.stringify(body)) };
}

function table(over: Partial<SchemaTable> & { sobject: string }): SchemaTable {
  return { developerName: over.sobject, fields: ["Id", "Name"], attachmentsSupport: "none", userAccessEntities: "'*'", weight: 10, fromPermissionSet: false, ...over };
}

function done(t: SchemaTable): TableResult {
  return { sobject: t.sobject, developerName: t.developerName, records: 1, requests: 1, bytes: 1, seconds: 1 };
}

interface Visibility {
  objectName: string;
  fetchedIds: string[];
  ids: string[];
  tags: { tagName: string; tagValue: string }[];
  queryLocator?: string;
  timeStamp: { fieldName: string; rangeStartTime: string; rangeEndTime: string }[];
}

interface Server {
  s: DeviceSession;
  calls: DeviceRequest[];
  visibility: Visibility[][];
  queries: Record<string, unknown>[];
}

/** `visible(object, req)` answers one visibility object; `query(body)` answers one IdSubquery page. */
function server(
  visible: (o: Visibility) => Record<string, unknown>,
  query: (b: Record<string, unknown>) => Record<string, unknown> = () => ({ records: [], hasMore: false })
): Server {
  const calls: DeviceRequest[] = [];
  const visibility: Visibility[][] = [];
  const queries: Record<string, unknown>[] = [];
  const http: DeviceHttp = async (req) => {
    calls.push(req);
    const body = JSON.parse(String(req.body));
    if (req.url.endsWith(VISIBILITY_PATH)) {
      visibility.push(body.objects);
      return json({ objects: (body.objects as Visibility[]).map((o) => ({ objectName: o.objectName, ...visible(o) })) });
    }
    if (req.url.endsWith(QUERY_PATH)) {
      queries.push(body);
      return json(query(body));
    }
    return json({ message: "unexpected" }, 404);
  };
  return { s: { username: "u@x.org", instanceUrl: "https://x", apiVersion: "v67.0", http }, calls, visibility, queries };
}

function run(srv: Server, tables: SchemaTable[], ids: Record<string, number | string[]>, extra: { cap?: number; sinceHours?: number } = {}): Promise<DeltaResult> {
  const store = new LocalIdStore(extra.cap ?? 2_000_000);
  for (const t of tables) {
    const v = ids[t.sobject] ?? 0;
    const list = Array.isArray(v) ? v : Array.from({ length: v }, (_, i) => `${t.sobject}-${i}`);
    store.add(t.sobject, list.map((Id) => ({ Id })));
  }
  return simulateDelta({
    session: srv.s,
    tables,
    initial: tables.map(done),
    store,
    context: ctx,
    sinceHours: extra.sinceHours ?? 24,
    clock: () => new Date("2026-01-02T00:00:00.000Z"),
  });
}

const nothing = () => ({ toDownload: [], toDelete: [], fetchedIds: [], hasMore: false });

describe("delta visibility batching", () => {
  it("sends light tables five to a request and heavy tables alone", async () => {
    const light = Array.from({ length: 7 }, (_, i) => table({ sobject: `L${i}` }));
    const heavy = table({ sobject: "Heavy" });
    const ids: Record<string, number> = { Heavy: 10_001 };
    for (const t of light) ids[t.sobject] = 3;
    const srv = server(nothing);
    const res = await run(srv, [heavy, ...light], ids);

    const sizes = srv.visibility.map((r) => r.length).sort();
    expect(sizes).toEqual([1, 2, 5]);
    expect(srv.visibility.find((r) => r.some((o) => o.objectName === "Heavy"))).toHaveLength(1);
    expect(res.totals.visibilityRequests).toBe(3);
    expect(res.tables.find((t) => t.sobject === "Heavy")?.visibilityRequests).toBe(1);
  });

  it("sends the full local ids, a timeStamp range on the delta field, and no device id", async () => {
    const t = table({ sobject: "Acct", deltaDateField: "LastModifiedDate", whereSoql: "OwnerId = '{USER.ID}'" });
    const srv = server(nothing);
    const res = await run(srv, [t], { Acct: ["a", "b"] }, { sinceHours: 2 });
    const o = srv.visibility[0][0];
    expect(o.ids).toEqual(["a", "b"]);
    expect(o.fetchedIds).toEqual([]);
    expect(o.tags).toEqual([{ tagName: "{USER.ID}", tagValue: "005U" }]);
    expect(o.timeStamp).toEqual([{ fieldName: "LastModifiedDate", rangeStartTime: "2026-01-01T22:00:00.000Z", rangeEndTime: "2026-01-02T00:00:00.000Z" }]);
    expect(res.rangeStart).toBe("2026-01-01T22:00:00.000Z");
    expect(JSON.stringify(srv.calls)).not.toMatch(/userDeviceId/i);
  });

  it("pages a table by queryLocator, sending fetchedIds back, and keeps paging objects in the next round", async () => {
    const a = table({ sobject: "A" });
    const b = table({ sobject: "B" });
    const srv = server((o) => {
      if (o.objectName === "A" && !o.queryLocator) return { toDownload: ["a1"], toDelete: [], fetchedIds: ["x"], hasMore: true, queryLocator: "LOC1" };
      if (o.objectName === "A") return { toDownload: ["a2"], toDelete: ["d1"], fetchedIds: ["x", "y"], hasMore: false };
      return { toDownload: [], toDelete: [], fetchedIds: [], hasMore: false };
    });
    const res = await run(srv, [a, b], { A: 4, B: 2 });
    expect(srv.visibility).toHaveLength(2);
    const second = srv.visibility[1];
    expect(second.map((o) => o.objectName)).toEqual(["A"]);
    expect(second[0].queryLocator).toBe("LOC1");
    expect(second[0].fetchedIds).toEqual(["x"]);
    const row = res.tables.find((t) => t.sobject === "A");
    expect(row).toMatchObject({ visibilityRequests: 2, toDownload: 2, toDelete: 1 });
    expect(srv.queries[0]).toMatchObject({ objectName: "A", queryType: "IdSubquery", ids: ["a1", "a2"] });
  });

  it("pages a heavy table alone", async () => {
    const t = table({ sobject: "Big" });
    let page = 0;
    const srv = server(() => {
      page++;
      return page < 3 ? { toDownload: [`p${page}`], toDelete: [], fetchedIds: [], hasMore: true, queryLocator: `L${page}` } : { toDownload: ["p3"], toDelete: [], fetchedIds: [], hasMore: false };
    });
    const res = await run(srv, [t], { Big: 10_500 });
    expect(srv.visibility).toHaveLength(3);
    expect(res.tables[0].toDownload).toBe(3);
  });

  it("chunks content id lists at 1,500 ids: downloads are the union, deletes the intersection", async () => {
    const cdl = table({ sobject: "ContentDocumentLink", whereSoql: "LinkedEntityId IN ({RELATED.ENTITIES})" });
    const srv = server((o) => {
      const tag = o.tags.find((x) => x.tagName === "{RELATED.ENTITIES}");
      const n = tag ? tag.tagValue.split(",").length : 0;
      const first = tag?.tagValue.includes("'e0'");
      return first
        ? { toDownload: ["n1"], toDelete: ["d1", "d2"], fetchedIds: [], hasMore: false, _n: n }
        : { toDownload: ["n1", "n2"], toDelete: ["d2", "d3"], fetchedIds: [], hasMore: false };
    });
    const store = new LocalIdStore(1000);
    store.add("ContentDocumentLink", [{ Id: "c1" }]);
    store.collected.relatedEntities = new Set(Array.from({ length: 3200 }, (_, i) => `e${i}`));
    const res = await simulateDelta({ session: srv.s, tables: [cdl], initial: [done(cdl)], store, context: ctx, sinceHours: 1 });
    expect(srv.visibility.map((r) => r[0].tags.find((x) => x.tagName === "{RELATED.ENTITIES}")?.tagValue.split(",").length)).toEqual([1500, 1500, 200]);
    expect(srv.visibility.every((r) => r[0].ids.length === 1)).toBe(true);
    expect(res.tables[0].toDownload).toBe(2);
    expect(res.tables[0].toDelete).toBe(1);
    expect(res.tables[0].visibilityRequests).toBe(3);
  });
});

describe("delta fetch", () => {
  it("downloads the ids to download with IdSubquery, paging by queryLocator with the ids on every page", async () => {
    const t = table({ sobject: "Acct" });
    const srv = server(
      () => ({ toDownload: ["n1", "n2", "n3"], toDelete: [], fetchedIds: [], hasMore: false }),
      (b) => (b.queryLocator ? { records: [{ Id: "n3" }], hasMore: false } : { records: [{ Id: "n1" }, { Id: "n2" }], hasMore: true, queryLocator: "Q1" })
    );
    const res = await run(srv, [t], { Acct: 5 });
    expect(srv.queries).toHaveLength(2);
    expect(srv.queries.every((q) => JSON.stringify(q.ids) === JSON.stringify(["n1", "n2", "n3"]))).toBe(true);
    expect(srv.queries[1].queryLocator).toBe("Q1");
    expect(res.tables[0]).toMatchObject({ recordsFetched: 3, fetchRequests: 2 });
    expect(res.totals).toMatchObject({ requests: 3, fetchRequests: 2, visibilityRequests: 1, recordsFetched: 3, toDownload: 3 });
  });

  it("makes no fetch request for a table with nothing to download", async () => {
    const srv = server(nothing);
    await run(srv, [table({ sobject: "A" })], { A: 3 });
    expect(srv.queries).toHaveLength(0);
  });

  it("records a failed table without failing the others", async () => {
    const srv = server((o) => {
      if (o.objectName === "Bad") throw new Error("boom");
      return nothing();
    });
    const res = await run(srv, [table({ sobject: "Bad" }), table({ sobject: "Ok" })], { Bad: 10_001, Ok: 3 });
    expect(res.tables.find((t) => t.sobject === "Ok")?.error).toBeUndefined();
    expect(res.tables.find((t) => t.sobject === "Bad")?.error).toBeTruthy();
    expect(res.totals.tablesFailed).toBe(1);
  });
});

describe("delta skips and cap", () => {
  it("skips DeviceSyncTransactionRecord and tables the initial sync did not finish", async () => {
    const srv = server(nothing);
    const dstr = table({ sobject: "DeviceSyncTransactionRecord" });
    const ok = table({ sobject: "Ok" });
    const bad = table({ sobject: "Bad" });
    const store = new LocalIdStore(100);
    store.add("Ok", [{ Id: "1" }]);
    store.add("Bad", [{ Id: "1" }]);
    const res = await simulateDelta({
      session: srv.s,
      tables: [dstr, ok, bad],
      initial: [done(dstr), done(ok), { ...done(bad), truncated: "limit" }],
      store,
      context: ctx,
      sinceHours: 1,
    });
    expect(res.tables.filter((t) => t.skipped).map((t) => t.sobject)).toEqual(["DeviceSyncTransactionRecord", "Bad"]);
    expect(srv.visibility.flat().map((o) => o.objectName)).toEqual(["Ok"]);
  });

  it("stops keeping ids past the cap, skips the remaining tables and says so", async () => {
    const a = table({ sobject: "A" });
    const b = table({ sobject: "B" });
    const c = table({ sobject: "C" });
    const srv = server(nothing);
    const res = await run(srv, [a, b, c], { A: 4, B: 4, C: 1 }, { cap: 6 });
    expect(res.tables.find((t) => t.sobject === "A")?.skipped).toBeUndefined();
    expect(res.tables.find((t) => t.sobject === "B")?.skipped).toMatch(/cap/);
    expect(res.tables.find((t) => t.sobject === "C")?.skipped).toMatch(/cap/);
    expect(res.notes.some((n) => /cap was reached/.test(n))).toBe(true);
    expect(srv.visibility.flat().map((o) => o.objectName)).toEqual(["A"]);
  });

  it("LocalIdStore does not keep ids for DeviceSyncTransactionRecord", () => {
    const store = new LocalIdStore(10);
    store.add("DeviceSyncTransactionRecord", [{ Id: "1" }]);
    expect(store.ids.size).toBe(0);
    expect(store.total).toBe(0);
  });
});

describe("delta reporting", () => {
  const base: SimulationResult = {
    user: { username: "u@x.org", id: "005U" },
    org: { instanceUrl: "https://x", apiVersion: "v67.0" },
    flow: "enhanced",
    metadata: { bytes: 1, seconds: 1, version: "v", requests: 1 },
    tables: [],
    totals: { records: 0, requests: 0, bytes: 0, seconds: 10, tablesDownloaded: 0, tablesSkipped: 0, tablesFailed: 0 },
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    notes: [],
  };

  it("renders a delta section in the Markdown report, and none without delta", async () => {
    const srv = server(() => ({ toDownload: ["n1"], toDelete: [], fetchedIds: [], hasMore: false }), () => ({ records: [{ Id: "n1" }], hasMore: false }));
    const delta = await run(srv, [table({ sobject: "Acct" })], { Acct: 2 });
    const md = renderSimulation({ ...base, delta });
    expect(md).toContain("## Delta sync (last synced 24 h ago)");
    expect(md).toContain("| Acct |");
    expect(renderSimulation(base)).not.toContain("Delta sync");
  });

  it("aggregates delta seconds as medians and keeps the representative run's counts", async () => {
    const srv = server(nothing);
    const delta = await run(srv, [table({ sobject: "Acct" })], { Acct: 2 });
    const withSeconds = (total: number, delta_: number): SimulationResult => ({
      ...base,
      totals: { ...base.totals, seconds: total },
      delta: { ...delta, totals: { ...delta.totals, seconds: delta_ }, tables: delta.tables.map((t) => ({ ...t, seconds: delta_ })) },
    });
    const agg = aggregateRuns([withSeconds(10, 5), withSeconds(11, 9), withSeconds(12, 7)]);
    expect(agg.delta?.totals.seconds).toBe(7);
    expect(agg.delta?.tables[0].seconds).toBe(7);
    expect(aggregateRuns([base, base]).delta).toBeUndefined();
  });
});
