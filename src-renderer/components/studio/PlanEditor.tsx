import React, { useEffect, useRef, useState } from "react";
import type { MetricKey, PerfPlan, PerfTerritory, PerfUser, Persona, Threshold, Thresholds } from "./perf-types";
import type { ProfileOption } from "./types";
import {
  DEFAULT_SELECT_COUNT,
  DEFAULT_SOURCE,
  DEFAULT_THRESHOLDS,
  DEFAULT_TELEMETRY_DAYS,
  MAX_SELECT_COUNT,
  METRICS,
  emptyPersona,
  inheritedThreshold,
  planIssues,
  planToYaml,
  type PlanArea,
} from "./perf-plan";
import { Check, Copy, Plus, X } from "lucide-react";
import Segmented from "../ui/Segmented";
import StateView from "../ui/StateView";
import { Callout, Disclosure } from "./PerfParts";
import "./perf-editor.css";

interface PlanEditorProps {
  plan: PerfPlan;
  onChange: (plan: PerfPlan) => void;
  profiles: ProfileOption[];
  disabled?: boolean;
}

const parseNumber = (text: string) => (text.trim() === "" ? undefined : Number(text));
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

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
                    className="studio-filter studio-perf-number studio-perf-threshold-input"
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

/** Debounced search over the org's active users, heaviest territory load first, with their recent syncs. */
function UserSearch({
  profiles,
  chosen,
  days,
  onAdd,
  disabled,
}: {
  profiles: ProfileOption[];
  chosen: string[];
  /** The plan's telemetry window, for the sync counts. */
  days: number;
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
      const res = await window.lscApi.studioPerfUsers(search.trim() || undefined, profile || undefined, days);
      if (stale) return;
      const error = res.error || res.data?.error;
      setState(error ? { loading: false, users: [], error } : { loading: false, users: (res.data as PerfUser[]) ?? [] });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search, profile, days]);

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
          {[...profiles].sort(byName).map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {state.error ? (
        <Callout tone="error">{state.error}</Callout>
      ) : (
        <ul className="studio-picker-list studio-perf-user-list">
          {state.loading && state.users.length === 0 && <li className="studio-picker-meta" role="status">Searching…</li>}
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
                    {u.syncs !== undefined &&
                      (u.syncs > 0 ? (
                        ` · ${u.syncs.toLocaleString("en-US")} ${u.syncs === 1 ? "sync" : "syncs"}`
                      ) : (
                        <span className="studio-perf-warn-text"> · no syncs</span>
                      ))}
                    {added ? " · added" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="studio-perf-hint">
        Sorted by territory count — the users with the most territories sync the most data. Sync counts cover the last {days}{" "}
        days; users with no syncs won't have field telemetry.
      </div>
    </div>
  );
}

type TerritoryState =
  | { status: "loading" | "ok"; territories: PerfTerritory[] }
  | { status: "error"; territories: PerfTerritory[]; error: string };

/** The territories assigned to a persona's users, so a territory filter can't be mistyped. */
function TerritoryPicker({ persona, onChange, disabled }: { persona: Persona; onChange: (territory: string | undefined) => void; disabled?: boolean }) {
  const users = persona.users.map((u) => u.trim()).filter(Boolean);
  const profile = persona.select?.profile.trim() ?? "";
  const count = persona.select?.count;
  const hasSource = users.length > 0 || !!profile;
  const sourceKey = JSON.stringify([users, profile, count]);
  const [state, setState] = useState<TerritoryState>({ status: "loading", territories: [] });

  useEffect(() => {
    if (!hasSource) {
      setState({ status: "ok", territories: [] });
      return;
    }
    let stale = false;
    setState((s) => ({ status: "loading", territories: s.territories }));
    const timer = setTimeout(async () => {
      const res = await window.lscApi.studioPerfTerritories({ users, select: profile ? { profile, count } : undefined });
      if (stale) return;
      const data = res.data as { territories?: PerfTerritory[]; error?: string } | undefined;
      const error = res.error || data?.error;
      if (error) setState({ status: "error", territories: [], error });
      else setState({ status: "ok", territories: [...(data?.territories ?? [])].sort(byName) });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // sourceKey stands in for users/profile/count, which are rebuilt every render.
  }, [sourceKey]);

  const value = persona.territory ?? "";
  if (state.status === "error") {
    return (
      <>
        <input
          className="studio-filter"
          value={value}
          disabled={disabled}
          placeholder="All of each user's territories"
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        <span className="studio-perf-hint">Couldn't list territories ({state.error}) — type a territory name or Id.</span>
      </>
    );
  }
  const known = !value || state.territories.some((t) => t.name.toLowerCase() === value.toLowerCase() || t.id === value);
  return (
    <>
      <select className="studio-filter" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">All of each user's territories</option>
        {state.territories.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name} ({t.users} {t.users === 1 ? "user" : "users"})
          </option>
        ))}
        {!known && state.status === "ok" && <option value={value}>{value} (not assigned to these users)</option>}
        {!known && state.status === "loading" && <option value={value}>{value}</option>}
      </select>
      {state.status === "loading" && <span className="studio-perf-hint">Loading territories…</span>}
      {!known && state.status === "ok" && (
        <span className="studio-perf-hint studio-perf-warn-text">
          None of these users are assigned to “{value}”, so it falls back to all of their territories.
        </span>
      )}
    </>
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
  // Profile mode is the default: the heaviest users of a profile, resolved at run time, so a plan carries across sandboxes.
  const [mode, setMode] = useState<"profile" | "users">(persona.users.length > 0 && !persona.select ? "users" : "profile");
  const [picking, setPicking] = useState(persona.users.length === 0);
  // The other mode's choices, kept so switching back and forth doesn't lose them.
  const stash = useRef<{ users: string[]; select?: Persona["select"] }>({ users: [], select: undefined });
  const switchMode = (next: "profile" | "users") => {
    if (next === mode) return;
    setMode(next);
    if (next === "users") {
      stash.current.select = persona.select;
      onChange({ ...persona, select: undefined, users: persona.users.length ? persona.users : stash.current.users });
    } else {
      stash.current.users = persona.users;
      onChange({ ...persona, users: [], select: persona.select ?? stash.current.select });
    }
  };
  const sortedProfiles = [...profiles].sort(byName);
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
        <button type="button" className="ui-icon-btn" onClick={onRemove} disabled={disabled} title="Remove persona" aria-label="Remove persona">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="studio-perf-field-label">Who to test</div>
      <div className="studio-perf-mode">
        <Segmented
          aria-label="Who to test"
          size="sm"
          value={mode}
          onChange={switchMode}
          options={[
            { value: "profile", label: "Heaviest users of a profile", disabled },
            { value: "users", label: "Specific users", disabled },
          ]}
        />
      </div>
      {mode === "profile" ? (
        <>
          <div className="studio-perf-row studio-perf-select-row">
            <select
              className="studio-filter"
              aria-label="Profile"
              value={persona.select?.profile ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...persona, select: e.target.value ? { ...persona.select, profile: e.target.value } : undefined })
              }
            >
              <option value="">Choose a profile…</option>
              {persona.select?.profile && !sortedProfiles.some((p) => p.name === persona.select?.profile) && (
                <option value={persona.select.profile}>{persona.select.profile}</option>
              )}
              {sortedProfiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="studio-perf-count">
              <span className="studio-perf-field-label">Users</span>
              <input
                className="studio-filter studio-perf-number"
                type="number"
                min={1}
                max={MAX_SELECT_COUNT}
                step={1}
                disabled={disabled || !persona.select?.profile}
                value={persona.select?.count ?? ""}
                placeholder={String(DEFAULT_SELECT_COUNT)}
                aria-label="Number of users to test"
                onChange={(e) =>
                  persona.select && onChange({ ...persona, select: { ...persona.select, count: parseNumber(e.target.value) } })
                }
              />
            </label>
          </div>
          <div className="studio-perf-hint">
            Each run tests the active users of this profile with the most territories, the ones who sync the most data.
          </div>
          <label className="ui-check studio-perf-check-label">
            <input
              type="checkbox"
              checked={!!persona.select?.preferSynced}
              disabled={disabled || !persona.select?.profile}
              onChange={(e) =>
                persona.select &&
                onChange({ ...persona, select: { ...persona.select, preferSynced: e.target.checked || undefined } })
              }
            />
            Prefer users who synced in the last {plan.telemetry?.days ?? DEFAULT_TELEMETRY_DAYS} days, so field telemetry has data
          </label>
          {persona.users.length > 0 && (
            <div className="studio-perf-hint">
              Also tests {persona.users.join(", ")}.{" "}
              <button type="button" className="studio-link-btn" disabled={disabled} onClick={() => onChange({ ...persona, users: [] })}>
                Remove
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="studio-perf-chips">
            {persona.users.map((u) => (
              <span key={u} className="studio-perf-chip">
                {u}
                <button
                  type="button"
                  className="ui-icon-btn"
                  disabled={disabled}
                  onClick={() => onChange({ ...persona, users: persona.users.filter((x) => x !== u) })}
                  aria-label={`Remove ${u}`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button type="button" className="studio-btn sm" onClick={() => setPicking(!picking)} disabled={disabled}>
              {picking ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
              {picking ? "Done" : "Add users"}
            </button>
          </div>
          {picking && (
            <UserSearch
              profiles={profiles}
              chosen={persona.users}
              days={plan.telemetry?.days ?? DEFAULT_TELEMETRY_DAYS}
              disabled={disabled}
              onAdd={(username) => onChange({ ...persona, users: [...persona.users, username] })}
            />
          )}
        </>
      )}

      <div className="studio-perf-field">
        <span className="studio-perf-field-label">Territory (optional)</span>
        <TerritoryPicker persona={persona} disabled={disabled} onChange={(territory) => onChange({ ...persona, territory })} />
      </div>

      <Disclosure open={showThresholds} onToggle={() => setShowThresholds(!showThresholds)}>
        Persona targets{overrides ? ` (${overrides} overridden)` : " — using the plan's targets"}
      </Disclosure>
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
  const [tab, setTab] = useState<Tab>("personas");
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

  const issues = planIssues(plan);
  const count = (area: PlanArea) => issues.filter((i) => i.area === area).length;
  const tabs: Array<{ id: Tab; label: string; issues: number }> = [
    { id: "personas", label: `Personas (${plan.personas.length})`, issues: count("personas") },
    { id: "targets", label: "Targets", issues: count("targets") },
    { id: "yaml", label: "Import / export", issues: 0 },
  ];

  return (
    <div className="studio-perf-editor">
      <section className="studio-perf-section">
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
            <span className="studio-perf-field-label">Real syncs to look at (last days)</span>
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
      </section>

      <Segmented
        aria-label="Plan sections"
        className="studio-perf-plan-tabs"
        value={tab}
        onChange={setTab}
        options={tabs.map((t) => ({ value: t.id, label: t.label, count: t.issues > 0 ? t.issues : undefined, title: t.issues > 0 ? `${t.issues} to fix` : undefined }))}
      />
      {tab === "personas" && (
        <section className="studio-perf-section" aria-label="Personas">
          <div className="studio-perf-section-header">
            <div className="studio-perf-hint">
              A persona is a type of rep, such as a field rep. Each one is tested as its own reps, not as you: pick a profile
              to test its heaviest reps (the plan then works in any sandbox), or name specific reps. Their profile,
              permission sets and territories decide which tables they sync and how many records. Tables that don't depend
              on the rep are counted org-wide and flagged when the object's sharing would hide records from them.
            </div>
            <button
              type="button"
              className="studio-btn"
              disabled={disabled}
              onClick={() => onChange({ ...plan, personas: [...plan.personas, emptyPersona(plan.personas.length)] })}
            >
              <Plus size={14} aria-hidden="true" />
              Add persona
            </button>
          </div>
          {plan.personas.length === 0 && (
            <StateView
              layout="inline"
              kind="empty"
              title="No personas yet"
              detail="Add a persona, a type of rep whose sync load you want to test."
              className="sync-overview-empty"
            />
          )}
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
      )}

      {tab === "targets" && (
        <section className="studio-perf-section" aria-label="Targets">
          <div className="studio-perf-hint">
            The customer's targets for every persona. A persona can set its own. Warn is the target; fail is the limit. Leave
            a measure blank to report it without a pass or fail.
          </div>
          <ThresholdTable
            thresholds={plan.thresholds}
            inherited={(key) => DEFAULT_THRESHOLDS[key]}
            inheritedLabel={() => `default (${DEFAULT_SOURCE})`}
            onChange={(t) => onChange({ ...plan, thresholds: Object.keys(t).length ? t : undefined })}
            disabled={disabled}
          />
        </section>
      )}

      {tab === "yaml" && <YamlPanel plan={plan} />}
    </div>
  );
}

type Tab = "personas" | "targets" | "yaml";

/** The plan as run_perf_assessment reads it, read-only. Import and export live in the toolbar. */
function YamlPanel({ plan }: { plan: PerfPlan }) {
  const [copied, setCopied] = useState(false);
  let yaml: string;
  try {
    yaml = planToYaml(plan);
  } catch (err) {
    yaml = `# ${err instanceof Error ? err.message : String(err)}`;
  }
  const copy = async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="studio-perf-section" aria-label="Import / export">
      <div className="studio-perf-section-header">
        <div className="studio-perf-hint">The same plan as a YAML file, to share it, keep it in version control, or run it with run_perf_assessment or in CI. Most people never need this.</div>
        <button type="button" className="studio-btn" onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="studio-perf-yaml-text">{yaml}</pre>
    </section>
  );
}
