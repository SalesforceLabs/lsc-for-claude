import React from "react";
import type { ScreenProps } from "./types";
import { formatTime, hourHeight, parseStartTime, placeStacked, pointFor, tileBox, type CalendarAccount, type CalendarIcon, type CalendarSegment, type PublishedCalendar } from "./calendar-types";
import "./calendar.css";

const COL_W = 790 / 7;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const VIEW_MODES = ["Day", "Work Week", "Week", "Month"] as const;
type Mode = (typeof VIEW_MODES)[number];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Planner (PlannerContainerViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function CalendarScreen({ tab, snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.calendar;
  void tab;
  if (!data) return null;
  return <Planner data={data} />;
}

/** The Planner's mode and the day it is centred on (an index into `data.days`). */
function Planner({ data }: { data: PublishedCalendar }) {
  const todayIdx = Math.max(0, data.days.findIndex((d) => d.today));
  const [mode, setMode] = React.useState<Mode>("Week");
  const [anchor, setAnchor] = React.useState(todayIdx);
  const last = data.days.length - 1;
  const clamp = (i: number) => Math.min(Math.max(i, 0), last);
  const weekStart = (i: number) => i - (i % 7); // the window is whole weeks from the first day of the week
  const monthOf = (i: number) => data.days[i].date.slice(0, 7);
  const monthStart = (i: number) => data.days.findIndex((d) => d.date.startsWith(monthOf(i)));
  const monthEnd = (i: number) => data.days.findLastIndex((d) => d.date.startsWith(monthOf(i)));
  // Functional updates, so quick repeated taps each move from the previous result.
  const step = (dir: -1 | 1) =>
    setAnchor((at) => (mode === "Day" ? clamp(at + dir) : mode === "Month" ? (dir < 0 ? monthStart(clamp(monthStart(at) - 1)) : clamp(monthEnd(at) + 1)) : clamp(at + dir * 7)));
  // The days each mode draws: one, the weekdays of the week, or the whole week; Month draws its own grid.
  const week = Array.from({ length: 7 }, (_, i) => weekStart(anchor) + i).filter((i) => i <= last);
  const shown = mode === "Day" ? [anchor] : mode === "Work Week" ? week.filter((i) => data.days[i].weekday >= 1 && data.days[i].weekday <= 5) : week;
  const viewsToday = mode === "Month" ? monthOf(anchor) === monthOf(todayIdx) : mode === "Day" ? anchor === todayIdx : weekStart(anchor) === weekStart(todayIdx);
  return (
    <div className="studio-ipad-calendar">
      <AccountsPane accounts={data.accounts} showLastVisit={data.settings.showLastVisit} />
      <div className="studio-ipad-calendar-main">
        <Toolbar data={data} mode={mode} setMode={setMode} anchor={anchor} shown={shown} onStep={step} onToday={() => setAnchor(todayIdx)} viewsToday={viewsToday} />
        {mode === "Month" ? <MonthView data={data} first={monthStart(anchor)} month={monthOf(anchor)} /> : <TimeView data={data} shown={shown} />}
      </div>
    </div>
  );
}

function Chevron({ dir, size = 12 }: { dir: "left" | "right" | "down"; size?: number }) {
  const d = { left: "M8 1 L2 7 L8 13", right: "M2 1 L8 7 L2 13", down: "M1 2 L7 8 L13 2" }[dir];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={size > 13 ? 1.5 : size > 11 ? 1.4 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** CalendarCustomerCollectionViewCell's account icon: a person card, or a building for organizations. */
function AccountIcon({ person }: { person: boolean }) {
  return (
    <span className="studio-ipad-calendar-acct-icon">
      <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
        {person ? (
          <g fill="#fff">
            <rect x="3.5" y="4" width="4.5" height="7.5" rx="0.8" opacity="0.9" />
            <circle cx="11" cy="7" r="1.8" />
            <path d="M7.6 12.6c0-2 1.5-3.2 3.4-3.2s3.4 1.2 3.4 3.2z" />
          </g>
        ) : (
          <g fill="#fff">
            <rect x="4.5" y="3.5" width="8" height="10" rx="0.8" />
            <g fill="#5867e8">
              <rect x="6" y="5" width="1.8" height="1.8" />
              <rect x="9.2" y="5" width="1.8" height="1.8" />
              <rect x="6" y="8" width="1.8" height="1.8" />
              <rect x="9.2" y="8" width="1.8" height="1.8" />
            </g>
          </g>
        )}
      </svg>
    </span>
  );
}

function AccountsPane({ accounts, showLastVisit }: { accounts: CalendarAccount[]; showLastVisit: boolean }) {
  return (
    <div className="studio-ipad-calendar-left">
      <div className="studio-ipad-calendar-search">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="5.2" />
          <path d="M11.4 11.4 L15.5 15.5" />
        </svg>
        <span>Search...</span>
      </div>
      <div className="studio-ipad-calendar-chips">
        {["Type", "Lists", "Filters"].map((label, i) => (
          <span key={label} className={`studio-ipad-calendar-chip${i === 0 ? " on" : ""}`}>
            {label}
            <Chevron dir="down" size={14} />
          </span>
        ))}
      </div>
      <div className="studio-ipad-calendar-advanced">Advanced Search</div>
      <div className="studio-ipad-calendar-count">All ({accounts.length})</div>
      <div className="studio-ipad-calendar-list">
        {accounts.map((a) => (
          <div key={a.id} className="studio-ipad-calendar-acct">
            <AccountIcon person={a.person} />
            <span className="studio-ipad-calendar-acct-name">{a.name}</span>
            <span className="studio-ipad-calendar-acct-chev">
              <Chevron dir="down" size={12} />
            </span>
            {showLastVisit && <span className="studio-ipad-calendar-acct-sub">Last Visit: {a.lastVisit || "None"}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Sep 21 –\nSep 27", "Sep 26" or "September\n2026", as PlannerContainerViewController titles the range. */
function rangeLabel(data: PublishedCalendar, mode: Mode, anchor: number, shown: number[]): string {
  const fmt = (i: number) => `${MONTHS[Number(data.days[i].date.slice(5, 7)) - 1]} ${Number(data.days[i].date.slice(8, 10))}`;
  if (mode === "Day") return fmt(anchor);
  if (mode === "Month") return `${FULL_MONTHS[Number(data.days[anchor].date.slice(5, 7)) - 1]}\n${data.days[anchor].date.slice(0, 4)}`;
  return `${fmt(shown[0])} –\n${fmt(shown[shown.length - 1])}`;
}

interface ToolbarProps {
  data: PublishedCalendar;
  mode: Mode;
  setMode: (m: Mode) => void;
  anchor: number;
  shown: number[];
  onStep: (dir: -1 | 1) => void;
  onToday: () => void;
  viewsToday: boolean;
}

function Toolbar({ data, mode, setMode, anchor, shown, onStep, onToday, viewsToday }: ToolbarProps) {
  const label = rangeLabel(data, mode, anchor, shown);
  return (
    <div className="studio-ipad-calendar-toolbar">
      <span className="studio-ipad-calendar-tb-prev" role="button" aria-label="Previous" onClick={() => onStep(-1)}>
        <Chevron dir="left" size={15} />
      </span>
      <span className="studio-ipad-calendar-range" style={label.includes("\n") ? undefined : { lineHeight: "36px", fontSize: 20 }}>
        {label}
      </span>
      <span className="studio-ipad-calendar-tb-next" role="button" aria-label="Next" onClick={() => onStep(1)}>
        <Chevron dir="right" size={15} />
      </span>
      <svg className="studio-ipad-calendar-tb-cal" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1" y="2" width="16" height="15" rx="2" fill="none" stroke="#0250d9" strokeWidth="1.5" />
        <rect x="1" y="2" width="16" height="4" fill="#0250d9" />
        {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => <rect key={`${c}${r}`} x={3 + c * 3.4} y={8 + r * 3} width="2" height="1.8" fill="#0250d9" />))}
      </svg>
      <div className="studio-ipad-calendar-seg">
        {VIEW_MODES.map((m, i) => (
          <span key={m} role="button" onClick={() => setMode(m)} className={m === mode ? "on" : VIEW_MODES[i + 1] && VIEW_MODES[i + 1] !== mode ? "sep" : ""}>
            {m}
          </span>
        ))}
      </div>
      <span className="studio-ipad-calendar-today" role="button" style={viewsToday ? undefined : { color: "#0250d9" }} onClick={onToday}>
        Today
      </span>
      <svg className="studio-ipad-calendar-tb-plus" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 3 V17 M3 10 H17" stroke="#0250d9" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <svg className="studio-ipad-calendar-tb-more" width="17" height="6" viewBox="0 0 17 6" aria-hidden="true">
        <circle cx="2" cy="3" r="1.9" />
        <circle cx="8.5" cy="3" r="1.9" />
        <circle cx="15" cy="3" r="1.9" />
      </svg>
    </div>
  );
}

/** The Routine button in each day header (CalendarDayCell). */
function RoutineIcon() {
  return (
    <svg className="studio-ipad-calendar-routine" width="14" height="14" viewBox="0 0 14 14" fill="#0250d9" aria-hidden="true">
      <rect x="1" y="1.6" width="12" height="1.4" rx="0.5" />
      <rect x="1" y="5" width="12" height="1.4" rx="0.5" />
      <rect x="5" y="8.4" width="4" height="1.6" rx="0.5" />
      <path d="M7 10.6 L10 13.2 H4 Z" />
    </svg>
  );
}

/** CalendarIconSymbolProvider glyphs, drawn small in the tile's text colour. */
function EventIcon({ icon, size, color }: { icon: CalendarIcon; size: number; color: string }) {
  const body = {
    handshake: <path d="M1 6 L4 3 L7 4.5 L9 3 L12 6 L9.5 9.5 L7.5 11 L6 10 L4.5 11 L2.5 9 Z" fill={color} />,
    phone: <path d="M3 1.5 L5.5 1.5 L6.3 4.3 L5 5.3 C5.8 7 7 8.2 8.7 9 L9.7 7.7 L12.5 8.5 L12.5 11 C12.5 11.8 11.8 12.5 11 12.5 C6.3 12.2 1.8 7.7 1.5 3 C1.5 2.2 2.2 1.5 3 1.5 Z" fill={color} />,
    screen: <path d="M1.5 2.5 H12.5 V9 H1.5 Z M5 10.5 H9 V12 H5 Z" fill={color} />,
    mailbox: <path d="M1.5 4 C1.5 2.8 2.5 2 3.7 2 H10.3 C11.5 2 12.5 2.8 12.5 4 V10 H1.5 Z M6.4 4 V8 H5 V4 Z" fill={color} />,
    fax: <path d="M3.5 1.5 H9.5 V4 H12.5 V11.5 H1.5 V4 H3.5 Z M5 7 H9 V10 H5 Z" fill={color} />,
    clipboard: <path d="M4 1.5 H10 V3 H12 V12.5 H2 V3 H4 Z" fill={color} />,
  }[icon];
  return (
    <svg className="studio-ipad-calendar-icon" width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      {body}
    </svg>
  );
}

/** Day, Work Week and Week: day headers, the All Day row and the scrolling time grid (CalendarWeekViewController). */
function TimeView({ data, shown }: { data: PublishedCalendar; shown: number[] }) {
  const { settings, days } = data;
  const colW = 790 / shown.length;
  const H = hourHeight(settings.dayDuration);
  const scroll = pointFor(parseStartTime(settings.startTime), settings.dayDuration);
  const todayCol = shown.findIndex((i) => days[i].today);
  const nowY = pointFor(data.nowMin, settings.dayDuration);
  // CalendarWeekTimeCollectionViewLayout: the label overlapped most by the current-time label is hidden.
  // Both the label and the line belong to today's column only (CalendarEventsCollectionViewLayout.findTodaySection).
  let hidden = -1;
  let best = 0;
  if (todayCol >= 0) {
    HOURS.forEach((h) => {
      const top = h > 0 ? h * H - 7 : 0;
      const overlap = Math.min(top + 16, nowY + 8) - Math.max(top, nowY - 8);
      if (overlap > best) {
        best = overlap;
        hidden = h;
      }
    });
  }
  const inView = data.segments.filter((s) => shown.includes(s.day));
  const timed = inView.filter((s) => !s.allDay);
  const allDay = inView.filter((s) => s.allDay);
  const rows = new Map<number, number>();
  return (
    <>
      <div className="studio-ipad-calendar-heads">
        {shown.map((di, i) => (
          <div key={days[di].date} className={`studio-ipad-calendar-head${days[di].today ? " today" : ""}`} style={{ left: 58 + i * colW, width: colW }}>
            <div className="studio-ipad-calendar-daynum">{String(days[di].dayOfMonth)}</div>
            <div className="studio-ipad-calendar-dayname">{WEEKDAYS[days[di].weekday]}</div>
            <RoutineIcon />
          </div>
        ))}
      </div>
      <div className="studio-ipad-calendar-allday">
        {shown.map((di, i) => (
          <div key={days[di].date} className="studio-ipad-calendar-vline allday" style={{ left: 58 + i * colW }} />
        ))}
        <span className="studio-ipad-calendar-allday-label">All Day</span>
        {allDay.map((s) => {
          const row = rows.get(s.day) ?? 0;
          rows.set(s.day, row + 1);
          return (
            <div key={`${s.id}${s.day}`} className="studio-ipad-calendar-tile allday" style={{ left: 58 + shown.indexOf(s.day) * colW + 2, width: colW - 4, top: 2 + row * 18, background: s.background, color: s.text, borderColor: s.background }}>
              {s.title}
            </div>
          );
        })}
      </div>
      <div className="studio-ipad-calendar-grid">
        <div className="studio-ipad-calendar-grid-inner" style={{ transform: `translateY(${-scroll}px)` }}>
          {HOURS.map((h) => (
            <React.Fragment key={h}>
              <div className="studio-ipad-calendar-hline" style={{ top: h * H }} />
              <div className="studio-ipad-calendar-hour" style={{ top: h > 0 ? h * H - 8 : 0, visibility: h === hidden ? "hidden" : "visible" }}>
                {formatTime(h * 60, settings.timeFormat)}
              </div>
            </React.Fragment>
          ))}
          {shown.map((di, i) => (
            <div key={days[di].date} className="studio-ipad-calendar-vline" style={{ left: 58 + i * colW }} />
          ))}
          {shown.map((di, i) =>
            placeStacked(timed.filter((s) => s.day === di)).map((p) => {
              const { seg } = p;
              const box = tileBox(p, colW);
              return (
                <div
                  key={`${seg.id}${seg.day}`}
                  className="studio-ipad-calendar-tile"
                  style={{
                    left: 58 + i * colW + box.left,
                    width: box.width,
                    top: pointFor(seg.startMin, settings.dayDuration) + 2,
                    height: Math.max(pointFor(seg.endMin - seg.startMin, settings.dayDuration) - 4, 0),
                    background: seg.background,
                    color: seg.text,
                    opacity: seg.faded ? 0.5 : 1,
                    zIndex: p.column,
                  }}
                >
                  <div className="studio-ipad-calendar-tile-title">{seg.title}</div>
                  {seg.icon && <EventIcon icon={seg.icon} size={12} color={seg.text} />}
                </div>
              );
            })
          )}
          {todayCol >= 0 && <div className="studio-ipad-calendar-now" style={{ left: 58 + todayCol * colW, width: colW, top: nowY }} />}
          {todayCol >= 0 && (
            <div className="studio-ipad-calendar-nowlabel" style={{ top: nowY - 8.7 }}>
              {formatTime(data.nowMin, settings.timeFormat)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const MAX_EVENTS_PER_DAY = 3;
/** Week-row height: the screen below the toolbar (60) and weekday header (30), over five rows. */
const MONTH_ROW = (834 - 96 - 60 - 30) / 5;
const MONTH_PITCH = 24.5;

/** CalendarMonthViewController: five week rows, up to three chips a day and "N More...". */
function MonthView({ data, first, month }: { data: PublishedCalendar; first: number; month: string }) {
  const { days } = data;
  const start = first - (first % 7);
  const idx = Array.from({ length: 35 }, (_, i) => start + i).filter((i) => i < days.length);
  const byDay = new Map<number, CalendarSegment[]>();
  for (const s of data.segments) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  const order = (a: CalendarSegment, b: CalendarSegment) => Number(b.allDay) - Number(a.allDay) || a.startMin - b.startMin;
  return (
    <div className="studio-ipad-calendar-month">
      <div className="studio-ipad-calendar-month-head">
        {idx.slice(0, 7).map((i) => (
          <span key={i}>{WEEKDAYS[days[i].weekday]}</span>
        ))}
      </div>
      {idx.map((di, n) => {
        const d = days[di];
        const segs = [...(byDay.get(di) ?? [])].sort(order);
        const shownSegs = segs.length > MAX_EVENTS_PER_DAY ? segs.slice(0, MAX_EVENTS_PER_DAY) : segs;
        const hiddenCount = segs.length - shownSegs.length;
        return (
          <div key={d.date} className="studio-ipad-calendar-month-cell" style={{ left: (n % 7) * (848 / 7), top: 30 + Math.floor(n / 7) * MONTH_ROW, height: MONTH_ROW }}>
            <div className={`studio-ipad-calendar-month-day${d.today ? " today" : d.date.startsWith(month) ? "" : " out"}`}>{`${MONTHS[Number(d.date.slice(5, 7)) - 1]} ${d.dayOfMonth}`}</div>
            {shownSegs.map((s, k) => (
              <div key={`${s.id}${s.day}`} className="studio-ipad-calendar-month-chip" style={{ top: 25 + k * MONTH_PITCH, background: s.background, color: s.text }}>
                {s.icon && <EventIcon icon={s.icon} size={10} color={s.text} />}
                <span>{s.title}</span>
              </div>
            ))}
            {hiddenCount > 0 && <div className="studio-ipad-calendar-month-more">{hiddenCount} More...</div>}
          </div>
        );
      })}
    </div>
  );
}
