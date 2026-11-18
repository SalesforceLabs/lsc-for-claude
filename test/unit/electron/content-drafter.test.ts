import { describe, expect, it } from "vitest";
import {
  ContentDrafter,
  INTERRUPTED_DRAFT,
  MAX_FAILING_DRAFT_WRITES,
  cleanName,
  memoryDraftStore,
  mergeFiles,
  parseWrite,
  writeResult,
  type DraftSync,
} from "../../../src-electron/engine/content-drafter.js";
import type {
  ContentDraft,
  ContentDraftCheck,
  ContentDraftEvent,
} from "../../../src-electron/engine/content-draft-types.js";
import type { LLMProvider, Message, StreamChunk } from "../../../src-electron/llm/provider.js";

type Step = {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
  hang?: boolean;
};

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
      if (!step) throw new Error("script exhausted");
      if (step.hang) return new Promise<Message>(() => {});
      const content: Message["content"] = [];
      if (step.text) {
        onChunk?.({ type: "text_delta", text: step.text });
        content.push({ type: "text", text: step.text });
      }
      for (const [n, t] of (step.tools ?? []).entries()) {
        const id = `t${i}_${n}`;
        onChunk?.({ type: "tool_use_start", id, name: t.name });
        onChunk?.({ type: "tool_use_delta", input_json: JSON.stringify(t.input) });
        onChunk?.({ type: "tool_use_end", id });
        content.push({ type: "tool_use", id, name: t.name, input: t.input });
      }
      return { role: "assistant", content };
    },
  };
  return { llm, seen };
}

const syncFor = (files: Array<{ path: string }>, checks: ContentDraftCheck[] = []): DraftSync => ({
  player: {
    root: "/tmp",
    slides: files
      .filter((f) => f.path.endsWith(".html"))
      .map((f) => ({ name: f.path, file: f.path })),
  },
  checks,
  files: files.map((f) => f.path),
  thumbnails: [],
});

function setup(script: Step[], checksFor: (n: number) => ContentDraftCheck[] = () => []) {
  const store = memoryDraftStore();
  const events: ContentDraftEvent[] = [];
  const calls: Array<Record<string, unknown>> = [];
  const { llm, seen } = fakeLlm(script);
  let writes = 0;
  const drafter = new ContentDrafter({
    llm: () => llm,
    model: () => "claude-opus-5-5",
    store,
    emit: (_id, e) => events.push(e),
    call: async (_tool, args) => {
      calls.push(args);
      if (args.remove) return {};
      return syncFor((args.files as Array<{ path: string }>) ?? [], checksFor(writes++));
    },
  });
  const settled = async (id: string) => {
    for (let n = 0; n < 200 && drafter.isRunning(id); n++)
      await new Promise((r) => setTimeout(r, 5));
    return drafter.get(id)!;
  };
  return { drafter, store, events, calls, seen, settled };
}

const write = (
  files: Array<{ path: string; content: string }>,
  extra: Record<string, unknown> = {}
) => ({
  name: "write_slides",
  input: { files, ...extra },
});

describe("drafter helpers", () => {
  it("cleans names", () => {
    expect(cleanName("  Dosing\n overview ")).toBe("Dosing overview");
    expect(cleanName("")).toBeNull();
    expect(cleanName(3)).toBeNull();
    expect(cleanName("x".repeat(100))).toHaveLength(80);
  });

  it("merges files, replacing, adding and removing", () => {
    const merged = mergeFiles(
      [
        { path: "02.html", content: "old" },
        { path: "01.html", content: "a" },
      ],
      [
        { path: "02.html", content: "new" },
        { path: "03.html", content: "c" },
      ],
      ["01.html"]
    );
    expect(merged).toEqual([
      { path: "02.html", content: "new" },
      { path: "03.html", content: "c" },
    ]);
  });

  it("checks the write's shape", () => {
    expect(() => parseWrite({})).toThrow(/at least one file/);
    expect(() => parseWrite({ files: [{ path: "a.html" }] })).toThrow(/path and its content/);
    expect(parseWrite({ files: [{ path: " a.html ", content: "x" }], name: " Hi " })).toEqual({
      name: "Hi",
      files: [{ path: "a.html", content: "x" }],
      remove: [],
    });
    expect(parseWrite({ delete: ["a.html", 3] }).remove).toEqual(["a.html"]);
  });

  it("tells the model what to fix", () => {
    const text = writeResult(
      syncFor(
        [{ path: "01.html" }],
        [
          { level: "error", file: "01.html", message: "x.png isn't in the draft." },
          { level: "warning", message: "No viewport tag." },
        ]
      )
    );
    expect(text).toMatch(/1 slide\(s\): 01.html/);
    expect(text).toMatch(/Errors to fix:\n- 01.html: x.png/);
    expect(text).toMatch(/Warnings:\n- No viewport tag/);
    expect(writeResult(syncFor([{ path: "01.html" }]))).toMatch(/Call finish/);
  });
});

describe("ContentDrafter", () => {
  it("drafts a page, names it and saves it", async () => {
    const { drafter, events, calls, settled, seen } = setup([
      {
        text: "Writing it.",
        tools: [
          write([{ path: "01_title.html", content: "<html></html>" }], { name: "Cordim title" }),
        ],
      },
      { tools: [{ name: "finish", input: { summary: "One title slide." } }] },
    ]);
    const created = drafter.create("Admin@X.com", "A title slide");
    expect("error" in created).toBe(false);
    const d = await settled((created as ContentDraft).id);
    expect(d.org).toBe("admin@x.com");
    expect(d.name).toBe("Cordim title");
    expect(d.files.map((f) => f.path)).toEqual(["01_title.html"]);
    expect(d.revision).toBe(1);
    expect(d.turns[0].status).toBe("done");
    expect(d.turns[0].reply).toContain("One title slide.");
    expect(calls[0]).toMatchObject({ draftId: d.id, replace: true });
    expect(events.some((e) => e.type === "draft")).toBe(true);
    expect(JSON.stringify(seen[1])).toContain("Call finish");
    expect(drafter.list("admin@x.com").map((x) => x.id)).toEqual([d.id]);
  });

  it("sends the current files with a follow-up", async () => {
    const { drafter, settled, seen } = setup([
      { tools: [write([{ path: "01.html", content: "<p>v1</p>" }])] },
      { tools: [{ name: "finish", input: {} }] },
      { tools: [write([{ path: "01.html", content: "<p>v2</p>" }])] },
      { tools: [{ name: "finish", input: {} }] },
    ]);
    const id = (drafter.create("a", "Brief") as ContentDraft).id;
    await settled(id);
    expect("error" in drafter.send(id, "Make it blue")).toBe(false);
    const d = await settled(id);
    expect(JSON.stringify(seen[2][0])).toContain("<p>v1</p>");
    expect(d.files[0].content).toBe("<p>v2</p>");
    expect(d.turns).toHaveLength(2);
  });

  it("won't finish with errors and gives up after repeated failing writes", async () => {
    const bad: ContentDraftCheck[] = [{ level: "error", message: "x.png isn't in the draft." }];
    const { drafter, settled, seen } = setup(
      [
        { tools: [write([{ path: "01.html", content: "a" }]), { name: "finish", input: {} }] },
        { tools: [write([{ path: "01.html", content: "b" }])] },
        { tools: [write([{ path: "01.html", content: "c" }])] },
      ],
      () => bad
    );
    const id = (drafter.create("a", "Brief") as ContentDraft).id;
    const d = await settled(id);
    expect(JSON.stringify(seen[1])).toContain("still have errors");
    expect(d.turns[0].status).toBe("failed");
    expect(d.turns[0].error).toContain(`${MAX_FAILING_DRAFT_WRITES} tries`);
    // the last files are kept so the user can see them
    expect(d.files[0].content).toBe("c");
  });

  it("stops, refuses renames while running, and deletes", async () => {
    const { drafter, settled, store, calls } = setup([{ hang: true }]);
    const id = (drafter.create("a", "Brief") as ContentDraft).id;
    expect(drafter.rename(id, "New")).toEqual({ error: "Wait for Roz to finish first." });
    expect(drafter.send(id, "More")).toEqual({ error: "Roz is still working on this draft." });
    drafter.stop(id);
    const d = await settled(id);
    expect(d.turns[0].status).toBe("stopped");
    expect(drafter.rename(id, "  ")).toEqual({ error: "The page needs a name." });
    expect((drafter.rename(id, "Dosing") as ContentDraft).name).toBe("Dosing");
    await drafter.delete(id);
    expect(store.get(id)).toBeNull();
    expect(calls.at(-1)).toEqual({ draftId: id, remove: true });
  });

  it("refuses an empty brief and a preview with no slides", async () => {
    const { drafter } = setup([]);
    expect(drafter.create("a", "  ")).toEqual({ error: "Say what the slides should cover." });
    await expect(drafter.preview("nope")).rejects.toThrow(/gone/);
  });

  it("marks turns left running when the app closed", () => {
    const store = memoryDraftStore();
    store.save({
      id: "d1",
      org: "a",
      name: "P",
      createdAt: "x",
      updatedAt: "x",
      files: [],
      checks: [],
      revision: 0,
      turns: [
        {
          id: "t",
          prompt: "p",
          at: "x",
          status: "running",
          reply: "",
          steps: [{ id: "s", label: "W", status: "running" }],
        },
      ],
    });
    expect(store.recoverInterrupted()).toBe(1);
    const t = store.get("d1")!.turns[0];
    expect(t.status).toBe("stopped");
    expect(t.error).toBe(INTERRUPTED_DRAFT);
  });
});
