/**
 * Tooling API writes for the three metadata types where a `PATCH /tooling/sobjects/<Type>/<Id>`
 * with `{ Metadata }` is exact and several times faster than a Metadata API deploy
 * (compact layout ~11 s -> ~1 s, Lightning page ~4 s -> ~1 s, app ~5 s -> ~1 s):
 * FlexiPage, CompactLayout and CustomApplication. Layouts and profiles are NOT here
 * (Tooling's enum handling and validation differ); they stay on the Metadata API.
 *
 * This is a fast path with a strict contract: it handles one file in CLI source format, and
 * returns `null` — "use the Metadata API deploy" — for anything it isn't sure of: another type
 * or several files, an element it has no schema for (so nothing is ever dropped silently), a
 * managed or namespaced item, an item the org doesn't have yet, a production org, any Tooling
 * error, and a write whose read-back differs from what was sent. A deploy never gets less
 * correct for trying this first; the worst case is the Metadata API deploy plus about a second.
 *
 * Tokens only go where direct.ts sends them (the org's own https instance URL).
 */

import * as fs from "fs";
import * as path from "path";
import { directApiVersion, directEnabled, directGet, directQuery, directToolingPatch, type CredentialFetcher, type DirectOutcome } from "./direct.js";
import type { StatusHook } from "./direct-metadata.js";
import { parseXml, unescapeXml, type XmlNode } from "../studio/metadata/xml.js";

export type ToolingType = "FlexiPage" | "CompactLayout" | "CustomApplication";

/** `LSC_SF_TOOLING_WRITES=0` turns the Tooling write path off. */
export function toolingWritesEnabled(): boolean {
  return process.env.LSC_SF_TOOLING_WRITES !== "0";
}

// --- XML -> Tooling `Metadata` JSON --------------------------------------------------

/** "s" string, "b" boolean, "n" number, [x] array of x, object = nested element. Anything not listed is unsupported. */
type Shape = "s" | "b" | "n" | [Shape] | { [tag: string]: Shape };

class Unsupported extends Error {}

const RULE: Shape = { booleanFilter: "s", criteria: [{ leftValue: "s", operator: "s", rightValue: "s" }] };
const PROPERTY: Shape = { name: "s", type: "s", value: "s", valueList: { valueListItems: [{ value: "s", visibilityRule: RULE }] } };

const SHAPES: Record<ToolingType, { [tag: string]: Shape }> = {
  FlexiPage: {
    description: "s",
    flexiPageRegions: [
      {
        appendable: "s",
        itemInstances: [
          {
            componentInstance: { componentInstanceProperties: [PROPERTY], componentName: "s", identifier: "s", visibilityRule: RULE },
            fieldInstance: { fieldInstanceProperties: [{ name: "s", value: "s" }], fieldItem: "s", identifier: "s", visibilityRule: RULE },
          },
        ],
        mode: "s",
        name: "s",
        prependable: "s",
        replaceable: "s",
        type: "s",
      },
    ],
    masterLabel: "s",
    parentFlexiPage: "s",
    sobjectType: "s",
    template: { name: "s", properties: [{ name: "s", value: "s" }] },
    type: "s",
  },
  CompactLayout: { fields: ["s" as Shape], label: "s" },
  CustomApplication: {
    actionOverrides: [{ actionName: "s", comment: "s", content: "s", formFactor: "s", pageOrSobjectType: "s", skipRecordTypeSelect: "b", type: "s" }],
    brand: { headerColor: "s", logo: "s", logoVersion: "n", shouldOverrideOrgTheme: "b" },
    defaultLandingTab: "s",
    description: "s",
    formFactors: ["s" as Shape],
    isNavAutoTempTabsDisabled: "b",
    isNavPersonalizationDisabled: "b",
    isNavTabPersistenceDisabled: "b",
    isOmniPinnedViewEnabled: "b",
    label: "s",
    navType: "s",
    profileActionOverrides: [{ actionName: "s", content: "s", formFactor: "s", pageOrSobjectType: "s", profile: "s", recordType: "s", type: "s" }],
    setupExperience: "s",
    tabs: ["s" as Shape],
    uiType: "s",
    utilityBar: "s",
    workspaceConfig: { mappings: [{ fieldName: "s", tab: "s" }] },
  },
};

function scalar(node: XmlNode, kind: "s" | "b" | "n"): string | boolean | number {
  if (node.children.length) throw new Unsupported(`<${node.tag}> has elements where text was expected`);
  const text = node.text === undefined ? "" : unescapeXml(node.text);
  // `{[devName:asset]}` file-asset references are expanded to URLs by Tooling: leave them to the deploy.
  if (text.includes("{[")) throw new Unsupported(`<${node.tag}> holds a file-asset reference`);
  if (kind === "b") {
    if (text !== "true" && text !== "false") throw new Unsupported(`<${node.tag}> is not a boolean`);
    return text === "true";
  }
  if (kind === "n") {
    const n = Number(text);
    if (text === "" || !Number.isFinite(n)) throw new Unsupported(`<${node.tag}> is not a number`);
    return n;
  }
  return text;
}

function convertObject(node: XmlNode, shape: { [tag: string]: Shape }): Record<string, unknown> {
  if (node.text !== undefined) throw new Unsupported(`<${node.tag}> has text where elements were expected`);
  const out: Record<string, unknown> = {};
  for (const child of node.children) {
    const spec = shape[child.tag];
    if (spec === undefined) throw new Unsupported(`<${child.tag}> in <${node.tag}> has no Tooling mapping`);
    if (Array.isArray(spec)) {
      const list = (out[child.tag] ??= []) as unknown[];
      list.push(convertValue(child, spec[0]));
    } else {
      if (child.tag in out) throw new Unsupported(`<${child.tag}> appears twice in <${node.tag}>`);
      out[child.tag] = convertValue(child, spec);
    }
  }
  return out;
}

function convertValue(node: XmlNode, shape: Shape): unknown {
  if (shape === "s" || shape === "b" || shape === "n") return scalar(node, shape);
  if (Array.isArray(shape)) throw new Unsupported("nested arrays");
  return convertObject(node, shape);
}

/**
 * The Metadata API file names a custom component bare (`myCmp`); Tooling reads and writes it with the
 * default namespace (`c:myCmp`); the same goes for a custom page template. Standard components always have a namespace (`force:detailPanel`).
 */
function qualifyComponentNames(metadata: Record<string, unknown>): void {
  const template = metadata.template as { name?: string } | undefined;
  if (template && typeof template.name === "string" && template.name !== "" && !template.name.includes(":")) template.name = `c:${template.name}`;
  for (const region of (metadata.flexiPageRegions as { itemInstances?: { componentInstance?: { componentName?: string } }[] }[] | undefined) ?? []) {
    for (const item of region.itemInstances ?? []) {
      const ci = item.componentInstance;
      if (ci && typeof ci.componentName === "string" && ci.componentName !== "" && !ci.componentName.includes(":")) ci.componentName = `c:${ci.componentName}`;
    }
  }
}

/** The whitespace around a value is part of it in the Metadata API but trimmed by the tree reader: leave such files to the deploy. */
const PADDED_TEXT = /(>\s+[^<\s])|([^>\s]\s+<\/)/;

/**
 * The Tooling `Metadata` JSON for a source-format file's XML, or null when anything in it is
 * outside the mapped schema. Exported for tests.
 */
export function xmlToToolingMetadata(type: ToolingType, xml: string): Record<string, unknown> | null {
  try {
    if (PADDED_TEXT.test(xml.replace(/^<\?xml[^>]*\?>/, ""))) return null;
    const root = parseXml(xml);
    const expected = type === "CustomApplication" ? "CustomApplication" : type;
    if (root.tag !== expected) return null;
    const body = { ...root, children: root.children.filter((c) => c.tag !== "fullName") };
    const metadata = convertObject(body, SHAPES[type]);
    if (type === "FlexiPage") qualifyComponentNames(metadata);
    return metadata;
  } catch (e) {
    if (e instanceof Unsupported) return null;
    return null;
  }
}

// --- What a path holds ------------------------------------------------------------------

export interface ToolingTarget {
  type: ToolingType;
  developerName: string;
  /** CompactLayout only: the object it belongs to. */
  sobject?: string;
  file: string;
}

const SUFFIXES: { type: ToolingType; suffix: string }[] = [
  { type: "FlexiPage", suffix: ".flexipage-meta.xml" },
  { type: "CustomApplication", suffix: ".app-meta.xml" },
  { type: "CompactLayout", suffix: ".compactLayout-meta.xml" },
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const SAFE_NAME = /^[A-Za-z0-9_]+$/;

/** The single FlexiPage / CompactLayout / CustomApplication a deploy folder or file holds, else null. */
export function toolingTargetOf(sourcePath: string): ToolingTarget | null {
  let files: string[];
  try {
    files = fs.statSync(sourcePath).isDirectory() ? walk(sourcePath) : [sourcePath];
  } catch {
    return null;
  }
  if (files.length !== 1) return null;
  const file = files[0];
  const base = path.basename(file);
  for (const { type, suffix } of SUFFIXES) {
    if (!base.endsWith(suffix)) continue;
    let name = base.slice(0, -suffix.length);
    try {
      name = decodeURIComponent(name);
    } catch {
      // not encoded
    }
    // Namespaced names ("ns__Page") are managed content: Metadata API only.
    if (!SAFE_NAME.test(name) || name.includes("__")) return null;
    if (type !== "CompactLayout") return { type, developerName: name, file };
    const parts = file.split(path.sep);
    const sobject = parts.at(-3);
    if (parts.at(-2) !== "compactLayouts" || parts.at(-4) !== "objects" || !sobject || !SAFE_NAME.test(sobject)) return null;
    return { type, developerName: name, sobject, file };
  }
  return null;
}

// --- Where Tooling writes are used -------------------------------------------------------

/**
 * Sandboxes, scratch orgs, trials and Developer Edition orgs. Whether Tooling metadata writes are
 * accepted and equivalent in a customer's production org wasn't established, so those keep the
 * Metadata API. Only a definite answer is remembered.
 */
const disposable = new Map<string, boolean>();

async function isDisposableOrg(org: string, fetcher: CredentialFetcher): Promise<boolean> {
  const known = disposable.get(org);
  if (known !== undefined) return known;
  const res = await directQuery("SELECT IsSandbox, TrialExpirationDate, OrganizationType FROM Organization LIMIT 1", org, fetcher, { maxRows: 1 });
  if (!res || !res.ok || !res.data.records.length) return false;
  const rec = res.data.records[0];
  const answer = rec.IsSandbox === true || Boolean(rec.TrialExpirationDate) || rec.OrganizationType === "Developer Edition";
  disposable.set(org, answer);
  return answer;
}

/** Forget what was learned about an org (tests, and after a connection changes). */
export function forgetToolingOrg(org?: string): void {
  if (org) disposable.delete(org);
  else disposable.clear();
}

const soql = (v: string) => `'${v}'`;

async function resolveId(target: ToolingTarget, org: string, fetcher: CredentialFetcher): Promise<string | null> {
  const where =
    target.type === "CompactLayout"
      ? `DeveloperName = ${soql(target.developerName)} AND SobjectType = ${soql(target.sobject!)}`
      : `DeveloperName = ${soql(target.developerName)}`;
  const res = await directQuery(`SELECT Id, NamespacePrefix, ManageableState FROM ${target.type} WHERE ${where}`, org, fetcher, { tooling: true, maxRows: 2 });
  if (!res || !res.ok || res.data.records.length !== 1) return null;
  const rec = res.data.records[0];
  // Managed, installed or standard items are not ours to rewrite this way.
  if (rec.NamespacePrefix || (rec.ManageableState && rec.ManageableState !== "unmanaged")) return null;
  return typeof rec.Id === "string" ? rec.Id : null;
}

/** Tooling answers with every field, null when unset; what we send leaves those out. */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === null || x === undefined) continue;
      if (Array.isArray(x) && x.length === 0) continue;
      const n = normalize(x);
      if (n && typeof n === "object" && !Array.isArray(n) && Object.keys(n).length === 0) continue;
      out[k] = n;
    }
    return out;
  }
  return v;
}

/** Whether the org's `Metadata` holds what was sent (nothing missing, changed or added). Exported for tests. */
export function sameMetadata(sent: unknown, read: unknown): boolean {
  const a = normalize(sent);
  const b = normalize(read);
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)])
    );
  }
  return v;
}

const say = (onStatus: StatusHook | undefined, stateDetail: string) => {
  try {
    onStatus?.({ operation: "deploy", stateDetail });
  } catch {
    // Progress is advisory.
  }
};

/**
 * Write one FlexiPage, CompactLayout or CustomApplication (a source-format file, or a folder
 * holding only it) through the Tooling API. `null` = not handled here, or anything went wrong:
 * the caller deploys through the Metadata API, which gives the same end state and, for a
 * validation error, the same message. Never throws.
 */
export async function toolingWriteMetadata(
  sourcePath: string,
  org: string,
  fetcher: CredentialFetcher,
  onStatus?: StatusHook
): Promise<DirectOutcome<void> | null> {
  try {
    if (!toolingWritesEnabled() || !directEnabled(org)) return null;
    const target = toolingTargetOf(sourcePath);
    if (!target) return null;
    const metadata = xmlToToolingMetadata(target.type, fs.readFileSync(target.file, "utf-8"));
    if (!metadata) return null;
    if (!(await isDisposableOrg(org, fetcher))) return null;
    const id = await resolveId(target, org, fetcher);
    if (!id) return null;
    say(onStatus, "Saving through the Tooling API");
    const patched = await directToolingPatch(target.type, id, metadata, org, fetcher);
    // Refused, timed out or unreachable: the Metadata API deploy decides (and reports validation errors).
    if (!patched || !patched.ok) return null;
    say(onStatus, "Checking what was saved");
    const version = await directApiVersion(org, fetcher);
    const read = await directGet<{ Metadata?: unknown }>(`/services/data/v${version}/tooling/sobjects/${target.type}/${id}`, org, fetcher);
    if (!read || !read.ok || !sameMetadata(metadata, read.data.Metadata)) return null;
    return { ok: true, data: undefined };
  } catch {
    return null;
  }
}
