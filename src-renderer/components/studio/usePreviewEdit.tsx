import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListPlus, TextCursorInput } from "lucide-react";
import type { CreateConfigFix, FeatureMap, LiveLayout, ProfileOption } from "./types";
import type { PublishedIpad, PublishedResult } from "./published-types";
import type { PreviewEdit } from "./PublishedIpadPreview";
import { createAffects, queueChange, type PendingChange } from "./changes";
import { actionVerbs, draftHomeMenu, draftTabs, tabVerbs, type Verb } from "./edit-draft";
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
import BlockInspector from "./BlockInspector";
import CreateDialog from "./CreateDialog";
import SearchPicker from "../ui/SearchPicker";

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
  const [selected, setSelected] = useState<EditTarget | null>(null);
  const [creating, setCreating] = useState<CreateConfigFix | null>(null);
  // A verb that asks which field or related list first.
  const [picking, setPicking] = useState<Verb | null>(null);
  const snapshot: PublishedIpad | null = result && !("missing" in result) ? result : null;

  // Another profile, user or mode is another screen: start without a selection.
  useEffect(() => setSelected(null), [on, profile, snapshot]);
  useEffect(() => setPicking(null), [selected, draft]);

  // Page layouts as they are in the org now, read when one of their blocks is selected
  // (and for layouts with queued edits): the preview shows the last publish.
  const [liveLayouts, setLiveLayouts] = useState<Record<string, LiveState>>({});
  useEffect(() => setLiveLayouts({}), [org]);
  const wanted = useMemo(() => {
    const names = new Set(pending.flatMap((p) => (p.fix.kind === "editMetadata" ? [p.fix.doc.fullName] : [])));
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

  const layouts = useMemo(() => {
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
  }, [liveLayouts, snapshot, overlay]);

  // Blocks are found again by name: a move changes their index.
  const verbs = useMemo((): Verb[] => {
    if (!selected || !profile) return [];
    if (selected.kind === "tab") {
      const i = tabs.findIndex((d) => d.tab.fullName === selected.fullName);
      return i < 0 ? [] : tabVerbs(tabs, i, pending, profile);
    }
    if (selected.kind === "action" && selected.place === "home") {
      const i = homeMenu.findIndex((d) => d.value.name === selected.name);
      return i < 0 ? [] : actionVerbs(homeMenu, i, pending, profile);
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
  }, [selected, tabs, homeMenu, pending, profile, layouts, snapshot]);

  const info = useMemo(
    () =>
      selected && snapshot && profile
        ? describeTarget(selected, { snapshot, profile, pending: overlay, tabs, homeMenu })
        : null,
    [selected, snapshot, profile, overlay, tabs, homeMenu]
  );
  const layoutEntry = selected && "layout" in selected && selected.layout ? layouts[selected.layout] : undefined;
  const layoutStatus = statusOf(layoutEntry);
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
          selected,
          onSelect: setSelected,
          verbs: draft ? verbs : [],
          onRun: run,
          setup: org ? info?.setup : null,
          onSetup: openSetup,
          horizontal: selected?.kind === "tab",
        }
      : undefined;

  const panel =
    edit && info && profile ? (
      <>
        <BlockInspector
          key={JSON.stringify(selected)}
          info={info}
          profile={profile}
          verbs={verbs}
          draft={draft}
          onRun={run}
          layout={layoutStatus}
          onRetryLayout={selected && "layout" in selected && selected.layout ? () => fetchLayout(selected.layout!) : undefined}
          sync={sync}
          onSync={() => {
            if (sync?.kind === "change") onPendingChange(queueChange(pending, sync.change));
            if (sync?.kind === "create") setCreating(sync.draft);
          }}
          onSetup={org && info.setup ? openSetup : undefined}
          onStudio={info.studio ? () => onOpenStudio(info.studio!.featureId, info.studio!.surface, info.studio!.itemId) : undefined}
          onClose={() => setSelected(null)}
        />
        {picking?.pick && (
          <SearchPicker
            title={picking.pick.title}
            eyebrow={layoutEntry?.status === "ready" ? `Page layout · ${layoutEntry.draft.label}` : undefined}
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

type LiveState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; live: LiveLayout };

/** A page layout in edit mode: still loading, unreadable, out of line with the last publish, or ready to draw and edit. */
export type LayoutEntry =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "stale"; live: LiveLayout; note: string }
  | { status: "ready"; draft: LayoutDraft; sections: DraftSection[] };

const STALE =
  "This page layout changed in Setup since the last publish, so Studio can't line the preview up with it. Publish to iPad (or refresh the preview) to edit it here.";

/** What the inspector says about the selected block's layout. */
export interface LayoutStatus {
  loading?: boolean;
  /** Why it can't be edited here. */
  problem?: string;
  canRetry?: boolean;
  profiles?: string[] | null;
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
