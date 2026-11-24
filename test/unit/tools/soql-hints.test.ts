import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFieldHintCache,
  describeText,
  fieldHintForError,
  fromObject,
  objectForFieldError,
} from "../../../src/tools/soql-hints.js";
import type { SObjectDescribeResult } from "../../../src/salesforce/cli.js";

const field = (name: string, extra: Partial<SObjectDescribeResult["fields"][number]> = {}) => ({
  name,
  label: name,
  type: "string",
  required: false,
  updateable: true,
  createable: true,
  ...extra,
});

const PTA: SObjectDescribeResult = {
  name: "ProductTerritoryAvailability",
  label: "Product Territory Availability",
  fields: [
    field("Id", { type: "id" }),
    field("Name"),
    field("ProductId", {
      type: "reference",
      referenceTo: ["Product2"],
      relationshipName: "Product",
    }),
    field("Status", {
      type: "picklist",
      picklistValues: [
        { value: "Draft" },
        { value: "Queued" },
        { value: "Active" },
        { value: "Old", active: false },
      ],
    }),
    field("OwnerId", {
      type: "reference",
      referenceTo: ["Group", "User"],
      relationshipName: "Owner",
    }),
  ],
};

describe("objectForFieldError", () => {
  it("reads the entity from a No such column error", () => {
    const err =
      "ERROR at Row:1:Column:8\nNo such column 'Product2Id' on entity 'ProductTerritoryAvailability'.";
    expect(objectForFieldError(err, "SELECT Product2Id FROM X")).toBe(
      "ProductTerritoryAvailability"
    );
  });

  it("falls back to the FROM object for a relationship error", () => {
    const err = "Didn't understand relationship 'Product2' in field path.";
    expect(objectForFieldError(err, "SELECT Product2.Name FROM ProductTerritoryAvailability")).toBe(
      "ProductTerritoryAvailability"
    );
  });

  it("ignores errors that aren't about field names", () => {
    expect(objectForFieldError("invalid ID field: PTA-1", "SELECT Id FROM X")).toBeNull();
    expect(objectForFieldError("REQUEST_LIMIT_EXCEEDED", "SELECT Id FROM X")).toBeNull();
  });

  it("skips subqueries when finding FROM", () => {
    expect(
      fromObject("SELECT Id, (SELECT Id FROM Children) FROM Parent WHERE Id IN (SELECT A FROM B)")
    ).toBe("Parent");
  });
});

describe("fieldHintForError", () => {
  beforeEach(() => clearFieldHintCache());

  it("appends the object's fields and lookups, describing once per object", async () => {
    const describe = vi.fn(async () => ({ success: true, data: PTA }));
    const err = "No such column 'Product2Id' on entity 'ProductTerritoryAvailability'.";
    const hint = await fieldHintForError(
      err,
      "SELECT Product2Id FROM ProductTerritoryAvailability",
      "org",
      describe
    );
    expect(hint).toContain("Id, Name, Status");
    expect(hint).toContain("ProductId → Product2 (as Product.…)");
    expect(hint).toContain("Owner can point to several objects");
    expect(hint).toContain("don't guess");
    await fieldHintForError(
      err,
      "SELECT Product2Id FROM ProductTerritoryAvailability",
      "org",
      describe
    );
    expect(describe).toHaveBeenCalledTimes(1);
  });

  it("explains a polymorphic lookup error without a describe", async () => {
    const describe = vi.fn();
    const hint = await fieldHintForError(
      "No such column 'ManagerId' on entity 'Name'.",
      "SELECT Owner.ManagerId FROM Quote",
      "org",
      describe
    );
    expect(hint).toMatch(/several objects .*User/);
    expect(describe).not.toHaveBeenCalled();
  });

  it("returns nothing when the describe fails or the error is unrelated", async () => {
    const failing = vi.fn(async () => ({ success: false, error: "nope" }));
    expect(await fieldHintForError("INVALID_FIELD: x", "SELECT x FROM Y", "org", failing)).toBe("");
    expect(await fieldHintForError("timeout", "SELECT x FROM Y", "org", failing)).toBe("");
  });
});

describe("describeText", () => {
  it("shows active picklist values and lookup targets", () => {
    const text = describeText(PTA);
    expect(text).toContain("| Status | Status | picklist | No | Yes | Draft, Queued, Active |");
    expect(text).toContain(
      "| ProductId | ProductId | reference | No | Yes | Product2 (as Product) |"
    );
  });

  it("filters to the named fields, case-insensitively, and names the missing ones", () => {
    const text = describeText(PTA, ["status", "Product2Id"]);
    expect(text).toContain("## Fields (1 of 5)");
    expect(text).toContain("| Status |");
    expect(text).not.toContain("| Name |");
    expect(text).toContain("**Not on ProductTerritoryAvailability:** Product2Id");
  });

  it("names the fields past the first 100 instead of hiding them", () => {
    const many = { ...PTA, fields: Array.from({ length: 105 }, (_, i) => field(`F${i}`)) };
    const text = describeText(many);
    expect(text).toContain("**Other fields (5):** F100, F101, F102, F103, F104");
    expect(text).not.toContain("| F100 |");
    expect(describeText(many, ["F104"])).toContain("| F104 |");
  });
});
