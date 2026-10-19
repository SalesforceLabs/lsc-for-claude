import React, { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import Spinner from "../ui/Spinner";
import "./review-progress.css";
import {
  acceptProgress,
  barPercent,
  batchSummary,
  changeViews,
  hasSteps,
  headline,
  overallFraction,
  stepTime,
  type FixProgress,
  type StepState,
} from "./review-progress-logic";

const POLL_MS = 400;

interface Props {
  /** The id given to studioPreviewFix / studioApplyFix for this batch. */
  id: string;
  phase: "preview" | "apply";
  /** One label per change, in order. */
  labels: string[];
  /** Changes whose result the dialog already has (the apply loop). */
  finished?: boolean[];
}

/** While the review dialog checks or applies changes: what it's doing now, each change's steps and a bar. */
export default function ReviewProgress({ id, phase, labels, finished }: Props) {
  const [progress, setProgress] = useState<FixProgress | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const poll = async () => {
      const res = await window.lscApi.studioFixProgress(id).catch(() => null);
      const next = (res?.data as { progress?: FixProgress | null } | undefined)?.progress;
      if (live) setProgress((cur) => acceptProgress(cur, next, id));
    };
    poll();
    const timer = setInterval(() => {
      setNow(Date.now());
      poll();
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);

  const views = changeViews(labels, progress, finished);
  const title = headline(views, phase);
  const summary = batchSummary(views, phase);
  const showSteps = hasSteps(views);
  return (
    <div className="studio-review-progress" role="status" aria-live="polite">
      <div className="studio-review-progress-head">
        <Spinner size={16} />
        <span>{title}</span>
      </div>
      {showSteps && (
        <>
          <div className="studio-review-progress-bar" aria-hidden="true">
            <span style={{ width: `${barPercent(overallFraction(views))}%` }} />
          </div>
          {summary && <div className="studio-review-progress-summary">{summary}</div>}
          <ol className="studio-review-progress-changes">
            {views.map((v) => (
              <li key={v.index} className={v.state}>
                {views.length > 1 && (
                  <div className="studio-review-progress-change">
                    <Mark state={v.state} />
                    <span>{v.label}</span>
                  </div>
                )}
                {v.steps.length > 0 && v.state !== "done" && (
                  <ol className="studio-review-progress-steps">
                    {v.steps.map((s) => (
                      <li key={s.key} className={s.state}>
                        <Mark state={s.state} />
                        <span className="studio-review-progress-text">
                          {s.label}
                          {s.detail && <span className="studio-review-progress-detail"> · {s.detail}</span>}
                          {s.startedAt && <span className="studio-review-progress-detail"> · {stepTime(s, now)}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Mark({ state }: { state: StepState }) {
  if (state === "running")
    return (
      <span className="studio-review-progress-mark" aria-label="Running">
        <Spinner size={12} />
      </span>
    );
  if (state === "done")
    return (
      <span className="studio-review-progress-mark" aria-label="Done">
        <Check size={13} strokeWidth={2.75} aria-hidden="true" />
      </span>
    );
  if (state === "failed")
    return (
      <span className="studio-review-progress-mark" aria-label="Failed">
        <X size={13} strokeWidth={2.75} aria-hidden="true" />
      </span>
    );
  return <span className="studio-review-progress-mark" aria-label="Waiting" />;
}
