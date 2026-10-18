import React from "react";
import { ChevronRight } from "lucide-react";
import StatusIcon, { type StatusTone } from "../ui/StatusIcon";
import Spinner from "../ui/Spinner";

/** Small building blocks shared by the Testing sync pages, so they read as one product. */

interface CalloutProps {
  tone: "pass" | "warning" | "error" | "info";
  title?: React.ReactNode;
  /** Replaces the tone icon with a spinner while something runs. */
  busy?: boolean;
  /** Buttons on the right. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status" | "note";
}

/** A note on a tinted background with a status icon; the tone is carried by the icon and tint, never a stripe. */
export function Callout({ tone, title, busy, actions, children, className, role }: CalloutProps) {
  return (
    <div className={`studio-perf-callout ${tone}${className ? ` ${className}` : ""}`} role={role ?? (tone === "error" ? "alert" : undefined)}>
      <span className="studio-perf-callout-icon">{busy ? <Spinner size={16} /> : <StatusIcon tone={tone as StatusTone} size={20} />}</span>
      <div className="studio-perf-callout-body">
        {title && <div className="studio-perf-callout-title">{title}</div>}
        {children}
      </div>
      {actions && <div className="studio-perf-callout-actions">{actions}</div>}
    </div>
  );
}

/** A text button that opens and closes a section; the chevron turns instead of swapping glyphs. */
export function Disclosure({
  open,
  onToggle,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" className={`studio-perf-disclosure${className ? ` ${className}` : ""}`} aria-expanded={open} onClick={onToggle}>
      <ChevronRight size={14} strokeWidth={2.25} className="studio-perf-chevron" aria-hidden="true" />
      {children}
    </button>
  );
}

/** One measured value: label, big number, optional hint. */
export function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" | "error" | "pass" }) {
  return (
    <div className="studio-metric">
      <div className="studio-metric-label">{label}</div>
      <div className={`studio-metric-value ui-num${tone ? ` ${tone}` : ""}`}>{value}</div>
      {hint && <div className="studio-metric-hint">{hint}</div>}
    </div>
  );
}

/** A 4px determinate bar. */
export function Bar({ value, max, label, title }: { value: number; max: number; label: string; title?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="studio-perf-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} title={title}>
      <div className="studio-perf-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
