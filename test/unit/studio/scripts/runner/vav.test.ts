import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVisitContext } from "../../../../../src/studio/scripts/runner/context-data.js";
import { runScript, type RunInput } from "../../../../../src/studio/scripts/runner/run.js";
import type { Platform, Row } from "../../../../../src/studio/scripts/runner/types.js";
import { fakeReader } from "./fake-reader.js";

const visit: Row = { Id: "0Z5000000000001", Name: "V-1", AccountId: "001A", VisitId: "0Z5000000000009", Status: "Planned" };

const org = () => ({
  ProviderVisit: [visit],
  ProviderVisitProdDetailing: [{ Id: "d1", ProviderVisitId: visit.Id, ProductId: "p1" }],
  ProductDisbursement: [{ Id: "s1", VisitId: "0Z5000000000009" }],
  ProviderVisitDtlProductMsg: [{ Id: "m1", ProviderVisitProductDtlId: "d1" }],
  ProviderVisitProdDiscussion: [{ Id: "x1", ProviderVisitProductDtlId: "d1" }],
  Visit: [{ Id: "0Z5000000000008", ParentVisitId: "0Z5000000000009", AccountId: "001B" }],
  Account: [{ Id: "001A", Name: "Dr A", IsPersonAccount: true }],
  UserAdditionalInfo: [],
});

async function context(platform: Platform) {
  const notes: string[] = [];
  const reader = fakeReader(org(), {
    filter: (q, object, rows) => {
      // The fake reads every row of an object; filter the links the builder asks for.
      const link = /WHERE (\w+) IN \(([^)]*)\)/.exec(q);
      if (!link) return rows;
      const ids = [...link[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      return rows.filter((r) => ids.includes(String(r[link[1]])));
    },
  });
  // ProviderVisitRqstSample / MarketingItem aren't in this org: skipped with a note.
  const ctx = await buildVisitContext(reader, platform, visit, "ProviderVisit", "ProviderVisitId", notes);
  return { ctx, notes, reader };
}

describe("visit context data", () => {
  it("web: .VisitId keys, a ProviderVisit header and nested keys on each detail", async () => {
    const { ctx, notes } = await context("web");
    expect(Object.keys(ctx).sort()).toEqual(
      [
        "PresentationForum.ForumReferenceId",
        "ProductDisbursement.VisitId",
        "ProviderVisit",
        "ProviderVisitMarketingItem.VisitId",
        "ProviderVisitProdDetailing.VisitId",
        "ProviderVisitRqstSample.VisitId",
        "Visit.ParentVisitId",
      ].sort(),
    );
    const detail = (ctx["ProviderVisitProdDetailing.VisitId"] as Row[])[0];
    expect(detail["ProviderVisitDtlProductMsg.VisitId"]).toHaveLength(1);
    expect(detail["ProviderVisitProdDiscussion.VisitId"]).toHaveLength(1);
    expect(notes.join("\n")).toMatch(/ProviderVisitRqstSample isn't in this org/);
    expect(notes.join("\n")).toMatch(/PresentationForum isn't in this org/);
  });

  it("iPad: plain object names, no ProviderVisit key, ChildVisit flagged as inferred", async () => {
    const { ctx, notes } = await context("ipad");
    expect(ctx.ProviderVisit).toBeUndefined();
    expect(ctx.Visit).toBeDefined();
    expect(ctx.ProductDisbursement).toHaveLength(1);
    expect(ctx.ChildVisit).toHaveLength(1);
    expect(notes.join("\n")).toMatch(/inferred/);
  });
});

// The skill's confirmed IIFE pattern with a body that checks samples and details.
const skillPattern = (body: string) => `(() => {
    function parseContextData(record) {
        try {
            if (!record || typeof record.getContextData !== 'function') return {};
            var contextData = record.getContextData();
            if (typeof contextData === 'string') return JSON.parse(contextData);
            if (typeof contextData === 'object' && contextData !== null) return contextData;
            return {};
        } catch (e) { return {}; }
    }
    function getFieldData(contextData, baseFieldName) {
        return contextData[baseFieldName + '.VisitId'] || contextData[baseFieldName];
    }
    function unwrapProxy(results) { return JSON.parse(JSON.stringify(results)); }
    async function myValidation(contextData) {
        try {
            ${body}
        } catch (e) {
            return { title: 'Validation error: ' + e.message, status: 'error' };
        }
    }
    async function validateVisit() {
        try {
            var contextData = parseContextData(record);
            var hasWebField = contextData['ProviderVisit'] !== undefined;
            var result = await myValidation(contextData);
            var results = [result];
            if (hasWebField) { var resolved = await Promise.all(results); return unwrapProxy(resolved); }
            return unwrapProxy(results);
        } catch (error) {
            return [{ title: 'Validation error: ' + error.message, status: 'error' }];
        }
    }
    if (record && user && env && db) {
        var contextData = parseContextData(record);
        var hasWebField = contextData['ProviderVisit'] !== undefined;
        if (hasWebField) return [validateVisit()];
        else return validateVisit();
    }
})();`;

async function vav(code: string, platform: Platform, drop: string[] = []) {
  const { ctx } = await context(platform);
  for (const k of drop) delete ctx[k];
  const reader = fakeReader(org());
  const run: RunInput = {
    code,
    type: "VisitActionValidation",
    platform,
    record: { object: "ProviderVisit", fields: visit },
    user: { fields: { Id: "005X" } },
    contextData: ctx,
    nsPrefix: null,
    reader,
    env: { actionName: "Submit" },
  };
  return runScript(run);
}

describe("the skill's Visit Action Validation pattern", () => {
  const body = `
    var samples = getFieldData(contextData, 'ProductDisbursement') || [];
    var details = getFieldData(contextData, 'ProviderVisitProdDetailing') || [];
    if (!samples.length) return { title: 'Add a sample', status: 'error' };
    if (!details.length) return { title: 'Add a detail', status: 'warning' };
    return { title: 'Visit looks good', status: 'success' };`;

  for (const platform of ["web", "ipad"] as const) {
    it(`${platform}: success, warning and error`, async () => {
      const ok = await vav(skillPattern(body), platform);
      expect(ok).toMatchObject({ ok: true, outcome: "pass", results: [{ title: "Visit looks good", status: "success" }] });
      const warn = await vav(skillPattern(body), platform, [platform === "web" ? "ProviderVisitProdDetailing.VisitId" : "ProviderVisitProdDetailing"]);
      expect(warn).toMatchObject({ ok: true, outcome: "warn", results: [{ title: "Add a detail", status: "warning" }] });
      const err = await vav(skillPattern(body), platform, [platform === "web" ? "ProductDisbursement.VisitId" : "ProductDisbursement"]);
      expect(err).toMatchObject({ ok: true, outcome: "block", results: [{ title: "Add a sample", status: "error" }] });
    });
  }
});

describe("the official visit data example (reference section 7.3, verbatim)", () => {
  const doc = readFileSync(new URL("../../../../../knowledge/modules/custom-scripts/custom-scripts-api-reference.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("### 7.3"));
  const code = /```javascript\n([\s\S]*?)\n```/.exec(section)![1];

  it("runs on web and returns contract-valid results", async () => {
    const r = await vav(code, "web");
    expect(r.error).toBeUndefined();
    expect(r.contract).toEqual([]);
    expect(r.ok).toBe(true);
    const titles = r.results.map((x) => x.title).join("\n");
    expect(titles).toMatch(/Found 1 sample\(s\)/);
    expect(r.queries.length).toBeGreaterThan(0);
  });

  it("runs on iPad with the same data under plain keys", async () => {
    const r = await vav(code, "ipad");
    expect(r.error).toBeUndefined();
    expect(r.contract).toEqual([]);
    expect(r.results.map((x) => x.title).join("\n")).toMatch(/Found 1 sample\(s\)/);
  });

  it("blocks the visit when the samples are missing", async () => {
    const r = await vav(code, "web", ["ProductDisbursement.VisitId"]);
    expect(r.outcome).toBe("block");
    expect(r.results.some((x) => x.title === "At least one sample must be added to the visit.")).toBe(true);
  });
});
