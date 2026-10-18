import React from "react";
import { CircleAlert, type LucideIcon } from "lucide-react";
import Spinner from "./Spinner";

interface StateViewProps {
  /** loading shows a spinner; error an alert icon; empty the given icon (or none). */
  kind: "loading" | "empty" | "error";
  title: React.ReactNode;
  detail?: React.ReactNode;
  icon?: LucideIcon;
  /** Buttons under the text. */
  actions?: React.ReactNode;
  /** "fill" centres in the parent (absolutely positioned); "inline" flows with the page. */
  layout?: "fill" | "inline";
  className?: string;
}

/** The loading, empty and error states of every pane — one look, centred, icon then title then detail. */
export default function StateView({ kind, title, detail, icon, actions, layout = "fill", className }: StateViewProps) {
  const Icon = kind === "error" ? CircleAlert : icon;
  return (
    <div
      className={`ui-state ${layout} ${kind}${className ? ` ${className}` : ""}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {kind === "loading" ? (
        <Spinner size={22} />
      ) : (
        Icon && (
          <span className="ui-state-icon">
            <Icon size={22} strokeWidth={1.75} />
          </span>
        )
      )}
      <div className="ui-state-title">{title}</div>
      {detail && <div className="ui-state-detail">{detail}</div>}
      {actions && <div className="ui-state-actions">{actions}</div>}
    </div>
  );
}
