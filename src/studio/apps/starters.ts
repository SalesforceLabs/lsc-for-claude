/**
 * Starter apps for the LSC App builder: working LSC apps from the afls-ideas GitHub
 * account, copied at pinned commits into knowledge/app-starters by
 * scripts/sync-app-starters.mjs. A starter becomes a project's first version, which
 * the user then changes with Roz. No org is needed to list or read them.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { objectsRead } from "./objects.js";
import type { AppFile, AppInput, AppTarget } from "./types.js";

const STARTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "knowledge", "app-starters");

interface ManifestEntry {
  id: string;
  label: string;
  description: string;
  repo: string;
  sha: string;
  path?: string;
  name: string;
  target: AppTarget;
  objectApiName?: string;
  bundles: string[];
  /** Objects the source reaches that the scan can't see (e.g. through a related list id). */
  objects?: string[];
  tryNext?: string[];
}

export interface AppStarter {
  id: string;
  label: string;
  description: string;
  /** "owner/repo" on GitHub. */
  repo: string;
  /** The commit the files were copied from. */
  sha: string;
  /** The repo at that commit. */
  url: string;
  /** The parent bundle's API name. */
  name: string;
  target: AppTarget;
  objectApiName?: string;
  /** Objects the source reads. */
  objects: string[];
  /** Follow-up prompts worth trying on it. */
  tryNext: string[];
}

export interface AppStarterSource extends AppInput {
  starter: AppStarter;
}

const ID_RE = /^[a-z0-9-]{1,60}$/;

function readManifest(dir: string): ManifestEntry[] {
  const data = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { starters?: ManifestEntry[] };
  return data.starters ?? [];
}

function readFiles(dir: string, entry: ManifestEntry): AppFile[] {
  const files: AppFile[] = [];
  for (const bundle of entry.bundles) {
    for (const file of readdirSync(join(dir, entry.id, "lwc", bundle)).sort()) {
      files.push({ bundle, path: `lwc/${bundle}/${file}`, source: readFileSync(join(dir, entry.id, "lwc", bundle, file), "utf8") });
    }
  }
  return files;
}

function describeStarter(entry: ManifestEntry, files: AppFile[]): AppStarter {
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    repo: entry.repo,
    sha: entry.sha,
    url: `https://github.com/${entry.repo}/tree/${entry.sha}`,
    name: entry.name,
    target: entry.target,
    ...(entry.objectApiName ? { objectApiName: entry.objectApiName } : {}),
    objects: [...new Set([...objectsRead(files, entry.target === "record" ? entry.objectApiName : undefined), ...(entry.objects ?? [])])],
    tryNext: entry.tryNext ?? [],
  };
}

/** Every starter, in the manifest's order. */
export function listStarters(dir = STARTERS_DIR): AppStarter[] {
  return readManifest(dir).map((e) => describeStarter(e, readFiles(dir, e)));
}

/** One starter's files, ready to check and keep as a project's first version. */
export function starterSource(id: string, dir = STARTERS_DIR): AppStarterSource {
  if (!ID_RE.test(id)) throw new Error(`Not a starter id: ${id}`);
  const entry = readManifest(dir).find((e) => e.id === id);
  if (!entry) throw new Error(`There's no starter app named ${id}.`);
  const files = readFiles(dir, entry);
  return {
    name: entry.name,
    target: entry.target,
    ...(entry.objectApiName ? { objectApiName: entry.objectApiName } : {}),
    files,
    starter: describeStarter(entry, files),
  };
}
