import { describe, expect, it } from "vitest";
import { cardFor, cardHidesStep, parseDiagnosis, withoutCreateFixes, parseQueued, pickUserMessage, queuedSummary, trayPillLabel } from "../../../src-renderer/components/chat-cards/card-logic.js";
import { approvalFor, approvalsReducer, initialApprovals, waitingCount } from "../../../src-renderer/components/chat-cards/approval-logic.js";

const tool = (name: string, status: "pending" | "running" | "success" | "error", result?: string) => ({ name, status, result });

const item = { id: "c1", kind: "cause", title: "Bad filter", area: "sync", status: "found", byDesign: false, notApplicable: false, why: "", steps: [], records: ["A"], failedRules: [], matched: "", score: 1 };

describe("cardFor", () => {
  it("shows a diagnosis for JSON with items, with defaults for missing lists", () => {
    const card = cardFor(tool("diagnose_lsc_issue", "success", JSON.stringify({ items: [{ ...item, records: undefined }], checkedOrg: "demo" })));
    expect(card?.kind).toBe("diagnosis");
    if (card?.kind === "diagnosis") {
      expect(card.result.checkedOrg).toBe("demo");
      expect(card.result.items[0].records).toEqual([]);
    }
  });

  it("recognises an MCP-prefixed tool name", () => {
    expect(cardFor(tool("mcp__lsc__diagnose_lsc_issue", "success", JSON.stringify({ items: [], checkedOrg: null })))?.kind).toBe("diagnosis");
  });

  it("leaves prose diagnoses as a step row", () => {
    expect(cardFor(tool("diagnose_lsc_issue", "success", "Possible causes:\n1. Bad filter"))).toBeNull();
    expect(parseDiagnosis("not json")).toBeNull();
  });

  it("shows loading while the check runs and an error card when it fails", () => {
    expect(cardFor(tool("check_user_access", "running"))).toEqual({ kind: "loading", title: "Checking the user…" });
    const failed = cardFor(tool("diagnose_lsc_issue", "error", "Error: org not connected"));
    expect(failed).toEqual({ kind: "failed", title: "Couldn't match known causes", message: "org not connected" });
  });

  it("shows a user check, and a list when the name was ambiguous", () => {
    const check = { id: "user.access.psl", stage: "access", title: "Holds the LSC license", status: "pass", severity: "error" };
    const trace = { org: "demo", collectedAt: "x", userId: "005", userName: "Carmen", profile: "Rep", featureId: null, checks: [check], resolvedUser: { id: "005", name: "Carmen", username: "c@x" } };
    expect(cardFor(tool("check_user_access", "success", JSON.stringify(trace)))?.kind).toBe("user-check");
    const many = cardFor(tool("check_user_access", "success", JSON.stringify({ matches: [{ id: "1", name: "Carmen A", username: "a@x" }, { bad: true }], message: "Which one?" })));
    expect(many).toEqual({ kind: "user-matches", matches: [{ id: "1", name: "Carmen A", username: "a@x", profile: undefined }], message: "Which one?" });
  });

  it("drops malformed checks and rules, and falls back to the step row when nothing is left", () => {
    const check = { id: "a", stage: "access", title: "T", status: "fail", severity: "error", fixes: [null, { kind: "setActive" }] };
    const base = { org: "demo", collectedAt: "x", userId: "005", userName: "Carmen", profile: null, featureId: null };
    const card = cardFor(tool("check_user_access", "success", JSON.stringify({ ...base, checks: [null, { id: "b" }, check] })));
    expect(card?.kind === "user-check" && card.trace.checks.map((c) => [c.id, c.fixes?.length])).toEqual([["a", 1]]);
    expect(cardFor(tool("check_user_access", "success", JSON.stringify({ ...base, checks: [null, { stage: "x" }] })))).toBeNull();
    const diag = parseDiagnosis(JSON.stringify({ items: [{ ...item, records: ["A", 4], failedRules: [null, { name: "R", message: "m" }] }] }));
    expect(diag?.items[0].records).toEqual(["A"]);
    expect(diag?.items[0].failedRules).toEqual([{ id: "", name: "R", message: "m" }]);
  });

  it("hides the step row only over an empty diagnosis", () => {
    expect(cardHidesStep(cardFor(tool("diagnose_lsc_issue", "success", JSON.stringify({ items: [] }))))).toBe(true);
    expect(cardHidesStep(cardFor(tool("diagnose_lsc_issue", "success", JSON.stringify({ items: [item] }))))).toBe(false);
    expect(cardHidesStep(null)).toBe(false);
  });

  it("takes out create-record fixes, keeping the array when there are none", () => {
    const keep = [{ id: "a", stage: "access", title: "T", status: "fail", severity: "error", fixes: [{ kind: "setActive" }] }] as never[];
    expect(withoutCreateFixes(keep)).toBe(keep);
    const mixed = [{ id: "a", stage: "access", title: "T", status: "fail", severity: "error", fixes: [{ kind: "setActive" }, { kind: "createConfigRecord" }] }] as never[];
    expect(withoutCreateFixes(mixed)[0]).toMatchObject({ fixes: [{ kind: "setActive" }] });
  });

  it("shows a queued write for any tool", () => {
    const card = cardFor(tool("update_record", "success", JSON.stringify({ status: "queued", changes: ["Activate A", 3, "Give B"], message: "m" })));
    expect(card).toEqual({ kind: "queued", labels: ["Activate A", "Give B"], message: "m" });
    expect(cardFor(tool("update_record", "error", JSON.stringify({ status: "queued", changes: [] })))).toBeNull();
    expect(cardFor(tool("run_soql", "success", JSON.stringify({ status: "ok" })))).toBeNull();
    expect(parseQueued("[]")).toBeNull();
  });
});

describe("text", () => {
  it("builds the queued summary and pill label", () => {
    expect(queuedSummary(["A", "B"])).toBe("Waiting in Studio: A, B");
    expect(queuedSummary(["A", "B", "C", "D", "E"])).toBe("Waiting in Studio: A, B, C and 2 more");
    expect(trayPillLabel(1)).toBe("1 change waiting in Studio");
    expect(trayPillLabel(3)).toBe("3 changes waiting in Studio");
  });

  it("words the pick of an ambiguous user", () => {
    expect(pickUserMessage({ id: "1", name: "Carmen A", username: "a@x" })).toBe("I mean Carmen A (a@x).");
  });
});

describe("approvals", () => {
  const request = { requestId: "r1", convId: "c1", toolId: "t1", name: "update_record", input: {}, summary: "Update Account", production: false };

  const settle = (allowed: boolean) => ({ type: "settled" as const, requestId: "r1", convId: "c1", toolId: "t1", allowed });

  it("tracks a request until it is answered and keeps the answer", () => {
    let s = approvalsReducer(initialApprovals, { type: "request", request });
    expect(approvalFor(s.views, "c1", "t1")?.state).toBe("waiting");
    expect(approvalFor(s.views, "c2", "t1")).toBeUndefined();
    expect(waitingCount(s.views, "c1")).toBe(1);
    s = approvalsReducer(s, { type: "answering", requestId: "r1" });
    expect(approvalFor(s.views, "c1", "t1")?.state).toBe("answering");
    s = approvalsReducer(s, settle(false));
    expect(approvalFor(s.views, "c1", "t1")?.state).toBe("denied");
    expect(waitingCount(s.views, "c1")).toBe(0);
    // A later listing doesn't bring the buttons back.
    expect(approvalFor(approvalsReducer(s, { type: "load", requests: [request] }).views, "c1", "t1")?.state).toBe("denied");
  });

  it("goes back to waiting when the answer fails", () => {
    let s = approvalsReducer(initialApprovals, { type: "load", requests: [request] });
    s = approvalsReducer(approvalsReducer(s, { type: "answering", requestId: "r1" }), { type: "failed", requestId: "r1" });
    expect(s.views[0].state).toBe("waiting");
  });

  it("remembers a settlement that arrives before the listing", () => {
    let s = approvalsReducer(initialApprovals, settle(true));
    expect(s.views).toEqual([]);
    s = approvalsReducer(s, { type: "load", requests: [request] });
    expect(approvalFor(s.views, "c1", "t1")?.state).toBe("allowed");
    expect(waitingCount(s.views, "c1")).toBe(0);
  });
});
