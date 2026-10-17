import React, { useMemo, useState } from "react";
import type {
  PublishedComponent,
  PublishedIpad,
  PublishedLayout,
  PublishedObject,
  PublishedPage,
  PublishedResult,
  PublishedTab,
} from "./published-types";

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
  const [record, setRecord] = useState(false);
  const tab = snapshot.tabs.find((t) => t.fullName === current) ?? snapshot.tabs[0];
  const open = (t: PublishedTab) => {
    setCurrent(t.fullName);
    setRecord(false);
  };
  const initials = (snapshot.viewer?.name ?? snapshot.profile)
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(-2)
    .map((w) => w[0].toUpperCase())
    .join("");
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
              {snapshot.users.map((u) => (
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

      <div className="studio-ipad" role="region" aria-label="iPad preview (published)">
        <div className="studio-ipad-screen">
          <div className="studio-ipad-statusbar">
            <span>
              9:41 AM <span className="studio-ipad-muted">Fri</span>
            </span>
            <span>100%</span>
          </div>
          <div className="studio-ipad-topbar">
            <div className="studio-ipad-topbar-side">
              {record && (
                <button type="button" className="studio-ipad-icon-btn" onClick={() => setRecord(false)} aria-label="Back">
                  ‹
                </button>
              )}
            </div>
            {/* UITabBarController in .tabBar mode: every tab in one floating bar, search pinned last. */}
            <nav className="studio-ipad-tabbar scroll" aria-label="Navigation tabs">
              {snapshot.tabs.map((t) =>
                t.kind === "recent" ? (
                  <button
                    key={t.fullName}
                    type="button"
                    className={`studio-ipad-pager${t.fullName === tab?.fullName ? " current" : ""}`}
                    title="Search and recent items (always pinned)"
                    onClick={() => open(t)}
                  >
                    <SearchIcon />
                  </button>
                ) : (
                  <button
                    key={t.fullName}
                    type="button"
                    className={`studio-ipad-pill${t.fullName === tab?.fullName ? " current" : ""}`}
                    title={t.fullName}
                    onClick={() => open(t)}
                  >
                    {t.label}
                  </button>
                )
              )}
            </nav>
            <div className="studio-ipad-topbar-side right">
              <span className="studio-ipad-round" title="Briefings" />
              <span className="studio-ipad-round" title="Notifications" />
              <span className="studio-ipad-round avatar">{initials}</span>
            </div>
          </div>
          <div className="studio-ipad-page">
            {tab && <Screen key={tab.fullName} tab={tab} snapshot={snapshot} record={record} onOpenRecord={() => setRecord(true)} />}
          </div>
        </div>
      </div>

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
}: {
  tab: PublishedTab;
  snapshot: PublishedIpad;
  record: boolean;
  onOpenRecord: () => void;
}) {
  switch (tab.kind) {
    case "home":
      return snapshot.home ? <PageView page={snapshot.home} snapshot={snapshot} home /> : <Native title="Home" text="Home page" />;
    case "flexiPage": {
      const page = tab.flexiPage ? snapshot.pages[tab.flexiPage] : undefined;
      return page ? <PageView page={page} snapshot={snapshot} title={tab.label} /> : <Native title={tab.label} text="Lightning page" />;
    }
    case "object":
    case "accounts": {
      const object = snapshot.objects[tab.kind === "accounts" ? "Account" : (tab.sobject ?? "")];
      if (!object) return <Native title={tab.label} text={`${tab.sobject ?? "Object"} list`} />;
      return record ? (
        <RecordView object={object} snapshot={snapshot} />
      ) : (
        <ListView tab={tab} object={object} accounts={tab.kind === "accounts"} onOpenRecord={onOpenRecord} />
      );
    }
    case "empty":
      return <ComingSoon reason={tab.emptyReason} />;
    case "recent":
      return <Native title="Search" text="Global search and recently viewed records" />;
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
      <div className="studio-ipad-coming-soon">
        <span className="studio-ipad-coming-soon-logo" aria-hidden="true" />
        <span>Coming soon</span>
      </div>
      {reason && <div className="studio-ipad-warn">{reason}</div>}
    </>
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

function Head({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="studio-ipad-row-between">
      <div className="studio-ipad-head">
        <span className="studio-ipad-obj-icon" aria-hidden="true">
          {title.slice(0, 1)}
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
}: {
  page: PublishedPage;
  snapshot: PublishedIpad;
  home?: boolean;
  title?: string;
  object?: PublishedObject;
  layout?: PublishedLayout;
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
          <Region key={r.name} components={r.components} home={home} snapshot={snapshot} object={object} layout={layout} />
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
}: {
  components: PublishedComponent[];
  home: boolean;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
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
              <ComponentCard key={j} c={c} snapshot={snapshot} object={object} layout={layout} />
            ))}
          </div>
        ) : (
          <ComponentCard key={i} c={row[0]} snapshot={snapshot} object={object} layout={layout} />
        )
      )}
    </>
  );
}

function richText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
}

function ComponentCard({
  c,
  snapshot,
  object,
  layout,
}: {
  c: PublishedComponent;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
}) {
  const cls = `studio-ipad-card studio-ipad-comp${c.visibility === "conditional" ? " conditional" : ""}`;
  const name = c.name.replace(/^.*:/, "");
  const p = c.properties;

  if (c.tabs) return <TabSet tabs={c.tabs} snapshot={snapshot} object={object} layout={layout} />;
  if (name === "highlightsPanel") return null; // drawn by the record header
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
  if (/nbctopcards$/i.test(name))
    return (
      <div className={cls}>
        <strong>Top {p.totalCards || 10} Next Best Customers By Score</strong>
        <div className="studio-ipad-nbc-cards">
          {Array.from({ length: Math.min(Number(p.totalCards) || 10, 4) }, (_, i) => (
            <span key={i} className="studio-ipad-nbc-card">
              <span className="studio-ipad-ph line short" />
              <span className="studio-ipad-ph line" />
            </span>
          ))}
        </div>
        {p.graphName && <div className="studio-ipad-hint">Model: {p.graphName}</div>}
      </div>
    );
  if (name === "lsAgentforceWelcome")
    return (
      <div className="studio-ipad-banner-hero">
        <div>Agentforce</div>
        <div className="studio-ipad-hero-input" />
        <div className="studio-ipad-chips">
          {["utterance1", "utterance2", "utterance3"]
            .map((k) => p[k])
            .filter(Boolean)
            .map((u) => (
              <span key={u} className="studio-ipad-chip">
                {u}
              </span>
            ))}
        </div>
      </div>
    );
  if (name === "richText") return <div className={cls}>{richText(p.richTextValue ?? "") || "Rich text"}</div>;
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
}: {
  tabs: NonNullable<PublishedComponent["tabs"]>;
  snapshot: PublishedIpad;
  object?: PublishedObject;
  layout?: PublishedLayout;
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
      <Region components={tab.components} home={false} snapshot={snapshot} object={object} layout={layout} />
      {tab.components.some((c) => !c.supported) && (
        <div className="studio-ipad-hint">
          Not shown on iPad: {tab.components.filter((c) => !c.supported).map((c) => c.label).join(", ")}
        </div>
      )}
    </>
  );
}

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

function ListView({
  tab,
  object,
  accounts,
  onOpenRecord,
}: {
  tab: PublishedTab;
  object: PublishedObject;
  accounts: boolean;
  onOpenRecord: () => void;
}) {
  const [viewName, setViewName] = useState(object.defaultListView);
  const view = object.listViews.find((l) => l.name === viewName) ?? object.listViews[0];
  return (
    <>
      <Head eyebrow={tab.label} title={view?.label ?? object.labelPlural}>
        <span className="studio-ipad-outline-btn">New{accounts ? " Account" : ""}</span>
      </Head>
      <div className="studio-ipad-search" />
      {object.listViews.length > 0 && (
        <div className="studio-ipad-chips studio-ipad-scroll-x">
          {object.listViews.map((l) => (
            <button
              key={l.name}
              type="button"
              className={`studio-ipad-chip${l.name === view?.name ? " current" : ""}`}
              onClick={() => setViewName(l.name)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      {view && view.columns.length > 0 && (
        <div className="studio-ipad-lv-head">
          {view.columns.slice(0, 5).map((c) => (
            <span key={c}>{columnLabel(c)}</span>
          ))}
        </div>
      )}
      {[0, 1, 2, 3].map((i) => (
        <button key={i} type="button" className="studio-ipad-card studio-ipad-record-row" onClick={onOpenRecord}>
          <span className="studio-ipad-ph line short" />
          <span className="studio-ipad-ph line" />
        </button>
      ))}
    </>
  );
}

/** List view columns come as `ACCOUNT.NAME` / `CORE.USERS.ALIAS` / `Field__c`. */
function columnLabel(c: string): string {
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
  const compactName = rt?.compactLayout ?? object.defaultCompactLayout;
  const highlights = useMemo(
    () => (compactName ? (snapshot.compactLayouts[`${object.name}.${compactName}`] ?? []) : []).slice(1, 7),
    [snapshot, object.name, compactName]
  );
  return (
    <>
      <Head eyebrow={object.label} title={`Sample ${object.label.toLowerCase()}`}>
        {object.recordTypes.length > 1 && (
          <label className="studio-ipad-hint">
            Record type{" "}
            <select value={rtName} onChange={(e) => setRtName(e.target.value)}>
              {object.recordTypes.map((r) => (
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
        <PageView page={page} snapshot={snapshot} object={object} layout={layout} />
      ) : layout ? (
        <LayoutSections layout={layout} />
      ) : (
        <div className="studio-ipad-ph fill">No page layout is assigned for this record type.</div>
      )}
      <div className="studio-ipad-hint">
        {page ? `Lightning page ${page.label}` : "No Lightning page — the layout's details panel"}
        {layout ? ` · layout ${layout.name}` : ""}
        {object.name === "Visit" ? " · reps open Visits in Visit Engagement" : ""}
      </div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
