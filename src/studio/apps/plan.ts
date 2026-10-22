/** What deploying an app would write and overwrite, without writing anything. */

import { query, type Row } from "../helpers.js";
import { isProductionOrg } from "../metadata/live.js";
import { buildAppTree } from "./deploy.js";
import { lintApp } from "./lint.js";
import type { AppInput } from "./types.js";

export interface AppDeployPlan {
  /** What a deploy writes, as `Type:Name` (QuickAction names are `Object.Name`). */
  components: string[];
  /** The components already in the org, which a deploy overwrites. */
  existing: string[];
  production: boolean;
  warnings: string[];
}

const soql = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const names = (rows: Row[], field: string) => new Set(rows.map((r) => String(r[field] ?? "")));

/** Components of the plan that the org already has. A lookup that fails counts as nothing found and says so. */
async function existingOf(components: string[], org: string, notes: string[]): Promise<string[]> {
  const ofType = (type: string) =>
    components.filter((c) => c.startsWith(`${type}:`)).map((c) => c.slice(type.length + 1));
  const found: string[] = [];
  const look = async (type: string, soqlText: string, field: string, key = (n: string) => n) => {
    const wanted = ofType(type);
    if (!wanted.length) return;
    try {
      const have = names(await query(soqlText, org, true), field);
      for (const n of wanted) if (have.has(key(n))) found.push(`${type}:${n}`);
    } catch {
      notes.push(`Couldn't check whether the ${type} already exists in the org.`);
    }
  };
  const lookQuickActions = async () => {
    const wanted = ofType("QuickAction");
    if (!wanted.length) return;
    try {
      const rows = await query(
        `SELECT DeveloperName, EntityDefinition.QualifiedApiName FROM QuickActionDefinition WHERE DeveloperName IN (${wanted.map((n) => soql(n.split(".").pop() ?? n)).join(", ")})`,
        org,
        true
      );
      const have = new Set(
        rows.map(
          (r) =>
            `${String((r.EntityDefinition as Row | undefined)?.QualifiedApiName ?? "")}.${String(r.DeveloperName ?? "")}`
        )
      );
      for (const n of wanted) if (have.has(n)) found.push(`QuickAction:${n}`);
    } catch {
      notes.push("Couldn't check whether the QuickAction already exists in the org.");
    }
  };
  const list = (values: string[]) => values.map(soql).join(", ");
  await Promise.all([
    look(
      "LightningComponentBundle",
      `SELECT DeveloperName FROM LightningComponentBundle WHERE DeveloperName IN (${list(ofType("LightningComponentBundle"))})`,
      "DeveloperName"
    ),
    look(
      "FlexiPage",
      `SELECT DeveloperName FROM FlexiPage WHERE DeveloperName IN (${list(ofType("FlexiPage"))})`,
      "DeveloperName"
    ),
    look(
      "CustomTab",
      `SELECT DeveloperName FROM CustomTab WHERE DeveloperName IN (${list(ofType("CustomTab"))})`,
      "DeveloperName"
    ),
    lookQuickActions(),
  ]);
  return found;
}

export async function planDeploy(input: AppInput, org: string): Promise<AppDeployPlan> {
  const lint = lintApp(input);
  const warnings = lint.issues.filter((i) => i.severity === "warning").map((i) => i.message);
  const errors = lint.issues.filter((i) => i.severity === "error");
  if (errors.length)
    warnings.unshift(
      `Deploy will refuse: ${errors.length} error${errors.length === 1 ? "" : "s"} to fix first — ${errors
        .slice(0, 3)
        .map((e) => e.message)
        .join(" ")}`
    );
  const components = buildAppTree(input).deployed;
  if (input.target === "tab" && !input.tab?.profiles?.length)
    warnings.push(
      "No profile was given, so the tab isn't visible to anyone until a profile shows it."
    );
  const [production, existing] = await Promise.all([
    isProductionOrg(org),
    existingOf(components, org, warnings),
  ]);
  if (existing.length)
    warnings.push(`Already in the org and will be overwritten: ${existing.join(", ")}.`);
  return { components, existing, production, warnings };
}
