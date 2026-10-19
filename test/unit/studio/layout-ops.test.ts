import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyLayoutOps, inheritsActionList, StaleLayoutError } from "../../../src/studio/metadata/layout-ops.js";
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

  it("puts back a lookup's relatedObjects entry the org drops when its field is removed", () => {
    const withRelated = parseXml(xml.replace("    <relatedLists>", "    <relatedObjects>Type</relatedObjects>\n    <relatedLists>"));
    const removed = applyLayoutOps(withRelated, [{ op: "removeField", field: "Type" }]);
    expect(removed.inverse[0]).toMatchObject({ op: "addField", field: "Type", relatedObject: true });
    // The org drops the entry on deploy, so the edit drops it too and undo restores it.
    expect(childrenNamed(removed.root, "relatedObjects")).toHaveLength(0);
    const back = applyLayoutOps(removed.root, removed.inverse);
    expect(serializeXml(back.root)).toContain("<relatedObjects>Type</relatedObjects>");
    expect(childrenNamed(back.root, "relatedObjects")).toHaveLength(1);
    // A layout without the entry doesn't get one.
    expect(applyLayoutOps(root, [{ op: "removeField", field: "Type" }]).inverse[0]).not.toHaveProperty("relatedObject");
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

describe("layout action ops (platformActionList)", () => {
  const names = (r: XmlNode) =>
    childrenNamed(r, "platformActionList").flatMap((l) => childrenNamed(l, "platformActionListItems").map((i) => childText(i, "actionName")));
  const sortOrders = (r: XmlNode) =>
    childrenNamed(r, "platformActionList").flatMap((l) => childrenNamed(l, "platformActionListItems").map((i) => childText(i, "sortOrder")));
  const first = names(root)[0];

  it("adds an action at the end and renumbers sortOrder", () => {
    const { root: r, changes, inverse } = applyLayoutOps(root, [{ op: "addAction", action: "Account.Studio_Test", before: null }]);
    const all = names(r);
    expect(all.at(-1)).toBe("Account.Studio_Test");
    expect(sortOrders(r)).toEqual(all.map((_, i) => String(i)));
    expect(changes[0].after).toBe(`Position ${all.length} of ${all.length}`);
    expect(inverse).toEqual([{ op: "removeAction", action: "Account.Studio_Test" }]);
    expect(serializeXml(applyLayoutOps(r, inverse).root)).toBe(xml);
  });

  it("adds in front of another action", () => {
    const { root: r } = applyLayoutOps(root, [{ op: "addAction", action: "Account.Studio_Test", before: first! }]);
    expect(names(r)[0]).toBe("Account.Studio_Test");
    expect(names(r)[1]).toBe(first);
  });

  it("removes an action and the inverse puts it back where it was", () => {
    const target = names(root)[1]!;
    const forward = applyLayoutOps(root, [{ op: "removeAction", action: target }]);
    expect(names(forward.root)).not.toContain(target);
    expect(forward.inverse[0]).toMatchObject({ op: "addAction", action: target, before: names(root)[2] });
    expect(serializeXml(applyLayoutOps(forward.root, forward.inverse).root)).toBe(xml);
  });

  it("refuses duplicates, unknown targets and bad names", () => {
    expect(() => applyLayoutOps(root, [{ op: "addAction", action: first!, before: null }])).toThrow(StaleLayoutError);
    expect(() => applyLayoutOps(root, [{ op: "addAction", action: "Account.X", before: "Account.Nope" }])).toThrow(StaleLayoutError);
    expect(() => applyLayoutOps(root, [{ op: "removeAction", action: "Account.Nope" }])).toThrow(StaleLayoutError);
    expect(() => applyLayoutOps(root, [{ op: "addAction", action: "bad name<", before: null }])).toThrow();
  });

  it("creates the list when the layout has none and the inverse drops it again", () => {
    const bare = parseXml(xml.replace(/<platformActionList>[\s\S]*?<\/platformActionList>\s*/, ""));
    expect(inheritsActionList(bare)).toBe(true);
    const bareXml = serializeXml(bare);
    const forward = applyLayoutOps(bare, [{ op: "addAction", action: "Account.Studio_Test", before: null }]);
    expect(names(forward.root)).toEqual(["Account.Studio_Test"]);
    expect(inheritsActionList(forward.root)).toBe(false);
    expect(forward.changes[0].before).toMatch(/global publisher layout/);
    expect(forward.inverse).toEqual([{ op: "removeAction", action: "Account.Studio_Test", dropList: true }]);
    expect(serializeXml(applyLayoutOps(forward.root, forward.inverse).root)).toBe(bareXml);
  });
});
