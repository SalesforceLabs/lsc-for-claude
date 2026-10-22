import type { FeatureMap, Severity, StudioFinding, StudioSurface } from "./types";
import { fitFor, type Lens } from "./lens";

export const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];

/** Every finding on a surface — surface-level plus each item's, skipping items the lens excludes. */
export function allFindings(surface: StudioSurface, lens: Lens = null): StudioFinding[] {
  const items = lens ? surface.items.filter((i) => fitFor(i, lens).fit !== "excluded") : surface.items;
  return [...surface.findings, ...items.flatMap((i) => i.findings)];
}

export function mapFindings(map: FeatureMap, lens: Lens = null): StudioFinding[] {
  return map.surfaces.flatMap((s) => allFindings(s, lens));
}

export function countBySeverity(findings: StudioFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

export function worstSeverity(findings: StudioFinding[]): Severity | null {
  return SEVERITY_ORDER.find((s) => findings.some((f) => f.severity === s)) ?? null;
}
