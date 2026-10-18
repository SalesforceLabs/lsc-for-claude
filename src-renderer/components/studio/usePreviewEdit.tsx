import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListPlus, TextCursorInput } from "lucide-react";
import type { CreateConfigFix, FeatureMap, LiveCompactLayout, LiveLayout, ProfileOption } from "./types";
import type { PublishedIpad, PublishedResult } from "./published-types";
import type { PreviewEdit } from "./PublishedIpadPreview";
import { createAffects, queueChange, type PendingChange } from "./changes";
import { actionVerbs, draftHomeMenu, draftTabs, tabVerbs, type DraftTab, type Verb } from "./edit-draft";
import { describeTarget, syncAction, syncFilter, type EditTarget } from "./edit-targets";
import {
  addRelatedVerb,
  alignLayout,
  draftSections,
  fieldVerbs,
  modelOf,
  relatedObject,
  relatedVerbs,
  sectionVerbs,
  StaleDraftError,
  targetOf,
  type DraftSection,
  type LayoutDraft,
} from "./layout-draft";
import { alignCompact, compactTargetOf, compactVerbs, crowdedNote, draftHeader, type CompactDraft, type DraftHeaderField } from "./compact-draft";
import BlockInspector, { compactReach } from "./BlockInspector";
import CreateDialog from "./CreateDialog";
import SearchPicker from "../ui/SearchPicker";
import { extendSelection, groupVerbs, selectionNoun } from "./multi-select";

interface PreviewEditOptions {
  /** Edit mode is on: blocks can be selected. */
  on: boolean;
  /** Draft: the tray is laid over the published iPad and verbs queue changes. */
  draft: boolean;
  profile: string | null;
  result: PublishedResult | undefined;
  actionsMap: FeatureMap | null;
  syncMap: FeatureMap | null;
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  /** The org Setup pages open in. */
  org: string | undefined;
  profiles: ProfileOption[];
  onOpenStudio: (featureId: string, surface: string, itemId: string) => void;
}

/**
 * Edit mode for the published iPad preview: the selected block, the Draft tab bar
 * and Home menu, the verbs the toolbar offers, and the docked inspector that
 * explains the block (with the record form for "Add to iPad sync").
 */
export function usePreviewEdit({
  on,
  draft,
  profile,
  result,
  actionsMap,
  syncMap,
  pending,
  onPendingChange,
  org,
  profiles,
  onOpenStudio,
}: PreviewEditOptions): { edit: PreviewEdit | undefined; panel: React.ReactNode } {
  // The selected blocks, the last one clicked first: ⌘- or ⇧-click adds blocks like it (multi-select.ts).
  const [selection, setSelection] = useState<EditTarget[]>([]);
  const selected = selection[0] ?? null;
  const setSelected = useCallback((t: EditTarget | null) => setSelection(t ? [t] : []), []);
  const onSelect = useCallback(
    (t: EditTarget | null, extend?: boolean) => setSelection((s) => (t ? extendSelection(s, t, !!extend) : [])),
    []
  );
  const [creating, setCreating] = useState<CreateConfigFix | null>(null);
  // A verb that asks which field or related list first.
  const [picking, setPicking] = useState<Verb | null>(null);
  const snapshot: PublishedIpad | null = result && !("missing" in result) ? result : null;

  // Another profile, user or mode is another screen: start without a selection.
  useEffect(() => setSelected(null), [on, profile, snapshot, setSelected]);
  useEffect(() => setPicking(null), [selected, draft]);

  // Page layouts as they are in the org now, read when one of their blocks is selected
  // (and for layouts with queued edits): the preview shows the last publish.
  const [liveLayouts, setLiveLayouts] = useState<Record<string, LiveState>>({});
  useEffect(() => setLiveLayouts({}), [org]);
  const wanted = useMemo(() => {
    const names = new Set(pending.flatMap((p) => (p.fix.kind === "editMetadata" && p.fix.doc.type === "Layout" ? [p.fix.doc.fullName] : [])));
    const layout = selected && "layout" in selected ? selected.layout : undefined;
    if (on && layout) names.add(layout);
    return [...names].sort();
  }, [pending, selected, on]);
  const fetchLayout = useCallback((name: string) => {
    setLiveLayouts((m) => ({ ...m, [name]: { status: "loading" } }));
    window.lscApi.studioMetadataDoc("Layout", name).then(
      (res) => {
        const error = res.error ?? res.data?.error;
        setLiveLayouts((m) => ({ ...m, [name]: error ? { status: "error", error } : { status: "ready", live: res.data as LiveLayout } }));
      },
      (e: unknown) => setLiveLayouts((m) => ({ ...m, [name]: { status: "error", error: String(e) } }))
    );
  }, []);
  useEffect(() => {
    for (const name of wanted) if (!liveLayouts[name]) fetchLayout(name);
  }, [wanted, liveLayouts, fetchLayout]);

  // Compact layouts (the record header) the same way, read when a header field is selected.
  const [liveCompacts, setLiveCompacts] = useState<Record<string, LiveCompactState>>({});
  useEffect(() => setLiveCompacts({}), [org]);
  const wantedCompacts = useMemo(() => {
    const names = new Set(pending.flatMap((p) => (p.fix.kind === "editMetadata" && p.fix.doc.type === "CompactLayout" ? [p.fix.doc.fullName] : [])));
    if (on && selected?.kind === "headerField") names.add(selected.compactLayout);
    return [...names].sort();
  }, [pending, selected, on]);
  const fetchCompact = useCallback((name: string) => {
    setLiveCompacts((m) => ({ ...m, [name]: { status: "loading" } }));
    window.lscApi.studioMetadataDoc("CompactLayout", name).then(
      (res) => {
        const error = res.error ?? res.data?.error;
        setLiveCompacts((m) => ({ ...m, [name]: error ? { status: "error", error } : { status: "ready", live: res.data as LiveCompactLayout } }));
      },
      (e: unknown) => setLiveCompacts((m) => ({ ...m, [name]: { status: "error", error: String(e) } }))
    );
  }, []);
  useEffect(() => {
    for (const name of wantedCompacts) if (!liveCompacts[name]) fetchCompact(name);
  }, [wantedCompacts, liveCompacts, fetchCompact]);

  const surface = (map: FeatureMap | null, id: string) => map?.surfaces.find((s) => s.id === id);
  const tabItems = surface(actionsMap, "navigationTabs")?.items;
  const actionItems = surface(actionsMap, "homeActions")?.items;
  const synced = surface(syncMap, "syncedObjects");
  const overlay = draft ? pending : NONE;

  const tabs = useMemo(
    () => (snapshot && profile ? draftTabs(snapshot.tabs, tabItems ?? [], overlay, profile) : []),
    [snapshot, tabItems, overlay, profile]
  );
  const homeMenu = useMemo(
    () =>
      snapshot && profile
        ? draftHomeMenu(snapshot.screens?.fabs?.home ?? [], actionItems ?? [], overlay, profile)
        : [],
    [snapshot, actionItems, overlay, profile]
  );

  const layouts = useMemo(() => buildLayouts(liveLayouts, snapshot, overlay), [liveLayouts, snapshot, overlay]);

  const compacts = useMemo(() => buildCompacts(liveCompacts, snapshot, overlay), [liveCompacts, snapshot, overlay]);

  const verbs = useMemo((): Verb[] => {
    if (!selected || !profile) return [];
    if (selection.length < 2) return blockVerbs(selected, { tabs, homeMenu, pending, profile, layouts, compacts, snapshot });
    // A group verb runs block by block, each against the tray the last one left, so the drafts are rebuilt from it.
    const at = (t: EditTarget, p: PendingChange[]) =>
      blockVerbs(t, {
        tabs: snapshot ? draftTabs(snapshot.tabs, tabItems ?? [], p, profile) : [],
        homeMenu: snapshot ? draftHomeMenu(snapshot.screens?.fabs?.home ?? [], actionItems ?? [], p, profile) : [],
        pending: p,
        profile,
        layouts: buildLayouts(liveLayouts, snapshot, p),
        compacts: buildCompacts(liveCompacts, snapshot, p),
        snapshot,
      });
    return groupVerbs(selection, pending, at, selectionNoun(selected, selection.length));
  }, [selected, selection, tabs, homeMenu, pending, profile, layouts, compacts, snapshot, tabItems, actionItems, liveLayouts, liveCompacts]);
  const groupName = selected && selection.length > 1 ? `${selection.length} ${selectionNoun(selected, selection.length)}` : undefined;

  const info = useMemo(
    () =>
      selected && snapshot && profile
        ? describeTarget(selected, { snapshot, profile, pending: overlay, tabs, homeMenu })
        : null,
    [selected, snapshot, profile, overlay, tabs, homeMenu]
  );
  const layoutEntry = selected && "layout" in selected && selected.layout ? layouts[selected.layout] : undefined;
  const layoutStatus = selected?.kind === "headerField" ? compactStatusOf(compacts[selected.compactLayout]) : statusOf(layoutEntry);
  const sync =
    info?.syncObject && snapshot && profile && syncFilter(snapshot, info.syncObject) === null
      ? syncAction(info.syncObject, synced, profile, pending)
      : null;

  const run = useCallback(
    (verb: Verb) => {
      if (verb.pick) setPicking(verb);
      else if (verb.run) onPendingChange(verb.run(pending));
    },
    [pending, onPendingChange]
  );
  const pick = (value: string) => {
    if (!picking?.pick) return;
    onPendingChange(picking.pick.run(value, pending));
    setPicking(null);
    // Select the new related list, so the inspector can offer to sync its records to the iPad.
    const entry = selected?.kind === "related" && selected.layout ? layouts[selected.layout] : undefined;
    if (picking.id === "addRelated" && selected?.kind === "related" && entry?.status === "ready") {
      const object = relatedObject(entry.draft, value);
      setSelected({ kind: "related", object, label: snapshot?.objects[object]?.label ?? object, parent: selected.parent, layout: selected.layout, relatedList: value });
    }
  };
  const openSetup = useCallback(() => {
    if (org && info?.setup) window.lscApi.openSfOrg(org, info.setup.path);
  }, [org, info]);

  const edit: PreviewEdit | undefined =
    on && snapshot
      ? {
          on,
          draft,
          tabs,
          homeMenu,
          layouts,
          compacts,
          selected,
          onSelect,
          also: selection.slice(1),
          name: groupName,
          verbs: draft ? verbs : [],
          onRun: run,
          setup: org ? info?.setup : null,
          onSetup: openSetup,
          horizontal: selected?.kind === "tab" || selected?.kind === "headerField",
        }
      : undefined;

  const panel =
    edit && info && profile ? (
      <>
        <BlockInspector
          key={JSON.stringify(selected) + selection.length}
          info={info}
          profile={profile}
          verbs={verbs}
          draft={draft}
          onRun={run}
          horizontal={edit.horizontal}
          layout={layoutStatus}
          onRetryLayout={
            selected?.kind === "headerField"
              ? () => fetchCompact(selected.compactLayout)
              : selected && "layout" in selected && selected.layout
                ? () => fetchLayout(selected.layout!)
                : undefined
          }
          sync={sync}
          onSync={() => {
            if (sync?.kind === "change") onPendingChange(queueChange(pending, sync.change));
            if (sync?.kind === "create") setCreating(sync.draft);
          }}
          onSetup={org && info.setup ? openSetup : undefined}
          onStudio={info.studio ? () => onOpenStudio(info.studio!.featureId, info.studio!.surface, info.studio!.itemId) : undefined}
          onClose={() => setSelected(null)}
          selection={groupName}
        />
        {picking?.pick && (
          <SearchPicker
            title={picking.pick.title}
            eyebrow={
              selected?.kind === "headerField"
                ? "Compact layout · record header"
                : layoutEntry?.status === "ready"
                  ? `Page layout · ${layoutEntry.draft.label}`
                  : undefined
            }
            description={picking.pick.description}
            options={picking.pick.options}
            placeholder={picking.pick.placeholder}
            emptyTitle={picking.pick.empty}
            emptyIcon={picking.id === "addField" ? TextCursorInput : ListPlus}
            onPick={pick}
            onCancel={() => setPicking(null)}
          />
        )}
        {creating && (
          <CreateDialog
            draft={creating}
            objects={syncMap?.objects ?? []}
            profiles={profiles}
            onCancel={() => setCreating(null)}
            onQueue={(fix) => {
              onPendingChange(queueChange(pending, { fix, affects: createAffects(fix) }));
              setCreating(null);
            }}
          />
        )}
      </>
    ) : null;

  return { edit, panel };
}

const NONE: PendingChange[] = [];

/** Each read page layout as the tray `overlay` leaves it. Pure, so a group verb can rebuild it against any tray. */
export function buildLayouts(liveLayouts: Record<string, LiveState>, snapshot: PublishedIpad | null, overlay: PendingChange[]): Record<string, LayoutEntry> {
  const out: Record<string, LayoutEntry> = {};
  for (const [name, state] of Object.entries(liveLayouts)) {
    if (state.status !== "ready") {
      out[name] = state;
      continue;
    }
    const published = snapshot?.layouts[name];
    const base = modelOf(state.live);
    const aligned = published && alignLayout(published, base);
    if (!published || !aligned) {
      out[name] = { status: "stale", live: state.live, note: STALE };
      continue;
    }
    try {
      const target = targetOf(name, base, overlay);
      const sections = draftSections(published, base, target, aligned, state.live.available);
      // Lists added in Draft are drawn too, so moves step past them.
      const listed = new Set(published.relatedLists.map((r) => r.name));
      const shownRelated = target.relatedLists.filter((r) => listed.has(r) || !base.relatedLists.includes(r));
      const draft: LayoutDraft = {
        fullName: name,
        label: name.slice(name.indexOf("-") + 1),
        live: state.live,
        base,
        target,
        shownSections: sections.filter((x) => x.state !== "removed").map((x) => x.key),
        shownRelated: shownRelated.length ? shownRelated : target.relatedLists,
      };
      out[name] = { status: "ready", draft, sections };
    } catch (e) {
      if (!(e instanceof StaleDraftError)) throw e;
      out[name] = { status: "stale", live: state.live, note: `The queued edits no longer fit this layout: ${e.message} Take them out of the tray and refresh the preview.` };
    }
  }
  return out;
}

/** Each read compact layout as the tray `overlay` leaves it, like `buildLayouts`. */
export function buildCompacts(liveCompacts: Record<string, LiveCompactState>, snapshot: PublishedIpad | null, overlay: PendingChange[]): Record<string, CompactEntry> {
  const out: Record<string, CompactEntry> = {};
  for (const [name, state] of Object.entries(liveCompacts)) {
    if (state.status !== "ready") {
      out[name] = state;
      continue;
    }
    const published = snapshot?.compactFields?.[name];
    const base = state.live.fields;
    if (!published || !alignCompact(snapshot?.compactSources?.[name], published, base)) {
      out[name] = { status: "stale", live: state.live, note: COMPACT_STALE };
      continue;
    }
    try {
      const target = compactTargetOf(name, base, overlay);
      const fields = draftHeader(published, state.live, base, target);
      const object = name.slice(0, name.indexOf("."));
      const hidden = (f: string) => !!snapshot?.records?.fields[object]?.[f.toLowerCase()]?.hidden;
      const draft: CompactDraft = {
        fullName: name,
        label: state.live.label,
        live: state.live,
        base,
        target,
        shown: fields.filter((f) => f.state !== "removed" && !hidden(f.spec.name)).map((f) => f.spec.name),
      };
      out[name] = { status: "ready", draft, fields };
    } catch (e) {
      if (!(e instanceof StaleDraftError)) throw e;
      out[name] = { status: "stale", live: state.live, note: `The queued edits no longer fit this compact layout: ${e.message} Take them out of the tray and refresh the preview.` };
    }
  }
  return out;
}

/** What a block's verbs are drawn from: the Draft tab bar, Home menu and layouts for one tray. */
export interface VerbContext {
  tabs: DraftTab[];
  homeMenu: ReturnType<typeof draftHomeMenu>;
  pending: PendingChange[];
  profile: string;
  layouts: Record<string, LayoutEntry>;
  compacts: Record<string, CompactEntry>;
  snapshot: PublishedIpad | null;
}

/** The verbs for one block. Blocks are found again by name: a move changes their index. */
export function blockVerbs(selected: EditTarget, { tabs, homeMenu, pending, profile, layouts, compacts, snapshot }: VerbContext): Verb[] {
  if (!profile) return [];
  if (selected.kind === "tab") {
    const i = tabs.findIndex((d) => d.tab.fullName === selected.fullName);
    return i < 0 ? [] : tabVerbs(tabs, i, pending, profile);
  }
  if (selected.kind === "action" && selected.place === "home") {
    const i = homeMenu.findIndex((d) => d.value.name === selected.name);
    return i < 0 ? [] : actionVerbs(homeMenu, i, pending, profile);
  }
  if (selected.kind === "headerField") {
    const c = compacts[selected.compactLayout];
    return c?.status === "ready" ? compactVerbs(c.draft, selected.field, selected.label) : [];
  }
  const entry = "layout" in selected && selected.layout ? layouts[selected.layout] : undefined;
  if (entry?.status !== "ready") return [];
  const d = entry.draft;
  if (selected.kind === "section" && selected.key !== undefined) return sectionVerbs(d, selected.key);
  if (selected.kind === "field" && selected.item) {
    const column = entry.sections.flatMap((x) => x.columns).find((c) => c.some((f) => f.item === selected.item));
    const shown = [...new Set((column ?? []).filter((f) => f.state !== "removed").map((f) => f.item))];
    return fieldVerbs(d, selected.item, selected.label, shown);
  }
  if (selected.kind === "related") {
    const notSynced = (object: string) => !!snapshot && syncFilter(snapshot, object) === null;
    return selected.relatedList ? relatedVerbs(d, selected.relatedList, selected.label, notSynced) : [addRelatedVerb(d, null, notSynced)];
  }
  return [];
}

export type LiveState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; live: LiveLayout };
export type LiveCompactState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; live: LiveCompactLayout };

/** A page layout in edit mode: still loading, unreadable, out of line with the last publish, or ready to draw and edit. */
export type LayoutEntry =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "stale"; live: LiveLayout; note: string }
  | { status: "ready"; draft: LayoutDraft; sections: DraftSection[] };

/** A compact layout in edit mode, like `LayoutEntry`: `fields` is the header as the tray leaves it. */
export type CompactEntry =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "stale"; live: LiveCompactLayout; note: string }
  | { status: "ready"; draft: CompactDraft; fields: DraftHeaderField[] };

const COMPACT_STALE =
  "This compact layout changed in Setup since the last publish, so Studio can't line the record header up with it. Publish to iPad (or refresh the preview) to edit it here.";

const STALE =
  "This page layout changed in Setup since the last publish, so Studio can't line the preview up with it. Publish to iPad (or refresh the preview) to edit it here.";

/** What the inspector says about the selected block's layout. */
export interface LayoutStatus {
  loading?: boolean;
  /** Why it can't be edited here. */
  problem?: string;
  canRetry?: boolean;
  profiles?: string[] | null;
  /** Who a change reaches, when it isn't a page layout's profiles (a compact layout's record types). */
  reach?: string;
  /** A heads-up about the arrangement (a crowded header). */
  note?: string;
  production?: boolean;
}

function statusOf(entry: LayoutEntry | undefined): LayoutStatus | undefined {
  if (!entry) return undefined;
  switch (entry.status) {
    case "loading":
      return { loading: true };
    case "error":
      return { problem: `Couldn't read the layout from the org: ${entry.error}`, canRetry: true };
    case "stale":
      return { problem: entry.note, profiles: entry.live.profiles, production: entry.live.production };
    case "ready":
      return { profiles: entry.draft.live.profiles, production: entry.draft.live.production };
  }
}

function compactStatusOf(entry: CompactEntry | undefined): LayoutStatus | undefined {
  if (!entry) return undefined;
  const reach = (live: LiveCompactLayout) => (live.recordTypes ? { reach: compactReach(live.recordTypes) } : {});
  switch (entry.status) {
    case "loading":
      return { loading: true };
    case "error":
      return { problem: `Couldn't read the compact layout from the org: ${entry.error}`, canRetry: true };
    case "stale":
      return { problem: entry.note, ...reach(entry.live), production: entry.live.production };
    case "ready": {
      const note = crowdedNote(entry.draft);
      return { ...reach(entry.draft.live), ...(note ? { note } : {}), production: entry.draft.live.production };
    }
  }
}
