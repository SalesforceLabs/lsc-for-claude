import { describe, it, expect } from "vitest";
import { appItems } from "../../../src/studio/unpublished-logic.js";
import { buildOrgAhead, kindLabel, orgAheadApp, groupItems } from "../../../src-renderer/components/studio/org-ahead.js";

const rows = [
  { DeveloperName: "lifeSciencesCommercial", NamespacePrefix: "lsc4ce", Label: "LSC", LastModifiedDate: "2026-10-17T10:00:00.000+0000", LastModifiedBy: { Name: "Ann" } },
  { DeveloperName: "Other", NamespacePrefix: null, Label: "Other", LastModifiedDate: "2026-10-17T10:00:00.000+0000" },
];

describe("an app changed after the cache", () => {
  it("is listed only for the app behind the tab bar", () => {
    expect(appItems(rows, "lsc4ce__lifeSciencesCommercial")).toEqual([
      {
        id: "app:lsc4ce__lifeSciencesCommercial",
        kind: "app",
        name: "lsc4ce__lifeSciencesCommercial",
        label: "LSC",
        lastModifiedAt: "2026-10-17T10:00:00.000Z",
        lastModifiedBy: "Ann",
        target: "metadata:CustomApplication:lsc4ce__lifeSciencesCommercial",
        reach: { desktop: "now", ipad: "publish" },
      },
    ]);
    expect(appItems(rows, null)).toEqual([]);
    expect(appItems(rows, "Other")).toHaveLength(1);
  });

  it("marks the tab bar in the preview and is grouped with tabs", () => {
    const item = { id: "app:lsc4ce__lifeSciencesCommercial", kind: "app" as const, name: "lsc4ce__lifeSciencesCommercial", label: "LSC", lastModifiedAt: "2026-10-17T10:00:00.000Z", lastModifiedBy: null, target: "x" };
    expect(orgAheadApp(buildOrgAhead([item]), "LSC4CE__lifeSciencesCommercial")).toBe(item);
    expect(orgAheadApp(buildOrgAhead([]), "lsc4ce__lifeSciencesCommercial")).toBeUndefined();
    expect(kindLabel("app")).toBe("App tab bar");
    expect(groupItems([item])[0].title).toBe("Tabs");
  });
});
