import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  clmCsp,
  clmFilePath,
  clmResponse,
  isEngineClmRoot,
  registerClmRoot,
  releaseClmRoot,
} from "../../../src-electron/clm-files.js";

let tmp: string;
let root: string;
let outside: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "clm-test-"));
  root = path.join(tmp, "lsc-501", "lsc-studio-clm");
  mkdirSync(path.join(root, "page_068"), { recursive: true });
  writeFileSync(path.join(root, "page_068", "01_index.html"), "<p>hi</p>");
  writeFileSync(path.join(root, "page_068", "movie.mp4"), "0123456789");
  outside = path.join(tmp, "secret.txt");
  writeFileSync(outside, "secret");
  symlinkSync(outside, path.join(root, "page_068", "link.txt"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("isEngineClmRoot", () => {
  it("accepts only <tmp>/lsc-*/lsc-studio-clm", () => {
    expect(isEngineClmRoot(root, tmp)).toBe(true);
    expect(isEngineClmRoot(path.join(root, "page_068"), tmp)).toBe(false);
    expect(isEngineClmRoot(path.join(tmp, "lsc-501"), tmp)).toBe(false);
    expect(isEngineClmRoot("/etc", tmp)).toBe(false);
    expect(isEngineClmRoot("relative/lsc-studio-clm", tmp)).toBe(false);
    expect(isEngineClmRoot(42, tmp)).toBe(false);
  });
});

describe("serving a registered folder", () => {
  let base: string;
  beforeAll(() => {
    base = registerClmRoot(root, tmp)!;
  });

  it("hands out a token URL", () => {
    expect(base).toMatch(/^lsc-frame:\/\/clm\/[0-9a-f-]{36}\/$/);
    expect(registerClmRoot("/etc", tmp)).toBeNull();
  });

  it("resolves files inside it and refuses traversal, links out and null bytes", () => {
    expect(clmFilePath(base + "page_068/01_index.html")?.file).toBe(
      realpathSync(path.join(root, "page_068", "01_index.html"))
    );
    expect(clmFilePath(base + "page_068/../../../secret.txt")).toBeNull();
    expect(clmFilePath(base + "page_068/%2e%2e/%2e%2e/%2e%2e/secret.txt")).toBeNull();
    expect(clmFilePath(base + "page_068/link.txt")).toBeNull();
    expect(clmFilePath(base + "page_068/01_index.html%00.png")).toBeNull();
    expect(
      clmFilePath("lsc-frame://clm/00000000-0000-0000-0000-000000000000/page_068/01_index.html")
    ).toBeNull();
    expect(clmFilePath("lsc-frame://doc/x")).toBeNull();
  });

  it("answers with the type, its own policy and byte ranges", async () => {
    const res = clmResponse(new Request(base + "page_068/01_index.html"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const token = base.split("/")[3];
    expect(res.headers.get("content-security-policy")).toBe(clmCsp(token));
    expect(await res.text()).toBe("<p>hi</p>");

    const part = clmResponse(
      new Request(base + "page_068/movie.mp4", { headers: { range: "bytes=2-5" } })
    );
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
    const tail = clmResponse(
      new Request(base + "page_068/movie.mp4", { headers: { range: "bytes=-3" } })
    );
    expect(await tail.text()).toBe("789");
    expect(
      clmResponse(new Request(base + "page_068/movie.mp4", { headers: { range: "bytes=20-" } }))
        .status
    ).toBe(416);
    expect(clmResponse(new Request(base + "page_068/nope.html")).status).toBe(404);
    expect(clmResponse(new Request(base + "page_068")).status).toBe(404);
  });

  it("keeps the slide off the network", () => {
    const csp = clmCsp("t");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src lsc-frame://clm/t/");
    expect(csp).not.toMatch(/https?:/);
  });

  it("stops serving once released", () => {
    releaseClmRoot(base);
    expect(clmFilePath(base + "page_068/01_index.html")).toBeNull();
  });
});
