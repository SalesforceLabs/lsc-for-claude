import React, { useEffect, useRef, useState } from "react";
import type { MetricKey, PerfPlan, PerfUser, Persona, Threshold, Thresholds } from "./perf-types";
import type { ProfileOption } from "./types";
import { DEFAULT_SOURCE, DEFAULT_THRESHOLDS, DEFAULT_TELEMETRY_DAYS, METRICS, emptyPersona, inheritedThreshold } from "./perf-plan";

interface PlanEditorProps {
  plan: PerfPlan;
  onChange: (plan: PerfPlan) => void;
  profiles: ProfileOption[];
  disabled?: boolean;
}

const parseNumber = (text: string) => (text.trim() === "" ? undefined : Number(text));

function setThreshold(t: Thresholds | undefined, key: MetricKey, field: keyof Threshold, value: number | undefined): Thresholds {
  const next = { ...(t ?? {}) };
  const entry = { ...(next[key] ?? {}), [field]: value };
  if (entry.warn === undefined && entry.fail === undefined) delete next[key];
  else next[key] = entry;
  return next;
}

/** Warn/fail inputs per metric; empty inputs show what the metric inherits. */
function ThresholdTable({
  thresholds,
  inherited,
  inheritedLabel,
  onChange,
  disabled,
}: {
  thresholds: Thresholds | undefined;
  inherited: (key: MetricKey) => Threshold | undefined;
  inheritedLabel: (key: MetricKey) => string;
  onChange: (t: Thresholds) => void;
  disabled?: boolean;
}) {
  return (
    <table className="studio-perf-thresholds">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Warn above</th>
          <th>Fail above</th>
        </tr>
      </thead>
      <tbody>
        {METRICS.map((m) => {
          const own = thresholds?.[m.key];
          const base = inherited(m.key);
          return (
            <tr key={m.key}>
              <td>
                <div>{m.label}</div>
                <div className="studio-perf-metric-meta">
                  {m.unit} · {m.source === "config" ? "predicted from configuration" : "measured from field telemetry"}
                  {!own && base && <> · {inheritedLabel(m.key)}</>}
                </div>
              </td>
              {(["warn", "fail"] as const).map((field) => (
                <td key={field}>
                  <input
                    className="studio-filter studio-perf-number"
                    type="number"
                    min={0}
                    step="any"
                    disabled={disabled}
                    value={own?.[field] ?? ""}
                    placeholder={base?.[field] !== undefined ? String(base[field]) : "—"}
                    onChange={(e) => onChange(setThreshold(thresholds, m.key, field, parseNumber(e.target.value)))}
                    aria-label={`${m.label} ${field} threshold`}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Debounced search over the org's active users, heaviest territory load first. */
function UserSearch({
  profiles,
  chosen,
  onAdd,
  disabled,
}: {
  profiles: ProfileOption[];
  chosen: string[];
  onAdd: (username: string) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState("");
  const [state, setState] = useState<{ loading: boolean; users: PerfUser[]; error?: string }>({ loading: false, users: [] });

  useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      const res = await window.lscApi.studioPerfUsers(search.trim() || undefined, profile || undefined);
      if (stale) return;
      const error = res.error || res.data?.error;
      setState(error ? { loading: false, users: [], error } : { loading: false, users: (res.data as PerfUser[]) ?? [] });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search, profile]);

  const taken = new Set(chosen.map((u) => u.toLowerCase()));
  return (
    <div className="studio-perf-user-search">
      <div className="studio-perf-row">
        <input
          className="studio-filter"
          placeholder="Search users by name or username…"
          value={search}
          disabled={disabled}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="studio-filter" value={profile} disabled={disabled} onChange={(e) => setProfile(e.target.value)}>
          <option value="">Any profile</option>
          {[...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {state.error ? (
        <div className="studio-placeholder-error">{state.error}</div>
      ) : (
        <ul className="studio-picker-list studio-perf-user-list">
          {state.loading && state.users.length === 0 && <li className="studio-picker-meta">Searching…</li>}
          {!state.loading && state.users.length === 0 && <li className="studio-picker-meta">No active users match.</li>}
          {state.users.map((u) => {
            const added = taken.has(u.username.toLowerCase());
            return (
              <li key={u.id}>
                <button
                  type="button"
                  className="studio-picker-row studio-perf-user-row"
                  disabled={disabled || added}
                  onClick={() => onAdd(u.username)}
                >
                  <span className="studio-picker-name">
                    {u.name} <span className="studio-picker-meta">{u.username}</span>
                  </span>
                  <span className="studio-picker-meta">
                    {u.profile} · {u.territories} {u.territories === 1 ? "territory" : "territories"}
                    {added ? " · added" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="studio-perf-hint">Sorted by territory count — the users with the most territories sync the most data.</div>
    </div>
  );
}

function PersonaCard({
  plan,
  persona,
  index,
  profiles,
  onChange,
  onRemove,
  disabled,
}: {
  plan: PerfPlan;
  persona: Persona;
  index: number;
  profiles: ProfileOption[];
  onChange: (p: Persona) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(persona.users.length === 0);
  const [showThresholds, setShowThresholds] = useState(!!persona.thresholds && Object.keys(persona.thresholds).length > 0);
  const overrides = Object.keys(persona.thresholds ?? {}).length;

  return (
    <div className="studio-perf-card">
      <div className="studio-perf-card-header">
        <input
          className="studio-filter studio-perf-name"
          value={persona.name}
          disabled={disabled}
          placeholder={`Persona ${index + 1}`}
          onChange={(e) => onChange({ ...persona, name: e.target.value })}
          aria-label="Persona name"
        />
        <button className="studio-icon-btn" onClick={onRemove} disabled={disabled} title="Remove persona" aria-label="Remove persona">
          ×
        </button>
      </div>

      <div className="studio-perf-field-label">Representative users</div>
      <div className="studio-chips">
        {persona.users.map((u) => (
          <span key={u} className="studio-chip">
            {u}
            <button
              className="studio-chip-x"
              disabled={disabled}
              onClick={() => onChange({ ...persona, users: persona.users.filter((x) => x !== u) })}
              aria-label={`Remove ${u}`}
            >
              ×
            </button>
          </span>
        ))}
        <button className="studio-btn studio-perf-small" onClick={() => setPicking(!picking)} disabled={disabled}>
          {picking ? "Done" : "Add users…"}
        </button>
      </div>
      {picking && (
        <UserSearch
          profiles={profiles}
          chosen={persona.users}
          disabled={disabled}
          onAdd={(username) => onChange({ ...persona, users: [...persona.users, username] })}
        />
      )}

      <label className="studio-perf-field">
        <span className="studio-perf-field-label">Territory (optional)</span>
        <input
          className="studio-filter"
          value={persona.territory ?? ""}
          disabled={disabled}
          placeholder="All of each user's territories"
          onChange={(e) => onChange({ ...persona, territory: e.target.value || undefined })}
        />
      </label>

      <button className="studio-perf-disclosure" onClick={() => setShowThresholds(!showThresholds)}>
        {showThresholds ? "▾" : "▸"} Persona thresholds{overrides ? ` (${overrides} overridden)` : " — using plan targets"}
      </button>
      {showThresholds && (
        <ThresholdTable
          thresholds={persona.thresholds}
          inherited={(key) => inheritedThreshold(plan, key)}
          inheritedLabel={(key) => (plan.thresholds?.[key] ? "plan target" : `default (${DEFAULT_SOURCE})`)}
          onChange={(t) => onChange({ ...persona, thresholds: Object.keys(t).length ? t : undefined })}
          disabled={disabled}
        />
      )}
    </div>
  );
}

export default function PlanEditor({ plan, onChange, profiles, disabled }: PlanEditorProps) {
  const setPersona = (i: number, p: Persona) => onChange({ ...plan, personas: plan.personas.map((x, j) => (j === i ? p : x)) });
  // Personas have no id; card keys are kept alongside so removing one doesn't shift another's open panels.
  const nextKey = useRef(0);
  const keys = useRef<number[]>([]);
  while (keys.current.length < plan.personas.length) keys.current.push(nextKey.current++);
  keys.current.length = plan.personas.length;
  const removePersona = (i: number) => {
    keys.current.splice(i, 1);
    onChange({ ...plan, personas: plan.personas.filter((_, j) => j !== i) });
  };

  return (
    <div className="studio-perf-editor">
      <section className="studio-perf-section">
        <h2 className="studio-perf-section-title">Plan</h2>
        <div className="studio-perf-grid">
          <label className="studio-perf-field">
            <span className="studio-perf-field-label">Name</span>
            <input
              className="studio-filter"
              value={plan.name}
              disabled={disabled}
              onChange={(e) => onChange({ ...plan, name: e.target.value })}
            />
          </label>
          <label className="studio-perf-field">
            <span className="studio-perf-field-label">Telemetry window (days)</span>
            <input
              className="studio-filter studio-perf-number"
              type="number"
              min={1}
              max={365}
              disabled={disabled}
              value={plan.telemetry?.days ?? ""}
              placeholder={String(DEFAULT_TELEMETRY_DAYS)}
              onChange={(e) => onChange({ ...plan, telemetry: { days: parseNumber(e.target.value) } })}
            />
          </label>
        </div>
        <div className="studio-perf-hint">
          Each persona is tested as its own users, not as you: their profile and permission sets pick the DB Schema
          tables, and their territories and user tags fill in each table's filter. Tables whose filter doesn't depend on
          the user are counted org-wide and flagged when the object's sharing would hide records from them.
        </div>
      </section>

      <section className="studio-perf-section">
        <h2 className="studio-perf-section-title">Targets</h2>
        <div className="studio-perf-hint">
          Plan-wide NFR targets. Personas can override them. Leave a metric blank to report it without a pass/fail.
        </div>
        <ThresholdTable
          thresholds={plan.thresholds}
          inherited={(key) => DEFAULT_THRESHOLDS[key]}
          inheritedLabel={() => `default (${DEFAULT_SOURCE})`}
          onChange={(t) => onChange({ ...plan, thresholds: Object.keys(t).length ? t : undefined })}
          disabled={disabled}
        />
      </section>

      <section className="studio-perf-section">
        <div className="studio-perf-section-header">
          <h2 className="studio-perf-section-title">Personas</h2>
          <button
            className="studio-btn"
            disabled={disabled}
            onClick={() => onChange({ ...plan, personas: [...plan.personas, emptyPersona(plan.personas.length)] })}
          >
            Add persona
          </button>
        </div>
        {plan.personas.length === 0 && <div className="studio-perf-hint">Add a persona — a role whose sync load you want to test.</div>}
        {plan.personas.map((p, i) => (
          <PersonaCard
            key={keys.current[i]}
            plan={plan}
            persona={p}
            index={i}
            profiles={profiles}
            disabled={disabled}
            onChange={(next) => setPersona(i, next)}
            onRemove={() => removePersona(i)}
          />
        ))}
      </section>
    </div>
  );
}
