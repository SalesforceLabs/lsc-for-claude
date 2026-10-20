import React, { useState } from "react";
import type { SurfaceId } from "./types";
import type { PendingChange } from "./changes";
import SyncOverview from "./SyncOverview";
import PerfView from "./PerfView";
import SimulateView from "./SimulateView";

/**
 * Studio's Testing pages about mobile sync, in the order an admin asks: how is sync
 * doing (Sync health, where any one rep opens as a drill-in), does it meet the
 * customer's targets (Test plans), and how long does a new rep wait (First sync).
 */
export type SyncPage = "sync" | "test-plans" | "first-sync";

export const SYNC_PAGES: SyncPage[] = ["sync", "test-plans", "first-sync"];

interface TestingPagesProps {
  /** The page shown, or null while another Studio section is (the opened pages stay mounted, hidden). */
  page: SyncPage | null;
  onNavigate: (page: SyncPage) => void;
  /** The rep open inside Sync health (null = its overview), and how to change it. */
  repUserId: string | null;
  onRepChange: (userId: string | null) => void;
  /** Open a rep's sync detail in Sync health (from Test plans). */
  onOpenRep: (userId: string) => void;
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
  "test-plans": { title: "Test plans", subtitle: "Check the customer's sync targets with real reps, then export a sign-off report" },
  "first-sync": { title: "First sync", subtitle: "Download what a rep's iPad would on its first sync, and time it" },
};

export default function TestingPages({ page, onNavigate, repUserId, onRepChange, onOpenRep, onAskClaude, onOpenSetup, pending, onPendingChange, tray }: TestingPagesProps) {
  // Pages stay mounted once opened so a running job keeps polling while another page is shown.
  const [opened, setOpened] = useState<Set<SyncPage>>(new Set());
  if (page && !opened.has(page)) setOpened(new Set([...opened, page]));
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
          repUserId={repUserId}
          onRepChange={onRepChange}
          pending={pending}
          onPendingChange={onPendingChange}
          onTestUsers={(userIds) => {
            setSeed((s) => ({ key: (s?.key ?? 0) + 1, userIds }));
            onNavigate("test-plans");
          }}
        />
      )}
      {pane("test-plans", <PerfView onAskClaude={onAskClaude} seed={seed} onOpenRep={onOpenRep} />)}
      {pane("first-sync", <SimulateView />)}
    </>
  );
}
