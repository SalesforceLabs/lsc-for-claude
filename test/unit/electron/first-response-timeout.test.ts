import { describe, it, expect } from "vitest";
import { apiFetch, type HttpOptions } from "../../../src-electron/llm/http.js";
import { TokenSource } from "../../../src-electron/llm/token-source.js";

/** A fetch that never answers until its signal aborts — a gateway holding the request open. */
const hangingFetch = (url: string, init?: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    if (init?.signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError"))
    );
  });

const options = (fetch: HttpOptions["fetch"]): HttpOptions => ({
  baseUrl: "https://gateway.example.com",
  tokens: TokenSource.fixed("t"),
  authHeader: "bearer" as HttpOptions["authHeader"],
  service: "The gateway",
  fetch,
});

describe("apiFetch first-response timeout", () => {
  it("gives up with a clear error when the response never starts", async () => {
    await expect(
      apiFetch(options(hangingFetch), "anthropic", "/v1/messages", {
        method: "POST",
        body: {},
        firstResponseMs: 30,
      })
    ).rejects.toThrow(/didn't start answering within 0 s/);
  });

  it("passes the caller's abort through as an abort, not a timeout", async () => {
    const controller = new AbortController();
    const p = apiFetch(options(hangingFetch), "anthropic", "/v1/messages", {
      method: "POST",
      body: {},
      signal: controller.signal,
      firstResponseMs: 10_000,
    });
    controller.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });

  it("doesn't cut a response that started in time", async () => {
    let seen: AbortSignal | undefined;
    const quick = async (_: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Response("ok");
    };
    const res = await apiFetch(options(quick), "anthropic", "/v1/messages", {
      method: "POST",
      body: {},
      firstResponseMs: 20,
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(seen?.aborted).toBe(false);
    expect(await res.text()).toBe("ok");
  });
});
