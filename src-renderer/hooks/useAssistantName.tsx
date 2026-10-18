import React, { createContext, useContext } from "react";

/** Who "Ask … how to fix" hands off to: "Claude" on Claude connections, "AI" otherwise. */
export const AssistantNameContext = createContext("Claude");

export function useAssistantName(): string {
  return useContext(AssistantNameContext);
}

/** The assistant's name, for button labels. */
export function AssistantName() {
  return <>{useAssistantName()}</>;
}
