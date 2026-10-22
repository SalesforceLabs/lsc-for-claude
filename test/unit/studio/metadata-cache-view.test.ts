import { describe, expect, it } from "vitest";
import {
  commonDir,
  filterFiles,
  formatDuration,
  groupFiles,
  parseJson,
  failedPublishPrompt,
  ASK_LOG_CHARS,
} from "../../../src-renderer/components/studio/metadata-cache-types";

describe("metadata cache view helpers", () => {
  it("finds the folder every file shares", () => {
    expect(commonDir(["Rep/metadata/a.json", "Rep/metadata/b/c.json"])).toBe("Rep/metadata/");
    expect(commonDir(["Rep/a.json", "Other/b.json"])).toBe("");
    expect(commonDir(["a.json"])).toBe("");
    expect(commonDir([])).toBe("");
  });
  it("filters files by path, ignoring case", () => {
    const files = [
      { path: "x/Nav.json", size: 1, compressed: 1 },
      { path: "x/db.json", size: 1, compressed: 1 },
    ];
    expect(filterFiles(files, " nav ").map((f) => f.path)).toEqual(["x/Nav.json"]);
    expect(filterFiles(files, "")).toHaveLength(2);
  });
  it("parses JSON objects and arrays only", () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson("42")).toEqual({ ok: false });
    expect(parseJson("{broken")).toEqual({ ok: false });
  });
  it("formats durations", () => {
    expect(formatDuration("2026-10-01T10:00:00Z", "2026-10-01T10:01:52Z")).toBe("1m 52s");
    expect(formatDuration("2026-10-01T10:00:00Z", "2026-10-01T09:00:00Z")).toBe("—");
  });
});

describe("groupFiles", () => {
  it("puts files under their folder, loose files first", () => {
    const f = (path: string) => ({ path, size: 1, compressed: 1 });
    const groups = groupFiles(
      [
        f("Rep/metadata/b.json"),
        f("Rep/top.json"),
        f("Rep/metadata/a.json"),
        f("Rep/images/x.png"),
      ],
      "Rep/"
    );
    expect(groups.map((g) => [g.folder, g.files.map((x) => x.name)])).toEqual([
      ["", ["top.json"]],
      ["images", ["x.png"]],
      ["metadata", ["b.json", "a.json"]],
    ]);
  });
});

describe("failedPublishPrompt", () => {
  const base = {
    profiles: ["LS PH Field Sales Representative"],
    startedAt: "2026-10-19T13:49:00Z",
    startedBy: "Admin2 User",
    error: "Unable to read SObject PresentationContent over REST",
  };

  it("names the profiles, the error and the log", () => {
    const p = failedPublishPrompt({ ...base, logs: [{ profile: null, log: "line 1\nline 2" }] });
    expect(p).toContain("LS PH Field Sales Representative");
    expect(p).toContain("by Admin2 User");
    expect(p).toContain("Salesforce's error: Unable to read SObject PresentationContent over REST");
    expect(p).toContain("line 1\nline 2");
  });

  it("says when there is no log", () => {
    expect(failedPublishPrompt({ ...base, logs: [] })).toContain("logged nothing");
  });

  it("cuts long logs", () => {
    const p = failedPublishPrompt({
      ...base,
      logs: [
        { profile: "A", log: "x".repeat(ASK_LOG_CHARS + 500) },
        { profile: "B", log: "never sent" },
      ],
    });
    expect(p).toContain("… (cut)");
    expect(p).not.toContain("never sent");
  });
});
