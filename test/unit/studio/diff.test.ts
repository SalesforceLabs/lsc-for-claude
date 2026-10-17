import { describe, it, expect } from "vitest";
import { lineCount, lineDiff } from "../../../src/studio/diff.js";

describe("lineDiff", () => {
  it("is empty for identical text", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([]);
  });

  it("marks changed lines with context and skips long unchanged stretches", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    expect(lineDiff(before, after)).toEqual(["  line 8", "  line 9", "- line 10", "+ line ten", "  line 11", "  line 12"]);
  });

  it("shows pure insertions and deletions", () => {
    expect(lineDiff("a\nc", "a\nb\nc")).toEqual(["  a", "+ b", "  c"]);
    expect(lineDiff("a\nb\nc", "a\nc")).toEqual(["  a", "- b", "  c"]);
  });

  it("marks skipped stretches between hunks and treats CRLF like LF", () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\r\n");
    const after = before.replace("l2", "x").replace("l25", "y");
    const diff = lineDiff(before, after);
    expect(diff).toContain("…");
    expect(diff).toContain("- l2");
    expect(diff).toContain("+ y");
    expect(lineCount(before)).toBe(30);
  });
});
