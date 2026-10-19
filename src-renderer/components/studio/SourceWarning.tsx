import React from "react";
import StatusIcon from "../ui/StatusIcon";
import { useSourceControl } from "../../hooks/useSourceControl";
import { orgOnlyLabel, sourceChanges, SOURCE_WARNING } from "./source-control";
import type { StudioFix } from "./types";
import "./source-control.css";

/**
 * For the review dialog: on an org deployed from source control, reminds the user to save
 * the changes as source files after applying. Draws nothing otherwise, or when every change
 * lives only in the org.
 */
export default function SourceWarning({ changes }: { changes: StudioFix[] }) {
  const { deployed } = useSourceControl();
  if (!deployed || sourceChanges(changes).length === 0) return null;
  const orgOnly = changes.length - sourceChanges(changes).length;
  return (
    <div className="source-warning" role="note">
      <StatusIcon tone="info" size={18} />
      <div className="source-warning-text">
        {SOURCE_WARNING}
        {orgOnly > 0 && (
          <span className="source-warning-sub">
            {orgOnly === 1 ? "1 change is" : `${orgOnly} changes are`} org only and won't be in source files.
          </span>
        )}
      </div>
    </div>
  );
}

/** "Org only" beside a change that has no source file, with why on hover. Only on orgs deployed from source control. */
export function OrgOnlyPill({ fix }: { fix: StudioFix }) {
  const { deployed } = useSourceControl();
  const label = orgOnlyLabel(fix);
  if (!deployed || !label) return null;
  return (
    <span className="ui-pill" title={label.title}>
      {label.label}
    </span>
  );
}
