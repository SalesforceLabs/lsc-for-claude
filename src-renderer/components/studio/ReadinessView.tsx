import React, { useMemo, useState } from "react";
import type { ProfileOption, ReadinessCheck, SurfaceId } from "./types";
import type { PendingChange } from "./changes";
import FixButtons from "./FixButtons";
import { askPrompt, byStage, sortForAttention, summarize, verdictText, type ReadinessState } from "./readiness";
import "./readiness.css";

const ICONS: Record<ReadinessCheck["status"], string> = { pass: "✓", fail: "✗", unknown: "?", skipped: "–" };
const STATUS_TEXT: Record<ReadinessCheck["status"], string> = {
  pass: "Passing",
  fail: "Failing",
  unknown: "Couldn't check",
  skipped: "Skipped",
};

interface ReadinessViewProps {
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
      <div className="studio-placeholder">
        <div className="studio-spinner" />
        <div>Checking {title}…</div>
        <div className="studio-placeholder-sub">Running its readiness checks against your org. Every query is read-only.</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="studio-placeholder">
        <div className="studio-placeholder-error">Couldn't check this feature</div>
        <div className="studio-placeholder-sub">{state.error}</div>
        <button className="studio-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const ranPct = summary.ran ? (summary.passed / summary.ran) * 100 : 0;
  return (
    <div className="studio-readiness">
      <div className={`studio-verdict ${summary.verdict === "ready" ? "ready" : summary.verdict === "unknown" ? "none" : "failing"}`} role="status">
        <div className="studio-verdict-title">
          <span className="studio-verdict-icon" aria-hidden="true">
            {summary.verdict === "ready" ? "✓" : summary.verdict === "unknown" ? "?" : summary.verdict === "issues" ? "!" : "✗"}
          </span>
          {verdictText(summary)}
        </div>
        {summary.ran > 0 && (
          <div
            className="studio-verdict-bar"
            role="progressbar"
            aria-label="Checks passing"
            aria-valuemin={0}
            aria-valuemax={summary.ran}
            aria-valuenow={summary.passed}
          >
            <span style={{ width: `${ranPct}%` }} />
          </div>
        )}
        <div className="studio-readiness-counts">
          {summary.passed} of {summary.ran} passing
          {summary.suggestions.length > 0 && ` · ${summary.suggestions.length} best-practice suggestions`}
          {summary.unknown > 0 && ` · ${summary.unknown} couldn't be checked`}
          {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          <label className="studio-readiness-toggle">
            <input type="checkbox" checked={showPassing} onChange={(e) => setShowPassing(e.target.checked)} />
            Show passing checks
          </label>
        </div>
      </div>

      {groups.map(({ stage, checks: stageChecks }) => {
        const shown = sortForAttention(stageChecks).filter((c) => showPassing || c.status !== "pass");
        const passed = stageChecks.filter((c) => c.status === "pass").length;
        const ran = stageChecks.filter((c) => c.status === "pass" || c.status === "fail").length;
        return (
          <section key={stage.id} className="studio-readiness-stage">
            <h3 className="studio-lane-title">
              {stage.title}
              <span className="studio-readiness-stage-count">
                {ran ? `${passed} of ${ran} passing` : "Not checked"}
              </span>
            </h3>
            {shown.length === 0 ? (
              <div className="studio-readiness-allgood">✓ All {passed} passing</div>
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

interface CheckRowProps {
  check: ReadinessCheck;
  expanded: boolean;
  onToggle: () => void;
  onShowSurface: (id: SurfaceId) => void;
  onAsk: () => void;
  fixProps: Omit<React.ComponentProps<typeof FixButtons>, "fixes">;
}

export function CheckRow({ check, expanded, onToggle, onShowSurface, onAsk, fixProps }: CheckRowProps) {
  const tone = check.status === "fail" ? check.severity : check.status;
  return (
    <li className={`studio-rcheck ${tone}`}>
      <button type="button" className="studio-check-main" aria-expanded={expanded} onClick={onToggle}>
        <span className="studio-check-icon" aria-hidden="true">
          {ICONS[check.status]}
        </span>
        <span className="studio-check-text">
          <span className="studio-check-label">
            {check.title}
            <span className="studio-sr-only"> — {STATUS_TEXT[check.status]}</span>
          </span>
          {check.detail && <span className="studio-check-detail">{check.detail}</span>}
        </span>
        {check.status === "fail" && (
          <span className={`studio-rcheck-sev ${check.severity}`}>
            {check.severity === "error" ? "Blocking" : check.severity === "warning" ? "Fix" : "Suggestion"}
          </span>
        )}
      </button>
      {check.status === "fail" && check.fixes && check.fixes.length > 0 && <FixButtons fixes={check.fixes} {...fixProps} />}
      {expanded && (
        <div className="studio-rcheck-body">
          {check.why && <p>{check.why}</p>}
          {check.examples && check.examples.length > 0 && (
            <div>
              <strong>Records:</strong> {check.examples.join(", ")}
            </div>
          )}
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
                Show on board
              </button>
            )}
            {check.status !== "pass" && check.status !== "skipped" && (
              <button type="button" className="studio-link-btn" onClick={onAsk}>
                Ask Claude how to fix
              </button>
            )}
            <span className="studio-rcheck-id">
              {check.source === "rule" ? "Rule" : "Studio check"} {check.id}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
