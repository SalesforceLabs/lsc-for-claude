import { describe, it, expect } from "vitest";
import { sseData } from "../../../src-electron/llm/http.js";

function streamOf(chunks: string[], thenHang: boolean): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else if (!thenHang) controller.close();
      // else: never enqueue again — a connection that went silent
      return new Promise((r) => setTimeout(r, 0));
    },
  });
  return new Response(body);
}

describe("sseData", () => {
  it("yields data lines and ends with the stream", async () => {
    const out: string[] = [];
    for await (const d of sseData(streamOf(["data: a\n", "data: b\n"], false), 1000)) out.push(d);
    expect(out).toEqual(["a", "b"]);
  });

  it("throws when the stream goes silent instead of waiting forever", async () => {
    const out: string[] = [];
    await expect(
      (async () => {
        for await (const d of sseData(streamOf(["data: a\n"], true), 50)) out.push(d);
      })()
    ).rejects.toThrow(/stopped arriving/);
    expect(out).toEqual(["a"]);
  });
});
