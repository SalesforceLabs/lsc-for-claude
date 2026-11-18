import React from "react";
import { Check, CircleQuestionMark } from "lucide-react";
import { useChatCards } from "./ChatCardsContext";
import type { ChoiceOption } from "./card-logic";
import "./chat-cards.css";

/**
 * Roz's `ask_user` question with its answers as buttons. Picking one sends its label as the user's
 * reply; once answered (a message follows), the card keeps the pick and stops taking clicks.
 */
export default function ChoiceCard({ toolId, question, options }: { toolId: string; question: string; options: ChoiceOption[] }) {
  const { onSend, isStreaming, choiceAnswers } = useChatCards();
  const answer = choiceAnswers.get(toolId);
  const answered = answer !== undefined;
  const picked = answered ? options.find((o) => o.label === answer)?.label : undefined;

  return (
    <section className="chat-card" aria-label={question}>
      <header className="chat-card-head">
        <CircleQuestionMark className="chat-choice-icon" size={16} aria-hidden="true" />
        <div className="chat-card-title">
          <span>{question}</span>
          {!answered && <span className="chat-card-meta">Pick one, or type a different answer below.</span>}
          {answered && !picked && answer && <span className="chat-card-meta" title={answer}>You answered: {answer}</span>}
        </div>
      </header>
      <ul className="chat-choice-list" role="list">
        {options.map((o) => {
          const isPicked = o.label === picked;
          return (
            <li key={o.label}>
              <button
                type="button"
                className={`chat-choice${isPicked ? " picked" : ""}`}
                disabled={answered || isStreaming}
                aria-pressed={answered ? isPicked : undefined}
                title={o.detail ? `${o.label} · ${o.detail}` : o.label}
                onClick={() => onSend(o.label)}
              >
                <span className="chat-choice-label">{o.label}</span>
                {o.detail && <span className="chat-choice-detail">{o.detail}</span>}
                {isPicked && <Check className="chat-choice-check" size={14} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
