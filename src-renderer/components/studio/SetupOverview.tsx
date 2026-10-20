import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, Download, RefreshCw, UserRoundSearch, CloudUpload } from "lucide-react";
import StatusIcon, { type StatusTone } from "../ui/StatusIcon";
import StateView from "../ui/StateView";
import Spinner from "../ui/Spinner";
import type { FeatureSummary, ProfileOption } from "./types";
import type { PendingChange } from "./changes";
import { CheckRow, VerdictCard } from "./ReadinessView";
import { askPrompt, sortForAttention, summarize, verdictTone, type ReadinessState } from "./readiness";
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
  /** Moves when something is written to the org; the page reloads in place, keeping what it shows. */
  version?: number;
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
  version = 0,
}: SetupOverviewProps) {
  const [overview, setOverview] = useState<OverviewState>({ status: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [showPassing, setShowPassing] = useState(false);
  const [refreshIds, setRefreshIds] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  // Newest request wins; what's on screen stays (marked refreshing) while a reload runs.
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const overviewTicket = useRef(0);
  const loadOverview = useCallback(async (refresh = false, keep = refresh) => {
    const ticket = ++overviewTicket.current;
    setOverview((o) => (keep && o.status === "ready" ? o : { status: "loading" }));
    setOverviewRefreshing(true);
    const res = await window.lscApi.studioSetupOverview(refresh);
    if (overviewTicket.current !== ticket) return;
    setOverviewRefreshing(false);
    const error = res.error || (res.data as { error?: string } | undefined)?.error;
    setOverview(error ? { status: "error", error } : { status: "ready", data: res.data as SetupOverviewData });
  }, []);
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);
  // A write elsewhere in Studio: the main process dropped its cached overview, so this reads the org again.
  const firstVersion = useRef(version);
  useEffect(() => {
    if (version === firstVersion.current) return;
    firstVersion.current = version;
    loadOverview(false, true);
  }, [version, loadOverview]);

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
      <StateView
        kind="loading"
        title="Checking your org…"
        detail="Licenses, metadata caches and the territory model. Every query is read-only."
      />
    );
  }
  if (overview.status === "error") {
    return (
      <StateView
        kind="error"
        title="Couldn't check the org"
        detail={overview.error}
        actions={
          <button className="studio-btn" onClick={() => loadOverview(true)}>
            <RefreshCw aria-hidden="true" /> Try again
          </button>
        }
      />
    );
  }

  const data = overview.data;
  const shownChecks = sortForAttention(data.checks).filter((c) => showPassing || c.status !== "pass");
  const fixProps = { pending, onPendingChange, profiles, objects: [] as string[] };
  const loading = loadedCount < ids.length;

  return (
    <div className="studio-page studio-ovw ui-enter">
      <header className="studio-page-head">
        <div>
          <h2>Setup overview</h2>
          <p>Is {data.org} ready for go-live?</p>
        </div>
        <div className="studio-page-actions">
          <button className="studio-btn" onClick={onCheckUser}>
            <UserRoundSearch aria-hidden="true" /> Check a user
          </button>
          <button className="studio-btn" onClick={() => setExporting(true)} disabled={exporting} title="Save a Markdown report of every check">
            <Download aria-hidden="true" /> {exporting ? `Loading features… ${loadedCount}/${ids.length}` : "Export report"}
          </button>
          <button className="studio-btn" onClick={copyReport} title="Copy the report as Markdown">
            <Copy aria-hidden="true" /> Copy
          </button>
          <button className="studio-btn" onClick={refresh} disabled={overviewRefreshing}>
            {overviewRefreshing ? <Spinner size={14} /> : <RefreshCw aria-hidden="true" />} {overviewRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <VerdictCard
        tone={verdictTone(verdict.verdict)}
        title={orgVerdictText(verdict)}
        meta={`${data.org} · ${loadedCount} of ${ids.length} features checked`}
        progress={loading ? { value: loadedCount, max: ids.length, label: "Features checked", neutral: true } : undefined}
      >
        {notice && <div className={`studio-ovw-notice ${notice.kind}`}>{notice.text}</div>}
      </VerdictCard>

      {steps.length > 0 && (
        <section>
          <h3 className="ui-section-title">Do this first</h3>
          <ol className="studio-ovw-steps">
            {steps.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => (s.featureId ? onOpenFeature(s.featureId) : setOpen(s.key))}>
                  <span className="studio-ovw-step-title">{s.title}</span>
                  <span className="studio-ovw-step-where">{s.featureId ? s.detail : `Org-wide · ${s.detail}`}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <div className="studio-section-head">
          <h3 className="ui-section-title">
            Org-wide
            <span className="count">{orgSummary.ran ? `${orgSummary.passed} of ${orgSummary.ran} passing` : "Not checked"}</span>
          </h3>
          <label className="ui-check">
            <input type="checkbox" checked={showPassing} onChange={(e) => setShowPassing(e.target.checked)} />
            Show passing checks
          </label>
        </div>
        {shownChecks.length === 0 ? (
          <div className="studio-readiness-allgood">
            <StatusIcon tone="pass" size={16} /> All {orgSummary.passed} passing
          </div>
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
                      <CloudUpload aria-hidden="true" /> Publish to iPad ({data.unpublishedProfiles.length}{" "}
                      {data.unpublishedProfiles.length === 1 ? "profile" : "profiles"})
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
          <h3 className="ui-section-title">
            {GROUP_TITLES[group.id]}
            <span className="count">{group.cards.length}</span>
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

const CARD_LABELS = { ready: "Ready", issues: "Issues", blocked: "Not ready", unknown: "Unknown" } as const;

function FeatureCard({ card, onOpen, onRetry }: { card: FeatureCardModel; onOpen: () => void; onRetry: () => void }) {
  const { feature, state, summary } = card;
  if (!state || state.status === "loading") {
    return (
      <div className="studio-ovw-card loading" aria-busy="true" aria-label={`${feature.title}: checking`}>
        <div className="studio-ovw-card-title">{feature.title}</div>
        <div className="ui-skeleton" style={{ height: 10, width: "70%" }} />
        <div className="ui-skeleton" style={{ height: 10, width: "45%" }} />
      </div>
    );
  }
  if (state.status === "error" || !summary) {
    return (
      <div className="studio-ovw-card">
        <div className="studio-ovw-card-title">
          {feature.title}
          <StatusIcon tone="unknown" size={20} />
        </div>
        <div className="studio-ovw-card-meta">{state.status === "error" ? state.error : "Nothing could be checked."}</div>
        <div className="studio-ovw-card-foot">
          <button type="button" className="studio-link-btn" onClick={onRetry}>
            <RefreshCw size={12} aria-hidden="true" /> Try again
          </button>
        </div>
      </div>
    );
  }
  const top = [...summary.blocking, ...summary.toFix].slice(0, 3);
  const more = summary.blocking.length + summary.toFix.length - top.length;
  const label = CARD_LABELS[summary.verdict];
  const tone: StatusTone = verdictTone(summary.verdict);
  return (
    <button type="button" className="studio-ovw-card" onClick={onOpen} aria-label={`${feature.title}: ${label}. Open readiness`}>
      <div className="studio-ovw-card-title">
        {feature.title}
        <span className={`ui-pill ${tone}`}>{label}</span>
      </div>
      {top.length > 0 && (
        <ul className="studio-ovw-card-fails">
          {top.map((c) => (
            <li key={c.id}>{c.title}</li>
          ))}
          {more > 0 && <li className="more">+{more} more</li>}
        </ul>
      )}
      <div className="studio-ovw-card-foot studio-ovw-card-meta">
        {summary.blocking.length > 0 && <span className="blocking">{summary.blocking.length} blocking</span>}
        {summary.toFix.length > 0 && <span className="fix">{summary.toFix.length} to fix</span>}
        <span className="ui-num">
          {summary.passed}/{summary.ran} passing
        </span>
      </div>
    </button>
  );
}
