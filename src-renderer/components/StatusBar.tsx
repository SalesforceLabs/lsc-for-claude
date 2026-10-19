import React from "react";
import { Pin, Settings, TriangleAlert } from "lucide-react";
import Menu, { type MenuItem } from "./ui/Menu";
import Spinner from "./ui/Spinner";
import { useApiVersion } from "../hooks/useApiVersion";
import { useOrgs } from "../hooks/useOrgs";

/** App-wide bottom bar: Settings and how many tools the assistant has, and the selected org's API version. The org lives at the top of the sidebar. */
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
      <ApiVersionMenu />
    </div>
  );
}

/** The selected org's Salesforce API version, with a menu to pin another for that org. */
function ApiVersionMenu() {
  const { current, chosen } = useOrgs();
  const { info, loading, error, org, setVersion, reload } = useApiVersion();
  const orgName = current?.alias || current?.username || chosen;

  if (!loading && !org) return null;
  if (loading) {
    return (
      <span className="status-bar-api" aria-live="polite">
        <Spinner size={10} />
        <span className="status-bar-meta">API version</span>
      </span>
    );
  }
  if (!info) {
    return (
      <Menu
        className="status-bar-api"
        label="API version"
        above
        title={error ?? undefined}
        trigger={
          <>
            <TriangleAlert size={12} aria-hidden="true" className="status-bar-warn" />
            <span>API version unavailable</span>
          </>
        }
        items={[{ label: "Try again", onSelect: reload }]}
      />
    );
  }

  const items: MenuItem[] = [
    { label: `Org default (${info.orgDefault})`, checked: !info.pinned, onSelect: () => void setVersion(null) },
    ...info.available.map((v) => ({ label: v, checked: info.pinned === v, onSelect: () => void setVersion(v) })),
  ];
  const title = error
    ? error
    : info.pinned
      ? `Salesforce API ${info.pinned} for ${orgName}, chosen here. The org's own is ${info.orgDefault}.`
      : `Salesforce API ${info.version} for ${orgName}, the org's own. Choose another for this org.`;
  return (
    <Menu
      className="status-bar-api"
      label={`Salesforce API version for ${orgName}`}
      above
      title={title}
      trigger={
        <>
          {error && <TriangleAlert size={12} aria-hidden="true" className="status-bar-warn" />}
          {info.pinned && !error && <Pin size={11} aria-hidden="true" />}
          <span>API {info.version}</span>
        </>
      }
      items={items}
    />
  );
}
