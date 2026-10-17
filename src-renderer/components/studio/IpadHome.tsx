import React from "react";
import { MicIcon } from "./IpadChrome";
import noResultsUnknown from "./assets/noresults-unknown.png";

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

export function AgentforceWelcome({ prompts, viewerName }: { prompts: string[]; viewerName?: string }) {
  return (
    <div className="studio-ipad-h-inset studio-ipad-h-inset-welcome">
      <div className="studio-ipad-h-welcome">
        <svg className="studio-ipad-h-helix" width="250" height="250" viewBox="0 0 250 250" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${-40 + i * 34} 260 C ${20 + i * 34} 160, ${-20 + i * 34} 90, ${60 + i * 34} -10`} fill="none" stroke="#fff" strokeWidth="14" />
          ))}
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

function Pill({ children, bold = false, size = 16 }: { children: React.ReactNode; bold?: boolean; size?: number }) {
  return (
    <span className="studio-ipad-h-pill" style={{ fontSize: size, fontWeight: bold ? 600 : 400 }}>
      {children}
    </span>
  );
}

/** One Next Best Customer card (the ARC "Next Best Customer" card), with placeholder values. */
function NbcCard({ score }: { score: number }) {
  return (
    <div className="studio-ipad-h-nbc-card">
      <div className="studio-ipad-h-nbc-section">Next Best Customer</div>
      <div className="studio-ipad-h-nbc-items">
        <Pill bold size={18}>
          <Bar w={110} />
        </Pill>
        <Pill>
          <Bar w={140} />
        </Pill>
        <Pill>
          <span className="studio-ipad-h-lines">
            <Bar w={240} />
            <Bar w={200} />
          </span>
        </Pill>
      </div>
      <div className="studio-ipad-h-nbc-items gap">
        <Pill size={14}>Target</Pill>
        <Pill>Last Visit</Pill>
        <Pill size={14}>
          <Bar w={96} />
        </Pill>
        <span className="studio-ipad-h-row studio-ipad-h-score">
          <Pill bold size={18}>
            Score
          </Pill>
          <Pill size={18}>{score}</Pill>
        </span>
      </div>
      <div className="studio-ipad-h-nbc-plain">
        <span className="studio-ipad-h-caption">Distance</span>
        <span>-</span>
      </div>
      <div className="studio-ipad-h-nbc-section">Insight</div>
      <div className="studio-ipad-h-nbc-items">
        <Pill>
          <span className="studio-ipad-h-lines">
            <Bar w={240} />
            <Bar w={230} />
            <Bar w={90} />
          </span>
        </Pill>
        <span className="studio-ipad-h-row studio-ipad-h-progress">
          <Pill bold>Activity Plan Progress</Pill>
          <Pill>0</Pill>
        </span>
      </div>
    </div>
  );
}

/** NextBestCustomersView — header, Sort by, and a horizontal row of 340pt cards. */
export function NextBestCustomers({ totalCards }: { totalCards: number }) {
  return (
    <div className="studio-ipad-h-nbc">
      <div className="studio-ipad-h-nbc-head">
        <div>
          <div className="studio-ipad-h-nbc-title">Top {totalCards} Next Best Customers By Score</div>
          <div className="studio-ipad-h-caption">Last Refreshed: Today, 6:30 AM</div>
        </div>
        <span className="studio-ipad-h-capsule">
          Sort by: Score
          <svg width="13" height="8" viewBox="0 0 13 8" aria-hidden="true">
            <path d="m1 1 5.5 5.5L12 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <div className="studio-ipad-h-nbc-cards">
        {Array.from({ length: totalCards }, (_, i) => (
          <NbcCard key={i} score={100 - i * 5} />
        ))}
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
        <div className="studio-ipad-h-map" aria-label="Map">
          <span className="studio-ipad-h-locate">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M19 3 3 10l7 2 2 7Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="studio-ipad-h-maps-mark"> Maps</span>
        </div>
      </div>
    </div>
  );
}

// ── ActivityPlanByProduct (enhanced) ──────────────────────────────────────────

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="studio-ipad-h-legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} />
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
export function ActivityPlanProgress({ enhanced }: { enhanced: boolean }) {
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
            <strong>Cycle Progress:</strong> <Bar w={180} />
          </div>
          <div className="studio-ipad-h-caption">Last Updated: N/A</div>
        </div>
      </div>
      <div className="studio-ipad-h-app-panes">
        <div className="studio-ipad-h-app-left">
          <div className="studio-ipad-h-row wide">
            <Picker label="Activity Type" value={<Bar w={90} />} />
            <Picker label="Product" value="None" />
          </div>
          <div className="studio-ipad-h-segments">
            <span>At Risk</span>
            <span className="current">On Pace</span>
            <span>Exceeding Pace</span>
          </div>
          <div className="studio-ipad-h-empty">
            <EmptyArt />
            <div className="studio-ipad-h-empty-title big">No results</div>
          </div>
        </div>
        <div className="studio-ipad-h-app-right">
          <div className="studio-ipad-h-app-sub">Progress Over Time</div>
          <Legend items={[["Current Pace", "#4d8ef7"], ["Pace required to stay on track", "#06a59a"], ["Today", "#e3066a"]]} />
          <div className="studio-ipad-h-app-sub">All Activities</div>
          <svg className="studio-ipad-h-pace" viewBox="0 0 520 380" preserveAspectRatio="none" aria-hidden="true">
            {[20, 100, 180, 260, 340].map((y) => (
              <line key={y} x1="44" y1={y} x2="520" y2={y} stroke="#e5e5e5" />
            ))}
            <line x1="44" y1="340" x2="520" y2="20" stroke="#06a59a" strokeWidth="4" />
            <line x1="44" y1="340" x2="420" y2="340" stroke="#4d8ef7" strokeWidth="4" strokeDasharray="8 5" />
            <line x1="420" y1="20" x2="420" y2="340" stroke="#e3066a" strokeWidth="2.5" strokeDasharray="6 5" />
          </svg>
        </div>
      </div>
      <span className="studio-ipad-h-capsule centered">View Details</span>
    </div>
  );
}

// ── UnsubmittedVisits ─────────────────────────────────────────────────────────

/** UnsubmittedCallsDashboardViewController — three visits per page, paged sideways. */
export function VisitsToSubmit() {
  return (
    <div className="studio-ipad-h-tile">
      <div className="studio-ipad-h-tile-head plain">
        <span>Visits To Submit</span>
        <MoreDots />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="studio-ipad-h-visit">
          <Bar w={110} />
          <div className="studio-ipad-h-visit-body">
            <Bar w={150} />
            <Bar w={90} />
            <Bar w={380} />
            <span className="studio-ipad-h-tag">
              <Bar w={50} />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Floating buttons ──────────────────────────────────────────────────────────

/** FloatingQuickActionButton (60pt, 30 from the corner) and the Agentforce button 16pt to its left. */
export function HomeFabs({ agentforce }: { agentforce: boolean }) {
  return (
    <div className="studio-ipad-h-fabs" aria-hidden="true">
      {agentforce && (
        <span className="studio-ipad-h-fab astro">
          <AstroIcon size={30} />
        </span>
      )}
      <span className="studio-ipad-h-fab more">
        <svg width="30" height="8" viewBox="0 0 30 8" aria-hidden="true">
          <circle cx="4" cy="4" r="3.6" fill="#fff" />
          <circle cx="15" cy="4" r="3.6" fill="#fff" />
          <circle cx="26" cy="4" r="3.6" fill="#fff" />
        </svg>
      </span>
    </div>
  );
}
