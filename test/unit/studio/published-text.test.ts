import { describe, it, expect } from "vitest";
import {
  readTranslation,
  lookupLabel,
  tabTextOrigin,
  fieldTextOrigin,
  sectionTextOrigin,
  relatedTextOrigin,
  recordTabTextOrigin,
  picklistLabel,
  recordTypeLabel,
  translatedRegion,
  translatedChild,
  NO_TRANSLATION,
} from "../../../src/studio/published-text.js";

// Shapes as in a real cache's translations/de.json.
const de = readTranslation(
  {
    labels: {
      lsc4ce__ratings: { fullName: "lsc4ce__ratings", language: "de", value: "Bewertungen" },
      lsc4ce__Dashboard: { fullName: "lsc4ce__Dashboard", language: "de", value: "Dashboard" },
      Visit_Notes: { fullName: "Visit_Notes", language: "en_US", value: "Visit notes" },
      Empty_One: { fullName: "Empty_One", language: "de", value: "" },
    },
    tabs: { "standard-Account": { label: "Accounts DE" }, "lsc4ce__Planner": { label: "" } },
    objects: {
      Account: {
        object: "Account",
        label: "Konto",
        labelPlural: "Konten",
        nameFieldLabel: "Kontoname",
        recordTypes: [
          { name: "Business_Account", label: "" },
          { name: "HCP", label: "Arzt" },
        ],
        fields: [
          { name: "Specialty__c", label: "Fachrichtung", picklistValues: [{ masterLabel: "Oncology", translation: "Onkologie" }, { masterLabel: "Cardio", translation: "" }] },
          { name: "Rating", label: "" },
        ],
        layouts: [
          {
            layoutName: "Account-HCP Layout",
            sections: [{ section: "Information", label: "Informationen" }, { section: "System", label: "" }],
            relatedLists: [{ relatedList: "RelatedContactList", relatedListLabel: "Kontakte" }],
          },
        ],
      },
    },
    standardValueSets: {
      LeadSource: { valueTranslation: [{ masterLabel: "Web", translation: "Internet" }, { masterLabel: "Partner", translation: "" }] },
    },
    flexiPages: {
      lsc4ce__AccountHCP: {
        items: [
          { type: "Region", name: "header", items: [{ componentName: "force:highlightsPanel" }] },
          {
            type: "Region",
            name: "main",
            items: [{ items: [{ title: "Dashboard" }, { title: "Standard.Tab.detail" }, { title: "Bewertungen" }, {}] }],
          },
        ],
        tabs: { "{!$Label.lsc4ce__ratings}": "{!$Label.lsc4ce__ratings}", Overview: "Übersicht" },
      },
    },
  },
  "de"
);

describe("readTranslation", () => {
  it("keeps only non-empty values and lowercases label names", () => {
    expect(de.tabs).toEqual({ "standard-Account": { label: "Accounts DE" } });
    expect(de.fields.Account.labels).toEqual({ Specialty__c: "Fachrichtung" });
    expect(de.fields.Account.picklists).toEqual({ Specialty__c: { Oncology: "Onkologie" } });
    expect(de.objects.Account).toEqual({ label: "Konto", labelPlural: "Konten", recordTypes: { HCP: "Arzt" } });
    expect(de.layouts["Account-HCP Layout"].sections).toEqual({ Information: "Informationen" });
    expect(de.valueSets.LeadSource).toEqual({ Web: "Internet" });
    expect(Object.keys(de.labels)).toEqual(["lsc4ce__ratings", "lsc4ce__dashboard", "visit_notes"]);
  });
});

describe("lookupLabel", () => {
  it("tries the LSC namespace first, then the bare name, case-insensitively", () => {
    expect(lookupLabel(de, "Ratings")?.value).toBe("Bewertungen");
    expect(lookupLabel(de, "visit_notes")?.value).toBe("Visit notes");
    expect(lookupLabel(de, "Empty_One")).toBeNull();
  });
});

describe("tabTextOrigin", () => {
  it("uses the translation, else the tab label, else the name", () => {
    expect(tabTextOrigin(de, "standard-Account", "Accounts")).toMatchObject({ shown: "Accounts DE", used: 0 });
    expect(tabTextOrigin(de, "lsc4ce__Planner", "Planner")).toMatchObject({ shown: "Planner", used: 1 });
    const none = tabTextOrigin(de, "X", "");
    expect(none.shown).toBe("X");
    expect(none.used).toBe(none.steps.length - 1);
  });
});

describe("fieldTextOrigin", () => {
  it("prefers the translated label over the describe", () => {
    expect(fieldTextOrigin(de, "Account", "Specialty__c", "Specialty", "")).toMatchObject({ shown: "Fachrichtung", used: 0 });
    expect(fieldTextOrigin(de, "Account", "Rating", "Rating", "")).toMatchObject({ shown: "Rating", used: 1 });
  });
  it("has the app's fixed labels", () => {
    expect(fieldTextOrigin(de, "Account", "RecordTypeId", "Kontotyp", "").shown).toBe("Record Type");
    expect(fieldTextOrigin(de, "Account", "Name", "Account Name", "").shown).toBe("Kontoname");
    expect(fieldTextOrigin(de, "Case", "Type", "Case Type", "").shown).toBe("Type");
    expect(fieldTextOrigin(NO_TRANSLATION, "Account", "Type", "Account Type", "").shown).toBe("Account Type");
  });
});

describe("sectionTextOrigin and relatedTextOrigin", () => {
  it("translates a section, else spaces out an API-like label", () => {
    expect(sectionTextOrigin(de, "Account-HCP Layout", { label: "Information" })).toMatchObject({ shown: "Informationen", used: 0 });
    expect(sectionTextOrigin(de, "Account-HCP Layout", { label: "AddressInfo" })).toMatchObject({ shown: "Address Info", used: 1 });
    expect(sectionTextOrigin(de, "Account-HCP Layout", { label: "AddressInfo", customLabel: true }).shown).toBe("AddressInfo");
  });
  it("translates a related list, else its layout label", () => {
    expect(relatedTextOrigin(de, "Account-HCP Layout", { relatedList: "RelatedContactList", label: "Contacts" }).shown).toBe("Kontakte");
    expect(relatedTextOrigin(de, "Account-HCP Layout", { relatedList: "Visits__r", label: "Visits" })).toMatchObject({ shown: "Visits", used: 1 });
  });
});

describe("recordTabTextOrigin", () => {
  const region = translatedRegion(de, "lsc4ce__AccountHCP", { type: "Region", name: "main" });
  const tabset = translatedChild(region, 0);

  it("matches translation items by region and position", () => {
    expect(translatedChild(tabset, 2)).toEqual({ title: "Bewertungen" });
    expect(recordTabTextOrigin(de, "lsc4ce__AccountHCP", "{!$Label.lsc4ce__ratings}", translatedChild(tabset, 2))).toMatchObject({ shown: "Bewertungen", used: 0 });
  });

  it("falls back to the raw title when the item has no title", () => {
    expect(recordTabTextOrigin(de, "lsc4ce__AccountHCP", "Notes", translatedChild(tabset, 3))).toMatchObject({ shown: "Notes", used: 1 });
  });

  it("uses the tabs map without an item, then resolves a $Label reference", () => {
    expect(recordTabTextOrigin(de, "lsc4ce__AccountHCP", "Overview", null).shown).toBe("Übersicht");
    const ref = recordTabTextOrigin(de, "lsc4ce__AccountHCP", "{!$Label.lsc4ce__ratings}", null);
    expect(ref.shown).toBe("Bewertungen");
    expect(ref.steps[ref.used].source).toBe("Custom label lsc4ce__ratings");
  });

  it("shows a missing label's name, and flags an untranslated one", () => {
    expect(recordTabTextOrigin(NO_TRANSLATION, "P", "{!$Label.c.Nope}", null).shown).toBe("c.Nope");
    const fallback = recordTabTextOrigin(de, "P", "{!$Label.Visit_Notes}", null);
    expect(fallback.shown).toBe("Visit notes");
    expect(fallback.labelFallback).toEqual({ key: "Visit_Notes", language: "en_US" });
  });

  it("names standard tabs from custom labels, English by default", () => {
    expect(recordTabTextOrigin(de, "P", "Standard.Tab.detail", null)).toMatchObject({ shown: "Details", used: 1 });
    const withLabel = readTranslation({ labels: { Details: { language: "de", value: "Einzelheiten" } } }, "de");
    expect(recordTabTextOrigin(withLabel, "P", "Standard.Tab.detail", null)).toMatchObject({ shown: "Einzelheiten", used: 0 });
  });
});

describe("picklistLabel and recordTypeLabel", () => {
  it("translates by master label, falling back to the value set", () => {
    expect(picklistLabel(de, "Account", "Specialty__c", null, "Oncology")).toBe("Onkologie");
    expect(picklistLabel(de, "Account", "Specialty__c", null, "Cardio")).toBe("Cardio");
    expect(picklistLabel(de, "Lead", "LeadSource", "LeadSource", "Web")).toBe("Internet");
    expect(picklistLabel(de, "Lead", "LeadSource", "LeadSource", "Partner")).toBe("Partner");
  });
  it("translates record types with a non-empty label", () => {
    expect(recordTypeLabel(de, "Account", "HCP", "Health Care Provider")).toBe("Arzt");
    expect(recordTypeLabel(de, "Account", "Business_Account", "Business")).toBe("Business");
  });
});
