/**
 * The `copyForProfile` fix: preview, apply and undo.
 *
 * Applying creates the copy (the source document plus the edits queued for it),
 * then points only the profile at it: a page layout through the profile's
 * `layoutAssignments`, a Lightning page through the apps' `profileActionOverrides`.
 * Only the entries that move are deployed (a Profile holding just those
 * assignments; the retrieved app file with its overrides changed). When the
 * reassignment fails the copy is deleted again. Undo points the profile back,
 * then deletes the copy. Previews re-read the org and refuse when the source,
 * the profile's assignments or the copy's name no longer match.
 */

import * as fs from "fs";
import * as path from "path";
import { deleteMetadata, deployMetadata, retrieveMetadata } from "../../salesforce/cli.js";
import { PUBLISH_WARNING } from "../change-helpers.js";
import { lineDiff } from "../diff.js";
import { query } from "../helpers.js";
import type { CopyForProfileFix, CopyMove, FixPreview, FixResult, FlexiPageOp, LayoutOp } from "../types.js";
import { discardDoc, retrieveDocs, withDoc, type MetadataDoc } from "./doc.js";
import type { FixTracker } from "../fix-progress.js";
import {
  isFlexiPageName,
  layoutAssignmentFile,
  layoutAssignmentsOf,
  profileFullName,
  reassignLayout,
  reassignPage,
  restorePage,
} from "./copy.js";
import { applyFlexiPageOps, StaleFlexiPageError } from "./flexipage-ops.js";
import { applyLayoutOps, StaleLayoutError } from "./layout-ops.js";
import { assignmentsCache, isProductionOrg } from "./live.js";
import { parseXml, serializeXml, setChildText, type XmlNode } from "./xml.js";

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const rtLabel = (rt: string | null | undefined) => (rt ? `Record type ${rt.slice(rt.indexOf(".") + 1)}` : "Default (no record type)");

interface AppFile {
  name: string;
  filePath: string;
  xml: string;
  root: XmlNode;
}

function appFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? appFiles(full) : e.name.endsWith(".app-meta.xml") ? [full] : [];
  });
}

/** Every CustomApplication of the org, retrieved into a folder that is removed afterwards. */
async function withApps<T>(org: string, fn: (apps: AppFile[]) => Promise<T>, progress?: FixTracker): Promise<T> {
  progress?.begin("apps");
  const result = await retrieveMetadata("", "CustomApplication", org, progress?.statusHook("apps"));
  if (!result.success || !result.data) throw new Error(`Couldn't retrieve the apps: ${result.error ?? "unknown error"}`);
  const { outputDir } = result.data;
  try {
    const apps = appFiles(outputDir).map((filePath) => {
      const xml = fs.readFileSync(filePath, "utf-8");
      return { name: path.basename(filePath).replace(/\.app-meta\.xml$/, ""), filePath, xml, root: parseXml(xml) };
    });
    progress?.end("apps");
    return await fn(apps);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function exists(type: "Layout" | "FlexiPage", fullName: string, org: string): Promise<boolean> {
  if (type === "FlexiPage") {
    return (await query(`SELECT Id FROM FlexiPage WHERE DeveloperName = ${soqlString(fullName)}`, org, true)).length > 0;
  }
  const name = decodeURIComponent(fullName.slice(fullName.indexOf("-") + 1));
  return (await query(`SELECT Id FROM Layout WHERE Name = ${soqlString(name)}`, org, true)).length > 0;
}

/** What a fix is allowed to name, checked before anything is retrieved. */
function validate(fix: CopyForProfileFix): string | null {
  const { doc, copy } = fix;
  if (doc.type === "Layout") {
    if (!/^[^\r\n:\\/]+-[^\r\n:\\/]+$/.test(doc.fullName) || !/^[^\r\n:\\/]+-[^\r\n:\\/]+$/.test(copy.fullName)) return "Invalid layout name.";
    if (doc.fullName.slice(0, doc.fullName.indexOf("-")) !== copy.fullName.slice(0, copy.fullName.indexOf("-"))) {
      return "The copy must be for the same object.";
    }
  } else if (!/^\w+$/.test(doc.fullName) || !isFlexiPageName(copy.fullName)) return "Invalid Lightning page name.";
  if (doc.fullName === copy.fullName) return "The copy needs a name of its own.";
  if (!fix.profile.trim() || /[\r\n]/.test(fix.profile)) return "Invalid profile name.";
  return null;
}

const base = (fix: CopyForProfileFix, org: string): FixPreview => ({ org, title: fix.label, changes: [], warnings: [] });
const blocked = (preview: FixPreview, why: string) => ({ preview: { ...preview, blocked: why } });

/** Everything an apply needs once the preview is clean. */
interface Plan {
  preview: FixPreview;
  moves?: CopyMove[];
  /** Layout create: the copy, and the profile file holding just the moved assignments. */
  layout?: { copyPath: string; copyXml: string; profilePath: string; profileXml: string };
  /** Lightning page create or undo: the page copy, and the app files whose overrides change. */
  page?: { copyPath: string; copyXml: string; apps: { file: AppFile; xml: string }[] };
}

// --- Page layouts ------------------------------------------------------------------------------

async function planLayoutCreate(fix: CopyForProfileFix, org: string, layout: MetadataDoc, profile: MetadataDoc): Promise<Plan> {
  const preview = base(fix, org);
  const [source, copy] = [fix.doc.fullName, fix.copy.fullName];
  let root = layout.root;
  let opChanges: ReturnType<typeof applyLayoutOps>["changes"] = [];
  if (fix.ops?.length) {
    try {
      const r = applyLayoutOps(layout.root, fix.ops as LayoutOp[]);
      root = r.root;
      opChanges = r.changes;
    } catch (e) {
      if (!(e instanceof StaleLayoutError)) throw e;
      return blocked(preview, `${fix.doc.label} changed since the preview was loaded: ${e.message} Refresh the preview.`);
    }
  }
  const assigned = layoutAssignmentsOf(profile.root, source);
  if (!assigned.length) {
    return blocked(
      preview,
      `${fix.profile} isn't assigned ${fix.doc.label} in the org any more (or never was, directly), so a copy wouldn't change what it sees. Refresh the preview.`
    );
  }
  if (await exists("Layout", copy, org)) return blocked(preview, `A page layout named “${fix.copy.label}” already exists. Take this copy out of the tray and make it again.`);

  const { moves } = reassignLayout(profile.root, source, copy);
  const copyXml = serializeXml(root);
  // Short record and field names: the table keeps its first two columns on one line.
  preview.changes.push({
    target: "Page layout",
    field: "New copy",
    before: "(doesn't exist yet)",
    after: `${fix.copy.label}: a copy of ${fix.doc.label}${fix.ops?.length ? " with your edits" : ""}`,
    ...(fix.ops?.length ? { diff: lineDiff(layout.xml, copyXml) } : {}),
  });
  for (const c of opChanges) preview.changes.push({ target: "Copy", ...c });
  for (const m of moves) preview.changes.push({ target: fix.profile, field: `Layout · ${rtLabel(m.recordType)}`, before: fix.doc.label, after: fix.copy.label });
  preview.warnings.push(
    `Creates the page layout “${fix.copy.label}” and moves only ${fix.profile} to it (${moves.length} ${moves.length === 1 ? "assignment" : "assignments"}). Every other profile keeps “${fix.doc.label}”.`,
    `From now on, changes to “${fix.doc.label}” don't reach ${fix.profile}; edit “${fix.copy.label}” instead.`,
    PUBLISH_WARNING
  );
  if (await isProductionOrg(org)) preview.production = true;
  const dir = path.dirname(layout.filePath);
  return {
    preview,
    moves,
    layout: {
      copyPath: path.join(dir, `${copy}.layout-meta.xml`),
      copyXml,
      profilePath: profile.filePath,
      profileXml: serializeXml(layoutAssignmentFile(profile.root, copy, moves)),
    },
  };
}

async function planLayoutRevert(fix: CopyForProfileFix, org: string, profile: MetadataDoc): Promise<Plan> {
  const preview = base(fix, org);
  const wanted = fix.revert!.moves.map((m) => m.recordType ?? null);
  const have = layoutAssignmentsOf(profile.root, fix.copy.fullName);
  if (!wanted.length || wanted.some((rt) => !have.includes(rt))) {
    return blocked(preview, `${fix.profile}'s layout assignments changed since the copy was made, so they can't be put back safely. Reassign them in Setup.`);
  }
  const { moves } = reassignLayout(profile.root, fix.copy.fullName, fix.doc.fullName, wanted);
  for (const m of moves) preview.changes.push({ target: fix.profile, field: `Layout · ${rtLabel(m.recordType)}`, before: fix.copy.label, after: fix.doc.label });
  preview.changes.push({ target: "Page layout", field: "Copy", before: fix.copy.label, after: "Deleted" });
  preview.warnings.push(`Points ${fix.profile} back at “${fix.doc.label}” and deletes the copy “${fix.copy.label}”, including any edits made to it.`, PUBLISH_WARNING);
  if (await isProductionOrg(org)) preview.production = true;
  return {
    preview,
    moves,
    layout: { copyPath: "", copyXml: "", profilePath: profile.filePath, profileXml: serializeXml(layoutAssignmentFile(profile.root, fix.doc.fullName, moves)) },
  };
}

async function withLayoutDocs<T>(fix: CopyForProfileFix, org: string, fn: (layout: MetadataDoc, profile: MetadataDoc) => Promise<T>, progress?: FixTracker): Promise<T> {
  progress?.begin("retrieve");
  const layoutName = fix.revert ? fix.copy.fullName : fix.doc.fullName;
  const [layout, profile] = await retrieveDocs(
    [
      { type: "Layout", fullName: layoutName },
      { type: "Profile", fullName: profileFullName(fix.profile) },
    ],
    org,
    progress?.statusHook("retrieve")
  );
  progress?.end("retrieve");
  try {
    return await fn(layout, profile);
  } finally {
    discardDoc(layout);
  }
}

// --- Lightning pages ------------------------------------------------------------------------------

async function planPage(fix: CopyForProfileFix, org: string, page: MetadataDoc | null, apps: AppFile[]): Promise<Plan> {
  const preview = base(fix, org);
  const [source, copy] = [fix.doc.fullName, fix.copy.fullName];
  const changedApps: { file: AppFile; xml: string }[] = [];
  const moves: CopyMove[] = [];

  if (fix.revert) {
    for (const m of fix.revert.moves) {
      const app = apps.find((a) => a.name === m.app);
      const r = app && restorePage(app.root, fix.profile, copy, source, !!m.added);
      if (!app || !r?.changed) {
        return blocked(preview, `${fix.profile}'s page overrides in ${m.app ?? "an app"} changed since the copy was made, so they can't be put back safely. Reassign them in Setup.`);
      }
      changedApps.push({ file: app, xml: serializeXml(r.root) });
      moves.push(m);
      preview.changes.push({ target: fix.profile, field: `Page in ${m.app}`, before: fix.copy.label, after: m.added ? `${fix.doc.label} (the app's default)` : fix.doc.label });
    }
    preview.changes.push({ target: "Lightning page", field: "Copy", before: fix.copy.label, after: "Deleted" });
    preview.warnings.push(`Points ${fix.profile} back at “${fix.doc.label}” and deletes the copy “${fix.copy.label}”, including any edits made to it.`, PUBLISH_WARNING);
    if (await isProductionOrg(org)) preview.production = true;
    return { preview, moves, page: { copyPath: "", copyXml: "", apps: changedApps } };
  }

  let root = page!.root;
  let opChanges: ReturnType<typeof applyFlexiPageOps>["changes"] = [];
  if (fix.ops?.length) {
    try {
      const r = applyFlexiPageOps(page!.root, fix.ops as FlexiPageOp[]);
      root = r.root;
      opChanges = r.changes;
    } catch (e) {
      if (!(e instanceof StaleFlexiPageError)) throw e;
      return blocked(preview, `${fix.doc.label} changed since the preview was loaded: ${e.message} Refresh the preview.`);
    }
  }
  for (const app of apps) {
    const r = reassignPage(app.root, fix.profile, source, copy);
    if (!r.move) continue;
    changedApps.push({ file: app, xml: serializeXml(r.root) });
    moves.push({ ...r.move, app: app.name });
    preview.changes.push({
      target: fix.profile,
      field: `Page in ${app.name}`,
      before: r.move.added ? `${fix.doc.label} (the app's default)` : fix.doc.label,
      after: fix.copy.label,
    });
  }
  if (!moves.length) {
    return blocked(
      preview,
      `No app gives ${fix.profile} ${fix.doc.label} (it may be an object's or the org's default page), so there's nothing to point at a copy. Assign the page to an app in Lightning App Builder first.`
    );
  }
  if (await exists("FlexiPage", copy, org)) return blocked(preview, `A Lightning page named ${copy} already exists. Take this copy out of the tray and make it again.`);

  const copyRoot = parseXml(serializeXml(root));
  setChildText(copyRoot, "masterLabel", fix.copy.label, ["masterLabel"]);
  const copyXml = serializeXml(copyRoot);
  preview.changes.unshift({
    target: "Lightning page",
    field: "New copy",
    before: "(doesn't exist yet)",
    after: `${fix.copy.label}: a copy of ${fix.doc.label}${fix.ops?.length ? " with your edits" : ""}`,
    ...(fix.ops?.length ? { diff: lineDiff(page!.xml, copyXml) } : {}),
  });
  preview.changes.splice(1, 0, ...opChanges.map((c) => ({ target: "Copy", ...c })));
  const added = moves.filter((m) => m.added).length;
  preview.warnings.push(
    `Creates the Lightning page “${fix.copy.label}” and points only ${fix.profile} at it in ${moves.length} ${moves.length === 1 ? "app" : "apps"}. Every other profile keeps “${fix.doc.label}”.`,
    ...(added ? [`${added} of those apps had no page of their own for ${fix.profile}; each gets a new override for ${fix.profile} only.`] : []),
    `From now on, changes to “${fix.doc.label}” don't reach ${fix.profile}; edit “${fix.copy.label}” instead.`,
    PUBLISH_WARNING
  );
  if (await isProductionOrg(org)) preview.production = true;
  return { preview, moves, page: { copyPath: path.join(path.dirname(page!.filePath), `${copy}.flexipage-meta.xml`), copyXml, apps: changedApps } };
}

// --- Preview and apply ------------------------------------------------------------------------------

/** Plan one step of "diff" bookkeeping around a planner. */
async function planning<T>(progress: FixTracker | undefined, fn: () => Promise<T>): Promise<T> {
  progress?.begin("diff");
  const result = await fn();
  progress?.end("diff");
  return result;
}

async function plan(fix: CopyForProfileFix, org: string, progress?: FixTracker): Promise<Plan> {
  const invalid = validate(fix);
  if (invalid) return blocked(base(fix, org), invalid);
  if (fix.doc.type === "Layout") {
    return withLayoutDocs(
      fix,
      org,
      (layout, profile) => planning(progress, () => (fix.revert ? planLayoutRevert(fix, org, profile) : planLayoutCreate(fix, org, layout, profile))),
      progress
    );
  }
  if (fix.revert) return withApps(org, (apps) => planning(progress, () => planPage(fix, org, null, apps)), progress);
  progress?.begin("retrieve");
  return withDoc(
    "FlexiPage",
    fix.doc.fullName,
    org,
    (page) => {
      progress?.end("retrieve");
      return withApps(org, (apps) => planning(progress, () => planPage(fix, org, page, apps)), progress);
    },
    progress?.statusHook("retrieve")
  );
}

export async function previewCopy(fix: CopyForProfileFix, org: string, progress?: FixTracker): Promise<FixPreview> {
  try {
    return (await plan(fix, org, progress)).preview;
  } catch (e) {
    return { ...base(fix, org), blocked: e instanceof Error ? e.message : String(e) };
  }
}

const errorOf = (r: { error?: string }) => r.error || "unknown error";

/** Create the copy and point the profile at it (or, for an undo, the reverse). Plans inside the retrieve, so the files it deploys are still there. */
export async function applyCopy(fix: CopyForProfileFix, org: string, progress?: FixTracker): Promise<FixResult> {
  try {
    const invalid = validate(fix);
    if (invalid) return { ok: false, message: invalid };
    const run = async (p: Plan): Promise<FixResult> => {
      if (p.preview.blocked || !p.moves) return { ok: false, message: p.preview.blocked || "Nothing to update." };
      progress?.begin("deploy");
      const result = fix.revert ? await revert(fix, p, org, progress) : await create(fix, p, org, progress);
      if (result.ok) progress?.end("deploy");
      else progress?.fail("deploy");
      assignmentsCache.delete(org);
      return result;
    };
    if (fix.doc.type === "Layout") {
      return await withLayoutDocs(
        fix,
        org,
        async (layout, profile) =>
          run(await planning(progress, () => (fix.revert ? planLayoutRevert(fix, org, profile) : planLayoutCreate(fix, org, layout, profile)))),
        progress
      );
    }
    if (fix.revert) return await withApps(org, async (apps) => run(await planning(progress, () => planPage(fix, org, null, apps))), progress);
    progress?.begin("retrieve");
    return await withDoc(
      "FlexiPage",
      fix.doc.fullName,
      org,
      (page) => {
        progress?.end("retrieve");
        return withApps(org, async (apps) => run(await planning(progress, () => planPage(fix, org, page, apps))), progress);
      },
      progress?.statusHook("retrieve")
    );
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const undoOf = (fix: CopyForProfileFix, moves: CopyMove[]): CopyForProfileFix =>
  fix.revert
    ? { ...fix, label: fix.label.replace(/^Undo: /, ""), revert: undefined }
    : { ...fix, label: `Undo: ${fix.label}`, revert: { moves } };

async function deleteCopy(fix: CopyForProfileFix, org: string): Promise<string | null> {
  const res = await deleteMetadata(fix.doc.type, fix.copy.fullName, org);
  return res.success ? null : errorOf(res);
}

async function create(fix: CopyForProfileFix, p: Plan, org: string, progress?: FixTracker): Promise<FixResult> {
  const onStatus = progress?.statusHook("deploy");
  const moves = p.moves!;
  if (p.layout) {
    fs.writeFileSync(p.layout.copyPath, p.layout.copyXml, "utf-8");
    const made = await deployMetadata(p.layout.copyPath, org, onStatus);
    if (!made.success) return { ok: false, message: `Couldn't create ${fix.copy.label}: ${errorOf(made)}. Nothing was changed.` };
    fs.writeFileSync(p.layout.profilePath, p.layout.profileXml, "utf-8");
    const moved = await deployMetadata(p.layout.profilePath, org, onStatus);
    if (!moved.success) {
      const left = await deleteCopy(fix, org);
      return {
        ok: false,
        message: `Couldn't move ${fix.profile} to the copy: ${errorOf(moved)}. ${left ? `The copy “${fix.copy.label}” is still in the org (${left}); delete it in Setup.` : "The copy was removed; nothing was changed."}`,
      };
    }
  } else {
    const page = p.page!;
    fs.writeFileSync(page.copyPath, page.copyXml, "utf-8");
    const made = await deployMetadata(page.copyPath, org, onStatus);
    if (!made.success) return { ok: false, message: `Couldn't create ${fix.copy.label}: ${errorOf(made)}. Nothing was changed.` };
    const done: { file: AppFile; xml: string }[] = [];
    for (const app of page.apps) {
      fs.writeFileSync(app.file.filePath, app.xml, "utf-8");
      const moved = await deployMetadata(app.file.filePath, org, onStatus);
      if (moved.success) {
        done.push(app);
        continue;
      }
      // Put the apps already changed back, then remove the copy.
      const stuck: string[] = [];
      for (const d of done) {
        fs.writeFileSync(d.file.filePath, d.file.xml, "utf-8");
        if (!(await deployMetadata(d.file.filePath, org, onStatus)).success) stuck.push(d.file.name);
      }
      const left = stuck.length ? "still points at the copy in " + stuck.join(", ") : await deleteCopy(fix, org);
      return {
        ok: false,
        message: `Couldn't change ${app.file.name}: ${errorOf(moved)}. ${left ? `${fix.profile} ${stuck.length ? left : `kept its pages, but the copy “${fix.copy.label}” is still in the org (${left}); delete it in Setup`}.` : "The copy was removed; nothing was changed."}`,
      };
    }
  }
  return {
    ok: true,
    message: `Created ${fix.copy.label} and pointed ${fix.profile} at it.`,
    undo: undoOf(fix, moves),
  };
}

async function revert(fix: CopyForProfileFix, p: Plan, org: string, progress?: FixTracker): Promise<FixResult> {
  const onStatus = progress?.statusHook("deploy");
  const moves = p.moves!;
  if (p.layout) {
    fs.writeFileSync(p.layout.profilePath, p.layout.profileXml, "utf-8");
    const moved = await deployMetadata(p.layout.profilePath, org, onStatus);
    if (!moved.success) return { ok: false, message: `Couldn't point ${fix.profile} back at ${fix.doc.label}: ${errorOf(moved)}. The copy was left in place.` };
  } else {
    for (const app of p.page!.apps) {
      fs.writeFileSync(app.file.filePath, app.xml, "utf-8");
      const moved = await deployMetadata(app.file.filePath, org, onStatus);
      if (!moved.success) return { ok: false, message: `Couldn't change ${app.file.name}: ${errorOf(moved)}. The copy was left in place.` };
    }
  }
  const left = await deleteCopy(fix, org);
  return {
    ok: true,
    message: left
      ? `Pointed ${fix.profile} back at ${fix.doc.label}, but couldn't delete the copy “${fix.copy.label}” (${left}). Delete it in Setup.`
      : `Pointed ${fix.profile} back at ${fix.doc.label} and deleted the copy.`,
    undo: undoOf(fix, moves),
  };
}
