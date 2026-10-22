import React from "react";

/** An activity indicator. Fades in after a beat so quick loads never flash it. */
export default function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={`ui-spinner${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, borderWidth: size >= 20 ? 2 : 1.75 }}
      aria-hidden="true"
    />
  );
}
