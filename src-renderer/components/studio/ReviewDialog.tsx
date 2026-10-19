import React, { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Monitor, RefreshCw, Tablet, X, Zap, type LucideIcon } from "lucide-react";
import type { FixChange, FixPreview, FixResult, StudioFix } from "./types";
import { publishProfiles, type PendingChange } from "./changes";
import SourceWarning, { OrgOnlyPill } from "./SourceWarning";
import { isPublishWarning, reachFor, whatHappensNext, type NextKind, type NextLine } from "./what-next";
import { touchesDbSchema } from "./sync-impact-util";
import ReviewProgress from "./ReviewProgress";
import { pageReach } from "./BlockInspector";
import Spinner from "../ui/Spinner";
import StatusIcon from "../ui/StatusIcon";
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
  /**
   * Changes just written to the org, as soon as they are — they must leave the tray now, not when the dialog closes.
   * `undos` take them back (newest first); `wasUndo` is set when this batch was itself an undo.
   */
  onApplied?: (done: PendingChange[], undos: PendingChange[], wasUndo: boolean) => void;
  /** `changes` are the undo of an earlier apply: cancelling leaves nothing in the tray. */
  undo?: boolean;
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
/** The dialog's heading: the batch before applying, the tally after. An undo is named as one. */
export function reviewTitle(done: boolean, total: number, ok: number, undo: boolean): string {
  if (done) return `${ok} of ${total} ${undo ? "undone" : "applied"}`;
  if (undo) return total === 1 ? "Undo last apply" : `Undo ${total} changes`;
  return `${total} pending ${total === 1 ? "change" : "changes"}`;
}

export default function ReviewDialog({ changes: initial, org, onClose, onPublish, onApplied, undo = false }: ReviewDialogProps) {
  const [changes, setChanges] = useState(initial);
  const [phase, setPhase] = useState<Phase>({ step: "previewing" });
  // Everything applied across this dialog's lifetime (including undos), for the refresh + publish.
  const [applied, setApplied] = useState<PendingChange[]>([]);
  // Reviewing an Undo batch — cancelling it leaves nothing pending (the originals are already applied).
  const [undoing, setUndoing] = useState(undo);
  const [productionOk, setProductionOk] = useState(false);
  // Names this run of previews or applies, so ReviewProgress can ask the server which step each is on.
  const [batch, setBatch] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    setPhase({ step: "previewing" });
    // Each batch (an Undo too) asks again before writing to production.
    setProductionOk(false);
    const id = crypto.randomUUID();
    setBatch(id);
    Promise.all(
      changes.map((c, i) =>
        window.lscApi.studioPreviewFix(c.fix, { id, index: i, total: changes.length }).then((res) => responseError(res) ?? (res.data as FixPreview))
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
    const id = crypto.randomUUID();
    setBatch(id);
    setPhase({ step: "applying", previews, outcomes: [...outcomes] });
    const done: PendingChange[] = [];
    const undos: PendingChange[] = [];
    for (let i = 0; i < changes.length; i++) {
      const p = previews[i];
      if (!ready(p)) {
        outcomes[i] = { state: "skipped", message: typeof p === "string" ? p : (p as FixPreview).blocked! };
      } else {
        const res = await window.lscApi.studioApplyFix(changes[i].fix, org, { id, index: i, total: changes.length });
        const error = responseError(res);
        const result = res.data as FixResult | undefined;
        if (error || !result?.ok) outcomes[i] = { state: "failed", message: error || result?.message || "Failed" };
        else {
          outcomes[i] = { state: "ok", result };
          done.push(changes[i]);
          if (result.undo) undos.unshift({ fix: result.undo, affects: changes[i].affects });
        }
      }
      setPhase({ step: "applying", previews, outcomes: [...outcomes] });
    }
    setApplied((a) => [...a, ...done]);
    if (done.length > 0) onApplied?.(done, undos, undoing);
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
  // Metadata deploys to a production org take an extra, explicit confirmation.
  const production = previews.some((p) => ready(p) && !!p.production);
  // The footer and the post-apply banner read the same reach, so they never disagree.
  const reachOf = (c: PendingChange) => {
    const i = changes.indexOf(c);
    return reachFor(c, i >= 0 && ready(previews[i]) ? previews[i] : undefined);
  };
  const next = whatHappensNext(changes.filter((_, i) => ready(previews[i])).map(reachOf));
  // This batch only: after an Undo all, the original and its undo aren't two changes reps will get.
  const nextApplied = whatHappensNext(changes.filter((_, i) => outcomes[i]?.state === "ok").map(reachOf), { done: true });
  const mobileApplied = applied.filter((c) => reachOf(c).ipad === "publish");

  return (
    <div className="studio-modal-backdrop" onClick={close}>
      <div className="studio-modal studio-review" role="dialog" aria-label="Review changes" onClick={(e) => e.stopPropagation()}>
        <div className="studio-review-head">
          <div className="studio-modal-header">
            <span className="studio-inspector-eyebrow">
              {phase.step === "done" ? "Results" : undoing ? "Review undo" : "Review changes"} · {org}
            </span>
            <button className="ui-icon-btn" onClick={close} disabled={busy} title="Close" aria-label="Close">
              <X size={16} aria-hidden />
            </button>
          </div>
          <h2 className="studio-inspector-title">
            {reviewTitle(phase.step === "done", changes.length, outcomes.filter((o) => o?.state === "ok").length, undoing)}
          </h2>
          {phase.step === "review" && applicable < changes.length && (
            <div className="studio-review-summary">
              {applicable} can be applied · {changes.length - applicable} can't
              {!undoing && <> — {changes.length - applicable === 1 ? "it stays" : "they stay"} in the tray</>}
            </div>
          )}
        </div>

        <div className="studio-review-body">

        {phase.step === "previewing" && <ReviewProgress key={batch} id={batch} phase="preview" labels={changes.map((c) => c.fix.label)} />}
        {phase.step === "applying" && (
          <ReviewProgress key={batch} id={batch} phase="apply" labels={changes.map((c) => c.fix.label)} finished={outcomes.map((o) => !!o)} />
        )}

        {phase.step !== "previewing" && (
          <ol className="studio-review-list">
            {changes.map((c, i) => (
              <ChangeCard
                key={i}
                label={c.fix.label}
                fix={c.fix}
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

        {phase.step === "done" && nextApplied.length > 0 && <WhatNext title="Applied to the org" lines={nextApplied} />}

        </div>

        <div className="studio-review-foot">
        {phase.step === "review" && next.length > 0 && <WhatNext title="What happens next" lines={next} />}
        {phase.step === "review" && <SourceWarning changes={changes.map((c) => c.fix)} />}
        {phase.step === "review" && production && (
          <div className="studio-review-production">
            <StatusIcon tone="warning" size={20} />
            <div className="studio-review-production-text">
              <div className="studio-finding-title">This is a production org</div>
              <div className="studio-finding-detail">Applying writes to the org at once; real users get each change as listed above.</div>
            </div>
            <label className="ui-check">
              <input type="checkbox" checked={productionOk} onChange={(e) => setProductionOk(e.target.checked)} />
              I want to change production
            </label>
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
                disabled={busy || applicable === 0 || (production && !productionOk)}
                onClick={() => phase.step === "review" && applyAll(phase.previews)}
              >
                {phase.step === "applying"
                  ? "Applying…"
                  : phase.step === "previewing"
                    ? "Apply"
                    : `Apply ${applicable} ${applicable === 1 ? "change" : "changes"}${production ? " to production" : ""}`}
              </button>
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

const NEXT_ICONS: Record<NextKind, LucideIcon> = { desktop: Monitor, publish: Tablet, live: Zap, nextSync: RefreshCw };

/** When each kind of user gets the changes: the review footer, and in past tense the banner after applying. */
function WhatNext({ title, lines }: { title: string; lines: NextLine[] }) {
  return (
    <section className="studio-review-next" aria-label={title}>
      <h3 className="ui-section-title">{title}</h3>
      <ul>
        {lines.map((l) => {
          const Icon = NEXT_ICONS[l.kind];
          return (
            <li key={l.kind}>
              <Icon size={16} aria-hidden />
              <span>{l.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
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
  fix,
  preview,
  outcome,
  onRemove,
}: {
  label: string;
  fix: StudioFix;
  preview: FixPreview | string | undefined;
  outcome: Outcome | null;
  onRemove?: () => void;
}) {
  const problem = outcome
    ? null
    : typeof preview === "string"
      ? preview
      : preview?.blocked ?? null;
  const changes = typeof preview === "object" ? preview.changes : [];
  const targets = [...new Set(changes.map((c) => c.target))];
  // With one record the table drops its Record column, so name it here unless the title already does.
  const subtitle = targets.length === 1 && !label.includes(targets[0]) ? targets[0] : null;
  return (
    <li className={`studio-review-card${outcome ? ` ${outcome.state}` : ""}${problem ? " blocked" : ""}`}>
      <div className="studio-review-card-header">
        <span className="studio-finding-title" title={label}>
          {label}
        </span>
        <OrgOnlyPill fix={fix} />
        {outcome && <span className={`studio-review-badge ${outcome.state}`}>{BADGES[outcome.state]}</span>}
        {problem && <span className="ui-pill error">Can't apply</span>}
        {onRemove && (
          <button className="studio-link-btn" onClick={onRemove} title="Remove from this batch">
            Remove
          </button>
        )}
      </div>
      {subtitle && (
        <div className="studio-review-target" title={subtitle}>
          {subtitle}
        </div>
      )}
      {problem && (
        <div className="studio-review-problem">
          <StatusIcon tone="error" size={16} />
          <span>{problem}</span>
        </div>
      )}
      {changes.length > 0 && <ChangeTable changes={changes} />}
      {changes.some((c) => c.diff?.length) && <DiffDisclosure changes={changes} />}
      {!outcome &&
        typeof preview === "object" &&
        preview.warnings.map((w, i) =>
          // "Publish afterwards" is said once for every change, in the footer's What happens next.
          isPublishWarning(w) ? null : i === 0 && preview.reachPage ? (
            // The first warning is the page's reach; when the server didn't work it out, it can be looked up here.
            <PageReachCheck key={w} fullName={preview.reachPage} warning={w} />
          ) : (
            <div key={w} className="studio-review-warning">
              <StatusIcon tone="warning" size={16} />
              <span>{w}</span>
            </div>
          )
        )}
      {outcome && outcome.state !== "ok" && <div className="studio-finding-detail error-text">{outcome.message}</div>}
      {outcome?.state === "ok" && <div className="studio-finding-detail">{outcome.result.message}</div>}
    </li>
  );
}

const BADGES = { ok: "Applied", failed: "Failed", skipped: "Skipped" };

/** Who a Lightning page change reaches, read only when asked: it means reading every app in the org. */
function PageReachCheck({ fullName, warning }: { fullName: string; warning: string }) {
  const [state, setState] = useState<{ step: "idle" } | { step: "running" } | { step: "done"; text: string } | { step: "error"; message: string }>({ step: "idle" });
  const run = async () => {
    setState({ step: "running" });
    try {
      const res = await window.lscApi.studioPageReach(fullName);
      const error = responseError(res);
      const reach = res.data as { profiles: string[] | null; appDefaults: string[] | null } | undefined;
      if (error) setState({ step: "error", message: error });
      else if (!reach?.profiles || !reach.appDefaults) setState({ step: "error", message: "Couldn't read the org's apps. Check the page's activations in Lightning App Builder." });
      else setState({ step: "done", text: pageReach(reach.profiles, reach.appDefaults) });
    } catch (e) {
      setState({ step: "error", message: String(e) });
    }
  };
  return (
    <>
      <div className="studio-review-warning">
        <StatusIcon tone="warning" size={16} />
        <span>{state.step === "done" ? state.text : warning}</span>
      </div>
      {state.step !== "done" && (
        <div className="studio-review-reach">
          <button className="studio-btn" onClick={run} disabled={state.step === "running"}>
            {state.step === "running" && <Spinner size={12} />}
            {state.step === "running" ? "Reading every app…" : state.step === "error" ? "Try again" : "Find who sees this page"}
          </button>
          <span className={state.step === "error" ? "error-text" : undefined}>
            {state.step === "error" ? state.message : "Reads every app in the org. This can take a minute in big orgs."}
          </span>
        </div>
      )}
    </>
  );
}

function ChangeTable({ changes }: { changes: FixChange[] }) {
  // A layout or page edit names the same document on every row; say it once, in the card's title.
  const showRecord = new Set(changes.map((c) => c.target)).size > 1;
  return (
    <table className={`studio-change-table${showRecord ? " with-record" : ""}`}>
      <colgroup>
        {showRecord && <col className="record" />}
        <col className="field" />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          {showRecord && <th>Record</th>}
          <th>Change</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c, i) => (
          <tr key={i}>
            {showRecord && <td>{c.target}</td>}
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
        ))}
      </tbody>
    </table>
  );
}

const DIFF_OPEN_LINES = 12;

/** The line diffs behind a card's rows (XML or script code), folded away unless short. */
function DiffDisclosure({ changes }: { changes: FixChange[] }) {
  const lines = changes.flatMap((c) => c.diff ?? []);
  const xml = lines.some((l) => /^[-+ ] *</.test(l));
  const [open, setOpen] = useState(lines.length <= DIFF_OPEN_LINES);
  const changed = lines.filter((l) => l.startsWith("+ ") || l.startsWith("- ")).length;
  return (
    <div className="studio-review-diff">
      <button className="studio-review-diff-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} aria-hidden className={open ? "open" : undefined} />
        {open ? "Hide" : "Show"} {xml ? "XML" : "code"} changes
        <span className="count">
          {changed} {changed === 1 ? "line" : "lines"}
        </span>
      </button>
      {open && (
        <pre className="studio-diff">
          {lines.map((line, j) => (
            <div key={j} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "remove" : "same"}>
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
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
