import { createContext, useContext } from "react";
import type { ImageAttachment } from "../../hooks/useChat";
import type { SessionOrgView } from "../../orgs";
import type { StudioRequest } from "../../studio-request";
import type { ApprovalView } from "./approval-logic";

/** What the cards in a conversation need from ChatView, so it doesn't thread props through every tool row. */
export interface ChatCardsEnv {
  convId: string | null;
  org: SessionOrgView | null;
  isStreaming: boolean;
  approvals: ApprovalView[];
  respond: (requestId: string, allow: boolean) => Promise<void>;
  onSend: (text: string, model?: string, images?: ImageAttachment[]) => void;
  onOpenStudio?: (request?: StudioRequest) => void;
}

const Ctx = createContext<ChatCardsEnv | null>(null);

export const ChatCardsProvider = Ctx.Provider;

export function useChatCards(): ChatCardsEnv {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChatCards needs a ChatCardsProvider");
  return v;
}
