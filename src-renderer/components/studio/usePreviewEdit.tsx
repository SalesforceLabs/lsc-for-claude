import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListPlus, SquarePlus, TextCursorInput } from "lucide-react";
import type { ComponentCatalog, CreateConfigFix, FeatureMap, StudioFix, LiveCompactLayout, LiveFlexiPage, LiveLayout, LiveListView, ProfileOption } from "./types";
import { componentNote, type ComponentProps } from "./component-props";
import type { PublishedIpad, PublishedListView, PublishedResult } from "./published-types";
import type { PreviewEdit } from "./PublishedIpadPreview";
import type { EditDrop } from "./EditLayer";
import { changeKey, commitFrom, createAffects, queueChange, queuedCopy, queuedFlexiPageOps, queuedLayoutOps, viewFor, type PendingChange } from "./changes";
import { flexiPageCopyName, layoutCopyName } from "./copy-names";
import { actionVerbs, draftHomeMenu, draftTabs, moveActionTo, moveTabTo, tabVerbs, type DraftTab, type Verb } from "./edit-draft";
import { describeTarget, syncAction, syncFilter, type EditTarget } from "./edit-targets";
import {
  addRelatedVerb,
  alignLayout,
  draftSections,
  fieldVerbs,
  modelOf,
  moveFieldTo,
  moveRelatedTo,
  moveSectionTo,
  relatedObject,
  relatedVerbs,
  sectionVerbs,
  StaleDraftError,
  targetOf,
  type DraftSection,
  type FieldSlot,
  type LayoutDraft,
} from "./layout-draft";
import { alignCompact, compactTargetOf, compactVerbs, crowdedNote, draftHeader, moveCompactFieldTo, type CompactDraft, type DraftHeaderField } from "./compact-draft";
import {
  alignFlexiPage,
  componentVerbs,
  insertVerb,
  locateItem,
  modelOf as pageModelOf,
  moveComponentTo,
  moveRecordTabTo,
  propertyEdits,
  targetOf as pageTargetOf,
  type PageDraft,
} from "./flexipage-draft";
import {
  alignListView,
  draftListColumns,
  filtersChanged,
  isLegacyId,
  listColumnVerbs,
  listViewTargetOf,
  listViewVerbs,
  modelOf as listModelOf,
  moveListColumnTo,
  type DraftListColumn,
  type ListViewDraft,
} from "./listview-draft";
import ListViewEditor from "./ListViewEditor";
import BlockInspector, { compactReach, listViewReach, pageReach, type CopyAction } from "./BlockInspector";
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
  pending: tray,
  onPendingChange: onTrayChange,
  org,
  profiles,
  onOpenStudio,
}: PreviewEditOptions): { edit: PreviewEdit | undefined; panel: React.ReactNode } {
  // The tray as this profile's draft sees it: a copy made just for the profile stands in for the shared
  // document, and edits to it go back into the copy (changes.ts, viewFor / commitFrom).
  const pending = useMemo(() => viewFor(tray, profile), [tray, profile]);
  const onPendingChange = useCallback((next: PendingChange[]) => onTrayChange(commitFrom(tray, profile, next)), [tray, profile, onTrayChange]);
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

  // List views the same way, read when a list view or one of its columns is selected.
  const [liveListViews, setLiveListViews] = useState<Record<string, LiveListViewState>>({});
  useEffect(() => setLiveListViews({}), [org]);
  const wantedListViews = useMemo(() => {
    const names = new Set(pending.flatMap((p) => (p.fix.kind === "editMetadata" && p.fix.doc.type === "ListView" ? [p.fix.doc.fullName] : [])));
    if (on && (selected?.kind === "listView" || selected?.kind === "listColumn")) names.add(listViewNameOf(selected));
    return [...names].sort();
  }, [pending, selected, on]);
  const fetchListView = useCallback((name: string) => {
    setLiveListViews((m) => ({ ...m, [name]: { status: "loading" } }));
    window.lscApi.studioMetadataDoc("ListView", name).then(
      (res) => {
        const error = res.error ?? res.data?.error;
        setLiveListViews((m) => ({ ...m, [name]: error ? { status: "error", error } : { status: "ready", live: res.data as LiveListView } }));
      },
      (e: unknown) => setLiveListViews((m) => ({ ...m, [name]: { status: "error", error: String(e) } }))
    );
  }, []);
  useEffect(() => {
    for (const name of wantedListViews) if (!liveListViews[name]) fetchListView(name);
  }, [wantedListViews, liveListViews, fetchListView]);

  // Lightning pages (Home and record pages) the same way, read when one of their components or tabs is selected.
  const [livePages, setLivePages] = useState<Record<string, LivePageState>>({});
  useEffect(() => setLivePages({}), [org]);
  const selectedPage = selected?.kind === "component" || selected?.kind === "recordTab" ? selected.page : undefined;
  const wantedPages = useMemo(() => {
    const names = new Set(pending.flatMap((p) => (p.fix.kind === "editMetadata" && p.fix.doc.type === "FlexiPage" ? [p.fix.doc.fullName] : [])));
    if (on && selectedPage) names.add(selectedPage);
    return [...names].sort();
  }, [pending, selectedPage, on]);
  const fetchPage = useCallback((name: string) => {
    setLivePages((m) => ({ ...m, [name]: { status: "loading" } }));
    window.lscApi.studioMetadataDoc("FlexiPage", name).then(
      (res) => {
        const error = res.error ?? res.data?.error;
        const live = res.data as LiveFlexiPage;
        setLivePages((m) => ({ ...m, [name]: error ? { status: "error", error } : { status: "ready", live } }));
        if (error || !live.reachPending) return;
        // Who gets the page can take a minute in big orgs (every app is read); edit meanwhile, then fill it in.
        const settle = (reach: Pick<LiveFlexiPage, "profiles" | "appDefaults">) =>
          setLivePages((m) => {
            const cur = m[name];
            return cur?.status === "ready" && cur.live === live ? { ...m, [name]: { status: "ready", live: { ...live, ...reach, reachPending: false } } } : m;
          });
        window.lscApi.studioPageReach(name).then(
          (r) => settle(r.error || r.data?.error ? { profiles: null, appDefaults: null } : (r.data as Pick<LiveFlexiPage, "profiles" | "appDefaults">)),
          () => settle({ profiles: null, appDefaults: null })
        );
      },
      (e: unknown) => setLivePages((m) => ({ ...m, [name]: { status: "error", error: String(e) } }))
    );
  }, []);
  useEffect(() => {
    for (const name of wantedPages) if (!livePages[name]) fetchPage(name);
  }, [wantedPages, livePages, fetchPage]);

  // What "Insert component…" offers, per page type and object.
  const [catalogs, setCatalogs] = useState<Record<string, ComponentCatalog | "loading" | { error: string }>>({});
  useEffect(() => setCatalogs({}), [org]);

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

  const listViews = useMemo(() => buildListViews(liveListViews, snapshot, overlay), [liveListViews, snapshot, overlay]);

  const pages = useMemo(() => {
    const out: Record<string, PageEntry> = {};
    for (const [name, state] of Object.entries(livePages)) {
      if (state.status !== "ready") {
        out[name] = state;
        continue;
      }
      const published = snapshot?.pages[name] ?? (snapshot?.home?.name === name ? snapshot.home : undefined);
      const base = pageModelOf(state.live);
      const aligned = published && alignFlexiPage(published, base);
      if (!published || !aligned) {
        out[name] = { status: "stale", live: state.live, note: PAGE_STALE };
        continue;
      }
      if (state.live.managed) {
        out[name] = { status: "stale", live: state.live, note: MANAGED };
        continue;
      }
      try {
        const target = pageTargetOf(name, base, overlay);
        out[name] = { status: "ready", draft: { fullName: name, label: state.live.label, live: state.live, base, target, aligned } };
      } catch (e) {
        if (!(e instanceof StaleDraftError)) throw e;
        out[name] = { status: "stale", live: state.live, note: `The queued edits no longer fit this Lightning page: ${e.message} Take them out of the tray and refresh the preview.` };
      }
    }
    return out;
  }, [livePages, snapshot, overlay]);

  const pageEntry = selectedPage ? pages[selectedPage] : undefined;
  const pageDraft = pageEntry?.status === "ready" ? pageEntry.draft : undefined;
  const catalogKey =
    pageDraft && (pageDraft.live.pageType === "HomePage" || pageDraft.live.pageType === "RecordPage")
      ? `${pageDraft.live.pageType}:${pageDraft.live.sobjectType ?? ""}`
      : undefined;
  useEffect(() => {
    if (!on || !draft || !catalogKey || !pageDraft || catalogs[catalogKey]) return;
    setCatalogs((m) => ({ ...m, [catalogKey]: "loading" }));
    window.lscApi.studioComponentCatalog(pageDraft.live.pageType as "HomePage" | "RecordPage", pageDraft.live.sobjectType).then(
      (res) => {
        const error = res.error ?? res.data?.error;
        setCatalogs((m) => ({ ...m, [catalogKey]: error ? { error } : (res.data as ComponentCatalog) }));
      },
      (e: unknown) => setCatalogs((m) => ({ ...m, [catalogKey]: { error: String(e) } }))
    );
  }, [on, draft, catalogKey, pageDraft, catalogs]);
  const catalogState = catalogKey ? catalogs[catalogKey] : undefined;
  const catalog = catalogState && catalogState !== "loading" && !("error" in catalogState) ? catalogState : null;

  // The org item a selected component or tab is, and the keys drawn beside it (published or inserted in Draft).
  const pageItem = useMemo(() => {
    if (!pageDraft || (selected?.kind !== "component" && selected?.kind !== "recordTab")) return undefined;
    const key = (selected.kind === "component" ? selected.item : undefined) ?? (selected.source ? pageDraft.aligned.get(selected.source) : undefined);
    if (!key) return undefined;
    const published = new Set(pageDraft.aligned.values());
    const at = locateItem(pageDraft.target, key) ?? locateItem(pageDraft.base, key);
    const region = at && pageDraft.target.regions.find((r) => r.name === at.region.name);
    const inBase = (k: string) => !!locateItem(pageDraft.base, k);
    const shown = (region?.items ?? []).map((i) => i.key).filter((k) => published.has(k) || !inBase(k));
    return { key, shown };
  }, [pageDraft, selected]);

  const verbs = useMemo((): Verb[] => {
    if (!selected || !profile) return [];
    if (selection.length < 2) {
      if (selected.kind === "component" || selected.kind === "recordTab") {
        if (!pageDraft || !pageItem) return [];
        const tab = selected.kind === "recordTab";
        const moves = componentVerbs(pageDraft, pageItem.key, tab ? selected.title : selected.label, pageItem.shown, tab);
        return tab ? moves : [...moves, insertVerb(pageDraft, pageItem.key, catalog)];
      }
      return blockVerbs(selected, { tabs, homeMenu, pending, profile, layouts, compacts, listViews, snapshot });
    }
    // A group verb runs block by block, each against the tray the last one left, so the drafts are rebuilt from it.
    const at = (t: EditTarget, p: PendingChange[]) =>
      blockVerbs(t, {
        tabs: snapshot ? draftTabs(snapshot.tabs, tabItems ?? [], p, profile) : [],
        homeMenu: snapshot ? draftHomeMenu(snapshot.screens?.fabs?.home ?? [], actionItems ?? [], p, profile) : [],
        pending: p,
        profile,
        layouts: buildLayouts(liveLayouts, snapshot, p),
        compacts: buildCompacts(liveCompacts, snapshot, p),
        listViews: buildListViews(liveListViews, snapshot, p),
        snapshot,
      });
    return groupVerbs(selection, pending, at, selectionNoun(selected, selection.length));
  }, [selected, selection, tabs, homeMenu, pending, profile, layouts, compacts, listViews, snapshot, tabItems, actionItems, liveLayouts, liveCompacts, liveListViews, pageDraft, pageItem, catalog]);
  const groupName = selected && selection.length > 1 ? `${selection.length} ${selectionNoun(selected, selection.length)}` : undefined;
  // The selected component's property definitions: its js-meta.xml or the curated table, read once per component.
  const [propDefs, setPropDefs] = useState<Record<string, ComponentProps | "loading" | { error: string }>>({});
  useEffect(() => setPropDefs({}), [org]);
  const selectedComponent = pageDraft && pageItem ? locateItem(pageDraft.target, pageItem.key)?.item.component : undefined;
  const propsKey = selectedComponent && pageDraft ? `${pageDraft.live.pageType}:${selectedComponent}` : undefined;
  useEffect(() => {
    if (!on || !draft || !propsKey || !selectedComponent || !pageDraft || propDefs[propsKey]) return;
    setPropDefs((m) => ({ ...m, [propsKey]: "loading" }));
    const pageType = pageDraft.live.pageType === "HomePage" || pageDraft.live.pageType === "RecordPage" ? pageDraft.live.pageType : undefined;
    window.lscApi.studioComponentProps(selectedComponent, pageType).then(
      (res) => {
        const error = res.error ?? res.data?.error;
        setPropDefs((m) => ({ ...m, [propsKey]: error ? { error: String(error) } : (res.data as ComponentProps) }));
      },
      (e: unknown) => setPropDefs((m) => ({ ...m, [propsKey]: { error: String(e) } }))
    );
  }, [on, draft, propsKey, selectedComponent, pageDraft, propDefs]);
  const propState = propsKey ? propDefs[propsKey] : undefined;
  const loadedProps = propState && propState !== "loading" && !("error" in propState) ? propState : null;
  const properties = useMemo(() => (pageDraft && pageItem ? propertyEdits(pageDraft, pageItem.key, loadedProps) : []), [pageDraft, pageItem, loadedProps]);

  const info = useMemo(
    () =>
      selected && snapshot && profile
        ? describeTarget(selected, { snapshot, profile, pending: overlay, tabs, homeMenu })
        : null,
    [selected, snapshot, profile, overlay, tabs, homeMenu]
  );
  const layoutEntry = selected && "layout" in selected && selected.layout ? layouts[selected.layout] : undefined;
  const baseStatus =
    selected?.kind === "headerField"
      ? compactStatusOf(compacts[selected.compactLayout])
      : selected?.kind === "listView" || selected?.kind === "listColumn"
        ? listViewStatusOf(listViews[listViewNameOf(selected)], snapshot?.objects[selected.object]?.listViews)
        : selectedPage
        ? pageStatusOf(pageEntry)
        : statusOf(layoutEntry);

  // "Make a copy just for this profile": offered for a layout or page other profiles share, "Only [profile]" once queued.
  const copyAction = useMemo((): CopyAction | undefined => {
    if (!profile || !selected) return undefined;
    if (selected.kind === "headerField") return { kind: "explain", text: COMPACT_COPY_NOTE(profile) };
    const here = (name: string) => name.toLowerCase() === profile.toLowerCase();
    const target = pageDraft
      ? {
          doc: { type: "FlexiPage" as const, fullName: pageDraft.fullName, label: pageDraft.label },
          shared:
            !!pageDraft.live.profiles &&
            !!pageDraft.live.appDefaults &&
            !pageDraft.live.reachPending &&
            (pageDraft.live.profiles.some((n) => !here(n)) || pageDraft.live.appDefaults.length > 0),
        }
      : !selectedPage && layoutEntry?.status === "ready"
        ? {
            doc: { type: "Layout" as const, fullName: layoutEntry.draft.fullName, label: layoutEntry.draft.label },
            shared: !!layoutEntry.draft.live.profiles?.some((n) => !here(n)),
          }
        : null;
    if (!target) return undefined;
    const queued = queuedCopy(pending, target.doc, profile);
    if (queued) return { kind: "queued", onTakeOut: () => onPendingChange(pending.filter((p) => p.fix.kind !== "copyForProfile" || changeKey(p.fix) !== changeKey(queued))) };
    if (!target.shared) return undefined;
    const { doc } = target;
    return {
      kind: "offer",
      onCopy: () => {
        const names = doc.type === "Layout" ? layoutCopyName(doc.fullName, profile) : flexiPageCopyName(doc.fullName, profile, doc.label);
        // The copy starts from what this draft shows: the edits queued for the shared document come with it.
        const ops = doc.type === "Layout" ? queuedLayoutOps(pending, doc.fullName) : queuedFlexiPageOps(pending, doc.fullName);
        const fix: StudioFix = {
          kind: "copyForProfile",
          label: `Make a copy of ${doc.label} just for ${profile}`,
          doc,
          copy: names,
          profile,
          ...(ops.length ? { ops } : {}),
        };
        onPendingChange(queueChange(pending, { fix, affects: [profile] }));
      },
    };
  }, [profile, selected, selectedPage, pageDraft, layoutEntry, pending, onPendingChange]);
  const layoutStatus =
    copyAction?.kind === "queued" && baseStatus && !baseStatus.loading
      ? { ...baseStatus, profiles: undefined, reach: `Only ${profile}. A copy made for them: changes here reach no other profile.` }
      : baseStatus;
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
  // A drop in Draft queues what the move verbs would: tab and action SortOrders, or the layout's one diffed change.
  const drop = useCallback(
    (t: EditTarget, { list, before }: EditDrop): boolean => {
      if (!snapshot || !profile) return false;
      const moved = ((): PendingChange[] | null => {
        if (t.kind === "tab")
          return moveTabTo(snapshot.tabs, tabItems ?? [], profile, t.fullName, before?.kind === "tab" ? before.fullName : null, pending);
        if (t.kind === "action" && t.place === "home")
          return moveActionTo(snapshot.screens?.fabs?.home ?? [], actionItems ?? [], profile, t.name, before?.kind === "action" ? before.name : null, pending);
        if (t.kind === "component" || t.kind === "recordTab") {
          // Within the region or tab set it's drawn in; the org item a block is comes from its source (or Draft's insert).
          const entry = pages[t.page];
          if (entry?.status !== "ready" || (t.kind === "component" && list !== t.region)) return null;
          const d = entry.draft;
          const keyOf = (x: EditTarget) =>
            x.kind === "component" || x.kind === "recordTab" ? ((x.kind === "component" ? x.item : undefined) ?? (x.source ? d.aligned.get(x.source) : undefined)) : undefined;
          const key = keyOf(t);
          const next = before ? keyOf(before) : null;
          if (!key || next === undefined) return null;
          return t.kind === "recordTab" ? moveRecordTabTo(d, key, next, pending) : moveComponentTo(d, key, next, pending);
        }
        if (t.kind === "listColumn") {
          const l = listViews[t.listView];
          return l?.status === "ready" ? moveListColumnTo(l.draft, t.column, before?.kind === "listColumn" ? before.column : null, pending) : null;
        }
        if (t.kind === "headerField") {
          const c = compacts[t.compactLayout];
          return c?.status === "ready" ? moveCompactFieldTo(c.draft, t.field, before?.kind === "headerField" ? before.field : null, pending) : null;
        }
        const entry = "layout" in t && t.layout ? layouts[t.layout] : undefined;
        if (entry?.status !== "ready") return null;
        const d = entry.draft;
        if (t.kind === "section" && t.key !== undefined)
          return moveSectionTo(d, t.key, before?.kind === "section" ? (before.key ?? null) : null, pending);
        if (t.kind === "field" && t.item) {
          const { section, column } = list as Omit<FieldSlot, "before">;
          return moveFieldTo(d, t.item, { section, column, before: before?.kind === "field" ? (before.item ?? null) : null }, pending);
        }
        if (t.kind === "related" && t.relatedList)
          return moveRelatedTo(d, t.relatedList, before?.kind === "related" ? (before.relatedList ?? null) : null, pending);
        return null;
      })();
      if (!moved || moved === pending) return false;
      onPendingChange(moved);
      return true;
    },
    [snapshot, profile, tabItems, actionItems, compacts, layouts, pages, listViews, pending, onPendingChange]
  );
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
          listViews,
          pages,
          selected,
          onSelect,
          also: selection.slice(1),
          name: groupName,
          verbs: draft ? verbs : [],
          onRun: run,
          onDrop: draft ? drop : undefined,
          setup: org ? info?.setup : null,
          onSetup: openSetup,
          horizontal: selected?.kind === "tab" || selected?.kind === "headerField" || selected?.kind === "recordTab" || selected?.kind === "listColumn",
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
          copy={copyAction}
          onRetryLayout={
            selected?.kind === "headerField"
              ? () => fetchCompact(selected.compactLayout)
              : selected?.kind === "listView" || selected?.kind === "listColumn"
                ? () => fetchListView(listViewNameOf(selected))
                : selectedPage
                ? () => fetchPage(selectedPage)
                : selected && "layout" in selected && selected.layout
                ? () => fetchLayout(selected.layout!)
                : undefined
          }
          properties={properties}
          extra={
            (selected?.kind === "listView" || selected?.kind === "listColumn") && listViews[listViewNameOf(selected)]?.status === "ready" ? (
              <ListViewEditor
                draft={(listViews[listViewNameOf(selected)] as Extract<ListViewEntry, { status: "ready" }>).draft}
                editable={draft}
                pending={pending}
                onChange={onPendingChange}
              />
            ) : undefined
          }
          onProperty={(p, value) => {
            const next = p.set(value, pending);
            if (next) onPendingChange(next);
          }}
          onPropertyReset={(p) => onPendingChange(p.reset(pending))}
          propertiesLoading={propState === "loading"}
          propertiesNote={propState && typeof propState === "object" && "error" in propState ? `Couldn't read the component's property definitions: ${propState.error}` : loadedProps?.note}
          propertiesDynamic={loadedProps?.dynamic}
          propertiesComponentNote={componentNote(loadedProps) ?? undefined}
          propertiesNotDrawn={loadedProps?.renders === "no"}
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
                : selected?.kind === "listView" || selected?.kind === "listColumn"
                  ? `List view · ${selected.kind === "listView" ? selected.label : selected.viewLabel}`
                  : pageDraft
                  ? `Lightning page · ${pageDraft.label}`
                  : layoutEntry?.status === "ready"
                  ? `Page layout · ${layoutEntry.draft.label}`
                  : undefined
            }
            description={picking.pick.description}
            options={picking.pick.options}
            placeholder={picking.pick.placeholder}
            emptyTitle={picking.pick.empty}
            emptyIcon={picking.id === "addField" ? TextCursorInput : picking.id === "insertComponent" ? SquarePlus : ListPlus}
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

/** Why a compact layout (the record header) has no "copy just for this profile". */
const COMPACT_COPY_NOTE = (profile: string) =>
  `Compact layouts are assigned to record types, not profiles, so a copy can't be limited to ${profile}. Changing the header changes it for every profile that uses the record type.`;

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

/** The list view's Metadata API name ("Account.MyAccounts") for a list view or column target. */
export function listViewNameOf(t: Extract<EditTarget, { kind: "listView" | "listColumn" }>): string {
  return t.kind === "listView" ? `${t.object}.${t.name}` : t.listView;
}

const LIST_STALE =
  "This list view's columns changed in Setup since the last publish, so Studio can't line the list up with it. Publish to iPad (or refresh the preview) to edit it here.";

const LIST_MANAGED = "This list view was installed from a managed package, so it can't be changed. Create a copy in Setup and edit that.";

/** Each read list view as the tray `overlay` leaves it, like `buildCompacts`. */
export function buildListViews(liveListViews: Record<string, LiveListViewState>, snapshot: PublishedIpad | null, overlay: PendingChange[]): Record<string, ListViewEntry> {
  const out: Record<string, ListViewEntry> = {};
  for (const [name, state] of Object.entries(liveListViews)) {
    if (state.status !== "ready") {
      out[name] = state;
      continue;
    }
    const live = state.live;
    if (live.managed) {
      out[name] = { status: "stale", live, note: LIST_MANAGED };
      continue;
    }
    const object = name.slice(0, name.indexOf("."));
    const published = snapshot?.objects[object]?.listViews.find((l) => l.source?.fullName === name || `${object}.${l.name}` === name);
    const base = listModelOf(live);
    if (!published || !alignListView(published, base.columns)) {
      out[name] = { status: "stale", live, note: LIST_STALE };
      continue;
    }
    try {
      const target = listViewTargetOf(name, base, overlay);
      const columns = draftListColumns(published, live, base.columns, target.columns);
      const draft: ListViewDraft = {
        fullName: name,
        label: live.label,
        live,
        base,
        target,
        shown: columns.filter((c) => c.state !== "removed").map((c) => c.id),
        legacy: base.columns.some(isLegacyId) || base.filters.some((f) => isLegacyId(f.field)),
      };
      out[name] = { status: "ready", draft, columns, published, filtersChanged: filtersChanged(published, live) };
    } catch (e) {
      if (!(e instanceof StaleDraftError)) throw e;
      out[name] = { status: "stale", live, note: `The queued edits no longer fit this list view: ${e.message} Take them out of the tray and refresh the preview.` };
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
  listViews: Record<string, ListViewEntry>;
  snapshot: PublishedIpad | null;
}

/** The verbs for one block. Blocks are found again by name: a move changes their index. */
export function blockVerbs(selected: EditTarget, { tabs, homeMenu, pending, profile, layouts, compacts, listViews, snapshot }: VerbContext): Verb[] {
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
  if (selected.kind === "listView" || selected.kind === "listColumn") {
    const l = listViews[listViewNameOf(selected)];
    if (l?.status !== "ready") return [];
    return selected.kind === "listView" ? listViewVerbs(l.draft) : listColumnVerbs(l.draft, selected.column, selected.label);
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
export type LiveListViewState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; live: LiveListView };
export type LivePageState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; live: LiveFlexiPage };

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

/** A list view in edit mode, like `CompactEntry`: `columns` is the list as the tray leaves it; a managed view comes back stale, saying why. */
export type ListViewEntry =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "stale"; live: LiveListView; note: string }
  | { status: "ready"; draft: ListViewDraft; columns: DraftListColumn[]; published: PublishedListView; filtersChanged: boolean };

/** A Lightning page in edit mode, like `LayoutEntry`; a managed page comes back stale, saying why. */
export type PageEntry =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "stale"; live: LiveFlexiPage; note: string }
  | { status: "ready"; draft: PageDraft };

const PAGE_STALE =
  "This Lightning page changed in Setup since the last publish, so Studio can't line the preview up with it. Publish to iPad (or refresh the preview) to edit it here.";

const MANAGED =
  "This Lightning page was installed from a managed package, so it can't be deployed — change it (or a copy) in Lightning App Builder.";

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
  /** What the block comes from, for "Reading the … from the org" (default "layout"). */
  noun?: string;
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

function listViewStatusOf(entry: ListViewEntry | undefined, _published?: PublishedListView[]): LayoutStatus | undefined {
  if (!entry) return undefined;
  const noun = "list view";
  switch (entry.status) {
    case "loading":
      return { loading: true, noun };
    case "error":
      return { problem: `Couldn't read the list view from the org: ${entry.error}`, canRetry: true, noun };
    case "stale":
      return { problem: entry.note, reach: listViewReach(entry.live.sharedTo), production: entry.live.production, noun };
    case "ready":
      return {
        reach: listViewReach(entry.draft.live.sharedTo),
        production: entry.draft.live.production,
        noun,
        ...(entry.filtersChanged
          ? { note: "This list view's filters or scope changed in Setup since the last publish, so the rows drawn here come from the earlier ones. The columns are current." }
          : {}),
      };
  }
}

function pageStatusOf(entry: PageEntry | undefined): LayoutStatus | undefined {
  if (!entry) return undefined;
  const noun = "Lightning page";
  const reachOf = (live: LiveFlexiPage) =>
    live.reachPending
      ? "Working out which profiles and apps get this page…"
      : live.profiles && live.appDefaults
        ? pageReach(live.profiles, live.appDefaults)
        : "Couldn't read which apps assign this page, so who a change reaches isn't known — check its activations in Lightning App Builder.";
  const about = (live: LiveFlexiPage) => ({ noun, reach: reachOf(live), production: live.production });
  switch (entry.status) {
    case "loading":
      return { loading: true, noun };
    case "error":
      return { problem: `Couldn't read the Lightning page from the org: ${entry.error}`, canRetry: true, noun };
    case "stale":
      return { problem: entry.note, ...about(entry.live) };
    case "ready":
      return about(entry.draft.live);
  }
}
