import { describe, it, expect } from "vitest";
import { diagnosePreflight, pickerMayRead, problemReading, readsLikeProblem } from "../../../src-electron/engine/diagnose-first.js";

const positives = [
  "No such column 'LastModifiedDate' on entity 'ContentDocumentLink'",
  "INVALID_FIELD: Cannot find field Foo__c on Account",
  "System.NullPointerException: Attempt to de-reference a null object",
  "Our reps see a Coming Soon tab on the iPad",
  "Carmen can't see the Samples tab on her iPad",
  "accounts aren't showing on the iPad for the new territory",
  "The metadata cache publish failed for the Field Rep profile",
  "sync error on first login: download failed at table Account",
  "Why isn't the visit button showing for Marcus?",
  "I get an error when I save a visit",
  "Initial sync is stuck at 40%",
  "Insufficient access rights on cross-reference id",
  "Error: unable to fetch user info (404)",
  "at Object.run (script.js:12:5)\nat line 34",
  "home page is blank on mobile after the last publish",
  "Territory assignments missing for half of the accounts",
  "How do I fix the sync error on the iPad?",
  "users can't log in to the iPad app",
  "FIELD_INTEGRITY_EXCEPTION when deleting an account",
  "Why does the DCR job fail every night?",
  "UNABLE_TO_LOCK_ROW on visit submit",
  "deploy fails with INVALID_CROSS_REFERENCE_KEY",
  "REQUIRED_FIELD_MISSING: [Name]",
  "Quotes created on the iPad don't lock after Submit and skip the approval workflow. On web the same flow works.",
  "For every visit I save, the iPad shows an error",
  "Count of visits on the iPad doesn't match web after sync",
  "Audit trail shows the quote was unlocked but reps can't edit it",
  // Symptoms told as what the user sees, with no failure word.
  "the reps' home page still shows last week's news after publishing",
  "my product list on the tablet opens empty every morning",
  "visit notes typed offline vanish after sync",
  "the territory picker shows nothing even though the rep is aligned",
  "promo banner keeps showing although we switched it off",
  "publish fails saying the profile has no cache",
  "plan progress numbers frozen since Monday",
  "the batch job spins forever after the refresh",
];

const negatives = [
  "how do I configure samples?",
  "What is Activity Plan?",
  "Explain territory alignment",
  "create a permission set for field reps",
  "build me an LWC that lists open visits",
  "/lsc:health-check",
  "/lsc:describe Account",
  "Set up consent management for email",
  "list all trigger handlers",
  "export the config from this org",
  "show me how to add a quick action",
  "hi",
  "thanks!",
  "Generate a report that shows missing accounts per territory",
  "Where can I find the release notes for Winter '27?",
  "describe the ProviderVisit object",
  "turn off the trigger handler that errors on save",
  "deactivate the DB Schema record that fails validation",
  "update the Account filter so it doesn't break sync",
  "remove the broken tab from the iPad",
  "assign the permission set to users who can't see visits",
  "delete the duplicate actions that are failing",
  "run the job that failed last night again",
  "what does the setting LSC_ENABLE_SAMPLES do?",
  "use MY_CUSTOM_SETTING for the field reps",
  "Audit visit data in this org for the last 90 days: count visits by status, find reps who logged visits but have no territory, and find visited accounts that aren't aligned to any of the visiting rep's territories. Give me the numbers.",
  "For every quote in this org, list its line items with each line's product, price book entry, list price and unit price, and flag any line whose unit price doesn't match its price book entry.",
  "count the accounts that have no territory",
  "For each rep, show how many visits are missing a signature",
  "reconcile sample inventory that doesn't match the transfers",
  // The same words in questions, wishes and requests.
  "I've never configured territories before, where do I start?",
  "we still need to plan the go-live for March",
  "reps always ask for a simpler home page, any ideas?",
  "is it wrong to use one profile for all reps?",
  "should I run the batch job twice a day or once?",
  "the deck looks good but can we add a slide on samples?",
  "nothing urgent, just curious how sync works",
  "I want the home page to show upcoming visits instead of the news feed",
  "the empty state on the home page should say something friendlier",
  "publish the cache for the field rep profile",
  "plan the rollout for the new territories",
];

describe("readsLikeProblem", () => {
  it.each(positives)("flags: %s", (t) => expect(readsLikeProblem(t)).toBe(true));
  it.each(negatives)("ignores: %s", (t) => expect(readsLikeProblem(t)).toBe(false));
});

describe("diagnosePreflight", () => {
  it("asks for the JSON form of diagnose_lsc_issue", () => {
    expect(diagnosePreflight("  Coming Soon tab on iPad ")).toEqual([
      { name: "diagnose_lsc_issue", input: { symptom: "Coming Soon tab on iPad", format: "json" } },
    ]);
  });

  it("returns nothing for a non-problem and for empty text", () => {
    expect(diagnosePreflight("how do I configure samples?")).toEqual([]);
    expect(diagnosePreflight("")).toEqual([]);
  });

  it("does not diagnose the same text twice in a conversation", () => {
    const seen = new Set<string>();
    expect(diagnosePreflight("Sync is stuck", seen)).toHaveLength(1);
    expect(diagnosePreflight("sync  is STUCK", seen)).toEqual([]);
    expect(diagnosePreflight("Visits fail to save", seen)).toHaveLength(1);
  });

  it("marks a run quiet when only the looser wording let the message through", () => {
    expect(problemReading("visit notes typed offline vanish after sync")).toBe("loose");
    expect(diagnosePreflight("visit notes typed offline vanish after sync")[0].input.quietWhenEmpty).toBe(true);
    expect(problemReading("visits don't save on the ipad")).toBe("clear");
    expect(diagnosePreflight("visits don't save on the ipad")[0].input).not.toHaveProperty("quietWhenEmpty");
    expect(problemReading("INVALID_FIELD on the visit page")).toBe("clear");
    expect(problemReading("how do I configure samples?")).toBeNull();
  });

  it("caps very long pastes", () => {
    const [call] = diagnosePreflight("Error: " + "x".repeat(10_000));
    expect((call.input.symptom as string).length).toBe(4000);
  });
});

describe("pickerMayRead", () => {
  it("is true for plain statements the word check lets go", () => {
    expect(pickerMayRead("the rep taps the order button and the screen goes white")).toBe(true);
    expect(pickerMayRead("totals on the tablet are a cent off from the browser")).toBe(true);
  });

  it("is false for what the word check already takes, and for requests and how-to questions", () => {
    expect(pickerMayRead("visits don't save on the ipad")).toBe(false);
    expect(pickerMayRead("create a permission set for field reps")).toBe(false);
    expect(pickerMayRead("how do I configure samples?")).toBe(false);
    expect(pickerMayRead("count the accounts that have no territory")).toBe(false);
    expect(pickerMayRead("/lsc:health-check")).toBe(false);
    expect(pickerMayRead("hi")).toBe(false);
  });
});
