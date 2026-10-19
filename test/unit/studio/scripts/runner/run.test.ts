import { describe, expect, it } from "vitest";
import { runScript, type RunInput } from "../../../../../src/studio/scripts/runner/run.js";
import type { Platform, ScriptType } from "../../../../../src/studio/scripts/runner/types.js";
import { fakeReader } from "./fake-reader.js";

function input(code: string, over: Partial<RunInput> & { platform?: Platform; type?: ScriptType } = {}): RunInput {
  return {
    code,
    type: "Validation",
    platform: "web",
    record: { object: "Inquiry", fields: { Id: "a01", Name: "Case 1", Status: "Open", Amount: "12.5", Done: true, Custom__c: "x" } },
    user: { fields: { Id: "005X", Username: "rep@example.com" } },
    contextData: null,
    nsPrefix: null,
    reader: fakeReader({ Account: [{ Id: "001", Name: "Acme", IsPersonAccount: false }] }),
    ...over,
  };
}

describe("outcomes and the output contract", () => {
  it("passes when every result succeeds", async () => {
    const r = await runScript(input(`(() => [{ title: "ok", status: "success" }])();`));
    expect(r).toMatchObject({ ok: true, outcome: "pass", results: [{ title: "ok", status: "success" }], contract: [] });
  });

  it("blocks on an error result and warns on a warning", async () => {
    const block = await runScript(input(`(() => [{ title: "a", status: "warning" }, { title: "b", status: "error" }])();`));
    expect(block.outcome).toBe("block");
    const warn = await runScript(input(`(() => [{ title: "a", status: "warning" }])();`));
    expect(warn.outcome).toBe("warn");
  });

  it("never blocks a checklist", async () => {
    const r = await runScript(input(`(() => [{ title: "b", status: "error" }])();`, { type: "Checklist" }));
    expect(r.outcome).toBe("warn");
  });

  it("flags a script that doesn't return an array", async () => {
    const r = await runScript(input(`(() => ({ title: "x", status: "success" }))();`));
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("none");
    expect(r.contract[0]).toMatch(/not an array/);
  });

  it("explains the comment-before-IIFE trap", async () => {
    const r = await runScript(input(`// checks the visit\n(() => [{ title: "x", status: "success" }])();`));
    expect(r.ok).toBe(false);
    expect(r.contract[0]).toMatch(/returned nothing/);
  });

  it("flags unknown statuses, missing titles and function elements", async () => {
    const r = await runScript(input(`(() => [{ title: "a", status: "fine" }, { status: "success" }, () => 1])();`));
    expect(r.ok).toBe(false);
    expect(r.contract.join("\n")).toMatch(/status "fine"/);
    expect(r.contract.join("\n")).toMatch(/Result 2 has no string title/);
    expect(r.contract.join("\n")).toMatch(/Result 3 is a function/);
  });

  it("flags a Promise returned on iPad, and awaits it on web", async () => {
    const code = `(() => Promise.resolve([{ title: "a", status: "success" }]))();`;
    const web = await runScript(input(code));
    expect(web).toMatchObject({ ok: true, outcome: "pass" });
    const ipad = await runScript(input(code, { platform: "ipad" }));
    expect(ipad.contract.join("\n")).toMatch(/Promise/);
  });

  it("reports a promise that never settles", async () => {
    const r = await runScript(input(`(() => new Promise(() => {}))();`));
    expect(r.ok).toBe(false);
    expect(r.contract[0]).toMatch(/never finished/);
  });

  it("flags Locker proxies returned from db.query on web", async () => {
    const code = `(async () => { const rows = await db.query("Account", ""); return [{ title: "n", status: "success", rows }]; })();`;
    const web = await runScript(input(code));
    expect(web.contract.join("\n")).toMatch(/proxies/);
    const ipad = await runScript(input(code, { platform: "ipad" }));
    expect(ipad.contract.join("\n")).not.toMatch(/proxies/);
  });
});

describe("errors", () => {
  it("reports a thrown error with its line and column", async () => {
    const r = await runScript(input(`(() => {\n  const a = 1;\n  throw new Error("boom");\n})();`));
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ message: "boom", line: 3 });
    expect(r.error?.column).toBe(9);
  });

  it("reports the line of an error inside an async function", async () => {
    const r = await runScript(input(`(async () => {\n  await Promise.resolve();\n  undefinedThing();\n})();`));
    expect(r.error).toMatchObject({ message: expect.stringContaining("undefinedThing"), line: 3 });
  });

  it("reports syntax errors with a position", async () => {
    const r = await runScript(input(`(() => {\n  const = 1;\n})();`));
    expect(r.error?.line).toBe(2);
    expect(r.error?.message).toMatch(/Unexpected/);
  });

  it("stops an infinite loop at the CPU limit", async () => {
    const r = await runScript(input(`(() => { while (true) {} })();`));
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/CPU limit/);
    expect(r.durationMs).toBeLessThan(9000);
  }, 15_000);

  it("has no require, process or dynamic code", async () => {
    const r = await runScript(
      input(`(() => [{ title: [typeof require, typeof process, typeof module, typeof fetch].join(","), status: "success" }])();`),
    );
    expect(r.results[0].title).toBe("undefined,undefined,undefined,undefined");
    const ev = await runScript(input(`(() => [{ title: eval("1"), status: "success" }])();`));
    expect(ev.ok).toBe(false);
  });

  it("throws on GroupCondition, which the runtime doesn't inject", async () => {
    const r = await runScript(input(`(() => { new GroupCondition(); return []; })();`));
    expect(r.error?.message).toMatch(/GroupCondition is not defined/);
  });
});

describe("record, user and env", () => {
  it("reads typed values, case-insensitively, and treats __c fields as hidden unless noNs", async () => {
    const code = `(() => [
      { title: record.stringValue("status") + "|" + record.numValue("Amount") + "|" + record.boolValue("Done") + "|" + user.stringValue("Username"), status: "success" },
      { title: String(record.stringValue("Custom__c")) + "|" + record.noNs_stringValue("Custom__c"), status: "success" },
    ])();`;
    const r = await runScript(input(code));
    expect(r.results.map((x) => x.title)).toEqual(["Open|12.5|true|rep@example.com", "undefined|x"]);
  });

  it("throws on inaccessible fields after enableAccessErrors", async () => {
    const r = await runScript(input(`(() => { enableAccessErrors(); record.stringValue("Nope"); return []; })();`));
    expect(r.error?.message).toMatch(/Nope/);
  });

  it("records setValue and save without writing", async () => {
    const r = await runScript(input(`(() => { record.setValue("Status", "Closed"); record.save(); return [{ title: record.stringValue("Status"), status: "success" }]; })();`));
    expect(r.results[0].title).toBe("Closed");
    expect(r.recorded).toEqual([
      { target: "Inquiry:a01", action: "setValue", field: "Status", value: "Closed" },
      { target: "Inquiry:a01", action: "save" },
    ]);
    expect(r.notes.join(" ")).toMatch(/recorded, not applied/);
  });

  it("serves env options and formatCustomLabel", async () => {
    const r = await runScript(
      input(`(() => [{ title: env.getOption("actionName") + ":" + env.formatCustomLabel("k", "Hi {0} and %@", ["A"]), status: "success" }])();`, {
        env: { actionName: "Submit" },
      }),
    );
    expect(r.results[0].title).toBe("Submit:Hi A and A");
    expect(r.notes.join(" ")).toMatch(/translations aren't looked up/);
  });

  it("captures env.log and console output with timestamps", async () => {
    const r = await runScript(input(`(() => { env.log("hello"); console.warn("careful", { a: 1 }); console.error("bad"); return []; })();`));
    expect(r.logs.map((l) => [l.level, l.text])).toEqual([
      ["log", "hello"],
      ["warn", 'careful {"a":1}'],
      ["error", "bad"],
    ]);
    expect(r.logs[0].at).toBeGreaterThanOrEqual(0);
  });

  it("keeps only the last pass's logs when queries make it replay", async () => {
    const r = await runScript(input(`(async () => { env.log("once"); await db.query("Account", ""); return []; })();`));
    expect(r.logs).toHaveLength(1);
    expect(r.queries).toHaveLength(1);
  });

  it("always says it is a simulation run as the admin", async () => {
    const r = await runScript(input(`(() => [])();`));
    expect(r.notes[0]).toMatch(/simulation, run as the connected admin, not as the rep/);
  });
});

describe("conditions and db", () => {
  const run = (code: string, over: Partial<RunInput> = {}) => runScript(input(code, over));

  it("builds field, set, and/or and date conditions", async () => {
    const code = `(async () => {
      const and = new AndCondition();
      and.add(new FieldCondition("Name", "=", "O'Brien"));
      const or = new OrCondition();
      or.add(new SetCondition("Id", "IN", ["a", "b"]));
      or.add(new DateFieldCondition("CreatedDate", ">", new Date("2026-01-02T03:04:05Z")));
      and.add(or);
      await db.query("Account", await new ConditionBuilder("Account", and).build());
      return [];
    })();`;
    const reader = fakeReader({ Account: [{ Id: "001", Name: "Acme", CreatedDate: "x" }] });
    const r = await run(code, { reader });
    expect(r.error).toBeUndefined();
    expect(r.queries[0].soql).toContain(
      `WHERE (Name = 'O\\'Brien') AND ((Id IN ('a','b')) OR (CreatedDate > 2026-01-02))`,
    );
    expect(r.queries[0].soql).toMatch(/LIMIT 501$/);
  });

  it("fails ConditionBuilder.build() when a field isn't on the object", async () => {
    const code = `(async () => { await new ConditionBuilder("Account", new FieldCondition("Missing", "=", "x")).build(); return []; })();`;
    const r = await run(code);
    expect(r.error?.message).toMatch(/Field Missing isn't accessible on Account/);
  });

  it("uses selectedFields on web and ignores them on iPad", async () => {
    const code = `(async () => { await db.query("Account", "", ["Name"]); return []; })();`;
    const reader = () => fakeReader({ Account: [{ Id: "001", Name: "Acme", Phone: "1" }] });
    const web = await run(code, { reader: reader() });
    expect(web.queries[0].soql).toMatch(/^SELECT Id, Name FROM Account/);
    const ipad = await run(code, { reader: reader(), platform: "ipad" });
    expect(ipad.queries[0].soql).toMatch(/^SELECT Id, Name, Phone FROM Account/);
  });

  it("prefixes the namespace on iPad only, and never for the _noNs variants", async () => {
    const code = `(async () => {
      await db.query("Foo__c", "Bar__c = 1");
      await db.noNs_query("Foo__c", "Bar__c = 1");
      return [];
    })();`;
    const data = { lsc4ce__Foo__c: [{ Id: "a" }], Foo__c: [{ Id: "b" }] };
    const ipad = await run(code, { platform: "ipad", nsPrefix: "lsc4ce__", reader: fakeReader(data) });
    expect(ipad.queries.map((q) => q.soql.match(/FROM (\S+)/)![1])).toEqual(["lsc4ce__Foo__c", "Foo__c"]);
    const web = await run(code, { platform: "web", nsPrefix: "lsc4ce__", reader: fakeReader(data) });
    // Identical queries are read once.
    expect(web.queries.map((q) => q.soql.match(/FROM (\S+)/)![1])).toEqual(["Foo__c"]);
  });

  it("shapes rows by platform: sObject on web, opaque on iPad", async () => {
    const code = `(async () => {
      const rows = await db.query("Account", "");
      const r = rows[0];
      return [{ title: [Object.keys(r).sort().join(","), typeof r.sObject, r.stringValue("name"), r.boolValue("IsPersonAccount")].join("|"), status: "success" }];
    })();`;
    const web = await run(code, { reader: fakeReader({ Account: [{ Id: "001", Name: "Acme", IsPersonAccount: false }] }) });
    expect(web.results[0].title).toBe("accessibleFields,namespaceUtils,sObject,sObjectName|object|Acme|false");
    const ipad = await run(code.replace("async () =>", "() =>").replace("await ", ""), {
      platform: "ipad",
      reader: fakeReader({ Account: [{ Id: "001", Name: "Acme", IsPersonAccount: false }] }),
    });
    expect(ipad.results[0].title).toBe("|undefined|Acme|false");
  });

  it("removes async and await on iPad so db calls are synchronous", async () => {
    const code = `(async () => {
      const rows = await db.query("Account", "");
      return [{ title: String(rows.length), status: "success" }];
    })();`;
    const r = await run(code, { platform: "ipad", reader: fakeReader({ Account: [{ Id: "1" }, { Id: "2" }] }) });
    expect(r).toMatchObject({ ok: true, results: [{ title: "2", status: "success" }] });
  });

  it("keeps line numbers when async is stripped on iPad", async () => {
    const r = await run(`(async () => {\n  const a = await db.query("Account", "");\n  null.x;\n})();`, {
      platform: "ipad",
      reader: fakeReader({ Account: [{ Id: "1" }] }),
    });
    expect(r.error?.line).toBe(3);
  });

  it("rowById and rowsByEntity and bulkQuery", async () => {
    const code = `(async () => {
      const one = await db.rowById("Account", "001");
      const all = await db.rowsByEntity("Account");
      const bulk = await db.bulkQuery([{ uniqueRequestKey: "k", sObjectName: "Account", condition: "Id = '001'", selectedFields: ["Name"] }]);
      return [{ title: [one.stringValue("Name"), all.length, bulk.k.length].join("|"), status: "success" }];
    })();`;
    const r = await run(code, { reader: fakeReader({ Account: [{ Id: "001", Name: "Acme" }] }) });
    expect(r.error).toBeUndefined();
    expect(r.results[0].title).toBe("Acme|1|1");
    expect(r.queries).toHaveLength(3);
  });

  it("logs a failing query and lets the script catch it", async () => {
    const code = `(async () => {
      try { await db.query("Nope", ""); } catch (e) { return [{ title: "caught: " + e.message, status: "warning" }]; }
      return [];
    })();`;
    const r = await run(code);
    expect(r.results[0].title).toMatch(/^caught:/);
    expect(r.queries[0].error).toMatch(/Nope/);
  });

  it("caps rows per query and says so", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ Id: `id${i}` }));
    const code = `(async () => { const r = await db.query("Account", ""); return [{ title: String(r.length), status: "success" }]; })();`;
    const r = await run(code, { reader: fakeReader({ Account: rows }) });
    expect(r.results[0].title).toBe("500");
    expect(r.notes.join(" ")).toMatch(/more than 500 rows/);
  });

  it("limits the number of different queries in a run", async () => {
    const code = `(async () => {
      let failed = 0;
      for (let i = 0; i < 45; i++) { try { await db.query("Account", "Name = 'n" + i + "'"); } catch (e) { failed++; } }
      return [{ title: String(failed), status: "success" }];
    })();`;
    const r = await run(code);
    expect(r.results[0].title).toBe("5");
    expect(r.queries.filter((q) => q.error)).toHaveLength(5);
  });

  it("is read-only: only SELECTs reach the org", async () => {
    const reader = fakeReader({ Account: [{ Id: "1" }] });
    await run(`(async () => { await db.query("Account", ""); record.setValue("Name", "x"); record.save(); return []; })();`, { reader });
    expect(reader.soql.every((q) => /^SELECT /.test(q))).toBe(true);
  });
});

describe("context data", () => {
  const ctx = { ProviderVisit: { Id: "pv1", AccountId: "001" }, "ProductDisbursement.VisitId": [{ Id: "s1" }] };
  const code = `(() => {
    const c = record.getContextData();
    return [{ title: Object.keys(c).join(",") + "|" + c["ProductDisbursement.VisitId"].length + "|" + typeof c.ProviderVisit.AccountId, status: "success" }];
  })();`;
  it("hands VAV scripts the context data", async () => {
    const r = await runScript(input(code, { type: "VisitActionValidation", contextData: ctx }));
    expect(r.results[0].title).toBe("ProviderVisit,ProductDisbursement.VisitId|1|string");
    expect(r.contract.join(" ")).not.toMatch(/proxies/);
  });
  it("has no getContextData outside VAV", async () => {
    const r = await runScript(input(`(() => [{ title: typeof record.getContextData, status: "success" }])();`));
    expect(r.results[0].title).toBe("undefined");
  });
});

describe("web runs once with real async", () => {
  it("runs the script one time, with each query awaited", async () => {
    const r = await runScript(
      input(`(async () => {
        env.log("start");
        var a = await db.query("Account");
        var b = await db.query("Account", "Name = 'Acme'");
        return [{ title: a.length + "/" + b.length, status: "success" }];
      })();`),
    );
    expect(r.error).toBeUndefined();
    expect(r.logs.filter((l) => l.text === "start")).toHaveLength(1);
    expect(r.queries).toHaveLength(2);
  });

  it("doesn't freeze the clock or randomness on web", async () => {
    const r = await runScript(
      input(`(async () => { await db.query("Account"); return [{ title: "t", status: Math.random() === Math.random() ? "error" : "success" }]; })();`),
    );
    expect(r.results[0].status).toBe("success");
  });

  it("stops a runaway script on the CPU limit even after awaiting", async () => {
    const r = await runScript(input(`(async () => { await db.query("Account"); while (true) {} })();`));
    expect(r.error?.message).toMatch(/CPU limit/);
  });
});
