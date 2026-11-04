import { describe, expect, it } from "vitest";
import {
  ATTENDEE_GROUP_CAP,
  MAX_CUSTOM_SECTIONS,
  MAX_SECTIONS,
  attendeeGroups,
  buildSections,
  detailBadges,
  detailOptions,
  detailSubtitle,
  hcoOff,
  lotOptions,
  productsFor,
  relatedObject,
  strictestSignatureLevel,
} from "../../../../src-renderer/components/studio/visit/sections/logic";
import {
  addRow,
  removeRow,
  seedRows,
  setValue,
} from "../../../../src-renderer/components/studio/visit/sections/rows";
import type { SectionProduct } from "../../../../src-renderer/components/studio/visit/sections/types";

const rl = (object: string, label = object) => ({ name: `${object}.ProviderVisitId`, label });

describe("buildSections", () => {
  it("follows the layout's related-list order", () => {
    const s = buildSections({
      related: [rl("ProductDisbursement", "Samples"), rl("ProviderVisitProdDetailing", "Details")],
    });
    expect(s.map((x) => x.id)).toEqual(["samples", "details"]);
    expect(s[0].title).toBe("Samples");
  });

  it("leaves out sections whose related list isn't on the layout or the viewer can't create and edit", () => {
    const s = buildSections({
      related: [rl("ProviderVisitProdDetailing"), rl("ProductDisbursement")],
      permissions: { ProductDisbursement: { create: true, edit: false } },
    });
    expect(s.map((x) => x.id)).toEqual(["details"]);
  });

  it("gives a child visit only its five sections and no custom lists", () => {
    const s = buildSections({
      childVisit: true,
      related: [
        rl("ProviderVisitProdDetailing"),
        rl("Visit", "Attendees"),
        rl("AssessmentTask"),
        rl("Thing__c"),
        rl("ProviderVisitRqstSample"),
      ],
    });
    expect(s.map((x) => x.id)).toEqual(["details", "dtp"]);
  });

  it("caps custom lists at two and everything at ten", () => {
    const customs = ["A__c", "B__c", "C__c"].map((o) => rl(o));
    expect(buildSections({ related: customs }).filter((x) => x.id === "custom")).toHaveLength(
      MAX_CUSTOM_SECTIONS
    );
    const many = Array.from({ length: 14 }, (_, i) => rl(`Obj${i}__c`));
    const all = buildSections({
      related: [
        rl("ProviderVisitProdDetailing"),
        rl("ProviderVisitDtlProductMsg"),
        rl("ProviderVisitProdDiscussion"),
        rl("ProductDisbursement"),
        rl("ProviderVisitRqstSample"),
        rl("ProviderVisitMarketingItem"),
        rl("Visit"),
        rl("AssessmentTask"),
        ...many,
      ],
    });
    expect(all.length).toBeLessThanOrEqual(MAX_SECTIONS);
  });

  it("dims product sections for an organisation without a listed type", () => {
    const s = buildSections({
      related: [rl("ProductDisbursement"), rl("ProviderVisitProdDetailing")],
      hcoOff: true,
    });
    expect(s.find((x) => x.id === "samples")?.dimmed).toBe(true);
    expect(s.find((x) => x.id === "details")?.dimmed).toBe(false);
  });

  it("matches the real Visit layout (peter-lsc-260-trial) in its order", () => {
    const names = [
      "ProviderVisit",
      "PresentationForum",
      "VisitProdDetailings",
      "VisitDtlProductMsgs",
      "VisitProdDiscussions",
      "VisitRqstSamples",
      "ProductDisbursement",
      "VisitMarketingItems",
      "Visitors",
      "ParentVisits",
      "Inquiry",
      "Expense",
    ];
    const s = buildSections({ related: names.map((name) => ({ name, label: name })) });
    expect(s.map((x) => x.id)).toEqual(["clm", "details", "dtp", "samples", "items", "attendees"]);
  });

  it("matches the metadata cache's Object.Field form (LSDO PH FSR Visit Layout) and titles by its labels", () => {
    const cache = [
      ["PresentationForum.ForumReferenceId", "Content"],
      ["ProviderVisitProdDetailing.VisitId", "Product Messages"],
      ["ProviderVisitDtlProductMsg.VisitId", "Provider Visit Detailing Product Messages"],
      ["ProviderVisitProdDiscussion.VisitId", "Provider Visit Product Discussions"],
      ["ProductDisbursement.VisitId", "Samples"],
      ["ProviderVisitRqstSample.VisitId", "Drop Ship Samples"],
      ["ProviderVisitMarketingItem.VisitId", "Leave-Behinds"],
      ["ProviderVisit.VisitId", "Provider Visits"],
      ["Visit.ParentVisitId", "Child Visits"],
      ["Visitor.VisitId", "Visitors"],
      ["Inquiry.ReferenceRecordId", "Inquiries"],
      ["AttachedContentDocument.LinkedEntityId", "Files"],
    ].map(([name, label]) => ({ name, label }));
    const s = buildSections({ related: cache });
    expect(s.map((x) => x.id)).toEqual(["clm", "details", "samples", "dtp", "items", "attendees"]);
    expect(s.find((x) => x.id === "items")?.title).toBe("Leave-Behinds");
    expect(s.find((x) => x.id === "attendees")?.title).toBe("Attendees");
  });

  it("titles a card by the layout label, empty when there is none; Attendees and Compliance Activity are fixed", () => {
    const s = buildSections({
      related: [
        { name: "VisitProdDetailings", label: "VisitProdDetailings" },
        { name: "ParentVisits", label: "Child Visits" },
        { name: "AssessmentTasks", label: "Tasks" },
      ],
    });
    expect(s.map((x) => x.title)).toEqual(["", "Attendees", "Compliance Activity"]);
    expect(s.map((x) => x.menu)).toEqual([true, true, false]);
  });

  it("never offers messages or discussions as cards", () => {
    const s = buildSections({
      related: [
        { name: "VisitDtlProductMsgs", label: "Msgs" },
        { name: "VisitProdDiscussions", label: "Disc" },
      ],
    });
    expect(s).toEqual([]);
  });

  it("finds Attendees by its label when the related list isn't named Visit", () => {
    const s = buildSections({ related: [{ name: "Visits__r", label: "Attendees" }] });
    expect(s.map((x) => x.id)).toEqual(["attendees"]);
  });
});

describe("helpers", () => {
  it("relatedObject strips the field", () => expect(relatedObject("A.B")).toBe("A"));

  it("hcoOff", () => {
    const settings = { hcoTypesForSamplesAndItems: ["Hospital"] };
    expect(hcoOff(false, "Clinic", settings)).toBe(false);
    expect(hcoOff(true, "Clinic", settings)).toBe(true);
    expect(hcoOff(true, "hospital", settings)).toBe(false);
  });

  const p = (id: string, extra: Partial<SectionProduct> = {}): SectionProduct => ({
    id,
    name: id,
    ...extra,
  });

  it("splits products by kind and falls back to all for details", () => {
    const ps = [
      p("a", { distribution: "Direct to Physician" }),
      p("b", { specification: "Sample" }),
      p("c", { specification: "Promotional Item" }),
    ];
    expect(productsFor("dtp", ps).map((x) => x.id)).toEqual(["a"]);
    expect(productsFor("sample", ps).map((x) => x.id)).toEqual(["b"]);
    expect(productsFor("item", ps).map((x) => x.id)).toEqual(["c"]);
    expect(productsFor("detail", [p("z")]).map((x) => x.id)).toEqual(["z"]);
  });

  it("strictestSignatureLevel", () => {
    const ps = [
      p("a", { signatureLevel: "Optional" }),
      p("b", { signatureLevel: "Required" }),
      p("c", { signatureLevel: "None" }),
    ];
    const rows = {
      X: [{ values: { ProductId: "a" } }, { values: { ProductId: "c" } }],
      Y: [{ values: { ProductId: "b" } }],
    };
    expect(strictestSignatureLevel(rows, ps)).toBe("Required");
    expect(strictestSignatureLevel({ X: [{ values: { ProductId: "zzz" } }] }, ps)).toBeUndefined();
  });

  it("strictestSignatureLevel reads the org's NotRequired / Optional / Mandatory spelling", () => {
    const ps = [
      p("a", { signatureLevel: "Optional" }),
      p("b", { signatureLevel: "Mandatory" }),
      p("c", { signatureLevel: "NotRequired" }),
    ];
    expect(
      strictestSignatureLevel(
        { X: [{ values: { ProductId: "a" } }, { values: { ProductId: "b" } }] },
        ps
      )
    ).toBe("Mandatory");
    expect(
      strictestSignatureLevel(
        { X: [{ values: { ProductId: "c" } }, { values: { ProductId: "a" } }] },
        ps
      )
    ).toBe("Optional");
  });

  it("detail subtitle, badges and recent filter", () => {
    expect(detailSubtitle({ indication: "Asthma", therapeuticArea: "Respiratory" })).toBe(
      "Asthma • Respiratory"
    );
    expect(
      detailBadges({ IsOffLabel: "true", IsGeneratedFromPresentation: "true" }, 1, {
        discussOffLabelProducts: true,
      }).map((b) => b.text)
    ).toEqual(["#2", "Off Label", "From Intelligent Content"]);
    expect(
      detailBadges({ IsOffLabel: "true" }, 0, { discussOffLabelProducts: false }).map((b) => b.text)
    ).toEqual(["#1"]);
    const ps = [p("a"), p("b")];
    expect(detailOptions(ps, { showRecentSidebar: true }, ["b"]).map((x) => x.id)).toEqual(["b"]);
    expect(detailOptions(ps, { showRecentSidebar: false }, ["b"])).toHaveLength(2);
  });

  it("lot options: None unless a batch number is required, expired only when shown", () => {
    const batches = [
      { id: "1", productItemId: "i", lot: "L1", expires: "2030-01-01" },
      { id: "2", productItemId: "i", lot: "L2", expires: "2020-01-01" },
      { id: "3", productItemId: "other", lot: "L3" },
    ];
    expect(
      lotOptions(
        "i",
        batches,
        { requireBatchNumber: false, showExpiredBatches: false },
        "2026-01-01"
      ).map((l) => l.label)
    ).toEqual(["None", "L1"]);
    expect(
      lotOptions(
        "i",
        batches,
        { requireBatchNumber: true, showExpiredBatches: true },
        "2026-01-01"
      ).map((l) => l.label)
    ).toEqual(["L1", "L2"]);
  });
});

describe("attendeeGroups", () => {
  const acct = (id: string, extra = {}) => ({
    id,
    name: id,
    person: true,
    affiliated: [] as string[],
    ...extra,
  });
  it("groups by address, affiliation, other; skips self and attendees; caps each at five", () => {
    const pool = [
      acct("me", { addressKey: "x|1", affiliated: ["aff"] }),
      ...Array.from({ length: 7 }, (_, i) => acct(`s${i}`, { addressKey: "x|1" })),
      acct("aff"),
      acct("o1"),
      acct("o2"),
    ];
    const g = attendeeGroups(pool, "me", ["o2"]);
    expect(g.map((x) => x.title)).toEqual(["Same Address", "Affiliated", "Other"]);
    expect(g[0].accounts).toHaveLength(ATTENDEE_GROUP_CAP);
    expect(g[1].accounts.map((a) => a.id)).toEqual(["aff"]);
    expect(g[2].accounts.map((a) => a.id)).toEqual(["o1"]);
  });
});

describe("rows", () => {
  it("adds, edits and removes; removing a detailing row takes its messages along", () => {
    let rows = addRow({}, "ProviderVisitProdDetailing", { ProductId: "p" }, "d1");
    rows = addRow(rows, "ProviderVisitDtlProductMsg", { ProviderVisitProductDtlId: "d1" }, "m1");
    rows = addRow(rows, "ProviderVisitDtlProductMsg", { ProviderVisitProductDtlId: "d2" }, "m2");
    rows = setValue(rows, "ProviderVisitProdDetailing", "d1", "IsOffLabel", "true");
    expect(rows.ProviderVisitProdDetailing[0].values.IsOffLabel).toBe("true");
    rows = removeRow(rows, "ProviderVisitProdDetailing", "d1");
    expect(rows.ProviderVisitProdDetailing).toEqual([]);
    expect(rows.ProviderVisitDtlProductMsg.map((r) => r.id)).toEqual(["m2"]);
  });

  it("seeds an edited visit's rows and a new visit's none", () => {
    const data = {
      children: { v1: { ProductDisbursement: [{ id: "s", values: { QuantityDisbursed: "2" } }] } },
    } as never;
    expect(seedRows(data, "v1").ProductDisbursement[0].values.QuantityDisbursed).toBe("2");
    expect(seedRows(data, undefined)).toEqual({});
  });
});
