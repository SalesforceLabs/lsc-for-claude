import { describe, it, expect } from "vitest";
import { diagnosePreflight, readsLikeProblem } from "../../../src-electron/engine/diagnose-first.js";

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

  it("caps very long pastes", () => {
    const [call] = diagnosePreflight("Error: " + "x".repeat(10_000));
    expect((call.input.symptom as string).length).toBe(4000);
  });
});
