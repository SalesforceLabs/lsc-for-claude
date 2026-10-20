import React from "react";
import { Check, ShieldQuestionMark, X } from "lucide-react";
import Spinner from "../ui/Spinner";
import { KIND_LABEL } from "../../orgs";
import { useChatCards } from "./ChatCardsContext";
import type { ApprovalView } from "./approval-logic";
import "./chat-cards.css";

const INPUT_LIMIT = 2000;

/** A write the model wants to make: what it will change, and Allow or Deny. Answered, it keeps the verdict. */
export default function ApprovalCard({ view }: { view: ApprovalView }) {
  const { respond } = useChatCards();
  const { request, state } = view;
  const waiting = state === "waiting" || state === "answering";
  const input = JSON.stringify(request.input, null, 2);
  return (
    <section className={`chat-card chat-approval ${state}`} aria-label={waiting ? "Approval needed" : state === "allowed" ? "Allowed" : "Denied"}>
      <div className="chat-approval-main">
        {state === "allowed" ? (
          <Check size={16} aria-hidden="true" className="chat-approval-icon allowed" />
        ) : state === "denied" ? (
          <X size={16} aria-hidden="true" className="chat-approval-icon denied" />
        ) : (
          <ShieldQuestionMark size={16} aria-hidden="true" className="chat-approval-icon" />
        )}
        <div className="chat-approval-text">
          <span className="chat-approval-summary">{request.summary}</span>
          <span className="chat-card-meta">
            {waiting ? "Waiting for your answer" : state === "allowed" ? "Allowed" : "Denied"} · <code>{request.name}</code>
          </span>
        </div>
        {request.production && <span className="ui-pill warning">{KIND_LABEL.production}</span>}
      </div>
      {input && input !== "{}" && (
        <details className="chat-approval-input">
          <summary>Details</summary>
          <pre>{input.length > INPUT_LIMIT ? `${input.slice(0, INPUT_LIMIT)}\n…(truncated)` : input}</pre>
        </details>
      )}
      {waiting && (
        <div className="chat-approval-actions">
          <button type="button" className="studio-btn" disabled={state === "answering"} onClick={() => respond(request.requestId, false)}>
            Deny
          </button>
          <button type="button" className="studio-btn primary" disabled={state === "answering"} onClick={() => respond(request.requestId, true)}>
            {state === "answering" && <Spinner size={12} />}
            Allow
          </button>
        </div>
      )}
    </section>
  );
}
