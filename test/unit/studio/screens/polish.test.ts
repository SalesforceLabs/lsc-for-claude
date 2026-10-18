import { describe, it, expect } from "vitest";
import { paceAxis } from "../../../../src/studio/screens/home.js";
import { searchCardActions } from "../../../../src/studio/screens/chrome.js";
import { cardMenu } from "../../../../src-renderer/components/studio/screens/accounts-logic.js";

const NY = { timeZone: "America/New_York", locale: "en-US" };

describe("paceAxis", () => {
  it("runs a calendar-year cycle in local days with Jan/Apr/Jul/Oct ticks and an unlabeled last tick", () => {
    const a = paceAxis(new Date("2026-01-01T05:00:00Z"), new Date("2027-01-01T04:59:59Z"), new Date("2026-10-17T15:00:00Z"), NY);
    expect(a.days).toBe(365);
    expect(a.today).toBe(289);
    expect(a.ticks.map((t) => t.label)).toEqual(["Jan", "Apr", "Jul", "Oct", ""]);
    expect(a.ticks.map((t) => t.index)).toEqual([0, 90, 181, 273, 364]);
  });
  it("clamps today into the cycle", () => {
    const a = paceAxis(new Date("2026-01-01T05:00:00Z"), new Date("2026-03-01T05:00:00Z"), new Date("2027-01-01T05:00:00Z"), NY);
    expect(a.today).toBe(a.days - 1);
  });
});

describe("card menu", () => {
  const all = [
    { label: "b", actionName: "NewVisit", location: "Search", profiles: "Rep;Mgr", recordTypes: "", sortOrder: 2 },
    { label: "a", actionName: "NewMedicalInquiry", location: "search", profiles: "Rep", recordTypes: "Person_HCP", sortOrder: 1 },
    { label: "c", actionName: "NewVisit", location: "Home", profiles: "Rep", recordTypes: "", sortOrder: 0 },
    { label: "d", actionName: "NewVisit", location: "Search", profiles: "Other", recordTypes: "", sortOrder: 0 },
  ];
  it("keeps the viewer's profile's Search actions by sort order", () => {
    const r = searchCardActions(all, "Rep");
    expect(r.every((x) => x.name.length > 0)).toBe(true);
    expect(r.length).toBeLessThanOrEqual(2);
  });
  it("filters by the account's record type", () => {
    const acts = [
      { label: "Any", recordTypes: [] },
      { label: "HCP", recordTypes: ["Person_HCP"] },
      { label: "HCO", recordTypes: ["Org"] },
    ];
    expect(cardMenu(acts, "Person_HCP")).toEqual(["Any", "HCP"]);
    expect(cardMenu(acts, undefined)).toEqual(["Any", "HCP", "HCO"]);
  });
});
