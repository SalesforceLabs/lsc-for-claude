/**
 * "Save as source files": write the org's current version of what Studio changed
 * into an sfdx project, so a team that deploys the org from Git doesn't undo the
 * change with its next deploy. The org stays the source of truth — this only
 * retrieves (read-only against the org) and writes local files.
 *
 * Metadata types Studio changes: Layout, CompactLayout, FlexiPage, ListView,
 * CustomApplication, a Profile's layout assignments (for a layout copied for one
 * profile), ValidationRule, and LifeSciConfigRecord (Admin Console records — DB
 * Schema, actions, tabs, settings — `lifeSciConfigRecords/<DeveloperName>`).
 * Everything else Studio changes is data in the org (permission set and territory
 * assignments, PSLs, custom script code, trigger handler switches) and is reported
 * as org-only with why.
 */

import * as fs from "fs";
import * as path from "path";
import { retrieveMetadata } from "../salesforce/cli.js";
import { parseMetadataSpecs } from "../salesforce/direct-metadata.js";
import { inList, query } from "./helpers.js";
import { appsReferencingPage } from "./metadata/live.js";
import { profileFullName } from "./metadata/copy.js";
import { childText, childrenNamed, parseXml, serializeXml, type XmlNode } from "./metadata/xml.js";
import type { StudioFix } from "./types.js";

export type SourceType =
  | "Layout"
  | "CompactLayout"
  | "FlexiPage"
  | "ListView"
  | "CustomApplication"
  | "Profile"
  | "ValidationRule"
  | "LifeSciConfigRecord";

export const SOURCE_TYPES: readonly SourceType[] = [
  "Layout",
  "CompactLayout",
  "FlexiPage",
  "ListView",
  "CustomApplication",
  "Profile",
  "ValidationRule",
  "LifeSciConfigRecord",
];

export interface SourceItem {
  type: SourceType;
  /** Metadata API name: "Account-Account Layout", "Account.Compact", a config record's DeveloperName. */
  fullName: string;
}

export interface OrgOnlyChange {
  label: string;
  why: string;
}

/** What a set of applied changes means for source control, before anything is read. */
export interface SourcePlan {
  /** Documents whose org version goes into the project. */
  items: SourceItem[];
  /** Validation rules switched on/off, known only by Id until looked up. */
  validationRuleIds: string[];
  /** Lightning pages copied for a profile: the apps naming the copy are found at export time. */
  pageCopies: string[];
  /** Deleted in the org: their files should come out of source too. */
  removed: SourceItem[];
  orgOnly: OrgOnlyChange[];
}

export const PACKAGE_XML_PATH = path.join("manifest", "studio-package.xml");
const API_VERSION = "66.0";

const ORG_ONLY = {
  psl: "Permission set license assignments are user records in the org, not source files.",
  access: "Permission set, group and territory assignments are user records in the org, not source files.",
  script: "Custom scripts are records in the org (LifeScienceCustomScript); they have no source file.",
  handler: "Trigger handlers are switched on and off in the org; they have no source file.",
} as const;

/** Why a change has no source file, or null when it has one. Kept equal to the renderer's copy in `source-control.ts` by a test. */
export function orgOnlyReason(fix: StudioFix): string | null {
  switch (fix.kind) {
    case "assignPsl":
    case "removePsl":
      return ORG_ONLY.psl;
    case "assignAccess":
    case "removeAccess":
      return ORG_ONLY.access;
    case "setCustomScriptCode":
      return ORG_ONLY.script;
    case "setActive":
      return fix.record.type === "triggerHandler" ? ORG_ONLY.handler : null;
    default:
      return null;
  }
}

const key = (i: SourceItem) => `${i.type}:${i.fullName}`;

/** The source documents behind applied changes (and any items named directly), deduplicated. */
export function planSourceExport(fixes: StudioFix[], extra: SourceItem[] = []): SourcePlan {
  const items = new Map<string, SourceItem>();
  const removed = new Map<string, SourceItem>();
  const add = (i: SourceItem) => {
    items.set(key(i), i);
    removed.delete(key(i));
  };
  const remove = (i: SourceItem) => {
    removed.set(key(i), i);
    items.delete(key(i));
  };
  const validationRuleIds = new Set<string>();
  const pageCopies = new Set<string>();
  const orgOnly: OrgOnlyChange[] = [];

  for (const fix of fixes) {
    const why = orgOnlyReason(fix);
    if (why) {
      orgOnly.push({ label: fix.label, why });
      continue;
    }
    switch (fix.kind) {
      case "editMetadata":
        add({ type: fix.doc.type, fullName: fix.doc.fullName });
        break;
      case "setLayoutRelatedList":
        add({ type: "Layout", fullName: fix.layoutName });
        break;
      case "copyForProfile": {
        const copy: SourceItem = { type: fix.doc.type, fullName: fix.copy.fullName };
        if (fix.revert) remove(copy);
        else add(copy);
        if (fix.doc.type === "Layout") {
          // Retrieved together, the profile file holds just its assignments to these layouts.
          add({ type: "Layout", fullName: fix.doc.fullName });
          add({ type: "Profile", fullName: profileFullName(fix.profile) });
        } else {
          pageCopies.add(fix.copy.fullName);
          // The undo points the profile back: the apps naming the source page change too.
          if (fix.revert) pageCopies.add(fix.doc.fullName);
        }
        break;
      }
      case "setConfigField":
      case "setProfileAssignments":
        add({ type: "LifeSciConfigRecord", fullName: fix.developerName });
        break;
      case "createConfigRecord":
        add({ type: "LifeSciConfigRecord", fullName: fix.developerName });
        break;
      case "deleteConfigRecord":
        remove({ type: "LifeSciConfigRecord", fullName: fix.developerName });
        break;
      case "setActive":
        if (fix.record.type === "config") add({ type: "LifeSciConfigRecord", fullName: fix.record.developerName });
        else if (fix.record.type === "validationRule") validationRuleIds.add(fix.record.id);
        break;
    }
  }
  for (const i of extra) add(i);
  return {
    items: [...items.values()],
    validationRuleIds: [...validationRuleIds],
    pageCopies: [...pageCopies],
    removed: [...removed.values()],
    orgOnly,
  };
}

const FILE_LAYOUT: Record<SourceType, { dir: string; suffix: string; child?: boolean }> = {
  Layout: { dir: "layouts", suffix: "layout" },
  FlexiPage: { dir: "flexipages", suffix: "flexipage" },
  CustomApplication: { dir: "applications", suffix: "app" },
  Profile: { dir: "profiles", suffix: "profile" },
  LifeSciConfigRecord: { dir: "lifeSciConfigRecords", suffix: "lifeSciConfigRecord" },
  CompactLayout: { dir: "compactLayouts", suffix: "compactLayout", child: true },
  ListView: { dir: "listViews", suffix: "listView", child: true },
  ValidationRule: { dir: "validationRules", suffix: "validationRule", child: true },
};

/** Where an item lives in source format, relative to the package's `main/default`. */
export function sourcePathFor(item: SourceItem): string {
  const f = FILE_LAYOUT[item.type];
  if (!f.child) return path.posix.join(f.dir, `${item.fullName}.${f.suffix}-meta.xml`);
  const dot = item.fullName.indexOf(".");
  if (dot < 1) throw new Error(`${item.type} ${item.fullName} isn't named Object.Name`);
  return path.posix.join("objects", item.fullName.slice(0, dot), f.dir, `${item.fullName.slice(dot + 1)}.${f.suffix}-meta.xml`);
}

/** A package.xml naming the items, types and members sorted as the CLI writes them. */
export function buildPackageXml(items: SourceItem[], version = API_VERSION): string {
  const byType = new Map<string, Set<string>>();
  for (const i of items) {
    if (!byType.has(i.type)) byType.set(i.type, new Set());
    byType.get(i.type)!.add(i.fullName);
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const types = [...byType.keys()].sort().map((type) => {
    const members = [...byType.get(type)!].sort().map((m) => `        <members>${esc(m)}</members>`);
    return ["    <types>", ...members, `        <name>${type}</name>`, "    </types>"].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    ...types,
    `    <version>${version}</version>`,
    "</Package>",
    "",
  ].join("\n");
}

/** The project's default package folder (`force-app` when there's no sfdx-project.json), plus `main/default`. */
export function packageRoot(folder: string): string {
  let pkg = "force-app";
  try {
    const project = JSON.parse(fs.readFileSync(path.join(folder, "sfdx-project.json"), "utf-8")) as {
      packageDirectories?: { path?: string; default?: boolean }[];
    };
    const dirs = project.packageDirectories ?? [];
    const chosen = dirs.find((d) => d.default) ?? dirs[0];
    if (chosen?.path) pkg = chosen.path;
  } catch {
    // No project file: a plain folder gets the standard layout.
  }
  const root = path.resolve(folder, pkg, "main", "default");
  if (!root.startsWith(path.resolve(folder) + path.sep)) throw new Error("The project's package folder is outside the chosen folder.");
  return root;
}

/** The slot a layout assignment fills: one layout per record type, or per object without one. */
const slotOf = (a: XmlNode): string => {
  const rt = childText(a, "recordType");
  return rt ? `rt:${rt}` : `default:${(childText(a, "layout") ?? "").split("-")[0]}`;
};

const assignmentOrder = (a: XmlNode): string => `${childText(a, "layout") ?? ""}\u0000${childText(a, "recordType") ?? ""}`;

/**
 * Merge a retrieved profile (holding only its assignments to the retrieved layouts)
 * into the project's full profile file. Assignments to those layouts, and to the slots
 * (record types) the retrieved ones fill, are replaced; everything else is left as it was.
 */
export function mergeProfileAssignments(existingXml: string, retrievedXml: string, layouts: string[]): string {
  const existing = parseXml(existingXml);
  const fresh = childrenNamed(parseXml(retrievedXml), "layoutAssignments");
  const replaced = new Set(layouts);
  const slots = new Set(fresh.map(slotOf));
  const stays = (c: XmlNode) => !replaced.has(childText(c, "layout") ?? "") && !slots.has(slotOf(c));
  const assignments = [...childrenNamed(existing, "layoutAssignments").filter(stays), ...fresh].sort((a, b) =>
    assignmentOrder(a) < assignmentOrder(b) ? -1 : assignmentOrder(a) > assignmentOrder(b) ? 1 : 0
  );
  // One sorted block, where the old ones were (else in tag order), as the CLI writes it.
  const others = existing.children.filter((c) => c.tag !== "layoutAssignments");
  const at = existing.children.findIndex((c) => c.tag === "layoutAssignments");
  const after = others.findIndex((c) => c.tag > "layoutAssignments");
  const insert = at >= 0 ? at : after < 0 ? others.length : after;
  existing.children = [...others.slice(0, insert), ...assignments, ...others.slice(insert)];
  return serializeXml(existing);
}

/** The object a layout belongs to ("Account-HCP Layout" → "Account"); person account layouts use Account's record types. */
export const layoutObject = (layout: string): string => {
  const object = layout.split("-")[0];
  return object === "PersonAccount" ? "Account" : object;
};

export interface SourceExportInput {
  /** Applied changes (as the tray holds them). */
  changes?: StudioFix[];
  /** Documents to write as they are in the org now. */
  items?: SourceItem[];
  /** Absolute path of the project (or empty folder) to write into. */
  folder: string;
}

export interface SourceFileWritten {
  type: SourceType;
  fullName: string;
  /** Relative to the chosen folder. */
  path: string;
  /** `merged`: only this profile's layout assignments were replaced in the file already there. `partial`: a new profile file holding only those. */
  status: "written" | "merged" | "partial";
}

export interface SourceExportResult {
  folder: string;
  /** Relative to the folder, e.g. "force-app/main/default". */
  packageDir: string;
  /** The manifest written, relative to the folder; null when nothing was written. */
  manifest: string | null;
  files: SourceFileWritten[];
  /** Deleted in the org: delete these from source, or the next deploy puts them back. */
  toRemove: { type: SourceType; fullName: string; path: string; exists: boolean }[];
  orgOnly: OrgOnlyChange[];
  /** Asked for, but the org returned nothing (deleted since, or not readable). */
  missing: SourceItem[];
  notes: string[];
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

/**
 * Retrieve the items into temp folders; direct-capable types and the rest go in separate calls.
 * `recordTypes` ride along with the layouts and profiles (in the CLI's call), since a profile's
 * record-type layout assignments only come back when their record types are retrieved too.
 */
async function retrieveAll(items: SourceItem[], recordTypes: string[], org: string): Promise<{ dirs: string[]; errors: string[] }> {
  const specs = items.map((i) => `${i.type}:${i.fullName}`);
  const withProfile = (s: string) => recordTypes.length > 0 && (s.startsWith("Layout:") || s.startsWith("Profile:"));
  const direct = specs.filter((s) => !withProfile(s) && parseMetadataSpecs([s]));
  const other = [...specs.filter((s) => withProfile(s) || !parseMetadataSpecs([s])), ...recordTypes.map((r) => `RecordType:${r}`)];
  const dirs: string[] = [];
  const errors: string[] = [];
  for (const batch of [direct, other]) {
    if (batch.length === 0) continue;
    const result = await retrieveMetadata("", batch, org);
    if (result.success && result.data) dirs.push(result.data.outputDir);
    else errors.push(result.error ?? "The retrieve failed.");
  }
  return { dirs, errors };
}

async function lookupValidationRules(ids: string[], org: string): Promise<SourceItem[]> {
  if (ids.length === 0) return [];
  const rows = await query(
    `SELECT Id, ValidationName, NamespacePrefix, EntityDefinition.QualifiedApiName FROM ValidationRule WHERE Id IN (${inList(ids)})`,
    org,
    true
  );
  // A managed rule's member name carries its namespace: "ns__Object__c.ns__Rule".
  return rows.map((r) => ({
    type: "ValidationRule" as const,
    fullName: `${(r.EntityDefinition as { QualifiedApiName?: string } | null)?.QualifiedApiName}.${ns(r.NamespacePrefix)}${r.ValidationName}`,
  }));
}

const ns = (prefix: unknown) => (typeof prefix === "string" && prefix ? `${prefix}__` : "");

/** The record types of the layouts' objects ("Account.HCP"), when a profile's assignments are saved. */
async function layoutRecordTypes(items: SourceItem[], org: string): Promise<string[]> {
  if (!items.some((i) => i.type === "Profile")) return [];
  const objects = [...new Set(items.filter((i) => i.type === "Layout").map((i) => layoutObject(i.fullName)))];
  if (objects.length === 0) return [];
  const rows = await query(`SELECT SobjectType, DeveloperName, NamespacePrefix FROM RecordType WHERE SobjectType IN (${inList(objects)})`, org);
  return rows.map((r) => `${r.SobjectType}.${ns(r.NamespacePrefix)}${r.DeveloperName}`);
}

export async function exportSource(input: SourceExportInput, org: string): Promise<SourceExportResult> {
  const folder = path.resolve(input.folder);
  if (!path.isAbsolute(input.folder)) throw new Error("Choose a folder by its full path.");
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`${folder} isn't a folder.`);

  const plan = planSourceExport(input.changes ?? [], input.items ?? []);
  const notes: string[] = [];
  const items = [...plan.items, ...(await lookupValidationRules(plan.validationRuleIds, org))];
  for (const page of plan.pageCopies) {
    const apps = await appsReferencingPage(page, org);
    if (apps) for (const app of apps) if (!items.some((i) => i.type === "CustomApplication" && i.fullName === app)) items.push({ type: "CustomApplication", fullName: app });
    if (!apps) notes.push(`Couldn't tell which apps point at ${page}; save the apps that assign it yourself.`);
  }

  const root = packageRoot(folder);
  const rel = (p: string) => path.relative(folder, p).split(path.sep).join("/");
  const result: SourceExportResult = {
    folder,
    packageDir: rel(root),
    manifest: null,
    files: [],
    toRemove: plan.removed.map((i) => {
      const p = path.join(root, sourcePathFor(i));
      return { type: i.type, fullName: i.fullName, path: rel(p), exists: fs.existsSync(p) };
    }),
    orgOnly: plan.orgOnly,
    missing: [],
    notes,
  };
  if (items.length === 0) return result;

  const { dirs, errors } = await retrieveAll(items, await layoutRecordTypes(items, org), org);
  if (dirs.length === 0) throw new Error(errors.join(" "));
  notes.push(...errors.map((e) => `Some items couldn't be retrieved: ${e}`));

  // Retrieved files by their source-format path relative to the output folder.
  const retrieved = new Map<string, string>();
  for (const dir of dirs) for (const file of filesUnder(dir)) retrieved.set(path.relative(dir, file).split(path.sep).join("/"), file);

  const layoutNames = items.filter((i) => i.type === "Layout").map((i) => i.fullName);
  try {
    for (const item of items) {
      // The CLI may percent-encode a name differently from how it was asked for: compare decoded.
      const want = sourcePathFor(item);
      const sub = retrieved.has(want) ? want : [...retrieved.keys()].find((k) => safeDecode(k) === safeDecode(want));
      const from = sub && retrieved.get(sub);
      if (!sub || !from) {
        result.missing.push(item);
        continue;
      }
      const to = path.join(root, sub);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      let status: SourceFileWritten["status"] = "written";
      if (item.type === "Profile") {
        if (fs.existsSync(to)) {
          fs.writeFileSync(to, mergeProfileAssignments(fs.readFileSync(to, "utf-8"), fs.readFileSync(from, "utf-8"), layoutNames));
          status = "merged";
        } else {
          fs.copyFileSync(from, to);
          status = "partial";
          notes.push(`${rel(to)} holds only this profile's layout assignments; merge it into your full profile file if you keep one elsewhere.`);
        }
      } else fs.copyFileSync(from, to);
      result.files.push({ type: item.type, fullName: item.fullName, path: rel(to), status });
    }
    if (result.files.length > 0) {
      const manifest = path.join(folder, PACKAGE_XML_PATH);
      fs.mkdirSync(path.dirname(manifest), { recursive: true });
      fs.writeFileSync(manifest, buildPackageXml(result.files));
      result.manifest = rel(manifest);
    }
  } finally {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
  return result;
}
