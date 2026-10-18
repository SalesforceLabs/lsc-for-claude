import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { childText, childrenNamed, parseXml } from "../../../src/studio/metadata/xml.js";
import { fieldVerbs, modelOf, targetOf, type LayoutDraft } from "../../../src-renderer/components/studio/layout-draft.js";
import { containerOf, extendSelection, groupVerbs, selectionNoun } from "../../../src-renderer/components/studio/multi-select.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { Verb } from "../../../src-renderer/components/studio/edit-draft.js";
import type { EditTarget } from "../../../src-renderer/components/studio/edit-targets.js";
import type { FieldBehavior, LiveLayout } from "../../../src-renderer/components/studio/types.js";

const FULL_NAME = "PersonAccount-HCP Layout";
const root = parseXml(readFileSync(join(__dirname, "../../fixtures/metadata/PersonAccount-HCP_Layout.layout-meta.xml"), "utf8"));
const seen = new Map<string, number>();
const live: LiveLayout = {
  type: "Layout",
  fullName: FULL_NAME,
  sections: childrenNamed(root, "layoutSections").map((s) => {
    const label = childText(s, "label") ?? "";
    const nth = seen.get(label) ?? 0;
    seen.set(label, nth + 1);
    return {
      label,
      nth,
      heading: childText(s, "detailHeading") === "true",
      columns: childrenNamed(s, "layoutColumns").map((c) =>
        childrenNamed(c, "layoutItems").flatMap((i) => {
          const field = childText(i, "field");
          return field ? [{ field, behavior: (childText(i, "behavior") ?? "Edit") as FieldBehavior }] : [];
        })
      ),
    };
  }),
  relatedLists: childrenNamed(root, "relatedLists").map((l) => childText(l, "relatedList") ?? ""),
  profiles: ["LS Rep"],
  production: false,
  available: [],
  availableRelated: [],
};
const base = modelOf(live);

function draftOf(pending: PendingChange[]): LayoutDraft {
  const target = targetOf(FULL_NAME, base, pending);
  return { fullName: FULL_NAME, label: "HCP Layout", live, base, target, shownSections: target.sections.map((s) => s.key), shownRelated: target.relatedLists };
}

const field = (name: string, layout = FULL_NAME): EditTarget => ({ kind: "field", layout, section: "Account Information", field: name, label: name, item: name });
const verbsFor = (t: EditTarget, p: PendingChange[]): Verb[] => (t.kind === "field" ? fieldVerbs(draftOf(p), t.item!, t.label, []) : []);
const fields = ["Name", "Type", "LSDO_Account_Identifier__c"].map((f) => field(f));
const opsOf = (p: PendingChange) => (p.fix as unknown as { ops: { op: string; field: string }[] }).ops;

describe("multi-select", () => {
  it("adds and drops blocks of the same kind in the same container", () => {
    const [a, b] = fields;
    expect(extendSelection([a], b, true)).toEqual([b, a]);
    expect(extendSelection([b, a], b, true)).toEqual([a]);
    // A plain click, another layout, or another kind starts over.
    expect(extendSelection([a], b, false)).toEqual([b]);
    const other = field("Type", "PersonAccount-Other Layout");
    expect(extendSelection([a], other, true)).toEqual([other]);
    const section: EditTarget = { kind: "section", layout: FULL_NAME, index: 0, count: 2, label: "Account Information", key: 0 };
    expect(extendSelection([a], section, true)).toEqual([section]);
    expect(containerOf({ kind: "listView", object: "Account", name: "x", label: "x" })).toBeNull();
    expect(selectionNoun(a, 3)).toBe("fields");
  });

  it("offers only the verbs every block has, and never moves", () => {
    const ids = groupVerbs(fields, [], verbsFor, "fields").map((v) => v.id);
    expect(ids).toContain("remove");
    for (const id of ["up", "down", "column", "addField"]) expect(ids).not.toContain(id);
    expect(ids.every((id) => verbsFor(fields[0], []).some((v) => v.id === id))).toBe(true);
  });

  it("leaves out a verb that means different things for different blocks", () => {
    const required = verbsFor(fields[1], []).find((v) => v.id === "required")!.run!([]);
    const labels = groupVerbs(fields.slice(1), required, verbsFor, "fields").map((v) => v.label);
    // Type is now required ("Make optional"), the other field isn't ("Make required").
    expect(labels).not.toContain("Make required");
    expect(labels).not.toContain("Make optional");
    expect(labels).toContain("Remove");
  });

  it("applies a verb to every block as one diffed change per document", () => {
    const remove = groupVerbs(fields, [], verbsFor, "fields").find((v) => v.id === "remove")!;
    const after = remove.run!([]);
    expect(after).toHaveLength(1);
    expect(after[0].fix).toMatchObject({ kind: "editMetadata", doc: { type: "Layout", fullName: FULL_NAME } });
    expect(opsOf(after[0]).map((o) => o.field).sort()).toEqual(["LSDO_Account_Identifier__c", "Name", "Type"]);
    const left = targetOf(FULL_NAME, base, after).sections.flatMap((s) => s.columns.flat()).map((f) => f.field);
    for (const f of ["Name", "Type", "LSDO_Account_Identifier__c"]) expect(left).not.toContain(f);

    // Restoring them all leaves nothing in the tray.
    const restore = groupVerbs(fields, after, verbsFor, "fields").find((v) => v.id === "restore")!;
    expect(restore.run!(after)).toEqual([]);

    const required = groupVerbs(fields.slice(1), [], verbsFor, "fields").find((v) => v.id === "required")!;
    const both = required.run!([]);
    expect(both).toHaveLength(1);
    expect(opsOf(both[0]).filter((o) => o.op === "setFieldBehavior")).toHaveLength(2);
  });

  it("explains a verb one block can't take instead of running it on the rest", () => {
    const verbs = (t: EditTarget): Verb[] => [
      { id: "hide", label: "Hide for LS Rep", title: "Hide", ...(t === fields[1] ? { reason: "From the Lightning app" } : { run: (p: PendingChange[]) => p }) },
    ];
    const [hide] = groupVerbs(fields, [], verbs, "fields");
    expect(hide.run).toBeUndefined();
    expect(hide.reason).toMatch(/From the Lightning app \(one of the 3 fields\)/);
  });
});
