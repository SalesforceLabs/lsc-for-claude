/**
 * A custom script's LWC bundle: read, write, create and delete its .js.
 *
 * The script record's `CodeText` is copied from the bundle's .js whenever the record is inserted or updated,
 * so saving code means writing the bundle first (here) and touching the record after (save.ts).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { deleteMetadata, deployMetadata, orgApiVersion, retrieveMetadata, updateToolingRecord } from "../../salesforce/cli.js";
import type { StatusHook } from "../../salesforce/direct-metadata.js";
import { query, ID_PATTERN } from "../helpers.js";
import { bundleEditable, type BundleInfo } from "./library.js";

/** Matches the temp SFDX project's API version. */

/** The platform's rule for an LWC folder name: starts lower-case, letters/digits/underscore, no `__`, no trailing `_`. */
export const LWC_NAME = /^[a-z][A-Za-z0-9_]{0,79}$/;

export function lwcNameProblem(name: string): string | null {
  if (!LWC_NAME.test(name)) return "A component name starts with a lower-case letter and has only letters, numbers and underscores.";
  if (name.includes("__")) return "A component name can't contain two underscores in a row.";
  if (name.endsWith("_")) return "A component name can't end with an underscore.";
  return null;
}

export interface BundleFiles {
  bundle: BundleInfo;
  /** The Tooling resource row holding the .js, if it could be found. */
  jsResourceId: string | null;
  js: string | null;
  others: string[];
}

export async function findBundle(org: string, componentName: string): Promise<BundleInfo | null> {
  if (!/^\w+$/.test(componentName)) return null;
  const [row] = await query(
    `SELECT Id, DeveloperName, NamespacePrefix, ManageableState, LastModifiedDate FROM LightningComponentBundle WHERE DeveloperName = '${componentName}'`,
    org,
    true
  );
  if (!row) return null;
  return {
    id: String(row.Id),
    developerName: String(row.DeveloperName),
    namespace: row.NamespacePrefix ? String(row.NamespacePrefix) : null,
    manageableState: row.ManageableState ? String(row.ManageableState) : null,
    lastModifiedDate: row.LastModifiedDate ? String(row.LastModifiedDate) : null,
  };
}

export async function readBundle(org: string, componentName: string): Promise<BundleFiles | null> {
  const bundle = await findBundle(org, componentName);
  if (!bundle) return null;
  const files = await query(`SELECT Id, FilePath, Source FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundle.id}'`, org, true);
  const jsPath = `lwc/${componentName}/${componentName}.js`.toLowerCase();
  let jsResourceId: string | null = null;
  let js: string | null = null;
  const others: string[] = [];
  for (const f of files) {
    const p = String(f.FilePath ?? "");
    if (p.toLowerCase() === jsPath) {
      jsResourceId = String(f.Id);
      js = String(f.Source ?? "");
    } else others.push(p.split("/").pop() ?? p);
  }
  return { bundle, jsResourceId, js, others: others.sort() };
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const bundleMetaXml = (label: string, apiVersion: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${apiVersion}</apiVersion>\n    <isExposed>false</isExposed>\n    <masterLabel>${xmlEscape(label)}</masterLabel>\n</LightningComponentBundle>\n`;

/** Create a bundle holding just the .js, with a temp-directory deploy. */
export async function createBundle(org: string, componentName: string, label: string, code: string, onStatus?: StatusHook): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = lwcNameProblem(componentName);
  if (problem) return { ok: false, error: problem };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-script-bundle-"));
  try {
    const folder = path.join(dir, "lwc", componentName);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${componentName}.js`), code, "utf-8");
    fs.writeFileSync(path.join(folder, `${componentName}.js-meta.xml`), bundleMetaXml(label, await orgApiVersion(org)), "utf-8");
    const res = await (onStatus ? deployMetadata(dir, org, onStatus) : deployMetadata(dir, org));
    return res.success ? { ok: true } : { ok: false, error: res.error ?? "The deploy failed." };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function deleteBundle(org: string, componentName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await deleteMetadata("LightningComponentBundle", componentName, org);
  return res.success ? { ok: true } : { ok: false, error: res.error ?? "The bundle couldn't be deleted." };
}

function findDir(root: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === name && path.basename(path.dirname(full)) === "lwc") return full;
    const found = findDir(full, name);
    if (found) return found;
  }
  return undefined;
}

/** Retrieve the bundle, swap its .js and deploy it back with every other file as it was. */
async function writeByDeploy(org: string, componentName: string, code: string, onStatus?: StatusHook): Promise<{ ok: true } | { ok: false; error: string }> {
  const got = await retrieveMetadata("", `LightningComponentBundle:${componentName}`, org, onStatus);
  if (!got.success || !got.data) return { ok: false, error: `Couldn't read the component: ${got.error ?? "unknown error"}` };
  const root = got.data.outputDir;
  try {
    const folder = fs.existsSync(root) ? findDir(root, componentName) : undefined;
    if (!folder) return { ok: false, error: `${componentName} wasn't found in the org.` };
    fs.writeFileSync(path.join(folder, `${componentName}.js`), code, "utf-8");
    const res = await (onStatus ? deployMetadata(folder, org, onStatus) : deployMetadata(folder, org));
    return res.success ? { ok: true } : { ok: false, error: res.error ?? "The deploy failed." };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export type WriteResult = { ok: true; how: "tooling" | "deploy" } | { ok: false; error: string; blocked?: boolean };

/**
 * Write the .js of an existing bundle. A Tooling PATCH of the resource's Source is tried first (a second or two);
 * when it isn't possible the bundle is retrieved, the .js swapped and the bundle deployed, keeping its other files.
 * Either way the .js is read back and must equal what was sent.
 */
export async function writeBundleJs(org: string, componentName: string, code: string, onStatus?: StatusHook): Promise<WriteResult> {
  const current = await readBundle(org, componentName);
  if (!current) return { ok: false, error: `The component ${componentName} doesn't exist in the org.` };
  if (!bundleEditable(current.bundle)) {
    return { ok: false, blocked: true, error: `${componentName} belongs to a package${current.bundle.namespace ? ` (${current.bundle.namespace})` : ""}, so its code can't be changed here.` };
  }
  let how: "tooling" | "deploy" = "tooling";
  let toolingError: string | null = null;
  if (current.jsResourceId && ID_PATTERN.test(current.jsResourceId)) {
    const patched = await updateToolingRecord("LightningComponentResource", current.jsResourceId, { Source: code }, org);
    if (!patched.success) toolingError = patched.error ?? "The Tooling API refused the write.";
  } else {
    toolingError = "no resource";
  }
  if (toolingError) {
    how = "deploy";
    const deployed = await writeByDeploy(org, componentName, code, onStatus);
    if (!deployed.ok) return deployed;
  }
  const after = await readBundle(org, componentName);
  if (after?.js === null || after?.js === undefined || after.js.trim() !== code.trim()) {
    return { ok: false, error: `The component's code didn't match after saving (${how === "tooling" ? "Tooling write" : "deploy"}).` };
  }
  return { ok: true, how };
}
