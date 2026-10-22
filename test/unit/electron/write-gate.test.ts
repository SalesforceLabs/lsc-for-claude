import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ApprovalBroker, createWriteGate, describeWrite, isWrite, READ_TOOLS, WRITE_TOOLS, DECLINED_TEXT } from "../../../src-electron/engine/write-gate.js";
import { MAPPED_TOOLS } from "../../../src/studio/fix-for-tool.js";

function registeredTools(): string[] {
  const dir = path.resolve(__dirname, "../../../src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith(".ts")) files.push(path.join(d, e.name));
    }
  };
  walk(dir);
  const names = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/\.tool\(\s*"([a-z_0-9]+)"/g)) names.add(m[1]);
  return [...names];
}

describe("write tool classification", () => {
  it("classifies every registered non-Studio tool as read or write", () => {
    const unclassified = registeredTools().filter((n) => !n.startsWith("studio_") && !READ_TOOLS.has(n) && !WRITE_TOOLS.has(n));
    expect(unclassified).toEqual([]);
  });

  it("has no tool in both lists and none that no longer exists", () => {
    const registered = new Set(registeredTools());
    expect([...READ_TOOLS].filter((n) => WRITE_TOOLS.has(n))).toEqual([]);
    expect([...READ_TOOLS, ...WRITE_TOOLS].filter((n) => !registered.has(n))).toEqual([]);
  });

  it("gates only the writing modes of import_config", () => {
    expect(isWrite("import_config", {})).toBe(false);
    expect(isWrite("import_config", { mode: "report" })).toBe(false);
    expect(isWrite("import_config", { mode: "ui" })).toBe(true);
    expect(isWrite("import_config", { mode: "apply" })).toBe(true);
  });

  it("treats a tool it doesn't know as a write", () => {
    expect(isWrite("brand_new_tool", {})).toBe(true);
    expect(isWrite("run_soql", {})).toBe(false);
  });

  it("only maps tools it classifies as writes", () => {
    for (const n of MAPPED_TOOLS) expect(WRITE_TOOLS.has(n)).toBe(true);
  });

  it("describes calls in a sentence", () => {
    expect(describeWrite("update_record", { objectName: "Account", recordId: "001A", values: { Name: "x", Phone: "1" } })).toBe("Update Account 001A (Name, Phone)");
    expect(describeWrite("run_apex", { code: "a\nb" })).toBe("Run 2 lines of anonymous Apex in the org");
    expect(describeWrite("install_sf_cli", {})).toBe("Install the Salesforce CLI on this computer");
  });
});

const ORG_IDS: Record<string, string> = { "rep@example.com": "00D000000000001AAA", "other": "00D000000000002AAA" };

function setup(opts: { fixes?: unknown; fixesThrow?: boolean; windowUp?: boolean; kind?: "production" | "sandbox" } = {}) {
  const sent: Array<{ channel: string; payload: any }> = [];
  const send = vi.fn((channel: string, payload: unknown) => {
    if (opts.windowUp === false) return false;
    sent.push({ channel, payload });
    return true;
  });
  const broker = new ApprovalBroker(send);
  const host = {
    callTool: vi.fn(async () => {
      if (opts.fixesThrow) throw new Error("down");
      return { content: [{ type: "text", text: JSON.stringify(opts.fixes ?? { unsupported: "no" }) }] };
    }),
  };
  const gate = createWriteGate({
    convId: "c1",
    org: { ref: { username: "Me@Example.com", label: "Me", instanceUrl: "", orgId: "00D000000000001" } as never, kind: opts.kind ?? "sandbox" },
    host: host as never,
    broker,
    send,
    resolveOrgId: async (key) => ORG_IDS[key.toLowerCase()],
  });
  return { gate, broker, sent, host };
}

const call = (name: string, input: Record<string, unknown>, signal = new AbortController().signal) => ({ id: "t1", name, input, signal });

describe("write gate", () => {
  it("lets read tools through without asking the server", async () => {
    const { gate, host } = setup();
    expect(await gate(call("run_soql", { query: "SELECT Id FROM Account" }))).toBeNull();
    expect(host.callTool).not.toHaveBeenCalled();
  });

  it("queues a mappable write in the tray and tells the model nothing was written", async () => {
    const changes = [{ fix: { kind: "setActive", label: "Activate DCR" } }];
    const { gate, sent } = setup({ fixes: { changes } });
    const res = await gate(call("toggle_trigger_handler", { handlerName: "DCR", active: true }));
    expect(res?.isError).toBe(false);
    const body = JSON.parse(res!.text);
    expect(body.status).toBe("queued");
    expect(body.changes).toEqual(["Activate DCR"]);
    expect(body.message).toContain("Nothing has been written yet");
    expect(sent).toEqual([{ channel: "tray:queue", payload: { convId: "c1", toolId: "t1", org: "me@example.com", changes } }]);
  });

  it("answers no-change when the org already matches", async () => {
    const { gate, sent } = setup({ fixes: { changes: [], note: "DCR is already active." } });
    const res = await gate(call("toggle_trigger_handler", { handlerName: "DCR", active: true }));
    expect(JSON.parse(res!.text).status).toBe("no-change");
    expect(sent).toEqual([]);
  });

  it("asks for approval when Studio can't express the write, and runs it on Allow", async () => {
    const { gate, broker, sent } = setup({ kind: "production" });
    const pending = gate(call("create_record", { objectName: "Account", values: { Name: "A" } }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    const req = sent[0].payload;
    expect(sent[0].channel).toBe("chat:approval-request");
    expect(req).toMatchObject({ convId: "c1", toolId: "t1", name: "create_record", summary: "Create a Account record (Name)", production: true });
    expect(broker.respond(req.requestId, true)).toBe(true);
    expect(await pending).toBeNull();
    expect(broker.list()).toEqual([]);
    expect(sent[1]).toEqual({ channel: "chat:approval-settled", payload: { requestId: req.requestId, convId: "c1", toolId: "t1", allowed: true } });
    expect(broker.respond(req.requestId, true)).toBe(false);
  });

  it("tells the model when the user declines", async () => {
    const { gate, broker } = setup({ fixesThrow: true });
    const pending = gate(call("delete_record", { objectName: "Account", recordId: "001" }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    broker.respond(broker.list()[0].requestId, false);
    expect(await pending).toEqual({ text: DECLINED_TEXT, isError: true });
  });

  it("settles a waiting approval as denied when the run is aborted", async () => {
    const { gate, broker, sent } = setup();
    const ctl = new AbortController();
    const pending = gate(call("run_apex", { code: "x" }, ctl.signal));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    ctl.abort();
    expect((await pending)?.isError).toBe(true);
    expect(broker.list()).toEqual([]);
    expect(sent.at(-1)?.channel).toBe("chat:approval-settled");
    expect(sent.at(-1)?.payload.allowed).toBe(false);
  });

  it("refuses a write naming another org, before asking anyone", async () => {
    const { gate, host, sent } = setup();
    const res = await gate(call("create_record", { objectName: "Account", values: {}, targetOrg: "prod-alias" }));
    expect(res?.isError).toBe(true);
    expect(res?.text).toContain("can't change another org");
    expect(host.callTool).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("lets a write name its own org by username or alias", async () => {
    const { gate, broker } = setup({ fixes: { changes: [], note: "Already." } });
    expect(JSON.parse((await gate(call("toggle_db_schema", { name: "X", active: true, targetOrg: "me@example.com" })))!.text).status).toBe("no-change");
    expect(JSON.parse((await gate(call("toggle_db_schema", { name: "X", active: true, targetOrg: "Me" })))!.text).status).toBe("no-change");
    expect(broker.list()).toEqual([]);
  });

  it("lets a read use another login on the session's org without asking", async () => {
    const { gate, broker } = setup();
    expect(await gate(call("profile_sync_volume", { users: ["rep@example.com"], countAsOrg: "rep@example.com" }))).toBeNull();
    expect(await gate(call("simulate_initial_sync", { username: "rep@example.com" }))).toBeNull();
    expect(await gate(call("run_soql", { query: "SELECT Id FROM Account", targetOrg: "me" }))).toBeNull();
    expect(broker.list()).toEqual([]);
  });

  it("asks before a read reaches another org, and runs it on Allow", async () => {
    const { gate, broker } = setup({ kind: "production" });
    const pending = gate(call("diff_orgs", { sourceOrg: "me", targetOrg: "other" }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    const [req] = broker.list();
    expect(req.summary).toBe("Run diff_orgs and read from another org, other");
    expect(req.production).toBe(false);
    broker.respond(req.requestId, true);
    expect(await pending).toBeNull();
  });

  it("treats an alias sf CLI doesn't know as another org", async () => {
    const { gate, broker } = setup();
    const pending = gate(call("run_soql", { query: "SELECT Id FROM User", targetOrg: "unknown-alias" }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    broker.respond(broker.list()[0].requestId, false);
    expect(await pending).toEqual({ text: DECLINED_TEXT, isError: true });
  });

  it("asks before a perf tool saves a file", async () => {
    const { gate, broker } = setup();
    const pending = gate(call("run_perf_assessment", { profileYaml: "x", outputPath: "/tmp/out.json" }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    expect(broker.list()[0].summary).toBe("Run run_perf_assessment and save its result to /tmp/out.json on this computer");
    broker.respond(broker.list()[0].requestId, true);
    expect(await pending).toBeNull();
    expect(await gate(call("run_perf_assessment", { profileYaml: "x" }))).toBeNull();
  });

  it("asks about a write that reads another org as a whole, without queueing it", async () => {
    const { gate, broker, host } = setup();
    const pending = gate(call("import_config", { mode: "apply", sourceOrg: "other" }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    expect(broker.list()[0].summary).toBe("Apply selected configuration from a snapshot to the org, reading other");
    expect(host.callTool).not.toHaveBeenCalled();
    broker.respond(broker.list()[0].requestId, false);
    expect((await pending)?.isError).toBe(true);
  });

  it("denies when the window is gone", async () => {
    const { gate, broker } = setup({ windowUp: false });
    expect(await gate(call("run_apex", { code: "x" }))).toEqual({ text: DECLINED_TEXT, isError: true });
    expect(broker.list()).toEqual([]);
  });
});
