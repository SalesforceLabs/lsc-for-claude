import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureSummary, ProfileOption } from "./types";
import type { PendingChange } from "./changes";
import { CheckRow } from "./ReadinessView";
import { askPrompt, sortForAttention, summarize, type ReadinessState } from "./readiness";
import {
  GROUP_TITLES,
  UNPUBLISHED_CHECK,
  allSettled,
  buildReport,
  groupCards,
  nextSteps,
  orgVerdict,
  orgVerdictText,
  pickToLoad,
  reportFileName,
  type FeatureCardModel,
  type SetupOverviewData,
} from "./overview-helpers";
import "./readiness.css";
import "./setup-overview.css";

export interface SetupOverviewProps {
  features: FeatureSummary[];
  /** Readiness per feature id, shared with the feature pages. */
  readiness: Record<string, ReadinessState>;
  loadReadiness: (featureId: string, refresh?: boolean) => void;
  onOpenFeature: (featureId: string) => void;
  onCheckUser: () => void;
  /** Opens "Publish to iPad" with these profiles preselected. */
  onPublish: (profiles: string[]) => void;
  profiles: ProfileOption[];
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  onAskClaude: (prompt: string) => void;
}

type OverviewState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: SetupOverviewData };

const noop = () => {};

/** Every feature's readiness verdict at a glance, plus org-wide blockers. */
export default function SetupOverview({
  features,
  readiness,
  loadReadiness,
  onOpenFeature,
  onCheckUser,
  onPublish,
  profiles,
  pending,
  onPendingChange,
  onAskClaude,
}: SetupOverviewProps) {
  const [overview, setOverview] = useState<OverviewState>({ status: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [showPassing, setShowPassing] = useState(false);
  const [refreshIds, setRefreshIds] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const loadOverview = useCallback(async (refresh = false) => {
    setOverview((o) => (refresh && o.status === "ready" ? o : { status: "loading" }));
    const res = await window.lscApi.studioSetupOverview(refresh);
    const error = res.error || (res.data as { error?: string } | undefined)?.error;
    setOverview(error ? { status: "error", error } : { status: "ready", data: res.data as SetupOverviewData });
  }, []);
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Feature readiness loads a few at a time, so the page fills in as results arrive.
  const ids = useMemo(() => features.filter((f) => f.available).map((f) => f.id), [features]);
  useEffect(() => {
    const next = pickToLoad(ids, readiness, refreshIds);
    if (next.length === 0) return;
    const refreshing = next.filter((id) => refreshIds.has(id));
    if (refreshing.length) setRefreshIds((s) => new Set([...s].filter((id) => !refreshing.includes(id))));
    for (const id of next) loadReadiness(id, refreshIds.has(id));
  }, [ids, readiness, refreshIds, loadReadiness]);

  const settled = allSettled(ids, readiness);
  const loadedCount = ids.filter((id) => readiness[id] && readiness[id].status !== "loading").length;

  const checks = overview.status === "ready" ? overview.data.checks : [];
  const verdict = useMemo(() => orgVerdict(checks, features, readiness), [checks, features, readiness]);
  const groups = useMemo(() => groupCards(features, readiness), [features, readiness]);
  const steps = useMemo(() => nextSteps(checks, features, readiness), [checks, features, readiness]);
  const orgSummary = useMemo(() => summarize(checks), [checks]);

  const refresh = () => {
    setNotice(null);
    setRefreshIds(new Set(ids));
    loadOverview(true);
  };

  const exportReport = useCallback(
    async (data: SetupOverviewData) => {
      const markdown = buildReport(data, features, readiness);
      const res = await window.lscApi.perfSaveFile(reportFileName(data.org), markdown, "md");
      if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
    },
    [features, readiness]
  );
  // "Export" waits for the remaining features to load, then saves.
  useEffect(() => {
    if (!exporting || !settled || overview.status !== "ready") return;
    setExporting(false);
    exportReport(overview.data).catch((err) => setNotice({ kind: "error", text: `Couldn't save the report: ${String(err)}` }));
  }, [exporting, settled, overview, exportReport]);

  const copyReport = async () => {
    if (overview.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(buildReport(overview.data, features, readiness));
      setNotice({ kind: "info", text: settled ? "Copied the report as Markdown." : "Copied the report so far; some features were still loading." });
    } catch {
      setNotice({ kind: "error", text: "Couldn't copy to the clipboard." });
    }
  };

  if (overview.status === "loading") {
    return (
      <div className="studio-placeholder">
        <div className="studio-spinner" />
        <div>Checking your org…</div>
        <div className="studio-placeholder-sub">Licenses, metadata caches and the territory model. Every query is read-only.</div>
      </div>
    );
  }
  if (overview.status === "error") {
    return (
      <div className="studio-placeholder">
        <div className="studio-placeholder-error">Couldn't check the org</div>
        <div className="studio-placeholder-sub">{overview.error}</div>
        <button className="studio-btn" onClick={() => loadOverview(true)}>
          Try again
        </button>
      </div>
    );
  }

  const data = overview.data;
  const tone = verdict.verdict === "ready" ? "ready" : verdict.verdict === "unknown" ? "none" : "failing";
  const shownChecks = sortForAttention(data.checks).filter((c) => showPassing || c.status !== "pass");
  const fixProps = { pending, onPendingChange, profiles, objects: [] as string[] };

  return (
    <div className="studio-readiness studio-ovw">
      <div className={`studio-verdict ${tone}${verdict.verdict === "issues" ? " issues" : ""}`} role="status">
        <div className="studio-verdict-title">
          <span className="studio-verdict-icon" aria-hidden="true">
            {verdict.verdict === "ready" ? "✓" : verdict.verdict === "unknown" ? "?" : verdict.verdict === "issues" ? "!" : "✗"}
          </span>
          {orgVerdictText(verdict)}
        </div>
        <div
          className="studio-verdict-bar"
          role="progressbar"
          aria-label="Features checked"
          aria-valuemin={0}
          aria-valuemax={ids.length}
          aria-valuenow={loadedCount}
        >
          <span style={{ width: `${ids.length ? (loadedCount / ids.length) * 100 : 0}%` }} />
        </div>
        <div className="studio-ovw-actions">
          <span className="studio-readiness-counts">
            {data.org} · {loadedCount} of {ids.length} features checked
          </span>
          <button className="studio-btn" onClick={onCheckUser}>
            Check a user…
          </button>
          <button className="studio-btn" onClick={() => setExporting(true)} disabled={exporting} title="Save a Markdown report of every check">
            {exporting ? `Loading features… ${loadedCount}/${ids.length}` : "Export go-live report"}
          </button>
          <button className="studio-btn" onClick={copyReport} title="Copy the report as Markdown">
            Copy
          </button>
          <button className="studio-btn" onClick={refresh}>
            Refresh
          </button>
        </div>
        {notice && <div className={`studio-ovw-notice ${notice.kind}`}>{notice.text}</div>}
      </div>

      {steps.length > 0 && (
        <section>
          <h3 className="studio-lane-title">Do this first</h3>
          <ol className="studio-ovw-steps">
            {steps.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="studio-link-btn"
                  onClick={() => (s.featureId ? onOpenFeature(s.featureId) : setOpen(s.key))}
                >
                  {s.title}
                </button>
                <span className="studio-ovw-step-where">{s.featureId ? s.detail : `Org-wide · ${s.detail}`}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="studio-lane-title">
          Org-wide
          <span className="studio-readiness-stage-count">
            {orgSummary.ran ? `${orgSummary.passed} of ${orgSummary.ran} passing` : "Not checked"}
            <label className="studio-readiness-toggle">
              <input type="checkbox" checked={showPassing} onChange={(e) => setShowPassing(e.target.checked)} />
              Show passing checks
            </label>
          </span>
        </h3>
        {shownChecks.length === 0 ? (
          <div className="studio-readiness-allgood">✓ All {orgSummary.passed} passing</div>
        ) : (
          <ul className="studio-checklist-rows">
            {shownChecks.map((check) => (
              <React.Fragment key={check.id}>
                <CheckRow
                  check={check}
                  expanded={open === check.id}
                  onToggle={() => setOpen(open === check.id ? null : check.id)}
                  onShowSurface={noop}
                  onAsk={() => onAskClaude(askPrompt("Org-wide", check))}
                  fixProps={fixProps}
                />
                {check.id === UNPUBLISHED_CHECK && check.status === "fail" && data.unpublishedProfiles.length > 0 && (
                  <li className="studio-ovw-publish">
                    <button className="studio-btn primary" onClick={() => onPublish(data.unpublishedProfiles)}>
                      Publish to iPad ({data.unpublishedProfiles.length} {data.unpublishedProfiles.length === 1 ? "profile" : "profiles"})
                    </button>
                  </li>
                )}
              </React.Fragment>
            ))}
          </ul>
        )}
      </section>

      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="studio-lane-title">
            {GROUP_TITLES[group.id]}
            <span className="studio-readiness-stage-count">{group.cards.length}</span>
          </h3>
          <div className="studio-ovw-grid">
            {group.cards.map((card) => (
              <FeatureCard key={card.feature.id} card={card} onOpen={() => onOpenFeature(card.feature.id)} onRetry={() => loadReadiness(card.feature.id, true)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FeatureCard({ card, onOpen, onRetry }: { card: FeatureCardModel; onOpen: () => void; onRetry: () => void }) {
  const { feature, state, summary } = card;
  if (!state || state.status === "loading") {
    return (
      <div className="studio-ovw-card loading" aria-busy="true">
        <div className="studio-ovw-card-title">{feature.title}</div>
        <div className="studio-ovw-card-meta">
          <span className="studio-spinner small" /> Checking…
        </div>
      </div>
    );
  }
  if (state.status === "error" || !summary) {
    return (
      <div className="studio-ovw-card unknown">
        <div className="studio-ovw-card-title">{feature.title}</div>
        <div className="studio-ovw-card-meta">{state.status === "error" ? state.error : "Nothing could be checked."}</div>
        <button type="button" className="studio-link-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  const top = [...summary.blocking, ...summary.toFix].slice(0, 3);
  const more = summary.blocking.length + summary.toFix.length - top.length;
  const label = { ready: "Ready", issues: "Issues", blocked: "Not ready", unknown: "Unknown" }[summary.verdict];
  return (
    <button type="button" className={`studio-ovw-card ${summary.verdict}`} onClick={onOpen} aria-label={`${feature.title}: ${label}. Open readiness`}>
      <div className="studio-ovw-card-title">
        {feature.title}
        <span className="studio-ovw-badge">{label}</span>
      </div>
      <div className="studio-ovw-card-meta">
        {summary.blocking.length > 0 && <span className="blocking">{summary.blocking.length} blocking</span>}
        {summary.toFix.length > 0 && <span className="fix">{summary.toFix.length} to fix</span>}
        <span>
          {summary.passed}/{summary.ran} passing
        </span>
      </div>
      {top.length > 0 && (
        <ul className="studio-ovw-card-fails">
          {top.map((c) => (
            <li key={c.id}>{c.title}</li>
          ))}
          {more > 0 && <li className="more">+{more} more</li>}
        </ul>
      )}
    </button>
  );
}
