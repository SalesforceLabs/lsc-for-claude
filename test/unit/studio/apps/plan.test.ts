import { describe, expect, it, vi } from "vitest";

const queries: string[] = [];
vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  query: vi.fn(async (q: string) => {
    queries.push(q);
    if (q.includes("FROM LightningComponentBundle")) return [{ DeveloperName: "lscMobileInline_Smoke" }];
    if (q.includes("FROM QuickActionDefinition")) return [{ DeveloperName: "lscMobileInline_Rec", EntityDefinition: { QualifiedApiName: "Account" } }];
    return [];
  }),
}));
vi.mock("../../../../src/studio/metadata/live.js", () => ({ isProductionOrg: async () => false }));

import { planDeploy } from "../../../../src/studio/apps/plan.js";
import { homeApp, recordApp, tabApp } from "./fixtures.js";

describe("planDeploy", () => {
  it("lists what a home app writes and what it would overwrite", async () => {
    const plan = await planDeploy(homeApp(), "org");
    expect(plan.components).toEqual(["LightningComponentBundle:lscMobileInline_Smoke"]);
    expect(plan.existing).toEqual(["LightningComponentBundle:lscMobileInline_Smoke"]);
    expect(plan.production).toBe(false);
    expect(plan.warnings.join(" ")).toContain("overwritten");
  });

  it("includes the quick action for a record app", async () => {
    const plan = await planDeploy(recordApp(), "org");
    expect(plan.components.some((c) => c.startsWith("QuickAction:"))).toBe(true);
  });

  it("includes page, tab and profiles for a tab app and warns without profiles", async () => {
    const plan = await planDeploy(tabApp(), "org");
    expect(plan.components).toEqual(expect.arrayContaining([expect.stringMatching(/^FlexiPage:/), expect.stringMatching(/^CustomTab:/)]));
    expect(plan.warnings.join(" ")).toMatch(/profile/i);
  });
});
