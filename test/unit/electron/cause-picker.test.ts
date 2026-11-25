import { describe, it, expect, vi } from "vitest";
import path from "path";
import {
  loadCauseTitles,
  parsePicks,
  picksFrom,
  pickCauses,
  PICK_TOOL,
  PICK_MAX_TOKENS,
  PICK_TOOL_DEF,
  pickerPrompt,
  type CauseTitle,
} from "../../../src-electron/engine/cause-picker.js";
import { diagnosePreflightWithPicks } from "../../../src-electron/engine/diagnose-first.js";
import type { LLMProvider, Message } from "../../../src-electron/llm/provider.js";

const titles: CauseTitle[] = [
  { id: "a-cause", module: "mobile-sync", title: "First cause" },
  { id: "b-cause", module: "permissions", title: "Second cause" },
];

const toolReply = (ids: unknown): Message => ({
  role: "assistant",
  content: [{ type: "tool_use", id: "t1", name: PICK_TOOL, input: { ids } }],
});
const toolCauses = (causes: unknown): Message => ({
  role: "assistant",
  content: [{ type: "tool_use", id: "t1", name: PICK_TOOL, input: { causes } }],
});

function fakeLlm(
  reply: string | Message | Error
): LLMProvider & { chat: ReturnType<typeof vi.fn> } {
  return {
    id: "fake",
    name: "fake",
    validateCredentials: async () => true,
    chat: vi.fn(async (): Promise<Message> => {
      if (reply instanceof Error) throw reply;
      if (typeof reply !== "string") return reply;
      return { role: "assistant", content: [{ type: "text", text: reply }] };
    }),
  };
}

describe("loadCauseTitles()", () => {
  it("reads every known cause's id and title from the knowledge folder", () => {
    const all = loadCauseTitles(path.resolve(__dirname, "../../.."));
    expect(all.length).toBeGreaterThan(100);
    expect(all.every((c) => c.id && c.title)).toBe(true);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("finds the knowledge folder on its own, as the app calls it", () => {
    expect(loadCauseTitles()).toEqual(loadCauseTitles(path.resolve(__dirname, "../../..")));
  });

  it("gives none when the file isn't there", () => {
    expect(loadCauseTitles("/nonexistent-dir")).toEqual([]);
  });
});

describe("parsePicks()", () => {
  const known = new Set(["a-cause", "b-cause", "c-cause", "d-cause"]);
  it("keeps known ids in order, without repeats, at most three", () => {
    expect(
      parsePicks('{"ids":["b-cause","x","b-cause","a-cause","c-cause","d-cause"]}', known)
    ).toEqual([
      { id: "b-cause", fit: "related" },
      { id: "a-cause", fit: "related" },
      { id: "c-cause", fit: "related" },
    ]);
  });
  it("reads each cause's fit, counting anything but explains as related", () => {
    expect(
      parsePicks(
        '{"causes":[{"id":"a-cause","fit":"explains"},{"id":"b-cause","fit":"related"},{"id":"c-cause","fit":"maybe"},{"id":"x","fit":"explains"}]}',
        known
      )
    ).toEqual([
      { id: "a-cause", fit: "explains" },
      { id: "b-cause", fit: "related" },
      { id: "c-cause", fit: "related" },
    ]);
  });
  it("reads JSON wrapped in prose or a code block", () => {
    expect(parsePicks('Here:\n```json\n{"ids": ["a-cause"]}\n```', known)).toEqual([
      { id: "a-cause", fit: "related" },
    ]);
  });
  it("gives none for anything else", () => {
    expect(parsePicks("no idea", known)).toEqual([]);
    expect(parsePicks('{"ids": "a-cause"}', known)).toEqual([]);
    expect(parsePicks("{broken", known)).toEqual([]);
  });
});

describe("picksFrom()", () => {
  const known = new Set(["a-cause", "b-cause"]);
  it("reads the tool call's ids", () => {
    expect(picksFrom(toolReply(["b-cause", "zzz", "a-cause"]), known)).toEqual([
      { id: "b-cause", fit: "related" },
      { id: "a-cause", fit: "related" },
    ]);
    expect(picksFrom(toolCauses([{ id: "a-cause", fit: "explains" }]), known)).toEqual([
      { id: "a-cause", fit: "explains" },
    ]);
  });
  it("gives none for a tool call with no list", () => {
    expect(picksFrom(toolReply("a-cause"), known)).toEqual([]);
  });
  it("reads JSON in text when the model answers without the tool", () => {
    expect(
      picksFrom(
        { role: "assistant", content: [{ type: "text", text: '{"ids":["a-cause"]}' }] },
        known
      )
    ).toEqual([{ id: "a-cause", fit: "related" }]);
    expect(picksFrom({ role: "assistant", content: '{"ids":["b-cause"]}' }, known)).toEqual([
      { id: "b-cause", fit: "related" },
    ]);
  });
  it("gives none for prose or an empty reply", () => {
    // Both happened live when the model was asked for JSON in text.
    const prose = "The most likely explanation is that the new rep has no territory assignment.";
    expect(
      picksFrom({ role: "assistant", content: [{ type: "text", text: prose }] }, known)
    ).toEqual([]);
    expect(picksFrom({ role: "assistant", content: [] }, known)).toEqual([]);
  });
});

describe("pickCauses()", () => {
  it("sends the cause list and the message, offers the tool without forcing it, and returns its picks", async () => {
    const llm = fakeLlm(toolCauses([{ id: "b-cause", fit: "explains" }]));
    const picks = await pickCauses(llm, "  reps can't log in  ", { model: "m", titles });
    expect(picks).toEqual([{ id: "b-cause", fit: "explains" }]);
    const [system, messages, tools, config] = llm.chat.mock.calls[0];
    expect(system).toBe(pickerPrompt(titles));
    expect(system).toContain("b-cause [permissions]: Second cause");
    expect(messages).toEqual([{ role: "user", content: "reps can't log in" }]);
    expect(tools).toEqual([PICK_TOOL_DEF]);
    // A short limit cut the tool call off before it ended, leaving no ids.
    expect(config).toMatchObject({ model: "m", cache: true, maxTokens: PICK_MAX_TOKENS });
    expect(PICK_MAX_TOKENS).toBeGreaterThanOrEqual(1000);
    expect(config).not.toHaveProperty("toolChoice");
  });

  it("gives none when the request fails", async () => {
    expect(await pickCauses(fakeLlm(new Error("429")), "x", { titles })).toEqual([]);
  });

  it("gives up after the timeout", async () => {
    const llm = fakeLlm("");
    llm.chat.mockImplementation(
      (_s: string, _m: Message[], _t: unknown[], config: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          config.signal.addEventListener("abort", () => reject(new Error("aborted")))
        )
    );
    expect(await pickCauses(llm, "x", { titles, timeoutMs: 10 })).toEqual([]);
  });

  it("asks nothing with no causes or no text", async () => {
    const llm = fakeLlm('{"ids":["a-cause"]}');
    expect(await pickCauses(llm, "x", { titles: [] })).toEqual([]);
    expect(await pickCauses(llm, "   ", { titles })).toEqual([]);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe("diagnosePreflightWithPicks()", () => {
  const explains = (id: string) => ({ id, fit: "explains" as const });
  const related = (id: string) => ({ id, fit: "related" as const });

  it("adds every pick to the diagnose call when the word check takes the message", async () => {
    const calls = await diagnosePreflightWithPicks(
      "sync failed on the iPad",
      new Set(),
      async () => [related("a-cause"), explains("b-cause")]
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toMatchObject({
      symptom: "sync failed on the iPad",
      format: "json",
      suggested: ["a-cause", "b-cause"],
    });
  });

  it("asks for no picks when the message isn't a problem", async () => {
    const pick = vi.fn(async () => [explains("a-cause")]);
    expect(
      await diagnosePreflightWithPicks("how do I configure samples?", new Set(), pick)
    ).toEqual([]);
    expect(pick).not.toHaveBeenCalled();
  });

  it("leaves the call as it was when picking fails or finds nothing", async () => {
    const [failed] = await diagnosePreflightWithPicks("sync failed", new Set(), async () => {
      throw new Error("x");
    });
    expect(failed.input).not.toHaveProperty("suggested");
    const [none] = await diagnosePreflightWithPicks("sync failed again", new Set(), async () => []);
    expect(none.input).not.toHaveProperty("suggested");
  });

  it("diagnoses plain wording the word check lets go when a pick explains it, with only those picks", async () => {
    const seen = new Set<string>();
    const pick = vi.fn(async () => [related("a-cause"), explains("b-cause")]);
    const text = "the rep taps the order button and the screen goes white";
    expect(await diagnosePreflightWithPicks(text, seen, pick)).toEqual([
      {
        name: "diagnose_lsc_issue",
        input: { symptom: text, format: "json", suggested: ["b-cause"], quietWhenEmpty: true },
      },
    ]);
    // Not run twice for the same text.
    expect(await diagnosePreflightWithPicks(text.toUpperCase(), seen, pick)).toEqual([]);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("runs nothing for plain wording when no pick explains it", async () => {
    const text = "the rep taps the order button and the screen goes white";
    expect(
      await diagnosePreflightWithPicks(text, new Set(), async () => [related("a-cause")])
    ).toEqual([]);
    expect(await diagnosePreflightWithPicks(text, new Set(), async () => [])).toEqual([]);
  });

  it("never asks the picker about requests, how-to questions or slash commands", async () => {
    const pick = vi.fn(async () => [explains("a-cause")]);
    for (const text of [
      "create a quick action for orders",
      "explain sample limits",
      "/lsc:status",
      "list every rep in the org",
      "ok",
    ]) {
      expect(await diagnosePreflightWithPicks(text, new Set(), pick)).toEqual([]);
    }
    expect(pick).not.toHaveBeenCalled();
  });
});
