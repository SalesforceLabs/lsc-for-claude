import { describe, it, expect } from "vitest";
import { touchesDbSchema as renderer } from "../../../src-renderer/components/studio/sync-impact-util.js";
import { touchesDbSchema as backend } from "../../../src/perf/what-if.js";

const cfg = (kind: string, category: string) => ({ kind, category, developerName: "X" });
const fixtures: Record<string, unknown>[] = [
  ...["setConfigField", "setProfileAssignments", "createConfigRecord", "deleteConfigRecord"].flatMap((k) => [cfg(k, "DbSchema"), cfg(k, "Actions")]),
  { kind: "setActive", record: { type: "config", category: "DbSchema", developerName: "X" } },
  { kind: "setActive", record: { type: "config", category: "Actions", developerName: "X" } },
  { kind: "setActive", record: { type: "triggerHandler", developerName: "X" } },
  { kind: "assignPsl" },
  { kind: "setCustomScriptCode" },
  ...["saveCustomScript", "createCustomScript", "deleteCustomScript", "assignCustomScript"].map((kind) => ({ kind })),
];

describe("touchesDbSchema copies", () => {
  it("agree on every fixture", () => {
    for (const f of fixtures) expect(renderer(f)).toBe(backend(f));
  });
});
