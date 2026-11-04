import { describe, expect, it } from "vitest";
import {
  copyDetails,
  endFromStart,
  fieldLocked,
  headerFields,
  missingCompliance,
  navState,
  recordTypeOptions,
  levelRank,
} from "../../../../src-renderer/components/studio/visit/structure/logic";

const f = (name: string, extra = {}) => ({ name, label: name, type: "string", ...extra });

describe("visit structure logic", () => {
  it("puts account, place and planned times first, required, and hides the device's hidden fields", () => {
    const out = headerFields(
      [
        f("VisitId"),
        f("Subject"),
        f("PlannedVisitEndTime"),
        f("AccountId"),
        f("PlaceId"),
        f("PlannedVisitStartTime"),
        f("ParentOrganizationId"),
        f("RecordTypeId"),
      ],
      { organisation: true, isNew: false }
    );
    expect(out.map((x) => x.name)).toEqual([
      "AccountId",
      "PlaceId",
      "PlannedVisitStartTime",
      "PlannedVisitEndTime",
      "Subject",
    ]);
    expect(out.slice(0, 4).every((x) => x.required)).toBe(true);
  });
  it("offers the record type field only on create", () => {
    expect(headerFields([f("RecordTypeId")], { organisation: false, isNew: true })).toHaveLength(1);
  });
  it("locks status and territory, and account, place and record type once signed", () => {
    expect(fieldLocked("Status", false)).toBe(true);
    expect(fieldLocked("AccountId", false)).toBe(false);
    expect(fieldLocked("PlaceId", true)).toBe(true);
  });
  it("limits record types by the account's record type", () => {
    const map = [
      { accountRecordType: "Professional", visitRecordType: "Detail", sort: 1 },
      { accountRecordType: "Organization", visitRecordType: "Meeting", sort: 2 },
    ];
    expect(recordTypeOptions(map, "Professional", ["Detail", "Meeting"])).toEqual(["Detail"]);
    expect(recordTypeOptions([], "Professional", ["Detail", "Meeting"])).toEqual([
      "Detail",
      "Meeting",
    ]);
    expect(recordTypeOptions(map, "Other", ["Detail", "Meeting"])).toEqual(["Detail", "Meeting"]);
  });
  it("ends a visit at start plus the default duration", () => {
    expect(endFromStart(new Date(2026, 0, 1, 9, 0), 45).getMinutes()).toBe(45);
  });
  it("reads the signature level", () => {
    expect(levelRank("Required")).toBe(2);
    expect(levelRank("optional")).toBe(1);
    expect(levelRank("None")).toBe(0);
    expect(levelRank(undefined)).toBe(0);
  });
  it("hides Get Signature on a completed visit and titles a child", () => {
    const base = { isNew: false, remote: false, child: false, showDocumentId: true };
    expect(navState({ ...base, status: "Completed" }).getSignature).toBe(false);
    expect(navState({ ...base, status: "Planned" }).getSignature).toBe(true);
    expect(navState({ ...base, child: true }).title).toBe("Attendee Visit Engagement");
    expect(navState({ ...base, isNew: true }).leftLabel).toBe("Cancel");
  });
  it("enables Get Signature and Submit by the signature level", () => {
    const base = { isNew: false, remote: false, child: false, showDocumentId: true };
    const none = navState({ ...base });
    expect(none.signEnabled).toBe(false);
    expect(none.submitEnabled).toBe(true);
    const must = navState({ ...base, level: "Required" });
    expect(must.signEnabled).toBe(true);
    expect(must.submitEnabled).toBe(false);
    const signed = navState({ ...base, level: "Required", signed: true });
    expect(signed.signEnabled).toBe(false);
    expect(signed.submitEnabled).toBe(true);
    expect(navState({ ...base, level: "Optional" }).submitEnabled).toBe(true);
  });
  it("lists unticked required statements", () => {
    const defs = [
      { id: "1", label: "A", required: true, sort: 1 },
      { id: "2", label: "B", required: false, sort: 2 },
    ];
    expect(missingCompliance(defs, {})).toEqual(["A"]);
    expect(missingCompliance(defs, { "1": true })).toEqual([]);
  });
  it("copies details but not identity", () => {
    expect(copyDetails({ AccountId: "x", Subject: "s" }, { AccountId: "y" })).toEqual({
      AccountId: "y",
      Subject: "s",
    });
  });
});
