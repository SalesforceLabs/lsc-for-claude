import React, { useMemo, useState } from "react";
import type { FeatureMap, SurfaceId } from "./types";
import type { Lens } from "./lens";
import { allFindings, countBySeverity } from "./findings";
import { checklist, copyChanges, copySources, type CheckStatus, type ChecklistRow } from "./checklist";
import { queueChange, stackChange, type PendingChange } from "./changes";
import { SeverityChips } from "./SeverityChips";

const ICONS: Record<CheckStatus, string> = { ok: "✓", missing: "✗", attention: "!", everyone: "–", error: "!" };
const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: "Passing",
  missing: "Failing",
  attention: "Needs attention",
  everyone: "Applies to everyone",
  error: "Couldn't load",
};

interface LensChecklistProps {
  map: FeatureMap;
  lens: NonNullable<Lens>;
  selectedSurface: SurfaceId | null;
  onSelectSurface: (id: SurfaceId | null) => void;
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  onPublish: (profiles: string[]) => void;
  /** Back to the board for everyone. */
  onExit: () => void;
}

/** A feature checked for one profile: a verdict, the per-profile checks in order, then what applies to everyone. */
export default function LensChecklist({
  map,
  lens,
  selectedSurface,
  onSelectSurface,
  pending,
  onPendingChange,
  onPublish,
  onExit,
}: LensChecklistProps) {
  const rows = useMemo(() => checklist(map, lens), [map, lens]);
  const checks = rows.filter((r) => r.scoped);
  const shared = rows.filter((r) => !r.scoped);
  const failing = checks.filter((r) => r.status !== "ok").length;

  const sources = useMemo(() => copySources(rows.map((r) => r.surface), lens), [rows, lens]);
  const [picked, setPicked] = useState("");
  const from = (sources.find((s) => s.profile === picked) ?? sources[0])?.profile;
  const all = from ? copyChanges(rows.map((r) => r.surface), lens, from, pending) : null;

  const queue = (changes: PendingChange[]) =>
    onPendingChange(changes.reduce((acc, c) => queueChange(acc, stackChange(acc, c)), pending));
  const rowProps = { lens, from, pending, selectedSurface, onSelectSurface, onQueue: queue, onPublish };

  return (
    <div className="studio-checklist">
      <button type="button" className="studio-link-btn studio-checklist-back" onClick={onExit}>
        ← Back to all configuration
      </button>
      <h2 className="studio-checklist-title">
        <span className="studio-checklist-eyebrow">{map.checkTitle ?? `${map.title} setup check`}</span>
        {lens.profile}
      </h2>

      <div className={`studio-verdict ${checks.length === 0 ? "none" : failing ? "failing" : "ready"}`} role="status">
        {checks.length === 0 ? (
          <div className="studio-verdict-title">
            Nothing in {map.title} is set per profile — everything below applies to everyone.
          </div>
        ) : (
          <>
            <div className="studio-verdict-title">
              <span className="studio-verdict-icon" aria-hidden="true">
                {failing ? "✗" : "✓"}
              </span>
              {failing
                ? `Not ready: ${failing} of ${checks.length} checks failing`
                : `Ready: all ${checks.length} checks pass`}
            </div>
            <div
              className="studio-verdict-bar"
              role="progressbar"
              aria-label="Checks passing"
              aria-valuemin={0}
              aria-valuemax={checks.length}
              aria-valuenow={checks.length - failing}
            >
              <span style={{ width: `${((checks.length - failing) / checks.length) * 100}%` }} />
            </div>
          </>
        )}
        {from && all && all.matched > 0 && (
          <div className="studio-verdict-fix">
            <label>
              <span>{failing ? "Fastest fix: copy setup from" : "Copy more setup from"}</span>
              <select value={from} onChange={(e) => setPicked(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.profile} value={s.profile}>
                    {s.profile} ({s.count})
                  </option>
                ))}
              </select>
            </label>
            <CopyButton result={all} label={(n) => `Copy ${n}`} onQueue={queue} />
          </div>
        )}
      </div>

      {checks.length > 0 && (
        <ol className="studio-checklist-rows">
          {checks.map((row, idx) => (
            <Row key={row.step.surface} row={row} number={idx + 1} {...rowProps} />
          ))}
        </ol>
      )}

      {shared.length > 0 && (
        <section className="studio-checklist-shared">
          <h3 className="studio-lane-title">Applies to everyone</h3>
          <ul className="studio-checklist-rows">
            {shared.map((row) => (
              <Row key={row.step.surface} row={row} {...rowProps} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface RowProps {
  row: ChecklistRow;
  /** Set on per-profile checks. */
  number?: number;
  lens: NonNullable<Lens>;
  from: string | undefined;
  pending: PendingChange[];
  selectedSurface: SurfaceId | null;
  onSelectSurface: (id: SurfaceId | null) => void;
  onQueue: (changes: PendingChange[]) => void;
  onPublish: (profiles: string[]) => void;
}

function Row({ row, number, lens, from, pending, selectedSurface, onSelectSurface, onQueue, onPublish }: RowProps) {
  const { status, step, surface, finding } = row;
  const selected = surface.id === selectedSurface;
  const copy = from ? copyChanges([surface], lens, from, pending) : null;
  return (
    <li className={`studio-check ${status}${selected ? " selected" : ""}${number ? "" : " shared"}`}>
      <button type="button" className="studio-check-main" aria-pressed={selected} onClick={() => onSelectSurface(surface.id)}>
        {number && <span className="studio-check-num">{number}</span>}
        <span className="studio-check-icon" aria-hidden="true">
          {ICONS[status]}
        </span>
        <span className="studio-check-text">
          <span className="studio-check-label">
            {step.label}
            <span className="studio-sr-only"> — {STATUS_TEXT[status]}</span>
          </span>
          <span className="studio-check-detail">{row.detail}</span>
          {status === "attention" && finding && (
            <span className={`studio-check-finding ${finding.severity}`}>{finding.title}</span>
          )}
        </span>
        <SeverityChips counts={countBySeverity(allFindings(surface, lens))} compact />
      </button>
      <div className="studio-check-actions">
        {copy && from && (
          <CopyButton
            result={copy}
            label={(n) => `Copy ${n}${status === "missing" ? "" : " more"} from ${from}`}
            onQueue={onQueue}
          />
        )}
        {status === "missing" && step.publish && (
          <button type="button" className="studio-fix-btn" onClick={() => onPublish([lens.profile])}>
            Publish to iPad
          </button>
        )}
      </div>
    </li>
  );
}

function CopyButton({
  result,
  label,
  onQueue,
}: {
  result: { matched: number; changes: PendingChange[] };
  label: (n: number) => string;
  onQueue: (changes: PendingChange[]) => void;
}) {
  if (result.matched === 0) return null;
  if (result.changes.length === 0) return <span className="studio-pending-tag">Queued</span>;
  return (
    <button type="button" className="studio-fix-btn" title="Add to pending changes" onClick={() => onQueue(result.changes)}>
      {label(result.changes.length)}
    </button>
  );
}
