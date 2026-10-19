import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  apiRequest: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const server = await import("../../../src/studio/component-props.js");
const { checkProp, normalizeProp, untypedDef, fieldIpadNote, componentNote, IPAD_READS: rendererReads, DYNAMIC_COMPONENTS } = await import("../../../src-renderer/components/studio/component-props.js");

const META = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>62.0</apiVersion>
  <isExposed>true</isExposed>
  <targets>
    <target>lightning__RecordPage</target>
    <target>lightning__HomePage</target>
  </targets>
  <targetConfigs>
    <targetConfig targets="lightning__RecordPage">
      <objects><object>Account</object></objects>
      <property name="mobileHeight" type="Integer" label="Height" min="100" max="900" default="300" description="Frame height"/>
      <property name="heading" type="String" label="Heading" required="true"/>
      <property name="density" type="String" label="Density" datasource="compact, comfy,roomy" default="comfy"/>
      <property name="showAll" type="Boolean" default="true"/>
      <property name="fromApex" type="String" datasource="apex://MyPicklist"/>
    </targetConfig>
    <targetConfig targets="lightning__HomePage,lightning__AppPage">
      <property name="heading" type="String" label="Home heading"/>
      <property name="limit" type="Integer" min="1"/>
    </targetConfig>
    <targetConfig targets="lightning__FlowScreen">
      <property name="flowOnly" type="String"/>
    </targetConfig>
  </targetConfigs>
</LightningComponentBundle>`;

describe("parseJsMeta", () => {
  it("reads typed properties for a record page", () => {
    const defs = server.parseJsMeta(META, "RecordPage");
    expect(defs.map((d) => d.name)).toEqual(["mobileHeight", "heading", "density", "showAll", "fromApex"]);
    expect(defs[0]).toMatchObject({ type: "Integer", label: "Height", min: 100, max: 900, default: "300", description: "Frame height" });
    expect(defs[1]).toMatchObject({ type: "String", required: true });
    expect(defs[2]).toMatchObject({ type: "Picklist", options: ["compact", "comfy", "roomy"], default: "comfy" });
    expect(defs[3]).toMatchObject({ type: "Boolean", label: "showAll", default: "true" });
    // An Apex datasource can't be listed, so it stays free text.
    expect(defs[4]).toMatchObject({ type: "String" });
    expect(defs[4].options).toBeUndefined();
  });

  it("reads a home page's own config, and skips other targets", () => {
    const defs = server.parseJsMeta(META, "HomePage");
    expect(defs.map((d) => [d.name, d.label])).toEqual([
      ["heading", "Home heading"],
      ["limit", "limit"],
    ]);
    expect(server.parseJsMeta(META).map((d) => d.name)).not.toContain("flowOnly");
  });

  it("returns nothing for XML without target configs", () => {
    expect(server.parseJsMeta("<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>", "RecordPage")).toEqual([]);
    expect(server.parseJsMeta("not xml at all <<")).toEqual([]);
  });
});

describe("collectComponentProps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers standard components from the curated table without an org call", async () => {
    const res = await server.collectComponentProps("flexipage:richText", "HomePage", "org");
    expect(res.source).toBe("curated");
    expect(res.properties.find((p) => p.name === "richTextValue")).toMatchObject({ ipad: "used", multiline: true });
    expect(res.properties.find((p) => p.name === "decorate")).toMatchObject({ ipad: "used" });
    expect(cli.runToolingQuery).not.toHaveBeenCalled();
  });

  it("marks Agentforce welcome as reading every property", async () => {
    const res = await server.collectComponentProps("c:lsAgentforceWelcome", "HomePage", "org");
    expect(res.dynamic).toMatch(/prompt chip/);
  });

  it("reads an inline LWC's bundle and always offers mobileHeight as read by the iPad", async () => {
    vi.mocked(cli.runToolingQuery).mockResolvedValue({ success: true, data: { records: [{ Source: META }] } } as never);
    const res = await server.collectComponentProps("lscMobileInline_Carousel", "RecordPage", "org");
    expect(res.source).toBe("bundle");
    expect(res.properties.find((p) => p.name === "mobileHeight")).toMatchObject({ ipad: "used", min: 100, max: 900 });
    // LMRModule.swift:110: only the height is handed to an inline LWC, so its own properties are not used.
    expect(res.properties.find((p) => p.name === "heading")).toMatchObject({ ipad: "unused" });
    expect(res.renders).toBe("yes");
    expect(res.rendersNote).toMatch(/only its height/);
    expect(res.unlisted).toBe("unused");
    const soql = String(vi.mocked(cli.runToolingQuery).mock.calls[0][0]);
    expect(soql).toContain("DeveloperName = 'lscMobileInline_Carousel'");
    expect(soql).toContain("NamespacePrefix = null");
  });

  it("queries a namespaced bundle by its prefix and falls back when the source is hidden", async () => {
    vi.mocked(cli.runToolingQuery).mockResolvedValue({ success: true, data: { records: [] } } as never);
    const res = await server.collectComponentProps("lsc4ce:lscMobileInline_Alpha", "RecordPage", "org");
    expect(String(vi.mocked(cli.runToolingQuery).mock.calls[0][0])).toContain("NamespacePrefix = 'lsc4ce'");
    expect(res.properties.map((p) => p.name)).toEqual(["mobileHeight"]);
    expect(res.note).toMatch(/js-meta/);
  });

  it("covers analytics_embedding:metric with typed, iPad-read properties", async () => {
    const res = await server.collectComponentProps("analytics_embedding:metric", "RecordPage", "org");
    expect(res.source).toBe("curated");
    expect(res.renders).toBe("yes");
    expect(res.properties.length).toBeGreaterThan(0);
    expect(res.properties.find((p) => p.name === "metricId")).toBeTruthy();
    expect(res.unlisted).toBe("unused");
  });

  it("says once, at the component level, that an undrawn component's properties are unused", async () => {
    vi.mocked(cli.runToolingQuery).mockResolvedValue({ success: true, data: { records: [] } } as never);
    const res = await server.collectComponentProps("forceChatter:publisher", "RecordPage", "org");
    expect(res.renders).toBe("no");
    expect(res.rendersNote).toBe(server.NOT_RENDERED_NOTE);
    expect(res.unlisted).toBe("unused");
    expect(res.properties.every((p) => p.ipad !== "used")).toBe(true);
  });

  it("answers every curated component without an org call, never 'unknown' except untraced ones", async () => {
    const names = [
      "flexipage:tab", "flexipage:tabset", "flexipage:richText", "flexipage:accordion", "flexipage:fieldSection",
      "force:relatedListContainer", "lst:dynamicRelatedList", "analytics_embedding:dashboard",
      "analytics_embedding:visualization", "analytics_embedding:metric", "flowruntime:interview",
      "c:LSCGenericRelatedList", "c:LSCVideoCallRecordingList", "c:AccountSalesChart", "c:Ratings", "c:ganttChart",
    ];
    for (const n of names) {
      const res = await server.collectComponentProps(n, "RecordPage", "org");
      expect(res.unlisted, n).not.toBe("unknown");
    }
    expect(cli.runToolingQuery).not.toHaveBeenCalled();
  });

  it("flags untraced components once", async () => {
    const res = await server.collectComponentProps("c:profilingQuestions", "RecordPage", "org");
    expect(res.unlisted).toBe("unknown");
    expect(res.rendersNote).toBe(server.UNTRACED_NOTE);
  });

  it("rejects odd component names", async () => {
    await expect(server.collectComponentProps("a'b", undefined, "org")).rejects.toThrow(/Invalid/);
  });
});

describe("typed checks", () => {
  const int = { name: "n", label: "Rows", type: "Integer" as const, min: 2, max: 20, ipad: "used" as const };
  it("checks whole numbers against the range", () => {
    expect(checkProp(int, "5")).toEqual({});
    expect(checkProp(int, "1").problem).toMatch(/from 2 to 20/);
    expect(checkProp(int, "21").problem).toBeTruthy();
    expect(checkProp(int, "2.5").problem).toBeTruthy();
    expect(checkProp(int, "abc").problem).toBeTruthy();
    expect(checkProp({ ...int, min: undefined, max: undefined }, "0").problem).toMatch(/from 1 to 9999/);
  });

  it("requires a value only when the property is required", () => {
    expect(checkProp(int, "")).toEqual({});
    expect(checkProp({ ...int, required: true }, " ").problem).toMatch(/required/);
  });

  it("checks picklists, booleans and string length", () => {
    const pick = { name: "p", label: "P", type: "Picklist" as const, options: ["a", "b"], ipad: "unknown" as const };
    expect(checkProp(pick, "a")).toEqual({});
    expect(checkProp(pick, "c").problem).toBeTruthy();
    expect(checkProp({ ...pick, type: "Boolean" }, "true")).toEqual({});
    expect(checkProp({ ...pick, type: "Boolean" }, "yes").problem).toBeTruthy();
    expect(checkProp({ ...pick, type: "String" }, "x".repeat(1001)).problem).toMatch(/1000/);
  });

  it("stores whole numbers plainly and an empty value as none", () => {
    expect(normalizeProp(int, "007")).toBe("7");
    expect(normalizeProp(int, " ")).toBeNull();
    expect(normalizeProp({ ...int, type: "String" }, "007")).toBe("007");
  });

  it("marks untyped properties by what the component says about unlisted ones", () => {
    expect(untypedDef("anything", "used").ipad).toBe("used");
    expect(untypedDef("anything", "unused").ipad).toBe("unused");
    expect(untypedDef("anything", "unknown")).toMatchObject({ ipad: "unknown" });
    // Every component reads its title as the header (SFComponentViewController.swift:119).
    expect(untypedDef("title", "unused").ipad).toBe("used");
    // Until the answer arrives, nothing is claimed beyond the preview's own list.
    expect(untypedDef("richTextValue").ipad).toBe("used");
    expect(untypedDef("anything").ipad).toBe("unknown");
    expect(untypedDef("anything").ipadNote).toBeUndefined();
  });

  it("never says Studio doesn't know on a field", () => {
    const unknown = untypedDef("x", "unknown");
    expect(fieldIpadNote(unknown, false)).toBeNull();
  });

  it("says Not used on the iPad per field, but once for a component the iPad doesn't draw", () => {
    const def = untypedDef("x", "unused");
    expect(fieldIpadNote(def, false)).toBe("Not used on the iPad");
    expect(fieldIpadNote(def, true)).toBeNull();
    expect(fieldIpadNote({ ...def, ipadNote: "The iPad draws its own tab bar." }, false)).toBe("Not used on the iPad — The iPad draws its own tab bar.");
    expect(fieldIpadNote(untypedDef("x", "used"), false)).toBeNull();
  });

  it("builds the component line", () => {
    const base = { component: "c:x", source: "none" as const, properties: [], unlisted: "unused" as const };
    expect(componentNote({ ...base, renders: "no" })).toMatch(/doesn't draw this component/);
    expect(componentNote({ ...base, renders: "yes", rendersNote: "Only the height." })).toBe("Only the height.");
    expect(componentNote({ ...base, renders: "yes" })).toBeNull();
    expect(componentNote(null)).toBeNull();
  });
});

describe("renderer copies", () => {
  it("IPAD_READS equals the server's", () => {
    expect([...rendererReads].sort()).toEqual([...server.IPAD_READS].sort());
  });
  it("lists the components that read every property", () => {
    for (const name of DYNAMIC_COMPONENTS) expect(server.curatedFor(name)?.dynamic).toBeTruthy();
  });
});
