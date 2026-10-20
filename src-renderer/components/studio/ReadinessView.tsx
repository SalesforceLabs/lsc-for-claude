import React, { useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Sparkles, RefreshCw } from "lucide-react";
import StatusIcon, { type StatusTone } from "../ui/StatusIcon";
import StateView from "../ui/StateView";
import type { ProfileOption, ReadinessCheck, SurfaceId } from "./types";
import type { PendingChange } from "./changes";
import FixButtons from "./FixButtons";
import { askPrompt, byStage, sortForAttention, summarize, verdictText, verdictTone, type ReadinessState } from "./readiness";
import { isRevalidating } from "./fix-effects";
import "./readiness.css";
import FeatureLoading from "./FeatureLoading";
import { AssistantName } from "../../hooks/useAssistantName";

const STATUS_TEXT: Record<ReadinessCheck["status"], string> = {
  pass: "Passing",
  fail: "Failing",
  unknown: "Couldn't check",
  skipped: "Skipped",
};

interface ReadinessViewProps {
  featureId: string;
  title: string;
  state: ReadinessState | undefined;
  /** Objects offered in new records' forms. */
  objects: string[];
  profiles: ProfileOption[];
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  /** Opens a board surface in the inspector. */
  onShowSurface: (id: SurfaceId) => void;
  onAskClaude: (prompt: string) => void;
  onRetry: () => void;
}

/** Is this feature ready for the field? A verdict, then every check by stage, failing first. */
export default function ReadinessView({
  featureId,
  title,
  state,
  objects,
  profiles,
  pending,
  onPendingChange,
  onShowSurface,
  onAskClaude,
  onRetry,
}: ReadinessViewProps) {
  const [showPassing, setShowPassing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const checks = state?.status === "ready" ? state.readiness.checks : [];
  const summary = useMemo(() => summarize(checks), [checks]);
  const groups = useMemo(() => byStage(checks), [checks]);

  if (!state || state.status === "loading") {
    return (
      <FeatureLoading featureId={featureId} title={title} kind="readiness" />
    );
  }
  if (state.status === "error") {
    return (
      <StateView
        kind="error"
        title="Couldn't check this feature"
        detail={state.error}
        actions={
          <button className="studio-btn" onClick={onRetry}>
            <RefreshCw aria-hidden="true" /> Try again
          </button>
        }
      />
    );
  }

  const details = [
    isRevalidating(state) && "Refreshing — these results are from before your last change",
    `${summary.passed} of ${summary.ran} passing`,
    summary.suggestions.length > 0 && `${summary.suggestions.length} best-practice ${summary.suggestions.length === 1 ? "suggestion" : "suggestions"}`,
    summary.unknown > 0 && `${summary.unknown} couldn't be checked`,
    summary.skipped > 0 && `${summary.skipped} skipped`,
  ].filter(Boolean);
  return (
    <div className="studio-page ui-enter">
      <VerdictCard
        tone={verdictTone(summary.verdict)}
        title={verdictText(summary)}
        meta={details.join(" · ")}
        progress={summary.ran > 0 ? { value: summary.passed, max: summary.ran, label: "Checks passing" } : undefined}
        aside={
          <label className="ui-check">
            <input type="checkbox" checked={showPassing} onChange={(e) => setShowPassing(e.target.checked)} />
            Show passing checks
          </label>
        }
      />

      {groups.map(({ stage, checks: stageChecks }) => {
        const shown = sortForAttention(stageChecks).filter((c) => showPassing || c.status !== "pass");
        const passed = stageChecks.filter((c) => c.status === "pass").length;
        const ran = stageChecks.filter((c) => c.status === "pass" || c.status === "fail").length;
        return (
          <section key={stage.id}>
            <h3 className="ui-section-title">
              {stage.title}
              <span className="count">{ran ? `${passed} of ${ran} passing` : "Not checked"}</span>
            </h3>
            {shown.length === 0 ? (
              <div className="studio-readiness-allgood">
                <StatusIcon tone="pass" size={16} /> All {passed} passing
              </div>
            ) : (
              <ul className="studio-checklist-rows">
                {shown.map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    expanded={open === check.id}
                    onToggle={() => setOpen(open === check.id ? null : check.id)}
                    onShowSurface={onShowSurface}
                    onAsk={() => onAskClaude(askPrompt(title, check))}
                    fixProps={{ pending, onPendingChange, profiles, objects }}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface VerdictCardProps {
  tone: StatusTone;
  title: React.ReactNode;
  /** One line under the title. */
  meta?: React.ReactNode;
  /** A bar under the text, coloured by the verdict's tone. */
  progress?: { value: number; max: number; label: string; /** Accent-coloured, for progress that isn't a pass rate. */ neutral?: boolean };
  /** Right-aligned control beside the meta line. */
  aside?: React.ReactNode;
  /** Buttons or links under the bar. */
  children?: React.ReactNode;
}

/** The verdict at the top of a readiness-style page: a neutral card, a status icon and bar in the verdict's tone. */
export function VerdictCard({ tone, title, meta, progress, aside, children }: VerdictCardProps) {
  return (
    <div className={`studio-verdict ${tone}`} role="status">
      <StatusIcon tone={tone} size={32} />
      <div className="studio-verdict-body">
        <div className="studio-verdict-title">{title}</div>
        {progress && (
          <div
            className={`studio-verdict-bar${progress.neutral ? " neutral" : ""}`}
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={progress.max}
            aria-valuenow={progress.value}
          >
            <span style={{ width: `${progress.max ? (progress.value / progress.max) * 100 : 0}%` }} />
          </div>
        )}
        {(meta || aside) && (
          <div className="studio-verdict-meta">
            {meta && <span>{meta}</span>}
            {aside}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

interface CheckRowProps {
  check: ReadinessCheck;
  expanded: boolean;
  onToggle: () => void;
  onShowSurface: (id: SurfaceId) => void;
  onAsk: () => void;
  fixProps: Omit<React.ComponentProps<typeof FixButtons>, "fixes">;
}

export function CheckRow({ check, expanded, onToggle, onShowSurface, onAsk, fixProps }: CheckRowProps) {
  const tone: StatusTone = check.status === "fail" ? check.severity : check.status;
  return (
    <li className={`studio-rcheck ${tone}`}>
      <button type="button" className="studio-check-main" aria-expanded={expanded} onClick={onToggle}>
        <StatusIcon tone={tone} size={20} />
        <span className="studio-check-text">
          <span className="studio-check-label">
            {check.title}
            <span className="studio-sr-only"> — {STATUS_TEXT[check.status]}</span>
          </span>
          {check.detail && <span className="studio-check-detail">{check.detail}</span>}
        </span>
        {check.status === "fail" && (
          <span className={`ui-pill ${check.severity}`}>
            {check.severity === "error" ? "Blocking" : check.severity === "warning" ? "Fix" : "Suggestion"}
          </span>
        )}
        <ChevronRight className="studio-check-chevron" size={14} aria-hidden="true" />
      </button>
      {check.status === "fail" && check.fixes && check.fixes.length > 0 && <FixButtons fixes={check.fixes} {...fixProps} />}
      {expanded && (
        <div className="studio-rcheck-body">
          {check.why && <p>{check.why}</p>}
          {check.examples && check.examples.length > 0 &&
            // Names read fine on one line; sentences (a page and what's wrong with it) get a line each.
            (check.examples.some((e) => e.length > 60) ? (
              <div>
                <strong>Records:</strong>
                <ul className="studio-rcheck-steps">
                  {check.examples.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                <strong>Records:</strong> {check.examples.join(", ")}
              </div>
            ))}
          {check.steps && check.steps.length > 0 && check.status !== "pass" && (
            <ol className="studio-rcheck-steps">
              {check.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {check.uiPath && (
            <div className="studio-rcheck-path">
              <strong>Where:</strong> {check.uiPath}
            </div>
          )}
          <div className="studio-rcheck-actions">
            {check.surface && (
              <button type="button" className="studio-link-btn" onClick={() => onShowSurface(check.surface!)}>
                <ExternalLink size={12} aria-hidden="true" /> Show on board
              </button>
            )}
            {check.status !== "pass" && check.status !== "skipped" && (
              <button type="button" className="studio-link-btn" onClick={onAsk}>
                <Sparkles size={12} aria-hidden="true" /> Ask <AssistantName /> how to fix
              </button>
            )}
            <span className="studio-rcheck-id">
              {check.source === "rule" ? "Rule" : check.source === "cause" ? "Known cause" : "Studio check"} {check.id}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
