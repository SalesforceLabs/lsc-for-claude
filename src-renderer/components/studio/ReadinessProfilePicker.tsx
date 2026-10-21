import React from "react";
import { ChevronDown } from "lucide-react";
import Menu from "../ui/Menu";
import { profileLabel, type ReadinessProfile } from "./readiness-profile";

interface Props {
  /** "Readiness for" on the Overview, "For" on a feature. */
  prefix: string;
  value: string | null;
  /** Null while the list loads. */
  profiles: ReadinessProfile[] | null;
  onChange: (profile: string | null) => void;
}

/** Picks the profile readiness is shown for. The choice is shared by the Overview and every feature. */
export default function ReadinessProfilePicker({ prefix, value, profiles, onChange }: Props) {
  const list = profiles ?? [];
  // A profile picked before the list came back (or in another list) still shows as the choice.
  const shown = value && !list.some((p) => p.name === value) ? [{ name: value, users: 0, group: "ipad" as const }, ...list] : list;
  return (
    <div className="studio-rprofile">
      <span className="studio-rprofile-prefix">{prefix}</span>
      <Menu
        label={`${prefix}: choose a profile`}
        trigger={
          <>
            <span className="studio-rprofile-value">{value ?? "All profiles"}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </>
        }
        items={[
          { label: "All profiles", checked: value === null, onSelect: () => onChange(null) },
          ...(profiles === null ? [{ label: "Loading profiles…", disabled: true, onSelect: () => {} }] : []),
          ...shown.map((p) => ({
            label: p.users ? profileLabel(p) : p.name,
            checked: p.name === value,
            onSelect: () => onChange(p.name),
          })),
        ]}
      />
    </div>
  );
}
