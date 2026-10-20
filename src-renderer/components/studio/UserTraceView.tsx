import React, { useEffect, useMemo, useRef, useState } from "react";
import { CloudUpload, ExternalLink, Play, RefreshCw, Sparkles, UserRound, UserRoundSearch } from "lucide-react";
import Spinner from "../ui/Spinner";
import StateView from "../ui/StateView";
import { Limited } from "../ui/Limited";
import type { FeatureSummary, ProfileOption } from "./types";
import type { PerfUser } from "./perf-types";
import type { PendingChange } from "./changes";
import { CheckRow, VerdictCard } from "./ReadinessView";
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
  /** Open this rep in Sync health: what their iPad downloads and how their syncs are going. */
  onOpenSyncRep?: (userId: string) => void;
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
  onOpenSyncRep,
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
  /** Bumped per run and when the user changes, so a late answer for another rep is dropped. */
  const request = useRef(0);

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
    const token = ++request.current;
    setState({ status: "loading" });
    const res = await window.lscApi.studioUserTrace(user.id, featureId || undefined);
    if (token !== request.current) return;
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
    <div className="studio-page studio-utrace ui-enter">
      <header className="studio-page-head">
        <div>
          <h2>Check a user</h2>
          <p>Checks one rep's licenses, permissions, territory and last sync to find what's blocking them.</p>
        </div>
      </header>

      <div className="studio-utrace-form">
        <label className="ui-label studio-utrace-field">
          User
          <input
            type="search"
            className="ui-field"
            value={search}
            placeholder="Name or username"
            onChange={(e) => {
              setSearch(e.target.value);
              setUser(null);
              request.current++;
              setState({ status: "idle" });
            }}
          />
        </label>
        <label className="ui-label studio-utrace-field">
          Feature (optional)
          <select className="ui-field" value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
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
          <Play aria-hidden="true" /> Run check
        </button>
      </div>

      {!user && (
        <div>
          {users.error && (
            <div className="studio-utrace-note error" role="alert">
              {users.error}
            </div>
          )}
          {users.loading && users.list.length === 0 && (
            <div className="studio-utrace-note">
              <Spinner size={12} /> Searching users…
            </div>
          )}
          {users.list.length > 0 && (
            <ul className="studio-utrace-users" aria-label="Matching users">
              <Limited as="li" items={users.list} render={(u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="studio-utrace-user"
                    onClick={() => {
                      setUser(u);
                      setSearch(u.name);
                      request.current++;
                      setState({ status: "idle" });
                    }}
                  >
                    <UserRound size={14} aria-hidden="true" />
                    <span className="studio-utrace-user-name">{u.name}</span>
                    <span className="studio-utrace-user-sub">{u.username}</span>
                    <span className="studio-utrace-user-profile">{u.profile}</span>
                  </button>
                </li>
              )} />
            </ul>
          )}
          {!users.loading && !users.error && users.list.length === 0 && <div className="studio-utrace-note">No active users match.</div>}
        </div>
      )}
      {user && state.status === "idle" && (
        <div className="studio-utrace-note">
          <UserRound size={14} aria-hidden="true" />
          <span>
            <strong>{user.name}</strong> · {user.profile}
            {profileUsers ? ` (${profileUsers} users on this profile)` : ""}. Pick a feature if the problem is specific to one, then run the check.
          </span>
        </div>
      )}

      {state.status === "loading" && (
        <StateView
          kind="loading"
          layout="inline"
          title={`Checking ${user?.name}…`}
          detail="Walking the chain from licenses to their last sync. Every query is read-only."
        />
      )}
      {state.status === "error" && (
        <StateView
          kind="error"
          layout="inline"
          title="Couldn't check this user"
          detail={state.error}
          actions={
            <button className="studio-btn" onClick={run}>
              <RefreshCw aria-hidden="true" /> Try again
            </button>
          }
        />
      )}

      {trace && headline && (
        <>
          <VerdictCard
            tone={headline.tone}
            title={`${trace.userName}: ${headline.text}`}
            meta={`${trace.profile ?? "No profile"} · checked ${new Date(trace.collectedAt).toLocaleTimeString()}`}
          >
            <div className="studio-verdict-actions">
              {trace.featureId && (
                <button type="button" className="studio-link-btn" onClick={() => onOpenFeature(trace.featureId!)}>
                  <ExternalLink size={12} aria-hidden="true" /> Open {feature?.title ?? "feature"}
                </button>
              )}
              {!headline.ok && (
                <button type="button" className="studio-link-btn" onClick={() => onAskClaude(traceAskPrompt(trace, feature?.title))}>
                  <Sparkles size={12} aria-hidden="true" /> Ask <AssistantName /> about this user
                </button>
              )}
              {trace.profile && (trace.checks.some(needsPublish) || pending.length > 0) && (
                <button type="button" className="studio-link-btn" onClick={() => onPublish([trace.profile!])}>
                  <CloudUpload size={12} aria-hidden="true" /> Publish to iPad
                </button>
              )}
              {onOpenSyncRep && (
                <button type="button" className="studio-link-btn" onClick={() => onOpenSyncRep(trace.userId)}>
                  <UserRoundSearch size={12} aria-hidden="true" /> See their sync
                </button>
              )}
              <button type="button" className="studio-link-btn" onClick={run}>
                <RefreshCw size={12} aria-hidden="true" /> Re-run
              </button>
            </div>
          </VerdictCard>

          <ol className="studio-utrace-chain studio-checklist-rows">
            {trace.checks.map((check, i) => (
              <React.Fragment key={check.id}>
                {(i === 0 || trace.checks[i - 1].stage !== check.stage) && (
                  <li className="ui-section-title studio-utrace-stagehint" aria-hidden="true">
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
