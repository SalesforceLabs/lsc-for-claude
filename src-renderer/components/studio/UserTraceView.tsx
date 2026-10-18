import React, { useEffect, useMemo, useState } from "react";
import type { FeatureSummary, ProfileOption } from "./types";
import type { PerfUser } from "./perf-types";
import type { PendingChange } from "./changes";
import { CheckRow } from "./ReadinessView";
import { STAGES } from "./readiness";
import { firstProblem, needsPublish, traceAskPrompt, traceHeadline, type TraceState } from "./user-trace-state";
import "./readiness.css";
import "./user-trace.css";
import { AssistantName } from "../../hooks/useAssistantName";

export interface UserTraceViewProps {
  features: FeatureSummary[];
  profiles: ProfileOption[];
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  onAskClaude: (prompt: string) => void;
  onOpenFeature: (featureId: string) => void;
  onPublish: (profiles: string[]) => void;
  /** Report the org a trace was read from, so pending changes can be applied against it. */
  onOrgSeen: (org: string) => void;
  /** Feature picked when the view opens (from a feature page's "Check a user…"). */
  initialFeatureId?: string;
}

/** "Why can't this rep …?" — one user's setup checked end to end. */
export default function UserTraceView({
  features,
  profiles,
  pending,
  onPendingChange,
  onAskClaude,
  onOpenFeature,
  onPublish,
  onOrgSeen,
  initialFeatureId,
}: UserTraceViewProps) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<{ loading: boolean; list: PerfUser[]; error?: string }>({ loading: false, list: [] });
  const [user, setUser] = useState<PerfUser | null>(null);
  const [featureId, setFeatureId] = useState(initialFeatureId ?? "");
  useEffect(() => {
    if (initialFeatureId) setFeatureId(initialFeatureId);
  }, [initialFeatureId]);
  const [state, setState] = useState<TraceState>({ status: "idle" });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (user && search === user.name) return;
    let stale = false;
    setUsers((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      const res = await window.lscApi.studioPerfUsers(search.trim() || undefined, undefined, 30);
      if (stale) return;
      const error = res.error || res.data?.error;
      setUsers(error ? { loading: false, list: [], error } : { loading: false, list: (res.data as PerfUser[]) ?? [] });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search, user]);

  const feature = features.find((f) => f.id === featureId);
  const profileUsers = user ? profiles.find((p) => p.name === user.profile)?.users : undefined;

  const run = async () => {
    if (!user) return;
    setState({ status: "loading" });
    const res = await window.lscApi.studioUserTrace(user.id, featureId || undefined);
    const error = res.error || res.data?.error;
    if (error) return setState({ status: "error", error });
    const trace = res.data as Extract<TraceState, { status: "ready" }>["trace"];
    setState({ status: "ready", trace });
    setOpen(firstProblem(trace.checks)?.id ?? null);
    onOrgSeen(trace.org);
  };

  const trace = state.status === "ready" ? state.trace : null;
  const headline = useMemo(() => (trace ? traceHeadline(trace, feature?.title) : null), [trace, feature]);
  const stageTitle = (id: string) => STAGES.find((s) => s.id === id)?.title ?? id;

  return (
    <div className="studio-utrace">
      <div className="studio-utrace-form">
        <label className="studio-utrace-field">
          User
          <input
            type="search"
            value={search}
            placeholder="Name or username"
            onChange={(e) => {
              setSearch(e.target.value);
              setUser(null);
            }}
          />
        </label>
        <label className="studio-utrace-field">
          Feature (optional)
          <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
            <option value="">Any — general iPad access</option>
            {features
              .filter((f) => f.available)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
          </select>
        </label>
        <button className="studio-btn primary" disabled={!user || state.status === "loading"} onClick={run}>
          Run check
        </button>
      </div>

      {!user && (
        <div>
          {users.error && <div className="studio-placeholder-error">{users.error}</div>}
          {users.loading && users.list.length === 0 && <div className="studio-placeholder-sub">Searching users…</div>}
          {users.list.length > 0 && (
            <ul className="studio-utrace-users" aria-label="Matching users">
              {users.list.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="studio-utrace-user"
                    aria-pressed={false}
                    onClick={() => {
                      setUser(u);
                      setSearch(u.name);
                      setState({ status: "idle" });
                    }}
                  >
                    <span>
                      {u.name} <span className="studio-utrace-user-sub">{u.username}</span>
                    </span>
                    <span className="studio-utrace-user-sub">{u.profile}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!users.loading && !users.error && users.list.length === 0 && <div className="studio-placeholder-sub">No active users match.</div>}
        </div>
      )}
      {user && state.status === "idle" && (
        <div className="studio-placeholder-sub">
          {user.name} · {user.profile}
          {profileUsers ? ` (${profileUsers} users on this profile)` : ""}. Pick a feature if the problem is specific to one, then run the check.
        </div>
      )}

      {state.status === "loading" && (
        <div className="studio-placeholder">
          <div className="studio-spinner" />
          <div>Checking {user?.name}…</div>
          <div className="studio-placeholder-sub">Walking the chain from licenses to their last sync. Every query is read-only.</div>
        </div>
      )}
      {state.status === "error" && (
        <div className="studio-placeholder">
          <div className="studio-placeholder-error">Couldn't check this user</div>
          <div className="studio-placeholder-sub">{state.error}</div>
          <button className="studio-btn" onClick={run}>
            Try again
          </button>
        </div>
      )}

      {trace && headline && (
        <>
          <div className={`studio-verdict ${headline.ok ? "ready" : "failing"}`} role="status">
            <div className="studio-verdict-title">
              <span className="studio-verdict-icon" aria-hidden="true">
                {headline.ok ? "✓" : "✗"}
              </span>
              {trace.userName}: {headline.text}
            </div>
            <div className="studio-readiness-counts">
              {trace.profile ?? "No profile"} · checked {new Date(trace.collectedAt).toLocaleTimeString()}
            </div>
            <div className="studio-utrace-actions">
              {trace.featureId && (
                <button type="button" className="studio-link-btn" onClick={() => onOpenFeature(trace.featureId!)}>
                  Open {feature?.title ?? "feature"}
                </button>
              )}
              {!headline.ok && (
                <button type="button" className="studio-link-btn" onClick={() => onAskClaude(traceAskPrompt(trace, feature?.title))}>
                  Ask <AssistantName /> about this user
                </button>
              )}
              {trace.profile && (trace.checks.some(needsPublish) || pending.length > 0) && (
                <button type="button" className="studio-link-btn" onClick={() => onPublish([trace.profile!])}>
                  Publish to iPad
                </button>
              )}
              <button type="button" className="studio-link-btn" onClick={run}>
                Re-run
              </button>
            </div>
          </div>

          <ol className="studio-utrace-chain studio-checklist-rows">
            {trace.checks.map((check, i) => (
              <React.Fragment key={check.id}>
                {(i === 0 || trace.checks[i - 1].stage !== check.stage) && (
                  <li className="studio-utrace-stagehint" aria-hidden="true">
                    {stageTitle(check.stage)}
                  </li>
                )}
                <CheckRow
                  check={check}
                  expanded={open === check.id}
                  onToggle={() => setOpen(open === check.id ? null : check.id)}
                  onShowSurface={() => feature && onOpenFeature(feature.id)}
                  onAsk={() => onAskClaude(traceAskPrompt({ ...trace, checks: [check] }, feature?.title))}
                  fixProps={{ pending, onPendingChange, profiles, affects: trace.profile ? [trace.profile] : undefined }}
                />
              </React.Fragment>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
