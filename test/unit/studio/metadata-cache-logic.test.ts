import { describe, expect, it } from "vitest";
import {
  buildJobs,
  isPlainZipName,
  parseZipListing,
  profileRows,
  sniffFile,
  STALLED_MS,
} from "../../../src/studio/metadata-cache-logic.js";
import { jobOutcome } from "../../../src/studio/publish.js";

const rec = (o: Record<string, unknown>) => ({
  CreatedDate: "2026-10-01T10:00:00.000+0000",
  LastModifiedDate: "2026-10-01T10:05:00.000+0000",
  ...o,
});

describe("jobOutcome", () => {
  it("is done when the parent is Active", () => {
    expect(jobOutcome({ Status: "Active" }, [])).toEqual({ state: "done" });
  });
  it("is running while Published and a child has no document", () => {
    expect(jobOutcome({ Status: "Published" }, [{ Status: "Active" }])).toEqual({
      state: "running",
    });
  });
  it("fails on an Inactive child with its ErrorLog message", () => {
    const out = jobOutcome({ Status: "Published" }, [
      { Status: "Inactive", ErrorLog: '{"message":"Bad layout"}' },
    ]);
    expect(out).toEqual({ state: "failed", error: "Bad layout" });
  });
  it("keeps an Active job with an ErrorLog done", () => {
    expect(
      jobOutcome({ Status: "Active", ErrorLog: '{"message":"No StoreCheckFeature"}' }, []).state
    ).toBe("done");
  });
});

describe("buildJobs", () => {
  const now = Date.parse("2026-10-01T10:10:00Z");
  it("groups children under their parent, sorted by profile", () => {
    const jobs = buildJobs(
      [rec({ Id: "P1", Status: "Active", CreatedBy: { Name: "Ada" } })],
      [
        rec({
          Id: "C2",
          ParentMobileMetadataRecId: "P1",
          Status: "Active",
          Profile: { Name: "Zeta" },
          MetadataDocumentId: "D",
          MetadataDocument: { ContentSize: 10 },
        }),
        rec({
          Id: "C1",
          ParentMobileMetadataRecId: "P1",
          Status: "Active",
          Profile: { Name: "Alpha" },
        }),
      ],
      now
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "P1", state: "done", startedBy: "Ada" });
    expect(jobs[0].records.map((r) => r.profile)).toEqual(["Alpha", "Zeta"]);
    expect(jobs[0].records[1].sizeBytes).toBe(10);
  });
  it("calls a job that stopped moving failed", () => {
    const [job] = buildJobs(
      [rec({ Id: "P1", Status: "Published" })],
      [],
      Date.parse("2026-10-01T10:05:00Z") + STALLED_MS + 1
    );
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/Stopped without finishing/);
  });
  it("keeps a recent running job running", () => {
    expect(buildJobs([rec({ Id: "P1", Status: "Published" })], [], now)[0].state).toBe("running");
  });
});

describe("profileRows", () => {
  const profiles = [
    { id: "A", name: "Rep", users: 10 },
    { id: "B", name: "Manager", users: 2 },
    { id: "C", name: "New", users: 1 },
  ];
  const live = (id: string, profile: string, at: string) =>
    rec({
      Id: id,
      ProfileId: profile,
      Status: "Active",
      MetadataDocumentId: "D",
      CreatedDate: at,
      LastModifiedDate: at,
    });
  it("finds the live cache, a newer failed attempt and what's behind", () => {
    const rows = profileRows(
      profiles,
      [
        live("A1", "A", "2026-09-01T00:00:00Z"),
        rec({
          Id: "A2",
          ProfileId: "A",
          Status: "Inactive",
          ParentMobileMetadataRecId: "J",
          CreatedDate: "2026-10-01T00:00:00Z",
        }),
        live("B1", "B", "2026-09-01T00:00:00Z"),
      ],
      new Map([["J", { state: "failed" as const, error: "Bad layout" }]]),
      new Map([["B", 3]])
    );
    expect(rows.map((r) => [r.profile, r.state])).toEqual([
      ["Rep", "failed"],
      ["Manager", "behind"],
      ["New", "never"],
    ]);
    expect(rows[0].live?.id).toBe("A1");
    expect(rows[0].attemptError).toBe("Bad layout");
    expect(rows[1].unpublished).toBe(3);
    expect(rows[2].unpublished).toBeNull();
  });
  it("is current with nothing behind, and unknown counts stay null", () => {
    const [row] = profileRows(
      [profiles[0]],
      [live("A1", "A", "2026-09-01T00:00:00Z")],
      new Map(),
      null
    );
    expect(row.state).toBe("current");
    expect(row.unpublished).toBeNull();
  });
  it("ignores an older failed record", () => {
    const [row] = profileRows(
      [profiles[0]],
      [
        rec({ Id: "A0", ProfileId: "A", Status: "Inactive", CreatedDate: "2026-08-01T00:00:00Z" }),
        live("A1", "A", "2026-09-01T00:00:00Z"),
      ],
      new Map(),
      new Map()
    );
    expect(row.attempt).toBeNull();
    expect(row.state).toBe("current");
  });
});

describe("parseZipListing", () => {
  it("reads files and skips folders", () => {
    const out = [
      "Archive:  cache.zip",
      " Length   Method    Size  Cmpr    Date    Time   CRC-32   Name",
      "--------  ------  ------- ---- ---------- ----- --------  ----",
      "       0  Stored        0   0% 10-01-2026 10:00 00000000  layouts/",
      "   12345  Defl:N     2345  81% 10-01-2026 10:00 1a2b3c4d  layouts/Account Layout.json",
      "  100000  Defl:N    10000  90% 10-01-2026 10:00 deadbeef  db.json",
      "--------          -------  ---                            -------",
      "  112345            12345  89%                            2 files",
    ].join("\n");
    expect(parseZipListing(out)).toEqual([
      { path: "layouts/Account Layout.json", size: 12345, compressed: 2345 },
      { path: "db.json", size: 100000, compressed: 10000 },
    ]);
  });
});

describe("isPlainZipName / sniffFile", () => {
  it("refuses names unzip would read as patterns or options", () => {
    expect(isPlainZipName("nav.json")).toBe(true);
    expect(isPlainZipName("a*b.json")).toBe(false);
    expect(isPlainZipName("[x].json")).toBe(false);
    expect(isPlainZipName("-x")).toBe(false);
  });
  it("tells images, binary and text apart", () => {
    expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]))).toEqual({
      kind: "image",
      mime: "image/png",
    });
    expect(sniffFile(new Uint8Array([1, 0, 2]))).toEqual({ kind: "binary" });
    expect(sniffFile(new TextEncoder().encode('{"a":1}'))).toEqual({ kind: "text" });
  });
});
