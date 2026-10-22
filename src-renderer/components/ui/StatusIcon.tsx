import React from "react";
import { Check, X, TriangleAlert, Info, CircleQuestionMark, Minus, type LucideIcon } from "lucide-react";

/** Tones every status in the app maps to. */
export type StatusTone = "pass" | "error" | "warning" | "info" | "unknown" | "skipped";

const GLYPHS: Record<StatusTone, LucideIcon> = {
  pass: Check,
  error: X,
  warning: TriangleAlert,
  info: Info,
  unknown: CircleQuestionMark,
  skipped: Minus,
};

interface StatusIconProps {
  tone: StatusTone;
  /** Diameter of the tinted disc, in px. */
  size?: number;
  /** "soft" is a tinted disc with a coloured glyph; "solid" fills the disc. */
  variant?: "soft" | "solid";
  className?: string;
}

/** A status glyph on a tinted disc — the one way the app shows pass / fail / warning at a glance. */
export default function StatusIcon({ tone, size = 20, variant = "soft", className }: StatusIconProps) {
  const Glyph = GLYPHS[tone];
  const glyphSize = Math.round(size * (tone === "warning" ? 0.56 : 0.6));
  return (
    <span
      className={`ui-status-icon ${tone} ${variant}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Glyph size={glyphSize} strokeWidth={tone === "pass" || tone === "error" ? 2.75 : 2.25} />
    </span>
  );
}
