import { describe, expect, it } from "vitest";
import { DEVICES, fitDevice, orientedSize, parentBundle, suggestProfile, TARGETS, needsObject, targetLabel, applyEvent, chars, elapsed, fileOrder, isBuilding, projectStatus, relativeTime, versionNumber, versionSummary } from "../../../src-renderer/components/studio/builder/logic";
import type { AppProject, AppTurn, AppVersion } from "../../../src-renderer/components/studio/builder/types";

const turn = (over: Partial<AppTurn> = {}): AppTurn => ({ id: "t1", prompt: "p", at: "2026-10-01T10:00:00Z", status: "running", steps: [], reply: "", ...over });
const version = (id: string, over: Partial<AppVersion> = {}): AppVersion => ({
  id,
  at: "2026-10-01T10:05:00Z",
  source: "ai",
  files: [],
  check: { ok: true, issues: [], offline: {}, placeholders: [] },
  ...over,
});
const project = (over: Partial<AppProject> = {}): AppProject => ({
  id: "a",
  org: "o@x.com",
  name: "lscMobileInline_X",
  label: "X",
  target: "home",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
  turns: [],
  versions: [],
  currentVersionId: null,
  ...over,
});

describe("applyEvent", () => {
  it("adds a turn, then replaces it by id", () => {
    const a = applyEvent(project(), { type: "turn", turn: turn() });
    expect(a.turns).toHaveLength(1);
    const b = applyEvent(a, { type: "turn", turn: turn({ status: "done" }) });
    expect(b.turns).toHaveLength(1);
    expect(b.turns[0].status).toBe("done");
  });

  it("upserts steps and appends reply text", () => {
    let p = project({ turns: [turn()] });
    const step = { id: "s1", kind: "plan" as const, label: "Planning", status: "running" as const, startedAt: "2026-10-01T10:00:01Z" };
    p = applyEvent(p, { type: "step", turnId: "t1", step });
    p = applyEvent(p, { type: "step", turnId: "t1", step: { ...step, status: "done" } });
    p = applyEvent(p, { type: "reply-delta", turnId: "t1", text: "Hel" });
    p = applyEvent(p, { type: "reply-delta", turnId: "t1", text: "lo" });
    expect(p.turns[0].steps).toHaveLength(1);
    expect(p.turns[0].steps[0].status).toBe("done");
    expect(p.turns[0].reply).toBe("Hello");
  });

  it("ignores events for an unknown turn", () => {
    const p = project();
    expect(applyEvent(p, { type: "reply-delta", turnId: "nope", text: "x" })).toBe(p);
  });

  it("makes a new version current", () => {
    const p = applyEvent(project(), { type: "version", version: version("v1") });
    expect(p.currentVersionId).toBe("v1");
    expect(p.updatedAt).toBe("2026-10-01T10:05:00Z");
  });
});

describe("projectStatus", () => {
  it("is building while a turn runs", () => {
    const p = project({ turns: [turn()] });
    expect(isBuilding(p)).toBe(true);
    expect(projectStatus(p)).toBe("building");
  });
  it("is failed when the first turn failed with no version", () => {
    expect(projectStatus(project({ turns: [turn({ status: "failed" })] }))).toBe("failed");
  });
  it("is draft before a deploy", () => {
    expect(projectStatus(project({ turns: [turn({ status: "done" })], versions: [version("v1")], currentVersionId: "v1" }))).toBe("draft");
  });
  it("is deployed when the current version went out, changed after", () => {
    const base = { turns: [turn({ status: "done" as const })], versions: [version("v1"), version("v2")] };
    const deployed = { versionId: "v1", at: "2026-10-01T11:00:00Z", deployed: ["lscMobileInline_X"] };
    expect(projectStatus(project({ ...base, currentVersionId: "v1", deployed }))).toBe("deployed");
    expect(projectStatus(project({ ...base, currentVersionId: "v2", deployed }))).toBe("changed");
  });
});

describe("versions", () => {
  it("numbers from one, oldest first", () => {
    const p = project({ versions: [version("a"), version("b")] });
    expect(versionNumber(p, "b")).toBe(2);
    expect(versionNumber(p, null)).toBe(0);
  });
  it("summarises problems", () => {
    const issue = (severity: "error" | "warning") => ({ severity, rule: "r", message: "m" });
    const v = version("a", { check: { ok: false, issues: [issue("error"), issue("warning"), issue("warning")], offline: {}, placeholders: [] } });
    expect(versionSummary(project({ versions: [v] }), v)).toBe("v1 · 1 error · 2 warnings");
    const ok = version("b");
    expect(versionSummary(project({ versions: [ok] }), ok)).toBe("v1 · compiles");
  });
  it("lists the parent's markup first", () => {
    const files = [
      { bundle: "c", path: "lwc/c/c.js" },
      { bundle: "p", path: "lwc/p/p.js" },
      { bundle: "p", path: "lwc/p/p.html" },
    ];
    expect([...files].sort((a, b) => fileOrder(a, b, "p")).map((f) => f.path)).toEqual(["lwc/p/p.html", "lwc/p/p.js", "lwc/c/c.js"]);
  });
});

describe("formatting", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  it("relativeTime", () => {
    expect(relativeTime("2026-10-18T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-18T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-18T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-10-17T11:00:00Z", now)).toBe("1 day ago");
  });
  it("elapsed", () => {
    expect(elapsed({ startedAt: "2026-10-18T12:00:00Z", endedAt: "2026-10-18T12:00:02.500Z" })).toBe("2.5s");
    expect(elapsed({ startedAt: "2026-10-18T12:00:00Z", endedAt: "2026-10-18T12:01:05Z" })).toBe("1m 5s");
    expect(elapsed({ startedAt: "2026-10-18T12:00:00Z" }, now + 30_000)).toBe("30s");
  });
  it("chars", () => {
    expect(chars(420)).toBe("420 chars");
    expect(chars(2500)).toBe("2.5k chars");
  });
});

describe("targets", () => {
  it("offers the four targets and needs an object for record and action", () => {
    expect(TARGETS.map((t) => t.value)).toEqual(["home", "record", "action", "tab"]);
    expect(TARGETS.filter((t) => needsObject(t.value)).map((t) => t.value)).toEqual(["record", "action"]);
  });
  it("labels each target", () => {
    expect(targetLabel({ target: "home" })).toBe("Home page");
    expect(targetLabel({ target: "tab" })).toBe("Nav tab");
    expect(targetLabel({ target: "action", objectApiName: "Account" })).toBe("Account action");
  });
});

describe("device frame", () => {
  it("rotates the iPad and keeps its proportions", () => {
    expect(orientedSize(DEVICES.ipad, "landscape")).toEqual({ width: 1180, height: 820 });
    expect(orientedSize(DEVICES.ipad, "portrait")).toEqual({ width: 820, height: 1180 });
  });
  it("scales the whole device to fit, never clipped and never enlarged", () => {
    const wide = fitDevice(DEVICES.ipad, "landscape", { width: 600, height: 800 });
    expect(wide.width * wide.scale).toBeLessThanOrEqual(600);
    expect(wide.height * wide.scale).toBeLessThanOrEqual(800);
    const short = fitDevice(DEVICES.ipad, "portrait", { width: 2000, height: 500 });
    expect(short.height * short.scale).toBeLessThanOrEqual(500);
    expect(fitDevice(DEVICES.ipad, "landscape", { width: 5000, height: 5000 }).scale).toBe(1);
    expect(fitDevice(DEVICES.ipad, "landscape", { width: 0, height: 0 }).scale).toBe(1);
  });
  it("finds the parent bundle, not a child", () => {
    expect(parentBundle([{ bundle: "card" }, { bundle: "lscMobileInline_Todo" }], "x")).toBe("lscMobileInline_Todo");
    expect(parentBundle([], "lscMobileInline_X")).toBe("lscMobileInline_X");
  });
});

describe("suggestProfile", () => {
  const profiles = [
    { name: "System Administrator", users: 12 },
    { name: "Analytics Cloud Integration User", users: 3 },
    { name: "LS PH Field Sales Representative", users: 9 },
    { name: "LS PH District Manager", users: 4 },
    { name: "LS PH Key Account Manager", users: 0 },
  ];
  it("prefers the run-as user's profile when the org has it", () => {
    expect(suggestProfile(profiles, "LS PH District Manager")).toBe("LS PH District Manager");
  });
  it("otherwise picks the largest rep-like profile", () => {
    expect(suggestProfile(profiles)).toBe("LS PH Field Sales Representative");
    expect(suggestProfile(profiles, "Gone")).toBe("LS PH Field Sales Representative");
  });
  it("has no suggestion without candidates", () => {
    expect(suggestProfile([{ name: "System Administrator", users: 2 }])).toBeNull();
  });
});

describe("suggestProfile", () => {
  const profiles = [
    { name: "System Administrator", users: 5 },
    { name: "Standard User", users: 40 },
    { name: "LS PH Field Sales Representative", users: 8 },
    { name: "LS MT Field Sales Representative", users: 2 },
  ];
  it("prefers the run-as profile when the org has it", () => {
    expect(suggestProfile(profiles, "LS MT Field Sales Representative")).toBe("LS MT Field Sales Representative");
  });
  it("prefers the busiest field sales rep profile over a bigger generic one", () => {
    expect(suggestProfile(profiles)).toBe("LS PH Field Sales Representative");
  });
  it("falls back to the largest non-admin profile and skips empty ones", () => {
    expect(suggestProfile([{ name: "System Administrator", users: 5 }, { name: "Standard User", users: 3 }, { name: "Other", users: 0 }])).toBe("Standard User");
    expect(suggestProfile([{ name: "System Administrator", users: 5 }])).toBeNull();
  });
});

describe("fitDevice zoom", () => {
  const room = { width: 700, height: 500 };
  it("fits to the room by default and never scales up", () => {
    const f = fitDevice(DEVICES.ipad, "landscape", room);
    expect(f.scale).toBeLessThan(1);
    expect(f.scale).toBeCloseTo(Math.min(700 / f.width, 500 / f.height));
    expect(fitDevice(DEVICES.ipad, "landscape", { width: 5000, height: 5000 }).scale).toBe(1);
  });
  it("uses fixed scales for 75 and 100 regardless of room", () => {
    expect(fitDevice(DEVICES.ipad, "landscape", room, "75").scale).toBe(0.75);
    expect(fitDevice(DEVICES.ipad, "landscape", room, "100").scale).toBe(1);
  });
});
