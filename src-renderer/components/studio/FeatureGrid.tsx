import React from "react";
import type { FeatureMap, StudioSurface, SurfaceId } from "./types";
import { allFindings, countBySeverity, worstSeverity } from "./findings";
import { SeverityChips } from "./SeverityChips";

/** Lane accent colours, by column index. */
const LANE_COLORS = ["#a78bfa", "#3b82f6", "#34d399", "#f59e0b", "#f472b6", "#22d3ee"];

interface FeatureGridProps {
  map: FeatureMap;
  selectedSurface: SurfaceId | null;
  onSelectSurface: (id: SurfaceId | null) => void;
}

/** Every surface of a feature, one column per lane — the view for everyone, before a profile is picked. */
export default function FeatureGrid({ map, selectedSurface, onSelectSurface }: FeatureGridProps) {
  const lanes = map.lanes.filter((lane) => map.surfaces.some((s) => s.lane === lane.id));
  return (
    <div className="studio-board" onClick={() => onSelectSurface(null)}>
      {lanes.map((lane, idx) => (
        <div
          key={lane.id}
          className="studio-board-lane"
          style={{ "--lane-color": LANE_COLORS[idx % LANE_COLORS.length] } as React.CSSProperties}
        >
          <div className="studio-lane-title">{lane.title}</div>
          {map.surfaces
            .filter((s) => s.lane === lane.id)
            .map((surface) => (
              <SurfaceCard
                key={surface.id}
                surface={surface}
                selected={surface.id === selectedSurface}
                onSelect={() => onSelectSurface(surface.id)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function SurfaceCard({ surface, selected, onSelect }: { surface: StudioSurface; selected: boolean; onSelect: () => void }) {
  const findings = allFindings(surface);
  const worst = worstSeverity(findings);
  const top = worst ? findings.find((f) => f.severity === worst) : undefined;
  const empty = !surface.error && surface.items.length === 0;

  return (
    <button
      type="button"
      className={`studio-surface${selected ? " selected" : ""}${empty ? " empty" : ""}`}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div className="studio-surface-header">
        <span className="studio-surface-title">{surface.title}</span>
        <span className="studio-surface-count">{surface.error ? "!" : surface.items.length}</span>
      </div>
      {surface.error ? (
        <div className="studio-surface-error">Couldn't load</div>
      ) : empty ? (
        <div className="studio-surface-none">None configured</div>
      ) : top ? (
        <div className={`studio-surface-finding ${top.severity}`}>{top.title}</div>
      ) : (
        <div className="studio-surface-desc">{surface.description}</div>
      )}
      <SeverityChips counts={countBySeverity(findings)} compact />
    </button>
  );
}
