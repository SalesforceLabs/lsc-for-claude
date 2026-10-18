import { describe, expect, it } from "vitest";
import { checkInlineLwc, scanBundle, type LwcFile } from "../../../../src/studio/screens/inline-lwc.js";

const js = (source: string) => ({ path: "lwc/x/x.js", source });
const html = (source: string) => ({ path: "lwc/x/x.html", source });

describe("scanBundle", () => {
  it("passes adapters the shunt answers", () => {
    const { issues } = scanBundle([
      js(`import { LightningElement, wire } from "lwc";
import { getRecord, getFieldValue, updateRecord } from "lightning/uiRecordApi";
import { getObjectInfo, getPicklistValues } from "lightning/uiObjectInfoApi";
import { getLayout } from "lightning/uiLayoutApi";
import NAME from "@salesforce/schema/Account.Name";
import { NavigationMixin } from "lightning/navigation";`),
      html(`<template><lightning-record-view-form record-id={recordId}></lightning-record-view-form></template>`),
    ]);
    expect(issues).toEqual([]);
  });

  it("flags Apex, online-only adapters, network calls and components", () => {
    const { issues } = scanBundle([
      js(`import getContacts from "@salesforce/apex/ContactController.getContacts";
import { getRelatedListRecords as rl, getRelatedListCount } from "lightning/uiRelatedListApi";
export default class X { load() { return fetch("/x"); } }`),
      html(`<template><lightning-map map-markers={m}></lightning-map></template>`),
    ]);
    expect(issues).toEqual([
      { severity: "online", kind: "apex", detail: "ContactController.getContacts" },
      { severity: "online", kind: "adapter", detail: "getRelatedListRecords" },
      { severity: "online", kind: "adapter", detail: "getRelatedListCount" },
      { severity: "online", kind: "network", detail: "fetch" },
      { severity: "online", kind: "component", detail: "lightning-map" },
    ]);
  });

  it("marks GraphQL as gated", () => {
    const { issues } = scanBundle([js(`import { gql, graphql } from "lightning/uiGraphQLApi";`)]);
    expect(issues).toEqual([{ severity: "gated", kind: "graphql", detail: "graphql" }]);
  });

  it("ignores comments and method calls named fetch", () => {
    const { issues } = scanBundle([
      js(`// import x from "@salesforce/apex/A.b";
/* fetch("/y") */
const url = "https://example.com"; this.store.fetch(1);`),
      html(`<template><!-- <lightning-map></lightning-map> --></template>`),
    ]);
    expect(issues).toEqual([]);
  });

  it("collects c/ bundles from imports and tags", () => {
    const { children } = scanBundle([js(`import { fmt } from "c/utils";`), html(`<template><c-my-card_x></c-my-card_x><c-utils></c-utils></template>`)]);
    expect(children.sort()).toEqual(["myCard_x", "utils"]);
  });
});

describe("checkInlineLwc", () => {
  const files: Record<string, LwcFile[]> = {
    lscMobileInline_card: [{ bundle: "lscMobileInline_card", path: "lwc/lscMobileInline_card/lscMobileInline_card.html", source: `<template><c-child></c-child></template>` }],
    child: [{ bundle: "child", path: "lwc/child/child.js", source: `import a from "@salesforce/apex/Ctl.a"; import "c/lscMobileInline_card";` }],
  };
  const load = async (bundles: string[]) => bundles.flatMap((b) => files[b] ?? []);

  it("follows c/ bundles and says which one has the issue", async () => {
    const check = await checkInlineLwc("lscMobileInline_card", load);
    expect(check).toEqual({ issues: [{ severity: "online", kind: "apex", detail: "Ctl.a", bundle: "child" }], bundles: ["lscMobileInline_card", "child"] });
  });

  it("stops at bundles it can't read", async () => {
    const check = await checkInlineLwc("missing", load);
    expect(check).toEqual({ issues: [], bundles: [] });
  });
});
