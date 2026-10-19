/**
 * Checks an LSC App as the builder writes it: lint, a real compile with the
 * same build the iPad preview uses, the offline scan, and — when an org is
 * connected — whether DB Schema syncs the objects it reads. Compiles are cached
 * by content, so a repeated check of unchanged files is instant.
 */

import { createHash } from "node:crypto";
import { buildInlineLwc } from "../lwc/compile.js";
import { checkInlineLwc, type InlineLwcCheck } from "../screens/inline-lwc.js";
import { lintApp } from "./lint.js";
import { objectsRead } from "./objects.js";
import { syncedObjectsFor, syncedObjectsOf, type SyncFor } from "./sync.js";
import type { AppCheckResult, AppFile, AppInput, AppIssue } from "./types.js";

interface Compiled {
  script?: string;
  placeholders: string[];
  issues: AppIssue[];
}

const MAX_CACHED = 40;
const compiles = new Map<string, Promise<Compiled>>();

/** `/tmp/lsc-studio-lwc/<key>/org/c/<bundle>/<file>` → `lwc/<bundle>/<file>`. */
function appPath(id: string | undefined, files: AppFile[]): string | undefined {
  if (!id) return undefined;
  const m = /[\\/]org[\\/]c[\\/]([^\\/]+)[\\/]([^\\/]+)$/.exec(id);
  if (m) return `lwc/${m[1]}/${m[2]}`;
  return files.find((f) => id.endsWith(f.path))?.path;
}

/** Drops the build directory from a compiler message, so the model and the user see only app paths. */
function cleanMessage(message: string): string {
  return message
    .replace(/[^\s'"(]*[\\/]org[\\/]c[\\/]([^\\/\s'")]+)[\\/]([^\\/\s'")]+)/g, "lwc/$1/$2")
    .replace(/[^\s'"(]*lsc-studio-lwc[^\s'")]*/g, "the build")
    .replace(/^\[plugin [^\]]+\]\s*/, "")
    .trim();
}

/** Turns what rollup / the LWC compiler threw into an issue with file and line. */
export function compileIssue(err: unknown, files: AppFile[]): AppIssue {
  const e = (err ?? {}) as { message?: string; loc?: { file?: string; line?: number }; location?: { line?: number }; id?: string; code?: string; frame?: string; filename?: string; line?: number };
  const raw = typeof e.message === "string" ? e.message : String(err);
  const path = appPath(e.loc?.file ?? e.id ?? e.filename, files);
  const fromMessage = /\((\d+):\d+\)/.exec(raw)?.[1];
  const line = e.loc?.line ?? e.location?.line ?? e.line ?? (fromMessage ? Number(fromMessage) : undefined);
  let message = cleanMessage(raw);
  let fix = "Fix the error at that line; the message says what the compiler expected.";
  const unresolved = /Could not resolve ["']?([^"'\s]+)["']?/.exec(raw) ?? /Failed to resolve (?:import|entry)[^"']*["']([^"']+)["']/.exec(raw);
  if (e.code === "UNRESOLVED_IMPORT" || unresolved) {
    const mod = unresolved?.[1] ?? "an import";
    message = `The import "${mod}" can't be resolved.`;
    fix = mod.startsWith("c/") ? `Provide a bundle named ${mod.slice(2)} (lwc/${mod.slice(2)}/${mod.slice(2)}.js, .html, .js-meta.xml) or remove the import.` : `"${mod}" isn't a module available to LSC apps; use only lightning/* base modules and @salesforce/* imports the guide lists.`;
  } else if (/LWC1\d{3}/.test(raw) && /key/i.test(raw)) {
    fix = "Add a unique key={…} to the element inside the for:each template.";
  } else if (/Unexpected token|Unexpected character/i.test(raw)) {
    fix = "A syntax error: check for a missing brace, comma or quote on or just before that line.";
  }
  return { severity: "error", rule: "compile", message, ...(path ? { path } : {}), ...(line ? { line } : {}), fix };
}

function compileApp(input: AppInput): Promise<Compiled> {
  const key = createHash("sha256").update(JSON.stringify([input.name, input.files.map((f) => [f.path, f.source])])).digest("hex");
  let job = compiles.get(key);
  if (!job) {
    job = buildInlineLwc(input.name, input.files).then(
      ({ script, placeholders }): Compiled => ({ script, placeholders, issues: [] }),
      (err): Compiled => ({ placeholders: [], issues: [compileIssue(err, input.files)] })
    );
    compiles.set(key, job);
    if (compiles.size > MAX_CACHED) compiles.delete(compiles.keys().next().value as string);
  }
  return job;
}

function offlineIssues(offline: InlineLwcCheck): AppIssue[] {
  return offline.issues.map((i): AppIssue => {
    const where = i.bundle ? ` (in ${i.bundle})` : "";
    if (i.kind === "apex") return { severity: "warning", rule: "offline.apex", message: `Apex (${i.detail})${where} needs the network on the iPad; it fails offline.`, fix: "Read the data with a GraphQL wire (lightning/uiGraphQLApi) or getRecord so it works offline." };
    if (i.kind === "adapter") return { severity: "warning", rule: "offline.adapter", message: `${i.detail}${where} isn't answered offline on the iPad.`, fix: "Use a graphql wire or getRecord instead." };
    if (i.kind === "graphql") return { severity: "info", rule: "offline.graphql-gated", message: `GraphQL${where} works offline only when the org has offline GraphQL enabled (Winter '27).`, fix: "Nothing to change; tell the user to check Admin Console > Mobile > Application Settings." };
    if (i.kind === "network") return { severity: "warning", rule: "offline.network", message: `${i.detail}${where} needs the network on the iPad.`, fix: "Use data the UI API / GraphQL adapters return instead of calling out." };
    return { severity: "warning", rule: "offline.component", message: `<${i.detail}>${where} needs the network on the iPad.`, fix: "Draw it with plain markup instead." };
  });
}

/** Lint + compile + offline scan + DB Schema sync check of an app. Works without an org (sync is then unknown). */
export async function checkApp(input: AppInput, org?: string, who: SyncFor = {}): Promise<AppCheckResult> {
  const lint = lintApp(input);
  const issues: AppIssue[] = [...lint.issues];

  const [compiled, offline, synced] = await Promise.all([
    compileApp(input),
    checkInlineLwc(input.name, async (bundles) => input.files.filter((f) => bundles.includes(f.bundle))),
    org ? (who.userId || who.profile ? syncedObjectsFor(org, who) : syncedObjectsOf(org)) : Promise.resolve(null),
  ]);

  // A compile error that lint already explained (a missing child, for one) would only repeat it.
  for (const i of compiled.issues) if (!(i.fix?.startsWith("Provide a bundle") && issues.some((x) => x.rule === "child.unresolved"))) issues.push(i);
  issues.push(...offlineIssues(offline));
  for (const p of compiled.placeholders) {
    issues.push({ severity: "info", rule: "preview.placeholder", message: `<lightning-${p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}> isn't available in Studio's preview, so it's drawn as a placeholder here (it may work on the iPad).`, fix: "Prefer base components Studio can draw (button, icon, input, badge, spinner) or plain markup." });
  }

  const names = objectsRead(input.files, input.target === "record" ? input.objectApiName : undefined);
  const objects = names.map((name) => ({ name, synced: synced ? synced.has(name) : null }));
  for (const o of objects) {
    if (o.synced === false) {
      issues.push({
        severity: "warning",
        rule: "sync.not-synced",
        message: `${o.name} isn't in an active DB Schema record${who.userId || who.profile ? ` that reaches ${who.profile ?? "that user's profile"}` : ""}, so the iPad has no ${o.name} records offline and the app would show nothing there.`,
        fix: `Tell the user to add ${o.name} to iPad sync (Studio > Mobile Sync > Add to iPad sync). Don't change the code for this.`,
      });
    }
  }

  const ok = !!compiled.script && !issues.some((i) => i.severity === "error");
  return {
    ok,
    issues,
    offline,
    ...(compiled.script ? { script: compiled.script } : {}),
    placeholders: compiled.placeholders,
    ...(lint.mobileHeight !== undefined ? { mobileHeight: lint.mobileHeight } : {}),
    objects,
  };
}
