import { describe, it, expect } from "vitest";
import {
  ASSIST_TOOLS,
  MAX_ASSIST_ROUNDS,
  buildAssistSystemPrompt,
  extractSections,
  guardSoql,
  loadAssistKnowledge,
  prepareToolCall,
  runScriptAssist,
  type ScriptAssistRequest,
} from "../../src-electron/engine/script-assist.js";
import type { LLMProvider, Message, StreamChunk } from "../../src-electron/llm/provider.js";

const request: ScriptAssistRequest = {
  messages: [{ role: "user", content: "Block Submit when there are no samples" }],
  script: { name: "Visit checks", type: "VisitActionValidation", objectName: "ProviderVisit", operationEventType: "OnUpdate", code: "(() => { return []; })();" },
  diagnostics: [{ id: "no-unwrap", severity: "error", message: "Results are not unwrapped." }],
  lastTest: { ok: false, error: { message: "boom", line: 3 } },
};

function fake(script: Message[]): LLMProvider & { calls: { tools: number; signal?: AbortSignal; messages: number }[] } {
  const calls: { tools: number; signal?: AbortSignal; messages: number }[] = [];
  return {
    id: "fake",
    name: "fake",
    calls,
    async validateCredentials() {
      return true;
    },
    async chat(_s, messages, tools, config, onChunk?: (c: StreamChunk) => void) {
      calls.push({ tools: tools.length, signal: config?.signal, messages: messages.length });
      const next = script.shift()!;
      if (typeof next.content !== "string") {
        for (const b of next.content) if (b.type === "text") onChunk?.({ type: "text_delta", text: b.text });
      }
      return next;
    },
  };
}

const text = (t: string): Message => ({ role: "assistant", content: [{ type: "text", text: t }] });
const toolUse = (name: string, input: Record<string, unknown>, id = "t1"): Message => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name, input }],
});
const host = (calls: unknown[] = []) => ({
  callTool: async (name: string, args: Record<string, unknown>) => (calls.push([name, args]), { text: "x", isError: false }),
});

describe("guardSoql", () => {
  it("allows a SELECT and adds a LIMIT", () => {
    expect(guardSoql("SELECT Id FROM Account")).toEqual({ ok: true, query: "SELECT Id FROM Account LIMIT 50" });
    expect(guardSoql("select Id from Account limit 10;")).toEqual({ ok: true, query: "select Id from Account limit 10" });
  });
  it("refuses writes, big limits and several statements", () => {
    expect(guardSoql("DELETE FROM Account").ok).toBe(false);
    expect(guardSoql("SELECT Id FROM Account LIMIT 51").ok).toBe(false);
    expect(guardSoql("SELECT Id FROM Account; SELECT Id FROM User").ok).toBe(false);
    expect(guardSoql("SELECT Id FROM Account FOR UPDATE").ok).toBe(false);
    expect(guardSoql("SELECT Id FROM Account LIMIT :n").ok).toBe(false);
    expect(guardSoql(undefined).ok).toBe(false);
  });
});

describe("prepareToolCall", () => {
  it("only offers read-only tools", () => {
    expect(ASSIST_TOOLS.map((t) => t.name)).toEqual(["describe_sobject", "run_soql"]);
    expect(prepareToolCall("delete_record", {}).ok).toBe(false);
    expect(prepareToolCall("describe_sobject", { objectName: "Account; drop" }).ok).toBe(false);
    expect(prepareToolCall("describe_sobject", { objectName: "ProviderVisit" })).toEqual({ ok: true, args: { objectName: "ProviderVisit" } });
  });
});

describe("prompt", () => {
  it("extracts sections by heading", () => {
    expect(extractSections("# t\n## A one\nx\n## B two\ny\n## A three\nz", ["A"])).toBe("## A one\nx\n## A three\nz");
  });
  it("loads the reference and skill", () => {
    const k = loadAssistKnowledge();
    expect(k).toContain("Output");
    expect(k).toContain("unwrapProxy");
  });
  it("includes the script, problems and last test", () => {
    const p = buildAssistSystemPrompt(request, "KNOWLEDGE");
    expect(p).toContain("KNOWLEDGE");
    expect(p).toContain("Visit action validation");
    expect(p).toContain("Name: Visit checks");
    expect(p).toContain("(() => { return []; })();");
    expect(p).toContain("no-unwrap");
    expect(p).toContain("Error: boom (line 3)");
    expect(p).toContain("Nothing before it");
  });
});

describe("runScriptAssist", () => {
  it("returns the streamed answer", async () => {
    const llm = fake([text("Done.\n```javascript\n(() => [])();\n```")]);
    const deltas: string[] = [];
    const out = await runScriptAssist(llm, host(), request, { onDelta: (d) => deltas.push(d) });
    expect(out).toContain("(() => [])();");
    expect(deltas.join("")).toBe(out);
  });

  it("runs lookups through the host and feeds results back", async () => {
    const llm = fake([toolUse("describe_sobject", { objectName: "ProviderVisit" }), text("ok")]);
    const seen: unknown[] = [];
    const tools: string[] = [];
    const out = await runScriptAssist(llm, host(seen), request, { onTool: (n, s) => tools.push(`${n}:${s}`) });
    expect(out).toBe("ok");
    expect(seen).toEqual([["describe_sobject", { objectName: "ProviderVisit" }]]);
    expect(tools).toEqual(["describe_sobject:running", "describe_sobject:done"]);
    expect(llm.calls[1].messages).toBe(3);
  });

  it("refuses a write query without calling the org", async () => {
    const llm = fake([toolUse("run_soql", { query: "DELETE FROM Account" }), text("fine")]);
    const seen: unknown[] = [];
    await runScriptAssist(llm, host(seen), request);
    expect(seen).toEqual([]);
  });

  it("stops looking things up after the round limit", async () => {
    const script: Message[] = Array.from({ length: MAX_ASSIST_ROUNDS }, (_, i) => toolUse("run_soql", { query: "SELECT Id FROM Account" }, `t${i}`));
    script.push(text("final"));
    const llm = fake(script);
    const out = await runScriptAssist(llm, host(), request);
    expect(out).toBe("final");
    expect(llm.calls[llm.calls.length - 1].tools).toBe(0);
  });

  it("passes the signal and throws aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(runScriptAssist(fake([text("x")]), host(), request, { signal: ctl.signal })).rejects.toThrow("aborted");
  });
});
