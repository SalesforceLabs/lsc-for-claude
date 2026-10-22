import { describe, it, expect } from "vitest";
import { awaitsPublish, profilesToPublish, reachLabel, reachOfChange, stillAwaiting } from "../../../src-renderer/components/studio/reach.js";
import {
  barVisible,
  ipadStepLabel,
  orgWideNote,
  primaryAction,
  profileOrgStep,
  sessionOrgStep,
} from "../../../src-renderer/components/studio/release-bar-logic.js";
import { responseError } from "../../../src-renderer/components/studio/usePublishJob.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { UnpublishedItem, UnpublishedState } from "../../../src-renderer/components/studio/org-ahead.js";
import type { PublishStatus, StudioFix } from "../../../src-renderer/components/studio/types.js";

const change = (fix: Partial<StudioFix> & { kind: StudioFix["kind"] }, affects?: string[]): PendingChange => ({
  fix: { label: fix.kind, ...fix } as StudioFix,
  ...(affects ? { affects } : {}),
});
const layout = (affects?: string[]) => change({ kind: "editMetadata", doc: { type: "Layout", fullName: "Account-Account Layout" } } as never, affects);
const listView = () => change({ kind: "editMetadata", doc: { type: "ListView", fullName: "Account.All" } } as never);
const dbSchema = (affects?: string[]) => change({ kind: "setConfigField", category: "DbSchema" } as never, affects);
const visitSetting = () => change({ kind: "setConfigField", category: "Visit" } as never);
const psl = () => change({ kind: "assignPsl" } as never);

const item = (id: string, extra: Partial<UnpublishedItem> = {}): UnpublishedItem => ({
  id,
  kind: "layout",
  name: id,
  label: id,
  lastModifiedAt: "2026-10-19T10:00:00Z",
  lastModifiedBy: "Admin",
  target: id,
  ...extra,
});
const ready = (items: UnpublishedItem[], extra: { noCache?: boolean; errors?: { kind: string; message: string }[] } = {}): UnpublishedState => ({
  status: "ready",
  result: {
    profile: "Rep",
    cacheAt: "2026-10-18T10:00:00Z",
    cacheStartedAt: null,
    checkedAt: "2026-10-19T10:00:00Z",
    items,
    errors: [],
    ...extra,
  } as never,
});
const job = (state: PublishStatus["state"], profiles = ["A", "B", "C"]): PublishStatus => ({ parentId: "x", state, status: state, profiles });

describe("reach", () => {
  it("classifies changes by where they land", () => {
    expect(reachOfChange(layout(["Rep"]))).toEqual({ desktop: "now", ipad: "publish", profiles: ["Rep"] });
    expect(reachOfChange(listView())).toEqual({ desktop: "now", ipad: "live" });
    expect(reachOfChange(dbSchema())).toEqual({ desktop: "none", ipad: "publish" });
    expect(reachOfChange(visitSetting())).toEqual({ desktop: "now", ipad: "none" });
    expect(reachOfChange(psl())).toEqual({ desktop: "now", ipad: "nextSync" });
  });

  it("takes the server's reach when the preview has one", () => {
    expect(reachOfChange(layout(), { reach: { desktop: "none", ipad: "none" } })).toEqual({ desktop: "none", ipad: "none" });
  });

  it("words the tray row", () => {
    expect(reachLabel({ desktop: "now", ipad: "publish" })).toBe("Desktop now · iPad after publish");
    expect(reachLabel({ desktop: "none", ipad: "publish" })).toBe("iPad after publish");
    expect(reachLabel({ desktop: "now", ipad: "live" })).toBe("Desktop now · iPad now");
    expect(reachLabel({ desktop: "now", ipad: "nextSync" })).toBe("Desktop now · iPad next sync");
    expect(reachLabel({ desktop: "now", ipad: "none" })).toBe("Desktop only");
  });

  it("counts an item as waiting by its reach, else by live", () => {
    expect(awaitsPublish(item("a"))).toBe(true);
    expect(awaitsPublish(item("a", { live: true }))).toBe(false);
    expect(awaitsPublish({ ...item("a"), reach: { desktop: "now", ipad: "live" } })).toBe(false);
  });

  it("collects the profiles to publish, or null when one reaches everyone", () => {
    expect(profilesToPublish([layout(["Rep"]), dbSchema(["rep", "Manager"]), psl()])).toEqual(["rep", "Manager"]);
    expect(profilesToPublish([layout(["Rep"]), dbSchema()])).toBeNull();
    expect(profilesToPublish([psl()])).toEqual([]);
  });

  it("drops changes a publish covered", () => {
    const a = layout(["Rep"]);
    const b = layout(["Rep", "Manager"]);
    const c = dbSchema();
    expect(stillAwaiting([a, b, c], ["rep"])).toEqual([b]);
    expect(stillAwaiting([a, b, c], ["Rep", "Manager"])).toEqual([]);
  });
});

describe("release bar", () => {
  it("has all three states for the profile's org step", () => {
    expect(profileOrgStep(undefined)).toEqual({ kind: "loading" });
    expect(profileOrgStep({ status: "error", error: "boom" })).toEqual({ kind: "error", message: "boom" });
    expect(profileOrgStep(ready([], { errors: [{ kind: "Layout", message: "x" }] }))).toMatchObject({ kind: "error" });
    expect(profileOrgStep(ready([], { noCache: true }))).toEqual({ kind: "neverPublished" });
    expect(profileOrgStep(ready([]))).toMatchObject({ kind: "count", count: 0 });
    expect(profileOrgStep(ready([item("a"), item("b", { live: true }), item("c")]))).toMatchObject({ kind: "count", count: 2, incomplete: false });
  });

  it("reviews the tray first", () => {
    expect(primaryAction({ pending: 2, org: { kind: "count", count: 3, incomplete: false }, profile: "Rep", awaiting: [], job: null })).toEqual({
      kind: "review",
      count: 2,
    });
  });

  it("publishes this profile in the preview when the org is ahead", () => {
    const p = primaryAction({ pending: 0, org: { kind: "count", count: 3, incomplete: false }, profile: "Rep", awaiting: [], job: null });
    expect(p).toMatchObject({ kind: "publish", profiles: ["Rep"], label: "Publish to iPad (1 profile)…" });
    expect(primaryAction({ pending: 0, org: { kind: "neverPublished" }, profile: "Rep", awaiting: [], job: null })).toMatchObject({ kind: "publish" });
  });

  it("publishes every profile the session's changes reach when they reach this one", () => {
    const awaiting = [layout(["Manager", "Rep", "Lead"])];
    expect(primaryAction({ pending: 0, org: { kind: "count", count: 1, incomplete: false }, profile: "Rep", awaiting, job: null })).toMatchObject({
      kind: "publish",
      profiles: ["Rep", "Manager", "Lead"],
      label: "Publish to iPad (3 profiles)…",
    });
    // Changes that don't reach the previewed profile stay out of its publish.
    expect(primaryAction({ pending: 0, org: { kind: "count", count: 1, incomplete: false }, profile: "Rep", awaiting: [layout(["Manager"])], job: null })).toMatchObject({
      profiles: ["Rep"],
      label: "Publish to iPad (1 profile)…",
    });
  });

  it("publishes the session's profiles elsewhere", () => {
    const awaiting = [layout(["Rep"]), dbSchema(["Manager"])];
    expect(primaryAction({ pending: 0, org: sessionOrgStep(awaiting), profile: null, awaiting, job: null })).toMatchObject({
      kind: "publish",
      profiles: ["Rep", "Manager"],
      label: "Publish to iPad (2 profiles)…",
    });
    const everyone = [dbSchema()];
    expect(primaryAction({ pending: 0, org: sessionOrgStep(everyone), profile: null, awaiting: everyone, job: null })).toMatchObject({
      profiles: null,
      label: "Publish to iPad…",
    });
  });

  it("is calm when nothing waits, and says nothing while it can't tell", () => {
    expect(primaryAction({ pending: 0, org: { kind: "count", count: 0, incomplete: false }, profile: "Rep", awaiting: [], job: null })).toMatchObject({
      kind: "calm",
      text: "Reps have everything",
    });
    expect(primaryAction({ pending: 0, org: { kind: "loading" }, profile: "Rep", awaiting: [], job: null })).toEqual({ kind: "none" });
    expect(primaryAction({ pending: 0, org: { kind: "error", message: "x" }, profile: "Rep", awaiting: [], job: null })).toEqual({ kind: "none" });
  });

  it("shows a running publish instead of offering another", () => {
    expect(primaryAction({ pending: 0, org: { kind: "count", count: 3, incomplete: false }, profile: "Rep", awaiting: [], job: job("running") })).toEqual({
      kind: "publishing",
      count: 3,
    });
  });

  it("notes the profiles waiting org-wide beside a profile's publish", () => {
    expect(orgWideNote("Rep", [layout(["Rep"])])).toBeNull();
    expect(orgWideNote("Rep", [layout(["Rep"]), dbSchema(["Manager"])])).toBeNull();
    expect(orgWideNote("Rep", [dbSchema(["Manager"]), layout(["Lead"])])).toBe("2 profiles org-wide");
    expect(orgWideNote("Rep", [dbSchema()])).toBeNull();
    expect(orgWideNote(null, [layout(["Manager"])])).toBeNull();
  });

  it("words the iPad step", () => {
    const ago = () => "2 h ago";
    expect(ipadStepLabel(job("running"), null, undefined, ago)).toEqual({ tone: "running", text: "Publishing to 3 profiles…" });
    expect(ipadStepLabel(job("done", ["A"]), null, undefined, ago)).toEqual({ tone: "done", text: "Published to 1 profile" });
    expect(ipadStepLabel(job("failed"), null, undefined, ago)).toEqual({ tone: "failed", text: "Publish failed" });
    expect(ipadStepLabel(null, "no access", undefined, ago)).toEqual({ tone: "failed", text: "Couldn't publish" });
    expect(ipadStepLabel(null, null, "2026-10-19T08:00:00Z", ago)).toEqual({ tone: "idle", text: "Published 2 h ago" });
    expect(ipadStepLabel(null, null, undefined, ago)).toEqual({ tone: "idle", text: "On iPads" });
  });

  it("shows only when it has something to say, except where it replaced the Publish button", () => {
    const none = { always: false, pending: 0, canUndo: false, canRedo: false, lastApply: false, awaiting: 0, job: false };
    expect(barVisible(none)).toBe(false);
    expect(barVisible({ ...none, always: true })).toBe(true);
    expect(barVisible({ ...none, lastApply: true })).toBe(true);
    expect(barVisible({ ...none, awaiting: 1 })).toBe(true);
    expect(barVisible({ ...none, job: true })).toBe(true);
  });
});

describe("publish job", () => {
  it("tells a failed poll from a failed job", () => {
    expect(responseError({ error: "Engine not started" })).toBe("Engine not started");
    expect(responseError({ data: { error: "No access" } })).toBe("No access");
    // The job failed in Salesforce: that's its state, not a reason to keep polling.
    expect(responseError({ data: { parentId: "x", state: "failed", status: "Inactive", profiles: [], error: "Unable to read SObject" } })).toBeUndefined();
  });
});
