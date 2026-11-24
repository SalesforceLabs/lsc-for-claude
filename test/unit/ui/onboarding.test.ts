import { describe, it, expect } from "vitest";
import {
  clampStep,
  HEALTH_CHECK_PROMPT,
  ONBOARDING_GROUP_TITLES,
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  orgSetupState,
  shouldShowOnboarding,
} from "../../../src-renderer/onboarding";
import { welcomePrompts } from "../../../src-renderer/welcome-prompts";

describe("onboarding", () => {
  it("shows until the current version has been seen", () => {
    expect(shouldShowOnboarding(undefined)).toBe(true);
    expect(shouldShowOnboarding("1")).toBe(true);
    expect(shouldShowOnboarding(NaN)).toBe(true);
    expect(shouldShowOnboarding(ONBOARDING_VERSION - 1)).toBe(true);
    expect(shouldShowOnboarding(ONBOARDING_VERSION)).toBe(false);
    expect(shouldShowOnboarding(ONBOARDING_VERSION + 1)).toBe(false);
  });

  it("keeps the step inside the tour", () => {
    expect(clampStep(-1)).toBe(0);
    expect(clampStep(2)).toBe(2);
    expect(clampStep(99)).toBe(ONBOARDING_STEPS.length - 1);
  });

  it("has unique steps that start with the welcome and end with where to start", () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("welcome");
    expect(ids.at(-1)).toBe("start");
  });

  it("sends the same health check as the welcome screen", () => {
    expect(welcomePrompts(true).map((p) => p.text)).toContain(HEALTH_CHECK_PROMPT);
  });

  it("keeps each group's steps together, so the step list shows one heading per group", () => {
    const runs = ONBOARDING_STEPS.map((s) => s.group).filter((g, i, all) => g !== all[i - 1]);
    expect(new Set(runs).size).toBe(runs.length);
    expect(runs.every((g) => g in ONBOARDING_GROUP_TITLES)).toBe(true);
  });

  it("opens Studio sections that exist", () => {
    const sections = ["overview", "preview", "apps", "sync", "drift", "metadata-cache", "object-sync", "custom-scripts", "content"];
    for (const step of ONBOARDING_STEPS) {
      const r = step.open?.request;
      if (r?.kind === "section") expect(sections).toContain(r.section);
    }
    expect(ONBOARDING_STEPS.filter((s) => s.group === "studio").length).toBeGreaterThanOrEqual(5);
  });

  describe("orgSetupState", () => {
    const base = { loading: false, error: "", connections: 0, hasOrg: false };
    it("is checking until the first listing", () => {
      expect(orgSetupState({ ...base, loading: true })).toEqual({ cli: "checking", login: "checking", chosen: "checking" });
    });
    it("fails the CLI when sf can't run, and waits on the rest", () => {
      expect(orgSetupState({ ...base, error: "sf CLI unavailable" })).toEqual({ cli: "fail", login: "blocked", chosen: "blocked" });
    });
    it("asks for a login when the CLI has none", () => {
      expect(orgSetupState(base)).toEqual({ cli: "pass", login: "todo", chosen: "blocked" });
    });
    it("asks for a choice, then passes", () => {
      expect(orgSetupState({ ...base, connections: 3 }).chosen).toBe("todo");
      expect(orgSetupState({ ...base, connections: 3, hasOrg: true })).toEqual({ cli: "pass", login: "pass", chosen: "pass" });
    });
    it("keeps showing logins it already has while it re-lists", () => {
      expect(orgSetupState({ ...base, loading: true, connections: 2, hasOrg: true }).login).toBe("pass");
    });
  });
});
