import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  query: vi.fn(),
}));
const helpers = await import("../../../../src/studio/helpers.js");
const { loadSurveys } = await import("../../../../src/studio/screens/surveys/surveys.js");

beforeEach(() => {
  vi.mocked(helpers.query).mockReset();
});

describe("loadSurveys", () => {
  it("returns nothing, and asks no more, when no survey points at the account", async () => {
    vi.mocked(helpers.query).mockResolvedValue([]);
    const out = await loadSurveys("demo", "001000000000001");
    expect(out.surveys).toEqual([]);
    expect(vi.mocked(helpers.query)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(helpers.query).mock.calls[0][0]).toContain("FROM SurveySubject");
  });

  it("follows subject to invitation to survey and limits responses to the viewer", async () => {
    vi.mocked(helpers.query).mockImplementation(async (soql: string) => {
      if (soql.includes("FROM SurveySubject")) return [{ ParentId: "i1", SurveyId: "s1" }];
      if (soql.includes("FROM SurveyInvitation"))
        return [{ Id: "i1", SurveyId: "s1", CreatedDate: "2026-01-01" }];
      if (soql.includes("FROM Survey WHERE"))
        return [{ Id: "s1", Name: "NPS", DeveloperName: "nps", ActiveVersionId: "v1" }];
      if (soql.includes("FROM SurveyVersion")) return [{ Id: "v1", VersionNumber: 2 }];
      return [];
    });
    const out = await loadSurveys("demo", "001000000000001", "005000000000001");
    expect(out.surveys).toMatchObject([{ name: "NPS", status: "open", version: 2 }]);
    const resp = vi
      .mocked(helpers.query)
      .mock.calls.find((c) => c[0].includes("FROM SurveyResponse"));
    expect(resp?.[0]).toContain("CreatedById IN ('005000000000001')");
  });

  it("says when the invitation read hit its cap", async () => {
    vi.mocked(helpers.query).mockImplementation(async (soql: string) =>
      soql.includes("FROM SurveySubject")
        ? Array.from({ length: 500 }, (_, i) => ({ ParentId: `i${i}`, SurveyId: "s" }))
        : []
    );
    const out = await loadSurveys("demo", "001000000000001");
    expect(out.notes[0]).toMatch(/first 500/);
  });
});
