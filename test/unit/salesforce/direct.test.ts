import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { directGet, directQuery, resetDirect, MAX_GET_URL_CHARS } from "../../../src/salesforce/direct.js";
import { Limiter, urgentScope } from "../../../src/salesforce/limiter.js";
import { markTruncated } from "../../../src/salesforce/cli.js";

const ORG = "big-org";
const creds = { accessToken: "tok-1", instanceUrl: "https://acme.my.salesforce.com", apiVersion: "62.0" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("directQuery", () => {
  const fetchMock = vi.fn();
  let fetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetDirect();
    delete process.env.LSC_SF_DIRECT;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetcher = vi.fn(async () => creds);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("pages with nextRecordsUrl and sends the token only to the instance", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { totalSize: 3, done: false, records: [{ Id: "1" }, { Id: "2" }], nextRecordsUrl: "/services/data/v62.0/query/01g-2" }))
      .mockResolvedValueOnce(json(200, { totalSize: 3, done: true, records: [{ Id: "3" }] }));
    const out = await directQuery("SELECT Id FROM Account", ORG, fetcher, { maxRows: 50_000 });
    expect(out).toEqual({ ok: true, data: { totalSize: 3, done: true, records: [{ Id: "1" }, { Id: "2" }, { Id: "3" }] } });
    const [url1, init1] = fetchMock.mock.calls[0];
    expect(url1).toBe(`https://acme.my.salesforce.com/services/data/v62.0/query?q=${encodeURIComponent("SELECT Id FROM Account")}`);
    expect(init1.headers.Authorization).toBe("Bearer tok-1");
    expect(fetchMock.mock.calls[1][0]).toBe("https://acme.my.salesforce.com/services/data/v62.0/query/01g-2");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the tooling endpoint", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { totalSize: 0, done: true, records: [] }));
    await directQuery("SELECT Id FROM ApexClass", ORG, fetcher, { tooling: true, maxRows: 10 });
    expect(fetchMock.mock.calls[0][0]).toContain("/services/data/v62.0/tooling/query?q=");
  });

  it("stops at maxRows and flags the result truncated", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { totalSize: 9000, done: false, records: Array.from({ length: 2000 }, (_, i) => ({ Id: String(i) })), nextRecordsUrl: "/next" })
    );
    const out = await directQuery("SELECT Id FROM Account", ORG, fetcher, { maxRows: 3000 });
    expect(out?.ok).toBe(true);
    if (!out?.ok) return;
    expect(out.data.records).toHaveLength(3000);
    expect(out.data.truncated).toBe(true);
    expect(out.data.totalSize).toBe(9000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns Salesforce errors with their code so callers' error matching still works", async () => {
    fetchMock.mockResolvedValueOnce(json(400, [{ errorCode: "INVALID_TYPE", message: "sObject type 'Nope' is not supported." }]));
    const out = await directQuery("SELECT Id FROM Nope", ORG, fetcher, { maxRows: 10 });
    expect(out).toEqual({ ok: false, status: 400, error: "INVALID_TYPE: sObject type 'Nope' is not supported." });
  });

  it("re-reads the login once on 401", async () => {
    fetcher.mockResolvedValueOnce(creds).mockResolvedValueOnce({ ...creds, accessToken: "tok-2" });
    fetchMock.mockResolvedValueOnce(json(401, [{ errorCode: "INVALID_SESSION_ID" }])).mockResolvedValueOnce(json(200, { totalSize: 0, done: true, records: [] }));
    const out = await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 });
    expect(out?.ok).toBe(true);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer tok-2");
  });

  it("falls back (null) when the refreshed token is the same expired one", async () => {
    fetchMock.mockResolvedValue(json(401, [{ errorCode: "INVALID_SESSION_ID" }]));
    expect(await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 })).toBeNull();
  });

  it("turns itself off for the org after a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 })).toBeNull();
    expect(await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Other orgs keep the fast path.
    fetchMock.mockResolvedValueOnce(json(200, { totalSize: 0, done: true, records: [] }));
    expect((await directQuery("SELECT Id FROM User", "other", fetcher, { maxRows: 10 }))?.ok).toBe(true);
  });

  it("reports a timeout as timedOut instead of falling back", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const out = await directQuery("SELECT COUNT() FROM Task", ORG, fetcher, { maxRows: 10, timeoutMs: 1000 });
    expect(out).toEqual({ ok: false, timedOut: true, error: "Query timed out after 1s" });
  });

  it("retries a 5xx before giving up", async () => {
    fetchMock.mockResolvedValueOnce(json(503, [{ message: "busy" }])).mockResolvedValueOnce(json(200, { totalSize: 1, done: true, records: [{ Id: "1" }] }));
    const out = await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 });
    expect(out?.ok).toBe(true);
  });

  it("leaves URLs too long for a GET to the CLI", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `'001000000000${String(i).padStart(3, "0")}'`).join(",");
    const q = `SELECT Id FROM Contact WHERE AccountId IN (${ids})`;
    expect(encodeURIComponent(q).length).toBeGreaterThan(MAX_GET_URL_CHARS);
    expect(await directQuery(q, ORG, fetcher, { maxRows: 10 })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends a token to a non-https instance", async () => {
    fetcher.mockResolvedValue({ ...creds, instanceUrl: "http://evil.example.com" });
    expect(await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is off when LSC_SF_DIRECT=0", async () => {
    process.env.LSC_SF_DIRECT = "0";
    expect(await directQuery("SELECT Id FROM User", ORG, fetcher, { maxRows: 10 })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    delete process.env.LSC_SF_DIRECT;
  });

  it("directGet returns parsed JSON and raw text", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { listviews: [] })).mockResolvedValueOnce(new Response("plain", { status: 200 }));
    expect(await directGet("/services/data/v62.0/sobjects/Account/listviews", ORG, fetcher)).toEqual({ ok: true, data: { listviews: [] } });
    expect(await directGet("/services/data/v62.0/x", ORG, fetcher)).toEqual({ ok: true, data: "plain" });
    expect(await directGet("services/no-slash", ORG, fetcher)).toBeNull();
  });
});

describe("Limiter", () => {
  it("never runs more than its limit at once and runs everything", async () => {
    const limiter = new Limiter(() => 3);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limiter.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 1 + (i % 3)));
          running--;
          done.push(i);
        })
      )
    );
    expect(peak).toBe(3);
    expect(done).toHaveLength(20);
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
  });

  it("lets urgent calls (and everything started in an urgentScope) pass a full queue, within the reserve", async () => {
    const limiter = new Limiter(() => 1);
    const order: string[] = [];
    let release!: () => void;
    const hold = limiter.run(() => new Promise<void>((r) => (release = r)));
    const queued = [1, 2, 3].map((i) => limiter.run(async () => void order.push(`bg${i}`)));
    await limiter.run(async () => void order.push("urgent"), { urgent: true });
    await urgentScope(async () => {
      await Promise.resolve();
      await limiter.run(async () => void order.push("scoped"));
    });
    expect(order).toEqual(["urgent", "scoped"]);
    release();
    await Promise.all([hold, ...queued]);
    expect(order.slice(2)).toEqual(["bg1", "bg2", "bg3"]);
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
  });

  it("frees the slot when the call throws", async () => {
    const limiter = new Limiter(() => 1);
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.run(async () => "ok")).toBe("ok");
  });
});

describe("markTruncated", () => {
  it("flags fewer records than matched", () => {
    expect(markTruncated("SELECT Id FROM Account", { totalSize: 60_000, done: false, records: [{}, {}] }).truncated).toBe(true);
  });
  it("leaves COUNT() and complete results alone", () => {
    expect(markTruncated("select count() from Account", { totalSize: 60_000, done: true, records: [] }).truncated).toBeUndefined();
    expect(markTruncated("SELECT Id FROM Account LIMIT 2", { totalSize: 2, done: true, records: [{}, {}] }).truncated).toBeUndefined();
  });
});
