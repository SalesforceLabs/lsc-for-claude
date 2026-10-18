import React, { useState } from "react";
import type { CreateConfigFix, ProfileOption, StudioFix } from "./types";
import CreateDialog from "./CreateDialog";
import {
  changeKey,
  createAffects,
  isQueued,
  isSuggestionQueued,
  pendingFor,
  queueChange,
  stackChange,
  withoutSuggestion,
  type PendingChange,
} from "./changes";

interface FixButtonsProps {
  fixes: StudioFix[];
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  profiles: ProfileOption[];
  /** Object API names offered in a new record's object fields. */
  objects?: string[];
  /** Profiles whose iPads the fixes affect, for "Publish to iPad". */
  affects?: string[];
}

/**
 * Suggested changes as buttons that add them to the pending-changes tray —
 * outside the inspector (readiness checks, user checks, the overview). New
 * records open their prefilled form first; nothing is written from here.
 */
export default function FixButtons({ fixes, pending, onPendingChange, profiles, objects = [], affects }: FixButtonsProps) {
  const [creating, setCreating] = useState<{ draft: CreateConfigFix; replacing?: CreateConfigFix } | null>(null);
  if (fixes.length === 0) return null;

  const toggle = (fix: StudioFix) =>
    onPendingChange(
      isSuggestionQueued(pending, fix)
        ? withoutSuggestion(pending, fix)
        : queueChange(pending, stackChange(pending, { fix, affects }))
    );
  const openCreate = (draft: CreateConfigFix) => {
    const queued = pendingFor(pending, draft)?.fix;
    setCreating(queued?.kind === "createConfigRecord" ? { draft: queued, replacing: queued } : { draft });
  };
  const queueCreate = (fix: CreateConfigFix) => {
    const old = creating?.replacing;
    const rest = old && changeKey(old) !== changeKey(fix) ? pending.filter((p) => changeKey(p.fix) !== changeKey(old)) : pending;
    onPendingChange(queueChange(rest, { fix, affects: createAffects(fix) }));
    setCreating(null);
  };
  const direct = fixes.filter((f) => f.kind !== "createConfigRecord");
  const unqueued = direct.filter((f) => !isSuggestionQueued(pending, f));

  return (
    <div className="studio-fix-row">
      {fixes.map((fix) => {
        if (fix.kind === "createConfigRecord") {
          const queued = isQueued(pending, fix);
          return (
            <button
              key={changeKey(fix)}
              type="button"
              className={`studio-fix-btn${queued ? " queued" : ""}`}
              title={queued ? "In pending changes — click to edit" : "Review and add to pending changes"}
              onClick={() => openCreate(fix)}
            >
              {queued ? `✓ ${fix.label}` : `${fix.label}…`}
            </button>
          );
        }
        const queued = isSuggestionQueued(pending, fix);
        return (
          <button
            key={changeKey(fix)}
            type="button"
            className={`studio-fix-btn${queued ? " queued" : ""}`}
            title={queued ? "In pending changes — click to remove" : "Add to pending changes"}
            onClick={() => toggle(fix)}
          >
            {queued ? `✓ ${fix.label}` : fix.label}
          </button>
        );
      })}
      {direct.length > 1 && unqueued.length > 0 && (
        <button
          type="button"
          className="studio-link-btn"
          onClick={() => onPendingChange(unqueued.reduce((acc, fix) => queueChange(acc, stackChange(acc, { fix, affects })), pending))}
        >
          Add all {unqueued.length}
        </button>
      )}
      {creating && (
        <CreateDialog
          draft={creating.draft}
          objects={objects}
          profiles={profiles}
          onCancel={() => setCreating(null)}
          onQueue={queueCreate}
        />
      )}
    </div>
  );
}
