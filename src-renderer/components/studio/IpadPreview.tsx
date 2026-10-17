import React, { useEffect, useMemo, useState } from "react";
import type { FeatureMap, ItemDetail, LayoutSidebar } from "./types";
import type { Lens } from "./lens";
import type { PendingChange } from "./changes";
import {
  buildIpadPreview,
  sidebarEntries,
  type IpadBlock,
  type IpadPreview as IpadPreviewModel,
  type IpadTab,
} from "./ipad";

interface IpadPreviewProps {
  /** Actions & Home Page and Mobile Sync maps; null while loading or if they failed. */
  actionsMap: FeatureMap | null;
  syncMap: FeatureMap | null;
  /** Visit Management map, for the engagement sidebar; loaded the first time a Visit record is opened. */
  visitMap: FeatureMap | null;
  onLoadVisit: () => void;
  visitError?: string;
  lens: Lens;
  pending: PendingChange[];
  /** Opens the block's item in the inspector. */
  onSelect: (block: IpadBlock) => void;
  selectedItem: string | null;
  /** Object whose record the preview opens on, e.g. "Visit" when opened from Visit Management. */
  startOn?: string;
}

/** Tabs per page of the top tab bar, Home included — LSC Mobile pages the rest behind ‹ ›. */
const TABS_PER_PAGE = 4;

/** A pill in the top tab bar. Home is built into the app; a configured home tab only relabels it. */
interface Pill {
  key: string;
  label: string;
  tab?: IpadTab;
}

/**
 * A block render of LSC Mobile for one profile, laid out like the app: a top tab
 * bar, the home page, object lists and record pages, with home page and record
 * actions in the floating ••• menu.
 */
export default function IpadPreview({
  actionsMap,
  syncMap,
  visitMap,
  onLoadVisit,
  visitError,
  lens,
  pending,
  onSelect,
  selectedItem,
  startOn,
}: IpadPreviewProps) {
  const preview = useMemo(
    () => buildIpadPreview(actionsMap, syncMap, lens, pending),
    [actionsMap, syncMap, lens, pending]
  );
  const homeTab = preview.tabs.find((t) => t.isHome);
  const pills: Pill[] = [
    { key: "home", label: homeTab?.label ?? "Home", tab: homeTab },
    ...preview.tabs
      .filter((t) => !t.isHome)
      .map((t) => ({ key: t.itemId, label: t.label, tab: t })),
  ];

  const [screenKey, setScreenKey] = useState("home");
  const [onRecord, setOnRecord] = useState(false);
  const [page, setPage] = useState(0);
  const pill = pills.find((p) => p.key === screenKey) ?? pills[0];
  const tab = pill.key === "home" ? undefined : pill.tab;
  const open = (key: string) => {
    setScreenKey(key);
    setOnRecord(false);
  };
  // Open on `startOn`'s record once its tab is known — tabs arrive with the maps.
  const startIndex = startOn ? pills.findIndex((p) => p.tab?.object?.toLowerCase() === startOn.toLowerCase()) : -1;
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (started || startIndex < 0) return;
    setStarted(true);
    setScreenKey(pills[startIndex].key);
    setPage(Math.floor(startIndex / TABS_PER_PAGE));
    setOnRecord(true);
  }, [started, startIndex]);
  const startMissing = !!startOn && startIndex < 0 && !!actionsMap;

  const pages = Math.ceil(pills.length / TABS_PER_PAGE);
  const shown = pills.slice(page * TABS_PER_PAGE, (page + 1) * TABS_PER_PAGE);
  const initials = (lens?.profile ?? "All")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(-2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const kind = !tab
    ? "home"
    : /calendar/i.test(tab.tabName)
      ? "calendar"
      : isObjectTab(tab)
        ? "object"
        : "other";
  // A Visit opens as the full-screen Visit Engagement modal, not a record page.
  const isVisitRecord = kind === "object" && onRecord && /^visit$/i.test(tab?.object ?? "");
  const actions =
    kind === "home" ? preview.homeActions : onRecord && tab ? tab.recordActions : null;

  return (
    <div className="studio-ipad-wrap">
      <div className="studio-ipad-meta">
        {lens ? (
          <>
            Previewing as <strong>{lens.profile}</strong>
          </>
        ) : (
          <>Showing everything that's switched on — pick a profile to see one user's iPad</>
        )}
        {(preview.hidden.tabs > 0 || preview.hidden.actions > 0) && (
          <span className="studio-ipad-muted">
            {" "}
            · hidden for this profile: {preview.hidden.tabs} tabs, {preview.hidden.actions} actions
          </span>
        )}
        {startMissing && (
          <span className="studio-ipad-muted">
            {" "}
            · no {startOn} tab for this profile — reps reach {startOn} records from the calendar
          </span>
        )}
        <CacheBadge preview={preview} onSelect={onSelect} />
      </div>

      <div className="studio-ipad" role="region" aria-label="iPad preview">
        <div className="studio-ipad-screen">
          <div className="studio-ipad-statusbar">
            <span>
              9:41 AM <span className="studio-ipad-muted">Fri</span>
            </span>
            <span>100%</span>
          </div>

          {isVisitRecord ? (
            <VisitEngagement onClose={() => setOnRecord(false)} tab={tab!} onSelect={onSelect}>
              <VisitSidebar
                visitMap={visitMap}
                error={visitError}
                onLoad={onLoadVisit}
                pending={pending}
                onSelect={onSelect}
              />
            </VisitEngagement>
          ) : (
            <>
              <div className="studio-ipad-topbar">
                <div className="studio-ipad-topbar-side">
                  {onRecord && (
                    <button
                      type="button"
                      className="studio-ipad-icon-btn"
                      onClick={() => setOnRecord(false)}
                      aria-label="Back"
                    >
                      ‹
                    </button>
                  )}
                </div>
                <nav className="studio-ipad-tabbar" aria-label="Navigation tabs">
                  {page > 0 && (
                    <button
                      type="button"
                      className="studio-ipad-pager"
                      onClick={() => setPage(page - 1)}
                      aria-label="Previous tabs"
                    >
                      ‹
                    </button>
                  )}
                  {shown.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className={`studio-ipad-pill${p.key === pill.key ? " current" : ""}${pillClasses(p.tab)}`}
                      title={p.tab ? (p.tab.reason ?? p.tab.tabName) : "Built into the app"}
                      onClick={() => open(p.key)}
                    >
                      {p.label}
                      {p.tab?.sync === "notSynced" && (
                        <span className="studio-ipad-dot" aria-label="Not synced" />
                      )}
                    </button>
                  ))}
                  <span className="studio-ipad-pager" aria-hidden="true">
                    <SearchIcon />
                  </span>
                  {page < pages - 1 && (
                    <button
                      type="button"
                      className="studio-ipad-pager"
                      onClick={() => setPage(page + 1)}
                      aria-label="More tabs"
                    >
                      ›
                    </button>
                  )}
                </nav>
                <div className="studio-ipad-topbar-side right">
                  <span className="studio-ipad-round" title="Briefings" />
                  <span className="studio-ipad-round" title="Notifications" />
                  <span className="studio-ipad-round avatar">{initials}</span>
                </div>
              </div>

              <div className="studio-ipad-page">
                {kind === "home" ? (
                  <HomeScreen tab={homeTab} nbcActions={preview.nbcActions} selectedItem={selectedItem} onSelect={onSelect} />
                ) : kind === "calendar" ? (
                  <CalendarScreen tab={tab!} onSelect={onSelect} />
                ) : kind === "object" && onRecord ? (
                  <RecordScreen tab={tab!} onSelect={onSelect} />
                ) : kind === "object" ? (
                  <ListScreen
                    tab={tab!}
                    onSelect={onSelect}
                    onOpenRecord={() => setOnRecord(true)}
                  />
                ) : (
                  <OtherScreen tab={tab!} onSelect={onSelect} />
                )}
              </div>
            </>
          )}

          {actions && (
            <ActionMenu
              key={`${pill.key}:${onRecord}`}
              actions={actions}
              empty={kind === "home" ? "No home page actions" : "No record actions"}
              defaultOpen={!isVisitRecord}
              selectedItem={selectedItem}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>

      <ul className="studio-ipad-legend">
        <li>
          <span className="studio-ipad-swatch conditional" /> Only with a permission set
        </li>
        <li>
          <span className="studio-ipad-swatch pending" /> Changed by a pending change
        </li>
        <li>
          <span className="studio-ipad-swatch finding" /> Has findings
        </li>
        <li>
          <span className="studio-ipad-dot static" /> Object doesn't sync to this profile
        </li>
      </ul>
      <p className="studio-ipad-note">
        A schematic, not a screenshot: tabs and actions come from your configuration; page content,
        fields, and record data are placeholders. Click a screen title or an action to inspect it.
        The iPad shows what was last published
        {preview.pendingCount > 0
          ? " — pending changes appear here before they're applied and published"
          : ""}
        .
      </p>
    </div>
  );
}

/** Object tabs get a list and record pages; others (Tableau, Intelligent Content, …) are shown as a content area. */
function isObjectTab(tab: IpadTab): boolean {
  return !!tab.object;
}

function pillClasses(tab?: IpadTab): string {
  if (!tab) return "";
  return `${tab.fit === "conditional" ? " conditional" : ""}${tab.severity && tab.severity !== "info" ? ` sev-${tab.severity}` : ""}${
    tab.pending ? " pending" : ""
  }`;
}

/** The screen's title — clicking it inspects the navigation tab behind it. */
function ScreenTitle({
  tab,
  eyebrow,
  title,
  onSelect,
}: {
  tab?: IpadTab;
  eyebrow?: string;
  title: string;
  onSelect: (b: IpadBlock) => void;
}) {
  return (
    <div className="studio-ipad-head">
      <span className="studio-ipad-obj-icon" aria-hidden="true">
        {(tab?.label ?? title).slice(0, 1)}
      </span>
      <div>
        {eyebrow && <div className="studio-ipad-eyebrow">{eyebrow}</div>}
        {tab ? (
          <button
            type="button"
            className="studio-ipad-title"
            onClick={() => onSelect(tab)}
            title="Inspect this navigation tab"
          >
            {title}
          </button>
        ) : (
          <span className="studio-ipad-title">{title}</span>
        )}
      </div>
    </div>
  );
}

const Ph = ({ className = "", children }: { className?: string; children?: React.ReactNode }) => (
  <div className={`studio-ipad-ph ${className}`}>{children}</div>
);

function HomeScreen({
  tab,
  nbcActions,
  selectedItem,
  onSelect,
}: {
  tab?: IpadTab;
  nbcActions: IpadBlock[];
  selectedItem: string | null;
  onSelect: (b: IpadBlock) => void;
}) {
  return (
    <>
      {tab && (
        <button
          type="button"
          className="studio-link-btn studio-ipad-inspect"
          onClick={() => onSelect(tab)}
        >
          Inspect home tab
        </button>
      )}
      <div className="studio-ipad-banner-hero">
        <div>Agentforce greeting &amp; prompts</div>
        <div className="studio-ipad-hero-input" />
        <div className="studio-ipad-chips">
          {[0, 1, 2].map((i) => (
            <span key={i} className="studio-ipad-hero-chip" />
          ))}
        </div>
      </div>
      <div className="studio-ipad-section-label">Announcements</div>
      <Ph className="tall">App alerts</Ph>
      {nbcActions.length > 0 && <NbcWidget actions={nbcActions} selectedItem={selectedItem} onSelect={onSelect} />}
      <Ph className="mid">Home page content</Ph>
    </>
  );
}

const NBC_CARDS = 4;

/**
 * The Top Next Best Customers widget — swipeable account cards; tapping one opens
 * "Why …?" with the score factors and the Next Best Customer actions. Shown when
 * the profile has NBC actions; whether the NbcTopResults component is on the
 * home page isn't mapped.
 */
function NbcWidget({
  actions,
  selectedItem,
  onSelect,
}: {
  actions: IpadBlock[];
  selectedItem: string | null;
  onSelect: (b: IpadBlock) => void;
}) {
  const [why, setWhy] = useState<number | null>(null);
  return (
    <div className="studio-ipad-card">
      <div className="studio-ipad-row-between">
        <div>
          <strong>Top Next Best Customers By Score</strong>
          <div className="studio-ipad-hint">Last refreshed: today</div>
        </div>
        <span className="studio-ipad-outline-btn">Sort by: Score ⌄</span>
      </div>
      <div className="studio-ipad-nbc-cards">
        {Array.from({ length: NBC_CARDS }, (_, i) => (
          <button key={i} type="button" className="studio-ipad-nbc-card" onClick={() => setWhy(i)} title="Open Why …?">
            <span className="studio-ipad-hint">Next Best Customer</span>
            <span className="studio-ipad-ph line short" />
            <span className="studio-ipad-ph line" />
            <span className="studio-ipad-ph line" />
            <span className="studio-ipad-nbc-score">
              Score <strong>{100 - i * 5}</strong>
            </span>
            <span className="studio-ipad-hint">Insight</span>
            <span className="studio-ipad-ph line" />
          </button>
        ))}
      </div>
      {why !== null && (
        <>
          <div className="studio-ipad-dim top" onClick={() => setWhy(null)} />
          <div className="studio-ipad-sheet" role="dialog" aria-label="Why this customer">
            <div className="studio-ipad-modal-bar">
              <span />
              <strong>Why this customer?</strong>
              <button type="button" className="studio-ipad-text-btn end" onClick={() => setWhy(null)}>
                Close
              </button>
            </div>
            <div className="studio-ipad-sheet-body">
              <div className="studio-ipad-card">
                <div className="studio-ipad-row-between">
                  <div className="studio-ipad-nbc-who">
                    <span className="studio-ipad-ph line short" />
                    <span className="studio-ipad-ph line" />
                  </div>
                  <div className="studio-ipad-nbc-score big">
                    <strong>{100 - why * 5}</strong>
                    <span className="studio-ipad-hint">Score</span>
                  </div>
                </div>
                <div className="studio-ipad-chips">
                  {actions.map((b) => (
                    <button
                      key={b.itemId}
                      type="button"
                      className={`studio-ipad-action inline${b.fit === "conditional" ? " conditional" : ""}${
                        b.severity && b.severity !== "info" ? ` sev-${b.severity}` : ""
                      }${b.pending ? " pending" : ""}${b.itemId === selectedItem ? " selected" : ""}`}
                      title={b.reason}
                      onClick={() => onSelect(b)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              {["Last Visit", "Specialty", "TRx Growth", "Target"].map((factor) => (
                <div key={factor} className="studio-ipad-card studio-ipad-row-between">
                  <span>› {factor}</span>
                  <span className="studio-ipad-bar" />
                </div>
              ))}
              <div className="studio-ipad-hint">Score factors come from Territory Account Score data (placeholders)</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SyncBanner({ tab }: { tab: IpadTab }) {
  if (tab.sync !== "notSynced") return null;
  return (
    <div className="studio-ipad-warn">
      {tab.object} doesn't sync to this profile — this tab will be empty offline.
    </div>
  );
}

function ListScreen({
  tab,
  onSelect,
  onOpenRecord,
}: {
  tab: IpadTab;
  onSelect: (b: IpadBlock) => void;
  onOpenRecord: () => void;
}) {
  const isAccount = /^account$/i.test(tab.object ?? "");
  return (
    <>
      <div className="studio-ipad-row-between">
        <ScreenTitle tab={tab} eyebrow={tab.label} title="All" onSelect={onSelect} />
        <span className="studio-ipad-outline-btn">New{isAccount ? " Account" : ""}</span>
      </div>
      <SyncBanner tab={tab} />
      <div className="studio-ipad-search" />
      <div className={`studio-ipad-list-body${isAccount ? " with-lists" : ""}`}>
        {isAccount && (
          <div className="studio-ipad-card studio-ipad-lists">
            <strong>Lists</strong>
            <Ph className="line" />
            <Ph className="line" />
            <Ph className="line" />
          </div>
        )}
        <div>
          <div className="studio-ipad-chips">
            <span className="studio-ipad-chip current">All</span>
            {isAccount ? (
              <>
                <span className="studio-ipad-chip">HCO</span>
                <span className="studio-ipad-chip">HCP</span>
              </>
            ) : (
              <>
                <span className="studio-ipad-chip">List view</span>
                <span className="studio-ipad-chip">List view</span>
              </>
            )}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              type="button"
              className="studio-ipad-card studio-ipad-record-row"
              onClick={onOpenRecord}
            >
              <span className="studio-ipad-ph line short" />
              <span className="studio-ipad-ph line" />
              <span className="studio-ipad-ph line" />
            </button>
          ))}
          <div className="studio-ipad-hint">
            Open a record to see its {tab.recordActions.length}{" "}
            {tab.recordActions.length === 1 ? "action" : "actions"}
          </div>
        </div>
      </div>
    </>
  );
}

function RecordScreen({ tab, onSelect }: { tab: IpadTab; onSelect: (b: IpadBlock) => void }) {
  return (
    <>
      <ScreenTitle tab={tab} eyebrow={tab.label} title="Sample record" onSelect={onSelect} />
      <div className="studio-ipad-highlights">
        {[0, 1, 2, 3, 4].map((i) => (
          <Ph key={i} className="line" />
        ))}
      </div>
      <SyncBanner tab={tab} />
      <div className="studio-ipad-record-body">
        <div>
          <div className="studio-ipad-chips">
            <span className="studio-ipad-chip">Dashboard</span>
            <span className="studio-ipad-chip current">Details</span>
            <span className="studio-ipad-chip">Related</span>
            <span className="studio-ipad-chip">Activity History</span>
          </div>
          <div className="studio-ipad-card">
            <div className="studio-ipad-row-between">
              <strong>Details</strong>
              <span className="studio-ipad-outline-btn">Edit</span>
            </div>
            <div className="studio-ipad-fields">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Ph key={i} className="line" />
              ))}
            </div>
            <div className="studio-ipad-hint">
              Fields come from the page layout (not mapped yet)
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function CalendarScreen({ tab, onSelect }: { tab: IpadTab; onSelect: (b: IpadBlock) => void }) {
  return (
    <>
      <ScreenTitle tab={tab} title={tab.label} onSelect={onSelect} />
      <div className="studio-ipad-list-body with-lists">
        <div className="studio-ipad-card studio-ipad-lists">
          <div className="studio-ipad-search" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Ph key={i} className="line" />
          ))}
        </div>
        <div className="studio-ipad-week">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="studio-ipad-day">
              {d}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function OtherScreen({ tab, onSelect }: { tab: IpadTab; onSelect: (b: IpadBlock) => void }) {
  return (
    <>
      <ScreenTitle tab={tab} title={tab.label} onSelect={onSelect} />
      <Ph className="fill">
        {tab.label} — {tab.tabName || "this tab"} isn't an object Studio maps, so its content isn't
        previewed
      </Ph>
    </>
  );
}

/** The floating ••• button and the actions it opens — where LSC Mobile shows home page and record actions. */
function ActionMenu({
  actions,
  empty,
  selectedItem,
  onSelect,
  defaultOpen = true,
}: {
  actions: IpadBlock[];
  empty: string;
  /** Closed on Visit Engagement, where the open menu would cover the sidebar. */
  defaultOpen?: boolean;
  selectedItem: string | null;
  onSelect: (b: IpadBlock) => void;
}) {
  // Open by default — the actions are what the preview is for.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      {open && <div className="studio-ipad-dim" onClick={() => setOpen(false)} />}
      <div className="studio-ipad-fab-area">
        {open && (
          <div className="studio-ipad-fab-menu" aria-label="Actions">
            {actions.map((b) => (
              <button
                key={b.itemId}
                type="button"
                className={`studio-ipad-action${b.fit === "conditional" ? " conditional" : ""}${
                  b.severity && b.severity !== "info" ? ` sev-${b.severity}` : ""
                }${b.pending ? " pending" : ""}${b.itemId === selectedItem ? " selected" : ""}`}
                title={
                  [
                    b.reason,
                    b.severity && b.severity !== "info" && "Has findings — click to inspect",
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                onClick={() => onSelect(b)}
              >
                {b.label}
                {b.tag && <span className="studio-ipad-tag">{b.tag}</span>}
              </button>
            ))}
            {actions.length === 0 && <div className="studio-ipad-action empty">{empty}</div>}
          </div>
        )}
        <div className="studio-ipad-fab-row">
          <span className="studio-ipad-fab agent" title="Agentforce" />
          <button
            type="button"
            className={`studio-ipad-fab${open ? " open" : ""}`}
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close actions" : "Open actions"}
            aria-expanded={open}
          >
            {open ? "×" : "•••"}
          </button>
        </div>
      </div>
    </>
  );
}

function CacheBadge({
  preview,
  onSelect,
}: {
  preview: IpadPreviewModel;
  onSelect: (b: IpadBlock) => void;
}) {
  const { cache } = preview;
  const cls = `studio-ipad-cache ${cache.state}${cache.block?.severity ? ` sev-${cache.block.severity}` : ""}`;
  return cache.block ? (
    <button
      type="button"
      className={cls}
      onClick={() => onSelect(cache.block!)}
      title="Inspect the metadata cache"
    >
      {cache.label}
    </button>
  ) : (
    <span className={cls}>{cache.label}</span>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** LSC Mobile's Visit Engagement modal: header buttons, the engagement sidebar on the left, the visit's fields on the right. */
function VisitEngagement({
  tab,
  onClose,
  onSelect,
  children,
}: {
  tab: IpadTab;
  onClose: () => void;
  onSelect: (b: IpadBlock) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="studio-ipad-modal-bar">
        <button type="button" className="studio-ipad-text-btn" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="studio-ipad-title center"
          onClick={() => onSelect(tab)}
          title="Inspect this navigation tab"
        >
          Visit Engagement
        </button>
        <div className="studio-ipad-modal-actions">
          <span className="studio-ipad-outline-btn disabled">Get Signature</span>
          <span className="studio-ipad-outline-btn">Save</span>
          <span className="studio-ipad-outline-btn">Submit ▾</span>
        </div>
      </div>
      <SyncBanner tab={tab} />
      <div className="studio-ipad-engagement">
        {children}
        <div className="studio-ipad-card">
          <div className="studio-ipad-row-between">
            <strong>⌄ Visit Information</strong>
            <span className="studio-ipad-hint">* Required</span>
          </div>
          <div className="studio-ipad-form">
            {[
              "Account",
              "Place",
              "Planned Start Time",
              "Planned End Time",
              "Territory",
              "Status",
              "Channel",
              "Call type",
            ].map((label) => (
              <div key={label} className="studio-ipad-form-field">
                <span className="studio-ipad-hint">{label}</span>
                <span className="studio-ipad-input" />
              </div>
            ))}
          </div>
          <div className="studio-ipad-hint">
            Typical Visit fields — the real ones come from the page layout (not mapped yet)
          </div>
        </div>
      </div>
    </>
  );
}

/** "VisitProdDetailings" → "Visit Prod Detailings". */
const spaced = (name: string) =>
  name
    .replace(/__[cr]$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

type SidebarState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; sidebar: LayoutSidebar };

/**
 * The Visit engagement sidebar — the related lists on a Visit page layout. Layout
 * assignments per profile aren't mapped, so with several layouts the admin picks one.
 */
function VisitSidebar({
  visitMap,
  error,
  onLoad,
  pending,
  onSelect,
}: {
  visitMap: FeatureMap | null;
  error?: string;
  onLoad: () => void;
  pending: PendingChange[];
  onSelect: (b: IpadBlock) => void;
}) {
  useEffect(() => {
    if (!visitMap) onLoad();
  }, [visitMap, onLoad]);
  const layouts = useMemo(
    () =>
      visitMap?.surfaces
        .find((s) => s.id === "layouts")
        ?.items.filter((i) => i.detailKind === "layout") ?? [],
    [visitMap]
  );
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const layout = layouts.find((l) => l.id === layoutId) ?? layouts[0];
  const [details, setDetails] = useState<Record<string, SidebarState>>({});
  const state = layout ? details[layout.id] : undefined;

  useEffect(() => {
    if (!layout || details[layout.id]) return;
    setDetails((d) => ({ ...d, [layout.id]: { status: "loading" } }));
    window.lscApi.studioItemDetail("layout", layout.id).then((res) => {
      const detail = res.data as (ItemDetail & { error?: string }) | undefined;
      const error = res.error || detail?.error;
      setDetails((d) => ({
        ...d,
        [layout.id]:
          error || !detail?.sidebar
            ? { status: "error", error: error || "No sidebar" }
            : { status: "ready", sidebar: detail.sidebar },
      }));
    });
  }, [layout, details]);

  const entries = state?.status === "ready" ? sidebarEntries(state.sidebar, pending) : [];
  const shownCount = entries.filter((e) => e.pending !== "remove").length;
  const inspect = () =>
    layout &&
    onSelect({
      featureId: "visit",
      surface: "layouts",
      itemId: layout.id,
      label: layout.label,
      fit: "applies",
      pending: false,
    });

  return (
    <aside className="studio-ipad-sidebar" aria-label="Engagement sidebar">
      <div className="studio-ipad-sidebar-head">
        <button
          type="button"
          className="studio-link-btn"
          onClick={inspect}
          disabled={!layout}
          title="Inspect and edit the sidebar"
        >
          Engagement sidebar
        </button>
        {layouts.length > 1 && (
          <select
            value={layout?.id}
            onChange={(e) => setLayoutId(e.target.value)}
            title="Which layout a profile gets isn't mapped yet — pick one"
          >
            {[...layouts].sort((a, b) => a.label.localeCompare(b.label)).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {error ? (
        <div className="studio-ipad-hint warn" title={error}>
          Couldn't load Visit Management
        </div>
      ) : !visitMap ? (
        <div className="studio-ipad-hint">Loading Visit layouts…</div>
      ) : layouts.length === 0 ? (
        <div className="studio-ipad-hint">No Visit page layouts</div>
      ) : !state || state.status === "loading" ? (
        <div className="studio-ipad-hint">Reading {layout!.label}…</div>
      ) : state.status === "error" || state.sidebar.relatedLists === null ? (
        <div className="studio-ipad-hint warn">Couldn't read {layout!.label}</div>
      ) : (
        <>
          {entries.map((e) => (
            <div
              key={e.relationshipName}
              className={`studio-ipad-side-item${e.pending ? ` pending ${e.pending}` : ""}`}
              title={[
                e.relationshipName,
                e.pending && `Pending: ${e.pending === "add" ? "added" : "removed"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              › {spaced(e.objectName ?? e.relationshipName)}
            </div>
          ))}
          {entries.length === 0 && <div className="studio-ipad-hint">No related lists</div>}
          <div className={`studio-ipad-side-count${shownCount > state.sidebar.max ? " warn" : ""}`}>
            {shownCount} of {state.sidebar.max}
            {shownCount > state.sidebar.max && " — over the sidebar limit"}
          </div>
        </>
      )}
    </aside>
  );
}
