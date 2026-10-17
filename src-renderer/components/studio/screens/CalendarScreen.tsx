import React from "react";
import type { ScreenProps } from "./types";
import { formatTime, hourHeight, parseStartTime, placeSegments, pointFor, type CalendarAccount, type PublishedCalendar } from "./calendar-types";
import "./calendar.css";

const COL_W = 790 / 7;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const VIEW_MODES = ["Day", "Work Week", "Week", "Month"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Planner (PlannerContainerViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function CalendarScreen({ tab, snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.calendar;
  void tab;
  if (!data) return null;
  return (
    <div className="studio-ipad-calendar">
      <AccountsPane accounts={data.accounts} showLastVisit={data.settings.showLastVisit} />
      <div className="studio-ipad-calendar-main">
        <Toolbar data={data} />
        <WeekView data={data} />
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

/** "Oct 12 – Oct 18" for the week shown. */
function rangeLabel(data: PublishedCalendar): string {
  const fmt = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
  return `${fmt(data.days[0].date)} –\n${fmt(data.days[6].date)}`;
}

function Toolbar({ data }: { data: PublishedCalendar }) {
  return (
    <div className="studio-ipad-calendar-toolbar">
      <span className="studio-ipad-calendar-tb-prev">
        <Chevron dir="left" size={15} />
      </span>
      <span className="studio-ipad-calendar-range">{rangeLabel(data)}</span>
      <span className="studio-ipad-calendar-tb-next">
        <Chevron dir="right" size={15} />
      </span>
      <svg className="studio-ipad-calendar-tb-cal" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1" y="2" width="16" height="15" rx="2" fill="none" stroke="#0250d9" strokeWidth="1.5" />
        <rect x="1" y="2" width="16" height="4" fill="#0250d9" />
        {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => <rect key={`${c}${r}`} x={3 + c * 3.4} y={8 + r * 3} width="2" height="1.8" fill="#0250d9" />))}
      </svg>
      <div className="studio-ipad-calendar-seg">
        {VIEW_MODES.map((m, i) => (
          <span key={m} className={m === "Week" ? "on" : i < VIEW_MODES.length - 1 && VIEW_MODES[i + 1] !== "Week" ? "sep" : ""}>
            {m}
          </span>
        ))}
      </div>
      <span className="studio-ipad-calendar-today">Today</span>
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

function WeekView({ data }: { data: PublishedCalendar }) {
  const { settings, days } = data;
  const H = hourHeight(settings.dayDuration);
  const scroll = pointFor(parseStartTime(settings.startTime), settings.dayDuration);
  const todayIdx = days.findIndex((d) => d.today);
  const nowY = pointFor(data.nowMin, settings.dayDuration);
  // CalendarWeekTimeCollectionViewLayout: the label overlapped most by the current-time label is hidden.
  let hidden = -1;
  let best = 0;
  HOURS.forEach((h) => {
    const top = h > 0 ? h * H - 7 : 0; // CalendarWeekTimeCollectionViewLayout
    const overlap = Math.min(top + 16, nowY + 8) - Math.max(top, nowY - 8);
    if (overlap > best) {
      best = overlap;
      hidden = h;
    }
  });
  const timed = data.segments.filter((s) => !s.allDay);
  const allDay = data.segments.filter((s) => s.allDay);
  return (
    <>
      <div className="studio-ipad-calendar-heads">
        {days.map((d, i) => (
          <div key={d.date} className={`studio-ipad-calendar-head${d.today ? " today" : ""}`} style={{ left: 58 + i * COL_W, width: COL_W }}>
            <div className="studio-ipad-calendar-daynum">{String(d.dayOfMonth)}</div>
            <div className="studio-ipad-calendar-dayname">{WEEKDAYS[d.weekday]}</div>
            <RoutineIcon />
          </div>
        ))}
      </div>
      <div className="studio-ipad-calendar-allday">
        {days.map((d, i) => (
          <div key={d.date} className="studio-ipad-calendar-vline allday" style={{ left: 58 + i * COL_W }} />
        ))}
        <span className="studio-ipad-calendar-allday-label">All Day</span>
        {allDay.map((s, i) => (
          <div key={`${s.id}${s.day}`} className="studio-ipad-calendar-tile allday" style={{ left: 58 + s.day * COL_W + 2, width: COL_W - 4, top: 2 + i * 18, background: s.background, color: s.text, borderColor: s.background }}>
            {s.title}
          </div>
        ))}
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
          {days.map((d, i) => (
            <div key={d.date} className="studio-ipad-calendar-vline" style={{ left: 58 + i * COL_W }} />
          ))}
          {days.map((d, i) =>
            placeSegments(timed.filter((s) => s.day === i)).map(({ seg, col, cols }) => {
              const w = (COL_W - 2 * (cols + 1)) / cols;
              return (
                <div
                  key={`${seg.id}${seg.day}`}
                  className="studio-ipad-calendar-tile"
                  style={{
                    left: 58 + i * COL_W + col * w + 2 * (col + 1),
                    width: w,
                    top: pointFor(seg.startMin, settings.dayDuration) + 2,
                    height: Math.max(pointFor(seg.endMin - seg.startMin, settings.dayDuration) - 4, 0),
                    background: seg.background,
                    color: seg.text,
                    opacity: seg.faded ? 0.5 : 1,
                  }}
                >
                  {seg.title}
                </div>
              );
            })
          )}
          {todayIdx >= 0 && <div className="studio-ipad-calendar-now" style={{ left: 58 + todayIdx * COL_W, width: COL_W, top: nowY }} />}
          <div className="studio-ipad-calendar-nowlabel" style={{ top: nowY - 8.7 }}>
            {formatTime(data.nowMin, settings.timeFormat)}
          </div>
        </div>
      </div>
    </>
  );
}
