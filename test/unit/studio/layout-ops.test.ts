import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyLayoutOps, StaleLayoutError } from "../../../src/studio/metadata/layout-ops.js";
import { childText, childrenNamed, parseXml, serializeXml, type XmlNode } from "../../../src/studio/metadata/xml.js";
import type { LayoutOp } from "../../../src/studio/types.js";

const xml = readFileSync(join(__dirname, "../../fixtures/metadata/PersonAccount-HCP_Layout.layout-meta.xml"), "utf8");
const root = parseXml(xml);

const ACCOUNT = { label: "Account Information", nth: 0 };
const ADDITIONAL = { label: "Additional Information", nth: 0 };

const sectionLabels = (r: XmlNode) => childrenNamed(r, "layoutSections").map((s) => childText(s, "label"));
const column = (r: XmlNode, section: number, col: number) =>
  childrenNamed(childrenNamed(childrenNamed(r, "layoutSections")[section], "layoutColumns")[col], "layoutItems").map((i) =>
    childText(i, "field")
  );
const related = (r: XmlNode) => childrenNamed(r, "relatedLists").map((l) => childText(l, "relatedList"));

/** Applying the ops then their inverse gives back the retrieved file, byte for byte. */
function roundTrip(ops: LayoutOp[]) {
  const forward = applyLayoutOps(root, ops);
  const back = applyLayoutOps(forward.root, forward.inverse);
  expect(serializeXml(back.root)).toBe(xml);
  return forward;
}

describe("layout ops", () => {
  it("moves a field to another column and back", () => {
    const { root: r, changes } = roundTrip([
      { op: "moveField", field: "Type", to: { section: ACCOUNT, column: 1, before: "PersonBirthdate" } },
    ]);
    expect(column(r, 0, 0)).toEqual(["Name", "LSDO_Account_Identifier__c"]);
    expect(column(r, 0, 1)).toEqual(["Type", "PersonBirthdate", "PersonGenderIdentity"]);
    expect(changes[0]).toEqual({
      field: "Field Type",
      before: "Account Information, column 1, row 2",
      after: "Account Information, column 2, row 1",
    });
  });

  it("moves a field within its column, to the end", () => {
    const { root: r } = roundTrip([{ op: "moveField", field: "Name", to: { section: ACCOUNT, column: 0, before: null } }]);
    expect(column(r, 0, 0)).toEqual(["Type", "LSDO_Account_Identifier__c", "Name"]);
  });

  it("adds a field to an empty column and removes one, keeping its XML for undo", () => {
    const { root: r, inverse } = roundTrip([
      { op: "removeField", field: "Type" },
      { op: "addField", field: "Phone", behavior: "Required", to: { section: ADDITIONAL, column: 1, before: null } },
    ]);
    expect(column(r, 0, 0)).toEqual(["Name", "LSDO_Account_Identifier__c"]);
    expect(column(r, 1, 1)).toEqual(["Phone"]);
    expect(inverse[0]).toEqual({ op: "removeField", field: "Phone" });
    expect(inverse[1]).toMatchObject({ op: "addField", field: "Type", xml: expect.stringContaining("<field>Type</field>") });
  });

  it("changes a field's behavior, refusing when it isn't what the map saw", () => {
    const { changes } = roundTrip([{ op: "setFieldBehavior", field: "Name", from: "Required", to: "Readonly" }]);
    expect(changes[0]).toMatchObject({ before: "Required", after: "Read only" });
    expect(() => applyLayoutOps(root, [{ op: "setFieldBehavior", field: "Name", from: "Edit", to: "Readonly" }])).toThrow(
      StaleLayoutError
    );
  });

  it("moves, removes and re-adds sections", () => {
    const { root: r } = roundTrip([
      { op: "moveSection", section: { label: "Custom Links", nth: 0 }, before: ACCOUNT },
      { op: "removeSection", section: { label: "Description Information", nth: 0 } },
    ]);
    expect(sectionLabels(r)).toEqual(["Custom Links", "Account Information", "Additional Information"]);
  });

  it("shows or hides a section heading", () => {
    const { root: r } = roundTrip([{ op: "setSectionHeading", section: ADDITIONAL, from: true, to: false }]);
    expect(childText(childrenNamed(r, "layoutSections")[1], "detailHeading")).toBe("false");
  });

  it("moves, removes and adds related lists", () => {
    const { root: r } = roundTrip([
      { op: "moveRelatedList", relatedList: "Visits", before: "ContactPointAddresses" },
      { op: "removeRelatedList", relatedList: "ContactPointSocials" },
      { op: "addRelatedList", relatedList: "Opportunities", before: null, object: "Opportunity" },
    ]);
    const names = related(r);
    expect(names.slice(0, 3)).toEqual(["Visits", "ContactPointAddresses", "ContactPointEmails"]);
    expect(names).not.toContain("ContactPointSocials");
    expect(names.at(-1)).toBe("Opportunities");
    // The new list sits right after the last one, before the layout's show* settings.
    const tags = r.children.map((c) => c.tag);
    expect(tags.lastIndexOf("relatedLists")).toBeLessThan(tags.indexOf("showEmailCheckbox"));
  });

  it("refuses targets that aren't on the layout", () => {
    const stale = (op: LayoutOp) => expect(() => applyLayoutOps(root, [op])).toThrow(StaleLayoutError);
    stale({ op: "removeField", field: "Nope__c" });
    stale({ op: "addField", field: "Name", behavior: "Edit", to: { section: ACCOUNT, column: 0, before: null } });
    stale({ op: "moveSection", section: { label: "Account Information", nth: 1 }, before: null });
    stale({ op: "addRelatedList", relatedList: "Visits", before: null });
    stale({ op: "moveField", field: "Name", to: { section: ACCOUNT, column: 0, before: "PersonBirthdate" } });
  });

  it("rejects names that aren't API names", () => {
    expect(() => applyLayoutOps(root, [{ op: "removeField", field: "Name</field>" }])).toThrow(/Invalid/);
  });

  it("leaves the input tree alone", () => {
    applyLayoutOps(root, [{ op: "removeField", field: "Name" }]);
    expect(serializeXml(root)).toBe(xml);
  });
});
