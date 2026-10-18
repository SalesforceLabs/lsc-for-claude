import React from "react";
import { Settings } from "lucide-react";

/** App-wide bottom bar: Settings and how many tools the assistant has. The org lives at the top of the sidebar. */
interface StatusBarProps {
  toolCount: number;
  onSettingsClick: () => void;
}

export default function StatusBar({ toolCount, onSettingsClick }: StatusBarProps) {
  return (
    <div className="status-bar">
      <button className="status-bar-settings" onClick={onSettingsClick} title="Settings">
        <Settings size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>Settings</span>
        <span className="status-bar-meta">{toolCount} tools</span>
      </button>
    </div>
  );
}
