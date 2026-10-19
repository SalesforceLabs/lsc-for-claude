import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/salesforce/cli.js", () => ({
  retrieveMetadata: vi.fn(),
  cachedDescribeSObject: vi.fn(),
}));

const cli = await import("../../src/salesforce/cli.js");
const { relatedListBlock, insertRelatedList, recordNameField } = await import("../../src/salesforce/visit-layout.js");

describe("new sidebar related list block", () => {
  it("uses the given name field and excludes only New", () => {
    const block = relatedListBlock("Gadgets__r", "Title");
    expect(block).toContain("<fields>Title</fields>");
    expect(block).toContain("<excludeButtons>New</excludeButtons>");
    expect(block).toContain("<relatedList>Gadgets__r</relatedList>");
    expect(block).not.toContain("MassDeleteAll");
    expect(block).not.toContain("<fields>NAME</fields>");
  });

  it("falls back to NAME only when no field is known", () => {
    expect(relatedListBlock("Gadgets__r")).toContain("<fields>NAME</fields>");
  });

  it("inserts before </Layout> and refuses odd names", () => {
    expect(insertRelatedList("<Layout>\n</Layout>", "Visitors", "Name")).toMatch(/<fields>Name<\/fields>[\s\S]*<\/Layout>$/);
    expect(() => relatedListBlock("Bad</relatedList>")).toThrow();
    expect(() => relatedListBlock("Visitors", "x</fields>")).toThrow();
  });

  it("reads the record-name field from the child's describe", async () => {
    vi.mocked(cli.cachedDescribeSObject).mockResolvedValueOnce({
      success: true,
      data: { name: "Assessment", label: "A", fields: [{ name: "Id" }, { name: "Name", nameField: true }] },
    } as never);
    expect(await recordNameField("Assessment", "org")).toBe("Name");
    vi.mocked(cli.cachedDescribeSObject).mockRejectedValueOnce(new Error("boom"));
    expect(await recordNameField("Assessment", "org")).toBeUndefined();
    vi.mocked(cli.cachedDescribeSObject).mockResolvedValueOnce({ success: false, error: "x" } as never);
    expect(await recordNameField("Assessment", "org")).toBeUndefined();
  });
});
