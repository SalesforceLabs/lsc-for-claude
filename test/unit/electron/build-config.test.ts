import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { parseBuildConfig } from "../../../src-electron/build-config.js";

describe("parseBuildConfig", () => {
  it("reads a trimmed mobile consumer key", () => {
    expect(parseBuildConfig('{"mobileClientId":"  abc  "}')).toEqual({ mobileClientId: "abc" });
  });

  it("treats empty, malformed or wrongly typed files as no config", () => {
    expect(parseBuildConfig("{}")).toEqual({});
    expect(parseBuildConfig("not json")).toEqual({});
    expect(parseBuildConfig("null")).toEqual({});
    expect(parseBuildConfig('{"mobileClientId":42}')).toEqual({});
    expect(parseBuildConfig('{"mobileClientId":"   "}')).toEqual({});
  });
});

describe("write-build-config.mjs", () => {
  const out = path.resolve("dist-electron/build-config.json");
  const run = (env: Record<string, string | undefined>) => {
    const { LSC_MOBILE_CLIENT_ID: _drop, ...base } = process.env;
    execFileSync("node", ["scripts/write-build-config.mjs"], { env: { ...base, ...env }, stdio: "pipe" });
    return parseBuildConfig(fs.readFileSync(out, "utf8"));
  };

  it("writes the key from the environment, and nothing without it", () => {
    const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    try {
      expect(run({ LSC_MOBILE_CLIENT_ID: "test-key" })).toEqual({ mobileClientId: "test-key" });
      expect(run({})).toEqual({});
    } finally {
      if (before === null) fs.rmSync(out, { force: true });
      else fs.writeFileSync(out, before);
    }
  });
});
