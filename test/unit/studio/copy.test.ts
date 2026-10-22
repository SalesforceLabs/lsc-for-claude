import { describe, it, expect } from "vitest";
import {
  flexiPageCopyName,
  isFlexiPageName,
  layoutAssignmentFile,
  layoutAssignmentsOf,
  layoutCopyName,
  profileFullName,
  profileXmlName,
  reassignLayout,
  reassignPage,
  restorePage,
} from "../../../src/studio/metadata/copy.js";
import { parseXml, serializeXml } from "../../../src/studio/metadata/xml.js";

const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <layoutAssignments>
        <layout>Account-HCP Layout</layout>
    </layoutAssignments>
    <layoutAssignments>
        <layout>Account-HCP Layout</layout>
        <recordType>Account.HCP</recordType>
    </layoutAssignments>
    <layoutAssignments>
        <layout>Account-HCO Layout</layout>
        <recordType>Account.HCO</recordType>
    </layoutAssignments>
    <layoutAssignments>
        <layout>Contact-Contact Layout</layout>
    </layoutAssignments>
    <userLicense>Salesforce</userLicense>
</Profile>
`;

const APP = `<?xml version="1.0" encoding="UTF-8"?>
<CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionOverrides>
        <actionName>View</actionName>
        <content>Page_A</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
    </actionOverrides>
    <actionOverrides>
        <actionName>View</actionName>
        <content>Page_A</content>
        <formFactor>Small</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
    </actionOverrides>
    <label>LSC Field Sales</label>
    <profileActionOverrides>
        <actionName>View</actionName>
        <content>Page_A</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
        <profile>LS%20Rep</profile>
    </profileActionOverrides>
    <profileActionOverrides>
        <actionName>View</actionName>
        <content>Page_A</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
        <profile>Admin</profile>
    </profileActionOverrides>
    <tabs>standard-Account</tabs>
</CustomApplication>
`;

describe("copy names", () => {
  it("names a layout copy after the layout and the profile, on the same object", () => {
    expect(layoutCopyName("Account-HCP Layout", "LS Rep")).toEqual({ fullName: "Account-HCP Layout - LS Rep", label: "HCP Layout - LS Rep" });
    expect(layoutCopyName("PersonAccount-Person%20Account%20Layout", "System Administrator").label).toBe("Person Account Layout - System Administrator");
  });

  it("strips characters a layout name can't hold and keeps long names within the limit without cutting an escape", () => {
    const copy = layoutCopyName("Account-" + "Very%20Long%20Name%28x%29".repeat(6), "LS: Rep/Field");
    expect(copy.fullName.endsWith(" - LS RepField")).toBe(true);
    expect(copy.fullName.length - "Account-".length).toBeLessThanOrEqual(80);
    expect(copy.fullName).not.toMatch(/%[0-9A-Fa-f]? - /);
    expect(() => layoutCopyName("NoDash", "P")).toThrow();
  });

  it("names a Lightning page copy with a valid developer name", () => {
    const copy = flexiPageCopyName("Account__LSC_Page", "LS Rep (Field)", "Account HCP page");
    expect(copy).toEqual({ fullName: "Account_LSC_Page_LS_Rep_Field", label: "Account HCP page (LS Rep (Field))" });
    expect(isFlexiPageName(copy.fullName)).toBe(true);
    const long = flexiPageCopyName("A".repeat(78), "LS Rep", "x");
    expect(long.fullName.length).toBeLessThanOrEqual(80);
    expect(isFlexiPageName(long.fullName)).toBe(true);
  });

  it("maps profile names to their Metadata API and override spellings", () => {
    expect(profileFullName("System Administrator")).toBe("Admin");
    expect(profileFullName("LS PH Field Sales Representative")).toBe("LS PH Field Sales Representative");
    expect(profileXmlName("LS Rep")).toBe("LS%20Rep");
    expect(profileXmlName("System Administrator")).toBe("Admin");
  });
});

describe("page layout assignments", () => {
  it("lists a profile's assignments of a layout, by record type", () => {
    expect(layoutAssignmentsOf(parseXml(PROFILE), "Account-HCP Layout")).toEqual([null, "Account.HCP"]);
    expect(layoutAssignmentsOf(parseXml(PROFILE), "Nope")).toEqual([]);
  });

  it("re-points only the entries of the layout, leaving every other byte as it was", () => {
    const { root, moves } = reassignLayout(parseXml(PROFILE), "Account-HCP Layout", "Account-HCP Layout - LS Rep");
    expect(moves).toEqual([{ recordType: null }, { recordType: "Account.HCP" }]);
    expect(serializeXml(root)).toBe(PROFILE.replaceAll("<layout>Account-HCP Layout</layout>", "<layout>Account-HCP Layout - LS Rep</layout>"));
  });

  it("can move just some record types, and puts them back", () => {
    const { root, moves } = reassignLayout(parseXml(PROFILE), "Account-HCP Layout", "Copy", ["Account.HCP"]);
    expect(moves).toEqual([{ recordType: "Account.HCP" }]);
    expect(layoutAssignmentsOf(root, "Account-HCP Layout")).toEqual([null]);
    const back = reassignLayout(root, "Copy", "Account-HCP Layout");
    expect(serializeXml(back.root)).toBe(PROFILE);
  });

  it("deploys a Profile holding only the moved assignments", () => {
    const { moves } = reassignLayout(parseXml(PROFILE), "Account-HCP Layout", "Copy");
    const file = serializeXml(layoutAssignmentFile(parseXml(PROFILE), "Copy", moves));
    expect(file.match(/<layoutAssignments>/g)).toHaveLength(2);
    expect(file).toContain("<layout>Copy</layout>");
    expect(file).toContain("<recordType>Account.HCP</recordType>");
    expect(file).not.toContain("userLicense");
    expect(file).not.toContain("HCO");
    expect(file).toContain('xmlns="http://soap.sforce.com/2006/04/metadata"');
  });
});

describe("Lightning page overrides", () => {
  it("re-points the profile's own large-screen override and nothing else", () => {
    const { root, move } = reassignPage(parseXml(APP), "LS Rep", "Page_A", "Page_A_Copy");
    expect(move).toEqual({});
    const out = serializeXml(root);
    const i = APP.indexOf("<profile>LS%20Rep</profile>");
    const before = APP.lastIndexOf("<content>Page_A</content>", i);
    expect(out).toBe(APP.slice(0, before) + "<content>Page_A_Copy</content>" + APP.slice(before + "<content>Page_A</content>".length));
  });

  it("matches a standard profile by its API name", () => {
    const { move, root } = reassignPage(parseXml(APP), "System Administrator", "Page_A", "Copy");
    expect(move).toEqual({});
    expect(serializeXml(root)).toContain("<content>Copy</content>");
  });

  it("adds an override for the profile when the app's default is the page, and removes it again", () => {
    const { root, move } = reassignPage(parseXml(APP), "LS Field", "Page_A", "Page_A_Copy");
    expect(move).toEqual({ added: true });
    const out = serializeXml(root);
    expect(out.match(/<profileActionOverrides>/g)).toHaveLength(3);
    expect(out).toContain("<profile>LS%20Field</profile>");
    // Only the large-screen default gets an override; the small-screen one is untouched.
    expect(out.match(/<content>Page_A_Copy<\/content>/g)).toHaveLength(1);
    const back = restorePage(root, "LS Field", "Page_A_Copy", "Page_A", true);
    expect(back.changed).toBe(true);
    expect(serializeXml(back.root)).toBe(APP);
  });

  it("restores a re-pointed override", () => {
    const { root } = reassignPage(parseXml(APP), "LS Rep", "Page_A", "Copy");
    const back = restorePage(root, "LS Rep", "Copy", "Page_A", false);
    expect(back.changed).toBe(true);
    expect(serializeXml(back.root)).toBe(APP);
    expect(restorePage(parseXml(APP), "LS Rep", "Copy", "Page_A", false).changed).toBe(false);
  });

  it("does nothing in an app that doesn't give the profile the page", () => {
    expect(reassignPage(parseXml(APP), "LS Rep", "Other_Page", "Copy").move).toBeNull();
  });
});
