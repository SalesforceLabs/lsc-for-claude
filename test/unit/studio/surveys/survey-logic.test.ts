import { describe, expect, it } from "vitest";
import {
  buildList,
  findFlow,
  parseFlow,
  plainText,
  questionKind,
} from "../../../../src/studio/screens/surveys/logic";
import {
  actionLabel,
  toggleChoice,
  unansweredRequired,
  visibleSurveys,
} from "../../../../src-renderer/components/studio/actions/surveys/logic";
import type { SurveyListRow } from "../../../../src-renderer/components/studio/actions/surveys/types";

describe("questionKind (SurveysQuestionViewModel.getSurveysQuestionControl)", () => {
  it("maps (dataType, fieldType, extension) to the device's control", () => {
    expect(questionKind("String", "RadioButtons", undefined)).toBe("single");
    expect(questionKind("String", "ComponentChoice", "survey:runtimePicklist")).toBe("picklist");
    expect(questionKind("Number", "ComponentChoice", "survey:runtimeRating")).toBe("rating");
    expect(questionKind("String", "MultiSelectCheckboxes", undefined)).toBe("multi");
    expect(questionKind("Number", "ComponentInput", "survey:cmpInputRuntimeSlider")).toBe("slider");
    expect(questionKind("Number", "ComponentInput", "survey:runtimeNps")).toBe("text");
    expect(questionKind("Date", "InputField", undefined)).toBe("date");
    expect(questionKind("String", "ComponentInput", "survey:runtimeShortText")).toBe("short");
    expect(questionKind("String", "InputField", undefined)).toBe("text");
    expect(questionKind(undefined, "ComponentInstance", "survey:runtimeWelcome")).toBe("info");
  });
});

describe("parseFlow", () => {
  it("lists every field per screen with its choices as plain text", () => {
    const form = parseFlow({
      label: "Obstacles",
      screens: [
        {
          name: "p1",
          label: "Page 1",
          fields: [
            {
              name: "q1",
              fieldType: "MultiSelectCheckboxes",
              dataType: "String",
              fieldText: "<p><strong>Pick</strong></p>",
              isRequired: true,
              choiceReferences: ["c1", "missing"],
            },
          ],
        },
        { name: "empty", label: "Empty", fields: [] },
      ],
      choices: [{ name: "c1", choiceText: "Cost &quot;high&quot;" }],
    });
    expect(form.title).toBe("Obstacles");
    expect(form.pages).toHaveLength(1);
    const q = form.pages[0].questions[0];
    expect(q).toMatchObject({ text: "Pick", required: true, kind: "multi" });
    expect(q.choices).toEqual([{ id: "c1", label: 'Cost "high"' }]);
  });

  it("strips tags and entities", () => {
    expect(plainText("<p>a &amp; b</p><p>c</p>")).toBe("a & b\nc");
  });
});

describe("findFlow", () => {
  const flows = { "a-1": "one", "a-2": "two", "ns__a-3": "ns" };
  it("takes the version asked for, bare or namespaced, else the newest", () => {
    expect(findFlow(flows, "a", 1)).toBe("one");
    expect(findFlow(flows, "a", 3)).toBe("ns");
    expect(findFlow(flows, "a", 9)).toBe("ns");
    expect(findFlow(flows, "zzz", 1)).toBeUndefined();
  });
});

describe("buildList", () => {
  const surveys = [
    { Id: "s2", Name: "Zeta", DeveloperName: "zeta", ActiveVersionId: "v2" },
    { Id: "s1", Name: "alpha", DeveloperName: "alpha", ActiveVersionId: "v1" },
  ];
  const versions = [
    { Id: "v1", VersionNumber: 3 },
    { Id: "v2", VersionNumber: 1 },
  ];
  it("keeps the newest invitation per survey, orders by name and reads the response status", () => {
    const rows = buildList({
      invitations: [
        { Id: "i1", SurveyId: "s1", CreatedDate: "2026-01-01" },
        { Id: "i2", SurveyId: "s1", CreatedDate: "2026-02-01" },
        { Id: "i3", SurveyId: "s2", CreatedDate: "2026-01-01" },
      ],
      surveys,
      versions,
      responses: [
        { InvitationId: "i1", Status: "Completed", CreatedById: "u" },
        {
          InvitationId: "i3",
          Status: "Completed",
          CreatedById: "u",
          LastModifiedDate: "2026-03-01",
        },
      ],
      users: [{ Id: "u", Name: "Evan" }],
    });
    expect(rows.map((r) => [r.name, r.invitationId, r.status, r.version])).toEqual([
      ["alpha", "i2", "open", 3],
      ["Zeta", "i3", "completed", 1],
    ]);
    expect(rows[1]).toMatchObject({ completedBy: "Evan", percent: 100 });
  });
});

describe("renderer list and form rules", () => {
  const row = (name: string, status: SurveyListRow["status"]): SurveyListRow => ({
    id: name,
    invitationId: "i",
    name,
    developerName: name,
    version: 1,
    status,
    percent: 0,
  });
  const rows = [row("NPS", "open"), row("CSAT", "completed"), row("Pitch", "started")];

  it("Open hides completed, Completed shows only those, search is a case-insensitive contains", () => {
    expect(visibleSurveys(rows, "Open", "").map((r) => r.name)).toEqual(["NPS", "Pitch"]);
    expect(visibleSurveys(rows, "Completed", "").map((r) => r.name)).toEqual(["CSAT"]);
    expect(visibleSurveys(rows, "Open", "pit").map((r) => r.name)).toEqual(["Pitch"]);
    expect(actionLabel(rows[1])).toBe("View");
    expect(actionLabel(rows[2])).toBe("Launch");
  });

  it("blocks the page on unanswered required questions, ignoring welcome text", () => {
    const q = (id: string, required: boolean, kind = "text" as const) => ({
      id,
      text: id,
      help: "",
      required,
      kind,
      choices: [],
    });
    const page = {
      name: "p",
      label: "P",
      questions: [q("a", true), q("b", false), q("w", true, "info" as never)],
    };
    expect(unansweredRequired(page, {}).map((x) => x.id)).toEqual(["a"]);
    expect(unansweredRequired(page, { a: "x" })).toEqual([]);
    expect(unansweredRequired(page, { a: [] })).toHaveLength(1);
  });

  it("toggles multi-select choices", () => {
    let a = toggleChoice({}, "q", "c1");
    a = toggleChoice(a, "q", "c2");
    expect(a.q).toEqual(["c1", "c2"]);
    expect(toggleChoice(a, "q", "c1").q).toEqual(["c2"]);
  });
});
