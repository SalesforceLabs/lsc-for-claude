import React, { createContext, useContext } from "react";
import { ASSISTANT_NAME } from "../connection";

/** Who "Ask … how to fix" hands off to. */
export const AssistantNameContext = createContext(ASSISTANT_NAME);

export function useAssistantName(): string {
  return useContext(AssistantNameContext);
}

/** The assistant's name, for button labels. */
export function AssistantName() {
  return <>{useAssistantName()}</>;
}
