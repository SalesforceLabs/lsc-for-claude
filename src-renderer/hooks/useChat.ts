import { useState, useEffect, useCallback, useRef } from "react";

export interface ToolCall {
  id: string;
  name: string;
  /** Known once the tool starts running; sessions saved before inputs were kept have none. */
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  /** pending: the model is still writing the call, or it waits for the tools before it. */
  status: "pending" | "running" | "success" | "error";
  collapsed: boolean;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolCall };

export interface ImageAttachment {
  data: string;
  mediaType: string;
  id: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: ImageAttachment[];
  blocks: ContentBlock[];
  isStreaming?: boolean;
  convId?: string;
}

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

export function getFullText(msg: ChatMessage): string {
  if (msg.role === "user") return msg.text;
  return msg.blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Background stream state. Each active stream is keyed by convId.
 * Events are routed by convId — only the stream matching the viewed
 * conversation updates the React state.
 */
interface BackgroundStream {
  nonce: number;
  convId: string;
  msg: ChatMessage;
}

/** Global nonce counter. Incremented each time we send a new message. */
let nonceCounter = 0;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingConvIds, setStreamingConvIds] = useState<Set<string>>(new Set());

  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  /** Map of active background streams, keyed by convId. */
  const bgStreams = useRef<Map<string, BackgroundStream>>(new Map());

  /** Push a bgStream into the messages array if we're viewing that conversation. */
  const syncToView = useCallback((convId: string) => {
    const bg = bgStreams.current.get(convId);
    if (!bg) return;
    if (conversationIdRef.current !== convId) return;
    const bgMsg = bg.msg;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === bgMsg.id);
      if (idx >= 0) {
        // Preserve user-toggled collapsed states from the existing React message
        const existing = prev[idx];
        const merged = {
          ...bgMsg,
          blocks: bgMsg.blocks.map((block) => {
            if (block.type !== "tool") return block;
            const prev = existing.blocks.find(
              (b): b is { type: "tool"; tool: ToolCall } =>
                b.type === "tool" && b.tool.id === block.tool.id
            );
            return prev ? { ...block, tool: { ...block.tool, collapsed: prev.tool.collapsed } } : block;
          }),
        };
        return [...prev.slice(0, idx), merged, ...prev.slice(idx + 1)];
      }
      return prev;
    });
  }, []);

  /** Text deltas arrive many times a frame; show them once a frame. Other events sync at once. */
  const pendingText = useRef<Set<string>>(new Set());
  const textFrame = useRef<number | null>(null);
  const syncTextSoon = useCallback((convId: string) => {
    pendingText.current.add(convId);
    if (textFrame.current != null) return;
    textFrame.current = requestAnimationFrame(() => {
      textFrame.current = null;
      const ids = [...pendingText.current];
      pendingText.current.clear();
      ids.forEach(syncToView);
    });
  }, [syncToView]);

  useEffect(() => {
    if (!window.lscApi) return;
    const cleanups: Array<() => void> = [];

    cleanups.push(
      window.lscApi.onTextDelta((text, _nonce, convId) => {
        const bg = bgStreams.current.get(convId);
        if (!bg) return;
        const blocks = [...bg.msg.blocks];
        const last = blocks[blocks.length - 1];
        if (last && last.type === "text") {
          blocks[blocks.length - 1] = { type: "text", text: last.text + text };
        } else {
          blocks.push({ type: "text", text });
        }
        bg.msg = { ...bg.msg, blocks };
        syncTextSoon(convId);
      })
    );

    cleanups.push(
      window.lscApi.onToolStart(({ id, name, convId }) => {
        const bg = bgStreams.current.get(convId);
        if (!bg) return;
        bg.msg = {
          ...bg.msg,
          blocks: [
            ...bg.msg.blocks,
            { type: "tool" as const, tool: { id, name, status: "pending" as const, collapsed: true } },
          ],
        };
        syncToView(convId);
      })
    );

    cleanups.push(
      window.lscApi.onToolRun(({ id, input, convId }) => {
        const bg = bgStreams.current.get(convId);
        if (!bg) return;
        bg.msg = {
          ...bg.msg,
          blocks: bg.msg.blocks.map((b) =>
            b.type === "tool" && b.tool.id === id ? { ...b, tool: { ...b.tool, input, status: "running" as const } } : b
          ),
        };
        syncToView(convId);
      })
    );

    cleanups.push(
      window.lscApi.onToolResult(({ id, result, isError, convId }) => {
        const bg = bgStreams.current.get(convId);
        if (!bg) return;
        bg.msg = {
          ...bg.msg,
          blocks: bg.msg.blocks.map((b) =>
            b.type === "tool" && b.tool.id === id
              ? { ...b, tool: { ...b.tool, result, isError, status: (isError ? "error" : "success") as "error" | "success", collapsed: true } }
              : b
          ),
        };
        syncToView(convId);
      })
    );

    cleanups.push(window.lscApi.onToolEnd(() => {}));

    cleanups.push(
      window.lscApi.onComplete((_nonce, convId) => {
        const bg = bgStreams.current.get(convId);
        if (!bg) return;

        bg.msg = { ...bg.msg, isStreaming: false };
        syncToView(convId);

        bgStreams.current.delete(convId);

        setStreamingConvIds((prev) => { const next = new Set(prev); next.delete(convId); return next; });
        // Only clear local streaming state if this was the viewed conversation
        if (conversationIdRef.current === convId) {
          setIsStreaming(false);
        }
      })
    );

    cleanups.push(
      window.lscApi.onError((errMsg, _nonce, convId) => {
        const bg = bgStreams.current.get(convId);
        if (!bg) return;
        bg.msg = { ...bg.msg, isStreaming: false };
        syncToView(convId);
        bgStreams.current.delete(convId);

        setStreamingConvIds((prev) => { const next = new Set(prev); next.delete(convId); return next; });
        if (conversationIdRef.current === convId) {
          setError(errMsg);
          setIsStreaming(false);
        }
      })
    );

    return () => cleanups.forEach((fn) => fn());
  }, [syncToView, syncTextSoon]);

  const sendMessage = useCallback(
    async (text: string, model?: string, images?: ImageAttachment[]) => {
      if (!text.trim()) return;

      setError(null);

      let convId = conversationIdRef.current;
      if (!convId) {
        const conv = await window.lscApi.createConversation(text.trim());
        convId = conv.id;
        setConversationId(convId);
        conversationIdRef.current = convId;
      }

      await window.lscApi.addConversationMessage(convId, "user", text.trim());

      const nonce = ++nonceCounter;

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        text: text.trim(),
        images: images && images.length > 0 ? images : undefined,
        blocks: [],
      };
      const assistantMsg: ChatMessage = { id: nextId(), role: "assistant", text: "", blocks: [], isStreaming: true, convId };

      bgStreams.current.set(convId, { nonce, convId, msg: assistantMsg });
      setStreamingConvIds((prev) => new Set(prev).add(convId));
      setIsStreaming(true);
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Build the message payload: content block array when images are present, plain string otherwise
      let payload: string | unknown[];
      if (images && images.length > 0) {
        const imageBlocks = images.map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data },
        }));
        payload = [...imageBlocks, { type: "text", text: text.trim() }];
      } else {
        payload = text.trim();
      }

      const result = await window.lscApi.sendMessage(payload, nonce, convId, model);
      if (!result.ok) {
        setError(result.error || "Failed to send message");
        bgStreams.current.delete(convId);
        setStreamingConvIds((prev) => { const next = new Set(prev); next.delete(convId); return next; });
        setIsStreaming(false);
      }
    },
    []
  );

  /** Abort — only called from the explicit "Stop" button */
  const abort = useCallback(async () => {
    // Stop the session on screen; others keep running in the background.
    const convId = conversationIdRef.current;
    if (convId) await window.lscApi.abortChat(convId);
    if (convId) {
      const bg = bgStreams.current.get(convId);
      if (bg) {
        bg.msg = { ...bg.msg, isStreaming: false };
        syncToView(convId);
        bgStreams.current.delete(convId);
      }
      setStreamingConvIds((prev) => { const next = new Set(prev); next.delete(convId); return next; });
    }
    setIsStreaming(false);
  }, [syncToView]);

  /** New session — just reset the view, don't touch engines */
  const clear = useCallback(async () => {
    setMessages([]);
    setError(null);
    setConversationId(null);
    conversationIdRef.current = null;
    setIsStreaming(false);
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      if (conversationIdRef.current === id) return;

      // Each session has its own engine — no need to clear anything.
      setError(null);
      const stored = await window.lscApi.getConversationMessages(id);
      const loaded: ChatMessage[] = stored.map((m) => {
        if (m.role === "user") {
          return { id: m.id, role: m.role, text: m.text, blocks: [] };
        }
        const blocks: ContentBlock[] = [];
        // Tools are called before the text response, so restore them first
        if (m.toolCalls) {
          const tools = JSON.parse(m.toolCalls) as ToolCall[];
          for (const tc of tools) {
            blocks.push({ type: "tool", tool: { ...tc, collapsed: true } });
          }
        }
        if (m.text) blocks.push({ type: "text", text: m.text });
        return { id: m.id, role: m.role as "assistant", text: "", blocks };
      });

      setMessages(loaded);
      setConversationId(id);
      conversationIdRef.current = id;

      // If there's an active background stream for this session, re-inject the live message
      const bg = bgStreams.current.get(id);
      if (bg) {
        const liveMsg = bg.msg;
        setMessages((prev) => {
          if (prev.some((m) => m.id === liveMsg.id)) return prev;
          return [...prev, { ...liveMsg }];
        });
        setIsStreaming(true);
      } else {
        setIsStreaming(false);
      }
    },
    []
  );

  const toggleToolCollapse = useCallback(
    (messageId: string, toolId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, blocks: m.blocks.map((b) => b.type === "tool" && b.tool.id === toolId ? { ...b, tool: { ...b.tool, collapsed: !b.tool.collapsed } } : b) }
            : m
        )
      );
    },
    []
  );

  return {
    messages,
    isStreaming,
    error,
    conversationId,
    streamingConvIds,
    sendMessage,
    abort,
    clear,
    loadConversation,
    toggleToolCollapse,
  };
}
