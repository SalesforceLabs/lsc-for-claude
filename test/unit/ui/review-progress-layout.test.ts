import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("ReviewProgress step rows", () => {
  it("keeps a step's label and its timing in one text span, so a long label doesn't squeeze them into flex columns", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../src-renderer/components/studio/ReviewProgress.tsx"), "utf8");
    const row = /<Mark state=\{s\.state\} \/>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/li>/.exec(src);
    expect(row?.[1]).toContain("{s.label}");
    expect(row?.[1]).toContain("{s.detail");
    expect(row?.[1]).toContain("stepTime(s, now)");
  });
});
