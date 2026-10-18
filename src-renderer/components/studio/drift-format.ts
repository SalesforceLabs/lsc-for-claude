import type { DriftChange, DriftDiff, RecentChange, SnapshotMeta } from "./drift-types";

export interface FeatureGroup<T> {
  featureId: string | null;
  title: string;
  items: T[];
}

/** Group by feature, keeping first-seen order (the server sorts by feature) and "Other" last. */
export function groupByFeature<T extends { featureId: string | null; featureTitle: string | null }>(items: T[]): FeatureGroup<T>[] {
  const groups = new Map<string | null, FeatureGroup<T>>();
  for (const it of items) {
    const g = groups.get(it.featureId) ?? { featureId: it.featureId, title: it.featureTitle || "Other", items: [] };
    g.items.push(it);
    groups.set(it.featureId, g);
  }
  return [...groups.values()].sort((a, b) => Number(a.featureId === null) - Number(b.featureId === null));
}

const MAX_VALUE = 160;

export function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "(empty)";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

export function describeActive(a: DriftChange["active"]): string | null {
  if (!a) return null;
  const word = (v?: boolean) => (v === undefined ? "none" : v ? "active" : "inactive");
  return `${word(a.before)} → ${word(a.after)}`;
}

export function when(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function summaryText(counts: DriftDiff["counts"]): string {
  const parts = [
    counts.changed && `${counts.changed} changed`,
    counts.added && `${counts.added} added`,
    counts.removed && `${counts.removed} removed`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No changes";
}

export function askAboutChange(c: DriftChange, snapshot: SnapshotMeta): string {
  const lines = [
    `Since the "${snapshot.label}" snapshot (${when(snapshot.createdAt)}), the ${c.category} record ${c.developerName}${c.featureTitle ? ` (${c.featureTitle})` : ""} was ${c.kind}${c.modifiedBy ? ` — last modified by ${c.modifiedBy}${c.modifiedAt ? ` on ${when(c.modifiedAt)}` : ""}` : ""}.`,
  ];
  const active = describeActive(c.active);
  if (active) lines.push(`Active: ${active}`);
  for (const f of c.fields.slice(0, 12)) lines.push(`${f.name}: ${formatValue(f.before)} → ${formatValue(f.after)}`);
  for (const a of c.assignmentsAdded) lines.push(`Assignment added: ${a}`);
  for (const a of c.assignmentsRemoved) lines.push(`Assignment removed: ${a}`);
  lines.push("", "What does this change do for LSC users, especially on the iPad? Could it explain something that stopped working, and should it be kept or reverted?");
  return lines.join("\n");
}

export function askAboutRecent(c: RecentChange): string {
  return [
    `${c.name}${c.detail ? ` (${c.detail})` : ""}${c.featureTitle ? ` in ${c.featureTitle}` : ""} was modified${c.modifiedBy ? ` by ${c.modifiedBy}` : ""} on ${when(c.modifiedAt)}.`,
    "",
    "What might this change affect for LSC users, especially on the iPad? Help me work out whether it explains something that stopped working.",
  ].join("\n");
}

export const RECENT_KIND_LABEL: Record<RecentChange["kind"], string> = {
  config: "Admin Console",
  triggerHandler: "Trigger handler",
  validationRule: "Validation rule",
  apexTrigger: "Apex trigger",
  flow: "Flow",
  layout: "Page layout",
};
