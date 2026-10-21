import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** The part of Electron's `UtilityProcess` this transport uses. */
export interface ServerProcess {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): boolean;
}

export type ForkServer = (script: string, options: { cwd: string; env: Record<string, string>; serviceName: string }) => Promise<ServerProcess>;

/** Must match `READY_MESSAGE` in src/parent-port-transport.ts. */
const READY_TYPE = "lsc-mcp-ready";
const READY_TIMEOUT_MS = 60_000;

const isReady = (m: unknown) => typeof m === "object" && m !== null && (m as { type?: unknown }).type === READY_TYPE;

/**
 * Runs the MCP server as an Electron utility process and talks to it over its parent port. Electron
 * runs it on its own Node, so the app doesn't need Node installed and can load the server from inside
 * app.asar, which the fuses leave as the only place app code is loaded from.
 */
export class UtilityProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private child?: ServerProcess;
  private closed = false;

  constructor(
    private fork: ForkServer,
    private script: string,
    private options: { cwd: string; env: Record<string, string> }
  ) {}

  async start(): Promise<void> {
    const child = await this.fork(this.script, { ...this.options, serviceName: "LSC MCP server" });
    this.child = child;
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        if (ready) return;
        child.kill();
        reject(new Error("The MCP server didn't start within a minute."));
      }, READY_TIMEOUT_MS);
      child.on("message", (message) => {
        if (!ready && isReady(message)) {
          ready = true;
          clearTimeout(timer);
          resolve();
        } else if (ready) {
          this.onmessage?.(message as JSONRPCMessage);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        this.child = undefined;
        if (!ready) reject(new Error(`The MCP server exited before it started (code ${code}).`));
        this.finish();
      });
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child) throw new Error("The MCP server isn't running.");
    this.child.postMessage(message);
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}
