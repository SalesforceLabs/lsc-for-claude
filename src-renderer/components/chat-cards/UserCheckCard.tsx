import React, { useEffect, useMemo, useState } from "react";
import { UserRoundSearch, ExternalLink, UserRound } from "lucide-react";
import StatusIcon from "../ui/StatusIcon";
import { CheckRow } from "../studio/ReadinessView";
import { STAGES } from "../studio/readiness";
import { firstProblem, traceHeadline } from "../studio/user-trace-state";
import type { PendingChange } from "../studio/changes";
import type { ProfileOption } from "../studio/types";
import { useStudioTray } from "../../hooks/useStudioTray";
import { trayKey } from "../studio/tray-state";
import { useChatCards } from "./ChatCardsContext";
import { pickUserMessage, withoutCreateFixes, type UserCheckTrace, type UserMatch } from "./card-logic";
import "../studio/readiness.css";
import "./chat-cards.css";

/**
 * The tray the fix buttons read and write: the session's org's, whether or not it is the selected one.
 * `selected` says whether it is, since profile lists (for new records) come from the selected org's server.
 */
function useSessionTray(sessionOrg: string): { pending: PendingChange[]; onPendingChange: (next: PendingChange[]) => void; selected: boolean } {
  const tray = useStudioTray();
  const key = trayKey(sessionOrg);
  if (!key || key === tray.org) return { pending: tray.pending, onPendingChange: tray.setPending, selected: true };
  return { pending: tray.pendingFor(key), onPendingChange: (next) => tray.setPendingFor(key, next), selected: false };
}

/** One rep's chain of checks from `check_user_access`: the first broken link is open, with fixes that queue into the tray. */
export function UserCheckCard({ trace }: { trace: UserCheckTrace }) {
  const { org, onOpenStudio } = useChatCards();
  const { pending, onPendingChange, selected } = useSessionTray(org?.ref.username ?? "");
  // New records need the org's profile list, which only the selected org's server gives: elsewhere they're left out.
  const checks = useMemo(() => (selected ? trace.checks : withoutCreateFixes(trace.checks)), [trace.checks, selected]);
  const createsHidden = checks !== trace.checks;
  const [open, setOpen] = useState<string | null>(() => firstProblem(trace.checks)?.id ?? null);
  const headline = useMemo(() => traceHeadline(trace), [trace]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const needsProfiles = checks.some((c) => c.fixes?.some((f) => f.kind === "createConfigRecord"));
  useEffect(() => {
    if (!needsProfiles) return;
    let stale = false;
    window.lscApi.studioListProfiles().then((res) => {
      if (!stale && Array.isArray(res.data)) setProfiles(res.data as ProfileOption[]);
    });
    return () => {
      stale = true;
    };
  }, [needsProfiles]);
  const stageTitle = (id: string) => STAGES.find((s) => s.id === id)?.title ?? id;

  return (
    <section className="chat-card" aria-label={`Access check for ${trace.userName}`}>
      <header className="chat-card-head">
        <StatusIcon tone={headline.tone} size={24} />
        <div className="chat-card-title">
          <span>{trace.userName}</span>
          <span className="chat-card-meta">
            {headline.text} · {trace.profile ?? "No profile"}
          </span>
        </div>
        {onOpenStudio && (
          <div className="chat-card-links">
            <button type="button" className="studio-link-btn" onClick={() => onOpenStudio({ kind: "sync-rep", userId: trace.userId })}>
              <UserRoundSearch size={12} aria-hidden="true" /> See their sync
            </button>
            {trace.featureId && (
              <button type="button" className="studio-link-btn" onClick={() => onOpenStudio({ kind: "setup", featureId: trace.featureId! })}>
                <ExternalLink size={12} aria-hidden="true" /> Open in Studio
              </button>
            )}
          </div>
        )}
      </header>
      <ol className="studio-checklist-rows chat-card-rows">
        {checks.map((check, i) => (
          <React.Fragment key={check.id}>
            {(i === 0 || checks[i - 1].stage !== check.stage) && (
              <li className="ui-section-title chat-card-stage" aria-hidden="true">
                {stageTitle(check.stage)}
              </li>
            )}
            <CheckRow
              check={check}
              expanded={open === check.id}
              onToggle={() => setOpen(open === check.id ? null : check.id)}
              fixProps={{ pending, onPendingChange, profiles, affects: trace.profile ? [trace.profile] : undefined }}
            />
          </React.Fragment>
        ))}
      </ol>
      {createsHidden && <p className="chat-card-note">Switch to {org?.label ?? "this session's org"} to create the missing records from here.</p>}
    </section>
  );
}

/** Several users matched the name: pick one and it's sent as the next message. */
export function UserMatchesCard({ matches, message }: { matches: UserMatch[]; message?: string }) {
  const { onSend, isStreaming } = useChatCards();
  return (
    <section className="chat-card" aria-label="Matching users">
      <header className="chat-card-head">
        <StatusIcon tone="info" size={24} />
        <div className="chat-card-title">
          <span>{matches.length > 1 ? `${matches.length} users match` : matches.length === 1 ? "1 user matches" : "No user matches"}</span>
          {message && <span className="chat-card-meta">{message}</span>}
        </div>
      </header>
      {matches.length > 0 && (
        <ul className="chat-card-users" aria-label="Matching users">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="chat-card-user" disabled={isStreaming} onClick={() => onSend(pickUserMessage(m))}>
                <UserRound size={14} aria-hidden="true" />
                <span className="chat-card-user-name">{m.name}</span>
                <span className="chat-card-user-sub">{m.username}</span>
                {m.profile && <span className="chat-card-user-profile">{m.profile}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
