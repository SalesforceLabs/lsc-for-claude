import { describe, expect, it } from "vitest";
import { actionLabel, formatValue, isEditable, menuActions, parseInlineCard, relatedKey } from "../../../../src/studio/screens/record.js";
import { gridWidths, highlightWidths, menuActions as rendererMenuActions } from "../../../../src-renderer/components/studio/IpadRecord";

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
    expect(rendererMenuActions(["Edit", "Visit.lsc4ce__Email"]).map((a) => a.label)).toEqual(["Email"]);
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
