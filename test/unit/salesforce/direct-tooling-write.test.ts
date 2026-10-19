import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { directToolingWrite, resetDirect } from "../../../src/salesforce/direct.js";

const ORG = "write-org";
const creds = { accessToken: "tok-1", instanceUrl: "https://acme.my.salesforce.com", apiVersion: "62.0" };
const ID = "0aB000000000001AAA";

describe("directToolingWrite", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetDirect();
    delete process.env.LSC_SF_DIRECT;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a record and returns its id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: ID, success: true }), { status: 201 }));
    const out = await directToolingWrite("POST", "LifeSciConfigFieldValue", null, { Value: "x" }, ORG, async () => creds);
    expect(out).toEqual({ ok: true, data: { id: ID, success: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.my.salesforce.com/services/data/v62.0/tooling/sobjects/LifeSciConfigFieldValue");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ Value: "x" });
  });

  it("updates and deletes by id, with no body on a delete", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await directToolingWrite("PATCH", "LifeSciConfigRecord", ID, { IsActive: false }, ORG, async () => creds)).toEqual({ ok: true, data: undefined });
    expect(await directToolingWrite("DELETE", "LifeSciConfigAssignment", ID, undefined, ORG, async () => creds)).toEqual({ ok: true, data: undefined });
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[1][0]).toBe(`https://acme.my.salesforce.com/services/data/v62.0/tooling/sobjects/LifeSciConfigAssignment/${ID}`);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });

  it("never sends a create twice: no retry on a 5xx, and a lost connection is a failure, not a fallback", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 503 }));
    const failed = await directToolingWrite("POST", "LifeSciConfigFieldValue", null, {}, ORG, async () => creds);
    expect(failed && !failed.ok && failed.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError("socket hang up"));
    const lost = await directToolingWrite("POST", "LifeSciConfigFieldValue", null, {}, ORG, async () => creds);
    expect(lost && !lost.ok).toBe(true);
  });

  it("retries an update on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await directToolingWrite("PATCH", "LifeSciConfigRecord", ID, { IsActive: true }, ORG, async () => creds)).toEqual({ ok: true, data: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the org's refusal", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ errorCode: "FIELD_INTEGRITY_EXCEPTION", message: "bad value" }]), { status: 400 }));
    const out = await directToolingWrite("PATCH", "LifeSciConfigFieldValue", ID, {}, ORG, async () => creds);
    expect(out).toEqual({ ok: false, status: 400, error: "FIELD_INTEGRITY_EXCEPTION: bad value" });
  });

  it("returns null (use the CLI) for other types, bad ids, no credentials, or when turned off", async () => {
    expect(await directToolingWrite("PATCH", "ApexClass", ID, {}, ORG, async () => creds)).toBeNull();
    expect(await directToolingWrite("PATCH", "LifeSciConfigRecord", "bad/../id", {}, ORG, async () => creds)).toBeNull();
    expect(await directToolingWrite("POST", "LifeSciConfigRecord", ID, {}, ORG, async () => creds)).toBeNull();
    expect(await directToolingWrite("PATCH", "LifeSciConfigRecord", ID, {}, ORG, async () => null)).toBeNull();
    process.env.LSC_SF_DIRECT = "0";
    expect(await directToolingWrite("PATCH", "LifeSciConfigRecord", ID, {}, ORG, async () => creds)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
