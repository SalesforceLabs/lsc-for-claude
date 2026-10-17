// Structural copy of PublishedTableau in src/studio/screens/tableau.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedTableauPopc {
  relative?: string;
  tone?: "positive" | "negative" | "neutral";
  comparison: string;
}

export interface PublishedTableauMetric {
  id: string;
  name: string;
  ban: string;
  popc: PublishedTableauPopc;
  description: string;
  unavailable?: boolean;
}

export interface PublishedTableau {
  metrics: PublishedTableauMetric[];
  valuesLoaded: boolean;
  valuesSource?: "insights" | "data-cloud" | "none";
}
