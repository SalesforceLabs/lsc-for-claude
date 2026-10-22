import type { ScriptDetail, ScriptFields, ScriptRole, ScriptSummary, StageObjectRow, CreateCustomScriptFix } from "./scripts/script-types";
import type { AppOp, CompactOp, CopyForProfileFix, CreateConfigFix, FlexiPageOp, ItemEdit, LayoutOp, ListViewOp, StudioFix, StudioItem } from "./types";

/**
 * Pending changes — edits queued in Studio's tray until the admin reviews and
 * applies them together. Nothing here touches the org.
 */
export interface PendingChange {
  fix: StudioFix;
  /** Profiles whose iPads the change affects, for "Publish to iPad"; undefined = everyone / unknown. */
  affects?: string[];
}

export const MOBILE_CATEGORIES = new Set(["QuickAction", "CustomAction", "UISchema", "DbSchema"]);

/** Changes that write the same setting share a key, so a newer edit replaces an older one. */
export function changeKey(fix: StudioFix): string {
  switch (fix.kind) {
    case "assignPsl":
    case "removePsl":
      return `psl:${fix.userId}:${fix.pslId}`;
    case "setConfigField":
      return `field:${fix.category}:${fix.developerName}:${fix.field}`;
    case "setActive":
      return fix.record.type === "validationRule"
        ? `active:validationRule::${fix.record.id}`
        : `active:${fix.record.type}:${fix.record.type === "config" ? fix.record.category : ""}:${fix.record.developerName}`;
    case "setProfileAssignments":
      return `assign:${fix.category}:${fix.developerName}`;
    case "createConfigRecord":
      return `create:${fix.category}:${fix.developerName}`;
    case "deleteConfigRecord":
      return `delete:${fix.category}:${fix.developerName}`;
    case "assignAccess":
    case "removeAccess":
      return `access:${fix.userId}:${fix.access.type}:${fix.access.id}`;
    case "setCustomScriptCode":
    case "saveCustomScript":
      return `script:${fix.scriptId}`;
    case "createCustomScript":
      return `script-new:${fix.componentName}`;
    case "deleteCustomScript":
      return `script-delete:${fix.scriptId}`;
    case "assignCustomScript":
      return `stage:${fix.stageObjectId}:${fix.role}`;
    case "setLayoutRelatedList":
      return `layout:${fix.layoutName}:${fix.relationshipName}`;
    case "editMetadata":
      // The ops are the whole difference from the org's document, so a newer edit replaces the older one.
      return `metadata:${fix.doc.type}:${fix.doc.fullName}`;
    case "copyForProfile":
      return `copy:${fix.doc.type}:${fix.doc.fullName}:${fix.profile.toLowerCase()}`;
  }
}

const listKey = (l: string[]) => l.map((n) => n.toLowerCase()).sort().join("|");

/** True when a change would leave the setting as it was. */
function isNoop(fix: StudioFix): boolean {
  switch (fix.kind) {
    case "setConfigField":
      return String(fix.from ?? "") === String(fix.to ?? "");
    case "setActive":
      return fix.from === fix.to;
    case "setProfileAssignments":
      return listKey(fix.from) === listKey(fix.to);
    case "setCustomScriptCode":
      return fix.from === fix.to;
    case "saveCustomScript":
      return trimScriptTo(fix).noop;
    case "assignCustomScript":
      return (fix.from ?? null) === (fix.to ?? null);
    case "editMetadata":
      return fix.ops.length === 0;
    default:
      return false;
  }
}

type SaveFix = Extract<StudioFix, { kind: "saveCustomScript" }>;

/** A save's `to` without the parts that equal what the org had (`from`), and whether nothing is left. */
function trimScriptTo(fix: SaveFix): { to: SaveFix["to"]; noop: boolean } {
  const to: SaveFix["to"] = {};
  if (fix.to.code !== undefined && fix.to.code.trim() !== fix.from.code.trim()) to.code = fix.to.code;
  const fields: Partial<ScriptFields> = {};
  for (const [k, v] of Object.entries(fix.to.fields ?? {})) {
    if ((v ?? null) !== (fix.from.fields[k as keyof ScriptFields] ?? null)) (fields as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(fields).length) to.fields = fields;
  return { to, noop: to.code === undefined && !to.fields };
}

/** Queue a change. A change to an already-queued setting keeps the original `from`, and is dropped if it undoes the edit. */
export function queueChange(pending: PendingChange[], change: PendingChange): PendingChange[] {
  const key = changeKey(change.fix);
  // Deleting a script makes its queued edits pointless.
  if (change.fix.kind === "deleteCustomScript") {
    const scriptId = change.fix.scriptId;
    pending = pending.filter((p) => !((p.fix.kind === "saveCustomScript" || p.fix.kind === "setCustomScriptCode") && p.fix.scriptId === scriptId));
  }
  const idx = pending.findIndex((p) => changeKey(p.fix) === key);
  if (idx < 0) return isNoop(change.fix) ? pending : [...pending, change];
  const prev = pending[idx].fix;
  // Giving and then taking away the same access (or the reverse) is no change at all.
  if (prev.kind !== change.fix.kind && (prev.kind === "assignAccess" || prev.kind === "removeAccess")) {
    return pending.filter((_, i) => i !== idx);
  }
  // Adding a related list and then taking it out again (or the reverse) is no change at all.
  if (prev.kind === "setLayoutRelatedList" && change.fix.kind === "setLayoutRelatedList" && prev.add !== change.fix.add) {
    return pending.filter((_, i) => i !== idx);
  }
  // Repeated saves of one script are one pending change: the original `from`, the newest code, fields merged.
  if (prev.kind === "saveCustomScript" && change.fix.kind === "saveCustomScript") {
    const to = { ...prev.to, ...change.fix.to };
    if (prev.to.fields || change.fix.to.fields) to.fields = { ...prev.to.fields, ...change.fix.to.fields };
    const mergedSave: SaveFix = { ...change.fix, from: prev.from, to };
    const trimmed = trimScriptTo(mergedSave);
    if (trimmed.noop) return pending.filter((_, i) => i !== idx);
    const next = [...pending];
    next[idx] = { ...change, fix: { ...mergedSave, to: trimmed.to } };
    return next;
  }
  const merged = (
    "from" in prev && "from" in change.fix ? { ...change.fix, from: prev.from } : change.fix
  ) as StudioFix;
  const next = [...pending];
  if (isNoop(merged)) next.splice(idx, 1);
  else next[idx] = { ...change, fix: merged };
  return next;
}

export function pendingFor(pending: PendingChange[], fix: StudioFix): PendingChange | undefined {
  const key = changeKey(fix);
  return pending.find((p) => changeKey(p.fix) === key);
}

/** Whether this exact change (same setting, same new value) is in the tray. */
export function isQueued(pending: PendingChange[], fix: StudioFix): boolean {
  const queued = pendingFor(pending, fix)?.fix;
  if (!queued) return false;
  return !("to" in fix) || JSON.stringify((queued as { to?: unknown }).to) === JSON.stringify(fix.to);
}

export function isMobileChange(fix: StudioFix): boolean {
  switch (fix.kind) {
    case "setConfigField":
    case "setProfileAssignments":
      return MOBILE_CATEGORIES.has(fix.category);
    case "setActive":
      return fix.record.type === "config" && MOBILE_CATEGORIES.has(fix.record.category);
    case "createConfigRecord":
    case "deleteConfigRecord":
      return MOBILE_CATEGORIES.has(fix.category);
    case "editMetadata":
      // List views are read from the org when a rep opens one; nothing to publish.
      return fix.doc.type !== "ListView";
    case "copyForProfile":
    case "setLayoutRelatedList":
      // The layout feeds the iPad's visit engagement sidebar; it applies to every profile using it.
      return true;
    default:
      return false;
  }
}

/** Profiles a new record reaches — its assignments plus any listed in its Profiles field. */
export function createAffects(fix: CreateConfigFix): string[] {
  const listed = splitList(String(fix.fields.find((f) => f.name === "Profiles")?.value ?? ""));
  return [...new Map([...fix.profiles, ...listed].map((n) => [n.toLowerCase(), n])).values()];
}

/** Profiles to preselect when publishing a set of applied changes; null when one of them affects everyone. */
export function publishProfiles(changes: PendingChange[]): string[] | null {
  const names = new Map<string, string>();
  for (const c of changes.filter((c) => isMobileChange(c.fix))) {
    if (!c.affects) return null;
    for (const n of c.affects) names.set(n.toLowerCase(), n);
  }
  return [...names.values()];
}

// --- Stacking suggested profile changes -----------------------------------------

type ProfileListFix = Extract<StudioFix, { kind: "setProfileAssignments" }> | Extract<StudioFix, { kind: "setConfigField" }>;

function isProfileListFix(fix: StudioFix): fix is ProfileListFix {
  return fix.kind === "setProfileAssignments" || (fix.kind === "setConfigField" && fix.field === "Profiles");
}

function listOf(fix: ProfileListFix, side: "from" | "to"): string[] {
  return fix.kind === "setProfileAssignments" ? fix[side] : splitList(String(fix[side] ?? ""));
}

/** The same fix with its new profile list set to `names` (keeping the field's separator). */
function withList(fix: ProfileListFix, names: string[]): ProfileListFix {
  if (fix.kind === "setProfileAssignments") return { ...fix, to: names };
  const raw = String(fix.from ?? "");
  return { ...fix, to: names.join(raw.includes(",") && !raw.includes(";") ? "," : ";") };
}

/** What a profile-list change adds and removes. */
function delta(fix: ProfileListFix): { add: string[]; remove: Set<string> } {
  const [from, to] = [listOf(fix, "from"), listOf(fix, "to")];
  const lower = (l: string[]) => new Set(l.map((n) => n.toLowerCase()));
  const [f, t] = [lower(from), lower(to)];
  return { add: to.filter((n) => !f.has(n.toLowerCase())), remove: new Set(from.filter((n) => !t.has(n.toLowerCase())).map((n) => n.toLowerCase())) };
}

function applyDelta(base: string[], d: { add: string[]; remove: Set<string> }): string[] {
  const kept = base.filter((n) => !d.remove.has(n.toLowerCase()));
  const has = new Set(kept.map((n) => n.toLowerCase()));
  return [...kept, ...d.add.filter((n) => !has.has(n.toLowerCase()))];
}

/**
 * A suggested profile-list change, applied on top of whatever is already
 * pending for the same record — so "Show A to X" then "Show A to Y" keeps both.
 */
export function stackChange(pending: PendingChange[], change: PendingChange): PendingChange {
  const queued = pendingFor(pending, change.fix)?.fix;
  if (!queued || !isProfileListFix(change.fix) || !isProfileListFix(queued)) return change;
  return { ...change, fix: withList(change.fix, applyDelta(listOf(queued, "to"), delta(change.fix))) };
}

/** Whether a suggestion is in the tray — for profile lists, whether everything it adds and removes is pending. */
export function isSuggestionQueued(pending: PendingChange[], fix: StudioFix): boolean {
  const queued = pendingFor(pending, fix)?.fix;
  if (!queued || !isProfileListFix(fix) || !isProfileListFix(queued)) return isQueued(pending, fix);
  const now = new Set(listOf(queued, "to").map((n) => n.toLowerCase()));
  const d = delta(fix);
  return d.add.every((n) => now.has(n.toLowerCase())) && [...d.remove].every((n) => !now.has(n));
}

/** The tray with a suggestion taken back out, leaving other edits to the same record in place. */
export function withoutSuggestion(pending: PendingChange[], fix: StudioFix): PendingChange[] {
  const entry = pendingFor(pending, fix);
  if (!entry) return pending;
  if (!isProfileListFix(fix) || !isProfileListFix(entry.fix)) return pending.filter((p) => p !== entry);
  const d = delta(fix);
  const reversed = { add: [...d.remove].map((n) => listOf(fix, "from").find((f) => f.toLowerCase() === n)!), remove: new Set(d.add.map((n) => n.toLowerCase())) };
  return queueChange(pending, { ...entry, fix: withList(entry.fix, applyDelta(listOf(entry.fix, "to"), reversed)) });
}

// --- Building changes from inspector edits ------------------------------------

export function splitList(v: string): string[] {
  return v
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The item's profile list as currently edited — the queued value if there is one. */
export function effectiveProfiles(edit: ItemEdit, pending: PendingChange[]): string[] {
  if (!edit.profiles) return [];
  const probe = profileChange(edit, edit.profiles.source === "field" ? splitList(edit.profiles.raw) : edit.profiles.names);
  const queued = probe && pendingFor(pending, probe)?.fix;
  if (queued?.kind === "setConfigField") return splitList(String(queued.to ?? ""));
  if (queued?.kind === "setProfileAssignments") return queued.to;
  return edit.profiles.source === "field" ? splitList(edit.profiles.raw) : edit.profiles.names;
}

/** A change setting the item's profiles to `to` (kept entries stay in order, new ones are appended). */
export function profileChange(edit: ItemEdit, to: string[]): StudioFix | null {
  if (!edit.profiles || edit.record.type !== "config") return null;
  const { category, developerName, label } = edit.record;
  const changeLabel = `Change who sees ${label}`;
  if (edit.profiles.source === "assignments") {
    return { kind: "setProfileAssignments", label: changeLabel, category, developerName, recordLabel: label, from: edit.profiles.names, to };
  }
  const raw = edit.profiles.raw;
  const sep = raw.includes(",") && !raw.includes(";") ? "," : ";";
  const lower = new Set(to.map((n) => n.toLowerCase()));
  const kept = splitList(raw).filter((n) => lower.has(n.toLowerCase()));
  const keptLower = new Set(kept.map((n) => n.toLowerCase()));
  const value = [...kept, ...to.filter((n) => !keptLower.has(n.toLowerCase()))].join(sep);
  return { kind: "setConfigField", label: changeLabel, category, developerName, recordLabel: label, field: "Profiles", from: raw, to: value };
}

export function activeChange(edit: ItemEdit, to: boolean): StudioFix | null {
  if (edit.active === undefined) return null;
  return { kind: "setActive", label: `${to ? "Activate" : "Deactivate"} ${edit.record.label}`, record: edit.record, from: edit.active, to };
}

export function effectiveActive(edit: ItemEdit, pending: PendingChange[]): boolean | undefined {
  const probe = activeChange(edit, !edit.active);
  const queued = probe && pendingFor(pending, probe)?.fix;
  return queued?.kind === "setActive" ? queued.to : edit.active;
}

/** Profiles an item's change affects: what it's assigned to now plus what it will be. */
export function itemAffects(item: StudioItem, extra: string[] = []): string[] | undefined {
  if (!item.audience) return undefined;
  return [...new Set([...item.audience.profiles, ...extra])];
}

/** A change setting a custom script's CodeText from `from` (what the map saw) to `to`. */
export function scriptChange(item: StudioItem, from: string, to: string): StudioFix {
  return { kind: "setCustomScriptCode", label: `Edit code of ${item.label}`, scriptId: item.id, scriptName: item.label, from, to };
}

const fieldsOfSummary = (s: ScriptSummary): ScriptFields => ({
  name: s.name,
  componentName: s.componentName,
  type: s.type,
  objectName: s.objectName,
  operationEventType: s.operationEventType,
});

/** Save a script's code and/or fields (`to` holds only what changes). Repeated saves merge, keeping the first `from`. */
export function scriptSaveChange(detail: ScriptDetail, to: { code?: string; fields?: Partial<ScriptFields> }): StudioFix {
  return {
    kind: "saveCustomScript",
    label: `Save ${detail.name}`,
    scriptId: detail.id,
    scriptName: detail.name,
    from: { code: detail.code, fields: fieldsOfSummary(detail) },
    to,
  };
}

/** Create a script (and its component), optionally assigning it to stage objects. */
export function scriptCreateChange(draft: Omit<CreateCustomScriptFix, "kind" | "label"> & { label?: string }): StudioFix {
  const { label, ...rest } = draft;
  return { kind: "createCustomScript", label: label ?? `Create script ${draft.name}`, ...rest };
}

/** Delete a script; its component goes with it when it is one Studio can delete (customer-made, not a package's). */
export function scriptDeleteChange(summary: Pick<ScriptSummary, "id" | "name" | "lwc">, deleteBundle = summary.lwc.exists && summary.lwc.editable): StudioFix {
  return { kind: "deleteCustomScript", label: `Delete script ${summary.name}`, scriptId: summary.id, scriptName: summary.name, deleteBundle };
}

/** Point a stage object's validation or checklist script at `to` (null clears it). */
export function scriptAssignChange(stage: StageObjectRow, role: ScriptRole, to: string | null): StudioFix {
  const from = role === "validation" ? stage.validationScriptId : stage.checklistScriptId;
  return {
    kind: "assignCustomScript",
    label: `${to ? "Set" : "Clear"} the ${role} script of ${stage.name}`,
    stageObjectId: stage.id,
    stageObjectName: stage.name,
    role,
    from,
    to,
  };
}

/** The layout ops queued for a page layout. */
export function queuedLayoutOps(pending: PendingChange[], layoutName: string): LayoutOp[] {
  const queued = pending.find((p) => p.fix.kind === "editMetadata" && p.fix.doc.type === "Layout" && p.fix.doc.fullName === layoutName)?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "Layout" ? (queued.ops as LayoutOp[]) : [];
}

/** The ops queued for a Lightning page. */
export function queuedFlexiPageOps(pending: PendingChange[], fullName: string): FlexiPageOp[] {
  const queued = pending.find((p) => p.fix.kind === "editMetadata" && p.fix.doc.type === "FlexiPage" && p.fix.doc.fullName === fullName)?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "FlexiPage" ? (queued.ops as FlexiPageOp[]) : [];
}

/** A Lightning page change with these ops — what's queued for the page is replaced by it. */
export function flexiPageOpsChange(fullName: string, label: string, ops: FlexiPageOp[]): StudioFix {
  return { kind: "editMetadata", label: `Edit Lightning page ${label}`, doc: { type: "FlexiPage", fullName, label }, ops };
}

/** A page layout change with these ops — what's queued for the layout is replaced by it. */
export function layoutOpsChange(layoutName: string, layoutLabel: string, ops: LayoutOp[]): StudioFix {
  return { kind: "editMetadata", label: `Edit page layout ${layoutLabel}`, doc: { type: "Layout", fullName: layoutName, label: layoutLabel }, ops };
}

/** The compact layout ops queued for a record header. */
export function queuedCompactOps(pending: PendingChange[], fullName: string): CompactOp[] {
  const queued = pending.find((p) => p.fix.kind === "editMetadata" && p.fix.doc.type === "CompactLayout" && p.fix.doc.fullName === fullName)?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "CompactLayout" ? (queued.ops as CompactOp[]) : [];
}

/** A compact layout change with these ops — what's queued for the compact layout is replaced by it. */
export function compactOpsChange(fullName: string, label: string, ops: CompactOp[]): StudioFix {
  return { kind: "editMetadata", label: `Edit compact layout ${label}`, doc: { type: "CompactLayout", fullName, label }, ops };
}

/** The tab ops queued for a Lightning app. */
export function queuedAppOps(pending: PendingChange[], fullName: string): AppOp[] {
  const queued = pending.find((p) => p.fix.kind === "editMetadata" && p.fix.doc.type === "CustomApplication" && p.fix.doc.fullName === fullName)?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "CustomApplication" ? (queued.ops as AppOp[]) : [];
}

/** A Lightning app change with these ops: what is queued for the app is replaced by it. */
export function appOpsChange(fullName: string, label: string, ops: AppOp[]): StudioFix {
  return { kind: "editMetadata", label: `Edit app ${label}`, doc: { type: "CustomApplication", fullName, label }, ops };
}

/** The list view ops queued for a list view ("Object.Name"). */
export function queuedListViewOps(pending: PendingChange[], fullName: string): ListViewOp[] {
  const queued = pending.find((p) => p.fix.kind === "editMetadata" && p.fix.doc.type === "ListView" && p.fix.doc.fullName === fullName)?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "ListView" ? (queued.ops as ListViewOp[]) : [];
}

/** A list view change with these ops — what's queued for the list view is replaced by it. */
export function listViewOpsChange(fullName: string, label: string, ops: ListViewOp[]): StudioFix {
  return { kind: "editMetadata", label: `Edit list view ${label}`, doc: { type: "ListView", fullName, label }, ops };
}

/** The layout change with a related list added to or taken out of a Visit layout's engagement sidebar, on top of what's queued for the layout. */
export function layoutChange(
  pending: PendingChange[],
  layoutName: string,
  layoutLabel: string,
  candidate: { objectName: string; relationshipName: string },
  add: boolean
): StudioFix {
  const queued = queuedLayoutOps(pending, layoutName);
  const name = candidate.relationshipName;
  const wasAdded = queued.some((o) => o.op === "addRelatedList" && o.relatedList === name);
  const wasRemoved = queued.some((o) => o.op === "removeRelatedList" && o.relatedList === name);
  const ops = queued.filter((o) => !((o.op === "addRelatedList" || o.op === "removeRelatedList") && o.relatedList === name));
  // Adding back a list queued for removal (or taking out one queued to be added) is no change for it.
  if (add && !wasRemoved) ops.push({ op: "addRelatedList", relatedList: name, before: null, object: candidate.objectName });
  if (!add && !wasAdded) ops.push({ op: "removeRelatedList", relatedList: name });
  return layoutOpsChange(layoutName, layoutLabel, ops);
}

// --- Copies just for one profile ---------------------------------------------------

type EditFix = Extract<StudioFix, { kind: "editMetadata" }>;

const isEdit = (fix: StudioFix): fix is EditFix => fix.kind === "editMetadata";
const isCopy = (fix: StudioFix): fix is CopyForProfileFix => fix.kind === "copyForProfile" && !fix.revert;
const sameProfile = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();
const docKey = (doc: { type: string; fullName: string }) => `${doc.type}:${doc.fullName}`;

/** The copy queued for this document and profile. */
export function queuedCopy(pending: PendingChange[], doc: { type: string; fullName: string }, profile: string | null): CopyForProfileFix | undefined {
  for (const p of pending) if (isCopy(p.fix) && docKey(p.fix.doc) === docKey(doc) && sameProfile(p.fix.profile, profile)) return p.fix;
  return undefined;
}

/** Queued changes that reach a profile: those for everyone (no `affects`) and those naming it. */
export const pendingForProfile = (pending: PendingChange[], profile: string): PendingChange[] =>
  pending.filter((p) => !p.affects || p.affects.some((a) => sameProfile(a, profile)));

/**
 * The tray as one profile's draft sees it. A queued copy replaces its document for that
 * profile: the copy's own edits stand in for the edits queued for the shared document, which
 * don't reach the profile any more. Other profiles' drafts see the tray as it is, so the
 * copy's edits never show on a document they still share. Everything the draft code does
 * (queueing, replacing, diffing against the org) then works on the document's name as before.
 */
export function viewFor(pending: PendingChange[], profile: string | null): PendingChange[] {
  const copies = pending.flatMap((p) => (isCopy(p.fix) && sameProfile(p.fix.profile, profile) ? [p.fix] : []));
  if (!copies.length) return pending;
  let out = pending;
  for (const copy of copies) {
    const key = docKey(copy.doc);
    const virtual: PendingChange | null = copy.ops?.length
      ? { fix: { kind: "editMetadata", label: `Edit ${copy.copy.label}`, doc: copy.doc, ops: copy.ops } as StudioFix, affects: [copy.profile] }
      : null;
    const at = out.findIndex((p) => isEdit(p.fix) && docKey(p.fix.doc) === key);
    if (at >= 0) out = out.flatMap((p, i) => (i === at ? (virtual ? [virtual] : []) : [p]));
    else if (virtual) out = [...out, virtual];
  }
  return out;
}

/**
 * The tray after a draft changed its view `next` (see `viewFor`): the copy's edits go back into the
 * copy, and the edits queued for the shared document are put back as they were. A copy queued or
 * taken out in the view is kept or dropped as it says. Copies are kept ahead of edits of their own
 * document, so the copy is made from the document as it is in the org.
 */
export function commitFrom(raw: PendingChange[], profile: string | null, next: PendingChange[]): PendingChange[] {
  const rawCopies = raw.flatMap((p) => (isCopy(p.fix) && sameProfile(p.fix.profile, profile) ? [p.fix] : []));
  if (!rawCopies.length && !next.some((p) => isCopy(p.fix))) return next;
  const docs = new Set(rawCopies.map((c) => docKey(c.doc)));
  const originalOf = (key: string) => raw.find((r) => isEdit(r.fix) && docKey(r.fix.doc) === key);
  const seen = new Set<string>();
  const out: PendingChange[] = [];
  for (const p of next) {
    if (isEdit(p.fix) && docs.has(docKey(p.fix.doc))) {
      // The copy's edits are handed to the copy below; the shared document's own edit goes back in their place.
      const key = docKey(p.fix.doc);
      seen.add(key);
      const original = originalOf(key);
      if (original) out.push(original);
      continue;
    }
    out.push(p);
  }
  // Edits to the shared document that the view hid (the copy had no edits of its own) stay where they were.
  for (const key of docs) {
    const original = originalOf(key);
    if (!seen.has(key) && original) out.push(original);
  }
  const edited = (key: string) => next.find((n) => isEdit(n.fix) && docKey(n.fix.doc) === key)?.fix as EditFix | undefined;
  const result = out.map((p) => {
    if (!isCopy(p.fix) || !sameProfile(p.fix.profile, profile) || !docs.has(docKey(p.fix.doc))) return p;
    const ops = (edited(docKey(p.fix.doc))?.ops ?? []) as NonNullable<CopyForProfileFix["ops"]>;
    const { ops: _before, ...rest } = p.fix;
    return { ...p, fix: ops.length ? { ...rest, ops } : rest };
  });
  return copiesFirst(result);
}

/** The tray with each copy ahead of any edit of the document it copies (the same array when already so). */
export function copiesFirst(pending: PendingChange[]): PendingChange[] {
  const late = pending.some((p, i) => isCopy(p.fix) && pending.slice(0, i).some((e) => isEdit(e.fix) && docKey(e.fix.doc) === docKey((p.fix as CopyForProfileFix).doc)));
  if (!late) return pending;
  return [...pending.filter((p) => isCopy(p.fix)), ...pending.filter((p) => !isCopy(p.fix))];
}
