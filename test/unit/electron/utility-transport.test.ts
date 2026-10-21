import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import path from "path";
import { UtilityProcessTransport, type ServerProcess } from "../../../src-electron/mcp/utility-transport.js";
import { ParentPortServerTransport, READY_MESSAGE, type ParentPort } from "../../../src/parent-port-transport.js";
import { isInsideAsar } from "../../../src-electron/mcp/client.js";
import { withShellPath } from "../../../src-electron/shell-path.js";

/** A utility process and its parent port joined back to back, as Electron joins them. */
function pair() {
  const toServer = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & ServerProcess & { killed: boolean };
  child.killed = false;
  child.postMessage = (m) => queueMicrotask(() => toServer.emit("message", { data: m }));
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit("exit", 0));
    return true;
  };
  const port: ParentPort = {
    on: (_event, listener) => void toServer.on("message", listener),
    postMessage: (m) => queueMicrotask(() => child.emit("message", m)),
  };
  return { child, port };
}

const request = { jsonrpc: "2.0" as const, id: 1, method: "tools/list" };

describe("utility process transport", () => {
  it("waits for the server's ready message, then carries JSON-RPC both ways", async () => {
    const { child, port } = pair();
    const fork = vi.fn(async () => child);
    const client = new UtilityProcessTransport(fork, "/app/dist/index.js", { cwd: "/tmp", env: { A: "1" } });
    const server = new ParentPortServerTransport(port);
    const atServer: unknown[] = [];
    server.onmessage = (m) => {
      atServer.push(m);
      void server.send({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    };
    const atClient: unknown[] = [];
    client.onmessage = (m) => atClient.push(m);

    const started = client.start();
    expect(fork).toHaveBeenCalledWith("/app/dist/index.js", expect.objectContaining({ cwd: "/tmp", env: { A: "1" } }));
    // A real process answers on a later turn of the event loop, after the listeners are on.
    await new Promise((r) => setTimeout(r, 0));
    await server.start();
    await started;
    await client.send(request);
    await new Promise((r) => setTimeout(r, 0));
    expect(atServer).toEqual([request]);
    expect(atClient).toEqual([{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]);
    // The handshake isn't passed on as a message.
    expect(atClient).not.toContainEqual(READY_MESSAGE);
  });

  it("fails the start when the server exits first, and reports the close once", async () => {
    const { child } = pair();
    const client = new UtilityProcessTransport(async () => child, "/x.js", { cwd: "/tmp", env: {} });
    const onclose = vi.fn();
    client.onclose = onclose;
    const started = client.start();
    await new Promise((r) => setTimeout(r, 0));
    child.emit("exit", 1);
    await expect(started).rejects.toThrow(/exited before it started \(code 1\)/);
    await client.close();
    expect(onclose).toHaveBeenCalledTimes(1);
    await expect(client.send(request)).rejects.toThrow(/isn't running/);
  });

  it("kills the server on close", async () => {
    const { child, port } = pair();
    const client = new UtilityProcessTransport(async () => child, "/x.js", { cwd: "/tmp", env: {} });
    const onclose = vi.fn();
    client.onclose = onclose;
    const started = client.start();
    await new Promise((r) => setTimeout(r, 0));
    await new ParentPortServerTransport(port).start();
    await started;
    await client.close();
    await new Promise((r) => setTimeout(r, 0));
    expect(child.killed).toBe(true);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("drops messages that aren't JSON-RPC at the server", async () => {
    const { child, port } = pair();
    const server = new ParentPortServerTransport(port);
    const onmessage = vi.fn();
    const onerror = vi.fn();
    server.onmessage = onmessage;
    server.onerror = onerror;
    await server.start();
    child.postMessage({ hello: "world" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onmessage).not.toHaveBeenCalled();
    expect(onerror).toHaveBeenCalled();
  });
});

describe("isInsideAsar", () => {
  it("knows a packaged app's server folder can't be a working directory", () => {
    expect(isInsideAsar("/Applications/Roz for LSC.app/Contents/Resources/app.asar")).toBe(true);
    expect(isInsideAsar(path.join("/a", "app.asar", "dist"))).toBe(true);
    expect(isInsideAsar("/Users/me/lsc-for-claude")).toBe(false);
    expect(isInsideAsar("/Users/me/app.asar.unpacked")).toBe(false);
  });
});

describe("withShellPath", () => {
  it("keeps PATH's order and adds the shell's folders and the usual install folders after it", () => {
    const out = withShellPath({ PATH: "/usr/bin:/bin" }, () => "/Users/me/.nvm/versions/node/v22/bin:/usr/bin:/opt/homebrew/bin").split(":");
    expect(out.slice(0, 3)).toEqual(["/usr/bin", "/bin", "/Users/me/.nvm/versions/node/v22/bin"]);
    expect(out).toContain("/usr/local/bin");
    expect(out.filter((d) => d === "/usr/bin")).toHaveLength(1);
    expect(out.filter((d) => d === "/opt/homebrew/bin")).toHaveLength(1);
  });

  it("works without a shell answer and ignores relative entries", () => {
    const out = withShellPath({ PATH: "/usr/bin" }, () => undefined).split(":");
    expect(out[0]).toBe("/usr/bin");
    expect(out).toContain("/opt/homebrew/bin");
    expect(withShellPath({ PATH: "" }, () => "relative/bin:.").split(":")).not.toContain("relative/bin");
  });
});
