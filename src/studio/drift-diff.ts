/**
 * Pure diff of two configuration snapshots (snapshot → live) and the mapping of
 * each changed record to the Studio feature it belongs to.
 */

import { flattenSnapshot, type FlatRecord } from "../config/config-diff.js";
import type { ConfigSnapshot } from "../config/types.js";
import { FEATURES } from "./features.js";
import { matchesAny } from "./helpers.js";
import type {
  ChangeKind,
  DriftChange,
  DriftDiff,
  DriftFieldChange,
  SnapshotMeta,
} from "./drift-types.js";

/** Features that own no objects of their own: a fallback when nothing more specific matches. */
const FALLBACKS = { dbSchema: "mobile-sync", actions: "actions-home" };

function titleOf(featureId: string | null): string | null {
  return FEATURES.find((f) => f.id === featureId)?.title ?? null;
}

export function featureForObject(objectName: string | undefined | null): string | null {
  if (!objectName) return null;
  const lower = objectName.toLowerCase();
  return FEATURES.find((f) => f.objects.some((o) => o.toLowerCase() === lower))?.id ?? null;
}

/** The Studio feature a configuration record belongs to, if any. */
export function featureForRecord(
  rec: Pick<FlatRecord, "kind" | "category" | "developerName" | "label" | "fields">
): string | null {
  const text = `${rec.developerName} ${rec.label || ""}`;
  if (rec.kind === "triggerHandler") {
    return (
      FEATURES.find((f) => f.handlerKeywords.length && matchesAny(text, f.handlerKeywords))?.id ??
      null
    );
  }
  if (rec.category === "DbSchema") {
    const object =
      typeof rec.fields.SObject === "string"
        ? rec.fields.SObject
        : rec.developerName.replace(/^DbSchema_/i, "");
    return featureForObject(object) ?? FALLBACKS.dbSchema;
  }
  if (rec.category === "QuickAction" || rec.category === "CustomAction") {
    const body = [text, ...Object.values(rec.fields).filter((v) => typeof v === "string")].join(
      " "
    );
    return (
      FEATURES.find((f) => f.actionKeywords.length && matchesAny(body, f.actionKeywords))?.id ??
      FALLBACKS.actions
    );
  }
  return (
    FEATURES.find(
      (f) => f.adminCategoryKeywords.length && matchesAny(rec.category, f.adminCategoryKeywords)
    )?.id ?? null
  );
}

export function featureTitle(featureId: string | null): string | null {
  return titleOf(featureId);
}

function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return norm(a) === norm(b);
}

const assignmentName = (a: { level: string; name: string }) => `${a.level || "Profile"}: ${a.name}`;

function change(
  kind: ChangeKind,
  key: string,
  rec: FlatRecord,
  extra: Partial<DriftChange> = {}
): DriftChange {
  const featureId = featureForRecord(rec);
  return {
    key,
    kind,
    category: rec.category,
    developerName: rec.developerName,
    label: rec.label,
    featureId,
    featureTitle: titleOf(featureId),
    fields: [],
    assignmentsAdded: [],
    assignmentsRemoved: [],
    ...extra,
  };
}

/** Diff `snapshot` (before) against `live` (after). Changes are sorted by feature, category, then name. */
export function diffSnapshots(
  snapshot: ConfigSnapshot,
  live: ConfigSnapshot,
  meta: SnapshotMeta
): DriftDiff {
  const before = flattenSnapshot(snapshot);
  const after = flattenSnapshot(live);
  const changes: DriftChange[] = [];

  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) {
      changes.push(
        change("removed", key, b, {
          active: b.isActive === undefined ? undefined : { before: b.isActive },
          fields: Object.keys(b.fields)
            .sort()
            .map((name) => ({ name, before: b.fields[name], after: undefined })),
          assignmentsRemoved: b.assignments.map(assignmentName),
        })
      );
      continue;
    }
    const fields: DriftFieldChange[] = [];
    for (const name of new Set([...Object.keys(b.fields), ...Object.keys(a.fields)])) {
      if (!same(b.fields[name], a.fields[name]))
        fields.push({ name, before: b.fields[name], after: a.fields[name] });
    }
    fields.sort((x, y) => x.name.localeCompare(y.name));
    const beforeNames = new Set(b.assignments.map(assignmentName));
    const afterNames = new Set(a.assignments.map(assignmentName));
    const assignmentsAdded = [...afterNames].filter((n) => !beforeNames.has(n)).sort();
    const assignmentsRemoved = [...beforeNames].filter((n) => !afterNames.has(n)).sort();
    const activeChanged =
      b.isActive !== a.isActive && b.isActive !== undefined && a.isActive !== undefined;
    if (!fields.length && !assignmentsAdded.length && !assignmentsRemoved.length && !activeChanged)
      continue;
    changes.push(
      change("changed", key, a, {
        label: a.label ?? b.label,
        active: activeChanged ? { before: b.isActive, after: a.isActive } : undefined,
        fields,
        assignmentsAdded,
        assignmentsRemoved,
      })
    );
  }
  for (const [key, a] of after) {
    if (before.has(key)) continue;
    changes.push(
      change("added", key, a, {
        active: a.isActive === undefined ? undefined : { after: a.isActive },
        fields: Object.keys(a.fields)
          .sort()
          .filter((n) => !same(a.fields[n], ""))
          .map((name) => ({ name, before: undefined, after: a.fields[name] })),
        assignmentsAdded: a.assignments.map(assignmentName),
      })
    );
  }

  const order = (c: DriftChange) =>
    c.featureId ? FEATURES.findIndex((f) => f.id === c.featureId) : FEATURES.length;
  changes.sort(
    (x, y) =>
      order(x) - order(y) ||
      x.category.localeCompare(y.category) ||
      x.developerName.localeCompare(y.developerName)
  );
  return {
    snapshot: meta,
    generatedAt: new Date().toISOString(),
    changes,
    counts: {
      added: changes.filter((c) => c.kind === "added").length,
      removed: changes.filter((c) => c.kind === "removed").length,
      changed: changes.filter((c) => c.kind === "changed").length,
    },
  };
}
