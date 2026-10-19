import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { analyzeScript, CODE_TEXT_LIMIT, type ScriptCheckContext } from "../../../../src/studio/scripts/checks.js";

const VALIDATION: ScriptCheckContext = { type: "Validation", objectName: "Inquiry" };
const VAV: ScriptCheckContext = { type: "VisitActionValidation", objectName: "ProviderVisit", operationEventType: "OnUpdate" };

const GOOD = `(() => {
  const results = [];
  results.push({ title: "ok", status: "success" });
  return JSON.parse(JSON.stringify(results));
})();`;

const ids = (code: string, ctx = VALIDATION) => analyzeScript(code, ctx).map((d) => d.id);
const find = (code: string, id: string, ctx = VALIDATION) => analyzeScript(code, ctx).find((d) => d.id === id);

function applyFix(code: string, id: string, ctx = VALIDATION): string {
  const fix = find(code, id, ctx)?.fix;
  if (!fix) throw new Error(`no fix for ${id}`);
  let out = code;
  for (const c of [...fix.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

describe("analyzeScript", () => {
  it("passes a clean script", () => {
    expect(analyzeScript(GOOD, VALIDATION)).toEqual([]);
  });

  it("reports a syntax error at its offset and skips the tree rules", () => {
    const code = "(() => {\n  const x = ;\n})();";
    const d = analyzeScript(code, VALIDATION);
    expect(d.map((x) => x.id)).toEqual(["syntax"]);
    expect(d[0].severity).toBe("error");
    expect(code.slice(d[0].from, d[0].to)).toBe(";");
    expect(d[0].message).not.toMatch(/\(\d+:\d+\)/);
  });

  it("still flags a leading comment when the code does not parse", () => {
    expect(ids("// hi\n(() => { var = })();")).toEqual(expect.arrayContaining(["syntax", "comment-before-iife"]));
  });

  it("flags every kind of comment before the IIFE, with a fix that removes it", () => {
    const code = `// Checks the visit\n/* more */\n${GOOD}`;
    const d = find(code, "comment-before-iife")!;
    expect(d.severity).toBe("error");
    expect(code.slice(d.from, d.to)).toBe("// Checks the visit\n/* more */");
    expect(applyFix(code, "comment-before-iife")).toBe(GOOD);
    expect(ids(applyFix(code, "comment-before-iife"))).toEqual([]);
  });

  it("allows comments inside the function", () => {
    expect(ids(GOOD.replace("const results", "// start\n  const results"))).toEqual([]);
  });

  it("requires the IIFE", () => {
    expect(find("const a = 1;", "not-iife")?.severity).toBe("error");
    expect(find("function f() {}", "not-iife")?.severity).toBe("error");
    expect(find("   ", "not-iife")?.message).toMatch(/empty/);
  });

  it("accepts function and async IIFE forms", () => {
    for (const code of [
      "(function () { return JSON.parse(JSON.stringify([])); })();",
      "(async () => { return JSON.parse(JSON.stringify([])); })();",
      "(function () { return JSON.parse(JSON.stringify([])); }());".replace("}());", "})();"),
    ]) {
      expect(ids(code)).not.toContain("not-iife");
    }
  });

  it("warns about code outside the IIFE", () => {
    const d = find(`${GOOD}\nvar later = 1;`, "not-iife")!;
    expect(d.severity).toBe("warning");
  });

  it("warns when results are not unwrapped", () => {
    const d = find("(() => {\n  return [{ title: 'x', status: 'success' }];\n})();", "no-unwrap")!;
    expect(d.severity).toBe("warning");
    expect(ids(GOOD)).not.toContain("no-unwrap");
  });

  describe("custom fields", () => {
    it("suggests noNs_ for __c field names and rewrites the method", () => {
      const code = GOOD.replace('results.push', 'record.stringValue("Region__c");\n  results.push');
      const d = find(code, "custom-field-stringvalue")!;
      expect(d.severity).toBe("warning");
      expect(code.slice(d.from, d.to)).toBe("stringValue");
      expect(applyFix(code, "custom-field-stringvalue")).toContain('record.noNs_stringValue("Region__c")');
    });

    it("covers numValue, boolValue, dateValue", () => {
      for (const m of ["numValue", "boolValue", "dateValue"]) {
        expect(ids(GOOD.replace("results.push", `record.${m}('A__c');\n  results.push`))).toContain("custom-field-stringvalue");
      }
    });

    it("covers db.rowById and db.query on custom objects and metadata types", () => {
      const asyncGood = GOOD.replace("(() =>", "(async () =>");
      const a = asyncGood.replace("results.push", "await db.rowById('Thing__c', id);\n  results.push");
      const b = asyncGood.replace("results.push", "await db.query('Bypass__mdt', '');\n  results.push");
      expect(applyFix(a, "custom-field-stringvalue")).toContain("db.noNs_rowById('Thing__c'");
      expect(applyFix(b, "custom-field-stringvalue")).toContain("db.noNs_query('Bypass__mdt'");
    });

    it("leaves standard names and noNs_ calls alone", () => {
      const code = GOOD.replace("results.push", "record.stringValue('Name');\n  record.noNs_stringValue('A__c');\n  db.rowById('Account', 1);\n  results.push");
      expect(ids(code)).not.toContain("custom-field-stringvalue");
    });
  });

  describe("db-without-await", () => {
    const wrap = (stmt: string) => `(async () => {\n  ${stmt}\n  return JSON.parse(JSON.stringify([]));\n})();`;
    it("flags a bare call and offers await", () => {
      const code = wrap("const rows = db.query('Account', 'Id != null');");
      const d = find(code, "db-without-await")!;
      expect(code.slice(d.from, d.to)).toBe("db.query('Account', 'Id != null')");
      expect(applyFix(code, "db-without-await")).toContain("const rows = await db.query(");
    });
    it("accepts await, return, then-chains and arrays of promises", () => {
      for (const stmt of [
        "const r = await db.query('Account', '');",
        "const p = [db.query('Account', '')];",
        "db.rowById('Account', 1).then(function (r) {});",
        "await Promise.all([db.query('Account', '')]);",
      ]) {
        expect(ids(wrap(stmt))).not.toContain("db-without-await");
      }
    });
  });

  it("warns about browser APIs unless the script declares the name itself", () => {
    const bad = GOOD.replace("const results", "setTimeout(function () {}, 1);\n  var d = document.title;\n  const results");
    const found = analyzeScript(bad, VALIDATION).filter((d) => d.id === "browser-api");
    expect(found.map((d) => bad.slice(d.from, d.to))).toEqual(["setTimeout", "document"]);
    expect(found[0].severity).toBe("warning");
    expect(ids(GOOD.replace("const results", "const fetch = () => 1;\n  fetch();\n  const results"))).not.toContain("browser-api");
    // a property named like a global is not a use of it
    expect(ids(GOOD.replace("const results", "const o = { window: 1 };\n  o.document;\n  const results"))).not.toContain("browser-api");
  });

  it("suggests env.log for console calls", () => {
    const code = GOOD.replace("const results", "console.warn('x');\n  const results");
    const d = find(code, "console-log")!;
    expect(d.severity).toBe("info");
    expect(applyFix(code, "console-log")).toContain("env.log('x')");
  });

  it("errors on GroupCondition", () => {
    const code = GOOD.replace("const results", "const g = new GroupCondition('AND');\n  const results");
    expect(find(code, "group-condition")?.severity).toBe("error");
  });

  describe("size", () => {
    const padded = (n: number) => `(() => {\n  var s = "${"x".repeat(n)}";\n  return JSON.parse(JSON.stringify([]));\n})();`;
    it("warns at about 60 KB and errors over the CodeText limit", () => {
      expect(find(padded(70_000), "too-large")?.severity).toBe("warning");
      expect(find(padded(CODE_TEXT_LIMIT), "too-large")?.severity).toBe("error");
      expect(ids(padded(1000))).not.toContain("too-large");
    });
  });

  describe("visit action validation", () => {
    it("errors when the object or event is wrong, saying it silently won't run", () => {
      const d = analyzeScript(GOOD, { type: "VisitActionValidation", objectName: "Visit", operationEventType: "OnCreate" });
      const obj = d.find((x) => x.id === "vav-object-name")!;
      const evt = d.find((x) => x.id === "vav-event-type")!;
      expect(obj.severity).toBe("error");
      expect(evt.severity).toBe("error");
      expect(obj.message).toMatch(/silently won't run/);
      expect(evt.message).toMatch(/OnUpdate/);
      expect([obj.from, obj.to]).toEqual([0, 0]);
    });
    it("is silent about both for the right values, and for other types", () => {
      expect(ids(GOOD, VAV)).not.toEqual(expect.arrayContaining(["vav-object-name", "vav-event-type"]));
      expect(ids(GOOD, { type: "Checklist" })).toEqual([]);
    });
    it("suggests a guard for visit action validations only", () => {
      expect(ids(GOOD, VAV)).toContain("no-global-guard");
      expect(find(GOOD, "no-global-guard", VAV)?.severity).toBe("info");
      const guarded = GOOD.replace("const results", "if (!(record && user && env && db)) return [];\n  const results");
      expect(ids(guarded, VAV)).not.toContain("no-global-guard");
      expect(ids(GOOD, VALIDATION)).not.toContain("no-global-guard");
    });
  });

  describe("returns-non-array", () => {
    it("flags an object, a literal, nothing, and a variable holding an object", () => {
      expect(ids("(() => { return JSON.parse(JSON.stringify({ title: 'a' })); })();")).toContain("returns-non-array");
      expect(ids("(() => { return JSON.parse(JSON.stringify('a')); })();")).toContain("returns-non-array");
      expect(ids("(() => { var a = 1; JSON.parse(JSON.stringify(a)); })();")).toContain("returns-non-array");
      expect(ids("(() => { const r = {}; return JSON.parse(JSON.stringify(r)); })();")).toContain("returns-non-array");
      expect(find("(() => { return JSON.parse(JSON.stringify({})); })();", "returns-non-array")?.severity).toBe("info");
    });
    it("accepts arrays, variables holding arrays, calls and promises", () => {
      expect(ids("(() => { return JSON.parse(JSON.stringify([])); })();")).not.toContain("returns-non-array");
      expect(ids(GOOD)).not.toContain("returns-non-array");
      expect(ids("(() => { const r = f(); return JSON.parse(JSON.stringify(r)); })();")).not.toContain("returns-non-array");
      expect(ids("(async () => { return JSON.parse(JSON.stringify(await go())); })();")).not.toContain("returns-non-array");
    });
    it("reads an arrow expression body", () => {
      expect(ids("(() => ({ a: 1 }))();")).toContain("returns-non-array");
      expect(ids("(() => [1])();")).not.toContain("returns-non-array");
    });
  });

  it("orders diagnostics by position, errors first on ties", () => {
    const d = analyzeScript("// c\n(() => { new GroupCondition(); })();", VALIDATION);
    const froms = d.map((x) => x.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
  });
});

describe("the renderer's copy", () => {
  it("is byte-identical to the server's checks", () => {
    const root = path.resolve(__dirname, "../../../..");
    const server = fs.readFileSync(path.join(root, "src/studio/scripts/checks.ts"), "utf-8");
    const renderer = fs.readFileSync(path.join(root, "src-renderer/components/studio/scripts/script-checks.ts"), "utf-8");
    expect(renderer).toBe(server);
  });
});
