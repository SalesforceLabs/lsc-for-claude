import React from "react";
import { rozTileSrc, useAppIcon } from "../app-icon";
import { connectionChoice, type LlmConnectionKind } from "../connection";

/** Shown while startup reconnects; it fades in late so a quick reconnect never flashes it. */
export default function LaunchScreen({ connecting }: { connecting?: LlmConnectionKind }) {
  const appIcon = useAppIcon();
  const status = connecting ? `Connecting to ${connectionChoice(connecting)?.label ?? "your model"}…` : "Starting up…";
  return (
    <div className="launch-screen">
      <div className="setup-drag drag-region" />
      <div className="launch-body" role="status" aria-live="polite">
        <div className="welcome-logo-wrap launch-logo-wrap">
          <img src={rozTileSrc(appIcon)} alt="" className="welcome-logo" />
        </div>
        <h1 className="launch-title">Roz for LSC</h1>
        <div className="launch-progress" aria-hidden="true">
          <span />
        </div>
        <p className="launch-status" key={status}>
          {status}
        </p>
      </div>
    </div>
  );
}
