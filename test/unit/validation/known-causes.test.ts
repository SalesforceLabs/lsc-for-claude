/**
 * Known causes consistency tests
 *
 * Loads the real knowledge/troubleshooting/known-causes.yaml and checks its structure, that
 * every check is one the executor can run and evaluate, that linked rule ids exist, and that
 * each cause is the best match for its own symptoms.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { RuleCheck } from "../../../src/validation/rules-loader.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(async () => ({
    success: true,
    data: { totalSize: 0, done: true, records: [] },
  })),
  runToolingQuery: vi.fn(async () => ({
    success: true,
    data: { totalSize: 0, done: true, records: [] },
  })),
  // A retrieve that succeeds with an empty file for each member asked for.
  retrieveMetadata: vi.fn(async (_p: string, members: string | string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-retrieve-"));
    for (const m of [members].flat()) {
      const [type, name] = m.split(":");
      const ext =
        type === "Settings" ? "settings" : type === "Flow" ? "flow" : "expressionSetDefinition";
      fs.writeFileSync(path.join(dir, `${name}.${ext}-meta.xml`), `<${type} xmlns="x"/>`);
    }
    return { success: true, data: { outputDir: dir } };
  }),
}));

const { getKnownCauses } = await import("../../../src/validation/known-causes.js");
const { getAllRules } = await import("../../../src/validation/rules-loader.js");
const { executeCheck } = await import("../../../src/validation/rules-executor.js");
const { matchSymptom } = await import("../../../src/validation/symptom-match.js");
const { BUILTIN_CHECKS } = await import("../../../src/validation/builtin-checks.js");

const RUNNABLE_TYPES = [
  "soql",
  "soql_count",
  "tooling_soql",
  "tooling_soql_count",
  "composite",
  "builtin",
];

function leafChecks(check: RuleCheck): RuleCheck[] {
  return check.type === "composite" ? (check.checks ?? []).flatMap(leafChecks) : [check];
}

describe("known-causes.yaml", () => {
  const causes = getKnownCauses();
  const ruleIds = new Set(getAllRules().map((r) => r.id));

  beforeAll(() => {
    expect(causes.length).toBeGreaterThan(40);
  });

  it("has unique kebab-case ids", () => {
    const ids = causes.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives every cause a title, module, symptoms, cause and fix", () => {
    for (const c of causes) {
      expect(c.title, c.id).toBeTruthy();
      expect(c.module, c.id).toBeTruthy();
      expect(c.symptoms?.length, c.id).toBeGreaterThan(0);
      expect(c.cause?.trim(), c.id).toBeTruthy();
      expect(c.fix?.length, c.id).toBeGreaterThan(0);
    }
  });

  it("keeps by-design causes free of checks", () => {
    for (const c of causes.filter((c) => c.by_design)) expect(c.check, c.id).toBeUndefined();
  });

  it("gives every Order Management cause a check, by_design, or a reason it has no check", () => {
    for (const c of causes.filter((c) => c.module === "order-management")) {
      if (c.by_design) expect(c.no_check_reason, c.id).toBeUndefined();
      else if (!c.check) expect(c.no_check_reason?.trim(), c.id).toBeTruthy();
    }
  });

  it("links only rules that exist", () => {
    for (const c of causes)
      for (const id of c.rules ?? []) expect(ruleIds.has(id), `${c.id} -> ${id}`).toBe(true);
  });

  it("names no work items or customers", () => {
    const text = JSON.stringify(causes);
    expect(text).not.toMatch(/\bW-\d{6,}\b/);
    expect(text).not.toMatch(/\bInvestigation\b/);
  });

  it("uses only check types the executor runs, with queries", () => {
    for (const c of causes) {
      for (const check of [c.check, c.applies_if].filter(Boolean) as RuleCheck[]) {
        expect(RUNNABLE_TYPES, c.id).toContain(check.type);
        for (const leaf of leafChecks(check)) {
          expect(RUNNABLE_TYPES, c.id).toContain(leaf.type);
          if (leaf.type === "builtin") expect(BUILTIN_CHECKS, c.id).toContain(leaf.name);
          else expect(leaf.query?.trim(), c.id).toMatch(/^SELECT /i);
        }
      }
    }
  });

  it("uses expectations the executor can evaluate", async () => {
    for (const c of causes) {
      for (const check of [c.check, c.applies_if].filter(Boolean) as RuleCheck[]) {
        // A diagnosis always has the pasted text, which checks of a named thing (a tab) read.
        const outcome = await executeCheck(check, "test-org", { symptom: c.symptoms[0] });
        expect(outcome.unavailable, `${c.id}: ${outcome.message}`).toBeFalsy();
      }
    }
  });

  it("puts each cause first for its own symptoms", () => {
    const rules = getAllRules();
    for (const c of causes) {
      for (const symptom of c.symptoms) {
        const top = matchSymptom(symptom, causes, rules)[0];
        // Another cause can share a symptom exactly; it just has to score as high.
        const own = matchSymptom(symptom, [c], [])[0];
        expect(own?.score ?? 0, `${c.id}: "${symptom}"`).toBeGreaterThanOrEqual(top.score);
      }
    }
  });
});
