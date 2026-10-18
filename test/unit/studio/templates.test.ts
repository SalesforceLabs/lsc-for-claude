import { describe, it, expect } from "vitest";
import {
  isSuggestionQueued,
  queueChange,
  stackChange,
  withoutSuggestion,
  type PendingChange,
} from "../../../src-renderer/components/studio/changes.js";
import {
  apiNameFor,
  duplicateDraft,
  fieldInputs,
  FORMS,
  formProblems,
  wrapFilter,
} from "../../../src-renderer/components/studio/templates.js";
import type { StudioFix, StudioItem } from "../../../src-renderer/components/studio/types.js";

const addTo = (to: string[]): StudioFix => ({
  kind: "setProfileAssignments",
  label: `Show tab to ${to.at(-1)}`,
  category: "UISchema",
  developerName: "NavTab_Accounts",
  recordLabel: "Accounts",
  from: ["Admin"],
  to,
});

describe("stacking suggestions", () => {
  it("keeps both of two suggestions for one record, and takes one back out alone", () => {
    const a = addTo(["Admin", "Rep A"]);
    const b = addTo(["Admin", "Rep B"]);
    let pending: PendingChange[] = queueChange([], stackChange([], { fix: a }));
    pending = queueChange(pending, stackChange(pending, { fix: b }));
    expect(pending).toHaveLength(1);
    expect(pending[0].fix).toMatchObject({ to: ["Admin", "Rep A", "Rep B"] });
    expect(isSuggestionQueued(pending, a) && isSuggestionQueued(pending, b)).toBe(true);

    pending = withoutSuggestion(pending, a);
    expect(pending[0].fix).toMatchObject({ to: ["Admin", "Rep B"] });
    expect(isSuggestionQueued(pending, a)).toBe(false);
    expect(withoutSuggestion(pending, b)).toEqual([]);
  });

  it("cancels giving and then removing the same access", () => {
    const access = { type: "territory" as const, id: "0MI000000000001", label: "Boston" };
    const give: StudioFix = { kind: "assignAccess", label: "Give", userId: "005000000000001", userName: "Rep", access };
    let pending = queueChange([], { fix: give });
    pending = queueChange(pending, { fix: { ...give, kind: "removeAccess", assignmentId: "" } });
    expect(pending).toEqual([]);
  });
});

describe("record forms", () => {
  it("derives API names and wraps filters", () => {
    expect(apiNameFor("Log a call!", "QuickAction_")).toBe("QuickAction_Log_a_call");
    expect(apiNameFor("", "NavTab_")).toBe("NavTab_New");
    expect(wrapFilter(" OwnerId = $User.Id ")).toBe("(OwnerId = $User.Id)");
    expect(wrapFilter("(A = 1)")).toBe("(A = 1)");
  });

  it("catches missing required fields and bad positions before sending", () => {
    const spec = FORMS.QuickAction;
    expect(formProblems(spec, { Location: "HomePage", ActionName: "", SortOrder: 101 }, { developerName: "QuickAction_X", recordLabel: "X", copying: false })).toEqual([
      "Fill in Action.",
      "Position must be a whole number from 1 to 100.",
    ]);
  });

  it("sends only changed fields for a duplicate, everything filled in for a new record", () => {
    const spec = FORMS.DbSchema;
    const values = { SObject: "Visit", Type: "DATA", WhereSoql: "OwnerId = $User.Id", OneWaySync: false };
    const base = { profiles: [], profilesTouched: false, profilesIn: "assignments" as const };
    expect(fieldInputs(spec, values, { ...base, copying: true, touched: new Set(["WhereSoql"]) })).toEqual([
      { name: "WhereSoql", value: "(OwnerId = $User.Id)" },
    ]);
    expect(fieldInputs(spec, values, { ...base, copying: false, touched: new Set() }).map((f) => f.name)).toEqual([
      "SObject",
      "Type",
      "WhereSoql",
      "OneWaySync",
    ]);
  });

  it("drafts a duplicate that copies the original and keeps its profile assignments", () => {
    const item: StudioItem = {
      id: "UISchema:NavTab_Accounts",
      label: "Accounts",
      properties: {},
      findings: [],
      edit: {
        record: { type: "config", category: "UISchema", developerName: "NavTab_Accounts", label: "Accounts" },
        active: true,
        profiles: { source: "assignments", names: ["Rep"] },
      },
    };
    expect(duplicateDraft(item)).toMatchObject({
      copyFrom: "NavTab_Accounts",
      developerName: "NavTab_Accounts_Copy",
      recordLabel: "Accounts (copy)",
      profiles: ["Rep"],
      fields: [],
    });
  });
});
