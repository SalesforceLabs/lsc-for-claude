import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrievedFilesText } from "../../../src/tools/metadata.js";

function tree(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "retrieved-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe("retrievedFilesText", () => {
  it("puts each retrieved file's text in the result, in path order", () => {
    const dir = tree({
      "flows/Quote_Approval.flow-meta.xml": "<Flow>approve</Flow>",
      "flows/A.flow-meta.xml": "<Flow>a</Flow>",
    });
    const out = retrievedFilesText(dir);
    expect(out).toContain("<Flow>approve</Flow>");
    expect(out.indexOf("A.flow-meta.xml")).toBeLessThan(out.indexOf("Quote_Approval"));
  });

  it("names the files that don't fit instead of cutting them", () => {
    const dir = tree({ "a.xml": "x".repeat(50), "b.xml": "y".repeat(50) });
    const out = retrievedFilesText(dir, 80);
    expect(out).toContain("x".repeat(50));
    expect(out).not.toContain("y".repeat(50));
    expect(out).toMatch(/Not shown \(too large or binary\): b\.xml/);
  });

  it("returns nothing for a missing folder", () => {
    expect(retrievedFilesText("/nonexistent/retrieve-output")).toBe("");
  });
});
