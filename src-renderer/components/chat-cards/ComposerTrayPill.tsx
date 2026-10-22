import React from "react";
import { ListChecks } from "lucide-react";
import { useStudioTray } from "../../hooks/useStudioTray";
import { trayKey } from "../studio/tray-state";
import type { StudioRequest } from "../../studio-request";
import { trayPillLabel } from "./card-logic";
import "./chat-cards.css";

/**
 * "3 changes waiting in Studio · Review", beside the org in the composer. Review opens the selected org's
 * tray, so the pill shows only when the session works in the selected org (and its tray isn't empty).
 */
export default function ComposerTrayPill({ org, onOpenStudio }: { org: string; onOpenStudio?: (request?: StudioRequest) => void }) {
  const tray = useStudioTray();
  if (!onOpenStudio || trayKey(org) !== tray.org) return null;
  const count = tray.pending.length;
  if (count === 0) return null;
  return (
    <button type="button" className="composer-tray" onClick={() => onOpenStudio({ kind: "review" })} title="Open the review in Studio">
      <ListChecks size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="composer-tray-text">{trayPillLabel(count)}</span>
      <span className="composer-tray-action">Review</span>
    </button>
  );
}
