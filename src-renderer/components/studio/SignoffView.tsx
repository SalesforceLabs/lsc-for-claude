import React, { useEffect, useState } from "react";
import PerfView from "./PerfView";
import SimulateView from "./SimulateView";
import Segmented from "../ui/Segmented";

export interface SignoffViewProps {
  onAskClaude: (prompt: string) => void;
  /** Users from Overview to start a new test plan with; a new key means a new hand-off. */
  seed: { key: number; userIds: string[] } | null;
}

export default function SignoffView({ onAskClaude, seed }: SignoffViewProps) {
  const [mode, setMode] = useState<"plan" | "firstSync">("plan");
  const [simOpened, setSimOpened] = useState(false);
  // A hand-off from Overview starts a plan, so show the plans.
  useEffect(() => {
    if (seed) setMode("plan");
  }, [seed?.key]);
  return (
    <>
      <div className="studio-signoff-bar">
        <Segmented
          aria-label="Sign-off"
          value={mode}
          onChange={(next) => {
            setMode(next);
            if (next === "firstSync") setSimOpened(true);
          }}
          options={[
            { value: "plan", label: "Test plans" },
            { value: "firstSync", label: "First sync" },
          ]}
        />
      </div>
      <div className="studio-perf-hint studio-signoff-intro">
        {mode === "plan"
          ? "A test plan checks the customer's targets for each persona (a type of rep, such as a field rep) using real reps from the org: predicted sync volume and, where devices have synced, real sync times. Run it, then export a sign-off report."
          : "First sync signs in as one rep and downloads what their iPad would on its first sync, so you can see how long a new rep waits."}
      </div>
      <div className="studio-signoff-pane" hidden={mode !== "plan"}>
        <PerfView onAskClaude={onAskClaude} seed={seed} />
      </div>
      {simOpened && (
        <div className="studio-signoff-pane" hidden={mode !== "firstSync"}>
          <SimulateView />
        </div>
      )}
    </>
  );
}
