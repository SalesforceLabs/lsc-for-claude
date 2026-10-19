import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { forgetToolingOrg, sameMetadata, toolingTargetOf, toolingWriteMetadata, xmlToToolingMetadata } from "../../../src/salesforce/tooling-metadata.js";
import { resetDirect } from "../../../src/salesforce/direct.js";

const FIXTURES = path.join(__dirname, "../../fixtures/metadata");
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf-8");
const creds = { accessToken: "tok-1", instanceUrl: "https://acme.my.salesforce.com", apiVersion: "68.0" };
const fetcher = async () => creds;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("xmlToToolingMetadata", () => {
  it("maps a compact layout: fields as an array, label, no fullName", () => {
    expect(xmlToToolingMetadata("CompactLayout", fixture("Account_Layout.compactLayout-meta.xml"))).toEqual({
      fields: ["Name", "AccountNumber", "Type", "Industry", "SDO_Sales_Closed_Won_Value__c", "NumberOfEmployees", "SDO_Days_Since_Activity__c"],
      label: "Account",
    });
  });

  it("maps a Lightning page: regions are arrays, values stay strings", () => {
    const md = xmlToToolingMetadata("FlexiPage", fixture("Inquiry_LSDO_All_Personas.flexipage-meta.xml"))!;
    expect(md).toBeTruthy();
    expect(md.sobjectType).toBe("Inquiry");
    expect(md).not.toHaveProperty("fullName");
    const regions = md.flexiPageRegions as { itemInstances: { componentInstance?: { componentInstanceProperties?: { name: string; value?: string }[] } }[] }[];
    expect(Array.isArray(regions)).toBe(true);
    const props = regions.flatMap((r) => r.itemInstances).flatMap((i) => i.componentInstance?.componentInstanceProperties ?? []);
    expect(props.find((p) => p.name === "collapsed")).toEqual({ name: "collapsed", value: "false" });
    expect(props.find((p) => p.name === "actionNames")).toMatchObject({ valueList: { valueListItems: expect.any(Array) } });
    expect(md.template).toMatchObject({ name: "flexipage:recordHomeSingleColTemplateDesktop" });
  });

  it("converts the other Lightning page fixtures", () => {
    expect(xmlToToolingMetadata("FlexiPage", fixture("Home_LSDO_PH_FSR_LS_Comm_LS_KAM.flexipage-meta.xml"))).not.toBeUndefined();
    expect(xmlToToolingMetadata("CompactLayout", fixture("LSDO_Visit_Compact_Layout.compactLayout-meta.xml"))).toMatchObject({ fields: expect.any(Array) });
  });

  it("qualifies bare custom component and template names", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentName>myCmp</componentName>
                <identifier>c_myCmp</identifier>
            </componentInstance>
        </itemInstances>
        <name>main</name>
        <type>Region</type>
    </flexiPageRegions>
    <masterLabel>X</masterLabel>
    <template>
        <name>MyTemplate</name>
    </template>
    <type>HomePage</type>
</FlexiPage>
`;
    const md = xmlToToolingMetadata("FlexiPage", xml)! as { flexiPageRegions: { itemInstances: { componentInstance: { componentName: string } }[] }[]; template: { name: string } };
    expect(md.flexiPageRegions[0].itemInstances[0].componentInstance.componentName).toBe("c:myCmp");
    expect(md.template.name).toBe("c:MyTemplate");
  });

  it("types an app's booleans and numbers", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionOverrides>
        <actionName>View</actionName>
        <content>Page_A</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <skipRecordTypeSelect>false</skipRecordTypeSelect>
        <type>Flexipage</type>
    </actionOverrides>
    <brand>
        <headerColor>#0070D2</headerColor>
        <logoVersion>1</logoVersion>
        <shouldOverrideOrgTheme>true</shouldOverrideOrgTheme>
    </brand>
    <formFactors>Large</formFactors>
    <isNavAutoTempTabsDisabled>false</isNavAutoTempTabsDisabled>
    <label>My &amp; App</label>
    <navType>Standard</navType>
    <tabs>standard-Account</tabs>
    <uiType>Lightning</uiType>
</CustomApplication>
`;
    expect(xmlToToolingMetadata("CustomApplication", xml)).toEqual({
      actionOverrides: [{ actionName: "View", content: "Page_A", formFactor: "Large", pageOrSobjectType: "Account", skipRecordTypeSelect: false, type: "Flexipage" }],
      brand: { headerColor: "#0070D2", logoVersion: 1, shouldOverrideOrgTheme: true },
      formFactors: ["Large"],
      isNavAutoTempTabsDisabled: false,
      label: "My & App",
      navType: "Standard",
      tabs: ["standard-Account"],
      uiType: "Lightning",
    });
  });

  it("returns null for anything outside the mapped schema, so nothing is dropped silently", () => {
    const compact = fixture("Account_Layout.compactLayout-meta.xml");
    expect(xmlToToolingMetadata("CompactLayout", compact.replace("</CompactLayout>", "<unknown>1</unknown></CompactLayout>"))).toBeNull();
    expect(xmlToToolingMetadata("CustomApplication", compact)).toBeNull();
    expect(xmlToToolingMetadata("CustomApplication", `<CustomApplication xmlns="x"><isNavTabPersistenceDisabled>maybe</isNavTabPersistenceDisabled></CustomApplication>`)).toBeNull();
    expect(xmlToToolingMetadata("FlexiPage", `<FlexiPage xmlns="x"><events><name>e</name></events></FlexiPage>`)).toBeNull();
  });

  it("leaves file-asset references and padded text to the Metadata API", () => {
    const page = (value: string) => `<FlexiPage xmlns="x">
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>src</name>
                    <value>${value}</value>
                </componentInstanceProperties>
                <componentName>force:x</componentName>
            </componentInstance>
        </itemInstances>
        <name>main</name>
        <type>Region</type>
    </flexiPageRegions>
</FlexiPage>`;
    expect(xmlToToolingMetadata("FlexiPage", page("plain"))).not.toBeNull();
    expect(xmlToToolingMetadata("FlexiPage", page("{[devName:cirrus_logo]}"))).toBeNull();
    expect(xmlToToolingMetadata("FlexiPage", page(" padded"))).toBeNull();
    expect(xmlToToolingMetadata("FlexiPage", page("padded "))).toBeNull();
  });
});

describe("sameMetadata", () => {
  it("ignores the nulls and empty lists Tooling adds, nothing else", () => {
    const sent = { label: "A", fields: ["x", "y"] };
    expect(sameMetadata(sent, { label: "A", fields: ["x", "y"], urls: null, events: [] })).toBe(true);
    expect(sameMetadata(sent, { label: "A", fields: ["y", "x"] })).toBe(false);
    expect(sameMetadata(sent, { label: "B", fields: ["x", "y"] })).toBe(false);
    expect(sameMetadata(sent, { label: "A", fields: ["x", "y"], description: "added" })).toBe(false);
  });
});

describe("toolingTargetOf", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-test-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const put = (rel: string, body = "<x/>") => {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };

  it("takes one Lightning page, app or compact layout, as a file or alone in a folder", () => {
    const page = put("flexipages/Home_Page.flexipage-meta.xml");
    expect(toolingTargetOf(page)).toMatchObject({ type: "FlexiPage", developerName: "Home_Page" });
    expect(toolingTargetOf(path.join(tmp, "flexipages"))).toMatchObject({ type: "FlexiPage", developerName: "Home_Page" });
    expect(toolingTargetOf(put("applications/My_App.app-meta.xml"))).toMatchObject({ type: "CustomApplication", developerName: "My_App" });
    expect(toolingTargetOf(put("objects/Account/compactLayouts/Account_Layout.compactLayout-meta.xml"))).toMatchObject({
      type: "CompactLayout",
      developerName: "Account_Layout",
      sobject: "Account",
    });
  });

  it("refuses layouts, profiles, list views, namespaced names and more than one file", () => {
    expect(toolingTargetOf(put("layouts/Account-Layout.layout-meta.xml"))).toBeNull();
    expect(toolingTargetOf(put("profiles/Admin.profile-meta.xml"))).toBeNull();
    expect(toolingTargetOf(put("objects/Account/listViews/All.listView-meta.xml"))).toBeNull();
    expect(toolingTargetOf(put("flexipages/ns__Page.flexipage-meta.xml"))).toBeNull();
    expect(toolingTargetOf(put("compactLayouts/Loose.compactLayout-meta.xml"))).toBeNull();
    put("flexipages/A.flexipage-meta.xml");
    put("flexipages/B.flexipage-meta.xml");
    expect(toolingTargetOf(path.join(tmp, "flexipages"))).toBeNull();
    expect(toolingTargetOf(path.join(tmp, "missing"))).toBeNull();
  });
});

describe("toolingWriteMetadata", () => {
  let tmp: string;
  let file: string;
  let org: string;
  let n = 0;
  let calls: { method: string; url: string; body?: { Metadata?: unknown } }[];
  let sandbox: boolean;
  let idRows: unknown[];
  let patchStatus: number;
  let readBack: (sent: unknown) => unknown;
  let sent: unknown;

  beforeEach(() => {
    org = `tm-org-${++n}`;
    resetDirect();
    forgetToolingOrg();
    delete process.env.LSC_SF_DIRECT;
    delete process.env.LSC_SF_TOOLING_WRITES;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-test-"));
    file = path.join(tmp, "objects", "Account", "compactLayouts", "Account_Layout.compactLayout-meta.xml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fixture("Account_Layout.compactLayout-meta.xml"));
    calls = [];
    sandbox = true;
    idRows = [{ Id: "0AHHn000001hK1eOAE", NamespacePrefix: null, ManageableState: "unmanaged" }];
    patchStatus = 204;
    sent = undefined;
    readBack = (s) => ({ ...(s as object), urls: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });
        const q = decodeURIComponent(url).replace(/\+/g, " ");
        if (method === "PATCH") {
          sent = body.Metadata;
          return patchStatus === 204 ? new Response(null, { status: 204 }) : json([{ errorCode: "INVALID_CROSS_REFERENCE_KEY", message: "bad field" }], patchStatus);
        }
        if (q.includes("FROM Organization")) {
          return json({ totalSize: 1, done: true, records: [{ IsSandbox: sandbox, TrialExpirationDate: null, OrganizationType: "Enterprise Edition" }] });
        }
        if (q.includes("/tooling/query")) return json({ totalSize: idRows.length, done: true, records: idRows });
        if (q.includes("/tooling/sobjects/")) return json({ Id: "0AHHn000001hK1eOAE", Metadata: readBack(sent) });
        return json({}, 404);
      })
    );
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const patches = () => calls.filter((c) => c.method === "PATCH");

  it("PATCHes the converted Metadata to the item's Tooling record, reads it back and reports progress", async () => {
    const status: string[] = [];
    const res = await toolingWriteMetadata(file, org, fetcher, (s) => status.push(String(s.stateDetail)));
    expect(res).toEqual({ ok: true, data: undefined });
    expect(patches()).toHaveLength(1);
    expect(patches()[0].url).toBe("https://acme.my.salesforce.com/services/data/v68.0/tooling/sobjects/CompactLayout/0AHHn000001hK1eOAE");
    expect((patches()[0].body!.Metadata as { label: string }).label).toBe("Account");
    const idQuery = calls.map((c) => decodeURIComponent(c.url).replace(/\+/g, " ")).find((u) => u.includes("FROM CompactLayout"))!;
    expect(idQuery).toContain("DeveloperName = 'Account_Layout' AND SobjectType = 'Account'");
    expect(status).toEqual(["Saving through the Tooling API", "Checking what was saved"]);
  });

  it("falls back (null) on any Tooling error", async () => {
    patchStatus = 400;
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    patchStatus = 500;
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
  });

  it("falls back when the read-back differs from what was sent", async () => {
    readBack = (s) => ({ ...(s as object), label: "Something else" });
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
  });

  it("falls back when the item is missing, ambiguous, managed or not unmanaged", async () => {
    idRows = [];
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    idRows = [{ Id: "0AHHn000001hK1eOAE" }, { Id: "0AHHn000001hK1fOAE" }];
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    idRows = [{ Id: "0AHHn000001hK1eOAE", NamespacePrefix: "ns", ManageableState: "installed" }];
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    expect(patches()).toHaveLength(0);
  });

  it("does not use Tooling on a production org", async () => {
    sandbox = false;
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    expect(patches()).toHaveLength(0);
  });

  it("is off with LSC_SF_TOOLING_WRITES=0, without touching the network", async () => {
    process.env.LSC_SF_TOOLING_WRITES = "0";
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("leaves other types and unmapped XML alone", async () => {
    const layout = path.join(tmp, "layouts", "Visit-Visit_Layout.layout-meta.xml");
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(layout, fixture("Visit-Visit_Layout.layout-meta.xml"));
    expect(await toolingWriteMetadata(layout, org, fetcher)).toBeNull();
    fs.writeFileSync(file, fixture("Account_Layout.compactLayout-meta.xml").replace("</CompactLayout>", "<mystery>1</mystery></CompactLayout>"));
    expect(await toolingWriteMetadata(file, org, fetcher)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("falls back when there is no login or the network is down", async () => {
    expect(await toolingWriteMetadata(file, org, async () => null)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await toolingWriteMetadata(file, `${org}-down`, fetcher)).toBeNull();
  });

  it("only sends the token to an https instance", async () => {
    expect(await toolingWriteMetadata(file, `${org}-http`, async () => ({ ...creds, instanceUrl: "http://acme.my.salesforce.com" }))).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
