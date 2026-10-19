import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directPostRead, directDownload, resetDirect } from "../../../src/salesforce/direct.js";

const ORG = "post-org";
const creds = { accessToken: "tok-1", instanceUrl: "https://acme.my.salesforce.com", apiVersion: "62.0" };

describe("directPostRead", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetDirect();
    delete process.env.LSC_SF_DIRECT;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the body as JSON with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [[1]] }), { status: 200 }));
    const out = await directPostRead("/services/data/v62.0/ssot/query-sql", { sql: "SELECT 1" }, ORG, async () => creds);
    expect(out).toEqual({ ok: true, data: { data: [[1]] } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.my.salesforce.com/services/data/v62.0/ssot/query-sql");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ sql: "SELECT 1" });
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("reports an HTTP error instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 403 }));
    const out = await directPostRead("/services/data/v62.0/x", {}, ORG, async () => creds);
    expect(out && !out.ok && out.status).toBe(403);
  });

  it("returns null (use the CLI) without credentials or for a non-relative endpoint", async () => {
    expect(await directPostRead("/x", {}, ORG, async () => null)).toBeNull();
    expect(await directPostRead("https://evil.example/x", {}, ORG, async () => creds)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("directDownload", () => {
  const fetchMock = vi.fn();
  let dir: string;
  beforeEach(() => {
    resetDirect();
    delete process.env.LSC_SF_DIRECT;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    dir = mkdtempSync(join(tmpdir(), "dl-"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams the body to the file and leaves no partial", async () => {
    fetchMock.mockResolvedValueOnce(new Response("hello world", { status: 200 }));
    const dest = join(dir, "a.bin");
    const out = await directDownload("/services/data/v62.0/sobjects/ContentVersion/068/VersionData", dest, ORG, async () => creds);
    expect(out).toEqual({ ok: true, data: { bytes: 11 } });
    expect(readFileSync(dest, "utf8")).toBe("hello world");
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("writes nothing on an HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const dest = join(dir, "b.bin");
    const out = await directDownload("/x", dest, ORG, async () => creds);
    expect(out && !out.ok && out.status).toBe(404);
    expect(existsSync(dest)).toBe(false);
  });
});
