import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CreateConfigFix, FeatureMap, ProfileOption } from "./types";
import type { PublishedIpad, PublishedResult } from "./published-types";
import type { PreviewEdit } from "./PublishedIpadPreview";
import { createAffects, queueChange, type PendingChange } from "./changes";
import { actionVerbs, draftHomeMenu, draftTabs, tabVerbs, type Verb } from "./edit-draft";
import { describeTarget, syncAction, syncFilter, type EditTarget } from "./edit-targets";
import BlockInspector from "./BlockInspector";
import CreateDialog from "./CreateDialog";

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
  const snapshot: PublishedIpad | null = result && !("missing" in result) ? result : null;

  // Another profile, user or mode is another screen: start without a selection.
  useEffect(() => setSelected(null), [on, profile, snapshot]);

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
    return [];
  }, [selected, tabs, homeMenu, pending, profile]);

  const info = useMemo(
    () =>
      selected && snapshot && profile
        ? describeTarget(selected, { snapshot, profile, pending: overlay, tabs, homeMenu })
        : null,
    [selected, snapshot, profile, overlay, tabs, homeMenu]
  );
  const sync =
    info?.syncObject && snapshot && profile && syncFilter(snapshot, info.syncObject) === null
      ? syncAction(info.syncObject, synced, profile, pending)
      : null;

  const run = useCallback((verb: Verb) => verb.run && onPendingChange(verb.run(pending)), [pending, onPendingChange]);
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
          sync={sync}
          onSync={() => {
            if (sync?.kind === "change") onPendingChange(queueChange(pending, sync.change));
            if (sync?.kind === "create") setCreating(sync.draft);
          }}
          onSetup={org && info.setup ? openSetup : undefined}
          onStudio={info.studio ? () => onOpenStudio(info.studio!.featureId, info.studio!.surface, info.studio!.itemId) : undefined}
          onClose={() => setSelected(null)}
        />
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
