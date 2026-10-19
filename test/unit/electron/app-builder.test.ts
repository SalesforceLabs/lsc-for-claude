import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { AppBuilder, followWrite, parseAppPath, pickBuilderModel, nameFromLabel, renameBundle, strongestModel, uniqueName } from "../../../src-electron/engine/app-builder.js";
import { memoryAppStore, INTERRUPTED_MESSAGE } from "../../../src-electron/engine/app-store.js";
import type { LLMProvider, Message, StreamChunk } from "../../../src-electron/llm/provider.js";
import type { AppBuilderEvent, AppCheckResult, AppProject } from "../../../src-electron/engine/app-types.js";

type Step = { text?: string; tools?: Array<{ name: string; input: Record<string, unknown> }>; throws?: string; hang?: boolean };

function fakeLlm(script: Step[]) {
  let i = 0;
  const seen: Message[][] = [];
  const llm: LLMProvider = {
    id: "fake",
    name: "fake",
    validateCredentials: async () => true,
    async chat(_s, messages, _t, _c, onChunk?: (c: StreamChunk) => void) {
      seen.push(structuredClone(messages));
      const step = script[i++];
      if (!step) throw new Error("script exhausted " + JSON.stringify(messages.map((m) => typeof m.content === "string" ? m.content.slice(0,50) : m.content.map((b) => b.type + ":" + (b.content ?? b.name ?? "").toString().slice(0,100)))));
      if (step.throws) throw new Error(step.throws);
      if (step.hang) return new Promise<Message>(() => {});
      const content: Message["content"] = [];
      if (step.text) {
        onChunk?.({ type: "text_delta", text: step.text });
        content.push({ type: "text", text: step.text });
      }
      for (const [n, t] of (step.tools ?? []).entries()) {
        const id = `t${i}_${n}`;
        onChunk?.({ type: "tool_use_start", id, name: t.name });
        const json = JSON.stringify(t.input);
        onChunk?.({ type: "tool_use_delta", input_json: json.slice(0, 40) });
        onChunk?.({ type: "tool_use_delta", input_json: json.slice(40) });
        onChunk?.({ type: "tool_use_end", id });
        content.push({ type: "tool_use", id, name: t.name, input: t.input });
      }
      return { role: "assistant", content };
    },
  };
  return { llm, seen, calls: () => i };
}

const okCheck: AppCheckResult = { ok: true, issues: [], offline: {}, script: "(function(){})()", placeholders: [] };
const badCheck: AppCheckResult = {
  ok: false,
  issues: [{ severity: "error", rule: "meta.missing-urladdressable", message: "Missing target", path: "lwc/lscMobileInline_Todo/lscMobileInline_Todo.js-meta.xml", fix: "Add lightning__UrlAddressable" }],
  offline: {},
  placeholders: [],
};

function setup(script: Step[], checks: AppCheckResult | AppCheckResult[] | ((n: number) => AppCheckResult), opts: { apps?: string[]; mobileLogin?: (id: string) => Promise<Record<string, unknown>>; starter?: unknown } = {}) {
  const store = memoryAppStore();
  const events: Array<{ projectId: string; event: AppBuilderEvent }> = [];
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let checkN = 0;
  const { llm, seen, calls } = fakeLlm(script);
  const builder = new AppBuilder({
    llm: () => llm,
    model: () => "claude-opus-5-5",
    mobileLogin: opts.mobileLogin,
    store,
    emit: (projectId, event) => events.push({ projectId, event }),
    call: async (tool, args) => {
      toolCalls.push({ tool, args });
      switch (tool) {
        case "studio_app_guide":
          return { guide: "GUIDE" };
        case "studio_app_list":
          return { apps: (opts.apps ?? []).map((name) => ({ name, label: name, target: "home" })) };
        case "studio_app_describe":
          return { objects: [{ name: "RecommendedAction", label: "RA", exists: true, synced: true, fields: [{ name: "Name", label: "Name", type: "string" }] }] };
        case "studio_app_sample":
          return { records: [{ Name: "a" }, { Name: "b" }], totalSize: 2 };
        case "studio_app_starter_source":
          if (!opts.starter) throw new Error("There's no starter app named " + String(args.id));
          return structuredClone(opts.starter);
        case "studio_app_check": {
          const n = checkN++;
          return typeof checks === "function" ? checks(n) : Array.isArray(checks) ? checks[Math.min(n, checks.length - 1)] : checks;
        }
        default:
          throw new Error(`unexpected ${tool}`);
      }
    },
  });
  return { builder, store, events, toolCalls, seen, calls };
}

const P = "lwc/lscMobileInline_TodoList/lscMobileInline_TodoList";
const write = (label: string = "Todo", bundle = "lscMobileInline_Draft") => ({
  name: "write_app",
  input: { ...(label ? { label } : {}), files: ["js", "html", "js-meta.xml"].map((ext) => ({ path: `lwc/${bundle}/${bundle}.${ext}`, source: ext === "js" ? "js" : "<x/>" })) },
});

async function finished(builder: AppBuilder, id: string): Promise<AppProject> {
  for (let i = 0; i < 400; i++) {
    if (!builder.isRunning(id)) return builder.get(id)!;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("turn never finished");
}

describe("helpers", () => {
  it("validates paths strictly", () => {
    expect(parseAppPath("lwc/lscMobileInline_X/lscMobileInline_X.js-meta.xml")).toEqual({ bundle: "lscMobileInline_X", file: "lscMobileInline_X.js-meta.xml" });
    for (const bad of ["lwc/../x/y.js", "lwc/a/../y.js", "/lwc/a/b.js", "lwc/a/b/c.js", "aura/a/b.js", "lwc/a/", "lwc//b.js", "lwc/a b/c.js", "lwc/a/b..js", 5]) {
      expect(parseAppPath(bad as string)).toBeNull();
    }
  });
  it("names apps and keeps them unique", () => {
    expect(nameFromLabel("Next best actions")).toBe("lscMobileInline_NextBestActions");
    expect(nameFromLabel("3 things to do")).toBe("lscMobileInline_ThingsToDo");
    expect(nameFromLabel("This week's visits")).toBe("lscMobileInline_ThisWeeksVisits");
    expect(nameFromLabel("!!!")).toBe("lscMobileInline_App");
    expect(nameFromLabel("a".repeat(60)).length).toBe("lscMobileInline_".length + 40);
    expect(uniqueName("lscMobileInline_A", ["LSCMOBILEINLINE_A", "lscMobileInline_A2"])).toBe("lscMobileInline_A3");
  });
  it("picks the strongest listed model unless the connection names one", () => {
    const ids = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-4-1-20250805", "claude-haiku-5-5", "gpt-4o"];
    expect(strongestModel(ids)).toBe("claude-opus-5-5");
    expect(strongestModel(["claude-fable-5-1", ...ids])).toBe("claude-fable-5-1");
    expect(strongestModel(["gpt-4o"])).toBeUndefined();
    expect(pickBuilderModel("my-model", ids)).toBe("my-model");
    expect(pickBuilderModel(undefined, ids)).toBe("claude-opus-5-5");
  });
  it("follows a partial write_app stream", () => {
    expect(followWrite('{"files":[{"path":"lwc/a/a.js","source":"abc').path).toBe("lwc/a/a.js");
    expect(followWrite('{"files":[{"path":"lwc/a/a.js","source":"x"},{"path":"lwc/a/a.html","sou')).toEqual({ path: "lwc/a/a.html", chars: 72 });
  });
  it("keeps the renderer's and main process's contract types equal", () => {
    const strip = (s: string) => s.split("\n").filter((l) => !l.startsWith("//")).join("\n");
    const a = readFileSync("src-electron/engine/app-types.ts", "utf8");
    const b = readFileSync("src-renderer/components/studio/builder/types.ts", "utf8");
    expect(strip(a)).toBe(strip(b));
  });
});

describe("AppBuilder turn", () => {
  it("describe -> write (error) -> write (fixed) -> finish", async () => {
    const { builder, store, events, toolCalls, seen } = setup(
      [
        { text: "Looking.", tools: [{ name: "describe_objects", input: { objects: ["RecommendedAction"] } }, { name: "sample_records", input: { soql: "SELECT Name FROM RecommendedAction" } }] },
        { tools: [write("Todo list")] },
        { tools: [write("", "lscMobileInline_TodoList")] },
        { tools: [{ name: "finish", input: { summary: "A to-do list of actions." } }] },
      ],
      (n) => (n === 0 ? badCheck : okCheck)
    );
    const { project } = await builder.create("Org@X.com", { prompt: "todo", target: "home" });
    expect(project!.org).toBe("org@x.com");
    expect(project!.name).toBe("lscMobileInline_Draft");
    expect(project!.label).toBe("New app");
    const done = await finished(builder, project!.id);
    expect(done.name).toBe("lscMobileInline_TodoList");
    expect(done.label).toBe("Todo list");
    const turn = done.turns[0];
    expect(turn.error).toBeUndefined();
    expect(turn.status).toBe("done");
    expect(done.versions).toHaveLength(2);
    expect(done.versions[0].check.ok).toBe(false);
    expect(done.versions[1].check.ok).toBe(true);
    expect("script" in done.versions[1].check).toBe(false);
    expect(done.currentVersionId).toBe(done.versions[1].id);
    expect(turn.versionId).toBe(done.versions[1].id);
    expect(turn.reply).toContain("A to-do list of actions.");
    expect(done.label).toBe("Todo list");
    expect(turn.steps.map((s) => [s.kind, s.status])).toEqual([
      ["describe", "done"],
      ["sample", "done"],
      ["write", "done"],
      ["check", "failed"],
      ["repair", "done"],
      ["check", "done"],
    ]);
    expect(turn.steps[0].label).toBe("Reading RecommendedAction fields");
    expect(turn.steps[1].label).toBe("Looking at 2 sample records of RecommendedAction");
    expect(turn.steps[2].label).toBe("Writing the app (3 files)");
    expect(turn.steps[4].label).toBe("Fixing 1 problem (3 files)");

    // The model hears the problem and its fix, not the script
    const second = JSON.stringify(seen[2]);
    expect(second).toContain("meta.missing-urladdressable");
    expect(second).toContain("Add lightning__UrlAddressable");
    expect(second).not.toContain("function(){}");
    // check is called with the merged files and the project name
    const check = toolCalls.filter((c) => c.tool === "studio_app_check")[0].args as { name: string; target: string; files: unknown[] };
    expect(check.name).toBe("lscMobileInline_TodoList");
    expect(check.files).toHaveLength(3);

    const types = events.map((e) => e.event.type);
    expect(types[0]).toBe("turn");
    expect(types.filter((t) => t === "version")).toHaveLength(2);
    expect(types).toContain("reply-delta");
    expect(types).toContain("writing");
    expect(types[types.length - 1]).toBe("turn");
    expect((events[events.length - 1].event as { turn: { status: string } }).turn.status).toBe("done");
    // persisted
    expect(store.get(project!.id)!.versions).toHaveLength(2);
  });

  it("treats a model that stops after a compiling write as done", async () => {
    const { builder } = setup([{ tools: [write()] }, { text: "All set." }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    expect(done.turns[0].error).toBeUndefined();
    expect(done.turns[0].status).toBe("done");
    expect(done.turns[0].versionId).toBeDefined();
  });

  it("gives up after 4 failing writes and keeps the last good version", async () => {
    const { builder, calls } = setup(
      [{ tools: [write()] }, { tools: [write()] }, { tools: [write()] }, { tools: [write()] }, { tools: [write()] }, { tools: [write()] }],
      (n) => (n === 0 ? okCheck : badCheck)
    );
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    // 1 good write, then 4 failing writes: stops
    expect(calls()).toBe(5);
    expect(done.turns[0].status).toBe("failed");
    expect(done.turns[0].error).toMatch(/after 4 tries/);
    expect(done.turns[0].versionId).toBe(done.versions[0].id);
    expect(done.currentVersionId).toBe(done.versions[0].id);
  });

  it("rejects bad paths without recording a version and counts them as failures", async () => {
    const bad = { name: "write_app", input: { files: [{ path: "lwc/../../etc/passwd", source: "x" }] } };
    const { builder, toolCalls } = setup([{ tools: [bad] }, { tools: [bad] }, { tools: [bad] }, { tools: [bad] }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    expect(done.versions).toHaveLength(0);
    expect(toolCalls.some((c) => c.tool === "studio_app_check")).toBe(false);
    expect(done.turns[0].status).toBe("failed");
  });

  it("refuses a second lscMobileInline_ bundle", async () => {
    const other = { name: "write_app", input: { label: "Todo", files: [{ path: "lwc/lscMobileInline_Other/lscMobileInline_Other.js", source: "x" }] } };
    const { builder, seen } = setup([{ tools: [other] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    await finished(builder, project!.id);
    expect(JSON.stringify(seen[1])).toContain("isn't allowed");
  });

  it("asks for a label on the first write", async () => {
    const { builder, seen } = setup([{ tools: [write("")] }, { tools: [write("Next best actions")] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    expect(JSON.stringify(seen[1])).toContain("give the app a short");
    expect(done.name).toBe("lscMobileInline_NextBestActions");
    expect(done.label).toBe("Next best actions");
  });

  it("stops on abort", async () => {
    const { builder } = setup([{ hang: true }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    await new Promise((r) => setTimeout(r, 20));
    builder.stop(project!.id);
    const done = await finished(builder, project!.id);
    expect(done.turns[0].status).toBe("stopped");
  });

  it("surfaces provider errors as a failed turn", async () => {
    const { builder } = setup([{ throws: "Anthropic rejected the credentials (HTTP 401)." }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    expect(done.turns[0].status).toBe("failed");
    expect(done.turns[0].error).toContain("rejected the credentials");
  });

  it("a follow-up edits the existing files and avoids names already in the org", async () => {
    const { builder, seen } = setup(
      [{ tools: [write("Todo")] }, { text: "done" }, { tools: [write("", "lscMobileInline_Todo2")] }, { text: "done" }],
      okCheck,
      { apps: ["lscMobileInline_Todo"] }
    );
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    expect(project!.name).toBe("lscMobileInline_Draft");
    await finished(builder, project!.id);
    expect(builder.get(project!.id)!.name).toBe("lscMobileInline_Todo2");
    expect(builder.send(project!.id, "make it denser").ok).toBe(true);
    expect(builder.send(project!.id, "again").ok).toBe(false); // still running
    const done = await finished(builder, project!.id);
    expect(done.turns).toHaveLength(2);
    expect(done.versions).toHaveLength(2);
    const ctx = JSON.stringify(seen[2][0]);
    expect(ctx).toContain("<current_files>");
    expect(ctx).toContain("make it denser");
    expect(ctx).toContain("earlier_requests");
  });

  it("restores a version, edits a file, and deletes", async () => {
    const { builder, store } = setup([{ tools: [write("Todo list")] }, { text: "done" }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    const v1 = done.versions[0];
    const edited = await builder.editFile(done.id, `${P}.js`, "new js");
    expect(edited.version!.files.find((f) => f.path === `${P}.js`)!.source).toBe("new js");
    expect(edited.version!.source).toBe("manual");
    expect(builder.get(done.id)!.currentVersionId).toBe(edited.version!.id);
    expect((await builder.editFile(done.id, "lwc/../x/y.js", "z")).error).toBeDefined();
    const restored = builder.restore(done.id, v1.id);
    expect(restored.version!.files.find((f) => f.path === `${P}.js`)!.source).toBe("js");
    expect(store.get(done.id)!.versions).toHaveLength(3);
    builder.rename(done.id, "New label");
    expect(store.get(done.id)!.label).toBe("New label");
    builder.delete(done.id);
    expect(store.get(done.id)).toBeNull();
    expect(builder.list("o")).toHaveLength(0);
  });

  it("previews with the compiled script, cached by version", async () => {
    const { builder, toolCalls } = setup([{ tools: [write()] }, { text: "done" }], okCheck);
    const { project } = await builder.create("o", { prompt: "todo", target: "home" });
    const done = await finished(builder, project!.id);
    const before = toolCalls.filter((c) => c.tool === "studio_app_check").length;
    const p = await builder.preview(done.id);
    expect(p.script).toBe("(function(){})()");
    expect(toolCalls.filter((c) => c.tool === "studio_app_check").length).toBe(before);
  });
});

describe("prompt caching", () => {
  it("marks the system prompt, last tool and last message block", async () => {
    const { addCacheBreakpoints } = await import("../../../src-electron/llm/anthropic.js");
    const body: Record<string, unknown> = {
      system: "sys",
      tools: [{ name: "a" }, { name: "b" }],
      messages: [{ role: "user", content: "hi" }, { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "x" }] }],
    };
    addCacheBreakpoints(body);
    const eph = { type: "ephemeral" };
    expect(body.system).toEqual([{ type: "text", text: "sys", cache_control: eph }]);
    expect((body.tools as any[])[0].cache_control).toBeUndefined();
    expect((body.tools as any[])[1].cache_control).toEqual(eph);
    expect((body.messages as any[])[1].content[0].cache_control).toEqual(eph);
    expect((body.messages as any[])[0].content).toBe("hi");
  });
});

describe("targets, run as, recovery", () => {
  it("names the project from the first write and keeps the quick action name equal to the bundle", async () => {
    const { builder } = setup([{ tools: [write("HCP snapshot")] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "x", target: "record", objectApiName: "Account" });
    const done = await finished(builder, project!.id);
    expect(done.name).toBe("lscMobileInline_HcpSnapshot");
    expect(done.label).toBe("HCP snapshot");
    for (const f of done.versions[0].files) expect(f.bundle).toBe(done.name);
  });

  it("sends a project event with the new name and label on the first write", async () => {
    const { builder, events } = setup([{ tools: [write("HCP leaderboard")] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "x", target: "tab" });
    await finished(builder, project!.id);
    const sent = events.flatMap((e) => (e.event.type === "project" ? [e.event.project] : []));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].label).toBe("HCP leaderboard");
    expect(sent[0].name).toBe("lscMobileInline_HcpLeaderboard");
  });

  it("refuses another lscMobileInline_ bundle name on the first write", async () => {
    const other = { name: "write_app", input: { label: "HCP snapshot", files: [{ path: "lwc/lscMobileInline_Elsewhere/lscMobileInline_Elsewhere.js", source: "x" }] } };
    const { builder, seen } = setup([{ tools: [other] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "x", target: "home" });
    const done = await finished(builder, project!.id);
    expect(JSON.stringify(seen[1])).toContain("isn't allowed");
    expect(done.name).toBe("lscMobileInline_Draft");
    expect(done.versions).toHaveLength(0);
  });

  it("never renames after a deploy", async () => {
    const { builder } = setup([{ tools: [write("First name")] }, { text: "ok" }, { tools: [write("Second name", "lscMobileInline_FirstName")] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "x", target: "home" });
    await finished(builder, project!.id);
    builder.markDeployed(project!.id, ["LightningComponentBundle:lscMobileInline_FirstName"]);
    expect(builder.send(project!.id, "again").ok).toBe(true);
    const done = await finished(builder, project!.id);
    expect(done.name).toBe("lscMobileInline_FirstName");
    expect(done.label).toBe("Second name");
  });

  it("names quick actions with the lscMobileQuickAction_ prefix and bans lscMobileInline_", async () => {
    expect(nameFromLabel("Log sample request", "action")).toBe("lscMobileQuickAction_LogSampleRequest");
    const files = (b: string) => ["js", "html", "js-meta.xml"].map((ext) => ({ path: `lwc/${b}/${b}.${ext}`, source: "x" }));
    const bad = { name: "write_app", input: { label: "Log sample request", files: files("lscMobileInline_X") } };
    const good = { name: "write_app", input: { label: "Log sample request", files: files("lscMobileQuickAction_Draft") } };
    const { builder, seen } = setup([{ tools: [bad] }, { tools: [good] }, { text: "ok" }], okCheck);
    const { project } = await builder.create("o", { prompt: "x", target: "action", objectApiName: "Account" });
    expect(project!.name).toBe("lscMobileQuickAction_Draft");
    const done = await finished(builder, project!.id);
    expect(JSON.stringify(seen[1])).toContain("isn't allowed");
    expect(done.name).toBe("lscMobileQuickAction_LogSampleRequest");
    expect(done.versions[0].files[0].path).toBe("lwc/lscMobileQuickAction_LogSampleRequest/lscMobileQuickAction_LogSampleRequest.js");
  });

  it("needs an object for record and action targets", async () => {
    const { builder } = setup([], okCheck);
    expect((await builder.create("o", { prompt: "x", target: "action" })).error).toBeTruthy();
    expect((await builder.create("o", { prompt: "x", target: "record" })).error).toBeTruthy();
  });

  it("builds as a test user: token on describe/sample, user on check; fails fast when expired", async () => {
    const runAs = { loginId: "L1", username: "carmen@x.com", userId: "005X", profile: "Field Rep" };
    const { builder, toolCalls } = setup(
      [{ tools: [{ name: "describe_objects", input: { objects: ["Account"] } }, { name: "sample_records", input: { soql: "SELECT Name FROM Account" } }, write("Todo")] }, { text: "ok" }],
      okCheck,
      { mobileLogin: async (id) => ({ accessToken: "tok-" + id }) }
    );
    const { project } = await builder.create("o", { prompt: "x", target: "home", runAs });
    await finished(builder, project!.id);
    expect(toolCalls.find((c) => c.tool === "studio_app_describe")!.args.mobileLogin).toEqual({ accessToken: "tok-L1" });
    expect(toolCalls.find((c) => c.tool === "studio_app_sample")!.args.mobileLogin).toEqual({ accessToken: "tok-L1" });
    const check = toolCalls.find((c) => c.tool === "studio_app_check")!.args;
    expect(check.userId).toBe("005X");
    expect(check.profile).toBe("Field Rep");

    const expired = setup([{ text: "never" }], okCheck, { mobileLogin: async () => { throw new Error("gone"); } });
    const p2 = (await expired.builder.create("o", { prompt: "x", target: "home", runAs })).project!;
    const d2 = await finished(expired.builder, p2.id);
    expect(d2.turns[0].status).toBe("failed");
    expect(d2.turns[0].error).toContain("carmen@x.com's login expired");
    expect(expired.toolCalls.some((c) => c.tool === "studio_app_describe")).toBe(false);
  });

  it("sets and clears run as", async () => {
    const { builder } = setup([{ text: "hi" }], okCheck);
    const { project } = await builder.create("o", { prompt: "x", target: "home" });
    await finished(builder, project!.id);
    builder.setRunAs(project!.id, { loginId: "L", username: "u" });
    expect(builder.get(project!.id)!.runAs?.loginId).toBe("L");
    builder.setRunAs(project!.id, null);
    expect(builder.get(project!.id)!.runAs).toBeUndefined();
  });

  it("marks builds left running by a closed app as stopped", () => {
    const store = memoryAppStore();
    const at = new Date().toISOString();
    store.save({
      id: "p", org: "o", name: "lscMobileInline_Draft", label: "New app", target: "home", createdAt: at, updatedAt: at, versions: [], currentVersionId: null,
      turns: [{ id: "t", prompt: "x", at, status: "running", reply: "", steps: [{ id: "s", kind: "write", label: "w", status: "running", startedAt: at }] }],
    });
    expect(store.recoverInterrupted()).toBe(1);
    const turn = store.get("p")!.turns[0];
    expect(turn.status).toBe("stopped");
    expect(turn.error).toBe(INTERRUPTED_MESSAGE);
    expect(turn.steps[0].status).toBe("failed");
    expect(store.recoverInterrupted()).toBe(0);
  });
});

const SN = "lscMobileInline_hcpEngagement";
const starterFile = (bundle: string, file: string, source: string) => ({ bundle, path: `lwc/${bundle}/${file}`, source });
const starter = {
  name: SN,
  target: "record",
  objectApiName: "Account",
  files: [
    starterFile(SN, `${SN}.js`, `import { LightningElement } from 'lwc';\nexport default class HcpEngagement extends LightningElement {}\n`),
    starterFile(SN, `${SN}.html`, `<template><c-lsc-mobile-inline_timeline></c-lsc-mobile-inline_timeline></template>\n`),
    starterFile(SN, `${SN}.js-meta.xml`, `<masterLabel>${SN}</masterLabel>`),
    starterFile("lscMobileInline_timeline", "lscMobileInline_timeline.js", `// used by ${SN}\n`),
  ],
  starter: { id: "hcp-engagement", label: "HCP engagement", description: "Visits and inquiries.", repo: "afls-ideas/x", sha: "a".repeat(40), url: "https://github.com/afls-ideas/x/tree/aaa", name: SN, target: "record", objects: ["Visit"], tryNext: ["Add a chart"] },
};

describe("starter apps", () => {
  it("renames a bundle in its paths and in every file that names it, and nothing else", () => {
    const out = renameBundle(starter.files, SN, SN + "2");
    expect(out.map((f) => f.path)).toEqual([`lwc/${SN}2/${SN}2.js`, `lwc/${SN}2/${SN}2.html`, `lwc/${SN}2/${SN}2.js-meta.xml`, "lwc/lscMobileInline_timeline/lscMobileInline_timeline.js"]);
    expect(out[2].source).toBe(`<masterLabel>${SN}2</masterLabel>`);
    expect(out[3]).toEqual({ ...starter.files[3], source: `// used by ${SN}2\n` });
    expect(renameBundle([starterFile("a", "a.js", `${SN}X`)], SN, "Y")[0].source).toBe(`${SN}X`);
  });

  it("starts a project with the starter as its first version, and reopens it while untouched", async () => {
    const { builder, toolCalls } = setup([], okCheck, { starter });
    const { project, error } = await builder.fromStarter("Org@X.com", "hcp-engagement");
    expect(error).toBeUndefined();
    expect(project!.org).toBe("org@x.com");
    expect(project!.name).toBe(SN);
    expect(project!.label).toBe("HCP engagement");
    expect(project!.target).toBe("record");
    expect(project!.objectApiName).toBe("Account");
    expect(project!.starter).toMatchObject({ id: "hcp-engagement", repo: "afls-ideas/x", tryNext: ["Add a chart"] });
    expect(project!.versions).toHaveLength(1);
    expect(project!.versions[0].source).toBe("starter");
    expect(project!.versions[0].files).toEqual(starter.files);
    expect(project!.currentVersionId).toBe(project!.versions[0].id);
    expect((toolCalls.find((c) => c.tool === "studio_app_check")!.args as { name: string }).name).toBe(SN);

    const again = await builder.fromStarter("org@x.com", "hcp-engagement");
    expect(again.project!.id).toBe(project!.id);
  });

  it("renames the starter when the org already has its bundle", async () => {
    const { builder } = setup([], okCheck, { starter, apps: [SN] });
    const { project } = await builder.fromStarter("o", "hcp-engagement");
    expect(project!.name).toBe(SN + "2");
    expect(project!.versions[0].files[0].path).toBe(`lwc/${SN}2/${SN}2.js`);
    expect(project!.versions[0].files[3].bundle).toBe("lscMobileInline_timeline");
  });

  it("reports a starter the server doesn't have", async () => {
    const { builder } = setup([], okCheck);
    expect((await builder.fromStarter("o", "nope")).error).toContain("no starter app");
  });

  it("lets the model edit the starter's prefixed helper bundles, and tells it where the app came from", async () => {
    const helper = { name: "write_app", input: { files: [{ path: "lwc/lscMobileInline_timeline/lscMobileInline_timeline.js", source: "// v2" }] } };
    const { builder, seen } = setup([{ tools: [helper] }, { text: "ok" }], okCheck, { starter });
    const { project } = await builder.fromStarter("o", "hcp-engagement");
    expect(builder.send(project!.id, "tweak the timeline").ok).toBe(true);
    const done = await finished(builder, project!.id);
    expect(JSON.stringify(seen[0])).toContain("Started from the starter app");
    expect(JSON.stringify(seen[1])).not.toContain("isn't allowed");
    expect(done.versions).toHaveLength(2);
    expect(done.versions[1].files.find((f) => f.bundle === "lscMobileInline_timeline")!.source).toBe("// v2");
    expect(done.name).toBe(SN);
  });
});

describe("mobileLogin contract with the server", () => {

  it("the credentials main passes have exactly the fields the server's runAsLogin schema takes", () => {
    const server = readFileSync("src/tools/studio.ts", "utf8");
    const schema = /const runAsLogin = z\s*\.object\(\{([\s\S]*?)\n\s*\}\)/.exec(server)?.[1] ?? "";
    const serverKeys = [...schema.matchAll(/^\s*(\w+):\s*z\./gm)].map((m) => m[1]).sort();
    const login = readFileSync("src-electron/mobile-login.ts", "utf8");
    const returned = /mobileLoginCredentials\(\s*id: string\s*\): Promise<\{([^}]*)\}>/.exec(login)?.[1] ?? "";
    const mainKeys = [...returned.matchAll(/(\w+)\??:/g)].map((m) => m[1]).sort();
    expect(serverKeys).toEqual(["accessToken", "instanceUrl", "orgId", "userId", "username"]);
    expect(mainKeys).toEqual(serverKeys);
    // the object it actually returns carries the same fields
    const body = /return \{ ([^}]*) \};/.exec(login.slice(login.indexOf("export async function mobileLoginCredentials")))?.[1] ?? "";
    expect([...body.matchAll(/(\w+):/g)].map((m) => m[1]).sort()).toEqual(serverKeys);
  });

  it("handlers.ts hands the builder mobileLoginCredentials unchanged", () => {
    expect(readFileSync("src-electron/ipc/handlers.ts", "utf8")).toMatch(/mobileLogin:\s*\(loginId\)\s*=>\s*mobileLoginCredentials\(loginId\)/);
  });
});
