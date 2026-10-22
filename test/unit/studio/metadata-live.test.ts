import { describe, it, expect } from "vitest";
import { availableFields, layoutObject, relatedListOptions } from "../../../src/studio/metadata/live.js";
import type { SObjectDescribeResult } from "../../../src/salesforce/cli.js";

const field = (name: string, type = "string", extra: Partial<SObjectDescribeResult["fields"][number]> = {}) => ({
  name,
  label: name.replace(/__c$/, "").replace(/_/g, " "),
  type,
  required: false,
  updateable: true,
  createable: true,
  ...extra,
});

const account: SObjectDescribeResult = {
  name: "Account",
  label: "Account",
  fields: [
    field("Id", "id"),
    field("Name"),
    field("FirstName", "string", { compoundFieldName: "Name" }),
    field("BillingAddress", "address"),
    field("BillingStreet", "textarea", { compoundFieldName: "BillingAddress" }),
    field("Type", "picklist"),
    field("CreatedDate", "datetime"),
    field("SystemModstamp", "datetime"),
    field("PersonEmail", "email"),
    field("Specialty__pc", "picklist"),
    field("Old__c", "string", { deprecatedAndHidden: true }),
    field("Tier__c", "picklist"),
  ],
  childRelationships: [
    { childSObject: "Contact", relationshipName: "Contacts", field: "AccountId" },
    { childSObject: "Opportunity", relationshipName: "Opportunities", field: "AccountId" },
    { childSObject: "Sample_Request__c", relationshipName: "Sample_Requests__r", field: "Account__c" },
    { childSObject: "Inquiry", relationshipName: "Inquiries__r", field: "Account__c" },
    { childSObject: "AccountShare", relationshipName: "Shares", field: "AccountId" },
    { childSObject: "AccountFeed", relationshipName: "Feeds", field: "ParentId" },
    { childSObject: "Task", relationshipName: null, field: "WhatId" },
  ],
};

describe("live layout options", () => {
  it("names the layout's object", () => {
    expect(layoutObject("PersonAccount-HCP Layout")).toBe("Account");
    expect(layoutObject("Visit-ns__Visit Layout")).toBe("Visit");
  });

  it("offers fields not on the layout, without system fields or compound parts", () => {
    const person = availableFields("PersonAccount-HCP Layout", account, new Set(["Name", "Type"])).map((f) => f.field);
    expect(person).toEqual(["BillingAddress", "PersonEmail", "Specialty__pc", "Tier__c"]);
    // A business account layout can't hold person-account fields.
    const business = availableFields("Account-Account Layout", account, new Set(["Name"])).map((f) => f.field);
    expect(business).toEqual(["BillingAddress", "Tier__c", "Type"]);
  });

  it("offers child relationships by the name the layout XML uses", () => {
    const options = relatedListOptions(account, ["Contacts", "Inquiry.Account__c"]);
    expect(options.map((o) => o.relatedList)).toEqual(["Sample_Request__c.Account__c", "Opportunities"]);
    expect(options[0]).toMatchObject({ object: "Sample_Request__c", relationshipName: "Sample_Requests__r" });
  });

  it("keeps only relationships in the org's layoutable list when it gives one", () => {
    const layoutable = new Set(["Contacts", "Sample_Requests__r"]);
    expect(relatedListOptions(account, [], layoutable).map((o) => o.relatedList)).toEqual(["Sample_Request__c.Account__c", "Contacts"]);
    // No list from the org: the describe's own.
    expect(relatedListOptions(account, [], null)).toHaveLength(4);
    expect(relatedListOptions(account, [], undefined)).toHaveLength(4);
  });
});
