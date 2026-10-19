import { describe, it, expect } from "vitest";
import {
  canRetry,
  describeDiff,
  diffStats,
  extractCode,
  isSendKey,
  problemCount,
  replySummary,
  requestMessages,
  splitReply,
  starterPrompts,
  testFailed,
  type AssistMessage,
} from "../../../src-renderer/components/studio/scripts/script-assist-logic";

const msg = (role: "user" | "assistant", text: string, status: AssistMessage["status"] = "done"): AssistMessage => ({
  id: Math.random().toString(),
  role,
  text,
  status,
  tools: [],
});

describe("splitReply", () => {
  it("separates prose from the script", () => {
    const segs = splitReply("Added a check.\n\n```javascript\n(() => [])();\n```\nDone.");
    expect(segs).toEqual([
      { kind: "prose", text: "Added a check." },
      { kind: "code", code: "(() => [])();" },
      { kind: "prose", text: "Done." },
    ]);
  });
  it("shows a half-written script as a placeholder", () => {
    expect(splitReply("Working.\n```javascript\n(() => {\n  var a")).toEqual([
      { kind: "prose", text: "Working." },
      { kind: "writing" },
    ]);
  });
  it("accepts js fences and ignores other languages", () => {
    expect(extractCode("```js\nx()\n```")).toBe("x()");
    expect(extractCode("```json\n{}\n```")).toBeNull();
    expect(extractCode("Just an answer.")).toBeNull();
  });
  it("summarises without the code", () => {
    expect(replySummary("- one\n```javascript\nx\n```")).toBe("- one");
  });
});

describe("diffStats", () => {
  it("counts added and removed lines", () => {
    expect(diffStats("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
    expect(diffStats("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
    expect(diffStats("", "a\nb")).toEqual({ added: 2, removed: 0 });
    expect(diffStats("a\nb", "")).toEqual({ added: 0, removed: 2 });
  });
  it("ignores trailing blank lines", () => {
    expect(diffStats("a\n", "a")).toEqual({ added: 0, removed: 0 });
  });
  it("describes it", () => {
    expect(describeDiff({ added: 12, removed: 3 })).toBe("+12 −3 lines");
    expect(describeDiff({ added: 1, removed: 0 })).toBe("+1 line");
    expect(describeDiff({ added: 0, removed: 0 })).toBe("No changes");
  });
});

describe("starters and chips", () => {
  it("tailors prompts to the type", () => {
    expect(starterPrompts("VisitActionValidation", "ProviderVisit")[0]).toMatch(/Submit/);
    expect(starterPrompts("Checklist", "Inquiry").join(" ")).toMatch(/Inquiry/);
    expect(starterPrompts("Validation", null).length).toBeGreaterThanOrEqual(3);
  });
  it("counts problems and failed tests", () => {
    expect(problemCount([{ id: "a", severity: "error", message: "" }, { id: "b", severity: "info", message: "" }, { id: "c", severity: "warning", message: "" }])).toBe(2);
    expect(problemCount(undefined)).toBe(0);
    expect(testFailed({ ok: false })).toBe(true);
    expect(testFailed({ ok: true })).toBe(false);
    expect(testFailed(undefined)).toBe(false);
  });
});

describe("requestMessages", () => {
  it("drops old scripts, unfinished replies, and merges neighbours", () => {
    const out = requestMessages([
      msg("user", "write it"),
      msg("assistant", "Here.\n```javascript\nbig()\n```"),
      msg("user", "again"),
      msg("assistant", "boom", "error"),
      msg("user", "please"),
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[1].content).toContain("Here.");
    expect(out[1].content).not.toContain("big()");
    expect(out[2].content).toBe("again\n\nplease");
  });
  it("knows when the last reply failed", () => {
    expect(canRetry([msg("user", "x"), msg("assistant", "", "error")])).toBe(true);
    expect(canRetry([msg("user", "x")])).toBe(false);
  });
});

describe("isSendKey", () => {
  const k = (o: Partial<Parameters<typeof isSendKey>[0]>) => isSendKey({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, ...o });
  it("sends on Enter and ⌘Enter, not Shift+Enter or while composing", () => {
    expect(k({})).toBe(true);
    expect(k({ metaKey: true })).toBe(true);
    expect(k({ shiftKey: true })).toBe(false);
    expect(k({ isComposing: true })).toBe(false);
    expect(k({ key: "a" })).toBe(false);
  });
});
