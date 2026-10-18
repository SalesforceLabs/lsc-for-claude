import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyLayoutOps } from "../../../src/studio/metadata/layout-ops.js";
import { childText, childrenNamed, parseXml, type XmlNode } from "../../../src/studio/metadata/xml.js";
import {
  addedRelated,
  addRelatedVerb,
  alignLayout,
  applyOps,
  diffOps,
  draftRelated,
  draftSections,
  fieldVerbs,
  modelOf,
  relatedVerbs,
  sectionVerbs,
  targetOf,
  withGhosts,
  type LayoutDraft,
  type LayoutModel,
} from "../../../src-renderer/components/studio/layout-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { PublishedLayout, PublishedRelated } from "../../../src-renderer/components/studio/published-types.js";
import type { FieldBehavior, LiveLayout } from "../../../src-renderer/components/studio/types.js";

const FULL_NAME = "PersonAccount-HCP Layout";
const xml = readFileSync(join(__dirname, "../../fixtures/metadata/PersonAccount-HCP_Layout.layout-meta.xml"), "utf8");
const root = parseXml(xml);

/** What studio_metadata_doc reads from the XML (src/studio/metadata/live.ts). */
function liveOf(r: XmlNode): LiveLayout {
  const seen = new Map<string, number>();
  return {
    type: "Layout",
    fullName: FULL_NAME,
    sections: childrenNamed(r, "layoutSections").map((s) => {
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
    relatedLists: childrenNamed(r, "relatedLists").map((l) => childText(l, "relatedList") ?? ""),
    profiles: ["LS Rep", "LS Manager"],
    production: false,
    available: [
      { field: "PersonEmail", label: "Email", type: "email" },
      { field: "Specialty__c", label: "Specialty", type: "picklist" },
    ],
    availableRelated: [
      { relatedList: "Opportunities", object: "Opportunity" },
      { relatedList: "Sample_Request__c.Account__c", object: "Sample_Request__c" },
    ],
  };
}

const live = liveOf(root);
const base = modelOf(live);
const shape = (m: LayoutModel) => ({
  sections: m.sections.map((s) => ({ label: s.label, heading: s.heading, columns: s.columns })),
  relatedLists: m.relatedLists,
});

/** The renderer's ops, applied by the server to the real XML, give the layout the renderer drew. */
function deploysAs(target: LayoutModel) {
  const ops = diffOps(base, target);
  expect(shape(applyOps(base, ops))).toEqual(shape(target));
  expect(shape(modelOf(liveOf(applyLayoutOps(root, ops).root)))).toEqual(shape(target));
  return ops;
}

function draftOf(pending: PendingChange[] = []): LayoutDraft {
  const target = targetOf(FULL_NAME, base, pending);
  return {
    fullName: FULL_NAME,
    label: "HCP Layout",
    live,
    base,
    target,
    shownSections: target.sections.map((s) => s.key),
    shownRelated: target.relatedLists,
  };
}

const run = (verbs: { id: string; run?: (p: PendingChange[]) => PendingChange[] }[], id: string, pending: PendingChange[] = []) => {
  const v = verbs.find((x) => x.id === id);
  expect(v?.run).toBeTruthy();
  return v!.run!(pending);
};

describe("layout draft ops", () => {
  it("finds no difference between a layout and itself", () => {
    expect(diffOps(base, base)).toEqual([]);
  });

  it("moves, removes and reorders, in ops the server applies to the same result", () => {
    const t = applyOps(base, []);
    const [account, additional] = t.sections;
    // Type to the top of column 2; PersonBirthdate taken off; sections swapped; a heading hidden.
    const type = account.columns[0].splice(1, 1)[0];
    account.columns[1].unshift(type);
    account.columns[1] = account.columns[1].filter((i) => i.field !== "PersonBirthdate");
    t.sections = [additional, account, ...t.sections.slice(2)];
    additional.heading = !additional.heading;
    account.columns[0][0].behavior = "Readonly";
    t.relatedLists = [t.relatedLists[2], ...t.relatedLists.filter((_, i) => i !== 2 && i !== 4)];
    const ops = deploysAs(t);
    expect(ops.map((o) => o.op)).toEqual(
      expect.arrayContaining(["removeField", "moveSection", "moveField", "setFieldBehavior", "setSectionHeading", "removeRelatedList", "moveRelatedList"])
    );
  });

  it("removes a section with its fields in one op", () => {
    const t = applyOps(base, []);
    t.sections.splice(0, 1);
    expect(deploysAs(t)).toEqual([{ op: "removeSection", section: { label: "Account Information", nth: 0 } }]);
  });

  it("puts ghosts back after the nearest earlier key still there", () => {
    expect(withGhosts(["a", "b", "c", "d"], ["d", "a"])).toEqual([
      { key: "d", ghost: false },
      { key: "a", ghost: false },
      { key: "b", ghost: true },
      { key: "c", ghost: true },
    ]);
    expect(withGhosts(["a", "b"], ["b"])[0]).toEqual({ key: "a", ghost: true });
  });
});

describe("layout verbs", () => {
  it("queues one change for the layout and drops it when a move is undone", () => {
    const d = draftOf();
    const down = run(fieldVerbs(d, "Name", "Name", ["Name", "Type", "LSDO_Account_Identifier__c"]), "down");
    expect(down).toHaveLength(1);
    expect(down[0].fix).toMatchObject({ kind: "editMetadata", doc: { fullName: FULL_NAME }, ops: [{ op: "moveField", field: "Name" }] });
    expect(down[0].affects).toEqual(["LS Rep", "LS Manager"]);
    const back = run(fieldVerbs(draftOf(down), "Name", "Name", ["Type", "Name", "LSDO_Account_Identifier__c"]), "up", down);
    expect(back).toEqual([]);
  });

  it("stops at the ends and offers Restore for what was removed", () => {
    const d = draftOf();
    const verbs = sectionVerbs(d, 0);
    expect(verbs.find((v) => v.id === "up")?.run).toBeUndefined();
    const removed = run(verbs, "remove");
    const restore = sectionVerbs(draftOf(removed), 0);
    expect(restore.map((v) => v.id)).toEqual(["restore"]);
    expect(run(restore, "restore", removed)).toEqual([]);

    const gone = run(fieldVerbs(d, "Type", "Type", []), "remove");
    expect(run(fieldVerbs(draftOf(gone), "Type", "Type", []), "restore", gone)).toEqual([]);
    const rl = base.relatedLists[1];
    const noList = run(relatedVerbs(d, rl, rl), "remove");
    expect(run(relatedVerbs(draftOf(noList), rl, rl), "restore", noList)).toEqual([]);
  });

  it("toggles behavior and moves a field to the other column", () => {
    const d = draftOf();
    const req = run(fieldVerbs(d, "Type", "Type", []), "required");
    expect(req[0].fix).toMatchObject({ ops: [{ op: "setFieldBehavior", field: "Type", to: "Required" }] });
    const col = run(fieldVerbs(d, "Type", "Type", []), "column");
    expect(targetOf(FULL_NAME, base, col).sections[0].columns[1].at(-1)?.field).toBe("Type");
  });

  const pick = (verbs: { id: string; pick?: { options: { value: string }[]; run: (v: string, p: PendingChange[]) => PendingChange[] } }[], id: string, value: string, pending: PendingChange[] = []) => {
    const p = verbs.find((x) => x.id === id)?.pick;
    expect(p?.options.map((o) => o.value)).toContain(value);
    return p!.run(value, pending);
  };

  it("adds a field at the end of the section's first column, and the server deploys it", () => {
    const added = pick(sectionVerbs(draftOf(), 0), "addField", "Specialty__c");
    const fix = added[0].fix;
    expect(fix).toMatchObject({ kind: "editMetadata", ops: [{ op: "addField", field: "Specialty__c", behavior: "Edit", to: { section: { label: "Account Information", nth: 0 }, column: 0, before: null } }] });
    const target = targetOf(FULL_NAME, base, added);
    expect(target.sections[0].columns[0].at(-1)).toEqual({ field: "Specialty__c", behavior: "Edit" });
    deploysAs(target);
    // Once added it isn't offered again, and taking it off leaves no change.
    const again = sectionVerbs(draftOf(added), 0).find((v) => v.id === "addField")?.pick;
    expect(again?.options.map((o) => o.value)).not.toContain("Specialty__c");
    expect(run(fieldVerbs(draftOf(added), "Specialty__c", "Specialty", []), "remove", added)).toEqual([]);
  });

  it("can't add fields when the object couldn't be described", () => {
    const d = { ...draftOf(), live: { ...live, available: null } };
    const v = sectionVerbs(d, 0).find((x) => x.id === "addField");
    expect(v?.pick).toBeUndefined();
    expect(v?.reason).toMatch(/Couldn't read/);
  });

  it("adds a related list after the selected one, with its object for the DB Schema check", () => {
    const [first, second] = base.relatedLists;
    const added = pick(relatedVerbs(draftOf(), first, first), "addRelated", "Sample_Request__c.Account__c");
    const target = targetOf(FULL_NAME, base, added);
    expect(target.relatedLists.slice(0, 3)).toEqual([first, "Sample_Request__c.Account__c", second]);
    const ops = (added[0].fix as { ops: { op: string; object?: string }[] }).ops;
    expect(ops.find((o) => o.op === "addRelatedList")).toMatchObject({ relatedList: "Sample_Request__c.Account__c", object: "Sample_Request__c" });
    deploysAs(target);
    expect(addRelatedVerb(draftOf(added), null).pick?.options.map((o) => o.value)).toEqual(["Opportunities"]);
  });

  it("marks children the iPad doesn't sync", () => {
    const options = addRelatedVerb(draftOf(), null, (o) => o === "Opportunity").pick!.options;
    expect(options.find((o) => o.value === "Opportunities")?.detail).toMatch(/not synced/);
    expect(options.find((o) => o.value === "Sample_Request__c.Account__c")?.detail).not.toMatch(/not synced/);
  });
});

describe("drawing the draft", () => {
  const spec = (name: string) => ({ name, label: name, type: "string" });
  // The published Account Information section: Name drawn as FirstName + LastName.
  const published: PublishedLayout = {
    name: FULL_NAME,
    sections: [
      {
        label: "Account Information",
        columns: [["First Name", "Last Name", "Type"], ["Birthdate"]],
        fields: [[spec("FirstName"), spec("LastName"), spec("Type")], [spec("PersonBirthdate")]],
        source: { label: "Account Information", nth: 0, columns: [0, 1], fields: [["Name", "Name", "Type"], ["PersonBirthdate"]], heading: true },
      },
    ],
    relatedLists: [],
    actions: [],
  };

  it("lines the published sections up with the org's, or refuses when they've changed", () => {
    expect(alignLayout(published, base)).toEqual([0]);
    const changed = applyOps(base, [{ op: "removeField", field: "Type" }]);
    expect(alignLayout(published, changed)).toBeNull();
  });

  it("draws compound fields together, ghosts what's removed, and marks moves", () => {
    const t = applyOps(base, [
      { op: "removeField", field: "Type" },
      { op: "moveField", field: "Name", to: { section: { label: "Account Information", nth: 0 }, column: 1, before: null } },
    ]);
    const [sec] = draftSections(published, base, t, [0]);
    expect(sec.label).toBe("Account Information");
    expect(sec.columns.map((c) => c.map((f) => `${f.spec.name}:${f.state}`))).toEqual([
      ["Type:removed"],
      ["PersonBirthdate:same", "FirstName:moved", "LastName:moved"],
    ]);
  });

  it("orders related lists by the draft and keeps removed ones as ghosts", () => {
    const rel = (api: string): PublishedRelated => ({ key: api, api, label: api, object: api, count: 0, columns: [], rows: [] });
    const [a, b] = base.relatedLists;
    const t = applyOps(base, [{ op: "moveRelatedList", relatedList: b, before: a }, { op: "removeRelatedList", relatedList: a }]);
    expect(draftRelated([rel(a), rel(b), rel("Other")], base, t).map((r) => `${r.related.api}:${r.state}`)).toEqual([
      `${a}:removed`,
      `${b}:same`,
      "Other:same",
    ]);
  });

  it("draws an added field from the describe, as pending", () => {
    const t = applyOps(base, [{ op: "addField", field: "PersonEmail", behavior: "Edit", to: { section: { label: "Account Information", nth: 0 }, column: 1, before: null } }]);
    const [sec] = draftSections(published, base, t, [0], live.available);
    expect(sec.columns[1].at(-1)).toMatchObject({ spec: { name: "PersonEmail", label: "Email", type: "email" }, item: "PersonEmail", state: "added" });
  });

  it("gives an added related list an empty card in its place", () => {
    const [a] = base.relatedLists;
    const pending = run(relatedVerbs(draftOf(), a, a), "remove");
    const added = addRelatedVerb(draftOf(pending), null).pick!.run("Opportunities", pending);
    const d = draftOf(added);
    const rel = (api: string): PublishedRelated => ({ key: api, api, label: api, object: api, count: 0, columns: [], rows: [] });
    const extra = addedRelated(d, [rel(a)], (o) => `${o}s`);
    expect(extra).toEqual([{ key: "added:Opportunities", api: "Opportunities", label: "Opportunitys", object: "Opportunity", count: 0, columns: [], rows: [] }]);
    expect(draftRelated([rel(a), ...extra], d.base, d.target).map((r) => `${r.related.api}:${r.state}`)).toEqual([`${a}:removed`, "Opportunities:added"]);
  });
});
