/** Chat writes waiting for the user's yes or no, kept by request. Pure state transitions for `useApprovals`. */

import type { ApprovalRequest } from "../../types";

export interface ApprovalsState {
  views: ApprovalView[];
  /**
   * Requests settled before we saw them, with how: a listing that was asked for before the settlement
   * but answers after it must not bring them back as waiting.
   */
  settled: Record<string, "allowed" | "denied">;
}

export const initialApprovals: ApprovalsState = { views: [], settled: {} };

export interface ApprovalView {
  request: ApprovalRequest;
  /** `answering`: the user clicked and the answer is on its way. */
  state: "waiting" | "answering" | "allowed" | "denied";
}

export type ApprovalAction =
  | { type: "load"; requests: ApprovalRequest[] }
  | { type: "request"; request: ApprovalRequest }
  | { type: "answering"; requestId: string }
  | { type: "failed"; requestId: string }
  | { type: "settled"; requestId: string; convId: string; toolId: string; allowed: boolean };

const upsert = (state: ApprovalView[], view: ApprovalView): ApprovalView[] => {
  const i = state.findIndex((v) => v.request.requestId === view.request.requestId);
  if (i < 0) return [...state, view];
  // A request already answered stays answered when a listing or a repeat arrives later.
  if (state[i].state !== "waiting" && view.state === "waiting") return state;
  return state.map((v, j) => (j === i ? view : v));
};

function viewsReducer(state: ApprovalView[], action: Exclude<ApprovalAction, { type: "load" } | { type: "request" }>): ApprovalView[] {
  switch (action.type) {
    case "answering":
      return state.map((v) => (v.request.requestId === action.requestId && v.state === "waiting" ? { ...v, state: "answering" } : v));
    case "failed":
      return state.map((v) => (v.request.requestId === action.requestId && v.state === "answering" ? { ...v, state: "waiting" } : v));
    case "settled": {
      const result = action.allowed ? "allowed" : "denied";
      return state.map((v) => (v.request.requestId === action.requestId ? { ...v, state: result } : v));
    }
  }
}

export function approvalsReducer(state: ApprovalsState, action: ApprovalAction): ApprovalsState {
  if (action.type === "settled" && !state.views.some((v) => v.request.requestId === action.requestId)) {
    // Settled before we saw the request (the listing is still on its way, or another window answered): remember it.
    return { ...state, settled: { ...state.settled, [action.requestId]: action.allowed ? "allowed" : "denied" } };
  }
  if (action.type === "load" || action.type === "request") {
    const incoming = action.type === "load" ? action.requests : [action.request];
    const views = incoming.reduce<ApprovalView[]>((acc, request) => {
      const done = state.settled[request.requestId];
      return upsert(acc, { request, state: done ?? "waiting" });
    }, state.views);
    return views === state.views ? state : { ...state, views };
  }
  const views = viewsReducer(state.views, action);
  return views === state.views ? state : { ...state, views };
}

/** The approval for one tool call in one session. */
export function approvalFor(state: ApprovalView[], convId: string | null, toolId: string): ApprovalView | undefined {
  return convId ? state.find((v) => v.request.convId === convId && v.request.toolId === toolId) : undefined;
}

/** How many of a session's approvals are still waiting for an answer. */
export function waitingCount(state: ApprovalView[], convId: string | null): number {
  return state.filter((v) => v.request.convId === convId && (v.state === "waiting" || v.state === "answering")).length;
}

/** Tools whose input is the change itself (code, record values): their details start open. */
const OPEN_DETAILS = new Set(["run_apex", "create_record", "update_record", "delete_record", "bulk_create_records", "bulk_update_records", "deploy_metadata"]);

export const detailsOpen = (name: string) => OPEN_DETAILS.has(name);

/** Characters shown before the card says how much more there is; nothing is cut without saying so. */
export const INPUT_SHOWN = 200_000;

export interface InputEntry {
  key: string;
  /** Strings as they are (Apex reads as code, not an escaped JSON string); anything else as JSON. */
  text: string;
  /** Characters not shown. */
  hidden: number;
}

/** A tool call's input, one entry per field, for the approval card. */
export function inputEntries(input: Record<string, unknown>): InputEntry[] {
  let budget = INPUT_SHOWN;
  return Object.entries(input ?? {}).map(([key, value]) => {
    const full = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
    const shown = full.slice(0, Math.max(0, budget));
    budget -= shown.length;
    return { key, text: shown, hidden: full.length - shown.length };
  });
}
