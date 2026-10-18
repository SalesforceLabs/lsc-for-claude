import React from "react";
import type { Severity } from "./types";
import { SEVERITY_ORDER } from "./findings";

const LABELS: Record<Severity, [string, string]> = {
  error: ["error", "errors"],
  warning: ["warning", "warnings"],
  info: ["note", "notes"],
};

interface SeverityChipsProps {
  counts: Record<Severity, number>;
  compact?: boolean;
  emptyLabel?: string;
}

export function SeverityChips({ counts, compact, emptyLabel }: SeverityChipsProps) {
  const present = SEVERITY_ORDER.filter((s) => counts[s] > 0);
  if (present.length === 0) {
    return emptyLabel ? <div className="studio-chips"><span className="studio-chip ok">{emptyLabel}</span></div> : null;
  }
  return (
    <div className="studio-chips">
      {present.map((s) => (
        <span key={s} className={`studio-chip ${s}`}>
          {counts[s]}
          {!compact && ` ${LABELS[s][counts[s] === 1 ? 0 : 1]}`}
        </span>
      ))}
    </div>
  );
}
