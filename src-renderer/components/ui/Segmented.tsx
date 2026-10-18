import React from "react";
import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: LucideIcon;
  /** Small count after the label. */
  count?: number;
  disabled?: boolean;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
}

/** A macOS-style segmented control: one choice of a few, used for view switches and tabs. */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <div className={`ui-segmented ${size}${className ? ` ${className}` : ""}`} role="tablist" aria-label={rest["aria-label"]}>
      {options.map((o) => {
        const Icon = o.icon;
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={o.disabled}
            title={o.title}
            onClick={() => !selected && onChange(o.value)}
          >
            {Icon && <Icon size={14} strokeWidth={2} aria-hidden="true" />}
            <span>{o.label}</span>
            {o.count !== undefined && <span className="ui-segmented-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
