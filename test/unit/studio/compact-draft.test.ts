import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyCompactOps as applyServerOps, compactFields } from "../../../src/studio/metadata/compact-ops.js";
import { parseXml } from "../../../src/studio/metadata/xml.js";
import {
  alignCompact,
  applyCompactOps,
  compactTargetOf,
  compactVerbs,
  crowdedNote,
  diffCompactOps,
  draftHeader,
  moveCompactFieldTo,
  type CompactDraft,
} from "../../../src-renderer/components/studio/compact-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { RecordFieldSpec } from "../../../src-renderer/components/studio/published-types.js";
import type { CompactOp, LiveCompactLayout } from "../../../src-renderer/components/studio/types.js";

const FULL_NAME = "Account.Account_Layout";
const xml = readFileSync(join(__dirname, "../../fixtures/metadata/Account_Layout.compactLayout-meta.xml"), "utf8");
const root = parseXml(xml);

/** What studio_metadata_doc reads (src/studio/metadata/live.ts). */
const live: LiveCompactLayout = {
  type: "CompactLayout",
  fullName: FULL_NAME,
  label: "Account",
  fields: compactFields(root),
  available: [
    { name: "Name", label: "Account Name", type: "string" },
    { name: "Phone", label: "Phone", type: "phone" },
    { name: "Website", label: "Website", type: "url" },
    { name: "Type", label: "Account Type", type: "picklist" },
  ],
  recordTypes: ["HCO", "HCP"],
  production: false,
};
const base = live.fields;

/** The header the cache draws: every field but Name (published.ts). */
const published: RecordFieldSpec[] = base.filter((f) => f !== "Name").map((name) => ({ name, label: name, type: "string" }));

/** The renderer's ops, applied by the server to the retrieved XML, give the drawn target. */
function serverAgrees(ops: CompactOp[], target: string[]) {
  expect(compactFields(applyServerOps(root, ops).root)).toEqual(target);
}

function draftOf(pending: PendingChange[]): CompactDraft {
  const target = compactTargetOf(FULL_NAME, base, pending);
  const fields = draftHeader(published, live, base, target);
  return { fullName: FULL_NAME, label: "Account", live, base, target, shown: fields.filter((f) => f.state !== "removed").map((f) => f.spec.name) };
}

const verbsFor = (d: CompactDraft, field: string) => compactVerbs(d, field, field);
const runVerb = (d: CompactDraft, field: string, id: string, pending: PendingChange[]) => {
  const v = verbsFor(d, field).find((x) => x.id === id)!;
  expect(v.run).toBeDefined();
  return v.run!(pending);
};

describe("compact draft ops", () => {
  it("finds no difference between a compact layout and itself", () => {
    expect(diffCompactOps(base, base)).toEqual([]);
  });

  it("moves, removes and adds, in ops the server applies to the same result", () => {
    const target = ["Phone", "Industry", "Name", "AccountNumber", "SDO_Days_Since_Activity__c", "NumberOfEmployees", "Website"];
    const ops = diffCompactOps(base, target);
    expect(applyCompactOps(base, ops)).toEqual(target);
    serverAgrees(ops, target);
    expect(ops.filter((o) => o.op === "removeCompactField").map((o) => o.field)).toEqual(["Type", "SDO_Sales_Closed_Won_Value__c"]);
    expect(ops.filter((o) => o.op === "addCompactField").map((o) => o.field)).toEqual(["Website", "Phone"]);
  });

  it("refuses ops that no longer fit, like the server", () => {
    expect(() => applyCompactOps(base, [{ op: "removeCompactField", field: "Gone__c" }])).toThrow(/isn't on/);
    expect(() => applyCompactOps(base, [{ op: "addCompactField", field: "Type", before: null }])).toThrow(/already on/);
  });
});

describe("compact verbs", () => {
  it("queues one change for the compact layout and drops it when a move is undone", () => {
    const right = runVerb(draftOf([]), "AccountNumber", "down", []);
    expect(right).toHaveLength(1);
    const fix = right[0].fix;
    expect(fix).toMatchObject({ kind: "editMetadata", doc: { type: "CompactLayout", fullName: FULL_NAME, label: "Account" } });
    const d = draftOf(right);
    expect(d.target.slice(0, 3)).toEqual(["Name", "Type", "AccountNumber"]);
    serverAgrees((fix as { ops: CompactOp[] }).ops, d.target);
    expect(runVerb(d, "AccountNumber", "up", right)).toEqual([]);
  });

  it("stops at the ends of what's drawn (Name is the title) and offers Restore for a removed field", () => {
    const d = draftOf([]);
    expect(verbsFor(d, "AccountNumber").find((v) => v.id === "up")).toMatchObject({ label: "Move left", reason: "Already the first field" });
    expect(verbsFor(d, "SDO_Days_Since_Activity__c").find((v) => v.id === "down")?.run).toBeUndefined();
    const removed = runVerb(d, "Type", "remove", []);
    const after = draftOf(removed);
    expect(after.target).not.toContain("Type");
    expect(draftHeader(published, live, base, after.target).find((f) => f.spec.name === "Type")?.state).toBe("removed");
    expect(verbsFor(after, "Type").map((v) => v.id)).toEqual(["restore"]);
    expect(runVerb(after, "Type", "restore", removed)).toEqual([]);
  });

  it("adds a field after the selected one from the picker, leaving out fields already there", () => {
    const d = draftOf([]);
    const add = verbsFor(d, "AccountNumber").find((v) => v.id === "addField")!;
    expect(add.run).toBeUndefined();
    expect(add.pick?.options.map((o) => o.value)).toEqual(["Phone", "Website"]);
    const queued = add.pick!.run("Phone", []);
    const next = draftOf(queued);
    expect(next.target.slice(0, 3)).toEqual(["Name", "AccountNumber", "Phone"]);
    serverAgrees((queued[0].fix as { ops: CompactOp[] }).ops, next.target);
    const drawn = draftHeader(published, live, base, next.target);
    expect(drawn.find((f) => f.spec.name === "Phone")).toEqual({ spec: { name: "Phone", label: "Phone", type: "phone" }, state: "added" });
  });

  it("refuses an 11th field", () => {
    const full = [...base, "Phone", "Website", "Extra__c"];
    const d: CompactDraft = { ...draftOf([]), target: full, shown: full.filter((f) => f !== "Name") };
    expect(verbsFor(d, "Phone").find((v) => v.id === "addField")).toMatchObject({ reason: expect.stringMatching(/at most 10/) });
  });

  it("warns once the header holds more than about 6 fields", () => {
    expect(crowdedNote(draftOf([]))).toBeNull();
    const more = verbsFor(draftOf([]), "AccountNumber").find((v) => v.id === "addField")!.pick!.run("Phone", []);
    expect(crowdedNote(draftOf(more))).toBe("7 fields in the header — fields after the first 6 or so scroll off the iPad's screen.");
  });
});

describe("compact drops", () => {
  const P: PendingChange[] = [];

  it("queues nothing for a drop where the field already is", () => {
    const d = draftOf(P);
    expect(moveCompactFieldTo(d, base[1], base[2], P)).toBe(P);
    expect(moveCompactFieldTo(d, base[1], base[1], P)).toBe(P);
    expect(moveCompactFieldTo(d, base.at(-1)!, null, P)).toBe(P);
  });

  it("queues what Move right does for a drop one place right", () => {
    const d = draftOf(P);
    expect(moveCompactFieldTo(d, "AccountNumber", base[3], P)).toEqual(runVerb(d, "AccountNumber", "down", P));
  });

  it("queues one change the server deploys as drawn, and dropping it back leaves nothing", () => {
    const field = base[1];
    const moved = moveCompactFieldTo(draftOf(P), field, null, P)!;
    expect(moved).toHaveLength(1);
    const d = draftOf(moved);
    expect(d.target).toEqual([...base.filter((f) => f !== field), field]);
    serverAgrees((moved[0].fix as { ops: CompactOp[] }).ops, d.target);
    expect(moveCompactFieldTo(d, field, base[2], moved)).toEqual([]);
  });

  it("refuses a drop on a field that isn't in the header", () => {
    expect(moveCompactFieldTo(draftOf(P), "Phone", null, P)).toBeNull();
    expect(moveCompactFieldTo(draftOf(P), base[1], "Phone", P)).toBeNull();
  });
});

describe("drawing the draft header", () => {
  it("lines the published header up with the org's, or refuses when it changed", () => {
    expect(alignCompact({ fields: base }, published, base)).toBe(true);
    expect(alignCompact({ fields: base }, published, base.filter((f) => f !== "Type"))).toBe(false);
    // Older snapshots: the drawn fields, in order, within the org's.
    expect(alignCompact(undefined, published, base)).toBe(true);
    expect(alignCompact(undefined, [...published].reverse(), base)).toBe(false);
  });

  it("marks moves and keeps what the cache left out (the title) undrawn", () => {
    const target = applyCompactOps(base, [{ op: "moveCompactField", field: "Industry", before: "AccountNumber" }]);
    const drawn = draftHeader(published, live, base, target);
    expect(drawn.map((f) => f.spec.name)).toEqual(published.map((s) => s.name).sort((a, b) => target.indexOf(a) - target.indexOf(b)));
    expect(drawn.find((f) => f.spec.name === "Industry")?.state).toBe("moved");
    expect(drawn.find((f) => f.spec.name === "NumberOfEmployees")?.state).toBe("same");
  });
});
