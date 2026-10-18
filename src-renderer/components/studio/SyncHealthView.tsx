import React, { useState } from "react";
import type { SurfaceId } from "./types";
import type { PendingChange } from "./changes";
import SyncOverview from "./SyncOverview";
import SyncInvestigate from "./SyncInvestigate";
import SignoffView from "./SignoffView";

/**
 * Sync health — the admin's view of mobile sync, in the order they ask:
 * how is sync doing (Overview), who is struggling and why (Investigate), and
 * can we sign off for go-live (Sign-off: test plans and first-sync replays).
 */
export type SyncTab = "overview" | "investigate" | "signoff";

interface SyncHealthViewProps {
  onAskClaude: (prompt: string) => void;
  /** Open a Setup feature, optionally on a surface and item (e.g. a DB Schema record on Mobile Sync). */
  onOpenSetup: (featureId: string, surface?: SurfaceId | null, item?: string | null) => void;
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
}

const TABS: Array<{ id: SyncTab; label: string; title: string }> = [
  { id: "overview", label: "Overview", title: "How mobile sync is doing across the org, from field telemetry" },
  { id: "investigate", label: "Investigate", title: "One user's predicted sync volume, table by table, and what drives it" },
  { id: "signoff", label: "Sign-off", title: "Test plans against the customer's targets, first-sync replays, and the go-live report" },
];

const SUBTITLES: Record<SyncTab, string> = {
  overview: "How reps' iPads are syncing across the org, and who is struggling. Read from field telemetry — no setup needed.",
  investigate: "What one rep's iPad downloads, table by table, and what to change to make it lighter. Every query is read-only.",
  signoff:
    "Check personas against the customer's targets and replay a first sync, then export a go-live report. Every query is read-only.",
};

export default function SyncHealthView({ onAskClaude, onOpenSetup, pending, onPendingChange }: SyncHealthViewProps) {
  const [tab, setTab] = useState<SyncTab>("overview");
  // Tabs stay mounted once opened so a running job keeps polling while another tab is shown.
  const [opened, setOpened] = useState<Set<SyncTab>>(new Set(["overview"]));
  const [investigateUser, setInvestigateUser] = useState<string | null>(null);
  // Users handed to Sign-off from Overview's at-risk list, to start a test plan with; the key resets it.
  const [seed, setSeed] = useState<{ key: number; userIds: string[] } | null>(null);

  const open = (next: SyncTab) => {
    setTab(next);
    setOpened((o) => (o.has(next) ? o : new Set([...o, next])));
  };

  return (
    <>
      <header className="studio-header">
        <div>
          <h1 className="studio-title">Sync health</h1>
          <div className="studio-subtitle">{SUBTITLES[tab]}</div>
        </div>
        <div className="studio-header-actions">
          <div className="studio-ipad-mode" role="tablist" aria-label="Sync health">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className={`studio-btn${tab === t.id ? " active" : ""}`}
                aria-selected={tab === t.id}
                title={t.title}
                onClick={() => open(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      {opened.has("overview") && (
        <div className="studio-sync-tab" hidden={tab !== "overview"}>
          <SyncOverview
            onAskClaude={onAskClaude}
            onOpenSetup={onOpenSetup}
            onInvestigateUser={(userId) => {
              setInvestigateUser(userId);
              open("investigate");
            }}
            onTestUsers={(userIds) => {
              setSeed((s) => ({ key: (s?.key ?? 0) + 1, userIds }));
              open("signoff");
            }}
          />
        </div>
      )}
      {opened.has("investigate") && (
        <div className="studio-sync-tab" hidden={tab !== "investigate"}>
          <SyncInvestigate
            userId={investigateUser}
            onUserChange={setInvestigateUser}
            onAskClaude={onAskClaude}
            onOpenSetup={onOpenSetup}
            pending={pending}
            onPendingChange={onPendingChange}
          />
        </div>
      )}
      {opened.has("signoff") && (
        <div className="studio-sync-tab" hidden={tab !== "signoff"}>
          <SignoffView onAskClaude={onAskClaude} seed={seed} />
        </div>
      )}
    </>
  );
}
