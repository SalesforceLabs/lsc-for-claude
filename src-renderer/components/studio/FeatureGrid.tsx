import React from "react";
import { CircleAlert } from "lucide-react";
import type { FeatureMap, StudioSurface, SurfaceId } from "./types";
import { allFindings, countBySeverity, worstSeverity } from "./findings";
import { SeverityChips } from "./SeverityChips";

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
      {lanes.map((lane) => (
        <section key={lane.id} className="studio-board-lane">
          <h3 className="ui-section-title">{lane.title}</h3>
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
        </section>
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
        <span className="studio-surface-count">{surface.error ? <CircleAlert size={12} aria-label="Couldn't load" /> : surface.items.length}</span>
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
