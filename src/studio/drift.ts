/**
 * Configuration drift for Studio's "What changed" page — save snapshots of an
 * org's LSC configuration, list them, and diff the org now against one. With no
 * snapshot, `list` also returns what was modified recently and by whom.
 */

import { collectConfig } from "../config/collect.js";
import { diffSnapshots } from "./drift-diff.js";
import { attachModifiers, DEFAULT_DAYS, recentChanges } from "./drift-recent.js";
import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from "./drift-store.js";
import type { DriftDeleted, DriftDiff, DriftList, DriftSaved } from "./drift-types.js";

export type DriftInput =
  | { action: "list"; days?: number }
  | { action: "save"; label?: string }
  | { action: "diff"; id: string }
  | { action: "delete"; id: string };

export async function drift(input: DriftInput & { action: "list" }, org: string): Promise<DriftList>;
export async function drift(input: DriftInput & { action: "save" }, org: string): Promise<DriftSaved>;
export async function drift(input: DriftInput & { action: "diff" }, org: string): Promise<DriftDiff>;
export async function drift(input: DriftInput & { action: "delete" }, org: string): Promise<DriftDeleted>;
export async function drift(input: DriftInput, org: string): Promise<DriftList | DriftSaved | DriftDiff | DriftDeleted>;
export async function drift(input: DriftInput, org: string) {
  switch (input.action) {
    case "list": {
      const [snapshots, recent] = await Promise.all([listSnapshots(org), recentChanges(org, input.days ?? DEFAULT_DAYS)]);
      return { org, snapshots, recent };
    }
    case "save":
      return { snapshot: await saveSnapshot(org, await collectConfig(org), input.label) };
    case "diff": {
      const stored = await loadSnapshot(org, input.id);
      const diff = diffSnapshots(stored.config, await collectConfig(org), stored.meta);
      await attachModifiers(diff.changes, org);
      return diff;
    }
    case "delete":
      await deleteSnapshot(org, input.id);
      return { deleted: input.id };
  }
}
