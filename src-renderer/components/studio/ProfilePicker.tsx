import React, { useState } from "react";
import type { ProfileOption } from "./types";

/** Tick-list of the org's profiles, with active user counts. */
export default function ProfilePicker({
  selected,
  profiles,
  onChange,
}: {
  selected: string[];
  profiles: ProfileOption[];
  onChange: (to: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const chosen = new Set(selected.map((n) => n.toLowerCase()));
  // Names on the record that aren't real profiles stay visible so they can be unticked.
  const unknown = selected.filter((n) => !profiles.some((p) => p.name.toLowerCase() === n.toLowerCase()));
  const q = filter.trim().toLowerCase();
  const rows = [...unknown.map((name) => ({ name, users: -1 })), ...profiles]
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => Number(chosen.has(b.name.toLowerCase())) - Number(chosen.has(a.name.toLowerCase())) || a.name.localeCompare(b.name));
  const toggle = (name: string) =>
    onChange(chosen.has(name.toLowerCase()) ? selected.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...selected, name]);

  return (
    <div className="studio-picker">
      <input className="studio-filter" aria-label="Filter profiles" placeholder="Filter profiles…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="studio-picker-list">
        {rows.map((p) => (
          <li key={p.name}>
            <label className={`studio-picker-row${p.users < 0 ? " unknown" : ""}`}>
              <input type="checkbox" checked={chosen.has(p.name.toLowerCase())} onChange={() => toggle(p.name)} />
              <span className="studio-picker-name">{p.name}</span>
              <span className="studio-picker-meta">
                {p.users < 0 ? "not a profile" : p.users ? `${p.users} ${p.users === 1 ? "user" : "users"}` : "no active users"}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
