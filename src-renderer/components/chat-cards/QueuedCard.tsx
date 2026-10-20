import React from "react";
import { ArrowUpRight, ListChecks } from "lucide-react";
import { useChatCards } from "./ChatCardsContext";
import { queuedSummary } from "./card-logic";
import "./chat-cards.css";

/** A write that went to Studio's tray instead of the org: nothing has changed until the user reviews it there. */
export default function QueuedCard({ labels }: { labels: string[] }) {
  const { onOpenStudio } = useChatCards();
  return (
    <div className="chat-card chat-card-line" role="status">
      <ListChecks size={16} aria-hidden="true" />
      <span className="chat-card-line-text" title={labels.join("\n")}>
        {queuedSummary(labels)}
      </span>
      {onOpenStudio && (
        <button type="button" className="studio-btn sm" onClick={() => onOpenStudio({ kind: "review" })}>
          Review in Studio <ArrowUpRight aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
