import { describe, expect, it } from "vitest";
import { highlight, langOf } from "../../../src-renderer/components/studio/builder/highlight";

describe("app builder highlighter", () => {
  it("picks a language by extension", () => {
    expect(langOf("lwc/x/x.js")).toBe("js");
    expect(langOf("lwc/x/x.html")).toBe("html");
    expect(langOf("lwc/x/x.css")).toBe("css");
    expect(langOf("lwc/x/x.js-meta.xml")).toBe("xml");
    expect(langOf("README")).toBe("text");
  });

  it("returns one token list per line and keeps the text intact", () => {
    const src = "const a = 'x';\n// note\nreturn a;";
    const lines = highlight(src, "js");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.map((t) => t.text).join("")).join("\n")).toBe(src);
    expect(lines[0].find((t) => t.text === "const")?.cls).toBe("kw");
    expect(lines[1].some((t) => t.cls === "com")).toBe(true);
  });

  it("keeps blank lines", () => {
    expect(highlight("a\n\nb", "text")).toHaveLength(3);
  });
});
