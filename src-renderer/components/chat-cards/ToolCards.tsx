import React from "react";
import { CircleAlert } from "lucide-react";
import Spinner from "../ui/Spinner";
import type { ToolCall } from "../../hooks/useChat";
import { useChatCards } from "./ChatCardsContext";
import { approvalFor } from "./approval-logic";
import { cardFor } from "./card-logic";
import ApprovalCard from "./ApprovalCard";
import DiagnosisCard from "./DiagnosisCard";
import QueuedCard from "./QueuedCard";
import { UserCheckCard, UserMatchesCard } from "./UserCheckCard";
import "./chat-cards.css";

/** The cards for one tool call — a waiting approval and/or its result — drawn below its step row. Nothing for an ordinary call. */
export default function ToolCards({ tool }: { tool: ToolCall }) {
  const { convId, approvals } = useChatCards();
  const approval = approvalFor(approvals, convId, tool.id);
  const card = cardFor(tool);
  if (!approval && !card) return null;
  return (
    <div className="chat-cards">
      {approval && <ApprovalCard view={approval} />}
      {card?.kind === "diagnosis" && <DiagnosisCard result={card.result} />}
      {card?.kind === "user-check" && <UserCheckCard trace={card.trace} />}
      {card?.kind === "user-matches" && <UserMatchesCard matches={card.matches} message={card.message} />}
      {card?.kind === "queued" && <QueuedCard labels={card.labels} />}
      {card?.kind === "loading" && (
        <div className="chat-card chat-card-line" role="status">
          <Spinner size={14} />
          <span>{card.title}</span>
        </div>
      )}
      {card?.kind === "failed" && (
        <div className="chat-card chat-card-line error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span className="chat-card-line-text">
            <strong>{card.title}.</strong> {card.message}
          </span>
        </div>
      )}
    </div>
  );
}
