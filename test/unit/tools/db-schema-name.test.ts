import { describe, expect, it } from "vitest";
import { normalizeDbSchemaName } from "../../../src/tools/helpers.js";

describe("normalizeDbSchemaName", () => {
  it("adds the prefix to a short name", () => {
    expect(normalizeDbSchemaName("Visit")).toBe("DbSchema_Visit");
  });

  it("keeps a full name whatever the prefix's case", () => {
    expect(normalizeDbSchemaName("DbSchema_Visit")).toBe("DbSchema_Visit");
    expect(normalizeDbSchemaName("dbSchema_PresentationContent")).toBe("dbSchema_PresentationContent");
  });
});
