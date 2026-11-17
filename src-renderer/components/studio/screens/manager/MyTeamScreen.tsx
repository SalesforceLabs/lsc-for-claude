import React, { useState } from "react";
import type { ScreenProps } from "../types";
import { useLazyStudio } from "../../useLazyStudio";
import type { MyTeamWeek } from "./myTeam-types";
import "./manager.css";

/** Adds `days` to a YYYY-MM-DD date (MyTeamViewController moves the week with the chevrons). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const pickWeek = (data: unknown): MyTeamWeek => {
  const week = (data as { week?: MyTeamWeek } | undefined)?.week;
  if (!week) throw new Error("No answer for that week.");
  return week;
};

/**
 * My Team (lifesciences-ios MyTeamViewController): a territory picker and a week switcher over the week's
 * activities, read live from the Connect API. Starts on "No Territory Selected" like the device.
 */
export default function MyTeamScreen({ snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.myTeam;
  const [territoryId, setTerritoryId] = useState("");
  const [date, setDate] = useState(data?.week.date ?? "");
  const { state, retry } = useLazyStudio(
    `${territoryId}|${date}`,
    () =>
      window.lscApi.studioManagerData({
        kind: "myTeamWeek",
        territoryId: territoryId || undefined,
        date,
        firstDay: data?.firstDay ?? "Monday",
        timeZone: data?.timeZone ?? "UTC",
        locale: data?.locale ?? "en-US",
      }),
    pickWeek
  );
  if (!data) return null;
  const label = state.status === "ready" ? state.data.label : data.week.label;
  return (
    <div className="studio-ipad-myteam">
      <div className="studio-ipad-myteam-header">
        <div className="studio-ipad-myteam-title">My Team</div>
        <div className="studio-ipad-myteam-week">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setDate(shiftDate(date, -7))}
          >
            ‹
          </button>
          <input
            type="date"
            aria-label="Pick a week"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <span className="studio-ipad-myteam-week-label">{label}</span>
          <button type="button" aria-label="Next week" onClick={() => setDate(shiftDate(date, 7))}>
            ›
          </button>
        </div>
        <select
          className="studio-ipad-myteam-picker"
          value={territoryId}
          aria-label="Territory"
          onChange={(e) => setTerritoryId(e.target.value)}
        >
          <option value="">Choose Territory</option>
          {data.territories.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {data.note ? <div className="studio-ipad-myteam-note">{data.note}</div> : null}
      <div className="studio-ipad-myteam-body">
        {!territoryId ? (
          <div className="studio-ipad-myteam-empty">
            <div className="studio-ipad-myteam-empty-title">No Territory Selected.</div>
            <div className="studio-ipad-myteam-empty-body">Please choose from dropdown.</div>
          </div>
        ) : state.status === "loading" ? (
          <div className="studio-ipad-myteam-empty">Loading…</div>
        ) : state.status === "error" ? (
          <div className="studio-ipad-myteam-empty">
            <div className="studio-ipad-myteam-empty-body">{state.message}</div>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        ) : (
          state.data.days.map((day) => (
            <section key={day.title} className="studio-ipad-myteam-day">
              <h3>{day.title}</h3>
              {day.activities.length === 0 ? (
                <div className="studio-ipad-myteam-none">No events scheduled.</div>
              ) : (
                day.activities.map((a) => (
                  <div key={a.id} className="studio-ipad-myteam-activity">
                    <span
                      className="studio-ipad-myteam-marker"
                      style={{ background: a.muted ? "#c9c9c9" : a.color }}
                    />
                    <div className="studio-ipad-myteam-time">
                      <div>{a.timeRange}</div>
                      <small>Time</small>
                    </div>
                    <div className="studio-ipad-myteam-main">
                      <small>{a.type}</small>
                      <div>{a.details}</div>
                    </div>
                    <div className="studio-ipad-myteam-who">
                      <small>{a.status}</small>
                      <div>{a.userName}</div>
                    </div>
                    <div className="studio-ipad-myteam-where">
                      <small>Address</small>
                      <div>{a.address}</div>
                    </div>
                  </div>
                ))
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
