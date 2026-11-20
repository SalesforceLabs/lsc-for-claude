/**
 * `ask_user`: the engine's own tool for a question with a known set of answers ("which presentation?").
 * Chat draws the options as buttons (`ChoiceCard`); the call ends the turn, and the user's pick (or
 * whatever they type) arrives as their next message.
 */
import type { ToolDefinition } from "../llm/provider.js";

export const ASK_USER_TOOL = "ask_user";

export const MAX_CHOICES = 12;

/** What the model reads as the call's result. */
export const ASK_USER_RESULT = "The choices are on screen. The user's answer will be their next message; end your turn now.";

export interface AskUserInput {
  question: string;
  options: Array<{ label: string; detail?: string }>;
}

export const ASK_USER_TOOL_DEF: ToolDefinition = {
  name: ASK_USER_TOOL,
  description:
    "Ask the user to pick one answer from a known set (a presentation, territory, profile, user, record, or yes/no style choices), shown as buttons. " +
    "Use it instead of listing the options in text and asking. Put the question here, not in your reply. " +
    "One question per call; it ends your turn. The user can also type an answer that isn't listed.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question, in one short sentence." },
      options: {
        type: "array",
        minItems: 2,
        maxItems: MAX_CHOICES,
        description: `2 to ${MAX_CHOICES} answers, most likely first.`,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "The answer as the user would say it; sent as their reply when picked." },
            detail: { type: "string", description: "Optional: a few words that tell similar answers apart (status, Id, territory)." },
          },
          required: ["label"],
        },
      },
    },
    required: ["question", "options"],
  },
};

/** The call's input, cleaned up, or why it can't be shown. */
export function parseAskUser(input: unknown): AskUserInput | { problem: string } {
  const v = (input ?? {}) as { question?: unknown; options?: unknown };
  const question = typeof v.question === "string" ? v.question.trim() : "";
  if (!question) return { problem: "ask_user needs a question." };
  const seen = new Set<string>();
  const options = (Array.isArray(v.options) ? v.options : []).flatMap((o) => {
    const item = (typeof o === "string" ? { label: o } : o) as { label?: unknown; detail?: unknown } | null;
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!label || seen.has(label)) return [];
    seen.add(label);
    const detail = typeof item?.detail === "string" && item.detail.trim() ? item.detail.trim() : undefined;
    return [{ label, ...(detail ? { detail } : {}) }];
  });
  if (options.length < 2) return { problem: "ask_user needs at least 2 different options. With one, just say what you'll do." };
  if (options.length > MAX_CHOICES)
    return { problem: `ask_user takes at most ${MAX_CHOICES} options. Narrow them down (ask a filtering question first, or show the most likely ${MAX_CHOICES}).` };
  return { question, options };
}
