import { describe, expect, it } from "vitest";
import { buildInlineLwc } from "../../../../src/studio/lwc/compile.js";
import { lwcRequest, refuseLwcRequest } from "../../../../src/studio/lwc/request.js";
import { salesforceFallback, salesforceModule, SHIMMED_LIGHTNING } from "../../../../src/studio/lwc/shims.js";
import { inlineLwcFrame } from "../../../../src-renderer/components/studio/inline-lwc-frame.js";
import type { DeviceHttp, DeviceRequest } from "../../../../src/perf/device/session.js";

describe("refuseLwcRequest", () => {
  it("allows UI API reads and GraphQL queries", () => {
    expect(refuseLwcRequest({ method: "GET", path: "/ui-api/records/001xx0000000001AAA?fields=Account.Name%2CAccount.Phone" })).toBeNull();
    expect(refuseLwcRequest({ method: "GET", path: "/ui-api/object-info/batch/Account,Contact" })).toBeNull();
    expect(refuseLwcRequest({ method: "POST", path: "/graphql", body: { query: "query { uiapi { query { Account { edges { node { Id } } } } } }" } })).toBeNull();
  });

  it("refuses writes, other endpoints and path tricks", () => {
    expect(refuseLwcRequest({ method: "POST", path: "/ui-api/records", body: {} })).toMatch(/doesn't send/);
    expect(refuseLwcRequest({ method: "GET", path: "/sobjects/Account" })).toMatch(/doesn't answer/);
    expect(refuseLwcRequest({ method: "GET", path: "/ui-api/../tooling/query?q=x" })).toMatch(/doesn't answer/);
    expect(refuseLwcRequest({ method: "GET", path: "/ui-api//x" })).toMatch(/doesn't answer/);
    expect(refuseLwcRequest({ method: "GET", path: "/ui-api/records/a b" })).toMatch(/doesn't answer/);
    expect(refuseLwcRequest({ method: "POST", path: "/graphql", body: { query: "mutation { uiapi { AccountCreate(input: {}) { Record { Id } } } }" } })).toMatch(/read-only/);
    expect(refuseLwcRequest({ method: "POST", path: "/graphql", body: {} })).toMatch(/without a query/);
  });
});

describe("lwcRequest", () => {
  const reply = (status: number, body: unknown): DeviceHttp => async () => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });

  it("sends to the versioned data API and returns the JSON", async () => {
    let seen: DeviceRequest | undefined;
    const http: DeviceHttp = async (req) => {
      seen = req;
      return { status: 200, headers: {}, body: Buffer.from(`{"id":"001"}`) };
    };
    expect(await lwcRequest("org", { method: "GET", path: "/ui-api/records/001" }, http)).toEqual({ ok: true, data: { id: "001" } });
    expect(seen).toMatchObject({ method: "GET", url: "/services/data/v68.0/ui-api/records/001", body: undefined });
  });

  it("shapes UI API errors like the platform's", async () => {
    const r = await lwcRequest("org", { method: "GET", path: "/ui-api/records/001" }, reply(404, [{ errorCode: "NOT_FOUND", message: "The requested resource does not exist" }]));
    expect(r).toEqual({ ok: false, status: 404, statusText: "Not Found", body: { errorCode: "NOT_FOUND", message: "The requested resource does not exist" } });
  });

  it("never sends a refused request", async () => {
    const http: DeviceHttp = async () => {
      throw new Error("sent");
    };
    expect(await lwcRequest("org", { method: "POST", path: "/ui-api/records", body: {} }, http)).toMatchObject({ ok: false, status: 403 });
  });

  it("sends a rep's token only to a Salesforce host", async () => {
    const rep = { instanceUrl: "https://evil.example.com", accessToken: "t", username: "rep@acme.com" };
    await expect(lwcRequest(rep, { method: "GET", path: "/ui-api/records/001" })).rejects.toThrow(/not a Salesforce HTTPS URL/);
  });
});

describe("salesforceModule", () => {
  it("stands in for Apex with a rejecting method and an erroring adapter", () => {
    const src = salesforceModule("@salesforce/apex/Ctl.getRows", {})!;
    expect(src).toContain("Apex Ctl.getRows isn't run in Studio's preview");
    expect(src).toContain("method.adapter = class");
  });

  it("maps schema imports and labels", () => {
    expect(salesforceModule("@salesforce/schema/Account.Name", {})).toBe(`export default {"objectApiName":"Account","fieldApiName":"Name"};\n`);
    expect(salesforceModule("@salesforce/schema/Account", {})).toBe(`export default {"objectApiName":"Account"};\n`);
    expect(salesforceModule("@salesforce/label/c.Greeting", { Greeting: "Hello" })).toBe(`export default "Hello";\n`);
    expect(salesforceModule("@salesforce/label/c.Missing", {})).toBe(`export default "Missing";\n`);
  });

  it("leaves base-component labels and gates to lightning-base-components", () => {
    expect(salesforceModule("@salesforce/label/LightningControl.required", {})).toBeNull();
    expect(salesforceModule("@salesforce/gate/bc.258.enableTimeIntervalApi", {})).toBeNull();
    expect(salesforceFallback("@salesforce/label/LightningX.cancel")).toBe(`export default "cancel";\n`);
    expect(salesforceFallback("@salesforce/gate/x.y")).toBe(`export default false;\n`);
  });

  it("shims the LDS modules the base components package doesn't ship", () => {
    for (const m of ["uiRecordApi", "uiObjectInfoApi", "uiGraphQLApi", "uiRelatedListApi", "navigation", "platformShowToastEvent", "recordViewForm", "outputField", "recordForm"]) expect(SHIMMED_LIGHTNING.has(m)).toBe(true);
  });
});

describe("inlineLwcFrame", () => {
  it("keeps the script and context inside their tags", () => {
    const html = inlineLwcFrame(`const s = "</script><b>";`, "a{}", { componentName: "x", recordId: "</script>" });
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).toContain(`"<\\/script>"`);
    expect(html).toContain(`<div id="root"></div>`);
  });
});

describe("buildInlineLwc", () => {
  it("compiles an org component with base components, LDS stand-ins and placeholders", async () => {
    const files = [
      {
        bundle: "lscMobileInline_card",
        path: "lwc/lscMobileInline_card/lscMobileInline_card.js",
        source: `import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue } from "lightning/uiRecordApi";
import NAME from "@salesforce/schema/Account.Name";
import load from "@salesforce/apex/Ctl.load";
import GREETING from "@salesforce/label/c.Greeting";
import { fmt } from "c/utils";
export default class Card extends LightningElement {
  @api recordId;
  @wire(getRecord, { recordId: "$recordId", fields: [NAME] }) record;
  get name() { return fmt(getFieldValue(this.record.data, NAME)) + GREETING; }
  connectedCallback() { load().catch(() => {}); }
}`,
      },
      {
        bundle: "lscMobileInline_card",
        path: "lwc/lscMobileInline_card/lscMobileInline_card.html",
        source: `<template><lightning-card title={name} icon-name="standard:account"><p>{name}</p><lightning-studio-unknown></lightning-studio-unknown></lightning-card></template>`,
      },
      { bundle: "utils", path: "lwc/utils/utils.js", source: `export function fmt(v) { return v == null ? "" : String(v); }` },
    ];
    const { script, placeholders } = await buildInlineLwc("lscMobileInline_card", files, { Greeting: "!" });
    expect(placeholders).toEqual(["studioUnknown"]);
    expect(script).toContain("&lt;lightning-studio-unknown&gt; isn&#x27;t drawn");
    expect(script).toContain("Apex Ctl.load isn't run");
    expect(script).toContain("/ui-api/records/");
    expect(script).toContain("c-studio-preview");
    expect(script).not.toMatch(/\bundefined\.SSR\b/);
    expect(script.startsWith(`var process = { env: { NODE_ENV: "production" } };`)).toBe(true);
  }, 60_000);
});
