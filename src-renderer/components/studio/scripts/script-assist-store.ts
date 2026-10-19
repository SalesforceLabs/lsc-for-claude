// Ask Roz conversations, one per script, kept at module level so switching scripts (or hiding the
// panel) neither loses a conversation nor stops a reply that is still streaming.
import { useSyncExternalStore } from "react";
import {
  requestMessages,
  type AssistDiagnostic,
  type AssistMessage,
  type AssistScript,
  type AssistTest,
} from "./script-assist-logic";

export interface AssistConversation {
  messages: AssistMessage[];
  /** The request id of the reply being streamed, if any. */
  requestId: string | null;
}

export interface AssistContext {
  script: AssistScript;
  diagnostics?: AssistDiagnostic[];
  lastTest?: AssistTest;
}

const EMPTY: AssistConversation = { messages: [], requestId: null };
const conversations = new Map<string, AssistConversation>();
const owners = new Map<string, string>(); // request id -> script key
const listeners = new Set<() => void>();
let unsubscribeEvents: (() => void) | null = null;

function emit(): void {
  listeners.forEach((l) => l());
}

function update(key: string, change: (c: AssistConversation) => AssistConversation): void {
  conversations.set(key, change(conversations.get(key) ?? EMPTY));
  emit();
}

function patchMessage(key: string, id: string, patch: (m: AssistMessage) => AssistMessage): void {
  update(key, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? patch(m) : m)) }));
}

/** Route the main process's events to the conversation that asked. Subscribed once, on first use. */
function listen(): void {
  if (unsubscribeEvents) return;
  unsubscribeEvents = window.lscApi.onScriptAssistEvent((event) => {
    const key = owners.get(event.requestId);
    if (!key) return;
    const conv = conversations.get(key);
    const reply = conv?.messages.find((m) => m.id === event.requestId);
    if (!conv || !reply) return;
    if (event.kind === "delta") {
      patchMessage(key, reply.id, (m) => ({ ...m, text: m.text + event.text }));
    } else if (event.kind === "tool") {
      patchMessage(key, reply.id, (m) => {
        const running = m.tools.find((t) => t.name === event.name && t.status === "running");
        const detail = event.detail ?? running?.detail ?? "";
        const tools = running
          ? m.tools.map((t) => (t === running ? { ...t, status: event.status, detail } : t))
          : [...m.tools, { id: `${m.tools.length}`, name: event.name, status: event.status, detail }];
        return { ...m, tools };
      });
    } else if (event.kind === "done") {
      owners.delete(event.requestId);
      patchMessage(key, reply.id, (m) => ({ ...m, text: event.message || m.text, status: "done" }));
      update(key, (c) => ({ ...c, requestId: null }));
    } else if (event.kind === "error") {
      owners.delete(event.requestId);
      patchMessage(key, reply.id, (m) => ({ ...m, status: "error", error: event.error }));
      update(key, (c) => ({ ...c, requestId: null }));
    }
  });
}

function newId(): string {
  return crypto.randomUUID();
}

export function getConversation(key: string): AssistConversation {
  return conversations.get(key) ?? EMPTY;
}

export function useAssistConversation(key: string): AssistConversation {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getConversation(key)
  );
}

async function start(key: string, context: AssistContext): Promise<void> {
  listen();
  const replyId = newId();
  const conv = getConversation(key);
  const messages = requestMessages(conv.messages);
  update(key, (c) => ({
    messages: [...c.messages, { id: replyId, role: "assistant", text: "", status: "streaming", tools: [] }],
    requestId: replyId,
  }));
  owners.set(replyId, key);
  let result: { ok: true } | { ok: false; error: string };
  try {
    result = await window.lscApi.studioScriptAssist(replyId, { ...context, messages });
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    owners.delete(replyId);
    patchMessage(key, replyId, (m) => ({ ...m, status: "error", error: result.ok ? undefined : result.error }));
    update(key, (c) => ({ ...c, requestId: null }));
  }
}

/** Add the user's message and start the reply. */
export function sendAssistMessage(key: string, text: string, context: AssistContext): Promise<void> {
  const body = text.trim();
  if (!body || getConversation(key).requestId) return Promise.resolve();
  update(key, (c) => ({ ...c, messages: [...c.messages, { id: newId(), role: "user", text: body, status: "done", tools: [] }] }));
  return start(key, context);
}

/** Replace a failed reply with a new attempt. */
export function retryAssist(key: string, context: AssistContext): Promise<void> {
  const conv = getConversation(key);
  const last = conv.messages[conv.messages.length - 1];
  if (conv.requestId || !last || last.role !== "assistant" || last.status !== "error") return Promise.resolve();
  update(key, (c) => ({ ...c, messages: c.messages.slice(0, -1) }));
  return start(key, context);
}

/** Stop the reply that is streaming; what arrived stays, marked as stopped. */
export function stopAssist(key: string): void {
  const { requestId } = getConversation(key);
  if (!requestId) return;
  owners.delete(requestId);
  void window.lscApi.studioScriptAssistAbort(requestId);
  patchMessage(key, requestId, (m) => ({ ...m, status: m.text.trim() ? "done" : "error", error: m.text.trim() ? undefined : "Stopped." }));
  update(key, (c) => ({ ...c, requestId: null }));
}

/** Clear a script's conversation (stopping a reply first). */
export function resetAssist(key: string): void {
  stopAssist(key);
  conversations.delete(key);
  emit();
}

export function markProposed(key: string, id: string): void {
  patchMessage(key, id, (m) => (m.proposed ? m : { ...m, proposed: true }));
}
