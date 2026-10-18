import { describe, it, expect } from "vitest";
import { visitFields, visitTimes, picklistStart, autoNumber } from "../../../../src-renderer/components/studio/ipad-visit-form";
import type { PublishedLayout, RecordFieldSpec } from "../../../../src-renderer/components/studio/published-types";
import { defaultPlace, licenseBadge } from "../../../../src/studio/screens/fabs.js";

const f = (name: string, type = "string", extra: Partial<RecordFieldSpec> = {}): RecordFieldSpec => ({ name, label: name, type, ...extra });
const layout = (sections: { label: string | null; fields: RecordFieldSpec[][] }[]): PublishedLayout => ({
  name: "L",
  sections: sections.map((s) => ({ label: s.label, columns: [], fields: s.fields })),
  relatedLists: [],
  actions: [],
});

describe("visitFields", () => {
  const visit = layout([
    {
      label: null,
      fields: [
        [f("AccountId", "lookup"), f("PlannedVisitStartTime", "datetime"), f("TerritoryId", "lookup"), f("Channel", "picklist")],
        [f("PlaceId", "lookup"), f("PlannedVisitEndTime", "datetime"), f("Status", "picklist"), f("Call_type__c", "picklist")],
      ],
    },
  ]);
  const provider = layout([
    {
      label: "Provider Visit Information",
      fields: [
        [f("AccountId", "lookup"), f("Channel", "picklist"), f("NextPrvdVisitObjectiveType", "picklist"), f("Num_Details__c", "summary")],
        [f("IsConfirmed", "boolean"), f("VisitId", "masterdetail"), f("ProvVisitProdDtlCount", "double")],
      ],
    },
    { label: "System Information", fields: [[f("Name"), f("External_ID__c")], [f("OwnerId", "lookup"), f("RecordTypeId", "reference")]] },
  ]);

  it("lists the four hardcoded fields first, then the merged layouts row by row, dropping hidden, summary and repeated fields", () => {
    expect(visitFields([visit, provider]).map((s) => s.name)).toEqual([
      "AccountId",
      "PlaceId",
      "PlannedVisitStartTime",
      "PlannedVisitEndTime",
      "TerritoryId",
      "Status",
      "Channel",
      "Call_type__c",
      "IsConfirmed",
      "ProvVisitProdDtlCount",
      "OwnerId",
      "Name",
      "RecordTypeId",
      "External_ID__c",
    ]);
  });

  it("forces required and read-only like the editor", () => {
    const by = Object.fromEntries(visitFields([visit, provider]).map((s) => [s.name, s]));
    expect(by.PlannedEndTime).toBeUndefined();
    expect(by.PlannedVisitEndTime.required).toBe(true);
    expect(by.RecordTypeId.required).toBe(true);
    expect(by.TerritoryId.readOnly).toBe(true);
    expect(by.Status.readOnly).toBe(true);
    expect(by.Channel.required).toBeUndefined();
  });
});

describe("visitFields edit mode and blank filler", () => {
  const l = layout([{ label: null, fields: [[f("Channel", "picklist"), f("Num_Details__c", "summary"), f("Name")], [f("Call_type__c", "picklist")]] }]);
  it("keeps rollup summaries only for an existing record", () => {
    expect(visitFields([l]).map((s) => s.name)).not.toContain("Num_Details__c");
    expect(visitFields([l], { edit: true }).map((s) => s.name)).toContain("Num_Details__c");
  });
  it("leaves an uneven last row without a trailing blank", () => {
    const odd = layout([{ label: null, fields: [[f("Channel", "picklist"), f("Name")], [f("Call_type__c", "picklist")]] }]);
    const out = visitFields([odd], { edit: true });
    expect(out.length % 2).toBe(1);
    expect(out.some((x) => x.type === "blank")).toBe(false);
  });
});

describe("autoNumber", () => {
  it("zero-pads the first half and ends with the temporary star", () => {
    const n = autoNumber("ABCDEFGH-1234-5678-9ABC-DEF012345678");
    expect(n).toMatch(/^00000\d{4}\*$/);
  });
  it("is stable for a seed and follows the field's display format", () => {
    expect(autoNumber("AAAA")).toBe(autoNumber("AAAA"));
    expect(autoNumber("X", "V-{0000}")).toMatch(/^V-\d{4}\*$/);
  });
});

describe("visitTimes", () => {
  const now = new Date(2026, 9, 17, 12, 41, 37);
  it("starts at the current minute and ends a default duration later", () => {
    const { start, end } = visitTimes(now, 30, false);
    expect(start?.getMinutes()).toBe(41);
    expect(start?.getSeconds()).toBe(0);
    expect(end?.getTime()).toBe(new Date(2026, 9, 17, 13, 11).getTime());
  });
  it("leaves both blank when the org asks for a blank start", () => {
    expect(visitTimes(now, 30, true)).toEqual({ start: null, end: null });
  });
});

describe("picklistStart", () => {
  it("uses the record type's default value, as its label", () => {
    expect(picklistStart(f("Call_type__c", "picklist"), { Call_type__c: "Promotional" })).toBe("Promotional");
    expect(picklistStart(f("Call_type__c", "picklist", { picklist: { P: "Promo" } }), { Call_type__c: "P" })).toBe("Promo");
    expect(picklistStart(f("Channel", "picklist"), { Call_type__c: "Promotional" })).toBeUndefined();
  });
});

describe("defaultPlace", () => {
  const a = { Id: "a", IsPrimary: false, LastModifiedDate: "2026-01-03" };
  const b = { Id: "b", IsPrimary: true, LastModifiedDate: "2026-01-01" };
  const c = { Id: "c", IsPrimary: true, LastModifiedDate: "2026-01-02" };
  it("prefers the territory info's preferred address, then the newest primary, then the newest address", () => {
    expect(defaultPlace([a, b, c], ["b"])?.Id).toBe("b");
    expect(defaultPlace([a, b, c], [])?.Id).toBe("c");
    expect(defaultPlace([a], [])?.Id).toBe("a");
    expect(defaultPlace([], [])).toBeUndefined();
  });
});

describe("licenseBadge", () => {
  it("has no badge when its setting is off, red without a validated license, green with one", () => {
    expect(licenseBadge(false, { IsLicenseValidated: true }, "")).toBeUndefined();
    expect(licenseBadge(true, undefined, "")).toBe("invalid");
    expect(licenseBadge(true, { IsLicenseValidated: true }, "")).toBe("valid");
    expect(licenseBadge(true, { IsLicenseValidated: true, SLN_Validation__c: false }, "SLN_Validation__c")).toBe("invalid");
  });
});
