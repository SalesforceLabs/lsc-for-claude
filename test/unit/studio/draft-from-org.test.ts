import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyLayoutOps } from "../../../src/studio/metadata/layout-ops.js";
import { childText, childrenNamed, parseXml, type XmlNode } from "../../../src/studio/metadata/xml.js";
import { aheadOf, alignLayout, applyOps, diffOps, draftSections, modelOf, targetOf, type LayoutModel } from "../../../src-renderer/components/studio/layout-draft.js";
import { draftHeader } from "../../../src-renderer/components/studio/compact-draft.js";
import { draftListColumns } from "../../../src-renderer/components/studio/listview-draft.js";
import { alignFlexiPage, alignFlexiPagePartial } from "../../../src-renderer/components/studio/flexipage-draft.js";
import type { PublishedLayout, PublishedListView, PublishedPage } from "../../../src-renderer/components/studio/published-types.js";
import type { FieldBehavior, LiveCompactLayout, LiveLayout, LiveListView } from "../../../src-renderer/components/studio/types.js";

const FULL_NAME = "PersonAccount-HCP Layout";
const root = parseXml(readFileSync(join(__dirname, "../../fixtures/metadata/PersonAccount-HCP_Layout.layout-meta.xml"), "utf8"));

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
    profiles: ["LS Rep"],
    production: false,
    available: [{ field: "PersonEmail", label: "Email", type: "email" }],
    placed: [
      { field: "Type", label: "Account Type", type: "picklist" },
      { field: "Specialty__c", label: "Specialty", type: "picklist" },
    ],
    availableRelated: [],
  };
}

const spec = (name: string) => ({ name, label: name, type: "string" });
const live = liveOf(root);
const base = modelOf(live);

/** The cache as of the last publish: Account Information without Type (Setup added it since), and a Gone__c Setup took out. */
const behind: PublishedLayout = {
  name: FULL_NAME,
  sections: [
    {
      label: "Account Information",
      columns: [["First Name", "Last Name", "Gone"], ["Birthdate"]],
      fields: [[spec("FirstName"), spec("LastName"), spec("Gone__c")], [spec("PersonBirthdate")]],
      source: { label: "Account Information", nth: 0, columns: [0, 1], fields: [["Name", "Name", "Gone__c"], ["PersonBirthdate"]], heading: true },
    },
  ],
  relatedLists: [],
  actions: [],
};

/** The cache when it matches the org. */
const same: PublishedLayout = {
  ...behind,
  sections: [
    {
      ...behind.sections[0],
      columns: [["First Name", "Last Name", "Type"], ["Birthdate"]],
      fields: [[spec("FirstName"), spec("LastName"), spec("Type")], [spec("PersonBirthdate")]],
      source: { ...behind.sections[0].source!, fields: [["Name", "Name", "Type"], ["PersonBirthdate"]] },
    },
  ],
};

const names = (m: ReturnType<typeof draftSections>) => m.flatMap((s) => s.columns.flat().map((f) => `${f.spec.name}:${f.state}:${f.ahead ?? "-"}`));

describe("a layout the cache is behind", () => {
  it("marks nothing when the cache matches the org", () => {
    // (The fixture layout has more sections than the cache here, so only the fields are compared.)
    const a = aheadOf(same, base)!;
    for (const f of ["FirstName", "LastName", "Name", "Type", "PersonBirthdate"]) expect(a.fields.has(f)).toBe(false);
    expect(a.gone).toEqual([]);
    const aligned = alignLayout(same, base)!;
    expect(aligned).toEqual([0]);
    const drawn = draftSections(same, base, base, aligned, live.available, { placed: live.placed, ahead: aheadOf(same, base) });
    expect(names(drawn).every((n) => n.endsWith(":same:-"))).toBe(true);
  });

  it("marks a field Setup moved, not the ones it passed", () => {
    const moved: PublishedLayout = {
      ...same,
      sections: [{ ...same.sections[0], source: { ...same.sections[0].source!, fields: [["Type", "Name", "Name"], ["PersonBirthdate"]] } }],
    };
    const a = aheadOf(moved, base)!;
    expect([...a.moved]).toEqual(["Type"]);
    for (const f of ["Name", "Type", "PersonBirthdate"]) expect(a.fields.has(f)).toBe(false);
  });

  it("draws the org's layout, with what Setup added marked and what it removed as a ghost", () => {
    const ahead = aheadOf(behind, base)!;
    expect(alignLayout(behind, base)).toBeNull();
    expect(ahead.fields.has("Type")).toBe(true);
    const drawn = draftSections(behind, base, base, alignLayout(behind, base) ?? [], live.available, { placed: live.placed, ahead });
    const all = names(drawn);
    expect(all).toContain("Type:same:added");
    expect(all).toContain("Gone__c:removed:removed");
  });

  it("still deploys edits to the org's layout, and after an apply draws it with an empty tray and no lock", () => {
    const ahead = aheadOf(behind, base);
    const target = applyOps(base, [{ op: "removeField", field: "Type" }]);
    const ops = diffOps(base, target);
    const shape = (m: LayoutModel) => m.sections.map((s) => s.columns);
    const drawn = draftSections(behind, base, target, [], live.available, { placed: live.placed, ahead });
    expect(names(drawn)).toContain("Type:removed:-");
    // The server applies the ops to the XML; the next read of the org is the new base.
    const after = liveOf(applyLayoutOps(root, ops).root);
    expect(shape(modelOf(after))).toEqual(shape(target));
    const next = modelOf(after);
    const settled = draftSections(behind, next, targetOf(FULL_NAME, next, []), alignLayout(behind, next) ?? [], after.available, { placed: after.placed, ahead: aheadOf(behind, next) });
    expect(names(settled).some((n) => n.startsWith("Type:"))).toBe(false);
  });
});

describe("a compact layout the cache is behind", () => {
  const liveCompact: LiveCompactLayout = {
    type: "CompactLayout",
    fullName: "Account.HCP_Compact",
    label: "HCP",
    fields: ["Name", "Phone", "Specialty__c"],
    available: [{ name: "Specialty__c", label: "Specialty", type: "picklist" }],
    recordTypes: null,
    production: false,
  };

  it("draws the org's fields, marking the new one and keeping the removed one as a ghost", () => {
    const published = [spec("Name"), spec("Phone"), spec("Fax")];
    const fields = draftHeader(published, liveCompact, liveCompact.fields, liveCompact.fields, ["Name", "Phone", "Fax"]);
    expect(fields.map((f) => `${f.spec.name}:${f.state}:${f.ahead ?? "-"}`)).toEqual(["Phone:same:-", "Fax:removed:removed", "Specialty__c:same:added"]);
  });

  it("draws a matching cache with no marks", () => {
    const fields = draftHeader([spec("Name"), spec("Phone"), spec("Specialty__c")], liveCompact, liveCompact.fields, liveCompact.fields, ["Name", "Phone", "Specialty__c"]);
    expect(fields.every((f) => !f.ahead && f.state === "same")).toBe(true);
  });
});

describe("a list view the cache is behind", () => {
  const liveView = { type: "ListView", fullName: "Account.All", label: "All", columns: ["FULL_NAME", "Specialty__c"], available: [], filters: [] } as unknown as LiveListView;
  const published: PublishedListView = {
    name: "All",
    label: "All",
    columns: ["Name", "Fax"],
    source: { fullName: "Account.All", columns: ["FULL_NAME", "FAX"], filterScope: null, filters: [], booleanFilter: null },
  };

  it("marks the new column, keeps the removed one as a ghost with its cells", () => {
    const cols = draftListColumns(published, liveView, liveView.columns, liveView.columns);
    expect(cols.map((c) => `${c.id}:${c.state}:${c.ahead ?? "-"}:${c.orig}`)).toEqual(["FULL_NAME:same:-:0", "FAX:removed:removed:1", "Specialty__c:same:added:null"]);
  });
});

describe("a Lightning page the cache is behind", () => {
  it("lines up what it can and counts the rest", () => {
    const page = {
      name: "Account_Record",
      regions: [
        {
          name: "main",
          components: [
            { name: "a:one", label: "One", supported: true, halfWidth: false, visibility: "shown", properties: {}, source: { region: "main", path: [{ component: "a:one", identifier: "one", index: 0 }] } },
            { name: "a:two", label: "Two", supported: true, halfWidth: false, visibility: "shown", properties: {}, source: { region: "main", path: [{ component: "a:two", identifier: "two", index: 1 }] } },
          ],
        },
      ],
    } as unknown as PublishedPage;
    const model = { regions: [{ name: "main", facet: false, items: [{ key: "one", component: "a:one", identifier: "one", properties: {}, facets: [] }] }] };
    expect(alignFlexiPage(page, model)).toBeNull();
    const { aligned, gone } = alignFlexiPagePartial(page, model);
    expect([...aligned.values()]).toEqual(["one"]);
    expect(gone).toBe(1);
  });
});
