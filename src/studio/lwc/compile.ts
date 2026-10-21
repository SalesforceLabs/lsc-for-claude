/**
 * Compiles an org's inline LWC (lscMobileInline_*) with the `c/` bundles it
 * uses into one script Studio's iPad preview runs in a sandboxed frame. Base
 * components come from lightning-base-components; LDS, navigation and other
 * platform modules from the stand-ins in ./shims.ts, which ask the frame's
 * host for data.
 */

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { inList, query, type Row } from "../helpers.js";
import { checkInlineLwc, type InlineLwcCheck, type LwcFile } from "../screens/inline-lwc.js";
import { placeholderComponent, salesforceFallback, salesforceModule, SHIM_FILES, SHIMMED_LIGHTNING } from "./shims.js";
import { privateTmp } from "../../private-tmp.js";

export interface CompiledInlineLwc {
  name: string;
  /** IIFE that mounts the component in `#root`; reads `globalThis.__studioContext`. */
  script: string;
  /** Bundles compiled: the component and the `c/` bundles it uses. */
  bundles: string[];
  /** Base components drawn as placeholders because Studio doesn't have them. */
  placeholders: string[];
  check: InlineLwcCheck;
}

/** Bump when the shims or the build change, so cached scripts are rebuilt. */
const BUILD_VERSION = 5;
const MAX_CACHED = 30;
const cache = new Map<string, Promise<CompiledInlineLwc>>();

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** `lightning/foo` / `<lightning-foo-bar>` names in a set of sources. */
function lightningNames(sources: string[]): { modules: Set<string>; tags: Set<string> } {
  const modules = new Set<string>();
  const tags = new Set<string>();
  for (const s of sources) {
    for (const m of s.matchAll(/["']lightning\/(\w+)["']/g)) modules.add(m[1]);
    for (const m of s.matchAll(/<lightning-([a-z0-9-]+)[\s>/]/g)) tags.add(m[1].replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()));
  }
  return { modules, tags };
}

type ModuleRecord = { dir: string } | { name: string; path: string };

/** A package's `lwc.modules` with absolute paths (the build runs outside node_modules, where `{ npm }` records can't resolve). */
function packageModules(pkg: string): ModuleRecord[] {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const root = path.dirname(pkgJson);
  const modules = (require(pkgJson) as { lwc?: { modules?: ModuleRecord[] } }).lwc?.modules ?? [];
  return modules.map((m) => ("dir" in m ? { dir: path.join(root, m.dir) } : { name: m.name, path: path.join(root, m.path) }));
}

let baseNames: Set<string> | undefined;
async function baseComponents(): Promise<Set<string>> {
  if (baseNames) return baseNames;
  const { readdir } = await import("node:fs/promises");
  const src = packageModules("lightning-base-components").find((m): m is { dir: string } => "dir" in m);
  baseNames = new Set(src ? await readdir(path.join(src.dir, "lightning")) : []);
  return baseNames;
}

export async function loadBundles(org: string, bundles: string[]): Promise<LwcFile[]> {
  const valid = bundles.filter((b) => /^\w+$/.test(b));
  if (!valid.length) return [];
  const rows = await query(`SELECT LightningComponentBundle.DeveloperName, FilePath, Source FROM LightningComponentResource WHERE LightningComponentBundle.DeveloperName IN (${inList(valid)})`, org, true);
  return rows.map((r: Row) => ({ bundle: str((r.LightningComponentBundle as Row | undefined)?.DeveloperName), path: str(r.FilePath), source: str(r.Source) }));
}

/** Custom labels the sources import (`@salesforce/label/c.X`), from the org's ExternalString. */
async function loadLabels(org: string, files: LwcFile[]): Promise<Record<string, string>> {
  const names = new Set<string>();
  for (const f of files) for (const m of f.source.matchAll(/["']@salesforce\/label\/c\.(\w+)["']/g)) names.add(m[1]);
  if (!names.size) return {};
  const rows = await query(`SELECT Name, Value FROM ExternalString WHERE Name IN (${inList([...names])})`, org, true).catch(() => [] as Row[]);
  return Object.fromEntries(rows.map((r) => [str(r.Name), str(r.Value)]));
}

/** Where a bundle file goes under the `c` namespace root: `lwc/x/x.js` → `c/x/x.js`. */
function orgFilePath(f: LwcFile): string | null {
  const rel = f.path.replace(/^lwc\//, "");
  const parts = rel.split("/");
  if (parts[0] !== f.bundle || parts.some((p) => !p || p === "." || p === "..") || !/^[\w.-]+$/.test(parts[parts.length - 1])) return null;
  return path.join("c", ...parts);
}

async function writeTree(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, source] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
  }
}

/** Builds the script from bundle files already read (exported for tests). */
export async function buildInlineLwc(name: string, files: LwcFile[], labels: Record<string, string> = {}): Promise<{ script: string; placeholders: string[] }> {
  const [{ rollup }, { default: lwc }] = await Promise.all([import("rollup"), import("@lwc/rollup-plugin")]);
  const key = createHash("sha256")
    .update(JSON.stringify([BUILD_VERSION, name, files, labels]))
    .digest("hex")
    .slice(0, 16);
  // apps/check.ts finds "lsc-studio-lwc" in compiler messages to hide the build folder.
  const dir = path.join(privateTmp("lsc-studio-lwc"), key);
  const base = await baseComponents();
  const { modules, tags } = lightningNames(files.map((f) => f.source));
  const missing = [...new Set([...modules, ...tags])].filter((n) => !base.has(n) && !SHIMMED_LIGHTNING.has(n)).sort();
  const placeholders = missing.filter((n) => tags.has(n));

  const shimFiles: Record<string, string> = { ...SHIM_FILES };
  for (const n of placeholders) Object.assign(shimFiles, placeholderComponent(n));
  const orgFiles: Record<string, string> = {};
  for (const f of files) {
    const rel = orgFilePath(f);
    if (rel && !rel.endsWith(".js-meta.xml")) orgFiles[rel] = f.source;
  }
  const entry = path.join(dir, "entry.js");
  await rm(dir, { recursive: true, force: true });
  // A failed write would otherwise leave a half-written folder behind (the finally below comes later).
  try {
    await writeTree(path.join(dir, "shims"), shimFiles);
    await writeTree(path.join(dir, "org"), orgFiles);
    // The LWC module resolver looks upward from each importer for a package root.
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "studio-inline-lwc", private: true, lwc: { modules: [] } }));
    await writeFile(
      entry,
      `import "@lwc/synthetic-shadow";
import { createElement } from "lwc";
import { context } from "lightning/studioBridge";
import Component from "c/${name}";

const ctx = context();
const el = createElement("c-studio-preview", { is: Component });
if (ctx.recordId) el.recordId = ctx.recordId;
if (ctx.objectApiName) el.objectApiName = ctx.objectApiName;
document.getElementById("root").appendChild(el);
`
    );
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }

  const salesforce = (fallback: boolean) => ({
    name: fallback ? "studio-salesforce-fallback" : "studio-salesforce",
    resolveId(id: string) {
      if (!id.startsWith("@salesforce/")) return null;
      if (fallback || salesforceModule(id, labels) !== null) return "\0studio:" + id;
      return null;
    },
    load(id: string) {
      if (!id.startsWith("\0studio:")) return null;
      const sf = id.slice("\0studio:".length);
      return salesforceModule(sf, labels) ?? salesforceFallback(sf);
    },
  });
  // Lightning modules nobody has: empty exports, so the rest of the component still runs.
  const missingLightning = {
    name: "studio-missing-lightning",
    resolveId(id: string) {
      return /^lightning\/\w+$/.test(id) ? "\0studio-missing:" + id : null;
    },
    load(id: string) {
      return id.startsWith("\0studio-missing:") ? "export default undefined;\n" : null;
    },
  };

  // Base components branch on `import.meta.env.SSR`, which an IIFE has no value for.
  const importMeta = {
    name: "studio-import-meta",
    resolveImportMeta(property: string | null) {
      return property === "env" ? `{ SSR: false, NODE_ENV: "production" }` : property === null ? `{ env: { SSR: false } }` : "undefined";
    },
  };

  let bundle: Awaited<ReturnType<typeof rollup>> | undefined;
  try {
    bundle = await rollup({
      input: entry,
      shimMissingExports: true,
      onwarn: () => {},
      plugins: [
        salesforce(false),
        lwc({
          rootDir: path.join(dir, "org"),
          modules: [{ dir: path.join(dir, "shims") }, { dir: path.join(dir, "org") }, ...packageModules("lightning-base-components")],
          defaultModules: [...packageModules("@lwc/engine-dom"), ...packageModules("@lwc/synthetic-shadow")],
          enableDynamicComponents: true,
          experimentalDynamicDirective: true,
          // The platform accepts ternaries and the like in templates (complex template expressions).
          experimentalComplexExpressions: true,
          // Org components were written for Lightning Locker / LWS, not this build's strict checks.
          apiVersion: 66,
        } as Parameters<typeof lwc>[0]),
        salesforce(true),
        missingLightning,
        importMeta,
      ],
    });
    const { output } = await bundle.generate({ format: "iife", banner: `var process = { env: { NODE_ENV: "production" } };`, inlineDynamicImports: true });
    return { script: output[0].code, placeholders };
  } finally {
    await bundle?.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** Compiles `name` from the org, once per org and source version for the server's lifetime. */
export async function compileInlineLwc(org: string, name: string): Promise<CompiledInlineLwc> {
  if (!/^\w+$/.test(name)) throw new Error(`Not a component name: ${name}`);
  const read: LwcFile[] = [];
  const load = async (bundles: string[]) => {
    const files = await loadBundles(org, bundles);
    read.push(...files);
    return files;
  };
  const check = await checkInlineLwc(name, load);
  if (!check.bundles.includes(name)) throw new Error(`The org has no Lightning web component named ${name}.`);
  const labels = await loadLabels(org, read);
  const key = createHash("sha256").update(JSON.stringify([org, name, read, labels])).digest("hex");
  let job = cache.get(key);
  if (job) {
    // Most recently used goes last, so the oldest is the one evicted.
    cache.delete(key);
    cache.set(key, job);
  } else {
    job = buildInlineLwc(name, read, labels).then(({ script, placeholders }) => ({ name, script, bundles: check.bundles, placeholders, check }));
    cache.set(key, job);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    job.catch(() => cache.delete(key));
  }
  return job;
}
