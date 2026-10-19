import { describe, expect, it } from "vitest";
import { decodeLayoutName, fallbackPath, setupPath } from "../../../src/studio/setup-links.js";
import { itemSetupLink } from "../../../src-renderer/components/studio/setup-link";
import { SETUP } from "../../../src-renderer/components/studio/edit-targets";

describe("setupPath", () => {
  it("opens a page layout by Id", () => {
    expect(setupPath({ type: "layout", object: "Visit", name: "x" }, "00hHn00000iSvXpIAK")).toBe(
      "/lightning/setup/ObjectManager/Visit/PageLayouts/00hHn00000iSvXpIAK/view"
    );
  });
  it("opens a field, compact layout, record type and validation rule", () => {
    expect(setupPath({ type: "field", object: "Visit", field: "Status" }, "Status")).toBe("/lightning/setup/ObjectManager/Visit/FieldsAndRelationships/Status/view");
    expect(setupPath({ type: "compactLayout", object: "Visit", name: "x" }, "0AHHn000001hK1wOAE")).toBe("/lightning/setup/ObjectManager/Visit/CompactLayouts/0AHHn000001hK1wOAE/view");
    expect(setupPath({ type: "recordType", object: "Visit", name: "x" }, "012Hn000000HDYXIA4")).toBe("/lightning/setup/ObjectManager/Visit/RecordTypes/012Hn000000HDYXIA4/view");
    expect(setupPath({ type: "validationRule", object: "Account", id: "x" }, "03dXX")).toBe("/lightning/setup/ObjectManager/Account/ValidationRules/03dXX/view");
  });
  it("opens Lightning pages, list views and records", () => {
    expect(setupPath({ type: "flexiPage", name: "x" }, "0M0Hn000000FUDdKAO")).toBe("/visualEditor/appBuilder.app?pageId=0M0Hn000000FUDdKAO");
    expect(setupPath({ type: "listView", object: "Account", name: "x" }, "00BHn00000LGN5FMAX")).toBe("/lightning/o/Account/list?filterName=00BHn00000LGN5FMAX");
    expect(setupPath({ type: "territory", id: "0MIxx" }, "0MIxx")).toBe("/lightning/r/Territory2/0MIxx/view");
    expect(setupPath({ type: "record", sobject: "Visit", id: "x" }, "0abXX")).toBe("/lightning/r/Visit/0abXX/view");
  });
  it("wraps classic detail pages", () => {
    expect(setupPath({ type: "apexTrigger", id: "01qXX" }, "01qXX")).toBe("/lightning/setup/ApexTriggers/page?address=%2F01qXX");
    expect(setupPath({ type: "profile", id: "00eXX" }, "00eXX")).toBe("/lightning/setup/EnhancedProfiles/page?address=%2F00eXX");
    expect(setupPath({ type: "permissionSet", id: "0PSXX" }, "0PSXX")).toBe("/lightning/setup/PermSets/page?address=%2F0PSXX");
    expect(setupPath({ type: "user", id: "005XX" }, "005XX")).toBe("/lightning/setup/ManageUsers/page?address=%2F005XX%3Fnoredirect%3D1");
  });
});

describe("fallbackPath", () => {
  it("falls back to the list page", () => {
    expect(fallbackPath({ type: "layout", object: "Visit", name: "x" })).toBe("/lightning/setup/ObjectManager/Visit/PageLayouts/view");
    expect(fallbackPath({ type: "flexiPage", name: "x" })).toBe("/lightning/setup/FlexiPageList/home");
    expect(fallbackPath({ type: "apexTrigger", id: "x" })).toBe("/lightning/setup/ApexTriggers/home");
    expect(fallbackPath({ type: "flow", id: "x" })).toBe("/lightning/setup/Flows/home");
  });
});

describe("decodeLayoutName", () => {
  it("strips only the object prefix and decodes", () => {
    expect(decodeLayoutName("Visit-LSDO PH FSR Visit Layout", "Visit")).toBe("LSDO PH FSR Visit Layout");
    expect(decodeLayoutName("Account-Account %28Marketing%29 Layout", "Account")).toBe("Account (Marketing) Layout");
    expect(decodeLayoutName("My-Layout", "Visit")).toBe("My-Layout");
  });
});

describe("renderer links", () => {
  it("builds refs for inspector buttons", () => {
    expect(SETUP.pageLayouts("Visit", "Visit-X Layout").ref).toMatchObject({ type: "layout", object: "Visit" });
    expect(SETUP.fields("Visit", "Status").ref).toEqual({ type: "field", object: "Visit", field: "Status" });
  });
  it("links board items", () => {
    const base = { id: "i", label: "L", properties: {} as Record<string, string> };
    expect(itemSetupLink({ ...base, detailKind: "apexTrigger" })?.ref).toEqual({ type: "apexTrigger", id: "i" });
    expect(itemSetupLink({ ...base, detailKind: "layout" })).toBeNull();
    expect(itemSetupLink({ ...base, detailKind: "layout", properties: { Object: "Visit" } })?.path).toBe("/lightning/setup/ObjectManager/Visit/PageLayouts/view");
    expect(itemSetupLink(base)).toBeNull();
  });
});
