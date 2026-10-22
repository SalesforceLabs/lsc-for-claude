/**
 * Known causes loader
 *
 * Errors and symptoms that support investigations traced back to org configuration, read from
 * knowledge/troubleshooting/known-causes.yaml. Each cause can carry a check (same shape as a
 * validation rule check) that passes when the cause isn't present in the org.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { RuleCheck } from "./rules-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CAUSES_FILE = join(__dirname, "../../knowledge/troubleshooting/known-causes.yaml");

export interface KnownCause {
  id: string;
  title: string;
  module: string;
  symptoms: string[];
  keywords?: string[];
  cause: string;
  fix: string[];
  ui_path?: string;
  /** The behavior is intended; the answer is an explanation, not a fix in the org. */
  by_design?: boolean;
  /** Passes when the cause isn't present. */
  check?: RuleCheck;
  /** Must pass for the cause to apply at all (a feature in use, a handler on). */
  applies_if?: RuleCheck;
  /** What a passing check doesn't cover. */
  check_scope?: string;
  /** Validation rule ids worth running as well. */
  rules?: string[];
}

interface KnownCausesFile {
  schema_version: string;
  causes: KnownCause[];
}

let cached: KnownCause[] | null = null;

export function getKnownCauses(): KnownCause[] {
  if (cached) return cached;
  if (!existsSync(CAUSES_FILE)) {
    console.error(`Known causes file not found: ${CAUSES_FILE}`);
    return (cached = []);
  }
  try {
    const parsed = parseYaml(readFileSync(CAUSES_FILE, "utf-8")) as KnownCausesFile;
    cached = parsed.causes ?? [];
  } catch (error) {
    console.error("Failed to parse known-causes.yaml:", error);
    cached = [];
  }
  return cached;
}

export function getKnownCauseById(id: string): KnownCause | undefined {
  return getKnownCauses().find((c) => c.id === id);
}
