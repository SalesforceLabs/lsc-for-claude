import { describe, it, expect } from "vitest";
import { accountWhere, chipCount, formatAddress, formatVisitDate, groupLists, sortLabel, specialtyLines } from "../../../../src/studio/screens/accounts.js";

describe("chipCount", () => {
  it("shows up to four digits, then 999+", () => {
    expect(chipCount(0)).toBe("0");
    expect(chipCount(34)).toBe("34");
    expect(chipCount(9999)).toBe("9999");
    expect(chipCount(10000)).toBe("999+");
  });
});

describe("sortLabel", () => {
  it("joins names and puts two spaces before the arrow", () => {
    expect(sortLabel(["Name"])).toBe("Sort by: Name  ↑");
    expect(sortLabel(["Name", "City"], false)).toBe("Sort by: Name, City  ↓");
  });
});

describe("formatVisitDate", () => {
  const fmt = { timeZone: "America/Los_Angeles", locale: "en-US" };
  it("formats in the viewer's zone with a narrow no-break space before AM/PM", () => {
    expect(formatVisitDate("2026-08-06T18:19:00.000+0000", fmt)).toBe("Thu, Aug 6, 2026 at 11:19 AM");
    expect(formatVisitDate("2026-05-05T19:46:00.000+0000", fmt)).toBe("Tue, May 5, 2026 at 12:46 PM");
  });
  it("falls back to -- for a bad date", () => {
    expect(formatVisitDate("nope", fmt)).toBe("--");
  });
});

describe("formatAddress", () => {
  it("orders street, postal code, city, state, country and skips blanks", () => {
    expect(formatAddress({ Street: "1st Street", PostalCode: "94105", City: "San Francisco", State: "California", Country: "United States" })).toBe(
      "1st Street, 94105, San Francisco, California, United States"
    );
    expect(formatAddress({ Street: "1 Main", City: "Reno", State: null })).toBe("1 Main, Reno");
    expect(formatAddress({})).toBe("--");
  });
});

describe("specialtyLines", () => {
  it("handles none, one, two and many values", () => {
    expect(specialtyLines(null)).toEqual(["--"]);
    expect(specialtyLines("Specialist")).toEqual(["Specialist"]);
    expect(specialtyLines("A | B")).toEqual(["A,", "B"]);
    expect(specialtyLines("A | B | C | D")).toEqual(["A,", "B,", "+2"]);
  });
  it("cuts values past 16 characters to 13 plus an ellipsis", () => {
    expect(specialtyLines("Cardiovascular Surgery")).toEqual(["Cardiovascula..."]);
    expect(specialtyLines("Exactly sixteen!")).toEqual(["Exactly sixteen!"]);
  });
});

describe("groupLists", () => {
  const lists = [
    { name: "zeta", ownerId: "005AAAAAAAAAAAA" },
    { name: "Alpha", ownerId: null },
    { name: "beta", ownerId: "005AAAAAAAAAAAAAAA" },
    { name: "Shared one", ownerId: "005OTHER0000000" },
  ];
  it("splits own (or ownerless) from shared and sorts case-insensitively", () => {
    const g = groupLists(lists, "005AAAAAAAAAAAAAAA");
    expect(g.own.map((l) => l.name)).toEqual(["Alpha", "beta", "zeta"]);
    expect(g.shared.map((l) => l.name)).toEqual(["Shared one"]);
  });
});

describe("accountWhere", () => {
  it("combines the sync filter with an extra condition", () => {
    expect(accountWhere("")).toBe("");
    expect(accountWhere("Id IN (1)")).toBe(" WHERE Id IN (1)");
    expect(accountWhere("", "RecordType.IsPersonType = true")).toBe(" WHERE RecordType.IsPersonType = true");
    expect(accountWhere("a = 1", "b = 2")).toBe(" WHERE a = 1 AND b = 2");
  });
});
