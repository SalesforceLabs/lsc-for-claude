import React, { useState } from "react";
import type { SurfaceId } from "./types";
import type { PendingChange } from "./changes";
import SyncOverview from "./SyncOverview";
import SyncInvestigate from "./SyncInvestigate";
import PerfView from "./PerfView";
import SimulateView from "./SimulateView";

/**
 * Studio's Testing pages about mobile sync, in the order an admin asks: how is sync
 * doing (Sync health), why is one rep's sync heavy (Check a rep's sync), does it meet
 * the customer's targets (Test plans), and how long does a new rep wait (First sync).
 */
export type SyncPage = "sync" | "sync-rep" | "test-plans" | "first-sync";

export const SYNC_PAGES: SyncPage[] = ["sync", "sync-rep", "test-plans", "first-sync"];

interface TestingPagesProps {
  /** The page shown, or null while another Studio section is (the opened pages stay mounted, hidden). */
  page: SyncPage | null;
  onNavigate: (page: SyncPage) => void;
  onAskClaude: (prompt: string) => void;
  /** Open a Setup feature, optionally on a surface and item (e.g. a DB Schema record on Mobile Sync). */
  onOpenSetup: (featureId: string, surface?: SurfaceId | null, item?: string | null) => void;
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  /** Shown at the foot of a page, e.g. the pending-changes tray. */
  tray?: React.ReactNode;
}

const HEADINGS: Record<SyncPage, { title: string; subtitle: string }> = {
  sync: { title: "Sync health", subtitle: "How reps' iPads are syncing, from field telemetry" },
  "sync-rep": { title: "Check a rep's sync", subtitle: "What one rep's iPad downloads, and how to make it lighter" },
  "test-plans": { title: "Test plans", subtitle: "Check the customer's sync targets with real reps, then export a go-live report" },
  "first-sync": { title: "First sync", subtitle: "Download what a rep's iPad would on its first sync, and time it" },
};

export default function TestingPages({ page, onNavigate, onAskClaude, onOpenSetup, pending, onPendingChange, tray }: TestingPagesProps) {
  // Pages stay mounted once opened so a running job keeps polling while another page is shown.
  const [opened, setOpened] = useState<Set<SyncPage>>(new Set());
  if (page && !opened.has(page)) setOpened(new Set([...opened, page]));
  const [investigateUser, setInvestigateUser] = useState<string | null>(null);
  // Users handed to Test plans from Sync health's at-risk list, to start a plan with; the key resets it.
  const [seed, setSeed] = useState<{ key: number; userIds: string[] } | null>(null);

  const pane = (id: SyncPage, body: React.ReactNode) =>
    (opened.has(id) || id === page) && (
      <section key={id} className="studio-main ui-enter" hidden={id !== page}>
        <header className="studio-header">
          <div className="studio-sync-head-text">
            <h1 className="studio-title">{HEADINGS[id].title}</h1>
            <div className="studio-subtitle" title={HEADINGS[id].subtitle}>
              {HEADINGS[id].subtitle}
            </div>
          </div>
        </header>
        <div className="studio-sync-tab">{body}</div>
        {tray}
      </section>
    );

  return (
    <>
      {pane(
        "sync",
        <SyncOverview
          onAskClaude={onAskClaude}
          onOpenSetup={onOpenSetup}
          onInvestigateUser={(userId) => {
            setInvestigateUser(userId);
            onNavigate("sync-rep");
          }}
          onTestUsers={(userIds) => {
            setSeed((s) => ({ key: (s?.key ?? 0) + 1, userIds }));
            onNavigate("test-plans");
          }}
        />
      )}
      {pane(
        "sync-rep",
        <SyncInvestigate
          userId={investigateUser}
          onUserChange={setInvestigateUser}
          onAskClaude={onAskClaude}
          onOpenSetup={onOpenSetup}
          pending={pending}
          onPendingChange={onPendingChange}
        />
      )}
      {pane("test-plans", <PerfView onAskClaude={onAskClaude} seed={seed} />)}
      {pane("first-sync", <SimulateView />)}
    </>
  );
}
