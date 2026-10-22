import React, { createContext, useContext, useRef, useState } from "react";
import { MicIcon } from "./IpadChrome";
import { IpadMap } from "./IpadMap";
import noResultsUnknown from "./assets/noresults-unknown.png";
import { pageDots } from "./screens/home-types";
import type { HomeNbcCard, HomeVisit, PublishedHome } from "./screens/home-types";

/** Opens a record from a Home component (NBC card, visit row); undefined when the snapshot holds no such record. */
export const HomeOpenContext = createContext<((id: string) => void) | undefined>(undefined);

/** Edit Visit from a Visits To Submit row's ellipsis menu: opens the Visit Engagement editor. */
export const HomeEditVisitContext = createContext<((id: string) => void) | undefined>(undefined);

/**
 * Home page components as LSC Mobile draws them (standard-home at 1210×834pt).
 * Each one carries its own inset like the iOS view controllers do — the
 * region stacks them with no spacing. Record data is placeholder.
 */

// ── Shared pieces ─────────────────────────────────────────────────────────────

/** APEmptyPlaceholder's "noResultsUnknown" illustration (AppPalette PlaceholderIllustrations), aspect-fit to `height`. */
export function EmptyArt({ height = 150 }: { height?: number }) {
  return <img className="studio-ipad-h-art" src={noResultsUnknown} height={height} alt="" />;
}

function Sparkles({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <path d="m5.5 1 1.3 3.2L10 5.5 6.8 6.8 5.5 10 4.2 6.8 1 5.5l3.2-1.3Z M11 8l.7 1.6 1.6.7-1.6.7L11 12.6l-.7-1.6-1.6-.7 1.6-.7Z" fill="currentColor" />
    </svg>
  );
}

/** agent_astro — the Agentforce robot head. */
export function AstroIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="9" fill="#0250d9" />
      <rect x="6.5" y="9.5" width="11" height="8" rx="4" fill="#fff" />
      <circle cx="9.8" cy="13.5" r="1.3" fill="#0250d9" />
      <circle cx="14.2" cy="13.5" r="1.3" fill="#0250d9" />
      <path d="M5 6 7.5 8.5M19 6l-2.5 2.5" stroke="#0250d9" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoreDots() {
  return (
    <span className="studio-ipad-h-more" aria-label="More">
      <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true">
        <circle cx="2" cy="2" r="2" fill="currentColor" />
        <circle cx="9" cy="2" r="2" fill="currentColor" />
        <circle cx="16" cy="2" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}

const Bar = ({ w }: { w: number }) => <span className="studio-ipad-h-bar" style={{ width: w }} />;

// ── lsAgentforceWelcome ───────────────────────────────────────────────────────

/** AgentforceWelcomeViewModel.greeting — by the hour, with the user's first name. */
function greeting(name: string | undefined, now = new Date()): string {
  const h = now.getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const first = name?.trim().split(/\s+/)[0];
  return `Good ${part}${first ? `, ${first}` : ""}! How can Agentforce help?`;
}

/** home-icon-background.pdf (lifesciences-ios Assets.xcassets), drawn template-white at the PDF's 4 percent alpha. */
const HELIX = "M 232.9 -18.1 C 230.3 -19.4 227.0 -19.4 224.4 -18.8 L 158.6 -84.7 C 159.3 -87.3 159.3 -90.5 158.0 -93.1 C 155.4 -99.7 147.6 -102.9 141.0 -99.7 C 76.6 -71.6 59.0 -1.2 57.0 57.4 C -49.1 62.0 -88.8 109.6 -103.1 149.4 C -105.7 155.9 -101.8 163.7 -95.3 166.3 C -94.0 167.0 -92.1 167.0 -90.8 167.0 C -89.5 167.0 -88.8 167.0 -87.5 166.3 L -26.3 227.6 C -26.9 230.3 -26.9 232.9 -26.3 235.5 C -24.3 240.7 -19.1 244 -13.9 244 C -12.6 244 -10.6 244 -9.3 243.3 C 30.3 229 77.9 189.2 82.4 82.9 C 184.0 78.3 223.8 35.2 240.1 -1.2 C 242.7 -7.7 239.4 -15.5 232.9 -18.1 Z M 195.8 17.6 L 122.1 -56.0 C 126.7 -60.5 131.9 -64.5 137.8 -68.4 L 208.1 2.0 C 204.9 7.8 201.0 12.4 195.8 17.6 Z M 87.0 18.9 L 120.8 52.8 C 109.1 54.8 96.7 56.1 83.1 56.8 C 83.7 43.1 85.0 30.7 87.0 18.9 Z M 150.2 45.0 L 94.8 -10.3 C 98.0 -19.4 102.0 -27.9 106.5 -35.8 L 175.6 33.3 C 167.7 37.8 159.3 41.8 150.2 45.0 Z M 51.8 122.0 L 17.9 88.1 C 29.6 86.1 42.7 84.8 56.4 84.2 C 55.1 97.9 53.8 110.2 51.8 122.0 Z M 32.3 176.8 L -36.7 107.6 C -28.9 103.1 -20.4 99.2 -11.3 95.9 L 44.0 151.3 C 40.7 160.5 36.8 168.9 32.3 176.8 Z M -4.8 213.3 L -73.2 144.8 C -69.3 137.0 -63.4 129.8 -57.5 123.9 L 16.0 197.6 C 10.1 203.5 2.9 208.7 -4.8 213.3 Z M -4.8 213.3";

export function AgentforceWelcome({ prompts, viewerName }: { prompts: string[]; viewerName?: string }) {
  return (
    <div className="studio-ipad-h-inset studio-ipad-h-inset-welcome">
      <div className="studio-ipad-h-welcome">
        <svg className="studio-ipad-h-helix" width="250" height="250" viewBox="0 0 241 244" preserveAspectRatio="none" aria-hidden="true">
          <path d={HELIX} fill="#fff" fillOpacity="0.04" />
        </svg>
        <div className="studio-ipad-h-greeting">{greeting(viewerName)}</div>
        <div className="studio-ipad-h-ask">
          <AstroIcon />
          <span>Ask the Agentforce AI agent for help with your daily tasks.</span>
          <MicIcon />
        </div>
        {prompts.length > 0 && (
          <div className="studio-ipad-h-prompts">
            {prompts.map((p, i) => (
              <span key={i} className="studio-ipad-h-prompt">
                <Sparkles />
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── lscHomeAnnouncements ──────────────────────────────────────────────────────

export function Announcements() {
  return (
    <div className="studio-ipad-h-announcements">
      <div className="studio-ipad-h-section-title">Announcements</div>
      <div className="studio-ipad-h-empty-card">
        <EmptyArt height={192} />
        <div className="studio-ipad-h-empty-title">No recent announcements</div>
      </div>
    </div>
  );
}

// ── flexipage:richText ────────────────────────────────────────────────────────

const RICH_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "br", "span", "div", "blockquote", "a"]);
const RICH_STYLES: Record<string, keyof React.CSSProperties> = {
  color: "color",
  "background-color": "backgroundColor",
  "font-size": "fontSize",
  "text-align": "textAlign",
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
  "text-decoration": "textDecoration",
};

/** A small allowlisted subset of inline styles — no urls, nothing positional. */
function richStyle(el: Element): React.CSSProperties | undefined {
  const out: Record<string, string> = {};
  for (const decl of (el.getAttribute("style") ?? "").split(";")) {
    const [k, ...rest] = decl.split(":");
    const prop = RICH_STYLES[k?.trim().toLowerCase() ?? ""];
    const value = rest.join(":").trim();
    if (prop && /^[#\w\s.,%()-]+$/.test(value) && !/url|expression/i.test(value)) out[prop] = value;
  }
  return Object.keys(out).length ? (out as React.CSSProperties) : undefined;
}

function richNodes(nodes: NodeListOf<ChildNode> | ChildNode[], key = "r"): React.ReactNode[] {
  return Array.from(nodes).map((n, i) => {
    const k = `${key}.${i}`;
    if (n.nodeType === Node.TEXT_NODE) return n.textContent;
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    const children = richNodes(el.childNodes, k);
    if (!RICH_TAGS.has(tag)) return <React.Fragment key={k}>{children}</React.Fragment>;
    if (tag === "br") return <br key={k} />;
    // Links render as text: the preview never navigates.
    const Tag = (tag === "a" ? "span" : tag) as keyof React.JSX.IntrinsicElements;
    return React.createElement(Tag, { key: k, style: richStyle(el), className: tag === "a" ? "studio-ipad-h-link" : undefined }, ...children);
  });
}

/** SFComponentRichTextVC — the HTML in a web view on a white card. */
export function RichText({ html }: { html: string }) {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return (
    <div className="studio-ipad-h-inset rich">
      <div className="studio-ipad-h-rich">{body.textContent?.trim() ? richNodes(body.childNodes) : <span className="studio-ipad-muted">Rich text</span>}</div>
    </div>
  );
}

// ── NBCTopCards ───────────────────────────────────────────────────────────────

function Pill({ children, bold = false, size = 16, tall = false }: { children: React.ReactNode; bold?: boolean; size?: number; tall?: boolean }) {
  return (
    <span className={`studio-ipad-h-pill${tall ? " tall" : ""}`} style={{ fontSize: size, fontWeight: bold ? 600 : 400 }}>
      {children}
    </span>
  );
}

/** One Next Best Customer card (the ARC "Next Best Customer" card): the viewer's real values, or placeholder bars without data. */
function NbcCard({ score, card, onOpen }: { score: number; card?: HomeNbcCard; onOpen?: () => void }) {
  const text = (v: string | undefined, w: number) => (v === undefined ? <Bar w={w} /> : v);
  return (
    <div className={`studio-ipad-h-nbc-card${onOpen ? " open" : ""}`} onClick={onOpen} role={onOpen ? "button" : undefined}>
      <div className="studio-ipad-h-nbc-section">Next Best Customer</div>
      <div className="studio-ipad-h-nbc-items">
        <Pill bold size={18}>
          {text(card?.name, 110)}
        </Pill>
        <Pill>{text(card?.specialty, 140)}</Pill>
        <Pill tall={!!card}>
          {card ? (
            <span className="studio-ipad-h-lines text">{card.address}</span>
          ) : (
            <span className="studio-ipad-h-lines">
              <Bar w={240} />
              <Bar w={200} />
            </span>
          )}
        </Pill>
      </div>
      <div className="studio-ipad-h-nbc-items gap">
        {(!card || card.target) && <Pill size={14}>Target</Pill>}
        <Pill>Last Visit</Pill>
        <Pill size={14}>{card ? card.lastVisit || "No data available" : <Bar w={96} />}</Pill>
        <span className="studio-ipad-h-row studio-ipad-h-score">
          <Pill bold size={18}>
            Score
          </Pill>
          <Pill size={18}>{card ? (card.score ?? "") : score}</Pill>
        </span>
      </div>
      <div className="studio-ipad-h-nbc-plain">
        <span className="studio-ipad-h-caption">Distance</span>
        <span>-</span>
      </div>
      <div className="studio-ipad-h-nbc-section">Insight</div>
      <div className="studio-ipad-h-nbc-items">
        {(!card || card.insight) && (
          <Pill tall={!!card}>
            {card ? (
              <span className="studio-ipad-h-lines text">{card.insight}</span>
            ) : (
              <span className="studio-ipad-h-lines">
                <Bar w={240} />
                <Bar w={230} />
                <Bar w={90} />
              </span>
            )}
          </Pill>
        )}
        {(!card || card.planProgress !== null) && (
          <span className="studio-ipad-h-row studio-ipad-h-progress">
            <Pill bold>Activity Plan Progress</Pill>
            <Pill>{card ? card.planProgress : 0}</Pill>
          </span>
        )}
      </div>
    </div>
  );
}

/** NextBestCustomersView — header, Sort by, and a horizontal row of 340pt cards. */
export function NextBestCustomers({ totalCards, data }: { totalCards: number; data?: PublishedHome["nbc"] }) {
  const open = useContext(HomeOpenContext);
  const cards = data?.cards;
  return (
    <div className="studio-ipad-h-nbc">
      <div className="studio-ipad-h-nbc-head">
        <div>
          <div className="studio-ipad-h-nbc-title">Top {totalCards} Next Best Customers By Score</div>
          <div className="studio-ipad-h-caption" title={data?.lastRefreshedSource}>{data ? data.lastRefreshed : "Last Refreshed: Today, 6:30 AM"}</div>
        </div>
        <span className="studio-ipad-h-capsule">
          Sort by: Score
          <svg width="13" height="8" viewBox="0 0 13 8" aria-hidden="true">
            <path d="m1 1 5.5 5.5L12 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <div className="studio-ipad-h-nbc-cards">
        {cards
          ? cards.map((c) => <NbcCard key={c.accountId} score={0} card={c} onOpen={open ? () => open(c.accountId) : undefined} />)
          : Array.from({ length: totalCards }, (_, i) => <NbcCard key={i} score={100 - i * 5} />)}
      </div>
    </div>
  );
}

// ── UpNextMapDisplay (SFComponentHomeMaps) ────────────────────────────────────

export function UpNextMap() {
  return (
    <div className="studio-ipad-h-inset">
      <div className="studio-ipad-h-maps">
        <div className="studio-ipad-h-agenda">
          <div className="studio-ipad-h-agenda-head">
            <span>Up Next</span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M15 9a6 6 0 1 1-1.8-4.3M15 2.5v3.8h-3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="studio-ipad-h-empty">
            <EmptyArt />
            <div className="studio-ipad-h-empty-title">You have no upcoming visits!</div>
            <div className="studio-ipad-h-empty-text">Let's schedule a visit</div>
            <span className="studio-ipad-h-capsule">Schedule a visit</span>
          </div>
        </div>
        <IpadMap className="studio-ipad-h-map" home width={764} height={510}>
          <span className="studio-ipad-h-locate">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M19 3 3 10l7 2 2 7Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </span>
        </IpadMap>
      </div>
    </div>
  );
}

// ── ActivityPlanByProduct (enhanced) ──────────────────────────────────────────

function Legend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="studio-ipad-h-legend">
      {items.map(([label, color, dots]) => (
        <span key={label}>
          {dots ? <b style={{ color }}>···</b> : <i style={{ background: color }} />}
          {label}
        </span>
      ))}
    </div>
  );
}

function Picker({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="studio-ipad-h-picker">
      <span>{label}</span>
      <span className="studio-ipad-h-picker-box">
        {value}
        <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true">
          <path d="M0 0h14L7 8Z" fill="#5c5c5c" />
        </svg>
      </span>
    </div>
  );
}

/** ActivityPlanProductsCoordinator — progress by activity type (left) and pace over time (right). */
export function ActivityPlanProgress({ enhanced, plan }: { enhanced: boolean; plan?: PublishedHome["plan"] }) {
  if (!enhanced)
    return (
      <div className="studio-ipad-h-tile">
        <div className="studio-ipad-h-tile-head">
          <span>Activity Plans</span>
        </div>
        <div className="studio-ipad-h-empty">
          <EmptyArt />
        </div>
      </div>
    );
  return (
    <div className="studio-ipad-h-app">
      <div className="studio-ipad-h-app-top">
        <div>
          <div className="studio-ipad-h-app-title">Activity Plan Progress</div>
          <Legend items={[["Completed", "#4d8ef7"], ["Planned", "#c40be5"], ["Target", "#c9c9c9"]]} />
        </div>
        <div className="studio-ipad-h-app-cycle">
          <div>
            <strong>Cycle Progress:</strong> {plan ? (plan.cycle ?? "--") : <Bar w={180} />}
          </div>
          <div className="studio-ipad-h-caption">Last Updated: N/A</div>
        </div>
      </div>
      <div className="studio-ipad-h-app-panes">
        <div className="studio-ipad-h-app-left">
          <div className="studio-ipad-h-row wide">
            <Picker label="Activity Type" value={plan?.activityType ?? <Bar w={90} />} />
            <Picker label="Product" value="None" />
          </div>
          <div className="studio-ipad-h-segments">
            <span>At Risk</span>
            <span className="current">On Pace</span>
            <span>Exceeding Pace</span>
          </div>
          <div className="studio-ipad-h-empty plan">
            <EmptyArt height={190} />
            <div className="studio-ipad-h-empty-title big">No results</div>
          </div>
        </div>
        <div className="studio-ipad-h-app-right">
          <div className="studio-ipad-h-app-sub">Progress Over Time</div>
          <Legend items={[["Current Pace", "#4d8ef7"], ["Pace required to stay on track", "#06a59a"], ["Today", "#e3066a", true]]} />
          <div className="studio-ipad-h-app-sub">All Activities</div>
          <PaceChart axis={plan?.axis} />
        </div>
      </div>
      <span className="studio-ipad-h-capsule centered">View Details</span>
    </div>
  );
}

/** Plot box of ActivityPlanChart's Chart, in the svg's own pixels (device: x 45...518, 100% at y 31, 0% at y 352). */
const PACE = { left: 45, right: 518, top: 31, bottom: 352 };

/**
 * ActivityPlanChart: Activity% 0...100 on y, the cycle's days on x with month ticks. Required pace is the straight 0 -> 100 line,
 * current pace the dashed capped cumulative (0 until the viewer's goals have progress) up to the Today rule and its ring.
 */
export function PaceChart({ axis }: { axis?: { days: number; today: number; ticks: { index: number; label: string }[] } }) {
  const { left, right, top, bottom } = PACE;
  const y = (pct: number) => bottom - ((bottom - top) * pct) / 100;
  const x = (i: number) => left + (axis && axis.days > 1 ? (i / (axis.days - 1)) * (right - left) : 0);
  const todayX = axis ? x(axis.today) : null;
  return (
    <svg className="studio-ipad-h-pace" width="519" height="410" viewBox="0 0 519 410" aria-hidden="true">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={left} y1={y(v)} x2={right} y2={y(v)} stroke="#dcdcdc" strokeWidth="1" />
          <text x={left - 5} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#8a8a8a">
            {v}
          </text>
        </g>
      ))}
      {axis?.ticks.map((t) => (
        <g key={t.index}>
          <line x1={x(t.index)} y1={bottom} x2={x(t.index)} y2={bottom + 6} stroke="#dcdcdc" />
          <text x={x(t.index)} y={bottom + 17} textAnchor="middle" fontSize="12" fill="#8a8a8a">
            {t.label}
          </text>
        </g>
      ))}
      <text transform={`translate(8 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fontWeight="600">
        Activity%
      </text>
      <text x={(left + right) / 2} y={bottom + 39} textAnchor="middle" fontSize="12" fontWeight="600">
        Quarter
      </text>
      {todayX !== null && <line x1={todayX} y1={top} x2={todayX} y2={bottom} stroke="#e3066a" strokeWidth="3" strokeDasharray="5 5" />}
      <line x1={left} y1={y(0)} x2={right} y2={y(100)} stroke="#06a59a" strokeWidth="5" />
      {todayX !== null && (
        <g>
          <line x1={left} y1={y(0)} x2={todayX} y2={y(0)} stroke="#4d8ef7" strokeWidth="5" strokeDasharray="6 4" />
          <circle cx={todayX} cy={y(0)} r="4.5" fill="#fff" />
          <circle cx={todayX} cy={y(0)} r="7" fill="none" stroke="#c9c9c9" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}

// ── UnsubmittedVisits ─────────────────────────────────────────────────────────

/** UnsubmittedCallsDashboardViewController — three visits per page, paged sideways (swipe or tap a dot) under a page control. */
export function VisitsToSubmit({ data }: { data?: PublishedHome["visits"] }) {
  const edit = useContext(HomeEditVisitContext);
  const [menu, setMenu] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pages = data ? Math.max(1, Math.ceil(data.items.length / 3)) : 1;
  const at = Math.min(page, pages - 1);
  const rows: (HomeVisit | null)[] = data ? data.items.slice(at * 3, at * 3 + 3) : [null, null, null];
  const down = useRef<number | null>(null);
  return (
    <div
      className="studio-ipad-h-tile visits"
      onPointerDown={(e) => (down.current = e.clientX)}
      onPointerUp={(e) => {
        const dx = down.current == null ? 0 : e.clientX - down.current;
        down.current = null;
        if (Math.abs(dx) > 40) setPage(Math.max(0, Math.min(pages - 1, at + (dx < 0 ? 1 : -1))));
      }}
    >
      <div className="studio-ipad-h-tile-head plain">
        <span>{data ? `Visits To Submit (${data.total})` : "Visits To Submit"}</span>
        <MoreDots />
      </div>
      <div className="studio-ipad-h-visit-page">
        {rows.map((v, i) => (
          <div key={v?.id ?? i} className="studio-ipad-h-visit">
            {v ? v.dateLabel && <span className="studio-ipad-h-visit-date">{v.dateLabel}</span> : <Bar w={110} />}
            <div className="studio-ipad-h-visit-body">
              {v ? <span className="studio-ipad-h-visit-time">{v.time}</span> : <Bar w={150} />}
              {v ? <span>{v.account}</span> : <Bar w={90} />}
              {v ? <span className="studio-ipad-h-visit-addr">{v.address}</span> : <Bar w={380} />}
              {(!v || v.channel) && <span className="studio-ipad-h-tag">{v ? v.channel : <Bar w={50} />}</span>}
              {v && (
                <span className="studio-ipad-h-visit-more" role="button" onClick={() => setMenu(menu === v.id ? null : v.id)}>
                  <MoreDots />
                  {menu === v.id && (
                    <span
                      className="studio-ipad-h-visit-menu"
                      role="menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu(null);
                        edit?.(v.id);
                      }}
                    >
                      Edit Visit
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="studio-ipad-h-pages">
          {pageDots(pages, at).map((d) => (
            <i key={d.index} className={`${d.on ? "on" : ""}${d.small ? " small" : ""}`} onClick={() => setPage(d.index)} />
          ))}
        </div>
      )}
    </div>
  );
}
