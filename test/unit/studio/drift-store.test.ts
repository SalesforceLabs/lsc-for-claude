import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from "../../../src/studio/drift-store.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "drift-store-"));
  process.env.LSC_STUDIO_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.LSC_STUDIO_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("snapshot store", () => {
  it("saves, lists newest first, loads and deletes", async () => {
    const config = { exportedAt: "", sourceOrg: "a@b.c", version: "1.1", triggerHandlers: [{ developerName: "X" }] };
    const first = await saveSnapshot("a@b.c", config, "one");
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveSnapshot("a@b.c", config);
    expect(first.counts.triggerHandlers).toBe(1);
    expect(second.label).toMatch(/^Snapshot /);
    expect((await listSnapshots("a@b.c")).map((s) => s.id)).toEqual([second.id, first.id]);
    expect((await listSnapshots("other"))).toEqual([]);
    expect((await loadSnapshot("a@b.c", first.id)).meta.label).toBe("one");
    await deleteSnapshot("a@b.c", first.id);
    await expect(loadSnapshot("a@b.c", first.id)).rejects.toThrow(/no longer exists/);
  });

  it("refuses ids that could escape the directory", async () => {
    await expect(loadSnapshot("o", "../../etc/passwd")).rejects.toThrow();
    await expect(deleteSnapshot("o", "../x")).rejects.toThrow();
  });
});
