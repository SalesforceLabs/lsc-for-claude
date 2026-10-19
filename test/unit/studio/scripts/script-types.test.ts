import { describe, it, expect } from "vitest";
import * as fs from "fs";

const read = (p: string) => fs.readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf-8");

describe("script types copy", () => {
  it("the renderer's script-types.ts is byte-identical to the server's types.ts", () => {
    expect(read("src-renderer/components/studio/scripts/script-types.ts")).toBe(read("src/studio/scripts/types.ts"));
  });
});
