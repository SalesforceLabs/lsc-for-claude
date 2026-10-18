import React, { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { FixPreview, FixResult } from "./types";
import { isMobileChange, publishProfiles, type PendingChange } from "./changes";
import { touchesDbSchema } from "./sync-impact-util";
import StateView from "../ui/StateView";
import Spinner from "../ui/Spinner";
import "./sync-impact.css";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
          <button className="ui-icon-btn" onClick={close} disabled={busy} title="Close" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>
        <h2 className="studio-inspector-title">
          {phase.step === "done"
            ? `${outcomes.filter((o) => o?.state === "ok").length} of ${changes.length} applied`
            : `${changes.length} pending ${changes.length === 1 ? "change" : "changes"}`}
        </h2>

        {phase.step === "previewing" && <StateView kind="loading" title="Checking the org…" layout="inline" className="studio-modal-state" />}

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

        {phase.step === "review" && changes.some((c) => touchesDbSchema(c.fix as unknown as Record<string, unknown>)) && (
          <SyncImpact
            key={JSON.stringify(changes.map((c) => c.fix))}
            changes={changes.filter((c, i) => ready(phase.previews[i]))}
            excluded={changes.filter((c, i) => !ready(phase.previews[i]) && touchesDbSchema(c.fix as unknown as Record<string, unknown>)).map((c) => c.fix.label)}
          />
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

interface ImpactTable {
  sobject: string;
  before: number | null;
  after: number | null;
  delta: number;
  note?: string;
}
interface ProfileImpact {
  profile: string;
  user: { username: string; name: string };
  territory: string | null;
  territoryNote?: string;
  totalBefore: number;
  totalAfter: number;
  pct: number | null;
  tables: ImpactTable[];
  failing: { sobject: string; developerName: string; message: string }[];
  error?: string;
}
interface ImpactResult {
  profiles: ProfileImpact[];
  unmodeled: { label: string; reason: string }[];
  notes: string[];
  queries: number;
}

/** Large increases in a rep's sync volume are worth a second look. */
const WARN_INCREASE_PCT = 25;

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
const fmtPct = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(Math.round(p))}%`;

/** Predicted records per affected profile, before and after the pending DB Schema changes. Runs only on request. */
function SyncImpact({ changes, excluded }: { changes: PendingChange[]; excluded: string[] }) {
  const [state, setState] = useState<{ step: "idle" } | { step: "running" } | { step: "done"; result: ImpactResult } | { step: "error"; message: string }>({ step: "idle" });
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    setState({ step: "running" });
    const res = await window.lscApi.studioSyncImpact(changes.map((c) => c.fix));
    const error = responseError(res);
    if (error || !res.data) setState({ step: "error", message: error || "No result" });
    else setState({ step: "done", result: res.data as ImpactResult });
  };

  return (
    <div className="studio-sync-impact">
      <div className="studio-sync-impact-header">
        <span className="studio-finding-title">Sync impact</span>
        {state.step === "running" && <Spinner size={14} />}
        <button className="studio-btn" onClick={run} disabled={state.step === "running"}>
          {state.step === "done" ? "Re-estimate" : "Estimate sync impact"}
        </button>
      </div>
      {state.step === "idle" && (
        <div className="studio-sync-impact-note">Predicts records per affected profile before and after. Runs read-only COUNT() queries.</div>
      )}
      {state.step === "error" && <div className="studio-sync-impact-error">{state.message}</div>}
      {state.step === "done" && (
        <>
          {state.result.profiles.map((p) => (
            <div key={p.profile} className="studio-sync-impact-profile">
              {p.error ? (
                <div className="studio-sync-impact-error">
                  {p.profile}: {p.error}
                </div>
              ) : (
                <>
                  <div className="studio-sync-impact-line">
                    <strong>{p.profile}</strong>
                    <span className="studio-empty-note">
                      (via {p.user.username}
                      {p.territory ? `, ${p.territory}` : ""}
                      {p.territoryNote ? `: ${p.territoryNote}` : ""})
                    </span>
                    <span>
                      {fmt(p.totalBefore)} <ArrowRight size={12} aria-hidden className="studio-sync-impact-arrow" /> {fmt(p.totalAfter)} records
                    </span>
                    {p.pct !== null && p.pct !== 0 && (
                      <span className={`studio-sync-impact-pct ${p.pct > WARN_INCREASE_PCT ? "warn" : p.pct < 0 ? "good" : ""}`}>
                        ({fmtPct(p.pct)}){p.pct > WARN_INCREASE_PCT ? " large increase" : ""}
                      </span>
                    )}
                    {p.tables.length > 0 && (
                      <button className="studio-link-btn" onClick={() => setOpen(open === p.profile ? null : p.profile)}>
                        {open === p.profile ? "Hide tables" : `${p.tables.length} ${p.tables.length === 1 ? "table" : "tables"}`}
                      </button>
                    )}
                  </div>
                  {p.failing.map((f) => (
                    <div key={f.developerName} className="studio-sync-impact-error">
                      This filter doesn't run: {f.sobject} ({f.developerName}) — {f.message}
                    </div>
                  ))}
                  {open === p.profile && (
                    <table className="studio-sync-impact-tables">
                      <thead>
                        <tr>
                          <th>Table</th>
                          <th>Before</th>
                          <th>After</th>
                          <th>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.tables.map((t) => (
                          <tr key={t.sobject} title={t.note}>
                            <td>{t.sobject}</td>
                            <td>{fmt(t.before)}</td>
                            <td>{fmt(t.after)}</td>
                            <td>{t.delta > 0 ? "+" : t.delta < 0 ? "−" : ""}{Math.abs(t.delta).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          ))}
          {excluded.length > 0 && (
            <div className="studio-sync-impact-note">Left out because they can't be applied: {excluded.join(", ")}.</div>
          )}
          {state.result.unmodeled.map((u, i) => (
            <div key={i} className="studio-sync-impact-note">
              Not estimated: {u.label} — {u.reason}
            </div>
          ))}
          {state.result.notes.map((n, i) => (
            <div key={i} className="studio-sync-impact-note">
              {n}
            </div>
          ))}
          <div className="studio-sync-impact-note">{state.result.queries} org queries.</div>
        </>
      )}
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
