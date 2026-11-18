import { describe, it, expect } from "vitest";
import {
  NO_FILTER,
  addItems,
  filterObjectives,
  importSourcePlans,
  kebabItems,
  objectiveMatchesSearch,
  planObjectOf,
  productOptions,
  stakeholderMatches,
  statusButtonTitle,
  statusOptions,
} from "../../../../src-renderer/components/studio/kam/ipad-kam-logic";

const task = (name: string) => ({
  id: name,
  name,
  status: "Open",
  kind: "notStarted" as const,
  owner: null,
  assignedTo: null,
  dueDate: null,
});
const objective = (
  id: string,
  title: string,
  kind: "inProgress" | "completed" | "notStarted",
  products: string[] = [],
  tactic = ""
) => ({
  id,
  title,
  status: null,
  kind,
  percent: 0,
  owner: null,
  assignedTo: null,
  products,
  actionPlans: tactic
    ? [
        {
          id: id + "a",
          title: "Plan " + id,
          status: null,
          kind,
          percent: 0,
          owner: null,
          tasks: [task(tactic)],
        },
      ]
    : [],
});
const list = [
  objective("1", "Grow share", "inProgress", ["Alpha"], "Call clinic"),
  objective("2", "Launch", "completed", ["Beta"]),
  objective("3", "Retain", "notStarted", ["Alpha", "Beta"]),
];
const n = { objective: null, actionPlan: null, tactic: null } as never;

describe("kam plan list search, filters and menus", () => {
  it("searches objective, action plan and tactic names, ignoring case and accents", () => {
    expect(objectiveMatchesSearch(list[0], "CLINIC")).toBe(true);
    expect(objectiveMatchesSearch(list[0], "plan 1")).toBe(true);
    expect(objectiveMatchesSearch(list[1], "clinic")).toBe(false);
    expect(objectiveMatchesSearch(list[1], "  ")).toBe(true);
  });
  it("narrows by search, status and product together", () => {
    expect(filterObjectives(list, { ...NO_FILTER, products: ["Alpha"] }).map((o) => o.id)).toEqual([
      "1",
      "3",
    ]);
    expect(
      filterObjectives(list, { search: "", statuses: ["completed"], products: [] }).map((o) => o.id)
    ).toEqual(["2"]);
  });
  it("counts status options over the search and product filter only", () => {
    const opts = statusOptions(list, { search: "", statuses: ["completed"], products: ["Alpha"] });
    expect(opts.map((o) => [o.id, o.count])).toEqual([
      ["all", 2],
      ["inProgress", 1],
      ["completed", 0],
      ["notStarted", 1],
    ]);
    expect(statusButtonTitle([])).toBe("Status All");
    expect(statusButtonTitle(["completed"])).toBe("Status Completed");
  });
  it("lists products with their objective counts", () => {
    expect(productOptions(list)).toEqual([
      { name: "Alpha", count: 2 },
      { name: "Beta", count: 2 },
    ]);
  });
  it("orders kebab items like the app and hides Mark as Incomplete until Completed", () => {
    expect(kebabItems("actionPlan", "inProgress", "AccountPlan", n).map((i) => i.kind)).toEqual([
      "add",
      "assignSprint",
      "edit",
      "delete",
    ]);
    expect(
      kebabItems("actionPlan", "inProgress", "TerritoryBusinessPlan", n).map((i) => i.kind)
    ).toEqual(["add", "edit", "delete"]);
    expect(kebabItems("tactic", "completed", "AccountPlan", n).map((i) => i.kind)).toEqual([
      "edit",
      "markIncomplete",
      "delete",
    ]);
    expect(kebabItems("tactic", "notStarted", "AccountPlan", n).map((i) => i.kind)).toEqual([
      "edit",
      "delete",
    ]);
  });
  it("offers import from a Territory Business Plan on Account Plans only", () => {
    expect(addItems("AccountPlan", true, n).map((i) => i.id)).toEqual(["new", "importTerritory"]);
    expect(addItems("AccountPlan", false, n).map((i) => i.id)).toEqual(["new"]);
    expect(addItems("TerritoryBusinessPlan", true, n).map((i) => i.id)).toEqual(["new"]);
  });
  it("finds Territory Business Plans to import from", () => {
    const kam = {
      plans: {
        a: { object: "AccountPlan", objectives: [] },
        t: { object: "TerritoryBusinessPlan", name: "T1", objectives: [] },
      },
    } as never;
    expect(importSourcePlans(kam).map((p) => p.id)).toEqual(["t"]);
  });
  it("searches stakeholders by name and shown columns", () => {
    const s = {
      title: "Dr Ana",
      role: "Champion",
      influence: null,
      strength: null,
      comment: "met at congress",
    };
    expect(stakeholderMatches(s, "champ")).toBe(true);
    expect(stakeholderMatches(s, "congress")).toBe(true);
    expect(stakeholderMatches(s, "zzz")).toBe(false);
  });
  it("maps a record's object to a plan kind", () => {
    expect(planObjectOf("AccountPlan")).toBe("AccountPlan");
    expect(planObjectOf("Account")).toBeNull();
  });
});
