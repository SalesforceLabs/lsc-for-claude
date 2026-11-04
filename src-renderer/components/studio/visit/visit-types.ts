import type { VisitChecks } from "./checks/types";
import type { VisitSections } from "./sections/types";
import type { VisitStructure } from "./structure/types";

export type { VisitChecks, VisitSections, VisitStructure };

/** Structural copy of PublishedVisit in src/studio/screens/visit/index.ts. */
export interface PublishedVisit {
  structure?: VisitStructure;
  sections?: VisitSections;
  checks?: VisitChecks;
}
