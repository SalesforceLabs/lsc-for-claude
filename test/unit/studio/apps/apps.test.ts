import { describe, expect, it } from "vitest";
import { lintApp } from "../../../../src/studio/apps/lint.js";
import { guardSampleQuery } from "../../../../src/studio/apps/sample.js";
import { checkApp } from "../../../../src/studio/apps/check.js";
import { addTabToAppXml, buildAppTree, quickActionXml } from "../../../../src/studio/apps/deploy.js";
import { ACTION_JS, ACTION_META, HOME_HTML, HOME_JS, actionApp, homeApp, recordApp, tabApp } from "./fixtures.js";

const rules = (r: { issues: { rule: string; severity: string }[] }) => r.issues.map((i) => i.rule);

describe("lintApp", () => {
  it("passes a minimal home app and reads mobileHeight", () => {
    const r = lintApp(homeApp());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.mobileHeight).toBe(560);
  });

  it("passes a record app", () => {
    expect(lintApp(recordApp()).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("requires the prefix", () => {
    const app = { ...homeApp(), name: "Smoke" };
    expect(rules(lintApp(app))).toContain("name.prefix");
  });

  it("requires UrlAddressable on a home app", () => {
    const meta = homeApp().files[2].source.replace("<target>lightning__UrlAddressable</target>", "");
    expect(rules(lintApp(homeApp({ meta })))).toContain("meta.missing-urladdressable");
  });

  it("requires @api mobileHeight when the meta declares it", () => {
    const js = HOME_JS.replace("    @api mobileHeight = 560;\n", "");
    expect(rules(lintApp(homeApp({ js })))).toContain("js.mobile-height-api");
  });

  it("requires mobileHeight", () => {
    const meta = homeApp().files[2].source.replace(/<targetConfigs>[\s\S]*<\/targetConfigs>/, "");
    expect(rules(lintApp(homeApp({ meta })))).toContain("meta.mobile-height");
  });

  it("flags template expressions, missing keys and Apex", () => {
    const r = lintApp(
      homeApp({
        html: `<template><template for:each={items} for:item="i"><div>{i.a + i.b}</div></template></template>`,
        js: HOME_JS + `import getX from '@salesforce/apex/Foo.bar';\n`,
      }),
    );
    expect(rules(r)).toEqual(expect.arrayContaining(["html.expression", "html.missing-key", "js.apex"]));
    expect(r.issues.every((i) => i.fix)).toBe(true);
  });

  it("flags dynamic gql and an unresolved child", () => {
    const js = `import { LightningElement } from 'lwc';\nimport { gql } from 'lightning/uiGraphQLApi';\nimport Kid from 'c/kid';\nconst id = 1;\nconst Q = gql\`query { uiapi { query { Account(where: {Id: {eq: "\${id}"}}) { edges { node { Id } } } } } }\`;\nexport default class Smoke extends LightningElement {}\n`;
    expect(rules(lintApp(homeApp({ js })))).toEqual(expect.arrayContaining(["graphql.dynamic", "child.unresolved"]));
  });
});

describe("lintApp: quick action and tab targets", () => {
  it("passes an action app named lscMobileQuickAction_", () => {
    const r = lintApp(actionApp());
    expect(r.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });
  it("refuses the lscMobileInline_ prefix on an action", () => {
    const r = lintApp(actionApp({ name: "lscMobileInline_LogFollowUp" }));
    expect(rules(r)).toContain("name.action-prefix");
  });
  it("suggests the offline prefetch prefix for other action names", () => {
    const r = lintApp(actionApp({ name: "logFollowUp" }));
    expect(r.issues.find((i) => i.rule === "name.action-offline")?.severity).toBe("warning");
  });
  it("needs ScreenAction, recordId and warns about mobileHeight and a missing close", () => {
    expect(rules(lintApp(actionApp({ meta: ACTION_META.replace("<actionType>ScreenAction</actionType>", "") })))).toContain("meta.action-type");
    expect(rules(lintApp(actionApp({ js: ACTION_JS.replace("@api recordId;", "") })))).toContain("js.record-id");
    expect(rules(lintApp(actionApp({ js: ACTION_JS.replace(/import \{ Close[^\n]*\n/, "").replace("close() { this.dispatchEvent(new CloseActionScreenEvent()); }", "close() {}") })))).toContain("js.close-action");
    const withHeight = ACTION_META.replace("</targetConfig>", '<property name="mobileHeight" type="Integer" default="400" /></targetConfig>');
    expect(rules(lintApp(actionApp({ meta: withHeight })))).toContain("meta.action-mobile-height");
  });
  it("passes a tab app and reads mobileHeight from the AppPage config", () => {
    const r = lintApp(tabApp());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.mobileHeight).toBe(900);
  });
  it("requires lightning__AppPage and its mobileHeight on a tab app", () => {
    expect(rules(lintApp(tabApp({ meta: TAB_NO_APPPAGE })))).toContain("meta.missing-apppage");
    expect(rules(lintApp(tabApp({ meta: TAB_NO_APPPAGE.replace("<target>lightning__UrlAddressable</target>", "<target>lightning__AppPage</target>") })))).toContain("meta.mobile-height");
  });
});

const TAB_NO_APPPAGE = TAB_META_SOURCE();
function TAB_META_SOURCE() {
  return tabApp().files.find((f) => f.path.endsWith(".js-meta.xml"))!.source.replace("<target>lightning__AppPage</target>", "").replace(/<targetConfigs>[\s\S]*<\/targetConfigs>/, "");
}

describe("guardSampleQuery", () => {
  it("forces a LIMIT of at most 5", () => {
    expect(guardSampleQuery("SELECT Id FROM Account")).toMatch(/LIMIT 5$/);
    expect(guardSampleQuery("SELECT Id FROM Account LIMIT 100")).toMatch(/LIMIT 5$/);
    expect(guardSampleQuery("SELECT Id FROM Account LIMIT 2")).toMatch(/LIMIT 2$/);
  });
  it("leaves subquery limits alone but limits the top level", () => {
    const q = guardSampleQuery("SELECT Id, (SELECT Id FROM Contacts LIMIT 50) FROM Account");
    expect(q).toMatch(/LIMIT 50\) FROM Account LIMIT 5$/);
  });
  it("rejects non-SELECT, semicolons and write keywords", () => {
    expect(() => guardSampleQuery("DELETE FROM Account")).toThrow();
    expect(() => guardSampleQuery("SELECT Id FROM Account; SELECT Id FROM Contact")).toThrow();
    expect(() => guardSampleQuery("SELECT Id FROM Account FOR UPDATE")).toThrow();
  });
  it("ignores keywords and semicolons inside string literals", () => {
    expect(() => guardSampleQuery("SELECT Id FROM Account WHERE Name = 'a; delete for update'")).not.toThrow();
  });
});

describe("checkApp", () => {
  it("compiles a good home app with no org", async () => {
    const r = await checkApp(homeApp());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.script).toBeTruthy();
  }, 60_000);

  it("reports a compile error with path and line", async () => {
    const r = await checkApp(homeApp({ js: HOME_JS.replace("items = [", "items = [{{") }));
    expect(r.ok).toBe(false);
    const e = r.issues.find((i) => i.rule === "compile");
    expect(e?.path).toContain("lwc/lscMobileInline_Smoke/");
    expect(e?.line).toBeGreaterThan(0);
  }, 60_000);

  it("warns offline about Apex and reports unknown sync with no org", async () => {
    const js = `import { LightningElement } from 'lwc';\nimport getX from '@salesforce/apex/Foo.bar';\nexport default class Smoke extends LightningElement {}\n`;
    const r = await checkApp(homeApp({ js, html: HOME_HTML.replace("{i.label}", "x") }));
    expect(r.issues.some((i) => i.rule.startsWith("offline."))).toBe(true);
  }, 60_000);
});

describe("checkApp: lightning/actions shim", () => {
  it("compiles an action app and the frame posts close", async () => {
    const r = await checkApp(actionApp());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.script).toContain("lightning__actionsclosescreen");
  }, 60_000);
});

describe("deploy tree", () => {
  it("writes bundle files and no quick action for a home app", () => {
    const t = buildAppTree(homeApp());
    expect(Object.keys(t.files).sort()).toEqual([
      "lwc/lscMobileInline_Smoke/lscMobileInline_Smoke.html",
      "lwc/lscMobileInline_Smoke/lscMobileInline_Smoke.js",
      "lwc/lscMobileInline_Smoke/lscMobileInline_Smoke.js-meta.xml",
    ]);
    expect(t.deployed).toEqual(["LightningComponentBundle:lscMobileInline_Smoke"]);
  });
  it("adds the quick action for a record app", () => {
    const t = buildAppTree(recordApp());
    const qa = t.files["quickActions/Account.lscMobileInline_Insights.quickAction-meta.xml"];
    expect(qa).toBe(quickActionXml("lscMobileInline_Insights", "Insights"));
    expect(qa).toContain("<lightningWebComponent>lscMobileInline_Insights</lightningWebComponent>");
    expect(qa).toContain("<type>LightningWebComponent</type>");
    expect(t.deployed).toContain("QuickAction:Account.lscMobileInline_Insights");
  });
});

describe("deploy tree: action and tab", () => {
  it("adds the quick action for an action app", () => {
    const t = buildAppTree(actionApp());
    expect(t.files["quickActions/Account.lscMobileQuickAction_LogFollowUp.quickAction-meta.xml"]).toContain("<lightningWebComponent>lscMobileQuickAction_LogFollowUp</lightningWebComponent>");
    expect(t.deployed).toContain("QuickAction:Account.lscMobileQuickAction_LogFollowUp");
  });
  it("writes an App page, a custom tab and a tab-only profile for a tab app", () => {
    const t = buildAppTree(tabApp({ tab: { label: "Briefing", profiles: ["LS MT Field Sales Representative"] } }));
    const page = t.files["flexipages/lscMobileInline_Briefing.flexipage-meta.xml"];
    expect(page).toContain("<type>AppPage</type>");
    expect(page).toContain("flexipage:defaultAppHomeTemplate");
    expect(page).toContain("<componentName>lscMobileInline_Briefing</componentName>");
    expect(page).toContain("<value>900</value>");
    const tab = t.files["tabs/lscMobileInline_Briefing.tab-meta.xml"];
    expect(tab).toContain("<flexiPage>lscMobileInline_Briefing</flexiPage>");
    expect(tab).toContain("<label>Briefing</label>");
    const profile = t.files["profiles/LS MT Field Sales Representative.profile-meta.xml"];
    expect(profile).toContain("<tab>lscMobileInline_Briefing</tab>");
    expect(profile).toContain("<visibility>DefaultOn</visibility>");
    expect(t.deployed).toEqual(expect.arrayContaining(["FlexiPage:lscMobileInline_Briefing", "CustomTab:lscMobileInline_Briefing", "Profile:LS MT Field Sales Representative"]));
  });
  it("adds a tab to an app's tab list once", () => {
    const xml = "<CustomApplication>\n    <tabs>a</tabs>\n    <tabs>b</tabs>\n    <uiType>Lightning</uiType>\n</CustomApplication>";
    const out = addTabToAppXml(xml, "c");
    expect(out).toContain("<tabs>b</tabs>\n    <tabs>c</tabs>\n    <uiType>");
    expect(addTabToAppXml(out, "c")).toBe(out);
  });
});
