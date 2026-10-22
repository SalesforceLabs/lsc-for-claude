import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** What an Electron utility process gets as `process.parentPort` (not in @types/node). */
export interface ParentPort {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** Sent once the server listens, so the app doesn't send `initialize` before anyone hears it. */
export const READY_MESSAGE = { type: "lsc-mcp-ready" } as const;

/** The parent port when this server runs as the Electron app's utility process, else undefined. */
export function electronParentPort(): ParentPort | undefined {
  return (process as unknown as { parentPort?: ParentPort }).parentPort;
}

/**
 * MCP over an Electron utility process's parent port. The desktop app runs the server this way, on
 * Electron's own Node, so it needs no Node install and can load the server from inside app.asar.
 * Claude Code still runs it over stdio.
 */
export class ParentPortServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private port: ParentPort) {}

  async start(): Promise<void> {
    this.port.on("message", ({ data }) => {
      const parsed = JSONRPCMessageSchema.safeParse(data);
      if (parsed.success) this.onmessage?.(parsed.data);
      else this.onerror?.(new Error("Ignored a message that isn't JSON-RPC."));
    });
    this.port.postMessage(READY_MESSAGE);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.port.postMessage(message);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}
