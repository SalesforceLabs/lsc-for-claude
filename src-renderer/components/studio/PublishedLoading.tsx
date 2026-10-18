import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import Spinner from "../ui/Spinner";
import "./published-loading.css";

// Renderer copy of LoadProgress in src/studio/published-progress.ts.
interface LoadStep {
  key: string;
  label: string;
  state: "waiting" | "running" | "done" | "failed";
  detail?: string;
}
interface LoadProgress {
  profile: string;
  startedAt: number;
  finishedAt?: number;
  steps: LoadStep[];
}

const POLL_MS = 500;

/** While the published iPad loads: which step it's on, how far along, and how long it's taken. */
export default function PublishedLoading({ profile }: { profile: string }) {
  const openedAt = useRef(Date.now());
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const poll = async () => {
      const res = await window.lscApi.studioIpadPublishedProgress(profile).catch(() => null);
      const p = (res?.data as { progress?: LoadProgress | null } | undefined)?.progress ?? null;
      // A finished entry from an earlier load isn't this one.
      if (live && p && p.startedAt >= openedAt.current - 2000) setProgress(p);
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
  }, [profile]);

  const steps = progress?.steps ?? [];
  const done = steps.filter((s) => s.state === "done" || s.state === "failed").length;
  const fraction = steps.length ? done / steps.length : 0;
  const seconds = Math.max(0, Math.round((now - (progress?.startedAt ?? openedAt.current)) / 1000));
  return (
    <div className="studio-ipad-wrap studio-ipad-loading" role="status" aria-live="polite">
      <div className="studio-ipad-loading-head">
        <Spinner size={16} />
        <span>Reading {profile}'s published iPad configuration…</span>
        <span className="studio-ipad-loading-time">{seconds}s</span>
      </div>
      <div className="studio-ipad-loading-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(4, fraction * 100)}%` }} />
      </div>
      {steps.length > 0 && (
        <ol className="studio-ipad-loading-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.state}>
              <StepMark state={s.state} />
              {s.label}
              {s.detail && <span className="studio-ipad-loading-detail"> · {s.detail}</span>}
            </li>
          ))}
        </ol>
      )}
      {steps.some((s) => s.key === "download") && (
        <div className="studio-ipad-loading-note">The first load of a published cache downloads it; later loads reuse it and are faster.</div>
      )}
    </div>
  );
}

function StepMark({ state }: { state: LoadStep["state"] }) {
  if (state === "running")
    return (
      <span className="studio-ipad-loading-mark" aria-label="Running">
        <Spinner size={12} />
      </span>
    );
  if (state === "done")
    return (
      <span className="studio-ipad-loading-mark" aria-label="Done">
        <Check size={13} strokeWidth={2.75} aria-hidden="true" />
      </span>
    );
  if (state === "failed")
    return (
      <span className="studio-ipad-loading-mark" aria-label="Failed">
        <X size={13} strokeWidth={2.75} aria-hidden="true" />
      </span>
    );
  return <span className="studio-ipad-loading-mark" aria-label="Waiting" />;
}
