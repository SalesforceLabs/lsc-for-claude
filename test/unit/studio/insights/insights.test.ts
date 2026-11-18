import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  feedPages,
  splitStatuses,
  subtitleOf,
  tagNames,
} from "../../../../src/studio/screens/insights/logic.js";
import {
  insightsForPage,
  searchInsights,
  sortInsights,
  defaultSort,
} from "../../../../src-renderer/components/studio/screens/insights/insights-logic";
import type {
  PublishedInsights,
  PublishedInsightItem,
} from "../../../../src-renderer/components/studio/screens/insights/insights-types";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  queryResult: vi.fn(),
  queryByIds: vi.fn(),
}));
const helpers = await import("../../../../src/studio/helpers.js");
const { collectInsights } = await import("../../../../src/studio/screens/insights/insights.js");

beforeEach(() => {
  vi.mocked(helpers.queryResult).mockReset();
  vi.mocked(helpers.queryByIds).mockReset();
});

describe("server rules", () => {
  it("adds In Progress and My Drafts only when mapped", () => {
    expect(feedPages(null, [])).toEqual(["latest", "trending", "allChannels", "myInsights"]);
    expect(feedPages("Draft", ["Review"])).toEqual([
      "latest",
      "trending",
      "allChannels",
      "myInsights",
      "inProgress",
      "myDrafts",
    ]);
  });
  it("splits statuses and shortens long text", () => {
    expect(splitStatuses("A; B,C ;")).toEqual(["A", "B", "C"]);
    expect(subtitleOf("x".repeat(256))).toHaveLength(253);
    expect(subtitleOf("x".repeat(255))).toHaveLength(255);
    expect(tagNames("One\nTwo\n")).toEqual(["One", "Two"]);
  });
});

const item = (o: Partial<PublishedInsightItem>): PublishedInsightItem => ({
  id: "i",
  title: "T",
  subtitle: "",
  fullSubtitle: "",
  loggedBy: "Ann",
  date: "",
  createdDate: "2026-11-01T00:00:00Z",
  lastModifiedDate: "2026-11-01T00:00:00Z",
  lastUpvotedDate: null,
  createdById: "u1",
  ownerId: "u1",
  upvoteCount: 0,
  childCount: 0,
  tags: [],
  products: [],
  status: null,
  ownedByMe: true,
  ...o,
});
const data = (
  items: PublishedInsightItem[],
  o: Partial<PublishedInsights> = {}
): PublishedInsights => ({
  items,
  pages: [],
  now: "2026-11-04T00:00:00Z",
  hideName: false,
  hideTags: false,
  hideProducts: false,
  finalStatus: "Submitted",
  draftStatus: "Draft",
  inProgressStatuses: ["Review"],
  viewerId: "u1",
  ...o,
});

describe("insightsForPage", () => {
  const items = [
    item({ id: "new" }),
    item({
      id: "old",
      createdDate: "2026-01-01T00:00:00Z",
      lastModifiedDate: "2026-01-01T00:00:00Z",
    }),
    item({
      id: "liked",
      createdDate: "2026-01-01T00:00:00Z",
      lastModifiedDate: "2026-01-01T00:00:00Z",
      lastUpvotedDate: "2026-11-02T00:00:00Z",
    }),
    item({ id: "draft", status: "Draft" }),
    item({ id: "review", status: "Review", createdById: "u2", ownerId: "u2" }),
    item({ id: "final", status: "Submitted", createdById: "u2" }),
  ];
  const ids = (p: Parameters<typeof insightsForPage>[1]) =>
    insightsForPage(data(items), p, null).map((i) => i.id);
  it("filters per tab", () => {
    expect(ids("latest")).toEqual(["new", "final"]);
    expect(ids("trending")).toEqual(["new", "liked", "final"]);
    expect(ids("allChannels")).toEqual(["new", "old", "liked", "final"]);
    expect(ids("myInsights")).toEqual(["new", "old", "liked"]);
    expect(ids("myDrafts")).toEqual(["draft"]);
    expect(ids("inProgress")).toEqual(["review"]);
  });
});

describe("search and sort", () => {
  it("skips the name when hidden and orders by tab default", () => {
    const items = [
      item({ id: "a", title: "Alpha", fullSubtitle: "beta" }),
      item({ id: "b", title: "Beta", upvoteCount: 3 }),
    ];
    expect(
      searchInsights(items, "beta", { hideName: false, hideTags: false, hideProducts: false }).map(
        (i) => i.id
      )
    ).toEqual(["a", "b"]);
    expect(
      searchInsights(items, "beta", { hideName: true, hideTags: false, hideProducts: false }).map(
        (i) => i.id
      )
    ).toEqual(["a"]);
    expect(defaultSort("trending")).toBe("mostLiked");
    expect(sortInsights(items, "mostLiked").map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("collectInsights", () => {
  const ctx = (scope: string | null | undefined) =>
    ({
      org: "demo",
      userId: "u1",
      format: { timeZone: "UTC", locale: "en-US" },
      scope: () => scope,
      config: async () => ({ InsightSettings: { DraftStatus: "Draft" } }),
      note: vi.fn(),
    }) as never;
  it("is undefined when MedicalInsight isn't synced", async () => {
    expect(await collectInsights(ctx(undefined))).toBeUndefined();
  });
  it("maps rows and falls back when Status is missing", async () => {
    vi.mocked(helpers.queryResult)
      .mockRejectedValueOnce(new Error("No such column 'Status'"))
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [
          {
            Id: "1",
            Name: "N",
            Content: "C",
            TopicNames: "A\nB",
            UpvoteCount: 2,
            CreatedDate: "2026-11-01T10:00:00Z",
            CreatedById: "u1",
            OwnerId: "u1",
          },
        ],
      } as never);
    vi.mocked(helpers.queryByIds).mockImplementation((async (_f: string, o: string) =>
      o === "User"
        ? [{ Id: "u1", Name: "Ann" }]
        : [{ MedicalInsightId: "1", Product: { Name: "Drug" } }]) as never);
    const r = await collectInsights(ctx(""));
    expect(r?.items[0]).toMatchObject({
      loggedBy: "Ann",
      tags: ["A", "B"],
      products: ["Drug"],
      upvoteCount: 2,
      status: null,
      ownedByMe: true,
    });
    expect(r?.pages).toContain("myDrafts");
    expect(r?.unavailable?.join(" ")).toContain("no Status field");
  });
});
