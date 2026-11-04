/**
 * Visit Engagement (lifesciences-ios module/Visit): what the editor reads beyond the cache's Visit layout.
 * Three parts, each its own collector so one failing leaves the others: structure (header, record types,
 * compliance, signature, attendees), sections (the sidebar and related sections) and checks (Save / Sign / Submit).
 */

import type { ScreenContext } from "../context.js";
import { collectVisitChecks, type VisitChecks } from "./checks.js";
import { collectVisitSections, type VisitSections } from "./sections.js";
import { collectVisitStructure, type VisitStructure } from "./structure.js";

export type { VisitChecks, VisitSections, VisitStructure };

export interface PublishedVisit {
  structure?: VisitStructure;
  sections?: VisitSections;
  checks?: VisitChecks;
}

export async function collectVisit(ctx: ScreenContext): Promise<PublishedVisit | undefined> {
  if (ctx.scope("Visit") === undefined) return undefined; // the device doesn't sync visits
  const [structure, sections, checks] = await Promise.all([
    collectVisitStructure(ctx).catch(() => undefined),
    collectVisitSections(ctx).catch(() => undefined),
    collectVisitChecks(ctx).catch(() => undefined),
  ]);
  return { structure, sections, checks };
}
