import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { privateTmp } from "../../src/private-tmp.js";
import { isEngineZipPath } from "../../src-electron/app-files.js";

describe("privateTmp", () => {
  it("makes folders only this user can open, under one stable lsc-* folder", () => {
    const a = privateTmp("t-one");
    const b = privateTmp("t-two", "inner");
    expect(path.dirname(a)).toBe(path.dirname(path.dirname(b)));
    expect(path.basename(path.dirname(a))).toMatch(/^lsc-/);
    if (process.platform !== "win32") expect(fs.statSync(path.dirname(a)).mode & 0o077).toBe(0);
  });
});

describe("isEngineZipPath", () => {
  it("accepts the engine's downloads only", () => {
    const tmp = os.tmpdir();
    const zip = path.join(privateTmp("lsc-studio-cache-zips", "068000000000001AAA"), "cache.zip");
    expect(isEngineZipPath(zip, tmp)).toBe(true);
    expect(isEngineZipPath(path.join(tmp, "lsc-x", "elsewhere", "v", "cache.zip"), tmp)).toBe(false);
    expect(isEngineZipPath(path.join(tmp, "lsc-x", "lsc-studio-cache-zips", "v", "..", "..", "..", "..", "etc", "a.zip"), tmp)).toBe(false);
    expect(isEngineZipPath(path.join(os.homedir(), "a.zip"), tmp)).toBe(false);
    expect(isEngineZipPath(path.join(tmp, "lsc-x", "lsc-studio-cache-zips", "v", "notes.txt"), tmp)).toBe(false);
  });
});
