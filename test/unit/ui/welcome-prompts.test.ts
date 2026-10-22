import { describe, it, expect } from "vitest";
import { welcomePrompts } from "../../../src-renderer/welcome-prompts";

describe("welcomePrompts", () => {
  it("offers org checks only when there is an org", () => {
    const withOrg = welcomePrompts(true).map((p) => p.label);
    const without = welcomePrompts(false).map((p) => p.label);
    expect(withOrg).toContain("Run a health check on this org");
    expect(without.some((l) => /this org|rep can't see|syncs\?|error/i.test(l) && !/rep need/.test(l))).toBe(false);
  });

  it("gives an even number of prompts with unique labels", () => {
    for (const list of [welcomePrompts(true), welcomePrompts(false)]) {
      expect(list.length % 2).toBe(0);
      expect(new Set(list.map((p) => p.label)).size).toBe(list.length);
    }
  });

  it("leaves prefilled prompts open-ended for the user to finish", () => {
    for (const p of welcomePrompts(true).filter((p) => p.prefill)) expect(p.text.endsWith(" ")).toBe(true);
  });
});
