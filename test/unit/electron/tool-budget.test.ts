import { describe, it, expect } from "vitest";
import {
  spendToolBudget,
  refundToolBudget,
  isRejectedQuery,
  ORG_QUERY_LIMIT,
  ORG_QUERY_REFUNDS,
} from "../../../src-electron/engine/tool-budget.js";

describe("spendToolBudget", () => {
  it("counts limited tools and refuses past the limit", () => {
    const counts = new Map<string, number>();
    expect(spendToolBudget("check_user_access", counts)).toBeNull();
    expect(spendToolBudget("check_user_access", counts)).toBeNull();
    expect(spendToolBudget("check_user_access", counts)).toMatch(/Don't check reps one by one/);
    expect(counts.get("check_user_access")).toBe(2);
  });

  it("shares one limit across run_soql, describe_sobject and get_record", () => {
    const counts = new Map<string, number>();
    const tools = ["run_soql", "describe_sobject", "get_record"];
    for (let i = 0; i < ORG_QUERY_LIMIT; i++)
      expect(spendToolBudget(tools[i % 3], counts)).toBeNull();
    for (const t of tools) expect(spendToolBudget(t, counts)).toMatch(/Answer the user now/);
  });

  it("leaves other tools alone", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      expect(spendToolBudget("search_lsc_knowledge", counts)).toBeNull();
      expect(spendToolBudget("list_db_schema", counts)).toBeNull();
    }
    expect(counts.size).toBe(0);
  });

  it("gives back queries the org rejected for their shape, up to a cap", () => {
    const counts = new Map<string, number>();
    const bad =
      "# Query Failed\n\n**Error:** INVALID_FIELD: SELECT Id, Name ^ No such column 'Name' on entity 'UserTerritory2Association'";
    for (let i = 0; i < ORG_QUERY_REFUNDS + 3; i++) {
      expect(spendToolBudget("run_soql", counts)).toBeNull();
      expect(refundToolBudget("run_soql", bad, counts)).toBe(i < ORG_QUERY_REFUNDS);
    }
    expect(counts.get("org-queries")).toBe(3);
  });

  it("doesn't give back successful, empty or non-shape failures", () => {
    expect(isRejectedQuery('{"totalSize":0,"records":[]}')).toBe(false);
    expect(isRejectedQuery("# Query Results\nName: No such column in data")).toBe(false);
    expect(isRejectedQuery("# Query Failed\n**Error:** REQUEST_LIMIT_EXCEEDED")).toBe(false);
    expect(
      isRejectedQuery("# Query Failed\n**Error:** sObject type 'FlexiPage' is not supported.")
    ).toBe(true);
    expect(
      isRejectedQuery("# Query Failed\n**Error:** MALFORMED_QUERY: Disjunctions not supported")
    ).toBe(true);
    const counts = new Map<string, number>([["org-queries", 1]]);
    expect(refundToolBudget("search_lsc_knowledge", "# Query Failed INVALID_FIELD", counts)).toBe(
      false
    );
  });
});
