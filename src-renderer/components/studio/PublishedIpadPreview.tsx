import React, { useMemo, useState } from "react";
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
import RecordScreen from "./IpadRecord";
import IpadFabs from "./IpadFabs";
import { Dashboard } from "./IpadDashboard";
import { ReportsTree } from "./IpadReports";
import { hasNativeScreen, NativeScreen } from "./screens";
import { IpadSearchField, IpadStatusBar, IpadTopBar, type ChromeTab } from "./IpadChrome";
import { initials } from "./ipad-chrome";
import { ChromeSheets, SearchTab, type ChromeSheet } from "./IpadChromeSheets";
import { CardList, cardModeFor, rowActions, saveCardMode, SortButton, sortRows, ViewModeButton, type SortState } from "./IpadListControls";
import IpadActionSheet from "./IpadActionSheets";
import type { Presentation } from "./ipad-fab-actions";
import { CustomIcon } from "./assets/icons";
import {
  ActivityPlanProgress,
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

interface PublishedIpadPreviewProps {
  profile: string;
  state: PublishedState | undefined;
  onRefresh: (userId?: string) => void;
  onPickUser: (userId: string) => void;
}

/**
 * The iPad exactly as last published for one profile — tabs, Home page
 * components, and record pages read from the profile's metadata cache, laid
 * out the way LSC Mobile builds them. Record data is placeholder.
 */
export default function PublishedIpadPreview({ profile, state, onRefresh, onPickUser }: PublishedIpadPreviewProps) {
  if (!state || state.status === "loading") {
    return <div className="studio-ipad-wrap studio-ipad-meta">Reading {profile}'s published iPad configuration…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="studio-ipad-wrap">
        <div className="studio-ipad-meta">Couldn't read the published configuration: {state.error}</div>
        <button type="button" className="studio-btn" onClick={() => onRefresh()}>
          Try again
        </button>
      </div>
    );
  }
  const result = state.result;
  if ("missing" in result) {
    return (
      <div className="studio-ipad-wrap studio-ipad-meta">
        {profile} has no published metadata cache, so its users can't sign in to LSC Mobile yet. Publish to iPad to
        create one.
      </div>
    );
  }
  return <Device key={result.viewer?.userId ?? ""} snapshot={result} onRefresh={() => onRefresh(result.viewer?.userId)} onPickUser={onPickUser} />;
}

function Device({
  snapshot,
  onRefresh,
  onPickUser,
}: {
  snapshot: PublishedIpad;
  onRefresh: () => void;
  onPickUser: (userId: string) => void;
}) {
  const [current, setCurrent] = useState(snapshot.tabs[0]?.fullName ?? "");
  // The id of the open record ("" when the list row has no prefetched data); null shows the list.
  const [record, setRecord] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ChromeSheet | null>(null);
  const [newSheet, setNewSheet] = useState<Presentation | null>(null);
  const tab = snapshot.tabs.find((t) => t.fullName === current) ?? snapshot.tabs[0];
  const open = (t: PublishedTab) => {
    setCurrent(t.fullName);
    setRecord(null);
  };
  // UITabBarController in .tabBar mode: the tabs in a paged floating bar, search pinned last.
  const chromeTabs = useMemo<ChromeTab[]>(
    () => snapshot.tabs.filter((t) => t.kind !== "recent").map((t) => ({ key: t.fullName, label: t.label, title: t.fullName })),
    [snapshot.tabs]
  );
  const onHome = tab?.kind === "home" && !!snapshot.home && record === null;
  // The app gates Agentforce on the user-info "Agentforce" feature flag, which the CLI can't read; a Home welcome component stands in for it.
  const homeHasAgentforce = !!snapshot.home?.regions.some((r) => r.components.some((c) => c.supported && /lsAgentforceWelcome$/.test(c.name)));
  const generated = snapshot.cache.generatedAt ? new Date(snapshot.cache.generatedAt).toLocaleString() : "unknown";

  return (
    <div className="studio-ipad-wrap">
      <div className="studio-ipad-meta">
        Published for <strong>{snapshot.profile}</strong>
        {snapshot.viewer ? (
          <>
            {" "}
            as{" "}
            <select
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
        <button type="button" className="studio-link-btn" onClick={onRefresh}>
          Reload
        </button>
      </div>

      <IpadScreen label="iPad preview (published)">
        <IpadStatusBar />
        <IpadTopBar
          tabs={chromeTabs}
          current={tab?.fullName ?? ""}
          onOpen={(key) => {
            const t = snapshot.tabs.find((x) => x.fullName === key);
            if (t) open(t);
          }}
          searchKey={snapshot.tabs.find((t) => t.kind === "recent")?.fullName}
          onBack={record !== null ? () => setRecord(null) : undefined}
          name={initials(snapshot.viewer?.name ?? snapshot.profile)}
          onBriefings={() => setSheet({ kind: "briefings" })}
          briefingsOpen={sheet?.kind === "briefings"}
          onBell={() => setSheet({ kind: "alerts" })}
          onAvatar={() => setSheet({ kind: "profile" })}
        />
        <div className={`studio-ipad-page${tab?.kind === "empty" ? " blank" : ""}${onHome ? " home" : ""}${tab?.kind === "reports" && snapshot.reports ? " flush" : ""}${record === null && hasNativeScreen(tab, snapshot) ? " native" : ""}${record === null && isLwcOnly(tab, snapshot) ? " lwc-full" : ""}${record && snapshot.records?.byId[record] ? " record" : ""}`}>
          {tab && <Screen key={tab.fullName} tab={tab} snapshot={snapshot} record={record} onOpenRecord={setRecord} onNew={(label, objectName) => setNewSheet(newPresentation(label, objectName))} />}
        </div>
        <ChromeSheets sheet={sheet} snapshot={snapshot} onClose={() => setSheet(null)} />
        {newSheet && <IpadActionSheet presentation={newSheet} ctx={{ snapshot, record: null }} onClose={() => setNewSheet(null)} />}
        <IpadFabs snapshot={snapshot} tab={tab} record={record} agentforce={homeHasAgentforce} />
      </IpadScreen>

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
}: {
  tab: PublishedTab;
  snapshot: PublishedIpad;
  record: string | null;
  onOpenRecord: (id: string) => void;
  onNew: (label: string, objectName: string) => void;
}) {
  // An open record takes precedence over the tab's native screen (the Accounts cards open their record).
  if (record !== null && snapshot.records?.byId[record]) return <RecordScreen snapshot={snapshot} recordId={record} />;
  if (record === null && hasNativeScreen(tab, snapshot)) return <NativeScreen tab={tab} snapshot={snapshot} onOpenRecord={onOpenRecord} />;
  switch (tab.kind) {
    case "home":
      return snapshot.home ? (
        <HomeOpenContext.Provider value={snapshot.records ? (id) => snapshot.records?.byId[id] && onOpenRecord(id) : undefined}>
          <PageView page={snapshot.home} snapshot={snapshot} home />
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
      if (record !== null && snapshot.records?.byId[record]) return <RecordScreen snapshot={snapshot} recordId={record} />;
      return record !== null ? (
        <RecordView object={object} snapshot={snapshot} />
      ) : (
        <ListView tab={tab} object={object} lists={snapshot.lists} accounts={tab.kind === "accounts"} onOpenRecord={onOpenRecord} onNew={onNew} cardActions={rowActions(snapshot, object.name)} />
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
          <Region key={r.name} components={r.components} home={home} snapshot={snapshot} object={object} layout={layout} multi={multi} />
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
  components,
  home,
  snapshot,
  object,
  layout,
  multi,
}: {
  components: PublishedComponent[];
  home: boolean;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  const shown = components.filter((c) => c.supported && c.visibility !== "hidden");
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
            {row.map((c, j) => (
              <ComponentCard key={j} c={c} snapshot={snapshot} object={object} layout={layout} multi={multi} />
            ))}
          </div>
        ) : (
          <ComponentCard key={i} c={row[0]} snapshot={snapshot} object={object} layout={layout} multi={multi} />
        )
      )}
    </>
  );
}

function ComponentCard({
  c,
  snapshot,
  object,
  layout,
  multi,
}: {
  c: PublishedComponent;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  const cls = `studio-ipad-card studio-ipad-comp${c.visibility === "conditional" ? " conditional" : ""}`;
  const name = c.name.replace(/^.*:/, "");
  const p = c.properties;

  if (c.tabs) return <TabSet tabs={c.tabs} snapshot={snapshot} object={object} layout={layout} multi={multi} />;
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
  tabs,
  snapshot,
  object,
  layout,
  multi,
}: {
  tabs: NonNullable<PublishedComponent["tabs"]>;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
  multi?: MultiEntity;
}) {
  const first = Math.max(0, tabs.findIndex((t) => t.active));
  const [i, setI] = useState(first);
  const tab = tabs[i];
  if (!tab) return null;
  return (
    <>
      <div className="studio-ipad-chips">
        {tabs.map((t, j) => (
          <button key={j} type="button" className={`studio-ipad-chip${j === i ? " current" : ""}`} onClick={() => setI(j)}>
            {t.title}
          </button>
        ))}
      </div>
      <Region components={tab.components} home={false} snapshot={snapshot} object={object} layout={layout} multi={multi} />
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
        <div key={i} className="studio-ipad-card">
          {s.label && <strong>{s.label}</strong>}
          <div className="studio-ipad-columns">
            {s.columns.map((col, j) => (
              <div key={j}>
                {col.map((f) => (
                  <div key={f} className="studio-ipad-field">
                    <span className="studio-ipad-hint">{f}</span>
                    <span className="studio-ipad-ph line" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
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
}: {
  cardActions?: string[];
  tab: PublishedTab;
  object: PublishedObject;
  lists?: Record<string, PublishedListData>;
  accounts: boolean;
  onOpenRecord: (id: string) => void;
  onNew: (label: string, objectName: string) => void;
}) {
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
            return <CardList rows={shown.rows} onOpen={onOpenRecord} actions={cardActions} links={(view.query?.fields ?? []).map((f) => f?.type === "lookup" || f?.type === "formula")} />;
          }
          return <DataTable columns={view.columns.map(columnLabel)} data={shown} onOpenRecord={onOpenRecord} />;
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

function DataTable({ columns, data, onOpenRecord }: { columns: string[]; data?: PublishedListData; onOpenRecord: (id: string) => void }) {
  const width = `max(250px, calc(100% / ${Math.max(columns.length, 1)}))`;
  return (
    <div className="studio-ipad-table">
      <div className="studio-ipad-table-row head">
        {columns.map((c, i) => (
          <span key={i} className={`studio-ipad-table-cell${i === 0 ? " sorted" : ""}`} style={{ width, flex: "none" }}>
            {c}
            {i === 0 && <span className="studio-ipad-sort" aria-label="Sorted ascending">↑</span>}
          </span>
        ))}
      </div>
      {data?.rows.map((row) => (
        <button key={row.id} type="button" className="studio-ipad-table-row" onClick={() => onOpenRecord(row.id)}>
          {columns.map((_, i) => (
            <span key={i} className="studio-ipad-table-cell value" style={{ width, flex: "none" }}>
              {row.cells[i]}
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
        <div className="studio-ipad-highlights">
          {highlights.map((h) => (
            <div key={h} className="studio-ipad-field">
              <span className="studio-ipad-hint">{h}</span>
              <span className="studio-ipad-ph line" />
            </div>
          ))}
        </div>
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
