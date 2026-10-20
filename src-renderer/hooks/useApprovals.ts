import { useCallback, useEffect, useReducer } from "react";
import { approvalsReducer, initialApprovals, type ApprovalView } from "../components/chat-cards/approval-logic";

/**
 * Chat writes that wait for an answer. Loads the ones still open on mount (so a session opened
 * later shows them), follows new requests and settlements, and answers through `respond`.
 */
export function useApprovals(): { approvals: ApprovalView[]; respond: (requestId: string, allow: boolean) => Promise<void> } {
  const [state, dispatch] = useReducer(approvalsReducer, initialApprovals);

  useEffect(() => {
    let live = true;
    const offRequest = window.lscApi.onApprovalRequest((request) => dispatch({ type: "request", request }));
    const offSettled = window.lscApi.onApprovalSettled((e) => dispatch({ type: "settled", ...e }));
    window.lscApi
      .listApprovals()
      .then((requests) => live && dispatch({ type: "load", requests }))
      .catch(() => {});
    return () => {
      live = false;
      offRequest();
      offSettled();
    };
  }, []);

  const respond = useCallback(async (requestId: string, allow: boolean) => {
    dispatch({ type: "answering", requestId });
    try {
      const res = await window.lscApi.respondApproval(requestId, allow);
      if (!res.ok) dispatch({ type: "failed", requestId });
    } catch {
      dispatch({ type: "failed", requestId });
    }
  }, []);

  return { approvals: state.views, respond };
}
