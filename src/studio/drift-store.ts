/**
 * Local storage for configuration snapshots: `<data dir>/snapshots/<org>/<id>.json`,
 * where the data dir is `LSC_STUDIO_DATA_DIR` or `~/.lsc-studio`.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConfigSnapshot } from "../config/types.js";
import type { SnapshotCounts, SnapshotMeta } from "./drift-types.js";

interface StoredSnapshot {
  meta: SnapshotMeta;
  config: ConfigSnapshot;
}

const ID_RE = /^[0-9TZ-]{10,40}$/;

export function dataDir(): string {
  return process.env.LSC_STUDIO_DATA_DIR || path.join(os.homedir(), ".lsc-studio");
}

function orgDir(org: string): string {
  return path.join(dataDir(), "snapshots", org.replace(/[^a-zA-Z0-9._@-]/g, "_"));
}

function fileFor(org: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error("Unknown snapshot");
  return path.join(orgDir(org), `${id}.json`);
}

export function countsOf(config: ConfigSnapshot): SnapshotCounts {
  return {
    triggerHandlers: config.triggerHandlers?.length ?? 0,
    adminSettings: config.adminSettings?.length ?? 0,
    dbSchema: config.dbSchema?.length ?? 0,
    actions: config.actions?.length ?? 0,
  };
}

export async function saveSnapshot(org: string, config: ConfigSnapshot, label?: string): Promise<SnapshotMeta> {
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, "-");
  const meta: SnapshotMeta = {
    id,
    label: label?.trim() || `Snapshot ${createdAt.slice(0, 16).replace("T", " ")}`,
    org,
    createdAt,
    counts: countsOf(config),
  };
  await fs.mkdir(orgDir(org), { recursive: true });
  const stored: StoredSnapshot = { meta, config };
  await fs.writeFile(fileFor(org, id), JSON.stringify(stored));
  return meta;
}

async function read(file: string): Promise<StoredSnapshot> {
  return JSON.parse(await fs.readFile(file, "utf8")) as StoredSnapshot;
}

export async function listSnapshots(org: string): Promise<SnapshotMeta[]> {
  let names: string[];
  try {
    names = await fs.readdir(orgDir(org));
  } catch {
    return [];
  }
  const metas: SnapshotMeta[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    try {
      metas.push((await read(path.join(orgDir(org), name))).meta);
    } catch {
      // Skip unreadable or partial files.
    }
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadSnapshot(org: string, id: string): Promise<StoredSnapshot> {
  try {
    return await read(fileFor(org, id));
  } catch {
    throw new Error("That snapshot no longer exists");
  }
}

export async function deleteSnapshot(org: string, id: string): Promise<void> {
  await fs.rm(fileFor(org, id), { force: true });
}
