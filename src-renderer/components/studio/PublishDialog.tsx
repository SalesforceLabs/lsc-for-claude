import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ProfileOption } from "./types";
import type { PublishJob } from "./usePublishJob";

interface PublishDialogProps {
  org: string;
  profiles: ProfileOption[];
  /** Profiles to preselect (the ones recent changes affect); null = let the admin choose. */
  preselected: string[] | null;
  onClose: () => void;
  /** Studio's publish job: it keeps polling after this dialog closes, and the release bar shows its progress. */
  job: PublishJob;
}

/**
 * "Publish to iPad" — regenerate the mobile metadata cache for chosen profiles
 * so reps' devices pick up configuration changes on their next sync. The job
 * belongs to Studio (`usePublishJob`), so closing this dialog doesn't stop it.
 */
export default function PublishDialog({ org, profiles, preselected, onClose, job }: PublishDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set((preselected ?? []).map((p) => p.toLowerCase())));
  const [filter, setFilter] = useState("");
  const { status, error, starting } = job;
  // Opening the dialog starts a new publish unless one is still running; a finished one is forgotten.
  useEffect(() => {
    job.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only profiles with users matter for the iPad; keep preselected ones even if they have none.
  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return profiles
      .filter((p) => p.users > 0 || selected.has(p.name.toLowerCase()))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(selected.has(b.name.toLowerCase())) - Number(selected.has(a.name.toLowerCase())) || a.name.localeCompare(b.name));
  }, [profiles, filter, selected]);

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      const key = name.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const start = () => job.start(profiles.filter((p) => selected.has(p.name.toLowerCase())).map((p) => p.name), org);

  const count = selected.size;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !starting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="studio-modal-backdrop" onClick={() => !starting && onClose()}>
      <div className="studio-modal" role="dialog" aria-label="Publish to iPad" onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">Publish to iPad · {org}</span>
          <button className="ui-icon-btn" onClick={onClose} disabled={starting} title="Close" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>
        <h2 className="studio-inspector-title">Regenerate the mobile metadata cache</h2>

        {!status && (
          <>
            <p className="studio-inspector-desc">
              Reps on these profiles get the current configuration on their next sync. Generation takes a few minutes.
            </p>
            <input
              className="studio-filter"
              aria-label="Filter profiles"
              placeholder="Filter profiles…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul className="studio-picker-list">
              {options.map((p) => (
                <li key={p.name}>
                  <label className="studio-picker-row">
                    <input type="checkbox" checked={selected.has(p.name.toLowerCase())} onChange={() => toggle(p.name)} />
                    <span className="studio-picker-name">{p.name}</span>
                    <span className="studio-picker-meta">{p.users ? `${p.users} ${p.users === 1 ? "user" : "users"}` : "no active users"}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {status && (
          <div className={`studio-finding ${status.state === "failed" ? "error" : status.state === "done" ? "success" : "info"}`}>
            <div className="studio-finding-title">
              {status.state === "running" && "Generating…"}
              {status.state === "done" && "Published"}
              {status.state === "failed" && "Publish failed"}
            </div>
            <div className="studio-finding-detail">
              {status.state === "running" && `Status: ${status.status}. You can close this — generation continues in Salesforce, and the bar at the bottom shows when it's done.`}
              {status.state === "done" && `Reps on ${status.profiles.join(", ")} get the changes on their next sync.`}
              {status.state === "failed" && status.error}
            </div>
          </div>
        )}
        {error && (
          <div className="studio-finding error">
            <div className="studio-finding-title">Couldn't publish</div>
            <div className="studio-finding-detail">{error}</div>
          </div>
        )}

        <div className="studio-modal-actions">
          <button className="studio-btn" onClick={onClose} disabled={starting}>
            {status ? "Close" : "Cancel"}
          </button>
          {!status && (
            <button className="studio-btn primary" disabled={starting || count === 0} onClick={start}>
              {starting ? "Starting…" : `Publish ${count} ${count === 1 ? "profile" : "profiles"} on ${org}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
