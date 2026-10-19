import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyAppOps, appFixedTabs, appTabs, editableTabTag, isInstalledApp, StaleAppError } from "../../../src/studio/metadata/app-ops.js";
import { appTabWarnings, routedScreen } from "../../../src/studio/metadata/app-tab-rules.js";
import { matchApp } from "../../../src/studio/metadata/live-app.js";
import { parseXml, serializeXml } from "../../../src/studio/metadata/xml.js";
import type { AppOp } from "../../../src/studio/types.js";

const INSTALLED = "lsc4ce__lifeSciencesCommercial";
const OWN = "LSC_Unmanaged";
const read = (name: string) => readFileSync(join(__dirname, `../../fixtures/metadata/${name}.app-meta.xml`), "utf8");
const installedXml = read(INSTALLED);
const ownXml = read(OWN);

/** Applying the ops then their inverse gives back the retrieved file, byte for byte. */
function roundTrip(fullName: string, xml: string, ops: AppOp[]) {
  const root = parseXml(xml);
  const forward = applyAppOps(root, fullName, ops);
  const back = applyAppOps(forward.root, fullName, forward.inverse);
  expect(serializeXml(back.root)).toBe(xml);
  return forward;
}

describe("app tab ops", () => {
  it("knows which tabs a subscriber can arrange", () => {
    expect(isInstalledApp(INSTALLED)).toBe(true);
    expect(isInstalledApp(OWN)).toBe(false);
    expect(editableTabTag(INSTALLED)).toBe("subscriberTabs");
    expect(editableTabTag(OWN)).toBe("tabs");
    const root = parseXml(installedXml);
    expect(appTabs(root, INSTALLED)).toEqual([
      "lsc4ce__Planner",
      "lsc4ce__IntelligentContent",
      "standard-Visit",
      "standard-Inquiry",
      "standard-Opportunity",
      "standard-Order",
      "standard-AccountPlan",
      "standard-report",
      "Pat_Sim",
    ]);
    expect(appFixedTabs(root, INSTALLED)).toEqual(["standard-home", "lsc4ce__AdminConsole", "lsc4ce__AccountFilter"]);
    expect(appFixedTabs(parseXml(ownXml), OWN)).toEqual([]);
  });

  it("moves a subscriber tab earlier and to the end, and back, leaving the package's tabs alone", () => {
    const { root, changes } = roundTrip(INSTALLED, installedXml, [
      { op: "moveAppTab", tab: "standard-Order", before: "standard-Visit" },
      { op: "moveAppTab", tab: "lsc4ce__Planner", before: null },
    ]);
    expect(appTabs(root, INSTALLED)).toEqual([
      "lsc4ce__IntelligentContent",
      "standard-Order",
      "standard-Visit",
      "standard-Inquiry",
      "standard-Opportunity",
      "standard-AccountPlan",
      "standard-report",
      "Pat_Sim",
      "lsc4ce__Planner",
    ]);
    expect(appFixedTabs(root, INSTALLED)).toEqual(["standard-home", "lsc4ce__AdminConsole", "lsc4ce__AccountFilter"]);
    expect(changes[0]).toEqual({ tab: "Tab standard-Order", before: "Position 6 of 9", after: "Position 3 of 9" });
  });

  it("removes and adds tabs, and puts them back", () => {
    const { root } = roundTrip(INSTALLED, installedXml, [
      { op: "removeAppTab", tab: "standard-Opportunity" },
      { op: "addAppTab", tab: "standard-Contact", before: "standard-Order" },
      { op: "addAppTab", tab: "Foo__c", before: null },
    ]);
    expect(appTabs(root, INSTALLED)).toEqual([
      "lsc4ce__Planner",
      "lsc4ce__IntelligentContent",
      "standard-Visit",
      "standard-Inquiry",
      "standard-Contact",
      "standard-Order",
      "standard-AccountPlan",
      "standard-report",
      "Pat_Sim",
      "Foo__c",
    ]);
  });

  it("edits the tabs of an app of the org's own", () => {
    const { root } = roundTrip(OWN, ownXml, [
      { op: "moveAppTab", tab: "Pat_Sim", before: "standard-Account" },
      { op: "removeAppTab", tab: "standard-home" },
      { op: "addAppTab", tab: "standard-Contact", before: null },
    ]);
    expect(appTabs(root, OWN)).toEqual(["Pat_Sim", "standard-Account", "standard-report", "standard-Contact"]);
  });

  it("only changes the tab lines in the file", () => {
    const after = serializeXml(applyAppOps(parseXml(installedXml), INSTALLED, [{ op: "moveAppTab", tab: "standard-Order", before: "standard-Visit" }]).root);
    const was = installedXml.split("\n");
    const now = after.split("\n");
    expect(now.length).toBe(was.length);
    const changed = now.filter((l, i) => l !== was[i]);
    expect(changed.every((l) => l.includes("subscriberTabs"))).toBe(true);
  });

  it("puts a first subscriber tab where the schema wants it", () => {
    const bare = installedXml.replace(/ {4}<subscriberTabs>.*<\/subscriberTabs>\n/g, "");
    const { root } = roundTrip(INSTALLED, bare, [{ op: "addAppTab", tab: "standard-Contact", before: null }]);
    const out = serializeXml(root);
    expect(out.indexOf("<subscriberTabs>")).toBeGreaterThan(out.indexOf("</profileActionOverrides>"));
    expect(out.indexOf("<subscriberTabs>")).toBeLessThan(out.indexOf("<tabs>"));
  });

  it("refuses edits that no longer fit", () => {
    const root = parseXml(installedXml);
    expect(() => applyAppOps(root, INSTALLED, [{ op: "removeAppTab", tab: "standard-Lead" }])).toThrow(StaleAppError);
    expect(() => applyAppOps(root, INSTALLED, [{ op: "addAppTab", tab: "standard-Visit", before: null }])).toThrow(/already/);
    expect(() => applyAppOps(root, INSTALLED, [{ op: "moveAppTab", tab: "standard-home", before: null }])).toThrow(/package/);
    expect(() => applyAppOps(root, INSTALLED, [{ op: "addAppTab", tab: "standard-home", before: null }])).toThrow(/already/);
    expect(() => applyAppOps(root, INSTALLED, [{ op: "moveAppTab", tab: "standard-Visit", before: "standard-Lead" }])).toThrow(StaleAppError);
    expect(() => applyAppOps(root, INSTALLED, [{ op: "addAppTab", tab: "bad name", before: null }])).toThrow(/Invalid/);
  });

  it("doesn't touch the tree it was given", () => {
    const root = parseXml(installedXml);
    applyAppOps(root, INSTALLED, [{ op: "removeAppTab", tab: "Pat_Sim" }]);
    expect(serializeXml(root)).toBe(installedXml);
  });
});

describe("what removing a tab breaks", () => {
  it("names the screen a tab routes to", () => {
    expect(routedScreen("standard-home")).toBe("Home");
    expect(routedScreen("lsc4ce__Planner")).toBe("the Planner (calendar)");
    expect(routedScreen("lsc4ce__AccountFilter")).toBe("Accounts");
    expect(routedScreen("standard-report")).toBe("Reports");
    expect(routedScreen("lsc4ce__IntelligentContent")).toBe("Intelligent Content");
    expect(routedScreen("standard-Visit")).toBeNull();
  });

  it("warns for removed tabs only, and not for one put back", () => {
    const w = appTabWarnings([
      { op: "removeAppTab", tab: "standard-Opportunity" },
      { op: "removeAppTab", tab: "lsc4ce__Planner" },
      { op: "removeAppTab", tab: "Foo__c" },
      { op: "removeAppTab", tab: "Pat_Sim" },
      { op: "moveAppTab", tab: "standard-Visit", before: null },
      { op: "addAppTab", tab: "Foo__c", before: null },
    ]);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/standard-Opportunity.*Opportunity records/);
    expect(w[1]).toMatch(/Planner/);
  });
});

describe("which app a profile's tab bar comes from", () => {
  const apps = [
    { fullName: "lsc4ce__lifeSciencesCommercial", label: "LSC", tabs: ["standard-home", "lsc4ce__AdminConsole", "lsc4ce__Planner", "standard-Visit"] },
    { fullName: "LSDO_KAM", label: "KAM", tabs: ["standard-home", "standard-AccountPlan", "Extra", "Extra2"] },
    { fullName: "Other", label: "Other", tabs: ["standard-Lead"] },
  ];

  it("picks the app with the most of the bar's tabs", () => {
    const m = matchApp(apps, ["standard-home", "lsc4ce__Planner", "standard-Visit", "lsc4ce__AdminConsole"]);
    expect(m).toEqual({ app: { fullName: "lsc4ce__lifeSciencesCommercial", label: "LSC", installed: true } });
  });

  it("won't guess between apps that fit equally well", () => {
    const m = matchApp(apps, ["standard-home"]);
    expect(m.app).toBeNull();
  });

  it("says so when nothing fits", () => {
    expect(matchApp(apps, ["standard-Case"]).app).toBeNull();
  });
});
