import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "http";
import * as zlib from "zlib";
import type { AddressInfo } from "net";
import {
  describeNetwork,
  NETWORK_PROFILES,
  NetworkShaper,
  realLinkNote,
  resolveNetwork,
  TokenBucket,
  type Clock,
} from "../../../src/perf/device/network.js";
import { SIM_NETWORK_PROFILES } from "../../../src-renderer/components/studio/sim-types.js";
import { createHttp, prepareRequestBody, shapeHttp, type DeviceHttp } from "../../../src/perf/device/session.js";
import { chunkBytesForRam } from "../../../src/perf/device/metadata.js";
import { legacyBatchSize, maxResponseSizePerBatchMB, replayInitialSync, type ReplayContext } from "../../../src/perf/device/replay.js";
import type { SchemaTable } from "../../../src/perf/device/schema.js";

/** A virtual clock: sleeping advances time instantly, so a 100 s transfer takes no real time. */
function virtualClock(): Clock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

describe("profiles", () => {
  it("resolves presets, custom values and none", () => {
    expect(resolveNetwork(undefined)).toBeUndefined();
    expect(resolveNetwork({ profile: "none" })).toBeUndefined();
    expect(resolveNetwork({ profile: "3g" })).toMatchObject({ label: "3G", rttMs: 200, approximate: true });
    expect(resolveNetwork({ profile: "custom", rttMs: 80, downMbps: 12, upMbps: 3 })).toMatchObject({ label: "Custom", approximate: false, downMbps: 12 });
    expect(() => resolveNetwork({ profile: "custom", rttMs: 80 })).toThrow(/custom/);
  });

  it("keeps the renderer's copy of the presets in step", () => {
    expect(SIM_NETWORK_PROFILES).toEqual(NETWORK_PROFILES);
  });

  it("describes a run for the report", () => {
    expect(describeNetwork(undefined)).toMatch(/None/);
    expect(describeNetwork(resolveNetwork({ profile: "4g" }))).toBe("4G/LTE (approximate): 100 ms RTT, 50/10 Mbps down/up");
  });
});

describe("token bucket", () => {
  it("passes bytes at the configured rate", async () => {
    const clock = virtualClock();
    const bucket = new TokenBucket(8, clock); // 8 Mbps = 1,000,000 bytes/s
    await bucket.takeSliced(5_000_000);
    expect(clock.t / 1000).toBeCloseTo(5 - bucket.burstBytes / 1_000_000, 1);
  });

  it("splits one link between concurrent streams", async () => {
    // Real timers: four streams of 250 kB on a 1 MB/s link finish together near 1 s, not 0.25 s each.
    const bucket = new TokenBucket(8);
    const t0 = performance.now();
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        await bucket.takeSliced(250_000);
        done.push(performance.now() - t0);
      })
    );
    const total = Math.max(...done);
    expect(total).toBeGreaterThan(850);
    expect(total).toBeLessThan(1400);
    // Fair interleaving: the first stream does not finish long before the last.
    expect(Math.min(...done)).toBeGreaterThan(total * 0.6);
  });
});

describe("shapeHttp", () => {
  const ok: DeviceHttp = async () => ({ status: 200, headers: {}, body: Buffer.alloc(1_000_000), wireBytes: 1_000_000 });

  it("is the same function when there is no shaper (None adds no overhead)", () => {
    expect(shapeHttp(ok, undefined)).toBe(ok);
  });

  it("adds one RTT per request plus transfer time for the body", async () => {
    const clock = virtualClock();
    const shaper = new NetworkShaper(resolveNetwork({ profile: "custom", rttMs: 100, downMbps: 8, upMbps: 8 })!, clock);
    const res = await shapeHttp(ok, shaper)({ method: "GET", url: "/x" });
    expect(res.status).toBe(200);
    // 100 ms RTT + 1,000,000 B at 1 MB/s (less the idle burst credit).
    expect(clock.t / 1000).toBeCloseTo(0.1 + 1 - shaper.down.burstBytes / 1_000_000, 1);
  });

  it("charges the request body to the uplink", async () => {
    const clock = virtualClock();
    const shaper = new NetworkShaper(resolveNetwork({ profile: "custom", rttMs: 0, downMbps: 800, upMbps: 0.8 })!, clock); // 100 kB/s up
    const tiny: DeviceHttp = async () => ({ status: 200, headers: {}, body: Buffer.alloc(0) });
    await shapeHttp(tiny, shaper)({ method: "POST", url: "/x", body: "a".repeat(200_000) });
    expect(clock.t / 1000).toBeCloseTo(2 - shaper.up.burstBytes / 100_000, 1);
  });

  it("leaves a streaming transport to throttle itself", async () => {
    const clock = virtualClock();
    const shaper = new NetworkShaper(resolveNetwork({ profile: "custom", rttMs: 0, downMbps: 8, upMbps: 8 })!, clock);
    const streaming: DeviceHttp = Object.assign(async () => ({ status: 200, headers: {}, body: Buffer.alloc(1_000_000), shaped: true }), { streamsShaping: true });
    await shapeHttp(streaming, shaper)({ method: "GET", url: "/x" });
    expect(clock.t).toBe(0);
  });
});

describe("realLinkNote", () => {
  const n = resolveNetwork({ profile: "4g" })!;
  it("flags a transfer well below the profile and stays quiet otherwise", () => {
    expect(realLinkNote(n, 10_000_000, 20)).toMatch(/slower than the profile/); // 4 Mbps vs 50
    expect(realLinkNote(n, 10_000_000, 1.7)).toBeUndefined(); // 47 Mbps
    expect(realLinkNote(n, 1000, 5)).toBeUndefined(); // too small to measure
  });
});

describe("request gzip", () => {
  const big = JSON.stringify({ fields: Array.from({ length: 400 }, (_, i) => `Field${i}__c`) });
  
  it("compresses an opted-in Connect body of 4 KB or more", () => {
    const r = prepareRequestBody({ url: "/services/data/v67.0/connect/x", body: big, gzip: true });
    expect(r.gzipped).toBe(true);
    expect(zlib.gunzipSync(r.body!).toString()).toBe(big);
  });

  it("sends small, non-Connect and non-opted-in bodies as they are", () => {
    expect(prepareRequestBody({ url: "/services/data/v67.0/connect/x", body: "{}", gzip: true }).gzipped).toBe(false);
    expect(prepareRequestBody({ url: "/services/data/v67.0/composite/batch", body: big, gzip: true }).gzipped).toBe(false);
    expect(prepareRequestBody({ url: "/services/data/v67.0/connect/x", body: big }).gzipped).toBe(false);
  });
});

describe("node transport", () => {
  let server: http.Server;
  let base = "";
  let seen: http.IncomingHttpHeaders = {};
  let seenBody = Buffer.alloc(0);
  const payload = Buffer.from(JSON.stringify({ records: Array.from({ length: 500 }, (_, i) => ({ Id: `001${i}` })) }));
  const gz = zlib.gzipSync(payload);

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      seen = req.headers;
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        seenBody = Buffer.concat(parts);
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        res.end(gz);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("advertises compression, decodes the response and counts wire bytes", async () => {
    const send = createHttp(base, "tok");
    const res = await send({ method: "GET", url: "/q" });
    expect(String(seen["accept-encoding"])).toContain("gzip");
    expect(res.body.equals(payload)).toBe(true);
    expect(res.wireBytes).toBe(gz.length);
    expect(gz.length).toBeLessThan(payload.length);
  });

  it("gzips an opted-in Connect request body", async () => {
    const big = JSON.stringify({ fields: Array.from({ length: 400 }, (_, i) => `Field${i}__c`) });
    await createHttp(base, "tok")({ method: "POST", url: "/services/data/v67.0/connect/x", body: big, gzip: true });
    expect(seen["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(seenBody).toString()).toBe(big);
  });

  it("refuses absolute URLs that are not HTTPS Salesforce hosts and sends no Authorization", async () => {
    const fetchImpl = vi.fn();
    const send = createHttp("https://x.my.salesforce.com", "secret-token", fetchImpl as unknown as typeof fetch);
    for (const url of ["https://evil.example.com/a", "http://x.my.salesforce.com/a", "//evil.example.com/a", "ftp://x.salesforce.com/a"]) {
      await expect(send({ method: "GET", url })).rejects.toThrow(/Refusing/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    // The real transport refuses too: nothing reaches the local server.
    seen = {};
    await expect(createHttp(base, "secret-token")({ method: "GET", url: base + "/q" })).rejects.toThrow(/Refusing/);
    expect(seen.authorization).toBeUndefined();
  });

  it("still allows relative paths and the org's own HTTPS hosts", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const send = createHttp("https://x.my.salesforce.com", "t", fetchImpl as unknown as typeof fetch);
    await send({ method: "GET", url: "/services/data/v67.0/x" });
    await send({ method: "GET", url: "https://x.file.force.com/sfc/z" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses another org's Salesforce hosts, such as its Sites pages", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const send = createHttp("https://x.my.salesforce.com", "t", fetchImpl as unknown as typeof fetch);
    await expect(send({ method: "GET", url: "https://y.file.force.com/sfc/z" })).rejects.toThrow(/this org/);
    await expect(send({ method: "GET", url: "https://attacker.secure.force.com/apex/grab" })).rejects.toThrow(/this org/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throttles the download of a shaped request", async () => {
    const shaper = new NetworkShaper(resolveNetwork({ profile: "custom", rttMs: 0, downMbps: 0.1, upMbps: 100 })!); // 12.5 kB/s
    const send = shapeHttp(createHttp(base, "tok"), shaper);
    const t0 = performance.now();
    const res = await send({ method: "GET", url: "/q" });
    const seconds = (performance.now() - t0) / 1000;
    expect(res.shaped).toBe(true);
    expect(seconds).toBeGreaterThan(gz.length / 12_500 - 0.3);
  });
});

describe("device RAM", () => {
  it("sizes metadata chunks like FileDownloadContext.chunkSizeForDevice", () => {
    expect(chunkBytesForRam(8)).toBe(10 * 1024 * 1024);
    expect(chunkBytesForRam(4)).toBe(10 * 1024 * 1024);
    expect(chunkBytesForRam(3)).toBe(2 * 1024 * 1024);
  });

  it("sizes legacy composite batches like DownloadManager.performRequests", () => {
    // 8 GB: (8 * 0.5 * 1024 - 300) / 4 / 3 = 316 MB per batch.
    expect(maxResponseSizePerBatchMB(8)).toBeCloseTo(316.33, 1);
    expect(legacyBatchSize({ estimatedResponseMB: 1, deviceRamGB: 8 })).toBe(15);
    expect(legacyBatchSize({ estimatedResponseMB: 40, deviceRamGB: 8 })).toBe(7);
    expect(legacyBatchSize({ estimatedResponseMB: 1000, deviceRamGB: 8 })).toBe(1);
    // 3 GB: (3 * 0.5 * 1024 - 300) / 12 = 103 MB.
    expect(legacyBatchSize({ estimatedResponseMB: 20, deviceRamGB: 3 })).toBe(5);
    expect(legacyBatchSize({ estimatedResponseMB: 20, deviceRamGB: 3, dynamic: false })).toBe(15);
    expect(legacyBatchSize({ estimatedResponseMB: 0, deviceRamGB: 3 })).toBe(15);
  });
});

describe("legacy paging", () => {
  const ctx: ReplayContext = { userId: "005U", territoryName: "T", territoryId: "0MIT", serverHandlesContentInList: false };
  const table: SchemaTable = {
    sobject: "Big__c", developerName: "Big__c", fields: ["Id"], attachmentsSupport: "none", userAccessEntities: "'*'", weight: 10, fromPermissionSet: false,
  };

  it("shrinks composite batches when a first page is large", async () => {
    const page = (n: number) => Buffer.from(JSON.stringify({ totalSize: 100, done: false, nextRecordsUrl: "/services/data/v67.0/query/01gL-2", records: [{ Id: "a", pad: "x".repeat(n) }, { Id: "b" }] }));
    const posts: number[] = [];
    const http: DeviceHttp = async (req) => {
      if (req.method === "GET") return { status: 200, headers: {}, body: page(70 * 1024 * 1024 / 2) };
      const body = JSON.parse(req.body ?? "{}");
      posts.push(body.batchRequests.length);
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ hasErrors: false, results: body.batchRequests.map(() => ({ statusCode: 200, result: { records: [] } })) })) };
    };
    // A ~35 MB first page on a 3 GB iPad fits 103 / 35 = 2 sub-requests per batch.
    await replayInitialSync({ session: { username: "u", instanceUrl: "https://x", apiVersion: "v67.0", http }, flow: "legacy", deviceRamGB: 3, context: ctx, syncStart: new Date(), tables: [table] });
    expect(Math.max(...posts)).toBe(2);
    expect(posts.reduce((a, b) => a + b, 0)).toBe(49);
  });
});
