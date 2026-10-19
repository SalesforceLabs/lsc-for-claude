import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildDeployZip, directDelete, directDeploy, directRetrieve, parseMetadataSpecs, zipFiles } from "../../../src/salesforce/direct-metadata.js";
import { resetDirect } from "../../../src/salesforce/direct.js";
import { ZipReader } from "../../../src/perf/device/zip.js";

const ORG = "demo";
const creds = { accessToken: "tok-1", instanceUrl: "https://acme.my.salesforce.com", apiVersion: "62.0" };
const FIXTURES = path.join(__dirname, "../../fixtures/metadata");

const envelope = (op: string, result: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/04/metadata"><soapenv:Body><${op}Response><result>${result}</result></${op}Response></soapenv:Body></soapenv:Envelope>`;
const xmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml" } });

function readZip(buf: Buffer): Record<string, string> {
  const file = path.join(os.tmpdir(), `dm-test-${process.pid}-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, buf);
  const reader = ZipReader.open(file);
  try {
    return Object.fromEntries(reader.entries.map((e) => [e.name, reader.read(e).toString("utf-8")]));
  } finally {
    reader.close();
    fs.rmSync(file);
  }
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-"));
  resetDirect();
  delete process.env.LSC_SF_DIRECT;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("parseMetadataSpecs", () => {
  it("takes the types Studio edits and leaves the rest to the CLI", () => {
    expect(parseMetadataSpecs(["Layout:Contact-Contact Layout", "CustomApplication"])).toEqual([
      { type: "Layout", fullName: "Contact-Contact Layout" },
      { type: "CustomApplication", fullName: undefined },
    ]);
    expect(parseMetadataSpecs(["ListView:Account.MyAccounts"])).toEqual([{ type: "ListView", fullName: "Account.MyAccounts" }]);
    expect(parseMetadataSpecs(["ApexClass:Foo"])).toBeNull();
    expect(parseMetadataSpecs(["Layout:Contact-Contact Layout", "CustomObject:Account"])).toBeNull();
    expect(parseMetadataSpecs(["CompactLayout"])).toBeNull();
    expect(parseMetadataSpecs(["Layout:Account-*"])).toBeNull();
  });
});

describe("zipFiles", () => {
  it("writes a zip the reader opens, with the bytes intact", () => {
    const files = { "layouts/A B.layout": "<Layout>é</Layout>", "package.xml": "<Package/>" };
    const zip = zipFiles(Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) })));
    expect(readZip(zip)).toEqual(files);
  });
});

describe("buildDeployZip", () => {
  it("sends a one-file type as the Metadata API file, byte for byte", () => {
    const dir = path.join(tmp, "layouts");
    fs.mkdirSync(dir);
    const src = fs.readFileSync(path.join(FIXTURES, "Visit-Visit_Layout.layout-meta.xml"));
    fs.writeFileSync(path.join(dir, "Visit-Visit Layout.layout-meta.xml"), src);
    const built = buildDeployZip(path.join(dir, "Visit-Visit Layout.layout-meta.xml"), "62.0")!;
    const files = readZip(built.zip);
    expect(files["layouts/Visit-Visit Layout.layout"]).toBe(src.toString("utf-8"));
    expect(files["package.xml"]).toContain("<types><members>Visit-Visit Layout</members><name>Layout</name></types><version>62.0</version>");
  });

  it("decodes an encoded layout file name for the manifest", () => {
    const file = path.join(tmp, "Account-Account %28Marketing%29 Layout.layout-meta.xml");
    fs.writeFileSync(file, "<Layout/>");
    const files = readZip(buildDeployZip(file, "62.0")!.zip);
    expect(Object.keys(files)).toContain("layouts/Account-Account %28Marketing%29 Layout.layout");
    expect(files["package.xml"]).toContain("<members>Account-Account (Marketing) Layout</members>");
  });

  it("wraps a compact layout and a list view in their object's file", () => {
    const obj = path.join(tmp, "objects", "Account");
    fs.mkdirSync(path.join(obj, "compactLayouts"), { recursive: true });
    fs.mkdirSync(path.join(obj, "listViews"), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, "Account_Layout.compactLayout-meta.xml"), path.join(obj, "compactLayouts", "Account_Layout.compactLayout-meta.xml"));
    fs.copyFileSync(path.join(FIXTURES, "Account.MyAccounts.listView-meta.xml"), path.join(obj, "listViews", "MyAccounts.listView-meta.xml"));
    const built = buildDeployZip(path.join(tmp, "objects"), "62.0")!;
    const files = readZip(built.zip);
    const object = files["objects/Account.object"];
    expect(object).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<CustomObject xmlns="http:\/\/soap.sforce.com\/2006\/04\/metadata">\n {4}<compactLayouts>\n {8}<fullName>Account_Layout<\/fullName>/);
    expect(object).toContain("    <listViews>\n        <fullName>MyAccounts</fullName>\n        <filterScope>Mine</filterScope>");
    expect(files["package.xml"]).toContain("<members>Account.Account_Layout</members><name>CompactLayout</name>");
    expect(files["package.xml"]).toContain("<members>Account.MyAccounts</members><name>ListView</name>");
  });

  it("leaves a folder with anything else in it to the CLI", () => {
    fs.writeFileSync(path.join(tmp, "Foo.cls-meta.xml"), "<ApexClass/>");
    fs.writeFileSync(path.join(tmp, "A-B.layout-meta.xml"), "<Layout/>");
    expect(buildDeployZip(tmp, "62.0")).toBeNull();
  });
});

describe("directRetrieve", () => {
  it("polls the retrieve and writes the files in source format", async () => {
    const layout = fs.readFileSync(path.join(FIXTURES, "Visit-Visit_Layout.layout-meta.xml"));
    const object = `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n    <listViews>\n        <fullName>My_Next_Visits</fullName>\n        <filterScope>Mine</filterScope>\n        <label>Don&apos;t miss</label>\n    </listViews>\n</CustomObject>\n`;
    const zip = zipFiles([
      { name: "layouts/Visit-Visit Layout.layout", data: layout },
      { name: "objects/Visit.object", data: Buffer.from(object) },
      { name: "package.xml", data: Buffer.from("<Package/>") },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse(envelope("retrieve", "<done>false</done><id>09S1</id><state>Queued</state>")))
      .mockResolvedValueOnce(xmlResponse(envelope("checkRetrieveStatus", "<done>false</done><id>09S1</id><status>InProgress</status>")))
      .mockResolvedValueOnce(xmlResponse(envelope("checkRetrieveStatus", `<done>true</done><id>09S1</id><status>Succeeded</status><success>true</success><zipFile>${zip.toString("base64")}</zipFile>`)));
    vi.stubGlobal("fetch", fetchMock);
    const out = await directRetrieve(["Layout:Visit-Visit Layout", "ListView:Visit.My_Next_Visits"], ORG, tmp, async () => creds);
    expect(out).toEqual({ ok: true, data: undefined });
    expect(fs.readFileSync(path.join(tmp, "layouts", "Visit-Visit Layout.layout-meta.xml")).equals(layout)).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "objects", "Visit", "listViews", "My_Next_Visits.listView-meta.xml"), "utf-8")).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<ListView xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>My_Next_Visits</fullName>\n    <filterScope>Mine</filterScope>\n    <label>Don&apos;t miss</label>\n</ListView>\n`
    );
    expect(fs.readdirSync(tmp).sort()).toEqual(["layouts", "objects"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.my.salesforce.com/services/Soap/m/62.0");
    expect(init.body).toContain("<sessionId>tok-1</sessionId>");
    expect(init.body).toContain("<types><members>Visit-Visit Layout</members><name>Layout</name></types><types><members>Visit.My_Next_Visits</members><name>ListView</name></types>");
  });

  it("falls back to the CLI when the session is rejected and sf has no newer token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => xmlResponse("<soapenv:Envelope><soapenv:Body><soapenv:Fault><faultcode>sf:INVALID_SESSION_ID</faultcode><faultstring>Invalid Session ID</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>", 500))
    );
    expect(await directRetrieve(["Layout:A-B"], ORG, tmp, async () => creds)).toBeNull();
  });

  it("is off when LSC_SF_DIRECT=0", async () => {
    process.env.LSC_SF_DIRECT = "0";
    const fetcher = vi.fn(async () => creds);
    expect(await directRetrieve(["Layout:A-B"], ORG, tmp, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("directDelete", () => {
  it("sends an empty package with a post-destructive list of the one component", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse(envelope("deploy", "<done>false</done><id>0Af1</id>")))
      .mockResolvedValueOnce(xmlResponse(envelope("checkDeployStatus", "<done>true</done><id>0Af1</id><status>Succeeded</status><success>true</success>")));
    vi.stubGlobal("fetch", fetchMock);
    expect(await directDelete("Layout", "Contact-Copy & Co", ORG, async () => creds)).toEqual({ ok: true, data: undefined });
    const body = String(fetchMock.mock.calls[0][1].body);
    const zip = Buffer.from(/<ZipFile>([^<]+)<\/ZipFile>/.exec(body)![1], "base64");
    const files = readZip(zip);
    expect(Object.keys(files).sort()).toEqual(["destructiveChangesPost.xml", "package.xml"]);
    expect(files["destructiveChangesPost.xml"]).toContain("<members>Contact-Copy &amp; Co</members><name>Layout</name>");
    expect(files["package.xml"]).not.toContain("<types>");
    expect(body).toContain("<rollbackOnError>true</rollbackOnError>");
  });

  it("reports why the component can't be deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(xmlResponse(envelope("deploy", "<done>false</done><id>0Af1</id>")))
        .mockResolvedValueOnce(
          xmlResponse(envelope("checkDeployStatus", "<done>true</done><id>0Af1</id><status>Failed</status><success>false</success><details><componentFailures><fullName>X</fullName><problem>in use</problem></componentFailures></details>"))
        )
    );
    expect(await directDelete("Layout", "X", ORG, async () => creds)).toEqual({ ok: false, error: "X: in use" });
  });
});

describe("directDeploy", () => {
  it("reports component failures and doesn't retry", async () => {
    const file = path.join(tmp, "A-B.layout-meta.xml");
    fs.writeFileSync(file, "<Layout/>");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse(envelope("deploy", "<done>false</done><id>0Af1</id>")))
      .mockResolvedValueOnce(
        xmlResponse(
          envelope(
            "checkDeployStatus",
            "<done>true</done><id>0Af1</id><status>Failed</status><success>false</success><details><componentFailures><fullName>A-B</fullName><problem>Field &apos;Foo__c&apos; doesn&apos;t exist</problem></componentFailures></details>"
          )
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const out = await directDeploy(file, ORG, async () => creds);
    expect(out).toEqual({ ok: false, error: "A-B: Field 'Foo__c' doesn't exist", rejected: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].body).toContain("<rollbackOnError>true</rollbackOnError>");
  });

  it("succeeds when the deploy does", async () => {
    const file = path.join(tmp, "A-B.layout-meta.xml");
    fs.writeFileSync(file, "<Layout/>");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(xmlResponse(envelope("deploy", "<done>false</done><id>0Af1</id>")))
        .mockResolvedValueOnce(xmlResponse(envelope("checkDeployStatus", "<done>true</done><id>0Af1</id><status>Succeeded</status><success>true</success>")))
    );
    expect(await directDeploy(file, ORG, async () => creds)).toEqual({ ok: true, data: undefined });
  });

  it("validates only when asked to check", async () => {
    const file = path.join(tmp, "A-B.layout-meta.xml");
    fs.writeFileSync(file, "<Layout/>");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse(envelope("deploy", "<done>false</done><id>0Af1</id>")))
      .mockResolvedValueOnce(xmlResponse(envelope("checkDeployStatus", "<done>true</done><id>0Af1</id><status>Succeeded</status><success>true</success>")));
    vi.stubGlobal("fetch", fetchMock);
    expect(await directDeploy(file, ORG, async () => creds, undefined, undefined, true)).toEqual({ ok: true, data: undefined });
    expect(fetchMock.mock.calls[0][1].body).toContain("<checkOnly>true</checkOnly>");
  });

  it("says so, rather than deploying again, when the connection drops mid-deploy", async () => {
    const file = path.join(tmp, "A-B.layout-meta.xml");
    fs.writeFileSync(file, "<Layout/>");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(xmlResponse(envelope("deploy", "<done>false</done><id>0Af1</id>")))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
    );
    const out = await directDeploy(file, ORG, async () => creds);
    expect(out?.ok).toBe(false);
    expect(out && !out.ok && out.error).toMatch(/Lost the connection/);
  });
});
