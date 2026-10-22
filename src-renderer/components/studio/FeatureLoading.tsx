import React, { useEffect, useRef, useState } from "react";
import Spinner from "../ui/Spinner";
import "./published-loading.css";
import "./feature-loading.css";
import { StepMark, stepTime } from "./PublishedLoading";
import { loadFraction } from "./published-loading-logic";
import { slowNote, type MapProgress } from "./feature-loading-logic";

const POLL_MS = 500;

interface FeatureLoadingProps {
  featureId: string;
  title: string;
  /** "map" is the configuration board's load; "readiness" the readiness checks'. */
  kind: "map" | "readiness";
}

/** While a feature's configuration (or readiness) loads: which surfaces are read, how many were found, and how long each took. */
export default function FeatureLoading({ featureId, title, kind }: FeatureLoadingProps) {
  const openedAt = useRef(Date.now());
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const poll = async () => {
      const res = await window.lscApi.studioFeatureMapProgress(featureId, kind === "readiness").catch(() => null);
      const p = (res?.data as { progress?: MapProgress | null } | undefined)?.progress ?? null;
      // A finished entry from an earlier load isn't this one.
      if (live && p && !p.finishedAt && p.startedAt >= openedAt.current - 2000) setProgress(p);
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
  }, [featureId, kind]);

  const steps = progress?.steps ?? [];
  const startedAt = progress?.startedAt ?? openedAt.current;
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const note = slowNote(steps, now, startedAt);
  const heading = kind === "map" ? `Mapping ${title} configuration…` : `Checking ${title}…`;
  return (
    <div className="studio-feature-loading">
      <div className="studio-ipad-wrap studio-ipad-loading" role="status" aria-live="polite">
        <div className="studio-ipad-loading-head">
          <Spinner size={16} />
          <span>{heading}</span>
          <span className="studio-ipad-loading-time">{seconds}s</span>
        </div>
        <div className="studio-ipad-loading-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(4, loadFraction(steps) * 100)}%` }} />
        </div>
        {steps.length > 0 ? (
          <ol className="studio-ipad-loading-steps">
            {steps.map((s) => (
              <li key={s.key} className={s.state}>
                <StepMark state={s.state} />
                <span className="studio-feature-loading-label">
                  {s.label}
                  {s.detail && <span className="studio-ipad-loading-detail"> · {s.detail}</span>}
                </span>
                {s.startedAt && <span className="studio-feature-loading-time">{stepTime(s, now)}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <div className="studio-ipad-loading-detail">
            {kind === "map"
              ? "Reading objects, scripts, rules, triggers, mobile sync, actions, and settings from your org."
              : "Running its readiness checks against your org. Every query is read-only."}
          </div>
        )}
        {note && <div className="studio-ipad-loading-note">{note}</div>}
      </div>
    </div>
  );
}
