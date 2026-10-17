import { describe, expect, it } from "vitest";
import { actionLabel, formatValue, isEditable, isFieldReadable, menuActions, parseInlineCard, relatedKey } from "../../../../src/studio/screens/record.js";
import { gridWidths, highlightWidths } from "../../../../src-renderer/components/studio/IpadRecord";

const fmt = { timeZone: "UTC", locale: "en-US" };

describe("relatedKey", () => {
  it("maps a child relationship name to Child.Field", () => {
    const children = [{ relationshipName: "Visitors", childSObject: "Visitor", field: "VisitId" }];
    expect(relatedKey(children, "Visitors")).toBe("Visitor.VisitId");
    expect(relatedKey(children, "Nope")).toBeNull();
  });
});

describe("isEditable", () => {
  const base = { object: "Visit", status: "Planned", ownerId: "u1", viewerId: "u1", hasEditAccess: true, updateable: true };
  it("allows the owner of an open visit", () => expect(isEditable(base)).toBe(true));
  it("refuses Completed, signed, not-owned, no access", () => {
    expect(isEditable({ ...base, status: "Completed" })).toBe(false);
    expect(isEditable({ ...base, signed: true })).toBe(false);
    expect(isEditable({ ...base, ownerId: "u2" })).toBe(false);
    expect(isEditable({ ...base, hasEditAccess: false })).toBe(false);
    expect(isEditable({ ...base, updateable: false })).toBe(false);
  });
  it("does not apply visit rules to other objects", () => expect(isEditable({ ...base, object: "Account", status: "Completed", ownerId: "u2" })).toBe(true));
});

describe("menu actions", () => {
  it("drops Edit, Unlock and ChangeOwner", () => {
    expect(menuActions(["Visit.Edit", "Visit.lsc4ce__Email", "Visit.Unlock", "ChangeOwnerOne"])).toEqual(["Visit.lsc4ce__Email"]);
  });
  it("labels actions", () => expect(actionLabel("Visit.lsc4ce__LogCall")).toBe("Log Call"));
});

describe("parseInlineCard", () => {
  const html = `<lightning-card title="Compliance"><div class="slds-size_1-of-2"><p class="field-label">Status</p><p class="field-value">{c.status}</p></div></lightning-card>`;
  const js = `status: getFieldValue(rec, "Visit.Status")`;
  it("reads title and cells", () => {
    expect(parseInlineCard(html, js)).toEqual({ title: "Compliance", object: "Visit", cells: [{ label: "Status", field: "Status", half: true }] });
  });
  it("returns null when not a card", () => expect(parseInlineCard("<div/>", js)).toBeNull());
});

describe("formatValue", () => {
  it("blanks empties and maps picklist labels", () => {
    expect(formatValue(null, { type: "text" }, undefined, fmt)).toBe("");
    expect(formatValue("A;B", { type: "multipicklist", picklist: { A: "Alpha", B: "Beta" } }, undefined, fmt)).toBe("Alpha; Beta");
  });
  it("prints addresses", () => {
    expect(formatValue({ street: "1 Main", city: "Austin", state: "TX", postalCode: "78701", country: "US" }, { type: "address" }, undefined, fmt)).toBe("1 Main Austin, TX 78701 US");
  });
});

describe("layout math", () => {
  it("highlights fill the width evenly", () => {
    const w = highlightWidths([{ label: "a", value: "b" }, { label: "c", value: "d" }], () => 10);
    expect(w).toEqual([590, 590]);
  });
  it("grid widths add 50 then share the rest up to max", () => {
    expect(gridWidths([{ title: "T", cells: ["x"] }, { title: "U", cells: [] }], 300, () => 10)).toEqual([150, 150]);
  });
});

describe("isFieldReadable", () => {
  const perms = new Map([["secret__c", false], ["open__c", true]]);
  it("follows the merged permission row", () => {
    expect(isFieldReadable({ name: "Open__c", permissionable: true }, perms)).toBe(true);
    expect(isFieldReadable({ name: "Secret__c", permissionable: true }, perms)).toBe(false);
  });
  it("treats a permissionable field with no row as unreadable", () => expect(isFieldReadable({ name: "RecordType_Name__c", permissionable: true }, perms)).toBe(false));
  it("keeps non-permissionable fields (Name, Id, required) with no row", () => expect(isFieldReadable({ name: "Name", permissionable: false }, perms)).toBe(true));
  it("filters nothing without permissions data", () => expect(isFieldReadable({ name: "X__c", permissionable: true }, null)).toBe(true));
});

describe("detail-panel dates", () => {
  it("prints the short style on the record and keeps lists medium", () => {
    expect(formatValue("1974-03-05", { type: "date" }, undefined, fmt, true)).toBe("3/5/74");
    expect(formatValue("2026-09-01T10:13:00.000+0000", { type: "datetime" }, undefined, fmt, true)).toBe("9/1/26, 10:13 AM");
    expect(formatValue("1974-03-05", { type: "date" }, undefined, fmt)).toBe("Mar 5, 1974");
  });
});

describe("gridWidths (iOS GridLayout)", () => {
  it("sizes a column by its longest string by character count", () => {
    expect(gridWidths([{ title: "ab", cells: ["abcdef", "xy"] }], 0, (t) => t.length * 10)).toEqual([110]);
  });
});
