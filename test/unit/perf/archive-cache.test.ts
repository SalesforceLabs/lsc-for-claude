import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import type { OrgQuerier } from "../../../src/perf/sync-volume.js";
import { privateTmp } from "../../../src/private-tmp.js";

const BODY = "not really a zip";
const CHECKSUM = createHash("md5").update(BODY).digest("hex");
const downloads: string[] = [];

vi.mock("../../../src/perf/device/metadata.js", () => ({
  downloadArchive: vi.fn(async (_s: unknown, _i: unknown, dir: string) => {
    const file = path.join(dir, "a.zip");
    fs.writeFileSync(file, BODY);
    downloads.push(file);
    return { file, bytes: BODY.length };
  }),
  readMetadataFiles: vi.fn(() => ({
    db: { Account: { SObject: "Account", DeveloperName: "DbSchema_Account" } },
    dbPs: {},
    config: {},
  })),
}));

const { createCompiledSchemaSource, clearArchiveCache } = await import("../../../src/perf/compiled-schema.js");

const ok = (records: Record<string, unknown>[]): CliResult<SoqlQueryResult> => ({
  success: true,
  data: { totalSize: records.length, done: true, records },
});

function org(checksum: string): OrgQuerier {
  return {
    soql: async (q) => {
      if (/FROM LifeSciMobileMetadataRecord/.test(q)) return ok([{ Id: "1KA1", MetadataDocumentId: "069D" }]);
      if (/FROM ContentVersion/.test(q)) return ok([{ Id: "068V", Checksum: checksum, ContentSize: BODY.length }]);
      return ok([]);
    },
    tooling: async () => ok([]),
  };
}

const user = { id: "005X", profileId: "00eX", profileName: "Rep", permissionSets: new Set<string>() };

describe("archive cache", () => {
  beforeEach(() => {
    downloads.length = 0;
    clearArchiveCache({ disk: true });
  });
  afterAll(() => clearArchiveCache({ disk: true }));

  it("downloads an archive once across sources, then reuses it", async () => {
    const getSession = vi.fn(async () => ({ apiVersion: "v60.0" }) as never);
    const first = await createCompiledSchemaSource({ org: org(CHECKSUM), getSession }).tablesFor(user);
    const second = await createCompiledSchemaSource({ org: org(CHECKSUM), getSession }).tablesFor(user);
    expect(downloads).toHaveLength(1);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect("result" in first && first.result.tables.map((t) => t.entry.sobject)).toEqual(["Account"]);
    expect(second).toEqual(first);
  });

  it("uses the zip on disk when memory is empty, and no session", async () => {
    await createCompiledSchemaSource({ org: org(CHECKSUM), getSession: async () => ({}) as never }).tablesFor(user);
    clearArchiveCache();
    const getSession = vi.fn();
    const r = await createCompiledSchemaSource({ org: org(CHECKSUM), getSession }).tablesFor(user);
    expect("result" in r).toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("does not trust a cached zip whose hash differs from the org's checksum", async () => {
    await createCompiledSchemaSource({ org: org(CHECKSUM), getSession: async () => ({}) as never }).tablesFor(user);
    clearArchiveCache();
    const dir = privateTmp("lsc-perf-md-cache");
    fs.writeFileSync(path.join(dir, `${CHECKSUM}.zip`), "tampered");
    const getSession = vi.fn(async () => ({}) as never);
    await createCompiledSchemaSource({ org: org(CHECKSUM), getSession }).tablesFor(user);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("downloads again when the org's archive changed", async () => {
    const getSession = vi.fn(async () => ({}) as never);
    await createCompiledSchemaSource({ org: org(CHECKSUM), getSession }).tablesFor(user);
    await createCompiledSchemaSource({ org: org("f".repeat(32)), getSession }).tablesFor(user);
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
