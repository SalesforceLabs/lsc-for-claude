import React, { useEffect, useState } from "react";
import type { FixPreview, FixResult } from "./types";
import { isMobileChange, publishProfiles, type PendingChange } from "./changes";

interface ReviewDialogProps {
  changes: PendingChange[];
  /** The org the map was collected from — changes are refused if the target org has changed. */
  org: string;
  /**
   * `applied` — changes now in the org (the map needs a refresh).
   * `remaining` — what should stay in the tray (blocked, failed, or not yet applied).
   */
  onClose: (applied: PendingChange[], remaining: PendingChange[]) => void;
  onPublish: (profiles: string[] | null) => void;
}

type Outcome = { state: "ok"; result: FixResult } | { state: "failed"; message: string } | { state: "skipped"; message: string };

type Phase =
  | { step: "previewing" }
  | { step: "review"; previews: (FixPreview | string)[] }
  | { step: "applying"; previews: (FixPreview | string)[]; outcomes: (Outcome | null)[] }
  | { step: "done"; previews: (FixPreview | string)[]; outcomes: Outcome[] };

function responseError(res: { data?: unknown; error?: string }): string | undefined {
  return res.error || (res.data as { error?: string } | undefined)?.error;
}

/** A preview that loaded and isn't blocked. */
const ready = (p: FixPreview | string | undefined): p is FixPreview => typeof p === "object" && !p.blocked;

/**
 * Review → apply for the pending-changes tray. Every change is previewed
 * against the live org; nothing is written until the user clicks the apply
 * button, which names the org. Applied changes can be undone together, which
 * goes through the same review.
 */
export default function ReviewDialog({ changes: initial, org, onClose, onPublish }: ReviewDialogProps) {
  const [changes, setChanges] = useState(initial);
  const [phase, setPhase] = useState<Phase>({ step: "previewing" });
  // Everything applied across this dialog's lifetime (including undos), for the refresh + publish.
  const [applied, setApplied] = useState<PendingChange[]>([]);
  // Reviewing an Undo batch — cancelling it leaves nothing pending (the originals are already applied).
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase({ step: "previewing" });
    Promise.all(
      changes.map((c) =>
        window.lscApi.studioPreviewFix(c.fix).then((res) => responseError(res) ?? (res.data as FixPreview))
      )
    ).then((previews) => {
      if (!cancelled) setPhase({ step: "review", previews });
    });
    return () => {
      cancelled = true;
    };
  }, [changes]);

  const applyAll = async (previews: (FixPreview | string)[]) => {
    const outcomes: (Outcome | null)[] = changes.map(() => null);
    setPhase({ step: "applying", previews, outcomes: [...outcomes] });
    const done: PendingChange[] = [];
    for (let i = 0; i < changes.length; i++) {
      const p = previews[i];
      if (!ready(p)) {
        outcomes[i] = { state: "skipped", message: typeof p === "string" ? p : (p as FixPreview).blocked! };
      } else {
        const res = await window.lscApi.studioApplyFix(changes[i].fix, org);
        const error = responseError(res);
        const result = res.data as FixResult | undefined;
        if (error || !result?.ok) outcomes[i] = { state: "failed", message: error || result?.message || "Failed" };
        else {
          outcomes[i] = { state: "ok", result };
          done.push(changes[i]);
        }
      }
      setPhase({ step: "applying", previews, outcomes: [...outcomes] });
    }
    setApplied((a) => [...a, ...done]);
    setPhase({ step: "done", previews, outcomes: outcomes as Outcome[] });
  };

  const undoAll = (outcomes: Outcome[]) => {
    // Reverse order, so later changes are unwound before the ones they built on.
    const undos = changes
      .map((c, i) => ({ c, o: outcomes[i] }))
      .filter((x): x is { c: PendingChange; o: { state: "ok"; result: FixResult } } => x.o.state === "ok" && !!x.o.result.undo)
      .map(({ c, o }) => ({ fix: o.result.undo!, affects: c.affects }))
      .reverse();
    setUndoing(true);
    setChanges(undos);
  };

  const busy = phase.step === "previewing" || phase.step === "applying";
  const close = () => {
    if (busy) return;
    // Keep anything that wasn't applied in the tray so the admin can fix or discard it.
    const remaining =
      phase.step === "done" ? changes.filter((_, i) => phase.outcomes[i].state !== "ok") : undoing ? [] : changes;
    onClose(applied, remaining);
  };
  const remove = (idx: number) => {
    const next = changes.filter((_, i) => i !== idx);
    if (next.length === 0) onClose(applied, []);
    else setChanges(next);
  };

  const previews = phase.step === "previewing" ? [] : phase.previews;
  const outcomes = phase.step === "applying" || phase.step === "done" ? phase.outcomes : [];
  const applicable = previews.filter(ready).length;
  const mobileApplied = applied.filter((c) => isMobileChange(c.fix));

  return (
    <div className="studio-modal-backdrop" onClick={close}>
      <div className="studio-modal studio-review" role="dialog" aria-label="Review changes" onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">
            {phase.step === "done" ? "Results" : "Review changes"} · {org}
          </span>
          <button className="studio-icon-btn" onClick={close} disabled={busy} title="Close">
            ×
          </button>
        </div>
        <h2 className="studio-inspector-title">
          {phase.step === "done"
            ? `${outcomes.filter((o) => o?.state === "ok").length} of ${changes.length} applied`
            : `${changes.length} pending ${changes.length === 1 ? "change" : "changes"}`}
        </h2>

        {phase.step === "previewing" && <div className="studio-empty-note">Checking the org…</div>}

        {phase.step !== "previewing" && (
          <ol className="studio-review-list">
            {changes.map((c, i) => (
              <ChangeCard
                key={i}
                label={c.fix.label}
                preview={previews[i]}
                outcome={outcomes[i] ?? null}
                onRemove={phase.step === "review" ? () => remove(i) : undefined}
              />
            ))}
          </ol>
        )}

        {phase.step === "done" && mobileApplied.length > 0 && (
          <div className="studio-finding info">
            <div className="studio-finding-title">Reps won't see this on the iPad yet</div>
            <div className="studio-finding-detail">
              Publish to iPad regenerates the mobile metadata cache for the affected profiles.
            </div>
          </div>
        )}

        <div className="studio-modal-actions">
          {phase.step === "done" ? (
            <>
              {phase.outcomes.some((o) => o.state === "ok" && !!o.result.undo) && (
                <button className="studio-btn" onClick={() => undoAll(phase.outcomes)}>
                  Undo all…
                </button>
              )}
              {mobileApplied.length > 0 && (
                <button className="studio-btn" onClick={() => onPublish(publishProfiles(mobileApplied))}>
                  Publish to iPad…
                </button>
              )}
              <button className="studio-btn primary" onClick={close}>
                Close & refresh
              </button>
            </>
          ) : (
            <>
              <button className="studio-btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                className="studio-btn primary"
                disabled={busy || applicable === 0}
                onClick={() => phase.step === "review" && applyAll(phase.previews)}
              >
                {phase.step === "applying"
                  ? "Applying…"
                  : `Apply ${applicable === changes.length ? "" : `${applicable} of ${changes.length} `}to ${org}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangeCard({
  label,
  preview,
  outcome,
  onRemove,
}: {
  label: string;
  preview: FixPreview | string | undefined;
  outcome: Outcome | null;
  onRemove?: () => void;
}) {
  return (
    <li className={`studio-review-card${outcome ? ` ${outcome.state}` : ""}`}>
      <div className="studio-review-card-header">
        <span className="studio-finding-title">{label}</span>
        {outcome && <span className={`studio-review-badge ${outcome.state}`}>{BADGES[outcome.state]}</span>}
        {onRemove && (
          <button className="studio-link-btn" onClick={onRemove} title="Remove from this batch">
            Remove
          </button>
        )}
      </div>
      {typeof preview === "string" && <div className="studio-finding-detail error-text">{preview}</div>}
      {typeof preview === "object" && (
        <>
          <ChangeTable preview={preview} />
          {!outcome &&
            preview.warnings.map((w) => (
              <div key={w} className="studio-finding-detail">
                {w}
              </div>
            ))}
          {!outcome && preview.blocked && <div className="studio-finding-detail error-text">Can't apply: {preview.blocked}</div>}
        </>
      )}
      {outcome && outcome.state !== "ok" && <div className="studio-finding-detail error-text">{outcome.message}</div>}
      {outcome?.state === "ok" && <div className="studio-finding-detail">{outcome.result.message}</div>}
    </li>
  );
}

const BADGES = { ok: "Applied", failed: "Failed", skipped: "Skipped" };

function ChangeTable({ preview }: { preview: FixPreview }) {
  return (
    <table className="studio-change-table">
      <thead>
        <tr>
          <th>Record</th>
          <th>Field</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {preview.changes.map((c, i) => (
          <React.Fragment key={i}>
            <tr>
              <td>{c.target}</td>
              <td>{c.field}</td>
              {c.diff ? (
                <>
                  <td className="before">{c.before}</td>
                  <td className="after">{c.after}</td>
                </>
              ) : (
                <ListDiff before={c.before} after={c.after} />
              )}
            </tr>
            {c.diff && c.diff.length > 0 && (
              <tr className="studio-diff-row">
                <td colSpan={4}>
                  <pre className="studio-diff">
                    {c.diff.map((line, j) => (
                      <div key={j} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "remove" : "same"}>
                        {line}
                      </div>
                    ))}
                  </pre>
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

const SEPARATOR = /[;,]/;

/** For "A;B;C" lists, mark only the entries that change instead of the whole value. */
function ListDiff({ before, after }: { before: string; after: string }) {
  if (!SEPARATOR.test(before) && !SEPARATOR.test(after)) {
    return (
      <>
        <td className="before">{before}</td>
        <td className="after">{after}</td>
      </>
    );
  }
  const split = (v: string) => v.split(SEPARATOR).map((x) => x.trim()).filter(Boolean);
  const [b, a] = [split(before), split(after)];
  const entries = (list: string[], other: string[], cls: string) =>
    list.map((x, i) => (
      <div key={i} className={other.includes(x) ? "same" : cls}>
        {x}
      </div>
    ));
  return (
    <>
      <td>{entries(b, a, "before")}</td>
      <td>{entries(a, b, "after")}</td>
    </>
  );
}
