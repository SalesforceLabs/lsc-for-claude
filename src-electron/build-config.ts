/**
 * Values written into the app at build time by scripts/write-build-config.mjs
 * (dist-electron/build-config.json, beside this module once compiled). They
 * come from the build's environment — release builds get them from GitHub
 * secrets — so they are never in the repo. A build without them has an empty
 * file, and every value is optional.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface BuildConfig {
  /** The LSC mobile app's connected-app consumer key (LSC_MOBILE_CLIENT_ID at build time). */
  mobileClientId?: string;
}

let cached: BuildConfig | undefined;

/** Parses the file's text; anything that isn't a JSON object of strings counts as empty. */
export function parseBuildConfig(text: string): BuildConfig {
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object") return {};
    const id = (raw as Record<string, unknown>).mobileClientId;
    return typeof id === "string" && id.trim() ? { mobileClientId: id.trim() } : {};
  } catch {
    return {};
  }
}

export function buildConfig(): BuildConfig {
  if (cached) return cached;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-config.json");
  try {
    cached = parseBuildConfig(fs.readFileSync(file, "utf8"));
  } catch {
    cached = {};
  }
  return cached;
}
