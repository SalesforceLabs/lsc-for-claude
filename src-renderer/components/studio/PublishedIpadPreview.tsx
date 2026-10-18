import React, { useContext, useMemo, useRef, useState } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import StateView from "../ui/StateView";
import type {
  PublishedComponent,
  PublishedIpad,
  PublishedLayout,
  PublishedListData,
  PublishedObject,
  PublishedPage,
  PublishedResult,
  PublishedTab,
} from "./published-types";
import IpadScreen from "./IpadScreen";
import RecordScreen, { asDrawn, blockIdentity, draftClass, LayoutEdits, usePageDraft } from "./IpadRecord";
import IpadFabs from "./IpadFabs";
import { Dashboard } from "./IpadDashboard";
import { ReportsTree } from "./IpadReports";
import { hasNativeScreen, NativeScreen } from "./screens";
import { IpadSearchField, IpadStatusBar, IpadTopBar, type ChromeTab } from "./IpadChrome";
import { initials } from "./ipad-chrome";
import { ChromeSheets, SearchTab, type ChromeSheet } from "./IpadChromeSheets";
import { CardList, cardModeFor, rowActions, saveCardMode, SortButton, sortRows, ViewModeButton, type SortState } from "./IpadListControls";
import IpadActionSheet from "./IpadActionSheets";
import PublishedLoading from "./PublishedLoading";
import type { PublishedFabItem } from "./screens/fabs-types";
import { presentationFor, type Presentation } from "./ipad-fab-actions";
import { CustomIcon } from "./assets/icons";
import { findDeepLinkTab, findRecordId, isDeepLink, parseDeepLink } from "./deep-link";
import { EditSurface, editAttrs, Mark, useEditOn, type EditSurfaceProps } from "./EditLayer";
import type { DraftAction, DraftState, DraftTab } from "./edit-draft";
import type { CompactEntry, LayoutEntry, ListViewEntry, PageEntry } from "./usePreviewEdit";
import { draftComponents, draftRecordTabs, sourceKey } from "./flexipage-draft";
import {
  ActivityPlanProgress,
  HomeEditVisitContext,
  HomeOpenContext,
  AgentforceWelcome,
  Announcements,
  EmptyArt,
  NextBestCustomers,
  RichText,
  UpNextMap,
  VisitsToSubmit,
} from "./IpadHome";

export type PublishedState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; result: PublishedResult };

/** Edit mode over the preview: selection, and — in Draft — the tab bar and Home menu with the tray laid on top. */
export interface PreviewEdit extends Omit<EditSurfaceProps, "children"> {
  draft: boolean;
  tabs: DraftTab[];
  homeMenu: DraftAction[];
  /** Page layouts read from the org, by name, for drawing and editing them in Draft. */
  layouts: Record<string, LayoutEntry>;
  /** Compact layouts (record headers) read from the org, by `Object.Name`. */
  compacts: Record<string, CompactEntry>;
  /** List views read from the org, by `Object.Name`. */
  listViews: Record<string, ListViewEntry>;
  /** Lightning pages (Home and record pages) read from the org, by developer name. */
  pages: Record<string, PageEntry>;
}

interface PublishedIpadPreviewProps {
  profile: string;
  state: PublishedState | undefined;
  onRefresh: (userId?: string) => void;
  onPickUser: (userId: string) => void;
  /** Edit mode; computed by the caller from the snapshot this preview reports through `state`. */
  edit?: PreviewEdit;
  /** Before / after: the published iPad beside the Draft one (Draft only). */
  split?: boolean;
}

/**
 * The iPad exactly as last published for one profile — tabs, Home page
 * components, and record pages read from the profile's metadata cache, laid
 * out the way LSC Mobile builds them. Record data is placeholder.
 */
export default function PublishedIpadPreview({ profile, state, onRefresh, onPickUser, edit, split }: PublishedIpadPreviewProps) {
  if (!state || state.status === "loading") {
    return <PublishedLoading profile={profile} />;
  }
  if (state.status === "error") {
    return (
      <StateView
        kind="error"
        title="Couldn't read the published configuration"
        detail={state.error}
        actions={
          <button type="button" className="studio-btn" onClick={() => onRefresh()}>
            Try again
          </button>
        }
      />
    );
  }
  const result = state.result;
  if ("missing" in result) {
    return (
      <StateView
        kind="empty"
        icon={CloudOff}
        title={`${profile} hasn't been published yet`}
        detail="It has no metadata cache, so its users can't sign in to LSC Mobile. Publish to iPad to create one."
      />
    );
  }
  return <Device key={result.viewer?.userId ?? ""} snapshot={result} onRefresh={() => onRefresh(result.viewer?.userId)} onPickUser={onPickUser} edit={edit} split={split && !!edit?.draft} />;
}

function Device({
  snapshot,
  onRefresh,
  onPickUser,
  edit,
  split,
}: {
  snapshot: PublishedIpad;
  onRefresh: () => void;
  onPickUser: (userId: string) => void;
  edit?: PreviewEdit;
  split?: boolean;
}) {
  // Draft adds the tabs the tray would add (drawn as "coming soon" until published).
  const allTabs = useMemo(() => (edit?.draft ? edit.tabs.map((d) => d.tab) : snapshot.tabs), [edit?.draft, edit?.tabs, snapshot.tabs]);
  const [current, setCurrent] = useState(snapshot.tabs[0]?.fullName ?? "");
  // The id of the open record ("" when the list row has no prefetched data); null shows the list.
  const [record, setRecord] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ChromeSheet | null>(null);
  const [newSheet, setNewSheet] = useState<Presentation | null>(null);
  const tab = allTabs.find((t) => t.fullName === current) ?? allTabs[0];
  const open = (t: PublishedTab) => {
    setCurrent(t.fullName);
    setRecord(null);
  };
  const note = (label: string, text: string) => setSheet({ kind: "note", label, text });
  // NotificationLinkOpener: deep links go to DeepLinkService (which dismisses the sheet first), web links to the in-app browser or Safari.
  const followLink = (url: string, target: string) => {
    if (!isDeepLink(url)) {
      if (/^(https?:)?\/\//i.test(url)) {
        const full = url.startsWith("//") ? `https:${url}` : url;
        setNewSheet(target === "_blank" ? { kind: "safari", url: full } : { kind: "browser", url: full, hideSafari: false });
      } else note("Link", `The app hands ${url} to iOS to open; Studio can't.`);
      return;
    }
    const nav = parseDeepLink(url);
    if (!nav) return note("Deep link", `Cannot parse deeplink URL: ${url}.`);
    if (nav.kind === "upsert") return note("Deep link", "This link creates or updates records from its parameters. Studio never writes records.");
    let dest: PublishedTab | undefined;
    if (nav.kind !== "modal") {
      dest = findDeepLinkTab(nav.tab, snapshot.tabs);
      if (!dest) return note("Deep link", `Cannot open deeplink URL ${url}. Tab is not available ${nav.tab.name}.`);
    }
    setSheet(null);
    if (dest) open(dest);
    if (nav.kind === "tab") return;
    const o = nav.object;
    if (o.kind === "new") return setNewSheet(newPresentation(`New ${o.sobject}`, o.sobject));
    const id = findRecordId(o.recordId, snapshot.records?.byId);
    if (id) setRecord(id);
    if (o.kind === "edit" && o.sobject.toLowerCase() === "visit") return setNewSheet({ kind: "visit", edit: id ?? o.recordId });
    if (!id) return note(o.sobject, `On the iPad this opens the ${o.sobject} record ${o.recordId}. Studio did not capture it for this snapshot (the preview holds the first records of each list), so it cannot be drawn here.`);
    if (o.kind === "edit") note(o.sobject, "On the iPad this opens the record's edit form. Studio never saves records.");
    if (o.kind === "quickAction") note(o.action, `On the iPad this runs the ${o.action} quick action on the record. Studio does not run it.`);
  };
  // UITabBarController in .tabBar mode: the tabs in a paged floating bar, search pinned last.
  const editing = !!edit?.on;
  const chromeTabs = useMemo<ChromeTab[]>(() => {
    const states = new Map(edit?.draft ? edit.tabs.map((d) => [d.tab.fullName, d.state]) : []);
    return allTabs
      .map((t, index) => ({ t, index }))
      .filter(({ t }) => t.kind !== "recent")
      .map(({ t, index }) => {
        const state = states.get(t.fullName);
        return {
          key: t.fullName,
          label: t.label,
          title: t.fullName,
          className: state === "removed" ? " ghost" : state === "added" || state === "moved" ? " pending" : "",
          attrs: editAttrs(
            editing,
            { kind: "tab", fullName: t.fullName, label: t.label, index },
            true,
            edit?.draft ? { family: "tabs", id: t.fullName, ghost: state === "removed", horizontal: true } : undefined
          ),
        };
      });
  }, [allTabs, edit?.draft, edit?.tabs, editing]);
  const layoutEdits = useMemo(
    () => (edit?.on ? { draft: edit.draft, layouts: edit.layouts, compacts: edit.compacts, listViews: edit.listViews, pages: edit.pages } : null),
    [edit?.on, edit?.draft, edit?.layouts, edit?.compacts, edit?.listViews, edit?.pages]
  );
  // Before / after: the published side follows the Draft side's tab, record and scrolling, and isn't selectable.
  const publishedTabs = useMemo<ChromeTab[]>(
    () => snapshot.tabs.filter((t) => t.kind !== "recent").map((t) => ({ key: t.fullName, label: t.label, title: t.fullName, className: "", attrs: {} })),
    [snapshot.tabs]
  );
  const pages = useRef<[HTMLDivElement | null, HTMLDivElement | null]>([null, null]);
  const mirror = (side: 0 | 1) => (e: React.UIEvent) => mirrorScroll(e.target as Element, pages.current[side], pages.current[side ? 0 : 1]);
  // The app gates Agentforce on the user-info "Agentforce" feature flag, which the CLI can't read; a Home welcome component stands in for it.
  const homeHasAgentforce = !!snapshot.home?.regions.some((r) => r.components.some((c) => c.supported && /lsAgentforceWelcome$/.test(c.name)));
  const generated = snapshot.cache.generatedAt ? new Date(snapshot.cache.generatedAt).toLocaleString() : "unknown";
  const screen = (published: boolean) => {
    const shown = published ? (snapshot.tabs.find((t) => t.fullName === current) ?? snapshot.tabs[0]) : tab;
    const home = shown?.kind === "home" && !!snapshot.home && record === null;
    const side = published ? 0 : 1;
    return (
      <IpadScreen label={!published && edit?.draft ? "iPad preview (draft)" : "iPad preview (published)"}>
        <IpadStatusBar />
        <IpadTopBar
          tabs={published ? publishedTabs : chromeTabs}
          current={shown?.fullName ?? ""}
          onOpen={(key) => {
            const t = allTabs.find((x) => x.fullName === key);
            if (t) open(t);
          }}
          searchKey={snapshot.tabs.find((t) => t.kind === "recent")?.fullName}
          onBack={record !== null ? () => setRecord(null) : undefined}
          name={initials(snapshot.viewer?.name ?? snapshot.profile)}
          onBriefings={() => setSheet({ kind: "briefings" })}
          briefingsOpen={!published && sheet?.kind === "briefings"}
          onBell={() => setSheet({ kind: "alerts" })}
          onAvatar={() => setSheet({ kind: "profile" })}
        />
        <div
          ref={split ? (el) => void (pages.current[side] = el) : undefined}
          onScrollCapture={split ? mirror(side) : undefined}
          className={`studio-ipad-page${shown?.kind === "empty" ? " blank" : ""}${home ? " home" : ""}${shown?.kind === "reports" && snapshot.reports ? " flush" : ""}${record === null && hasNativeScreen(shown, snapshot) ? " native" : ""}${record === null && isLwcOnly(shown, snapshot) ? " lwc-full" : ""}${record && snapshot.records?.byId[record] ? " record" : ""}`}
        >
          {shown && <Screen key={shown.fullName} tab={shown} snapshot={snapshot} record={record} onOpenRecord={setRecord} onNew={(label, objectName) => setNewSheet(newPresentation(label, objectName))} onNote={note} onAction={(item) => setNewSheet(presentationFor(item, { onRecord: true }))} onEditVisit={(id) => setNewSheet({ kind: "visit", edit: id })} />}
        </div>
        {/* Sheets open on the Draft side only. */}
        {!published && <ChromeSheets sheet={sheet} snapshot={snapshot} onClose={() => setSheet(null)} onLink={followLink} />}
        {!published && newSheet && <IpadActionSheet presentation={newSheet} ctx={{ snapshot, record: null }} onClose={() => setNewSheet(null)} />}
        <IpadFabs snapshot={snapshot} tab={shown} record={record} agentforce={homeHasAgentforce} homeMenu={!published && edit?.draft ? edit.homeMenu : undefined} />
      </IpadScreen>
    );
  };

  const draftSide = (
    <EditSurface on={editing} selected={edit?.selected ?? null} onSelect={edit?.onSelect ?? (() => {})} also={edit?.also} name={edit?.name} verbs={edit?.verbs ?? []} onRun={edit?.onRun ?? (() => {})} setup={edit?.setup} onSetup={edit?.onSetup} horizontal={edit?.horizontal} onDrop={edit?.onDrop}>
      <LayoutEdits.Provider value={layoutEdits}>{screen(false)}</LayoutEdits.Provider>
    </EditSurface>
  );

  return (
    <div className="studio-ipad-wrap">
      <div className="studio-ipad-meta">
        Published for <strong>{snapshot.profile}</strong>
        {snapshot.viewer ? (
          <>
            {" "}
            as{" "}
            <select
              className="studio-select studio-ipad-viewer"
              value={snapshot.viewer.userId}
              onChange={(e) => onPickUser(e.target.value)}
              title={`Permission sets merged in: ${snapshot.viewer.permissionSets.join(", ") || "none"}`}
            >
              {[...snapshot.users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <span className="studio-ipad-muted"> ({snapshot.viewer.permissionSets.length} permission sets)</span>
          </>
        ) : (
          <span className="studio-ipad-muted"> · no active users, so no permission sets are merged in</span>
        )}
        <span className="studio-ipad-muted">
          {" "}
          · {snapshot.cache.name}, generated {generated}
        </span>
        {snapshot.hiddenTabs.length > 0 && (
          <span
            className="studio-ipad-muted"
            title={snapshot.hiddenTabs.map((h) => `${h.label} — ${h.reason}`).join("\n")}
          >
            {" "}
            · {snapshot.hiddenTabs.length} tabs not shown
          </span>
        )}
        <button type="button" className="studio-btn ghost sm studio-ipad-reload" onClick={onRefresh}>
          <RotateCw aria-hidden="true" />
          Reload
        </button>
      </div>

      {split ? (
        <div className="studio-ipad-split">
          <div className="studio-ipad-side">
            <div className="studio-ipad-side-label">Published</div>
            {screen(true)}
          </div>
          <div className="studio-ipad-side">
            <div className="studio-ipad-side-label">Draft</div>
            {draftSide}
          </div>
        </div>
      ) : (
        draftSide
      )}

      <ul className="studio-ipad-legend">
        <li>
          <span className="studio-ipad-swatch conditional" /> Shown only when its visibility rule passes
        </li>
      </ul>
      <p className="studio-ipad-note">
        Read from the metadata cache {snapshot.profile} downloads — tabs, page components, layouts, and list views are
        what the app renders; record data is placeholder. {snapshot.notes.join(" ")}
      </p>
    </div>
  );
}

function Screen({
  tab,
  snapshot,
  record,
  onOpenRecord,
  onNew,
  onNote,
  onAction,
  onEditVisit,
}: {
  tab: PublishedTab;
  snapshot: PublishedIpad;
  record: string | null;
  onOpenRecord: (id: string) => void;
  onNew: (label: string, objectName: string) => void;
  onNote: (label: string, text: string) => void;
  onAction: (item: PublishedFabItem) => void;
  onEditVisit: (id: string) => void;
}) {
  // An open record takes precedence over the tab's native screen (the Accounts cards open their record).
  if (record !== null && snapshot.records?.byId[record]) return <RecordScreen snapshot={snapshot} recordId={record} onOpenRecord={onOpenRecord} />;
  if (record === null && hasNativeScreen(tab, snapshot)) return <NativeScreen tab={tab} snapshot={snapshot} onOpenRecord={onOpenRecord} />;
  switch (tab.kind) {
    case "home":
      return snapshot.home ? (
        <HomeOpenContext.Provider
          value={(id) => {
            if (snapshot.records?.byId[id]) return onOpenRecord(id);
            const visit = !id.startsWith("001");
            onNote(visit ? "Visit" : "Account", `On the iPad this opens the ${visit ? "visit" : "account"} record. Studio did not capture it for this snapshot (the preview holds the first records of each list), so it cannot be drawn here.`);
          }}
        >
          <HomeEditVisitContext.Provider value={onEditVisit}>
            <PageView page={snapshot.home} snapshot={snapshot} home />
          </HomeEditVisitContext.Provider>
        </HomeOpenContext.Provider>
      ) : (
        <Native title="Home" text="Home page" />
      );
    case "flexiPage": {
      const page = tab.flexiPage ? snapshot.pages[tab.flexiPage] : undefined;
      if (record === null && isLwcOnly(tab, snapshot)) return <LwcFull name={tab.label} />;
      return page ? <PageView page={page} snapshot={snapshot} title={tab.label} /> : <Native title={tab.label} text="Lightning page" />;
    }
    case "object":
    case "accounts": {
      const object = snapshot.objects[tab.kind === "accounts" ? "Account" : (tab.sobject ?? "")];
      if (!object) return <Native title={tab.label} text={`${tab.sobject ?? "Object"} list`} />;
      if (record !== null && snapshot.records?.byId[record]) return <RecordScreen snapshot={snapshot} recordId={record} onOpenRecord={onOpenRecord} />;
      return record !== null ? (
        <RecordView object={object} snapshot={snapshot} />
      ) : (
        <ListView tab={tab} object={object} lists={snapshot.lists} accounts={tab.kind === "accounts"} onOpenRecord={onOpenRecord} onNew={onNew} cardActions={rowActions(snapshot, object.name)} onAction={onAction} />
      );
    }
    case "empty":
      return <ComingSoon reason={tab.emptyReason} />;
    case "recent":
      return <SearchTab />;
    case "reports":
      // ReportsTabCoordinator: the report tree with ShowSalesforceReports, else the Sales Chart report.
      if (snapshot.reports) return <ReportsTree items={snapshot.reports} />;
      return <Native title={tab.label} text={snapshot.settings?.reports.salesforceReports === false ? "Sales Chart (native screen)" : "Reports (native screen)"} />;
    default:
      return <Native title={tab.label} text={NATIVE_SCREENS[tab.kind] ?? tab.label} />;
  }
}

const NATIVE_SCREENS: Partial<Record<PublishedTab["kind"], string>> = {
  calendar: "Planner — calendar, routines, and the account panel (native screen)",
  content: "Intelligent Content — presentation grid (native screen)",
  myTeam: "My Team (native screen)",
  activityPlanReview: "Activity plan review (native screen)",
  compliance: "Account compliance (native screen)",
  reports: "Reports (native screen)",
  salesData: "Sales data (native screen)",
  dashboards: "Dashboards (native screen)",
  tableau: "Tableau (native screen)",
  insights: "Medical insights (native screen)",
};

/** FancyEmptyViewController — what the app shows for a tab it can't route. */
function ComingSoon({ reason }: { reason?: string }) {
  return (
    <>
      <div className="studio-ipad-coming-soon">Coming soon</div>
      {reason && <div className="studio-ipad-warn studio-ipad-coming-soon-reason">{reason}</div>}
    </>
  );
}

/** A flexipage tab whose regions hold only inline LWC (no native components): the app shows the web view full bleed. */
function isLwcOnly(tab: PublishedTab, snapshot: PublishedIpad): boolean {
  if (tab.kind !== "flexiPage" || !tab.flexiPage) return false;
  const page = snapshot.pages[tab.flexiPage];
  if (!page) return false;
  const all = page.regions.flatMap((r) => r.components);
  return all.length > 0 && all.every((c) => /^lscmobileinline_/i.test(c.name));
}

/** Pat Sim and similar: the LWC runs in the app's web view, which Studio cannot execute. */
function LwcFull({ name }: { name: string }) {
  return (
    <div className="studio-ipad-lwc-full">
      <div className="studio-ipad-lwc-full-name">{name}</div>
      <div className="studio-ipad-lwc-full-note">This page is a Lightning web component that runs inside the app. Studio cannot run it, so its content is not shown.</div>
    </div>
  );
}

function Native({ title, text }: { title: string; text: string }) {
  return (
    <>
      <Head title={title} />
      <div className="studio-ipad-ph fill">{text}</div>
    </>
  );
}

function Head({ eyebrow, title, theme, children }: { eyebrow?: string; title: string; theme?: PublishedObject["theme"]; children?: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="studio-ipad-row-between">
      <div className="studio-ipad-head">
        {/* MetadataThemeInfo.icon(style: .circular): the SLDS glyph on a circle of the object's color. */}
        <span className="studio-ipad-obj-icon" style={theme ? { background: theme.color } : undefined} aria-hidden="true">
          {theme && /work_plan_selection_rule/.test(theme.iconUrl) ? <CustomIcon /> : theme && !broken ? <img src={theme.iconUrl} alt="" onError={() => setBroken(true)} /> : title.slice(0, 1)}
        </span>
        <div>
          {eyebrow && <div className="studio-ipad-eyebrow">{eyebrow}</div>}
          <span className="studio-ipad-title">{title}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Lightning pages ───────────────────────────────────────────────────────────

/** Components the iPad skips, for the "not shown" footer. */
function skipped(page: PublishedPage): string[] {
  const out: string[] = [];
  const walk = (cs: PublishedComponent[]) => {
    for (const c of cs) {
      if (!c.supported) out.push(c.label);
      else if (c.visibility === "hidden") out.push(`${c.label} (visibility rule)`);
      c.tabs?.forEach((t) => walk(t.components));
    }
  };
  page.regions.forEach((r) => walk(r.components));
  return out;
}

function PageView({
  page,
  snapshot,
  home = false,
  title,
  object,
  layout,
  multi,
}: {
  page: PublishedPage;
  snapshot: PublishedIpad;
  home?: boolean;
  title?: string;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  const notShown = skipped(page);
  const dropped = page.droppedRegions.flatMap((r) => r.components.map((c) => `${c} (${r.name} region)`));
  const rendered = page.regions.flatMap((r) => r.components).filter((c) => c.supported && c.visibility !== "hidden");
  return (
    <>
      {title && <Head title={title} />}
      {rendered.length === 0 ? (
        <div className="studio-ipad-ph fill">There are no supported lightning components configured for this page.</div>
      ) : (
        page.regions.map((r) => (
          <Region key={r.name} page={page} region={r.name} components={r.components} home={home} snapshot={snapshot} object={object} layout={layout} multi={multi} />
        ))
      )}
      {(notShown.length > 0 || dropped.length > 0) && (
        <div className="studio-ipad-hint" title={[...notShown, ...dropped].join("\n")}>
          Not shown on iPad: {[...notShown, ...dropped].join(", ")}
        </div>
      )}
    </>
  );
}

/** SFLayoutScrollRegion.addHomeComponent — half-width Home components pair up two per row. */
function Region({
  page,
  region,
  components,
  home,
  snapshot,
  object,
  layout,
  multi,
}: {
  page: PublishedPage;
  region: string;
  components: PublishedComponent[];
  home: boolean;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  // In Draft the tray's arrangement, with removed blocks as ghosts and inserted ones drawn as placeholders.
  const pd = usePageDraft(page.name);
  const drawn = (pd ? draftComponents(pd, components) : asDrawn(components)).filter((d) => d.value.supported && d.value.visibility !== "hidden");
  const shown = drawn.map((d) => d.value);
  const stateOf = (c: PublishedComponent) => drawn[shown.indexOf(c)];
  const target = (c: PublishedComponent) => ({
    kind: "component" as const,
    page: page.name,
    pageLabel: page.label,
    region,
    index: shown.indexOf(c),
    count: shown.length,
    name: c.name,
    label: c.properties.label || c.properties.title || c.label,
    home,
    visibility: c.visibility === "conditional" ? ("conditional" as const) : ("shown" as const),
    ...(c.visibilityNote ? { visibilityNote: c.visibilityNote } : {}),
    ...blockIdentity(c, stateOf(c)),
  });
  const card = (c: PublishedComponent, key: number) => {
    const state = stateOf(c).state;
    // A tab set and the record header aren't one block: their parts are marked inside.
    if (c.tabs || /(^|:)highlightsPanel$/.test(c.name))
      return <ComponentCard key={key} page={page} c={c} snapshot={snapshot} object={object} layout={layout} multi={multi} />;
    const node = <ComponentCard page={page} c={c} snapshot={snapshot} object={object} layout={layout} multi={multi} />;
    return (
      <Mark key={key} target={target(c)}>
        {state === "same" ? node : <div className={`studio-ipad-draft-block${draftClass(state)}`}>{node}</div>}
      </Mark>
    );
  };
  const rows: PublishedComponent[][] = [];
  for (const c of shown) {
    const last = rows[rows.length - 1];
    if (home && c.halfWidth && last && last.length === 1 && last[0].halfWidth) last.push(c);
    else rows.push([c]);
  }
  return (
    <>
      {rows.map((row, i) =>
        row.length === 2 || (home && row[0].halfWidth) ? (
          <div key={i} className="studio-ipad-pair">
            {row.map((c, j) => card(c, j))}
          </div>
        ) : (
          card(row[0], i)
        )
      )}
    </>
  );
}

function ComponentCard({
  page,
  c,
  snapshot,
  object,
  layout,
  multi,
}: {
  page: PublishedPage;
  c: PublishedComponent;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  const cls = `studio-ipad-card studio-ipad-comp${c.visibility === "conditional" ? " conditional" : ""}`;
  const name = c.name.replace(/^.*:/, "");
  const p = c.properties;

  if (c.tabs) return <TabSet page={page} tabs={c.tabs} snapshot={snapshot} object={object} layout={layout} multi={multi} />;
  if (name === "highlightsPanel") return null; // drawn by the record header
  if (name === "multiEntityRecordView" && multi) {
    if (multi.error) return <div className={cls}>{multi.error}</div>;
    return (
      <>
        {multi.layouts.map((l) => (
          <LayoutSections key={l.name} layout={l} />
        ))}
      </>
    );
  }
  if (/(detailPanel|multiEntityRecordView)$/.test(name))
    return layout ? <LayoutSections layout={layout} /> : <div className={cls}>Record details</div>;
  if (name === "relatedListContainer")
    return (
      <div className={cls}>
        <strong>Related</strong>
        {(layout?.relatedLists ?? []).map((r) => (
          <div key={r.name} className="studio-ipad-row-between studio-ipad-related">
            <span>{r.label}</span>
            <span className="studio-ipad-muted">(0)</span>
          </div>
        ))}
      </div>
    );
  if (name === "relatedListSingleContainer" || name === "dynamicRelatedList") {
    const api = p.relatedListApiName ?? "";
    const match = layout?.relatedLists.find((r) => r.name.split(".")[0].toLowerCase() === api.replace(/s$/, "").toLowerCase());
    return (
      <div className={`${cls} studio-ipad-row-between`}>
        <strong>{match?.label ?? (api || "Related list")}</strong>
        <span className="studio-ipad-muted">(0)</span>
      </div>
    );
  }
  if (/nbctopcards$/i.test(name)) return <NextBestCustomers totalCards={Number(p.totalCards) || 10} data={snapshot.screens?.home?.nbc} />;
  // AgentforceWelcomeViewModel: every non-empty property becomes a prompt chip.
  if (name === "lsAgentforceWelcome") return <AgentforceWelcome prompts={Object.values(p).filter(Boolean)} viewerName={snapshot.viewer?.name} />;
  if (name === "lscHomeAnnouncements") return <Announcements />;
  if (name === "richText") return <RichText html={p.richTextValue ?? ""} />;
  if (name === "UpNextMapDisplay") return <UpNextMap />;
  if (name === "embeddedDashboard") return <Dashboard dashboard={snapshot.dashboards[p.dashboardName ?? ""]} />;
  if (name === "ActivityPlanByProduct") return <ActivityPlanProgress enhanced={p.showEnhActivityPlanOnMobileHomepage === "true"} plan={snapshot.screens?.home?.plan} />;
  if (name === "UnsubmittedVisits") return <VisitsToSubmit data={snapshot.screens?.home?.visits} />;
  return (
    <div className={cls}>
      <strong>{p.label || p.title || c.label}</strong>
      <div className="studio-ipad-ph mid" />
      {c.visibilityNote && <div className="studio-ipad-hint">{c.visibilityNote}</div>}
    </div>
  );
}

function TabSet({
  page,
  tabs,
  snapshot,
  object,
  layout,
  multi,
}: {
  page: PublishedPage;
  tabs: NonNullable<PublishedComponent["tabs"]>;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  const pd = usePageDraft(page.name);
  const drawn = pd ? draftRecordTabs(pd, tabs) : asDrawn(tabs);
  const first = Math.max(0, drawn.findIndex((t) => t.value.active));
  const [i, setI] = useState(first);
  const tab = drawn[Math.min(i, drawn.length - 1)]?.value;
  if (!tab) return null;
  return (
    <>
      <div className="studio-ipad-chips">
        {drawn.map(({ value: t, state }, j) => (
          <Mark
            key={j}
            target={{
              kind: "recordTab",
              page: page.name,
              pageLabel: page.label,
              title: t.title,
              index: j,
              count: drawn.length,
              active: t.active,
              ...(t.source ? { source: sourceKey(t.source) } : {}),
            }}
          >
            <button type="button" className={`studio-ipad-chip${t === tab ? " current" : ""}${draftClass(state)}`} onClick={() => setI(j)}>
              {t.title}
            </button>
          </Mark>
        ))}
      </div>
      <Region page={page} region={`${tab.title} tab`} components={tab.components} home={false} snapshot={snapshot} object={object} layout={layout} multi={multi} />
      {tab.components.some((c) => !c.supported) && (
        <div className="studio-ipad-hint">
          Not shown on iPad: {tab.components.filter((c) => !c.supported).map((c) => c.label).join(", ")}
        </div>
      )}
    </>
  );
}

/** The layouts a multiEntityRecordView stacks, in order, or the error it shows instead. */
type MultiEntity = { layouts: PublishedLayout[]; error?: string };

function LayoutSections({ layout }: { layout: PublishedLayout }) {
  return (
    <>
      {layout.sections.map((s, i) => (
        <Mark key={i} target={{ kind: "section", layout: layout.name, index: i, count: layout.sections.length, label: s.label }}>
          <div className="studio-ipad-card">
            {s.label && <strong>{s.label}</strong>}
            <div className="studio-ipad-columns">
              {s.columns.map((col, j) => (
                <div key={j}>
                  {col.map((f) => (
                    <Mark key={f} target={{ kind: "field", layout: layout.name, section: s.label, field: f, label: f }}>
                      <div className="studio-ipad-field">
                        <span className="studio-ipad-hint">{f}</span>
                        <span className="studio-ipad-ph line" />
                      </div>
                    </Mark>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Mark>
      ))}
    </>
  );
}

// ── Lists and records ─────────────────────────────────────────────────────────

/** AllSObjectsViewController: header, search row, list view chips, then the data table. */
function ListView({
  tab,
  object,
  lists,
  accounts,
  onOpenRecord,
  onNew,
  cardActions,
  onAction,
}: {
  cardActions?: PublishedFabItem[];
  onAction?: (item: PublishedFabItem) => void;
  tab: PublishedTab;
  object: PublishedObject;
  lists?: Record<string, PublishedListData>;
  accounts: boolean;
  onOpenRecord: (id: string) => void;
  onNew: (label: string, objectName: string) => void;
}) {
  const editing = useEditOn();
  const edits = useContext(LayoutEdits);
  const [viewName, setViewName] = useState(object.defaultListView);
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState(() => cardModeFor(object.name));
  const [sort, setSort] = useState<SortState | null>(null);
  const view = object.listViews.find((l) => l.name === viewName) ?? object.listViews[0];
  // A list named "All" is titled "All <plural>".
  const title = !view ? object.labelPlural : view.label === "All" ? `All ${object.labelPlural}` : view.label;
  return (
    <div className="studio-ipad-lv">
      <Head eyebrow={tab.label} title={title} theme={object.theme}>
        <button type="button" className="studio-ipad-outline-btn" onClick={() => onNew(`New ${accounts ? "Account" : object.label}`, object.name)}>New{accounts ? " Account" : ""}</button>
      </Head>
      <div className="studio-ipad-lv-search">
        <IpadSearchField value={query} onChange={setQuery} />
        <span className="studio-ipad-lv-right">
          <ViewModeButton cards={cards} onToggle={() => { saveCardMode(object.name, !cards); setCards(!cards); }} />
          {cards && view && <SortButton columns={view.columns.map(columnLabel)} sort={sort ?? { column: 0, ascending: true }} onSort={setSort} />}
        </span>
      </div>
      {/* The chip row is hidden when there's only one list view. */}
      {object.listViews.length > 1 && !query && (
        <div
          className="studio-ipad-lv-chips"
          title={object.hiddenListViews?.length ? `Not shown to this user:\n${object.hiddenListViews.map((h) => `${h.label} — ${h.reason}`).join("\n")}` : undefined}
        >
          {object.listViews.map((l) => (
            <button
              key={l.name}
              type="button"
              className={`studio-ipad-lv-chip${l.name === view?.name ? " current" : ""}`}
              onClick={() => setViewName(l.name)}
              {...editAttrs(editing, { kind: "listView", object: object.name, name: l.name, label: l.label }, true)}
            >
              {l.label}
              {lists?.[`${object.name}.${l.name}`] && <ListCount count={lists[`${object.name}.${l.name}`].count} />}
            </button>
          ))}
        </div>
      )}
      {view &&
        (() => {
          const data = lists?.[`${object.name}.${view.name}`];
          // The search field filters the loaded rows on any cell (didEnterSearchText); placeholder rows have nothing to match.
          const q = query.trim().toLowerCase();
          const filtered = data && q ? { ...data, rows: data.rows.filter((r) => r.cells.some((c) => c?.toLowerCase().includes(q))) } : data;
          const shown = filtered && sort ? { ...filtered, rows: sortRows(filtered.rows, sort) } : filtered;
          if (shown?.rows.length === 0) {
            // AllSObjectsViewController.updateEmptyStateVisibilityIfRequired: an empty list hides the table for APEmptyPlaceholder.
            return (
              <div className="studio-ipad-h-empty studio-ipad-lv-empty">
                <EmptyArt height={192} />
                <div className="studio-ipad-h-empty-title">No records to display</div>
              </div>
            );
          }
          if (cards && shown) {
            return <CardList rows={shown.rows} onOpen={onOpenRecord} actions={cardActions} onAction={onAction} links={(view.query?.fields ?? []).map((f) => f?.type === "lookup" || f?.type === "formula")} />;
          }
          // A column is selectable once the view says which field it is (its source); Draft lays the tray's column edits over it.
          const fullName = view.source?.fullName;
          const entry = fullName && edits?.draft ? edits.listViews?.[fullName] : undefined;
          const spec = (id: string, label: string, state?: DraftState): TableCol["attrs"] =>
            editing && fullName && id
              ? editAttrs(
                  true,
                  { kind: "listColumn", object: object.name, listView: fullName, viewLabel: view.label, column: id, label, added: state === "added" },
                  false,
                  edits?.draft ? { family: `listcols:${fullName}`, id, ghost: state === "removed", horizontal: true } : undefined
                )
              : undefined;
          const cols: TableCol[] =
            entry?.status === "ready"
              ? entry.columns.map((c) => ({ label: columnLabel(c.label), orig: c.orig, state: c.state, attrs: spec(c.id, columnLabel(c.label), c.state) }))
              : view.columns.map((c, i) => ({ label: columnLabel(c), orig: i, attrs: spec(view.source?.columns[i] ?? "", columnLabel(c)) }));
          return <DataTable columns={cols} data={shown} onOpenRecord={onOpenRecord} />;
        })()}
    </div>
  );
}

/** Placeholder widths for a cell, so rows read as data without inventing any. */
const CELL_WIDTHS = [62, 48, 74, 40, 56, 68, 44, 52];

/**
 * DataTableView in table mode: 37pt header, 44pt rows, each column the table's
 * width split evenly but never under 250pt (wider tables scroll sideways).
 * Sorted by the first column, ascending, like a list view with no configured sort.
 */
/** TabCellContent's count: a Capsule, or a Circle under 10. */
function ListCount({ count }: { count: number }) {
  return <span className={`studio-ipad-lv-count${count < 10 ? " single" : ""}`}>{count}</span>;
}

/** A column as drawn: `orig` is its place in the published rows' cells (null: added in Draft, nothing to show yet). */
interface TableCol {
  label: string;
  orig: number | null;
  state?: DraftState;
  attrs?: Record<string, string>;
}

function DataTable({ columns, data, onOpenRecord }: { columns: TableCol[]; data?: PublishedListData; onOpenRecord: (id: string) => void }) {
  const width = `max(250px, calc(100% / ${Math.max(columns.length, 1)}))`;
  return (
    <div className="studio-ipad-table">
      <div className="studio-ipad-table-row head">
        {columns.map((c, i) => (
          <span key={i} className={`studio-ipad-table-cell${i === 0 ? " sorted" : ""}${draftClass(c.state)}`} style={{ width, flex: "none" }} {...c.attrs}>
            {c.label}
            {i === 0 && <span className="studio-ipad-sort" aria-label="Sorted ascending">↑</span>}
          </span>
        ))}
      </div>
      {data?.rows.map((row) => (
        <button key={row.id} type="button" className="studio-ipad-table-row" onClick={() => onOpenRecord(row.id)}>
          {columns.map((c, i) => (
            <span key={i} className={`studio-ipad-table-cell value${draftClass(c.state)}`} style={{ width, flex: "none" }}>
              {c.orig === null ? null : row.cells[c.orig]}
            </span>
          ))}
        </button>
      ))}
      {!data && Array.from({ length: 14 }, (_, r) => (
        <button key={r} type="button" className="studio-ipad-table-row" onClick={() => onOpenRecord("")}>
          {columns.map((_, i) => (
            <span key={i} className="studio-ipad-table-cell" style={{ width, flex: "none" }}>
              <span className="studio-ipad-ph line" style={{ width: `${CELL_WIDTHS[(r * 3 + i * 5) % CELL_WIDTHS.length]}%` }} />
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}

/** List view columns are field labels; older caches give API names (`ACCOUNT.NAME`, `Field__c`). */
function columnLabel(c: string): string {
  if (!/^[A-Z0-9_.]+$|__[cr]$|\./.test(c)) return c;
  const last = c.split(".").pop() ?? c;
  return last
    .replace(/__c$|__pc$/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (m) => m.toUpperCase());
}

function RecordView({ object, snapshot }: { object: PublishedObject; snapshot: PublishedIpad }) {
  const [rtName, setRtName] = useState(object.recordTypes[0]?.name ?? "");
  const rt = object.recordTypes.find((r) => r.name === rtName);
  const layout = rt?.layout ? snapshot.layouts[rt.layout] : undefined;
  const page = rt?.flexiPage ? snapshot.pages[rt.flexiPage] : undefined;
  const multi = useMemo<MultiEntity | undefined>(
    () =>
      rt?.multiEntity && {
        error: rt.multiEntity.error,
        layouts: rt.multiEntity.layouts.map((l) => snapshot.layouts[l]).filter((l): l is PublishedLayout => !!l),
      },
    [rt, snapshot]
  );
  const compactName = rt?.compactLayout ?? object.defaultCompactLayout;
  const highlights = useMemo(
    () => (compactName ? (snapshot.compactLayouts[`${object.name}.${compactName}`] ?? []) : []),
    [snapshot, object.name, compactName]
  );
  return (
    <>
      <Head eyebrow={object.label} title={`Sample ${object.label.toLowerCase()}`} theme={object.theme}>
        {object.recordTypes.length > 1 && (
          <label className="studio-ipad-hint">
            Record type{" "}
            <select value={rtName} onChange={(e) => setRtName(e.target.value)}>
              {[...object.recordTypes].sort((a, b) => a.label.localeCompare(b.label)).map((r) => (
                <option key={r.name} value={r.name}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </Head>
      {highlights.length > 0 && (
        <Mark target={{ kind: "highlights", object: object.name, compactLayout: compactName ?? null, fields: highlights }}>
          <div className="studio-ipad-highlights">
            {highlights.map((h) => (
              <div key={h} className="studio-ipad-field">
                <span className="studio-ipad-hint">{h}</span>
                <span className="studio-ipad-ph line" />
              </div>
            ))}
          </div>
        </Mark>
      )}
      {layout && layout.actions.length > 0 && (
        <div className="studio-ipad-hint">Layout actions: {layout.actions.join(" · ")}</div>
      )}
      {page ? (
        <PageView page={page} snapshot={snapshot} object={object} layout={layout} multi={multi} />
      ) : layout ? (
        <LayoutSections layout={layout} />
      ) : (
        <div className="studio-ipad-ph fill">No page layout is assigned for this record type.</div>
      )}
      <div className="studio-ipad-hint">
        {page ? `Lightning page ${page.label}` : "No Lightning page — the layout's details panel"}
        {layout ? ` · layout ${layout.name}` : ""}
        {rt?.multiEntity?.note ? ` · ${rt.multiEntity.note}` : ""}
        {object.name === "Visit" ? " · new Visits open in Visit Engagement" : ""}
      </div>
    </>
  );
}

/** SObjectsCoordinator.showAddNewScreen: Inquiry opens its record type picker; other objects open the create form, which Studio can't run. */
function newPresentation(label: string, objectName: string): Presentation {
  if (/inquir/i.test(objectName)) return { kind: "inquiry" };
  if (objectName === "Visit") return { kind: "visit" };
  return { kind: "placeholder", title: label, type: "Create form", target: objectName, detail: "The app opens the object's create form here; Studio never saves records." };
}

/**
 * Scrolls the other side of the before / after view to match: the page itself,
 * or the scroller inside it with the same class at the same place. Blocks the
 * Draft adds or removes shift things a little; it's kept in step, not exact.
 */
function mirrorScroll(el: Element, from: HTMLElement | null, to: HTMLElement | null) {
  if (!from || !to) return;
  let twin: Element | undefined = to;
  if (el !== from) {
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    if (!classes.length) return;
    const sel = classes.map((c) => `.${CSS.escape(c)}`).join("");
    twin = to.querySelectorAll(sel)[[...from.querySelectorAll(sel)].indexOf(el)];
  }
  if (!twin) return;
  // The twin's own scroll event comes back here and stops: the positions already match.
  if (Math.abs(twin.scrollTop - el.scrollTop) > 1) twin.scrollTop = el.scrollTop;
  if (Math.abs(twin.scrollLeft - el.scrollLeft) > 1) twin.scrollLeft = el.scrollLeft;
}
